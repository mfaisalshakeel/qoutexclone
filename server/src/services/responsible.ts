import { Prisma, type ResponsibleLimits } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { settings } from './settings.js';

/**
 * Limits a trader sets on themselves.
 *
 * All of it is enforced on the server. A limit that only exists in the browser
 * is a suggestion, and the person it is meant to protect is exactly the person
 * who will find the way around it.
 *
 * Tightening a limit applies immediately. Loosening one waits out a
 * cooling-off period, because the moment someone wants their limit raised is
 * the moment it is doing its job.
 */

export const LIMIT_FIELDS = ['dailyLossCents', 'dailyDepositCents', 'sessionReminderMin'] as const;
export type LimitField = (typeof LIMIT_FIELDS)[number];

export const limitsSchema = z.object({
  dailyLossCents: z.number().int().min(0).max(100_000_000).optional(),
  dailyDepositCents: z.number().int().min(0).max(100_000_000).optional(),
  sessionReminderMin: z.number().int().min(0).max(1440).optional(),
});

export type LimitsInput = z.infer<typeof limitsSchema>;

export interface EffectiveLimits {
  dailyLossCents: number;
  dailyDepositCents: number;
  sessionReminderMin: number;
  excludedUntil: Date | null;
  /** A loosening still waiting, and when it lands. */
  pending: LimitsInput | null;
  pendingAt: Date | null;
  coolingOffHours: number;
}

const NONE: EffectiveLimits = {
  dailyLossCents: 0,
  dailyDepositCents: 0,
  sessionReminderMin: 0,
  excludedUntil: null,
  pending: null,
  pendingAt: null,
  coolingOffHours: 0,
};

function coolingOffHours(): number {
  return settings.get('compliance.limitCoolingOffHours');
}

/**
 * A stricter value is a *lower* number, except that 0 means "no limit", which
 * is the loosest setting there is.
 */
export function isTightening(field: LimitField, current: number, next: number): boolean {
  if (next === 0) return false;
  if (current === 0) return true;
  return next < current;
}

/** Promotes a pending loosening whose cooling-off period has passed. */
async function settle(row: ResponsibleLimits): Promise<ResponsibleLimits> {
  if (!row.pending || !row.pendingAt || row.pendingAt > new Date()) return row;
  const parsed = limitsSchema.safeParse(row.pending);
  if (!parsed.success) {
    return prisma.responsibleLimits.update({
      where: { id: row.id },
      // Prisma reads `undefined` as "leave it alone"; clearing a JSON column
      // is DbNull, and getting this wrong silently keeps the old value
      data: { pending: Prisma.DbNull, pendingAt: null },
    });
  }
  log.auth.info({ userId: row.userId }, 'responsible limits cooling-off elapsed');
  return prisma.responsibleLimits.update({
    where: { id: row.id },
    data: { ...parsed.data, pending: Prisma.DbNull, pendingAt: null },
  });
}

export async function limitsFor(userId: string): Promise<EffectiveLimits> {
  const row = await prisma.responsibleLimits.findUnique({ where: { userId } });
  if (!row) return { ...NONE, coolingOffHours: coolingOffHours() };

  const current = await settle(row);
  const pending = current.pending ? limitsSchema.safeParse(current.pending) : null;

  return {
    dailyLossCents: current.dailyLossCents,
    dailyDepositCents: current.dailyDepositCents,
    sessionReminderMin: current.sessionReminderMin,
    excludedUntil: current.excludedUntil && current.excludedUntil > new Date() ? current.excludedUntil : null,
    pending: pending?.success ? pending.data : null,
    pendingAt: current.pendingAt,
    coolingOffHours: coolingOffHours(),
  };
}

/**
 * Applies a change.
 *
 * Every field is compared on its own: tightening the loss limit while
 * loosening the deposit limit does both, one now and one later.
 */
export async function setLimits(userId: string, input: LimitsInput): Promise<EffectiveLimits> {
  const existing = await prisma.responsibleLimits.findUnique({ where: { userId } });
  const current = existing ? await settle(existing) : null;

  const now: Partial<Record<LimitField, number>> = {};
  const later: Partial<Record<LimitField, number>> = {};

  for (const field of LIMIT_FIELDS) {
    const next = input[field];
    if (next === undefined) continue;
    const before = current?.[field] ?? 0;
    if (next === before) continue;
    // the session reminder is a nudge, not a guard: it applies at once either way
    if (field === 'sessionReminderMin' || isTightening(field, before, next)) now[field] = next;
    else later[field] = next;
  }

  const pending = { ...(current?.pending as LimitsInput | null | undefined), ...later };
  const hasPending = Object.keys(later).length > 0 || (current?.pending != null && current.pendingAt != null);

  const data = {
    ...now,
    pending: hasPending ? (pending as object) : Prisma.DbNull,
    pendingAt:
      Object.keys(later).length > 0
        ? new Date(Date.now() + coolingOffHours() * 3_600_000)
        : (current?.pendingAt ?? null),
  };

  await prisma.responsibleLimits.upsert({
    where: { userId },
    create: { userId, ...now, ...(Object.keys(later).length > 0 ? data : {}) },
    update: data,
  });

  return limitsFor(userId);
}

