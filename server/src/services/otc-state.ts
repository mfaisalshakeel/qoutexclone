import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { fromRow, toRow, type OtcState } from '../engine/otc.js';

/**
 * Persistence for the broker price engine.
 *
 * The engine itself stays pure; this is the only thing that knows the state
 * lives in a table. States are flushed on an interval and on shutdown, so a
 * restart resumes the same price path rather than jumping.
 */
export async function loadStates(symbols: string[]): Promise<OtcState[]> {
  if (symbols.length === 0) return [];
  try {
    const rows = await prisma.otcMarketState.findMany({ where: { symbol: { in: symbols } } });
    return rows.map((row) =>
      fromRow({
        symbol: row.symbol,
        price: row.price,
        anchor: row.anchor,
        variance: row.variance,
        lastShock: row.lastShock,
        regime: row.regime,
        regimeTicks: row.regimeTicks,
        regimeTicksLeft: row.regimeTicksLeft,
        trendDirection: row.trendDirection,
        rng: row.rng,
        ticks: row.ticks,
      }),
    );
  } catch (err) {
    log.feed.error({ err }, 'could not load broker price state; markets will re-seed');
    return [];
  }
}

export async function saveStates(states: OtcState[]): Promise<void> {
  if (states.length === 0) return;
  try {
    // one statement per market, but they are small and this runs every 15s
    await prisma.$transaction(
      states.map((state) => {
        const row = toRow(state);
        return prisma.otcMarketState.upsert({ where: { symbol: row.symbol }, update: row, create: row });
      }),
    );
  } catch (err) {
    log.feed.error({ err }, 'could not persist broker price state');
  }
}

export class StatePersister {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private snapshot: () => OtcState[],
    private intervalMs = 15_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void saveStates(this.snapshot()), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Final flush, awaited during shutdown. */
  async flush(): Promise<void> {
    this.stop();
    await saveStates(this.snapshot());
  }
}
