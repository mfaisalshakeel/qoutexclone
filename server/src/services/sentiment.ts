import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { settings } from './settings.js';
import { EMPTY_SENTIMENT, sentimentFrom, type Sentiment } from '../engine/sentiment.js';

/**
 * Trader sentiment per market, from the platform's own positions.
 *
 * Read by every open terminal, so it is computed once on an interval from a
 * single grouped query and served from memory rather than queried per request.
 *
 * Tournament positions are left out: chips are a game with its own incentives,
 * and mixing them into "what traders are doing with their money" would be
 * misleading. Practice positions are counted — a practice trader is still a
 * trader making a real choice about direction.
 */

const REFRESH_MS = 10_000;

class SentimentService {
  private snapshot = new Map<string, Sentiment>();
  private timer: NodeJS.Timeout | null = null;

  async refresh(): Promise<void> {
    if (!settings.get('trading.sentimentEnabled')) {
      this.snapshot.clear();
      return;
    }

    const windowMin = settings.get('trading.sentimentWindowMin');
    const minTrades = settings.get('trading.sentimentMinTrades');
    const since = new Date(Date.now() - windowMin * 60_000);

    try {
      const rows = await prisma.trade.groupBy({
        by: ['symbol', 'direction'],
        where: { openedAt: { gte: since }, accountType: { in: ['DEMO', 'REAL'] } },
        _sum: { stake: true },
        _count: { _all: true },
      });

      const totals = new Map<
        string,
        { upStake: number; downStake: number; upCount: number; downCount: number }
      >();
      for (const row of rows) {
        const entry = totals.get(row.symbol) ?? { upStake: 0, downStake: 0, upCount: 0, downCount: 0 };
        if (row.direction === 'UP') {
          entry.upStake += row._sum.stake ?? 0;
          entry.upCount += row._count._all;
        } else {
          entry.downStake += row._sum.stake ?? 0;
          entry.downCount += row._count._all;
        }
        totals.set(row.symbol, entry);
      }

      const next = new Map<string, Sentiment>();
      for (const [symbol, entry] of totals) next.set(symbol, sentimentFrom(entry, minTrades));
      this.snapshot = next;
    } catch (err) {
      // a failed refresh keeps the previous snapshot: stale sentiment is better
      // than a terminal with an empty bar for no visible reason
      log.feed.error({ err }, 'could not refresh trader sentiment');
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

  /** The split for one market; empty when there is nothing to say. */
  for(symbol: string): Sentiment {
    return this.snapshot.get(symbol) ?? EMPTY_SENTIMENT;
  }

  /** Every market with something to say, for the realtime channel. */
  all(): Record<string, Sentiment> {
    const out: Record<string, Sentiment> = {};
    for (const [symbol, sentiment] of this.snapshot) {
      if (sentiment.trades > 0) out[symbol] = sentiment;
    }
    return out;
  }

  /** Test seam. */
  _set(symbol: string, sentiment: Sentiment): void {
    this.snapshot.set(symbol, sentiment);
  }
}

export const sentiment = new SentimentService();
