import { EventEmitter } from 'node:events';
import type { PendingTrade } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { marketFeed } from '../engine/feed.js';
import { isExpired, shouldTrigger, sideFor, type OrderTrigger } from '../engine/orders.js';
import { clockConfig, durationsFor, expiryModes, placeTrade } from './trading.js';
import { validateClockExpiry, validateDuration, type ExpiryMode } from '../engine/expiry.js';
import { settings } from './settings.js';
import { marketHours } from './market-hours.js';
import { activeEntry } from './tournaments.js';

/**
 * Pending orders: a position the trader has asked for but that does not exist
 * yet.
 *
 * Execution is idempotent the same way settlement is: the row is *claimed* with
 * a conditional update before anything is placed, so two overlapping sweeps or a
 * restart mid-flight can never open the same order twice. A claimed order that
 * then fails to open is recorded as failed with the reason, never silently
 * retried — the trader asked for one position, not for repeated attempts at a
 * price that has moved.
 */

export const orderEvents = new EventEmitter();

export interface CreateOrderInput {
  userId: string;
  symbol: string;
  accountType: 'DEMO' | 'REAL' | 'TOURNAMENT';
  direction: 'UP' | 'DOWN';
  stake: number;
  trigger: OrderTrigger;
  /** PRICE: the level to wait for. */
  triggerPrice?: number;
  /** TIME: when to open. */
  triggerAt?: Date;
  expiryMode?: ExpiryMode;
  durationSec?: number;
  expiresAt?: number;
  /** When the order gives up; defaults to the configured window. */
  goodUntil?: Date;
  tournamentId?: string;
}

export async function createOrder(input: CreateOrderInput): Promise<PendingTrade> {
  const asset = await prisma.asset.findUnique({ where: { symbol: input.symbol } });
  if (!asset) throw notFound('Unknown asset');
  if (!asset.enabled) throw conflict('Trading on this asset is closed', 'asset_disabled');

  const open = await prisma.pendingTrade.count({
    where: { userId: input.userId, status: 'PENDING' },
  });
  if (open >= settings.get('trading.maxPendingOrders')) {
    throw conflict('You have too many pending orders', 'too_many_pending_orders');
  }

  // The expiry is validated now so an order cannot be placed with one the
  // platform would refuse. A clock boundary is re-validated when it fires,
  // because by then it may have passed.
  const mode: ExpiryMode = input.expiryMode ?? 'DURATION';
  if (!expiryModes().includes(mode)) throw badRequest('That expiry mode is not offered', 'invalid_expiry');
  if (mode === 'DURATION') {
    const rejection = validateDuration(input.durationSec ?? Number.NaN, durationsFor(asset));
    if (rejection) throw badRequest(rejection.message, rejection.code);
  } else {
    const rejection = validateClockExpiry(Date.now(), input.expiresAt ?? Number.NaN, clockConfig());
    if (rejection) throw badRequest(rejection.message, rejection.code);
  }

  if (input.stake < asset.minStake) {
    throw badRequest(`Minimum stake is $${(asset.minStake / 100).toFixed(2)}`, 'stake_too_low');
  }
  if (input.stake > asset.maxStake) {
    throw badRequest(`Maximum stake is $${(asset.maxStake / 100).toFixed(2)}`, 'stake_too_high');
  }

  const maxWindowSec = settings.get('trading.pendingGoodForSec');
  const goodUntil = input.goodUntil ?? new Date(Date.now() + maxWindowSec * 1000);
  if (goodUntil.getTime() <= Date.now()) {
    throw badRequest('That order would expire before it could fill', 'invalid_good_until');
  }
  if (goodUntil.getTime() > Date.now() + maxWindowSec * 1000) {
    throw badRequest(
      `An order can wait at most ${Math.round(maxWindowSec / 60)} minutes`,
      'invalid_good_until',
    );
  }

  let triggerPrice: number | null = null;
  let triggerSide: string | null = null;
  let triggerAt: Date | null = null;

  if (input.trigger === 'PRICE') {
    const current = marketFeed.getPrice(asset.symbol);
    if (current == null) throw conflict('No market price available for this asset', 'no_price');
    const side = sideFor(input.triggerPrice ?? Number.NaN, current);
    if (!side) {
      throw badRequest(
        'Pick a level above or below the current price — a level at the price is a market order',
        'invalid_trigger_price',
      );
    }
    triggerPrice = Number(input.triggerPrice);
    triggerSide = side;
  } else {
    if (!input.triggerAt || Number.isNaN(input.triggerAt.getTime())) {
      throw badRequest('That start time is not valid', 'invalid_trigger_time');
    }
    if (input.triggerAt.getTime() <= Date.now()) {
      throw badRequest('Pick a time in the future', 'invalid_trigger_time');
    }
    if (input.triggerAt.getTime() > goodUntil.getTime()) {
      throw badRequest('That order would expire before its start time', 'invalid_trigger_time');
    }
    triggerAt = input.triggerAt;
  }

  // a tournament order belongs to the entry that will pay for it
  const entry =
    input.accountType === 'TOURNAMENT' ? await activeEntry(input.userId, input.tournamentId) : null;
  if (input.accountType === 'TOURNAMENT' && !entry) {
    throw conflict('You are not in a running tournament', 'no_tournament_entry');
  }

  const order = await prisma.pendingTrade.create({
    data: {
      userId: input.userId,
      assetId: asset.id,
      symbol: asset.symbol,
      accountType: input.accountType,
      entryId: entry?.id,
      tournamentId: entry?.tournamentId,
      direction: input.direction,
      stake: input.stake,
      trigger: input.trigger,
      triggerPrice,
      triggerSide,
      triggerAt,
      expiryMode: mode,
      durationSec: mode === 'DURATION' ? input.durationSec : null,
      expiresAt: mode === 'CLOCK' ? new Date(input.expiresAt!) : null,
      goodUntil,
      status: 'PENDING',
    },
  });

  orderEvents.emit('created', order);
  return order;
}

