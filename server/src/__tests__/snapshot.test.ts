import { describe, expect, it } from 'vitest';
import { snapshotWindow, timeframeForDuration } from '../engine/snapshot.js';
import { TIMEFRAME_KEYS } from '../engine/timeframes.js';

describe('choosing a timeframe for a position', () => {
  it('uses small candles for a short trade and large ones for a long one', () => {
    expect(timeframeForDuration(30)).toBe('5s');
    expect(timeframeForDuration(60)).toBe('5s');
    expect(timeframeForDuration(300)).toBe('10s');
    expect(timeframeForDuration(3600)).toBe('2m');
    expect(timeframeForDuration(14_400)).toBe('10m');
  });

  it('only ever picks a timeframe the store actually keeps', () => {
    for (const duration of [1, 5, 30, 60, 300, 900, 3600, 14_400, 86_400, 604_800]) {
      expect(TIMEFRAME_KEYS, `duration ${duration}`).toContain(timeframeForDuration(duration));
    }
  });

  it('keeps the trade inside a readable number of bars', () => {
    for (const duration of [5, 60, 600, 3600, 14_400]) {
      const window = snapshotWindow(0, duration * 1000, duration);
      // readable means neither one bar nor hundreds
      expect(window.bars, `duration ${duration}`).toBeGreaterThan(3);
      expect(window.bars, `duration ${duration}`).toBeLessThan(120);
    }
  });

  it('survives a nonsense duration rather than dividing by zero', () => {
    expect(timeframeForDuration(0)).toBe('5s');
    expect(timeframeForDuration(-10)).toBe('5s');
  });
});

describe('the window around a position', () => {
  const opened = Date.parse('2026-09-17T12:00:00Z');
  const expires = Date.parse('2026-09-17T12:01:00Z');

  it('covers the whole trade', () => {
    const window = snapshotWindow(opened, expires, 60);
    expect(window.from).toBeLessThanOrEqual(Math.floor(opened / 1000));
    expect(window.to).toBeGreaterThanOrEqual(Math.floor(expires / 1000));
  });

  it('pads either side, so the entry is not on the edge', () => {
    const window = snapshotWindow(opened, expires, 60);
    expect(Math.floor(opened / 1000) - window.from).toBeGreaterThan(0);
    expect(window.to - Math.floor(expires / 1000)).toBeGreaterThan(0);
  });

  it('aligns the bounds to the timeframe, so bars line up', () => {
    const window = snapshotWindow(opened, expires, 300);
    expect(window.from % 10).toBe(0);
    expect(window.to % 10).toBe(0);
  });

  it('gives a five-second trade context rather than one bar', () => {
    const window = snapshotWindow(opened, opened + 5_000, 5);
    expect(window.bars).toBeGreaterThan(4);
  });
});
