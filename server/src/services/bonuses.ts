import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { settings } from './settings.js';

/**
 * Bonuses and the turnover behind them.
 *
 * A bonus is credited to the live balance like any other money — it goes
 * through `applyLedger` where it is granted, and this file never moves a
 * balance itself. What a `Bonus` row holds is the *right to withdraw* it: the
 * amount is locked until the trader has staked it a number of times over.
 *
 * That is the honest way to do it. Crediting bonus money into a second,
 * shadow balance would mean two numbers that have to agree for ever, and they
 * never do.
 */

export type BonusSource = 'deposit' | 'promo' | 'status' | 'coupon' | 'manual';

/** The global default when an offer does not set its own. */
export function defaultMultiplier(): number {
  return settings.get('wallet.bonusTurnoverMultiplier');
}

export function bonusesEnabled(): boolean {
  return settings.get('wallet.bonusesEnabled');
}

/* -------------------------------------------------------------------------- */
/* Offers                                                                     */
/* -------------------------------------------------------------------------- */

export async function listOffers(options: { includeDisabled?: boolean } = {}) {
  return prisma.bonusOffer.findMany({
    where: options.includeDisabled ? undefined : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/** What an offer is worth on a deposit of this size, and why not, if not. */
export function quoteOffer(
  offer: { percent: number; maxBonusCents: number; minDepositCents: number },
  depositCents: number,
): { bonus: number; eligible: boolean; reason?: string } {
  if (depositCents < offer.minDepositCents) {
    return {
      bonus: 0,
      eligible: false,
      reason: `Deposit at least $${(offer.minDepositCents / 100).toFixed(2)} for this offer`,
    };
  }
  const bonus = Math.min(Math.floor((depositCents * offer.percent) / 100), offer.maxBonusCents);
  return { bonus, eligible: bonus > 0 };
}

/** Checks the chosen offer exists and applies, before a deposit is created. */
export async function previewOffer(offerId: string, depositCents: number) {
  const offer = await prisma.bonusOffer.findUnique({ where: { id: offerId } });
  if (!offer || !offer.enabled) throw notFound('That bonus is no longer available');
  const quote = quoteOffer(offer, depositCents);
  if (!quote.eligible) throw badRequest(quote.reason ?? 'That bonus does not apply', 'offer_ineligible');
  return { offer, bonus: quote.bonus };
}

/* -------------------------------------------------------------------------- */
/* Granting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Records a credited bonus and the turnover it carries.
 *
 * The caller has already moved the money through `applyLedger`; this only
 * writes what has to be staked before it is free. A multiplier of zero means
 * the bonus is withdrawable at once, which is what "no turnover" means.
 */
export async function recordBonus(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: number;
    source: BonusSource;
    multiplier?: number;
    depositId?: string;
    offerId?: string;
    note?: string;
  },
): Promise<void> {
  if (input.amount <= 0) return;
  if (!bonusesEnabled()) return;

  const multiplier = input.multiplier ?? defaultMultiplier();
  const required = Math.max(Math.round(input.amount * multiplier), 0);

  await tx.bonus.create({
    data: {
      userId: input.userId,
      amount: input.amount,
      required,
      source: input.source,
      depositId: input.depositId,
      offerId: input.offerId,
      note: input.note,
      // nothing to stake means nothing to wait for
      status: required === 0 ? 'RELEASED' : 'ACTIVE',
      releasedAt: required === 0 ? new Date() : null,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Turnover                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Counts a settled live position towards every outstanding bonus.
 *
 * Oldest first, and a position only pays down one bonus at a time: staking $10
 * with two bonuses outstanding is $10 of turnover, not $20. Anything that
 * reaches its requirement is released in the same pass.
 */
export async function creditTurnover(input: {
  userId: string;
  stake: number;
  accountType: string;
}): Promise<number> {
  if (!bonusesEnabled()) return 0;
  if (input.accountType !== 'REAL' || input.stake <= 0) return 0;

  const outstanding = await prisma.bonus.findMany({
    where: { userId: input.userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });
  if (outstanding.length === 0) return 0;

  let left = input.stake;
  let released = 0;

  for (const bonus of outstanding) {
    if (left <= 0) break;
    const needed = Math.max(bonus.required - bonus.staked, 0);
    const applied = Math.min(needed, left);
    left -= applied;

    const done = bonus.staked + applied >= bonus.required;
    await prisma.bonus.updateMany({
      where: { id: bonus.id, status: 'ACTIVE' },
      data: {
        staked: { increment: applied },
        ...(done ? { status: 'RELEASED', releasedAt: new Date() } : {}),
      },
    });
    if (done) released += 1;
  }

  if (released > 0) log.auth.info({ userId: input.userId, released }, 'bonus turnover met');
  return released;
}

/* -------------------------------------------------------------------------- */
/* What can be withdrawn                                                      */
/* -------------------------------------------------------------------------- */

export interface BonusHold {
  /** Cents of credited bonus not yet released. */
  locked: number;
  /** Cents of stake still needed to release all of it. */
  remaining: number;
  /** 0–100 across every outstanding bonus. */
  percent: number;
  bonuses: {
    id: string;
    source: string;
    amount: number;
    required: number;
    staked: number;
    percent: number;
    createdAt: Date;
  }[];
}

/** Everything a trader is holding that is not yet theirs to withdraw. */
export async function holdFor(userId: string): Promise<BonusHold> {
  if (!bonusesEnabled()) return { locked: 0, remaining: 0, percent: 100, bonuses: [] };

  const rows = await prisma.bonus.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  const locked = rows.reduce((total, bonus) => total + bonus.amount, 0);
  const required = rows.reduce((total, bonus) => total + bonus.required, 0);
  const staked = rows.reduce((total, bonus) => total + Math.min(bonus.staked, bonus.required), 0);

  return {
    locked,
    remaining: Math.max(required - staked, 0),
    percent: required === 0 ? 100 : Math.round((staked / required) * 100),
    bonuses: rows.map((bonus) => ({
      id: bonus.id,
      source: bonus.source,
      amount: bonus.amount,
      required: bonus.required,
      staked: Math.min(bonus.staked, bonus.required),
      percent: bonus.required === 0 ? 100 : Math.round((bonus.staked / bonus.required) * 100),
      createdAt: bonus.createdAt,
    })),
  };
}

/**
 * Forfeits every outstanding bonus.
 *
 * Used when a trader withdraws while a bonus is still locked and chooses to
 * give it up. The money is *not* clawed back here — the caller decides that,
 * through the ledger, in the same transaction.
 */
export async function forfeitAll(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const rows = await tx.bonus.findMany({ where: { userId, status: 'ACTIVE' } });
  const total = rows.reduce((sum, bonus) => sum + bonus.amount, 0);
  if (rows.length === 0) return 0;
  await tx.bonus.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'FORFEITED', releasedAt: new Date() },
  });
  return total;
}
