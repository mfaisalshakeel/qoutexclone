import type { InventoryItem, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { applyLedger } from './wallet.js';
import { settings } from './settings.js';

/**
 * The marketplace.
 *
 * Four kinds of item, each with its own parameters, bought with money or with
 * loyalty points and held in an inventory until activated. Every effect that
 * moves money goes through `applyLedger` like everything else, and the
 * inventory row is the record of what was bought, what it cost and what it did.
 *
 * An item's configuration is *copied onto the inventory row at purchase*. An
 * operator editing the catalogue changes what is on sale, never what someone
 * has already paid for.
 */

export const ITEM_KINDS = ['PAYOUT_BOOSTER', 'RISK_FREE', 'DEPOSIT_BONUS', 'PRACTICE_REFILL'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Per-kind parameters, validated on the way in and on the way out. */
export const ITEM_CONFIG_SCHEMAS = {
  PAYOUT_BOOSTER: z.object({
    /** Percentage points added to the trader's payout while it runs. */
    bonusPct: z.number().min(1).max(50),
    minutes: z.number().int().min(1).max(1440),
  }),
  RISK_FREE: z.object({
    /** How many losing positions it covers. */
    trades: z.number().int().min(1).max(50),
    /** The most it will refund on any one of them, in cents. */
    maxRefundCents: z.number().int().min(100).max(10_000_000),
    /** How long the trader has to use it. */
    hours: z.number().int().min(1).max(720),
  }),
  DEPOSIT_BONUS: z.object({
    percent: z.number().min(1).max(200),
    maxBonusCents: z.number().int().min(100).max(10_000_000),
    days: z.number().int().min(1).max(365),
  }),
  PRACTICE_REFILL: z.object({
    /** Cents added to the practice balance, immediately. */
    amountCents: z.number().int().min(100).max(100_000_000),
  }),
} as const;

export type ItemConfig<K extends ItemKind = ItemKind> = z.infer<(typeof ITEM_CONFIG_SCHEMAS)[K]>;

export function parseItemConfig(kind: ItemKind, config: unknown) {
  const schema = ITEM_CONFIG_SCHEMAS[kind];
  if (!schema) throw badRequest('Unknown marketplace item kind', 'bad_kind');
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    throw badRequest(
      `That configuration is not valid for ${kind}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`,
      'bad_config',
    );
  }
  return parsed.data;
}

function enabled(): boolean {
  return settings.get('growth.marketplaceEnabled');
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

export async function listItems(options: { includeDisabled?: boolean } = {}) {
  return prisma.marketplaceItem.findMany({
    where: options.includeDisabled ? undefined : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/* -------------------------------------------------------------------------- */
/* Buying                                                                     */
/* -------------------------------------------------------------------------- */

export type PayWith = 'cents' | 'points';

/**
 * Buys one item.
 *
 * Money leaves through `applyLedger`, which refuses to overdraw, and points
 * are spent with a conditional update that cannot go negative however many
 * requests arrive at once. Both happen in the same transaction as the
 * inventory row, so a purchase is whole or it did not happen.
 */
export async function buyItem(input: {
  userId: string;
  itemId: string;
  payWith: PayWith;
}): Promise<InventoryItem> {
  if (!enabled()) throw conflict('The marketplace is closed', 'marketplace_disabled');

  const item = await prisma.marketplaceItem.findUnique({ where: { id: input.itemId } });
  if (!item || !item.enabled) throw notFound('That item is not on sale');

  const price = input.payWith === 'points' ? item.pricePoints : item.priceCents;
  if (price <= 0) {
    throw badRequest(
      input.payWith === 'points'
        ? 'That item cannot be bought with points'
        : 'That item cannot be bought with money',
      'bad_price',
    );
  }

  const config = parseItemConfig(item.kind as ItemKind, item.config);

  return prisma.$transaction(async (tx) => {
    if (input.payWith === 'points') {
      // conditional: the row only updates while the balance covers it, so two
      // simultaneous purchases cannot both spend the same points
      const spent = await tx.user.updateMany({
        where: { id: input.userId, points: { gte: price } },
        data: { points: { decrement: price } },
      });
      if (spent.count === 0) throw badRequest('Not enough points', 'insufficient_points');
    } else {
      await applyLedger(tx, {
        userId: input.userId,
        accountType: 'REAL',
        type: 'MARKETPLACE',
        amount: -price,
        refType: 'marketplace',
        refId: item.id,
        note: item.name,
      });
    }

    return tx.inventoryItem.create({
      data: {
        userId: input.userId,
        itemId: item.id,
        config,
        paidCents: input.payWith === 'cents' ? price : 0,
        paidPoints: input.payWith === 'points' ? price : 0,
        usesLeft: item.kind === 'RISK_FREE' ? (config as ItemConfig<'RISK_FREE'>).trades : 0,
      },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Activating                                                                 */
/* -------------------------------------------------------------------------- */

/** How long an activated item runs, or null when it is spent immediately. */
function windowFor(kind: ItemKind, config: ItemConfig): Date | null {
  const now = Date.now();
  switch (kind) {
    case 'PAYOUT_BOOSTER':
      return new Date(now + (config as ItemConfig<'PAYOUT_BOOSTER'>).minutes * 60_000);
    case 'RISK_FREE':
      return new Date(now + (config as ItemConfig<'RISK_FREE'>).hours * 3_600_000);
    case 'DEPOSIT_BONUS':
      return new Date(now + (config as ItemConfig<'DEPOSIT_BONUS'>).days * 86_400_000);
    default:
      return null;
  }
}

/**
 * Turns an owned item on.
 *
 * A timed item starts its clock here; a practice refill is spent on the spot.
 * The status moves with a conditional update, so the same item cannot be
 * activated twice by two requests arriving together.
 */
export async function activateItem(userId: string, inventoryId: string): Promise<InventoryItem> {
  const held = await prisma.inventoryItem.findFirst({
    where: { id: inventoryId, userId },
    include: { item: true },
  });
  if (!held) throw notFound('That is not in your inventory');
  if (held.status !== 'OWNED') throw conflict('That item has already been used', 'already_used');

  const kind = held.item.kind as ItemKind;
  const config = parseItemConfig(kind, held.config);

  if (kind === 'PAYOUT_BOOSTER') {
    const clash = await prisma.inventoryItem.findFirst({
      where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() }, item: { kind: 'PAYOUT_BOOSTER' } },
    });
    if (clash) throw conflict('A payout booster is already running', 'booster_active');
  }

  const expiresAt = windowFor(kind, config);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.inventoryItem.updateMany({
      where: { id: inventoryId, userId, status: 'OWNED' },
      data: {
        status: kind === 'PRACTICE_REFILL' ? 'USED' : 'ACTIVE',
        activatedAt: new Date(),
        expiresAt,
        consumedAt: kind === 'PRACTICE_REFILL' ? new Date() : null,
      },
    });
    if (claimed.count === 0) throw conflict('That item has already been used', 'already_used');

    if (kind === 'PRACTICE_REFILL') {
      await applyLedger(tx, {
        userId,
        accountType: 'DEMO',
        type: 'PRACTICE_TOPUP',
        amount: (config as ItemConfig<'PRACTICE_REFILL'>).amountCents,
        refType: 'marketplace',
        refId: inventoryId,
        note: held.item.name,
      });
    }

    return tx.inventoryItem.findUniqueOrThrow({ where: { id: inventoryId } });
  });
}

/* -------------------------------------------------------------------------- */
/* Effects                                                                    */
/* -------------------------------------------------------------------------- */

/** The running booster, for the ticket to quote. Null when there is none. */
export async function runningBoost(userId: string): Promise<{ bonusPct: number; expiresAt: string } | null> {
  if (!enabled()) return null;
  const booster = await prisma.inventoryItem.findFirst({
    where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() }, item: { kind: 'PAYOUT_BOOSTER' } },
    orderBy: { expiresAt: 'desc' },
  });
  if (!booster?.expiresAt) return null;
  const config = ITEM_CONFIG_SCHEMAS.PAYOUT_BOOSTER.safeParse(booster.config);
  if (!config.success) return null;
  return { bonusPct: config.data.bonusPct, expiresAt: booster.expiresAt.toISOString() };
}

/** The payout bonus a running booster is worth right now, in percentage points. */
export async function activeBoosterBonus(userId: string): Promise<number> {
  if (!enabled()) return 0;
  const booster = await prisma.inventoryItem.findFirst({
    where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() }, item: { kind: 'PAYOUT_BOOSTER' } },
    orderBy: { expiresAt: 'desc' },
  });
  if (!booster) return 0;
  const config = ITEM_CONFIG_SCHEMAS.PAYOUT_BOOSTER.safeParse(booster.config);
  return config.success ? config.data.bonusPct : 0;
}

/**
 * Refunds a losing position from a risk-free item, if one is running.
 *
 * Called from settlement, inside its transaction: the refund and the use that
 * paid for it land together or not at all. The cover is spent with a
 * conditional update on the remaining uses, so a burst of losses settling at
 * once can never spend the same use twice.
 */
export async function coverLoss(
  tx: Prisma.TransactionClient,
  input: { userId: string; tradeId: string; stake: number; accountType: string },
): Promise<number> {
  if (!enabled()) return 0;
  if (input.accountType !== 'REAL') return 0;

  const cover = await tx.inventoryItem.findFirst({
    where: {
      userId: input.userId,
      status: 'ACTIVE',
      usesLeft: { gt: 0 },
      expiresAt: { gt: new Date() },
      item: { kind: 'RISK_FREE' },
    },
    orderBy: { expiresAt: 'asc' },
  });
  if (!cover) return 0;

  const config = ITEM_CONFIG_SCHEMAS.RISK_FREE.safeParse(cover.config);
  if (!config.success) return 0;

  const claimed = await tx.inventoryItem.updateMany({
    where: { id: cover.id, status: 'ACTIVE', usesLeft: { gt: 0 } },
    data: { usesLeft: { decrement: 1 } },
  });
  if (claimed.count === 0) return 0;

  const refund = Math.min(input.stake, config.data.maxRefundCents);
  await applyLedger(tx, {
    userId: input.userId,
    accountType: 'REAL',
    type: 'RISK_FREE_REFUND',
    amount: refund,
    refType: 'trade',
    refId: input.tradeId,
    note: 'Risk-free position refunded',
  });

  // spent when the last use goes; the row stays as the record
  await tx.inventoryItem.updateMany({
    where: { id: cover.id, usesLeft: 0, status: 'ACTIVE' },
    data: { status: 'USED', consumedAt: new Date() },
  });

  return refund;
}

/**
 * The best deposit-bonus coupon a trader is holding, and what it is worth on
 * this deposit. Returns null when there is nothing to apply.
 */
export async function couponFor(
  tx: Prisma.TransactionClient,
  input: { userId: string; depositCents: number },
): Promise<{ id: string; bonus: number } | null> {
  if (!enabled()) return null;

  const coupons = await tx.inventoryItem.findMany({
    where: {
      userId: input.userId,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      item: { kind: 'DEPOSIT_BONUS' },
    },
  });

  let best: { id: string; bonus: number } | null = null;
  for (const coupon of coupons) {
    const config = ITEM_CONFIG_SCHEMAS.DEPOSIT_BONUS.safeParse(coupon.config);
    if (!config.success) continue;
    const bonus = Math.min(
      Math.floor((input.depositCents * config.data.percent) / 100),
      config.data.maxBonusCents,
    );
    if (bonus > 0 && (!best || bonus > best.bonus)) best = { id: coupon.id, bonus };
  }
  return best;
}

/** Spends a coupon. Conditional, so one deposit can only ever consume it once. */
export async function spendCoupon(tx: Prisma.TransactionClient, inventoryId: string): Promise<boolean> {
  const spent = await tx.inventoryItem.updateMany({
    where: { id: inventoryId, status: 'ACTIVE' },
    data: { status: 'USED', consumedAt: new Date() },
  });
  return spent.count === 1;
}

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

/** Marks anything whose window has closed, so the inventory reads honestly. */
export async function expireStale(now = new Date()): Promise<number> {
  const result = await prisma.inventoryItem.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  if (result.count > 0) log.boot.info({ expired: result.count }, 'marketplace items expired');
  return result.count;
}

/** The trader's inventory, newest first, with the item it came from. */
export async function inventoryFor(userId: string) {
  await expireStale();
  return prisma.inventoryItem.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { item: { select: { key: true, name: true, description: true, kind: true } } },
  });
}
