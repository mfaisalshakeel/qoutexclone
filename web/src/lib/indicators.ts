import type { Candle } from './types';

export interface LinePoint {
  time: number;
  value: number;
}

/** Simple moving average of closes; the first `period-1` bars have no value. */
export function sma(candles: Candle[], period: number): LinePoint[] {
  if (period < 2 || candles.length < period) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first window. */
export function ema(candles: Candle[], period: number): LinePoint[] {
  if (period < 2 || candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: LinePoint[] = [];
  let prev = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i += 1) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/** Bollinger bands around an SMA, at `mult` standard deviations. */
export function bollinger(
  candles: Candle[],
  period = 20,
  mult = 2,
): { upper: LinePoint[]; lower: LinePoint[] } {
  const upper: LinePoint[] = [];
  const lower: LinePoint[] = [];
  if (candles.length < period) return { upper, lower };
  for (let i = period - 1; i < candles.length; i += 1) {
    const window = candles.slice(i - period + 1, i + 1);
    const mean = window.reduce((sum, c) => sum + c.close, 0) / period;
    const variance = window.reduce((sum, c) => sum + (c.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push({ time: candles[i].time, value: mean + mult * sd });
    lower.push({ time: candles[i].time, value: mean - mult * sd });
  }
  return { upper, lower };
}
