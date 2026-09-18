import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { settings } from './settings.js';
import { rank, type LeaderboardInput, type LeaderboardRow } from '../engine/leaderboard.js';

/**
 * Today's top traders, by profit on settled live positions.
 *
 * Live money only: a practice account starts with a million and would otherwise
 * top the board every day, which would make the whole thing meaningless.
 * Tournament chips are excluded for the same reason — a tournament has its own
 * leaderboard.
 *
 * A trader who has opted out is not merely hidden from the rendered rows: they
 * are excluded before ranking, so their figures never leave the database.
 */

const REFRESH_MS = 30_000;

class LeaderboardService {
  private entries: LeaderboardInput[] = [];
  private updatedAt = 0;
  private timer: NodeJS.Timeout | null = null;

  /** Midnight UTC, so "today" means the same thing for everyone reading it. */
  private since(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  async refresh(): Promise<void> {
    if (!settings.get('trading.leaderboardEnabled')) {
      this.entries = [];
      return;
    }

    try {
      const grouped = await prisma.trade.groupBy({
        by: ['userId'],
        where: {
          accountType: 'REAL',
          status: { in: ['WON', 'LOST', 'REFUNDED'] },
          settledAt: { gte: this.since() },
        },
        _sum: { profit: true },
        _count: { _all: true },
      });
      if (grouped.length === 0) {
        this.entries = [];
        this.updatedAt = Date.now();
        return;
      }

      const wins = await prisma.trade.groupBy({
        by: ['userId'],
        where: {
          accountType: 'REAL',
          status: 'WON',
          settledAt: { gte: this.since() },
        },
        _count: { _all: true },
      });
      const winsByUser = new Map(wins.map((row) => [row.userId, row._count._all]));

      // opted-out traders are filtered here, before anything is ranked, so
      // their numbers never reach the rendered board at all
      const users = await prisma.user.findMany({
        where: { id: { in: grouped.map((row) => row.userId) }, leaderboardOptOut: false },
        select: { id: true, name: true, country: true },
      });
      const byId = new Map(users.map((user) => [user.id, user]));

      this.entries = grouped
        .filter((row) => byId.has(row.userId))
        .map((row) => {
          const user = byId.get(row.userId)!;
          return {
            userId: row.userId,
            name: user.name,
            country: user.country,
            profit: row._sum.profit ?? 0,
            trades: row._count._all,
            wins: winsByUser.get(row.userId) ?? 0,
          };
        });
      this.updatedAt = Date.now();
    } catch (err) {
      log.feed.error({ err }, 'could not refresh the leaderboard');
    }
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  board(options: { viewerId?: string; limit?: number } = {}): {
    rows: LeaderboardRow[];
    updatedAt: number;
    traders: number;
  } {
    return {
      rows: rank(this.entries, options),
      updatedAt: this.updatedAt,
      traders: this.entries.length,
    };
  }

  /** Test seam. */
  _set(entries: LeaderboardInput[]): void {
    this.entries = entries;
    this.updatedAt = Date.now();
  }
}

export const leaderboard = new LeaderboardService();
