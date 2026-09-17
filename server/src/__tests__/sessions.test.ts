import { describe, expect, it } from 'vitest';
import { describeWindows, sessionState, weekMinute, weekRanges, type Window } from '../lib/sessions.js';

/** Mon–Fri 13:30–20:00 UTC, the US cash equities session. */
const EQUITIES: Window[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  openMinute: 13 * 60 + 30,
  closeMinute: 20 * 60,
}));

/** Sunday 21:00 through Friday 21:00, continuous — the forex week. */
const FOREX: Window[] = [
  { dayOfWeek: 0, openMinute: 21 * 60, closeMinute: 24 * 60 },
  { dayOfWeek: 1, openMinute: 0, closeMinute: 24 * 60 },
  { dayOfWeek: 2, openMinute: 0, closeMinute: 24 * 60 },
  { dayOfWeek: 3, openMinute: 0, closeMinute: 24 * 60 },
  { dayOfWeek: 4, openMinute: 0, closeMinute: 24 * 60 },
  { dayOfWeek: 5, openMinute: 0, closeMinute: 21 * 60 },
];

const at = (iso: string) => new Date(iso);
const none = new Set<string>();

describe('weekRanges', () => {
  it('merges a continuous week into one range', () => {
    const ranges = weekRanges(FOREX);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(0 * 1440 + 21 * 60);
    expect(ranges[0].end).toBe(5 * 1440 + 21 * 60);
  });

  it('keeps separate daily sessions apart', () => {
    expect(weekRanges(EQUITIES)).toHaveLength(5);
  });

  it('wraps a window that runs past Saturday midnight to the start of the week', () => {
    const ranges = weekRanges([{ dayOfWeek: 6, openMinute: 22 * 60, closeMinute: 26 * 60 }]);
    expect(ranges).toEqual([
      { start: 0, end: 120 },
      { start: 6 * 1440 + 22 * 60, end: 7 * 1440 },
    ]);
  });

  it('drops invalid windows instead of throwing', () => {
    expect(weekRanges([{ dayOfWeek: 1, openMinute: 600, closeMinute: 600 }])).toEqual([]);
    expect(weekRanges([{ dayOfWeek: 1, openMinute: 600, closeMinute: 300 }])).toEqual([]);
  });
});

describe('weekMinute', () => {
  it('counts from Sunday 00:00 UTC', () => {
    expect(weekMinute(at('2026-09-13T00:00:00Z'))).toBe(0); // a Sunday
    expect(weekMinute(at('2026-09-14T13:30:00Z'))).toBe(1440 + 810); // Monday 13:30
  });
});

describe('sessionState', () => {
  it('treats a market with no windows as always open', () => {
    const state = sessionState([], none, at('2026-09-13T03:00:00Z'));
    expect(state).toEqual({ isOpen: true, nextOpen: null, nextClose: null });
  });

  it('opens and closes an equities session on the minute', () => {
    expect(sessionState(EQUITIES, none, at('2026-09-14T13:29:59Z')).isOpen).toBe(false);
    expect(sessionState(EQUITIES, none, at('2026-09-14T13:30:00Z')).isOpen).toBe(true);
    expect(sessionState(EQUITIES, none, at('2026-09-14T19:59:59Z')).isOpen).toBe(true);
    expect(sessionState(EQUITIES, none, at('2026-09-14T20:00:00Z')).isOpen).toBe(false);
  });

  it('reports when the current session ends', () => {
    const state = sessionState(EQUITIES, none, at('2026-09-14T15:00:00Z'));
    expect(state.isOpen).toBe(true);
    expect(state.nextClose?.toISOString()).toBe('2026-09-14T20:00:00.000Z');
  });

  it('points at the next open across a weekend', () => {
    // Friday after the close
    const state = sessionState(EQUITIES, none, at('2026-09-18T21:00:00Z'));
    expect(state.isOpen).toBe(false);
    expect(state.nextOpen?.toISOString()).toBe('2026-09-21T13:30:00.000Z');
  });

  it('keeps forex open through the middle of the night mid-week', () => {
    expect(sessionState(FOREX, none, at('2026-09-16T03:00:00Z')).isOpen).toBe(true);
    // Saturday: shut until Sunday evening
    const weekend = sessionState(FOREX, none, at('2026-09-19T12:00:00Z'));
    expect(weekend.isOpen).toBe(false);
    expect(weekend.nextOpen?.toISOString()).toBe('2026-09-20T21:00:00.000Z');
  });

  it('closes for a holiday and skips to the next trading day', () => {
    const holidays = new Set(['2026-09-14']);
    const state = sessionState(EQUITIES, holidays, at('2026-09-14T15:00:00Z'));
    expect(state.isOpen).toBe(false);
    expect(state.holiday).toBe('2026-09-14');
    expect(state.nextOpen?.toISOString()).toBe('2026-09-15T13:30:00.000Z');
  });

  it('skips consecutive holidays', () => {
    const holidays = new Set(['2026-09-14', '2026-09-15', '2026-09-16']);
    const state = sessionState(EQUITIES, holidays, at('2026-09-14T15:00:00Z'));
    expect(state.nextOpen?.toISOString()).toBe('2026-09-17T13:30:00.000Z');
  });
});

describe('describeWindows', () => {
  it('collapses identical days into a range', () => {
    expect(describeWindows(EQUITIES)).toBe('Mon–Fri 13:30–20:00 UTC');
  });

  it('says so when a market never closes', () => {
    expect(describeWindows([])).toBe('Open 24/7');
  });
});
