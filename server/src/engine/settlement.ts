import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';
import { settleTrade } from '../services/trading.js';
import { finishDueTournaments } from '../services/tournaments.js';

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

      // tournaments open and close on their own clock
      const now = Date.now();
      if (now - this.lastTournamentSweep > TOURNAMENT_SWEEP_MS) {
        this.lastTournamentSweep = now;
        await finishDueTournaments();
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
