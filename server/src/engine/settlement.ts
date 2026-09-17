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
    try {
      const due = await prisma.trade.findMany({
        where: { status: 'OPEN', expiresAt: { lte: new Date() } },
        select: { id: true },
        take: 200,
      });
      let settled = 0;
      for (const trade of due) {
        const result = await settleTrade(trade.id);
        if (result) settled += 1;
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
    }
  }
}

export const settlementEngine = new SettlementEngine();
