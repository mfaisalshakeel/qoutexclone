import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';
import { settleTrade } from '../services/trading.js';
import { log } from '../lib/logger.js';
import { finishDueTournaments } from '../services/tournaments.js';
import { sweepOrders } from '../services/orders.js';

/**
 * Sweeps expired positions on a short interval. Settlement is idempotent
 * (see `settleTrade`), so overlapping passes or a restart mid-flight are safe.
 */
const TOURNAMENT_SWEEP_MS = 10000;

export class SettlementEngine {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastTournamentSweep = 0;
  private lastTickAt: number | null = null;
  private lastTickMs = 0;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), env.settlementIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops the loop and waits for a pass that is already running to finish. */
  async drain(timeoutMs = 5000): Promise<void> {
    this.stop();
    const deadline = Date.now() + timeoutMs;
    while (this.busy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.busy) log.settlement.warn('drain timed out while a pass was still running');
  }

  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    const startedAt = Date.now();
    try {
      const due = await prisma.trade.findMany({
        where: { status: 'OPEN', expiresAt: { lte: new Date() } },
        select: { id: true },
        take: 200,
      });
      // Settling one at a time was the real bottleneck a k6 run at 1,000
      // concurrent traders found: at that scale, trades expire faster than a
      // sequential loop can clear them, so unsettled positions pile up and
      // trip the per-account open-position cap even though nothing is
      // actually broken. Each trade's `settleTrade` is its own independent,
      // idempotent transaction (see the module doc and
      // `__tests__/integration/scale.test.ts`'s concurrent-settlement
      // coverage), so there is nothing gained by waiting for one before
      // starting the next — different accounts' settlements only ever
      // contend with each other at the database's own row-lock level, which
      // now resolves correctly under contention (see `applyLedger`).
      // allSettled, not all: one trade's settlement failing (a residual write
      // conflict that outlasted its own retries, say) must not cost the rest
      // of the pass — every other trade in `due` is an independent
      // transaction and nothing here depends on this one succeeding first.
      const outcomes = await Promise.allSettled(due.map((trade) => settleTrade(trade.id)));
      let settled = 0;
      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled' && outcome.value) settled += 1;
        else if (outcome.status === 'rejected')
          log.settlement.error({ err: outcome.reason }, 'trade settlement failed');
      }

      // pending orders ride the same loop: both read the feed and both claim a
      // row before acting, so a restart mid-pass is safe either way
      await sweepOrders();

      // tournaments open and close on their own clock
      const now = Date.now();
      if (now - this.lastTournamentSweep > TOURNAMENT_SWEEP_MS) {
        this.lastTournamentSweep = now;
        await finishDueTournaments();
      }
      return settled;
    } catch (err) {
      log.settlement.error({ err }, 'settlement pass failed');
      return 0;
    } finally {
      this.busy = false;
      this.lastTickAt = startedAt;
      this.lastTickMs = Date.now() - startedAt;
    }
  }

  /**
   * How far behind the sweeper is right now, for the admin dashboard: the
   * oldest position still open past its expiry, in milliseconds. 0 means
   * fully caught up. A real lag here (rather than the loop just not having
   * ticked yet) means settlement itself cannot keep pace with expiries.
   */
  async health(): Promise<{ lastTickAt: number | null; lastTickMs: number; lagMs: number }> {
    const oldest = await prisma.trade.findFirst({
      where: { status: 'OPEN', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      select: { expiresAt: true },
    });
    return {
      lastTickAt: this.lastTickAt,
      lastTickMs: this.lastTickMs,
      lagMs: oldest ? Date.now() - oldest.expiresAt.getTime() : 0,
    };
  }
}

export const settlementEngine = new SettlementEngine();
