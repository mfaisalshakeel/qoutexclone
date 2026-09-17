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
import { payouts } from './payouts.js';
import { assessStake } from './risk.js';
import {
  clockSlots,
  validateAgainstClose,
  validateClockExpiry,
  validateDuration,
  type ClockConfig,
  type ClockSlot,
  type ExpiryMode,
} from '../engine/expiry.js';

/** Expiries offered on the terminal, in seconds. Operators change this at runtime. */
export function durations(): number[] {
  return settings.get('trading.durations');
}

/** The durations one market offers: its own list, or the platform's. */
export function durationsFor(asset: { durations?: unknown }): number[] {
  const own = asset.durations;
  if (Array.isArray(own)) {
    const allowed = new Set(durations());
    // a market may narrow the platform list, never widen it
    const narrowed = own.filter((value): value is number => typeof value === 'number' && allowed.has(value));
    if (narrowed.length) return [...narrowed].sort((a, b) => a - b);
  }
  return durations();
}

export function expiryModes(): ExpiryMode[] {
  return settings.get('trading.expiryModes');
}

export function clockConfig(): ClockConfig {
  return {
    steps: settings.get('trading.clockSteps'),
    cutoffSec: settings.get('trading.clockCutoffSec'),
    horizonSec: settings.get('trading.clockHorizonSec'),
  };
}

/** The clock boundaries a trader may buy right now. */
export function clockExpiries(at = Date.now()): ClockSlot[] {
  if (!expiryModes().includes('CLOCK')) return [];
  return clockSlots(at, clockConfig());
}

export const tradeEvents = new EventEmitter();

export interface PlaceTradeInput {
  userId: string;
  symbol: string;
  accountType: AccountType;
  direction: 'UP' | 'DOWN';
  stake: number; // cents
  /** DURATION: a length from now. CLOCK: `expiresAt` is the boundary bought. */
  expiryMode?: ExpiryMode;
  /** Required in duration mode. */
  durationSec?: number;
  /** Required in clock mode: the boundary, in epoch milliseconds. */
  expiresAt?: number;
  /** required when accountType is TOURNAMENT */
  tournamentId?: string;
}

export async function placeTrade(input: PlaceTradeInput): Promise<Trade> {
  const mode: ExpiryMode = input.expiryMode ?? 'DURATION';
  if (!expiryModes().includes(mode)) {
    throw badRequest('That expiry mode is not offered', 'invalid_expiry');
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

  // Resolve the expiry against this market's own offer, then against its
  // session: a position that outlives the close has no tick to be priced from.
  let expiresAt: Date;
  let durationSec: number;
  if (mode === 'CLOCK') {
    const rejection = validateClockExpiry(openedAt.getTime(), input.expiresAt ?? Number.NaN, clockConfig());
    if (rejection) throw badRequest(rejection.message, rejection.code);
    expiresAt = new Date(input.expiresAt!);
    durationSec = Math.round((expiresAt.getTime() - openedAt.getTime()) / 1000);
  } else {
    const rejection = validateDuration(input.durationSec ?? Number.NaN, durationsFor(asset));
    if (rejection) throw badRequest(rejection.message, rejection.code);
    durationSec = input.durationSec!;
    expiresAt = new Date(openedAt.getTime() + durationSec * 1000);
  }

  const closeRejection = validateAgainstClose(
    expiresAt.getTime(),
    session.nextClose ? new Date(session.nextClose).getTime() : null,
  );
  if (closeRejection) throw conflict(closeRejection.message, closeRejection.code);

  // Resolved once, here, and written into the row: whatever the rules do later,
  // this position pays what it was quoted. The status bonus arrives in Phase 4.
  const payout = payouts.resolve(
    {
      id: asset.id,
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      payoutPct: asset.payoutPct,
      volatility: asset.volatility,
    },
    { at: openedAt },
  );

  const trade = await prisma.$transaction(async (tx) => {
    // Risk is checked here, inside the transaction, so the aggregate it reads
    // and the position it guards are one unit of work. It rejects a *new*
    // stake and nothing else: the price and the payout above are already
    // settled and cannot be influenced by what anyone holds.
    const rejection = await assessStake(tx, {
      assetId: asset.id,
      userId: input.userId,
      accountType: input.accountType,
      direction: input.direction,
      stake: input.stake,
      asset,
    });
    if (rejection) {
      throw rejection.code === 'stake_too_low' || rejection.code === 'stake_too_high'
        ? badRequest(rejection.message, rejection.code)
        : conflict(rejection.message, rejection.code, { remaining: rejection.remaining });
    }

    const created = await tx.trade.create({
      data: {
        userId: input.userId,
        assetId: asset.id,
        symbol: asset.symbol,
        accountType: input.accountType,
        direction: input.direction,
        expiryMode: mode,
        stake: input.stake,
        payoutPct: payout.pct,
        entryPrice,
        durationSec,
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
