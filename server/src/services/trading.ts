import { EventEmitter } from 'node:events';
import type { Trade } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { winProfit } from '../lib/money.js';
import { marketFeed } from '../engine/feed.js';
import { applyLedger, type AccountType } from './wallet.js';
import { activeEntry, adjustEntryBalance } from './tournaments.js';
import { settings } from './settings.js';
import { marketHours, otcAlternative } from './market-hours.js';

/** Expiries offered on the terminal, in seconds. Operators change this at runtime. */
export function durations(): number[] {
  return settings.get('trading.durations');
}

export const tradeEvents = new EventEmitter();

export interface PlaceTradeInput {
  userId: string;
  symbol: string;
  accountType: AccountType;
  direction: 'UP' | 'DOWN';
  stake: number; // cents
  durationSec: number;
  /** required when accountType is TOURNAMENT */
  tournamentId?: string;
}

export async function placeTrade(input: PlaceTradeInput): Promise<Trade> {
  if (!durations().includes(input.durationSec)) {
    throw badRequest('Unsupported expiry time', 'invalid_duration');
  }

  const asset = await prisma.asset.findUnique({ where: { symbol: input.symbol } });
  if (!asset) throw notFound('Unknown asset');
  if (!asset.enabled) throw conflict('Trading on this asset is closed', 'asset_disabled');

  // exchange-traded markets only accept positions inside their session
  const session = marketHours.stateFor(asset.scheduleId);
  if (!session.isOpen) {
    const alternative = await otcAlternative(asset.symbol);
    throw conflict(
      alternative
        ? `${asset.pair} is closed right now. The OTC market trades 24/7.`
        : `${asset.pair} is closed right now.`,
      'market_closed',
      { nextOpen: session.nextOpen, holiday: session.holiday, otcAlternative: alternative },
    );
  }
  if (input.stake < asset.minStake) {
    throw badRequest(`Minimum stake is $${(asset.minStake / 100).toFixed(2)}`, 'stake_too_low');
  }
  if (input.stake > asset.maxStake) {
    throw badRequest(`Maximum stake is $${(asset.maxStake / 100).toFixed(2)}`, 'stake_too_high');
  }

  const openCount = await prisma.trade.count({ where: { userId: input.userId, status: 'OPEN' } });
  if (openCount >= settings.get('trading.maxOpenTrades')) {
    throw conflict('You have too many open positions', 'too_many_open_trades');
  }

  const entryPrice = marketFeed.getPrice(asset.symbol);
  if (entryPrice == null) throw conflict('No market price available for this asset', 'no_price');

  // tournament positions are staked in chips held by the entry, never cash
  const entry =
    input.accountType === 'TOURNAMENT' ? await activeEntry(input.userId, input.tournamentId) : null;
  if (input.accountType === 'TOURNAMENT') {
    if (!entry) throw conflict('You are not in a running tournament', 'no_tournament_entry');
    if (entry.balance < input.stake) throw badRequest('Not enough tournament balance', 'insufficient_funds');
  }

  const openedAt = new Date();
  const expiresAt = new Date(openedAt.getTime() + input.durationSec * 1000);

  const trade = await prisma.$transaction(async (tx) => {
    const created = await tx.trade.create({
      data: {
        userId: input.userId,
        assetId: asset.id,
        symbol: asset.symbol,
        accountType: input.accountType,
        direction: input.direction,
        stake: input.stake,
        payoutPct: asset.payoutPct,
        entryPrice,
        durationSec: input.durationSec,
        openedAt,
        expiresAt,
        status: 'OPEN',
        entryId: entry?.id,
        tournamentId: entry?.tournamentId,
      },
    });

    if (entry) {
      await adjustEntryBalance(tx, entry.id, -input.stake);
    } else {
      await applyLedger(tx, {
        userId: input.userId,
        accountType: input.accountType,
        type: 'TRADE_STAKE',
        amount: -input.stake,
        refType: 'trade',
        refId: created.id,
        note: `${input.direction} ${asset.symbol} @ ${entryPrice}`,
      });
    }
    return created;
  });

  tradeEvents.emit('opened', trade);
  return trade;
}

export interface OutcomeInput {
  direction: 'UP' | 'DOWN';
  entryPrice: number;
  exitPrice: number;
  stake: number;
  payoutPct: number;
}

export interface Outcome {
  status: 'WON' | 'LOST' | 'REFUNDED';
  /** net result in cents: +payout on a win, -stake on a loss, 0 on a tie */
  profit: number;
  /** cents returned to the balance (stake back plus profit) */
  credit: number;
}

