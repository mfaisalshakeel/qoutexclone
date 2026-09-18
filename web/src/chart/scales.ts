import type { Candle } from '../lib/types';
import type { Plot, PriceRange, Viewport } from './types';

/**
 * The chart's arithmetic: bars to pixels, prices to pixels, and the tick
 * levels the axes label.
 *
 * Pure, and with no canvas anywhere near it — a chart that is wrong by one bar
 * is a chart that draws a trade against the wrong candle, so this is the part
 * that has to be provable rather than eyeballed.
 */

/** Room kept above and below the visible extremes, as a share of the range. */
const PRICE_PAD = 0.08;
/** The smallest and largest a bar may be drawn, in CSS pixels. */
export const MIN_BAR_WIDTH = 1.5;
export const MAX_BAR_WIDTH = 64;

export function barWidth(view: Viewport, plot: Plot): number {
  return plot.width / Math.max(view.barsVisible, 1);
}

/** The x of a bar's centre. */
export function xOf(index: number, view: Viewport, plot: Plot): number {
  const width = barWidth(view, plot);
  return plot.width - (view.rightIndex - index + 0.5) * width;
}

/** The bar index under an x, as a float: the caller rounds if it wants a bar. */
export function indexAt(x: number, view: Viewport, plot: Plot): number {
  const width = barWidth(view, plot);
  return view.rightIndex + 0.5 - (plot.width - x) / width;
}

export function yOf(price: number, range: PriceRange, plot: Plot): number {
  const span = range.max - range.min;
  if (span <= 0) return plot.height / 2;
  return plot.height - ((price - range.min) / span) * plot.height;
}

export function priceAt(y: number, range: PriceRange, plot: Plot): number {
  const span = range.max - range.min;
  if (plot.height <= 0) return range.min;
  return range.min + ((plot.height - y) / plot.height) * span;
}

/** The candles that fall inside the viewport, with a bar of margin either side. */
export function visibleSlice(count: number, view: Viewport): { from: number; to: number } {
  const first = Math.floor(view.rightIndex - view.barsVisible) - 1;
  const last = Math.ceil(view.rightIndex) + 1;
  return { from: Math.max(0, first), to: Math.min(count - 1, last) };
}

/**
 * The price range to draw.
 *
 * Padded, so a candle never touches the top of the plot, and widened to include
 * anything else that has to be on screen — an open trade's strike, say, which
 * is the whole reason the trader is watching.
 */
export function priceRange(
  candles: Candle[],
  slice: { from: number; to: number },
  extras: number[] = [],
): PriceRange {
  let min = Infinity;
  let max = -Infinity;
  for (let index = slice.from; index <= slice.to; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    if (candle.low < min) min = candle.low;
    if (candle.high > max) max = candle.high;
  }
  for (const value of extras) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };

  if (max - min < Number.EPSILON) {
    // a flat market still needs a scale, or everything lands on one line
    const nudge = Math.abs(max) * 0.001 || 0.5;
    return { min: min - nudge, max: max + nudge };
  }
  const pad = (max - min) * PRICE_PAD;
  return { min: min - pad, max: max + pad };
}

/**
 * Round levels for the price axis.
 *
 * The step is the 1/2/5 × 10ⁿ that gives about the number of lines asked for,
 * which is what makes an axis read as 1.0850, 1.0900, 1.0950 rather than
 * 1.08517, 1.08964.
 */
export function priceTicks(range: PriceRange, wanted = 6): number[] {
  const span = range.max - range.min;
  if (!(span > 0) || wanted < 1) return [];

  const rough = span / wanted;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  // rounded down to the next nice step, so the axis errs towards more lines
  // than asked for rather than three lonely ones
  const step = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : normalised >= 1 ? 1 : 0.5) * magnitude;

  const ticks: number[] = [];
  const first = Math.ceil(range.min / step) * step;
  for (let value = first; value <= range.max + step / 1e6; value += step) {
    // the running sum drifts in binary, so each level is rounded to the step
    ticks.push(Math.round(value / step) * step);
  }
  return ticks;
}

/**
 * Label positions for the time axis: every nth bar, where n keeps the labels
 * from colliding at any zoom.
 */
export function timeTicks(
  candles: Candle[],
  view: Viewport,
  plot: Plot,
  options: { minGapPx?: number } = {},
): { index: number; time: number }[] {
  const minGap = options.minGapPx ?? 72;
  const width = barWidth(view, plot);
  if (!(width > 0) || candles.length === 0) return [];

  const every = Math.max(1, Math.ceil(minGap / width));
  const slice = visibleSlice(candles.length, view);
  const ticks: { index: number; time: number }[] = [];
  // anchored to bar 0 so labels do not slide about as the chart is panned
  for (let index = Math.ceil(slice.from / every) * every; index <= slice.to; index += every) {
    const candle = candles[index];
    if (candle) ticks.push({ index, time: candle.time });
  }
  return ticks;
}

/**
 * Keeps a viewport usable.
 *
 * The right edge may run up to a third of a screen past the newest bar — the
 * gap a live chart draws into — and the left edge may not sail off into empty
 * space before the first bar.
 */
export function clampView(view: Viewport, count: number, plot?: Plot): Viewport {
  const maxBars = plot ? Math.max(plot.width / MIN_BAR_WIDTH, 4) : Number.MAX_SAFE_INTEGER;
  const minBars = plot ? Math.max(plot.width / MAX_BAR_WIDTH, 4) : 4;
  const barsVisible = Math.min(Math.max(view.barsVisible, minBars), maxBars);

  if (count === 0) return { rightIndex: 0, barsVisible };
  const rightMost = count - 1 + barsVisible / 3;
  const leftMost = Math.min(barsVisible * 0.75, count - 1 + barsVisible / 3);
  return { rightIndex: Math.min(Math.max(view.rightIndex, leftMost), rightMost), barsVisible };
}

/** Whether the newest bar is on screen, which is what "live" means here. */
export function atLive(view: Viewport, count: number): boolean {
  return view.rightIndex >= count - 1 - 0.5;
}

/** A viewport showing the newest bars, with the usual gap at the right. */
export function liveView(count: number, barsVisible: number): Viewport {
  return { rightIndex: Math.max(count - 1, 0) + barsVisible / 8, barsVisible };
}

/** Zooms about a point on the plot, so the bar under the cursor stays put. */
export function zoomAt(view: Viewport, factor: number, x: number, plot: Plot): Viewport {
  const anchor = indexAt(x, view, plot);
  // the distance from the right edge, in bars, scales with the zoom; the half
  // bar in `xOf` does not, which is why it is taken out and put back
  const fromRight = view.rightIndex + 0.5 - anchor;
  return {
    rightIndex: anchor - 0.5 + fromRight * factor,
    barsVisible: view.barsVisible * factor,
  };
}

/** Pans by a pixel distance, right-to-left like a finger dragging the tape. */
export function panBy(view: Viewport, dxPx: number, plot: Plot): Viewport {
  const width = barWidth(view, plot);
  return { ...view, rightIndex: view.rightIndex - dxPx / width };
}