/** Cancels a loosening that has not landed yet. Always allowed, always now. */
export async function cancelPending(userId: string): Promise<EffectiveLimits> {
  await prisma.responsibleLimits.updateMany({
    where: { userId },
    data: { pending: Prisma.DbNull, pendingAt: null },
  });
  return limitsFor(userId);
}

/* -------------------------------------------------------------------------- */
/* Self-exclusion                                                             */
/* -------------------------------------------------------------------------- */

export const EXCLUSION_DAYS = [1, 7, 30, 90, 180, 365] as const;

/**
 * Shuts the account for a period.
 *
 * It cannot be shortened or cancelled — that is the entire point — and it is
 * only ever extended. Withdrawals stay open throughout: locking someone out of
 * their own money is not responsible gambling, it is a hostage.
 */
export async function selfExclude(userId: string, days: number): Promise<EffectiveLimits> {
  if (!EXCLUSION_DAYS.includes(days as (typeof EXCLUSION_DAYS)[number])) {
    throw badRequest('Choose one of the offered periods', 'bad_period');
  }
  const until = new Date(Date.now() + days * 86_400_000);
  const existing = await prisma.responsibleLimits.findUnique({ where: { userId } });
  const current = existing?.excludedUntil;
  const excludedUntil = current && current > until ? current : until;

  await prisma.responsibleLimits.upsert({
    where: { userId },
    create: { userId, excludedUntil },
    update: { excludedUntil },
  });
  log.auth.info({ userId, until: excludedUntil }, 'self-exclusion set');
  return limitsFor(userId);
}

/** When the account is shut until, or null. Withdrawals ignore this. */
export async function excludedUntil(userId: string): Promise<Date | null> {
  const row = await prisma.responsibleLimits.findUnique({
    where: { userId },
    select: { excludedUntil: true },
  });
  return row?.excludedUntil && row.excludedUntil > new Date() ? row.excludedUntil : null;
}

/** Throws if the account is shut. Callers that move money out must not use it. */
export async function assertNotExcluded(userId: string): Promise<void> {
  const row = await prisma.responsibleLimits.findUnique({
    where: { userId },
    select: { excludedUntil: true },
  });
  if (row?.excludedUntil && row.excludedUntil > new Date()) {
    throw forbidden(
      `You asked us to close your account until ${row.excludedUntil.toUTCString()}. Withdrawals are still open.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* The limits themselves                                                      */
/* -------------------------------------------------------------------------- */

function startOfDay(at = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export interface DayUsage {
  /** Net loss today on live money, in cents. Never negative. */
  lossCents: number;
  /** Deposited today, in cents. */
  depositCents: number;
}

export async function usageToday(userId: string, at = new Date()): Promise<DayUsage> {
  const since = startOfDay(at);
  const [trades, deposits] = await Promise.all([
    prisma.trade.aggregate({
      where: {
        userId,
        accountType: 'REAL',
        status: { in: ['WON', 'LOST', 'REFUNDED'] },
        settledAt: { gte: since },
      },
      _sum: { profit: true },
    }),
    prisma.deposit.aggregate({
      where: { userId, status: 'COMPLETED', confirmedAt: { gte: since } },
      _sum: { creditedAmount: true },
    }),
  ]);

  return {
    lossCents: Math.max(-(trades._sum.profit ?? 0), 0),
    depositCents: deposits._sum.creditedAmount ?? 0,
  };
}

/**
 * Refuses a new position once the day's losses have reached the limit.
 *
 * Only new stakes are refused. An open position still settles, and a trader
 * who has hit their limit can still withdraw — this closes the door on making
 * things worse, not on the account.
 */
export async function assertCanStake(userId: string, accountType: string): Promise<void> {
  if (accountType !== 'REAL') return;
  const limits = await limitsFor(userId);
  if (limits.excludedUntil) await assertNotExcluded(userId);
  if (limits.dailyLossCents <= 0) return;

  const usage = await usageToday(userId);
  if (usage.lossCents >= limits.dailyLossCents) {
    throw forbidden(
      `You have reached the daily loss limit you set ($${(limits.dailyLossCents / 100).toFixed(2)}). It resets at midnight UTC.`,
    );
  }
}

/** Refuses a deposit that would take the day past the trader's own limit. */
export async function assertCanDeposit(userId: string, amountCents: number): Promise<void> {
  const limits = await limitsFor(userId);
  if (limits.excludedUntil) await assertNotExcluded(userId);
  if (limits.dailyDepositCents <= 0) return;

  const usage = await usageToday(userId);
  if (usage.depositCents + amountCents > limits.dailyDepositCents) {
    const left = Math.max(limits.dailyDepositCents - usage.depositCents, 0);
    throw forbidden(
      left === 0
        ? 'You have reached the daily deposit limit you set. It resets at midnight UTC.'
        : `That would pass the daily deposit limit you set. You can deposit $${(left / 100).toFixed(2)} more today.`,
    );
  }
}
