import { describe, expect, it } from 'vitest';
import {
  TIMEFRAMES,
  TIMEFRAME_KEYS,
  TIMEFRAME_LIST,
  bucketFor,
  isTimeframe,
  retentionSeconds,
  timeframeSeconds,
} from '../engine/timeframes.js';

describe('timeframes', () => {
  it('covers the set the terminal offers', () => {
    expect(TIMEFRAME_KEYS).toEqual([
      '5s',
      '10s',
      '15s',
      '30s',
      '1m',
      '2m',
      '3m',
      '5m',
      '10m',
      '15m',
      '30m',
      '1h',
      '4h',
      '1d',
    ]);
  });

  it('is strictly increasing, and each size divides the next where it should', () => {
    for (let i = 1; i < TIMEFRAME_LIST.length; i += 1) {
      expect(TIMEFRAME_LIST[i].seconds).toBeGreaterThan(TIMEFRAME_LIST[i - 1].seconds);
      // retention grows with the timeframe, so long history stays cheap
      expect(TIMEFRAME_LIST[i].retentionDays).toBeGreaterThanOrEqual(TIMEFRAME_LIST[i - 1].retentionDays);
    }
    expect(TIMEFRAMES['1m']).toBe(60);
    expect(TIMEFRAMES['1d']).toBe(86400);
  });

  it('keeps short timeframes for hours and long ones for years', () => {
    expect(retentionSeconds('5s')).toBe(Math.round(0.25 * 86400));
    expect(retentionSeconds('1d')).toBe(3650 * 86400);
    // an unknown key falls back to a day rather than deleting everything
    expect(retentionSeconds('nope')).toBe(86400);
  });

  it('resolves and validates keys', () => {
    expect(timeframeSeconds('15m')).toBe(900);
    expect(timeframeSeconds('7m')).toBeNull();
    expect(isTimeframe('4h')).toBe(true);
    expect(isTimeframe('4y')).toBe(false);
  });

  it('buckets a timestamp to the start of its candle', () => {
    // 2026-09-17T12:34:56Z
    const ts = Date.UTC(2026, 8, 17, 12, 34, 56);
    expect(bucketFor(ts, 60)).toBe(Math.floor(ts / 1000 / 60) * 60);
    expect(bucketFor(ts, 300) % 300).toBe(0);
    expect(bucketFor(ts, 86400)).toBe(Math.floor(Date.UTC(2026, 8, 17) / 1000));
  });
});
