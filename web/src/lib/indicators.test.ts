import { describe, expect, it } from 'vitest';
import { bollinger, ema, sma } from './indicators';
import type { Candle } from './types';

const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i * 60, open: close, high: close, low: close, close }));

describe('sma', () => {
  it('averages the last N closes', () => {
    const out = sma(candles([1, 2, 3, 4, 5]), 3);
    expect(out).toEqual([
      { time: 120, value: 2 },
      { time: 180, value: 3 },
      { time: 240, value: 4 },
    ]);
  });

  it('starts only once the window is full', () => {
    expect(sma(candles([1, 2, 3, 4, 5]), 5)).toHaveLength(1);
    expect(sma(candles([1, 2]), 5)).toEqual([]);
  });

  it('stays stable over a long series', () => {
    const flat = sma(candles(Array(200).fill(42)), 20);
    expect(flat).toHaveLength(181);
    expect(flat.every((p) => p.value === 42)).toBe(true);
  });
});

describe('ema', () => {
  it('seeds from the simple average and weights recent closes more', () => {
    const closes = [10, 10, 10, 10, 20];
    const out = ema(candles(closes), 4);
    expect(out[0].value).toBe(10); // seed = SMA of the first 4
    expect(out[1].value).toBeGreaterThan(10);
    expect(out[1].value).toBeLessThan(20);
    // an EMA reacts faster than the equivalent SMA
    const slow = sma(candles(closes), 4);
    expect(out[1].value).toBeGreaterThan(slow[slow.length - 1].value);
  });

  it('needs a full period of data', () => {
    expect(ema(candles([1, 2, 3]), 5)).toEqual([]);
  });
});

describe('bollinger', () => {
  it('collapses onto the mean when price does not move', () => {
    const { upper, lower } = bollinger(candles(Array(40).fill(100)), 20);
    expect(upper[0].value).toBe(100);
    expect(lower[0].value).toBe(100);
  });

  it('widens with volatility and brackets the price', () => {
    const noisy = candles(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 5 : -5)));
    const { upper, lower } = bollinger(noisy, 20);
    expect(upper[0].value).toBeGreaterThan(100);
    expect(lower[0].value).toBeLessThan(100);
    expect(upper[0].value - lower[0].value).toBeCloseTo(20, 5); // ±2 sd of a ±5 square wave
  });

  it('returns nothing before the window fills', () => {
    expect(bollinger(candles([1, 2, 3]), 20).upper).toEqual([]);
  });
});
