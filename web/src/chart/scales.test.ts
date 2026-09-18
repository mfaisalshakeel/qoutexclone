import { describe, expect, it } from 'vitest';
import {
  MAX_BAR_WIDTH,
  MIN_BAR_WIDTH,
  atLive,
  barWidth,
  clampView,
  indexAt,
  liveView,
  panBy,
  priceAt,
  priceRange,
  priceTicks,
  timeTicks,
  visibleSlice,
  xOf,
  yOf,
  zoomAt,
} from './scales';
import type { Candle } from '../lib/types';

const plot = { width: 800, height: 400 };
const view = { rightIndex: 99, barsVisible: 100 };

function series(count: number, at = (index: number) => 100 + index): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: 1_700_000_000 + index * 60,
    open: at(index),
    high: at(index) + 1,
    low: at(index) - 1,
    close: at(index) + 0.5,
  }));
}

describe('bars to pixels', () => {
  it('puts the last bar just inside the right edge', () => {
    expect(barWidth(view, plot)).toBe(8);
    expect(xOf(99, view, plot)).toBe(796);
    expect(xOf(98, view, plot)).toBe(788);
  });

  it('reads back the bar under a pixel', () => {
    for (const index of [0, 12.5, 60, 99]) {
      expect(indexAt(xOf(index, view, plot), view, plot)).toBeCloseTo(index, 6);
    }
  });

  it('never divides by a zero-bar viewport', () => {
    expect(Number.isFinite(barWidth({ rightIndex: 0, barsVisible: 0 }, plot))).toBe(true);
  });
});

describe('prices to pixels', () => {
  const range = { min: 100, max: 200 };

  it('puts the high at the top and the low at the bottom', () => {
    expect(yOf(200, range, plot)).toBe(0);
    expect(yOf(100, range, plot)).toBe(400);
    expect(yOf(150, range, plot)).toBe(200);
  });

  it('reads back the price under a pixel', () => {
    for (const price of [100, 133.3, 200]) {
      expect(priceAt(yOf(price, range, plot), range, plot)).toBeCloseTo(price, 6);
    }
  });

  it('draws a flat market down the middle rather than dividing by zero', () => {
    expect(yOf(150, { min: 150, max: 150 }, plot)).toBe(200);
  });
});

describe('the visible range of prices', () => {
  it('covers the candles on screen, with room to breathe', () => {
    const candles = series(50);
    const range = priceRange(candles, { from: 10, to: 19 });
    // bars 10..19 run from a low of 109 to a high of 120, padded by 8%
    expect(range.min).toBeLessThan(109);
    expect(range.max).toBeGreaterThan(120);
    // and nothing outside the slice pulls on it
    expect(range.min).toBeGreaterThan(100);
  });

  it('stretches to include a trade the trader is watching', () => {
    const candles = series(50);
    const without = priceRange(candles, { from: 0, to: 9 });
    const with_ = priceRange(candles, { from: 0, to: 9 }, [500]);
    expect(with_.max).toBeGreaterThan(without.max);
    expect(with_.max).toBeGreaterThanOrEqual(500);
  });

  it('gives a dead flat market a scale of its own', () => {
    const flat = series(5, () => 100).map((candle) => ({ ...candle, high: 100, low: 100 }));
    const range = priceRange(flat, { from: 0, to: 4 });
    expect(range.max).toBeGreaterThan(range.min);
  });

  it('falls back rather than returning infinities for no data', () => {
    expect(priceRange([], { from: 0, to: 0 })).toEqual({ min: 0, max: 1 });
  });
});

describe('axis ticks', () => {
  it('lands on round numbers a trader would recognise', () => {
    const ticks = priceTicks({ min: 1.0812, max: 1.0968 }, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(ticks[0]).toBeGreaterThanOrEqual(1.0812);
    expect(ticks.at(-1)!).toBeLessThanOrEqual(1.0968);

    // evenly spaced, and on a 1/2/5 step rather than an arbitrary one
    const step = ticks[1] - ticks[0];
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index] - ticks[index - 1]).toBeCloseTo(step, 9);
    }
    const magnitude = 10 ** Math.floor(Math.log10(step));
    expect([1, 2, 5].map((each) => each * magnitude)).toContainEqual(
      Number((step / magnitude).toFixed(6)) * magnitude,
    );
  });

  it('copes with a huge range and a tiny one', () => {
    expect(priceTicks({ min: 0, max: 90_000 }).length).toBeGreaterThan(3);
    expect(priceTicks({ min: 0.00001, max: 0.00002 }).length).toBeGreaterThan(1);
    expect(priceTicks({ min: 5, max: 5 })).toEqual([]);
  });

  it('never puts two time labels close enough to collide', () => {
    const candles = series(300);
    for (const barsVisible of [30, 60, 120, 300]) {
      const view = { rightIndex: 299, barsVisible };
      const ticks = timeTicks(candles, view, plot, { minGapPx: 72 });
      expect(ticks.length).toBeGreaterThan(1);
      for (let index = 1; index < ticks.length; index += 1) {
        const gap = xOf(ticks[index].index, view, plot) - xOf(ticks[index - 1].index, view, plot);
        expect(gap, `${barsVisible} bars`).toBeGreaterThanOrEqual(72);
      }
    }
  });
});

describe('the viewport', () => {
  it('shows only the bars that exist, plus the live gap', () => {
    const slice = visibleSlice(50, { rightIndex: 49, barsVisible: 100 });
    expect(slice).toEqual({ from: 0, to: 49 });
  });

  it('cannot be panned into empty space on either side', () => {
    const far = clampView({ rightIndex: 10_000, barsVisible: 100 }, 200, plot);
    expect(far.rightIndex).toBeLessThanOrEqual(199 + 100 / 3);

    const back = clampView({ rightIndex: -500, barsVisible: 100 }, 200, plot);
    expect(back.rightIndex).toBeGreaterThan(0);
  });

  it('cannot be zoomed past a hairline or a slab', () => {
    const tiny = clampView({ rightIndex: 100, barsVisible: 100_000 }, 500, plot);
    expect(barWidth(tiny, plot)).toBeGreaterThanOrEqual(MIN_BAR_WIDTH - 1e-9);

    const huge = clampView({ rightIndex: 100, barsVisible: 1 }, 500, plot);
    expect(barWidth(huge, plot)).toBeLessThanOrEqual(MAX_BAR_WIDTH + 1e-9);
  });

  it('keeps the bar under the cursor still while zooming', () => {
    const anchorX = 320;
    const before = indexAt(anchorX, view, plot);
    const zoomed = zoomAt(view, 0.8, anchorX, plot);
    expect(indexAt(anchorX, zoomed, plot)).toBeCloseTo(before, 6);
    expect(zoomed.barsVisible).toBeCloseTo(80, 6);
  });

  it('pans a bar per bar-width of drag', () => {
    const panned = panBy(view, 80, plot);
    expect(panned.rightIndex).toBeCloseTo(99 - 10, 6);
  });

  it('knows whether it is watching the live edge', () => {
    expect(atLive({ rightIndex: 99, barsVisible: 100 }, 100)).toBe(true);
    expect(atLive({ rightIndex: 120, barsVisible: 100 }, 100)).toBe(true);
    expect(atLive({ rightIndex: 40, barsVisible: 100 }, 100)).toBe(false);
    expect(atLive(liveView(500, 100), 500)).toBe(true);
  });
});