/**
 * The binary option payout rule, kept pure so it can be reasoned about and
 * tested on its own: strictly above the strike wins a CALL, strictly below
 * wins a PUT, and an exact tie returns the stake.
 */
export function resolveOutcome(input: OutcomeInput): Outcome {
  let status: Outcome['status'];
  if (input.exitPrice === input.entryPrice) status = 'REFUNDED';
  else if (input.direction === 'UP') status = input.exitPrice > input.entryPrice ? 'WON' : 'LOST';
  else status = input.exitPrice < input.entryPrice ? 'WON' : 'LOST';

  const profit =
    status === 'WON' ? winProfit(input.stake, input.payoutPct) : status === 'LOST' ? -input.stake : 0;
  const credit = status === 'WON' ? input.stake + profit : status === 'REFUNDED' ? input.stake : 0;
  return { status, profit, credit };
}

export interface SettlementResult {
  trade: Trade;
  balance: number;
}

/**
 * Settles one expired position. Exit price is the last tick at or before the
 * expiry instant, so a slow settlement pass can never change the outcome.
 * A tie refunds the stake, matching how binary options quote "at the money".
 */
export async function settleTrade(tradeId: string): Promise<SettlementResult | null> {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.status !== 'OPEN') return null;
  if (trade.expiresAt.getTime() > Date.now()) return null;

  const exitPrice = marketFeed.priceAt(trade.symbol, trade.expiresAt.getTime());
  if (exitPrice == null) return null;

  const { status, profit, credit } = resolveOutcome({
    direction: trade.direction as 'UP' | 'DOWN',
    entryPrice: trade.entryPrice,
    exitPrice,
    stake: trade.stake,
    payoutPct: trade.payoutPct,
  });

  const result = await prisma.$transaction(async (tx) => {
    // Guard against a concurrent settlement pass paying the same trade twice.
    const claimed = await tx.trade.updateMany({
      where: { id: trade.id, status: 'OPEN' },
      data: { status, exitPrice, profit, settledAt: new Date() },
    });
    if (claimed.count === 0) return null;

    let balance: number | null = null;
    if (trade.entryId) {
      balance = await adjustEntryBalance(tx, trade.entryId, credit, status);
    } else if (credit > 0) {
      balance = await applyLedger(tx, {
        userId: trade.userId,
        accountType: trade.accountType as AccountType,
        type: status === 'WON' ? 'TRADE_PAYOUT' : 'TRADE_REFUND',
        amount: credit,
        refType: 'trade',
        refId: trade.id,
        note: `${trade.symbol} ${trade.direction} ${status.toLowerCase()} @ ${exitPrice}`,
      });
    } else {
      const user = await tx.user.findUnique({
        where: { id: trade.userId },
        select: { demoBalance: true, realBalance: true },
      });
      balance = trade.accountType === 'DEMO' ? (user?.demoBalance ?? 0) : (user?.realBalance ?? 0);
    }

    const settled = await tx.trade.findUnique({ where: { id: trade.id } });
    return { trade: settled as Trade, balance: balance ?? 0 };
  });

  if (result) tradeEvents.emit('settled', result);
  return result;
}

export async function listTrades(
  userId: string,
  options: { status?: 'OPEN' | 'CLOSED'; accountType?: AccountType; limit?: number },
) {
  const limit = Math.min(options.limit ?? 50, 200);
  const where: Record<string, unknown> = { userId };
  if (options.accountType) where.accountType = options.accountType;
  if (options.status === 'OPEN') where.status = 'OPEN';
  if (options.status === 'CLOSED') where.status = { in: ['WON', 'LOST', 'REFUNDED'] };
  return prisma.trade.findMany({
    where,
    orderBy: options.status === 'OPEN' ? { expiresAt: 'asc' } : { settledAt: 'desc' },
    take: limit,
  });
}

export async function tradingStats(userId: string, accountType: AccountType) {
  const trades = await prisma.trade.findMany({
    where: { userId, accountType, status: { in: ['WON', 'LOST', 'REFUNDED'] } },
    select: { status: true, profit: true, stake: true },
  });
  const wins = trades.filter((t) => t.status === 'WON').length;
  const losses = trades.filter((t) => t.status === 'LOST').length;
  const netProfit = trades.reduce((sum, t) => sum + t.profit, 0);
  const volume = trades.reduce((sum, t) => sum + t.stake, 0);
  const decided = wins + losses;
  return {
    total: trades.length,
    wins,
    losses,
    refunded: trades.length - decided,
    winRate: decided ? Math.round((wins / decided) * 1000) / 10 : 0,
    netProfit,
    volume,
  };
}
