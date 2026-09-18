import type { Candle } from '../lib/types';

/**
 * The shapes a series can take.
 *
 * `heikin-ashi` is a different set of candles rather than a different way of
 * drawing the same ones, so it lives here as a transform: the smoothing is
 * arithmetic on the bars, and arithmetic is testable.
 */

export const SERIES_TYPES = ['candles', 'bars', 'heikin-ashi', 'line', 'area'] as const;
export type SeriesKind = (typeof SERIES_TYPES)[number];

export const SERIES_LABELS: Record<SeriesKind, string> = {
  candles: 'Candlesticks',
  bars: 'Bars',
  'heikin-ashi': 'Heikin-Ashi',
  line: 'Line',
  area: 'Area',
};

/** Which shapes draw a bar rather than a path. */
export function isBarSeries(kind: SeriesKind): boolean {
  return kind === 'candles' || kind === 'bars' || kind === 'heikin-ashi';
}

/**
 * Heikin-Ashi candles.
 *
 * Close is the bar's own average; open is the midpoint of the *previous*
 * Heikin-Ashi bar, which is what smooths the series and what makes the first
 * bar a special case — it has no previous bar, so it opens on the real one.
 * High and low take in the synthetic open and close, or a bar could show a body
 * outside its own wick.
 */
export function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const previous = out[index - 1];
    const open = previous ? (previous.open + previous.close) / 2 : (candle.open + candle.close) / 2;
    out.push({
      time: candle.time,
      open,
      close,
      high: Math.max(candle.high, open, close),
      low: Math.min(candle.low, open, close),
    });
  }
  return out;
}
