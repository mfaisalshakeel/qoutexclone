import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import type { Candle } from '../engine/feed.js';
import { TIMEFRAME_LIST, bucketFor, retentionSeconds, timeframeSeconds } from '../engine/timeframes.js';
import { generateHistory } from '../engine/history.js';
import type { OtcParams } from '../engine/otc.js';

/** MySQL/MariaDB error 1213: the server rolled one of two transactions back. */
function isDeadlock(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('1213') || message.toLowerCase().includes('deadlock');
}

/** Rows waiting to be written, keyed so a bucket is only queued once. */
type PendingKey = `${string}|${string}|${number}`;

const FLUSH_MS = 5_000;
const PRUNE_MS = 10 * 60_000;
/** Rows per pruning transaction, and how long a whole pass may run for. */
const PRUNE_CHUNK = 5_000;
const PRUNE_PAUSE_MS = 50;
const PRUNE_BUDGET_MS = 60_000;
const FLUSH_RETRIES = 2;
const MAX_PAGE = 500;

/** The shortest history a freshly charted market gets. */
const SEED_CANDLES = 300;

interface BackfillSpec {
  basePrice: number;
  volatility: number;
  precision: number;
  otcConfig?: Partial<OtcParams> | null;
  /** The market's live price, when the feed is running it. */
  priceNow?: () => number | null;
}

/**
 * Durable candle history.
 *
 * The feed keeps only a short tail in memory; everything else lives here so a
 * restart has real history to draw and the chart can page backwards for as far
 * as retention goes.
 *
 * A market that has never been charted has no stored history, so the first
 * request generates it from the same engine that prices the market — that is
 * what "broker-priced" means — and persists it, after which it is simply the
 * market's history.
 */
export class CandleStore {
  private pending = new Map<PendingKey, { symbol: string; timeframe: string; candle: Candle }>();
  private flushTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private backfilled = new Set<string>();
  private specs = new Map<string, BackfillSpec>();
  private liveSource: (() => { symbol: string; timeframe: string; candle: Candle }[]) | null = null;

  /**
   * Where the currently open buckets come from.
   *
   * A candle is only handed over when it closes, so the bucket open at the
   * moment of a shutdown — or a crash — would otherwise never be written and
   * the chart would come back with a hole in it. Every flush picks the open
   * buckets up as well; the upsert makes writing the same bucket repeatedly
   * free of consequence. 89 markets across 14 timeframes is 1,246 rows every
   * five seconds, measured at 13-47ms for the whole statement — worth paying so
   * that even an unclean stop loses at most one flush.
   */
  setLiveSource(source: () => { symbol: string; timeframe: string; candle: Candle }[]): void {
    this.liveSource = source;
  }

  /** Registers what the store needs to generate history for a market. */
  register(symbol: string, spec: BackfillSpec): void {
    this.specs.set(symbol, spec);
  }

