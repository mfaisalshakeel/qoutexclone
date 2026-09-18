import { describe, expect, it } from 'vitest';
import { SERIES_TYPES, heikinAshi, isBarSeries } from './series';
import type { Candle } from '../lib/types';

const bar = (over: Partial<Candle> & { time: number }): Candle => ({
  open: 100,
  high: 105,
  low: 95,
  close: 102,
  ...over,
});

describe('heikin-ashi', () => {
  it('closes on the bar’s own average', () => {
    const [first] = heikinAshi([bar({ time: 1 })]);
    expect(first.close).toBeCloseTo((100 + 105 + 95 + 102) / 4, 9);
  });

  it('opens the first bar on the real one, having nothing to smooth from', () => {
    const [first] = heikinAshi([bar({ time: 1 })]);
    expect(first.open).toBeCloseTo((100 + 102) / 2, 9);
  });

  it('opens every later bar at the midpoint of the one before it', () => {
    const smoothed = heikinAshi([bar({ time: 1 }), bar({ time: 2, open: 102, close: 108 })]);
    expect(smoothed[1].open).toBeCloseTo((smoothed[0].open + smoothed[0].close) / 2, 9);
  });

  it('never leaves a body outside its own wick', () => {
    const noisy = [
      bar({ time: 1, open: 100, high: 101, low: 90, close: 91 }),
      bar({ time: 2, open: 91, high: 120, low: 91, close: 119 }),
      bar({ time: 3, open: 119, high: 119, low: 80, close: 81 }),
    ];
    for (const candle of heikinAshi(noisy)) {
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
    }
  });

  it('keeps the times, so overlays and trades still line up', () => {
    const source = [bar({ time: 10 }), bar({ time: 20 }), bar({ time: 30 })];
    expect(heikinAshi(source).map((candle) => candle.time)).toEqual([10, 20, 30]);
  });

  it('smooths: the synthetic series swings less than the real one', () => {
    const noisy = Array.from({ length: 30 }, (_, index) =>
      bar({
        time: index,
        open: 100 + (index % 2 ? 6 : -6),
        close: 100 + (index % 2 ? -6 : 6),
        high: 110,
        low: 90,
      }),
    );
    const body = (candles: Candle[]) =>
      candles.reduce((sum, candle) => sum + Math.abs(candle.close - candle.open), 0) / candles.length;
    expect(body(heikinAshi(noisy))).toBeLessThan(body(noisy));
  });

  it('copes with an empty series', () => {
    expect(heikinAshi([])).toEqual([]);
  });
});

describe('the series list', () => {
  it('knows which shapes draw bars and which draw a path', () => {
    expect(SERIES_TYPES.filter(isBarSeries)).toEqual(['candles', 'bars', 'heikin-ashi']);
    expect(SERIES_TYPES.filter((kind) => !isBarSeries(kind))).toEqual(['line', 'area']);
  });
});
