/**
 * Weekly opening-hours maths, kept pure so it can be reasoned about and tested
 * without a database. Everything is UTC: exchanges are stored in UTC windows
 * and the client renders them in the trader's timezone.
 */

export interface Window {
  dayOfWeek: number; // 0 = Sunday
  openMinute: number; // 0-1439
  closeMinute: number; // 1-2880, may run past midnight into the next day
}

/** Half-open range of minutes from Sunday 00:00 UTC. */
export interface WeekRange {
  start: number;
  end: number;
}

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;

/**
 * Normalises windows into sorted, merged week ranges. A window running past
 * midnight is split, and one crossing Saturday into Sunday wraps to the start
 * of the week so a continuous market (forex) has no artificial gap.
 */
export function weekRanges(windows: Window[]): WeekRange[] {
  const ranges: WeekRange[] = [];

  for (const window of windows) {
    if (window.closeMinute <= window.openMinute) continue; // empty or invalid
    const start = window.dayOfWeek * MINUTES_PER_DAY + window.openMinute;
    const end = window.dayOfWeek * MINUTES_PER_DAY + window.closeMinute;

    if (end <= MINUTES_PER_WEEK) {
      ranges.push({ start, end });
    } else {
      ranges.push({ start, end: MINUTES_PER_WEEK });
      ranges.push({ start: 0, end: end - MINUTES_PER_WEEK });
    }
  }

  ranges.sort((a, b) => a.start - b.start);

  const merged: WeekRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Minutes elapsed since Sunday 00:00 UTC. */
export function weekMinute(at: Date): number {
  return at.getUTCDay() * MINUTES_PER_DAY + at.getUTCHours() * 60 + at.getUTCMinutes();
}

export function utcDateKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface SessionState {
  isOpen: boolean;
  /** When the market next opens; null when it is already open. */
  nextOpen: Date | null;
  /** When the current session ends; null when the market is closed or 24/7. */
  nextClose: Date | null;
  /** Set when a holiday is the reason it is shut. */
  holiday?: string;
}

/** A market with no windows trades around the clock (OTC, crypto). */
export function alwaysOpen(): SessionState {
  return { isOpen: true, nextOpen: null, nextClose: null };
}

function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

/**
 * Resolves whether a market is open at `at`, and when it next opens or closes.
 * Holidays are whole UTC days and beat the weekly windows.
 *
 * The search walks forward a fortnight at most, which is enough to clear any
 * realistic run of consecutive holidays while staying bounded.
 */
export function sessionState(windows: Window[], holidays: Set<string>, at: Date = new Date()): SessionState {
  const ranges = weekRanges(windows);
  if (ranges.length === 0) return alwaysOpen();

  const minute = weekMinute(at);
  const today = utcDateKey(at);
  const onHoliday = holidays.has(today);

  const current = ranges.find((range) => minute >= range.start && minute < range.end);
  if (current && !onHoliday) {
    // the end of the current window, expressed as a real timestamp
    const weekStart = addMinutes(startOfUtcDay(at), -(at.getUTCDay() * MINUTES_PER_DAY));
    return { isOpen: true, nextOpen: null, nextClose: addMinutes(weekStart, current.end) };
  }

  // walk the windows forward until one starts on a day that is not a holiday
  const weekStart = addMinutes(startOfUtcDay(at), -(at.getUTCDay() * MINUTES_PER_DAY));
  for (let week = 0; week < 2; week += 1) {
    for (const range of ranges) {
      const candidate = addMinutes(weekStart, range.start + week * MINUTES_PER_WEEK);
      if (candidate <= at) continue;
      if (holidays.has(utcDateKey(candidate))) continue;
      return {
        isOpen: false,
        nextOpen: candidate,
        nextClose: null,
        ...(onHoliday ? { holiday: today } : {}),
      };
    }
  }

  return { isOpen: false, nextOpen: null, nextClose: null, ...(onHoliday ? { holiday: today } : {}) };
}

/** Human summary of a schedule, e.g. "Mon–Fri 13:30–20:00 UTC". */
export function describeWindows(windows: Window[]): string {
  if (windows.length === 0) return 'Open 24/7';

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = (minutes: number) => {
    const normalised = minutes % MINUTES_PER_DAY;
    const hours = Math.floor(normalised / 60);
    return `${String(hours).padStart(2, '0')}:${String(normalised % 60).padStart(2, '0')}`;
  };

  // group days that share the same hours, which is the common case
  const byHours = new Map<string, number[]>();
  for (const window of windows) {
    const key = `${fmt(window.openMinute)}-${fmt(window.closeMinute)}`;
    byHours.set(key, [...(byHours.get(key) ?? []), window.dayOfWeek]);
  }

  return [...byHours.entries()]
    .map(([hours, days]) => {
      const sorted = [...days].sort((a, b) => a - b);
      const contiguous = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
      const label =
        sorted.length > 2 && contiguous
          ? `${DAYS[sorted[0]]}–${DAYS[sorted[sorted.length - 1]]}`
          : sorted.map((day) => DAYS[day]).join(', ');
      return `${label} ${hours.replace('-', '–')} UTC`;
    })
    .join(', ');
}