  start(): void {
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS);
      this.flushTimer.unref?.();
    }
    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(() => void this.prune(), PRUNE_MS);
      this.pruneTimer.unref?.();
      void this.prune();
    }
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.flushTimer = null;
    this.pruneTimer = null;
  }

  /** How many rows are waiting to be written — a failed flush leaves its own behind. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** The queued rows, for tests that check what a failed flush put back. */
  pendingRows(): { symbol: string; timeframe: string; candle: Candle }[] {
    return [...this.pending.values()];
  }

  /** Queues a candle. The latest version of a bucket wins. */
  record(symbol: string, timeframe: string, candle: Candle): void {
    this.pending.set(`${symbol}|${timeframe}|${candle.time}`, { symbol, timeframe, candle });
  }

  async flush(): Promise<number> {
    if (this.liveSource) {
      for (const { symbol, timeframe, candle } of this.liveSource()) {
        // a closed bucket already queued stays as it is; this only adds what is
        // still open
        const key: PendingKey = `${symbol}|${timeframe}|${candle.time}`;
        if (!this.pending.has(key)) this.pending.set(key, { symbol, timeframe, candle });
      }
    }
    if (this.pending.size === 0) return 0;
    const batch = [...this.pending.values()];
    this.pending.clear();

    try {
      // one multi-row upsert per flush beats hundreds of round trips
      const values = batch
        .map(
          ({ symbol, timeframe, candle }) =>
            `(${escape(symbol)},${escape(timeframe)},${Math.round(candle.time)},${num(candle.open)},${num(candle.high)},${num(candle.low)},${num(candle.close)})`,
        )
        .join(',');

      const sql = `INSERT INTO \`Candle\` (\`symbol\`,\`timeframe\`,\`time\`,\`open\`,\`high\`,\`low\`,\`close\`) VALUES ${values}
         ON DUPLICATE KEY UPDATE \`open\`=VALUES(\`open\`),\`high\`=VALUES(\`high\`),\`low\`=VALUES(\`low\`),\`close\`=VALUES(\`close\`)`;

      // A deadlock here is the database asking for the write again, not a
      // reason to drop a batch: whatever it lost with the lock is history the
      // chart never gets back.
      for (let attempt = 0; ; attempt++) {
        try {
          await prisma.$executeRawUnsafe(sql);
          return batch.length;
        } catch (err) {
          if (attempt >= FLUSH_RETRIES || !isDeadlock(err)) throw err;
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
    } catch (err) {
      // put the batch back so the next flush tries again, unless a newer
      // version of the same bucket has already been queued
      for (const row of batch) {
        const key: PendingKey = `${row.symbol}|${row.timeframe}|${row.candle.time}`;
        if (!this.pending.has(key)) this.pending.set(key, row);
      }
      log.feed.error({ err, rows: batch.length }, 'could not persist candles, requeued');
      return 0;
    }
  }

  /**
   * Drops candles older than their timeframe's retention, a slice at a time.
   *
   * One `DELETE` for a whole timeframe is a single transaction over every
   * expired row it owns — after an idle weekend that is hundreds of thousands
   * of them. Measured on a real database: 97 seconds of held row locks, 18
   * deadlocks, and every flush in that window lost its batch, so the chart
   * quietly stopped gaining history. Slicing it keeps each transaction short
   * enough that a flush can always get in between two of them.
   */
  async prune(): Promise<number> {
    let removed = 0;
    const now = Math.floor(Date.now() / 1000);
    const deadline = Date.now() + PRUNE_BUDGET_MS;

    for (const spec of TIMEFRAME_LIST) {
      const cutoff = now - retentionSeconds(spec.key);
      try {
        for (;;) {
          const deleted = await prisma.$executeRaw`
            DELETE FROM \`Candle\` WHERE \`timeframe\` = ${spec.key} AND \`time\` < ${cutoff}
            LIMIT ${PRUNE_CHUNK}`;
          removed += deleted;
          if (deleted < PRUNE_CHUNK) break;
          // the backlog outlived its slot; the next pass picks up where this
          // one stopped, rather than holding the table to finish in one go
          if (Date.now() > deadline) {
            log.feed.info({ timeframe: spec.key, removed }, 'pruning paused, resumes next pass');
            return removed;
          }
          // let the flush, and anything else waiting on these rows, through
          await new Promise((resolve) => setTimeout(resolve, PRUNE_PAUSE_MS));
        }
      } catch (err) {
        log.feed.error({ err, timeframe: spec.key }, 'candle pruning failed');
      }
    }
    if (removed > 0) log.feed.info({ removed }, 'pruned expired candles');
    return removed;
  }

  /**
   * The row stored for each market's currently open bucket, per timeframe.
   *
   * The feed adopts these at boot so a restart continues the candle it was in
   * the middle of instead of opening a fresh one over the top of it.
   */
  async openBuckets(symbols: string[]): Promise<{ symbol: string; timeframe: string; candle: Candle }[]> {
    if (symbols.length === 0) return [];
    const now = Date.now();
    const rows: { symbol: string; timeframe: string; candle: Candle }[] = [];

    for (const spec of TIMEFRAME_LIST) {
      const time = bucketFor(now, timeframeSeconds(spec.key) ?? 60);
      const found = await prisma.candle.findMany({
        where: { timeframe: spec.key, time, symbol: { in: symbols } },
        select: { symbol: true, time: true, open: true, high: true, low: true, close: true },
      });
      for (const row of found) {
        rows.push({
          symbol: row.symbol,
          timeframe: spec.key,
          candle: { time: row.time, open: row.open, high: row.high, low: row.low, close: row.close },
        });
      }
    }
    return rows;
  }

  /**
   * History for a chart, newest last. `before` pages backwards for infinite
   * scroll; omit it for the most recent window.
   */
  async history(
    symbol: string,
    timeframe: string,
    options: { before?: number; limit?: number } = {},
  ): Promise<Candle[]> {
    const seconds = timeframeSeconds(timeframe);
    if (!seconds) return [];
    const limit = Math.min(Math.max(options.limit ?? 200, 10), MAX_PAGE);

    await this.ensureBackfill(symbol, timeframe, seconds, limit);

    let rows = await prisma.candle.findMany({
      where: { symbol, timeframe, ...(options.before ? { time: { lt: Math.floor(options.before) } } : {}) },
      orderBy: { time: 'desc' },
      take: limit,
      select: { time: true, open: true, high: true, low: true, close: true },
    });

    // paging past the generated history: extend it rather than hitting a wall
    if (options.before && rows.length < limit) {
      const extended = await this.extendBackwards(symbol, timeframe, seconds, options.before, limit, rows);
      if (extended) rows = extended;
    }

    return rows.reverse();
  }

  /**
   * Generates and stores history for a market that has none.
   *
   * The series is walked from the engine and then pinned so that its newest
   * candle closes on the price the market is trading at right now — an
   * unpinned walk is free to end tens of percent away, which reads as a broken
   * chart rather than a market.
   */
  private async ensureBackfill(
    symbol: string,
    timeframe: string,
    seconds: number,
    limit: number,
  ): Promise<void> {
    const key = `${symbol}|${timeframe}`;
    if (this.backfilled.has(key)) return;

    const existing = await prisma.candle.count({ where: { symbol, timeframe } });
    if (existing >= limit) {
      this.backfilled.add(key);
      return;
    }

    const spec = this.specs.get(symbol);
    if (!spec) {
      this.backfilled.add(key);
      return;
    }

    const live = spec.priceNow?.();
    const endTarget = live && live > 0 ? live : spec.basePrice;
    const candles = generateHistory({
      // a separate seed per timeframe, so one market's series do not correlate
      seedKey: `${symbol}:${timeframe}:history`,
      seconds,
      count: Math.max(limit, SEED_CANDLES),
      endBucket: bucketFor(Date.now(), seconds),
      endTarget,
      volatility: spec.volatility,
      precision: spec.precision,
      otcConfig: spec.otcConfig ?? null,
    });

    for (const candle of candles) this.record(symbol, timeframe, candle);
    await this.flush();
    this.backfilled.add(key);
    log.feed.debug({ symbol, timeframe, candles: candles.length }, 'generated market history');
  }

  /**
   * Generates an older page for a broker-priced market and persists it.
   *
   * The page ends exactly on the open of the oldest candle already stored, so
   * the joint is invisible, and starts within a bounded drift of it that grows
   * with the span the page covers — minutes of history join almost flat, a year
   * of daily candles is allowed a real trend. The seed comes from the cursor,
   * so the same page is produced every time it is asked for.
   *
   * Nothing is generated beyond the timeframe's retention window: that is the
   * honest end of the market's history.
   */
  private async extendBackwards(
    symbol: string,
    timeframe: string,
    seconds: number,
    before: number,
    limit: number,
    existing: Candle[],
  ): Promise<Candle[] | null> {
    const spec = this.specs.get(symbol);
    if (!spec) return null;

    const oldestKnown = existing.length
      ? existing[existing.length - 1]
      : await prisma.candle.findFirst({
          where: { symbol, timeframe },
          orderBy: { time: 'asc' },
          select: { time: true, open: true, high: true, low: true, close: true },
        });
    if (!oldestKnown) return null;

    // The generated block has to end where the *stored* history starts, not at
    // the cursor. Deriving it from `before` overlaps whatever rows came back
    // short, which produced two candles for the same instant.
    const endBucket = existing.length ? oldestKnown.time : Math.floor(before / seconds) * seconds;
    const earliestAllowed = Math.floor(Date.now() / 1000) - retentionSeconds(timeframe);
    const count = Math.min(limit - existing.length, Math.floor((endBucket - earliestAllowed) / seconds));
    if (count <= 0) return null;

    const generated = generateHistory({
      seedKey: `${symbol}:${timeframe}:${endBucket}`,
      seconds,
      count,
      endBucket,
      endTarget: oldestKnown.open,
      volatility: spec.volatility,
      precision: spec.precision,
      otcConfig: spec.otcConfig ?? null,
    });

    for (const candle of generated) this.record(symbol, timeframe, candle);
    await this.flush();

    // newest first, matching the caller's ordering
    return [...existing, ...generated.reverse()];
  }

  /** Test seam. */
  _reset(): void {
    this.pending.clear();
    this.backfilled.clear();
    this.specs.clear();
    this.liveSource = null;
  }
}

function escape(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

export const candleStore = new CandleStore();
