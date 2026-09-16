import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';
import { settleTrade } from '../services/trading.js';

/**
 * Sweeps expired positions on a short interval. Settlement is idempotent
 * (see `settleTrade`), so overlapping passes or a restart mid-flight are safe.
 */
export class SettlementEngine {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), env.settlementIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
      return settled;
    } catch (err) {
      console.error('[settlement] pass failed:', err);
      return 0;
    } finally {
      this.busy = false;
    }
  }
}

export const settlementEngine = new SettlementEngine();