/**
 * A trader's orders: everything still waiting, then the most recent finished
 * ones.
 *
 * Waiting orders come first *and whole*. Sorting by the status column would
 * order them alphabetically — CANCELLED before PENDING — and a trader with a
 * long history could have their live orders pushed past the limit entirely,
 * which is the one thing this list must never do.
 */
export async function listOrders(
  userId: string,
  options: { status?: 'PENDING' | 'DONE'; limit?: number } = {},
): Promise<PendingTrade[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  if (options.status === 'PENDING' || options.status === 'DONE') {
    return prisma.pendingTrade.findMany({
      where: {
        userId,
        status: options.status === 'PENDING' ? 'PENDING' : { not: 'PENDING' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  const waiting = await prisma.pendingTrade.findMany({
    where: { userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  if (waiting.length >= limit) return waiting;

  const finished = await prisma.pendingTrade.findMany({
    where: { userId, status: { not: 'PENDING' } },
    orderBy: { createdAt: 'desc' },
    take: limit - waiting.length,
  });
  return [...waiting, ...finished];
}

/** Cancels a waiting order. Ownership is checked; a filled order cannot be undone. */
export async function cancelOrder(userId: string, orderId: string): Promise<PendingTrade> {
  const order = await prisma.pendingTrade.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== userId) throw notFound('Order not found');
  if (order.status !== 'PENDING') {
    throw conflict('That order is no longer waiting', 'order_not_pending');
  }

  // the same conditional claim the sweep uses, so a cancel racing an execution
  // resolves one way or the other and never both
  const claimed = await prisma.pendingTrade.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
  if (claimed.count === 0) throw conflict('That order has just been filled', 'order_not_pending');

  const cancelled = await prisma.pendingTrade.findUniqueOrThrow({ where: { id: order.id } });
  orderEvents.emit('cancelled', cancelled);
  return cancelled;
}

/**
 * Opens one claimed order.
 *
 * The claim happens first and unconditionally: after it, this order will never
 * be executed again, whatever happens next. A failure is recorded on the row so
 * the trader can see why, and is not retried.
 */
async function execute(order: PendingTrade): Promise<PendingTrade | null> {
  const claimed = await prisma.pendingTrade.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'TRIGGERED', triggeredAt: new Date() },
  });
  if (claimed.count === 0) return null; // another pass got there first

  try {
    const trade = await placeTrade({
      userId: order.userId,
      symbol: order.symbol,
      accountType: order.accountType as 'DEMO' | 'REAL' | 'TOURNAMENT',
      direction: order.direction as 'UP' | 'DOWN',
      stake: order.stake,
      expiryMode: order.expiryMode as ExpiryMode,
      durationSec: order.durationSec ?? undefined,
      expiresAt: order.expiresAt?.getTime(),
      tournamentId: order.tournamentId ?? undefined,
    });

    const filled = await prisma.pendingTrade.update({
      where: { id: order.id },
      data: { tradeId: trade.id },
    });
    log.settlement.info({ order: order.id, trade: trade.id, symbol: order.symbol }, 'pending order filled');
    orderEvents.emit('triggered', { order: filled, trade });
    return filled;
  } catch (err) {
    // whatever refuses a trade at purchase refuses it here: a risk limit, a
    // closed market, a balance that has since been spent
    const reason = err instanceof Error ? err.message : 'The order could not be opened';
    const failed = await prisma.pendingTrade.update({
      where: { id: order.id },
      data: { status: 'FAILED', failureReason: reason.slice(0, 190) },
    });
    log.settlement.warn({ order: order.id, err }, 'pending order could not be filled');
    orderEvents.emit('failed', failed);
    return failed;
  }
}

export interface SweepResult {
  filled: number;
  expired: number;
}

/**
 * One execution pass: fires what is due and retires what has run out of time.
 *
 * Prices come from the feed, which knows nothing about orders — an order can no
 * more move a price than a position can.
 */
export async function sweepOrders(now = Date.now()): Promise<SweepResult> {
  const waiting = await prisma.pendingTrade.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  if (waiting.length === 0) return { filled: 0, expired: 0 };

  let filled = 0;
  const stale: string[] = [];

  for (const order of waiting) {
    if (isExpired(order, now)) {
      stale.push(order.id);
      continue;
    }
    // a market that has closed since the order was placed cannot open a
    // position, so the order waits rather than failing
    if (order.trigger === 'PRICE') {
      const asset = await prisma.asset.findUnique({
        where: { id: order.assetId },
        select: { scheduleId: true },
      });
      if (!marketHours.stateFor(asset?.scheduleId ?? null, new Date(now)).isOpen) continue;
    }

    const price = marketFeed.getPrice(order.symbol);
    if (!shouldTrigger(order, { price, now })) continue;

    const result = await execute(order);
    if (result?.status === 'TRIGGERED') filled += 1;
  }

  if (stale.length > 0) {
    const retired = await prisma.pendingTrade.updateMany({
      where: { id: { in: stale }, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    for (const id of stale) {
      const order = await prisma.pendingTrade.findUnique({ where: { id } });
      if (order?.status === 'EXPIRED') orderEvents.emit('expired', order);
    }
    return { filled, expired: retired.count };
  }

  return { filled, expired: 0 };
}
