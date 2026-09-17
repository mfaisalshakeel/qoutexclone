import { EventEmitter } from 'node:events';
import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { alwaysOpen, describeWindows, sessionState, type SessionState, type Window } from '../lib/sessions.js';

export const scheduleEvents = new EventEmitter();

interface CachedSchedule {
  id: string;
  key: string;
  name: string;
  windows: Window[];
  holidays: Set<string>;
}

/**
 * Opening hours for every market, cached in memory.
 *
 * Schedules change rarely (an operator edit, a new holiday) but are read on
 * every quote and every trade, so they are cached and invalidated explicitly.
 */
class MarketHours {
  private schedules = new Map<string, CachedSchedule>();
  private loaded = false;

  async load(): Promise<void> {
    try {
      const rows = await prisma.tradingSchedule.findMany({ include: { windows: true, holidays: true } });
      this.schedules = new Map(
        rows.map((row) => [
          row.id,
          {
            id: row.id,
            key: row.key,
            name: row.name,
            windows: row.windows.map((window) => ({
              dayOfWeek: window.dayOfWeek,
              openMinute: window.openMinute,
              closeMinute: window.closeMinute,
            })),
            holidays: new Set(row.holidays.map((holiday) => holiday.date)),
          },
        ]),
      );
      this.loaded = true;
      log.boot.info({ schedules: this.schedules.size }, 'trading schedules loaded');
    } catch (err) {
      log.boot.error({ err }, 'could not load trading schedules; markets will be treated as always open');
    }
  }

  async reload(): Promise<void> {
    await this.load();
    scheduleEvents.emit('reloaded');
  }

  /** OTC and crypto have no schedule, so they are always open. */
  stateFor(scheduleId: string | null | undefined, at: Date = new Date()): SessionState {
    if (!scheduleId) return alwaysOpen();
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return alwaysOpen();
    return sessionState(schedule.windows, schedule.holidays, at);
  }

  describe(scheduleId: string | null | undefined): { key: string; name: string; hours: string } | null {
    if (!scheduleId) return null;
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return null;
    return { key: schedule.key, name: schedule.name, hours: describeWindows(schedule.windows) };
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  _clear(): void {
    this.schedules.clear();
    this.loaded = false;
  }
}

export const marketHours = new MarketHours();

/**
 * The OTC twin of a closed market, so the UI can offer it. OTC symbols are the
 * spot symbol plus `_OTC` by construction (see data/markets.ts).
 */
export async function otcAlternative(symbol: string): Promise<string | null> {
  if (symbol.endsWith('_OTC')) return null;
  const twin = await prisma.asset.findUnique({ where: { symbol: `${symbol}_OTC` }, select: { symbol: true, enabled: true } });
  return twin?.enabled ? twin.symbol : null;
}
