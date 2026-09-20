import type { Trade } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { tradeEvents } from './trading.js';
import { notify } from './notifications.js';
import { evaluate, unlockedKeys, type AchievementProgress, type AchievementStats } from './achievements.js';
import { dayKey, levelProgress, xpConfig, xpForTrade, type LevelProgress } from './experience.js';

/**
 * Where XP is earned and badges are handed out.
 *
 * The hot path — a position settling — does one cheap update. Working out
 * which achievements a trader has earned takes several aggregates, so it runs
 * after a settle but no more often than once every half minute per trader: a
 * badge arriving a few seconds late costs nothing, and a trader closing
 * positions every five seconds would otherwise re-count their whole history
 * every five seconds.
 */

const EVALUATE_EVERY_MS = 30_000;
const lastEvaluated = new Map<string, number>();

/** The longest win streak is read from this many recent settled positions. */
const STREAK_WINDOW = 500;

let listening = false;

/** Adds what a settled position earned, and pays the daily bonus once. */
export async function awardTradeXp(trade: Trade): Promise<number> {
  const config = xpConfig();
  if (!config.enabled) return 0;

  const user = await prisma.user.findUnique({
    where: { id: trade.userId },
    select: { xpLastDay: true },
  });
  if (!user) return 0;

  const today = dayKey(trade.settledAt ?? new Date());
  const firstToday = user.xpLastDay !== today;
  const earned = xpForTrade(trade, config, { firstToday });
  if (earned <= 0) return 0;

  await prisma.user.update({
    where: { id: trade.userId },
    data: { xp: { increment: earned }, ...(firstToday ? { xpLastDay: today } : {}) },
  });
  return earned;
}

/** Everything the achievements are measured against, for one trader. */
export async function statsFor(userId: string): Promise<AchievementStats> {
  const [user, settled, markets, tournaments, recent] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { totalDeposited: true, emailVerifiedAt: true, twoFactorEnabledAt: true },
    }),
    prisma.trade.aggregate({
      where: { userId, status: { in: ['WON', 'LOST', 'REFUNDED'] } },
      _count: { _all: true },
      _sum: { stake: true, profit: true },
    }),
    prisma.trade.findMany({
      where: { userId, status: { in: ['WON', 'LOST', 'REFUNDED'] } },
      distinct: ['symbol'],
      select: { symbol: true },
    }),
    prisma.tournamentEntry.count({ where: { userId } }),
    prisma.trade.findMany({
      where: { userId, status: { in: ['WON', 'LOST'] } },
      orderBy: { settledAt: 'desc' },
      take: STREAK_WINDOW,
      select: { status: true },
    }),
  ]);

  const wins = await prisma.trade.count({ where: { userId, status: 'WON' } });

  let bestStreak = 0;
  let running = 0;
  for (const trade of recent) {
    if (trade.status === 'WON') {
      running += 1;
      bestStreak = Math.max(bestStreak, running);
    } else {
      running = 0;
    }
  }

  return {
    trades: settled._count._all,
    wins,
    volume: settled._sum.stake ?? 0,
    bestStreak,
    netProfit: settled._sum.profit ?? 0,
    totalDeposited: user?.totalDeposited ?? 0,
    tournaments,
    markets: markets.length,
    emailVerified: user?.emailVerifiedAt != null,
    twoFactor: user?.twoFactorEnabledAt != null,
  };
}

/**
 * Writes any newly earned badges and tells the trader about them.
 *
 * Each key is inserted on its own against the unique index, and only the
 * insert that actually created a row counts as newly earned. Reading first and
 * inserting the difference would let two callers racing both claim the same
 * badge — the row would still be single, but the trader would be told twice.
 */
export async function syncAchievements(userId: string, stats?: AchievementStats): Promise<string[]> {
  const measured = stats ?? (await statsFor(userId));
  const earned = unlockedKeys(measured);
  if (earned.length === 0) return [];

  const held = await prisma.achievement.findMany({
    where: { userId, key: { in: earned } },
    select: { key: true },
  });
  const seen = new Set(held.map((row) => row.key));
  const candidates = earned.filter((key) => !seen.has(key));
  if (candidates.length === 0) return [];

  const fresh: string[] = [];
  for (const key of candidates) {
    const written = await prisma.achievement.createMany({
      data: [{ userId, key }],
      skipDuplicates: true,
    });
    if (written.count === 1) fresh.push(key);
  }
  if (fresh.length === 0) return [];

  const byKey = new Map(evaluate(measured).map((achievement) => [achievement.key, achievement]));
  for (const key of fresh) {
    const achievement = byKey.get(key);
    if (!achievement) continue;
    await notify(userId, {
      kind: 'SYSTEM',
      title: `Achievement unlocked: ${achievement.name}`,
      body: achievement.description,
      href: '/account/progress',
      key: `achievement:${key}`,
    });
  }
  return fresh;
}

export interface Progression {
  enabled: boolean;
  progress: LevelProgress;
  achievements: (AchievementProgress & { unlockedAt: string | null })[];
}

/** The progress page's whole payload. */
export async function progressionFor(userId: string): Promise<Progression> {
  const config = xpConfig();
  const [user, stats] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { xp: true } }),
    statsFor(userId),
  ]);

  // reading the page is also a chance to catch up on anything earned since the
  // last settle, which is what makes a badge for confirming an email possible
  await syncAchievements(userId, stats).catch((err) =>
    log.notify.error({ err, userId }, 'could not sync achievements'),
  );

  const held = await prisma.achievement.findMany({ where: { userId } });
  const unlockedAt = new Map(held.map((row) => [row.key, row.unlockedAt.toISOString()]));

  return {
    enabled: config.enabled,
    progress: levelProgress(user?.xp ?? 0, config),
    achievements: evaluate(stats).map((achievement) => ({
      ...achievement,
      unlockedAt: unlockedAt.get(achievement.key) ?? null,
    })),
  };
}

export function attachProgression(): void {
  if (listening) return;
  listening = true;

  tradeEvents.on('settled', ({ trade }: { trade: Trade }) => {
    void (async () => {
      try {
        await awardTradeXp(trade);

        const last = lastEvaluated.get(trade.userId) ?? 0;
        if (Date.now() - last < EVALUATE_EVERY_MS) return;
        lastEvaluated.set(trade.userId, Date.now());
        await syncAchievements(trade.userId);
      } catch (err) {
        log.notify.error({ err, tradeId: trade.id }, 'could not award experience');
      }
    })();
  });
}

/** Test seam: the debounce is process-wide. */
export function resetProgression(): void {
  lastEvaluated.clear();
  listening = false;
}
