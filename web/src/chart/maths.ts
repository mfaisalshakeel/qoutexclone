import type { Candle } from '../lib/types';

/**
 * Indicator maths.
 *
 * Every function returns one value per candle, aligned by index, with `null`
 * where the indicator has nothing to say yet — a 20-period average has no value
 * on bar 3, and pretending otherwise is how a chart draws a line from nowhere.
 *
 * Pure, and tested against figures worked out by hand: an indicator that is
 * subtly wrong is worse than one that is missing, because it will be traded on.
 */

export type Series = (number | null)[];

export const closes = (candles: Candle[]): number[] => candles.map((each) => each.close);
/** (high + low + close) / 3, the "typical price" several indicators use. */
export const typical = (candles: Candle[]): number[] =>
  candles.map((each) => (each.high + each.low + each.close) / 3);
export const median = (candles: Candle[]): number[] => candles.map((each) => (each.high + each.low) / 2);

const blank = (length: number): Series => new Array(length).fill(null);

export function smaOf(values: (number | null)[], period: number): Series {
  const out = blank(values.length);
  if (period < 1) return out;
  for (let index = period - 1; index < values.length; index += 1) {
    let sum = 0;
    let ok = true;
    for (let back = 0; back < period; back += 1) {
      const value = values[index - back];
      if (value == null) {
        ok = false;
        break;
      }
      sum += value;
    }
    if (ok) out[index] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the first full window's mean. */
export function emaOf(values: (number | null)[], period: number): Series {
  const out = blank(values.length);
  if (period < 1) return out;
  const k = 2 / (period + 1);
  let previous: number | null = null;
  let seed = 0;
  let seen = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value == null) continue;
    if (previous == null) {
      seed += value;
      seen += 1;
      if (seen === period) {
        previous = seed / period;
        out[index] = previous;
      }
      continue;
    }
    previous = value * k + previous * (1 - k);
    out[index] = previous;
  }
  return out;
}

/** Weighted moving average: the newest bar counts the most. */
export function wmaOf(values: (number | null)[], period: number): Series {
  const out = blank(values.length);
  if (period < 1) return out;
  const weight = (period * (period + 1)) / 2;
  for (let index = period - 1; index < values.length; index += 1) {
    let sum = 0;
    let ok = true;
    for (let back = 0; back < period; back += 1) {
      const value = values[index - back];
      if (value == null) {
        ok = false;
        break;
      }
      sum += value * (period - back);
    }
    if (ok) out[index] = sum / weight;
  }
  return out;
}

/** Wilder's smoothing — the average behind RSI, ATR and ADX. */
export function wilderOf(values: (number | null)[], period: number): Series {
  const out = blank(values.length);
  if (period < 1) return out;
  let previous: number | null = null;
  let seed = 0;
  let seen = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value == null) continue;
    if (previous == null) {
      seed += value;
      seen += 1;
      if (seen === period) {
        previous = seed / period;
        out[index] = previous;
      }
      continue;
    }
    previous = (previous * (period - 1) + value) / period;
    out[index] = previous;
  }
  return out;
}

export const sma = (candles: Candle[], period: number): Series => smaOf(closes(candles), period);
export const ema = (candles: Candle[], period: number): Series => emaOf(closes(candles), period);
export const wma = (candles: Candle[], period: number): Series => wmaOf(closes(candles), period);

export function stddevOf(values: (number | null)[], period: number): Series {
  const out = blank(values.length);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    if (window.some((value) => value == null)) continue;
    const numbers = window as number[];
    const mean = numbers.reduce((sum, value) => sum + value, 0) / period;
    const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    out[index] = Math.sqrt(variance);
  }
  return out;
}

export function bollinger(candles: Candle[], period = 20, multiplier = 2) {
  const middle = sma(candles, period);
  const deviation = stddevOf(closes(candles), period);
  const upper = blank(candles.length);
  const lower = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const mid = middle[index];
    const sd = deviation[index];
    if (mid == null || sd == null) continue;
    upper[index] = mid + multiplier * sd;
    lower[index] = mid - multiplier * sd;
  }
  return { middle, upper, lower };
}

/** The highest high and lowest low of the last `period` bars. */
export function donchian(candles: Candle[], period = 20) {
  const upper = blank(candles.length);
  const lower = blank(candles.length);
  const middle = blank(candles.length);
  for (let index = period - 1; index < candles.length; index += 1) {
    let high = -Infinity;
    let low = Infinity;
    for (let back = 0; back < period; back += 1) {
      high = Math.max(high, candles[index - back].high);
      low = Math.min(low, candles[index - back].low);
    }
    upper[index] = high;
    lower[index] = low;
    middle[index] = (high + low) / 2;
  }
  return { upper, lower, middle };
}

/** True range: the widest of today's range and the gaps around yesterday. */
export function trueRange(candles: Candle[]): Series {
  return candles.map((candle, index) => {
    const previous = candles[index - 1];
    return previous
      ? Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - previous.close),
          Math.abs(candle.low - previous.close),
        )
      : candle.high - candle.low;
  });
}

export const atr = (candles: Candle[], period = 14): Series => wilderOf(trueRange(candles), period);

/** Keltner channels: an EMA with ATR-wide bands either side. */
export function keltner(candles: Candle[], period = 20, multiplier = 2, atrPeriod = 10) {
  const middle = ema(candles, period);
  const range = atr(candles, atrPeriod);
  const upper = blank(candles.length);
  const lower = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const mid = middle[index];
    const width = range[index];
    if (mid == null || width == null) continue;
    upper[index] = mid + multiplier * width;
    lower[index] = mid - multiplier * width;
  }
  return { middle, upper, lower };
}

export function rsi(candles: Candle[], period = 14): Series {
  const gains = blank(candles.length);
  const losses = blank(candles.length);
  for (let index = 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    gains[index] = Math.max(change, 0);
    losses[index] = Math.max(-change, 0);
  }
  const avgGain = wilderOf(gains, period);
  const avgLoss = wilderOf(losses, period);

  const out = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const gain = avgGain[index];
    const loss = avgLoss[index];
    if (gain == null || loss == null) continue;
    // no losses at all is a maximum reading rather than a division by zero
    out[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastLine = ema(candles, fast);
  const slowLine = ema(candles, slow);
  const line = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const a = fastLine[index];
    const b = slowLine[index];
    if (a == null || b == null) continue;
    line[index] = a - b;
  }
  const signal = emaOf(line, signalPeriod);
  const histogram = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const value = line[index];
    const mark = signal[index];
    if (value == null || mark == null) continue;
    histogram[index] = value - mark;
  }
  return { macd: line, signal, histogram };
}

export function stochastic(candles: Candle[], period = 14, smoothK = 3, smoothD = 3) {
  const raw = blank(candles.length);
  for (let index = period - 1; index < candles.length; index += 1) {
    let high = -Infinity;
    let low = Infinity;
    for (let back = 0; back < period; back += 1) {
      high = Math.max(high, candles[index - back].high);
      low = Math.min(low, candles[index - back].low);
    }
    // a range of nothing is the middle, not an infinity
    raw[index] = high === low ? 50 : ((candles[index].close - low) / (high - low)) * 100;
  }
  const k = smoothK > 1 ? smaOf(raw, smoothK) : raw;
  return { k, d: smaOf(k, smoothD) };
}

export function williamsR(candles: Candle[], period = 14): Series {
  const out = blank(candles.length);
  for (let index = period - 1; index < candles.length; index += 1) {
    let high = -Infinity;
    let low = Infinity;
    for (let back = 0; back < period; back += 1) {
      high = Math.max(high, candles[index - back].high);
      low = Math.min(low, candles[index - back].low);
    }
    out[index] = high === low ? -50 : ((high - candles[index].close) / (high - low)) * -100;
  }
  return out;
}

export function cci(candles: Candle[], period = 20): Series {
  const prices = typical(candles);
  const average = smaOf(prices, period);
  const out = blank(candles.length);
  for (let index = period - 1; index < candles.length; index += 1) {
    const mean = average[index];
    if (mean == null) continue;
    let deviation = 0;
    for (let back = 0; back < period; back += 1) deviation += Math.abs(prices[index - back] - mean);
    const meanDeviation = deviation / period;
    out[index] = meanDeviation === 0 ? 0 : (prices[index] - mean) / (0.015 * meanDeviation);
  }
  return out;
}

/** Momentum: today's close against the close `period` bars ago. */
export function momentum(candles: Candle[], period = 10): Series {
  const out = blank(candles.length);
  for (let index = period; index < candles.length; index += 1) {
    out[index] = candles[index].close - candles[index - period].close;
  }
  return out;
}

/** Awesome oscillator: the gap between two averages of the bar's midpoint. */
export function awesome(candles: Candle[], fast = 5, slow = 34): Series {
  const mid = median(candles);
  const fastLine = smaOf(mid, fast);
  const slowLine = smaOf(mid, slow);
  const out = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const a = fastLine[index];
    const b = slowLine[index];
    if (a == null || b == null) continue;
    out[index] = a - b;
  }
  return out;
}

export function adx(candles: Candle[], period = 14) {
  const plusDm = blank(candles.length);
  const minusDm = blank(candles.length);
  for (let index = 1; index < candles.length; index += 1) {
    const up = candles[index].high - candles[index - 1].high;
    const down = candles[index - 1].low - candles[index].low;
    plusDm[index] = up > down && up > 0 ? up : 0;
    minusDm[index] = down > up && down > 0 ? down : 0;
  }
  const range = wilderOf(trueRange(candles), period);
  const plusSmoothed = wilderOf(plusDm, period);
  const minusSmoothed = wilderOf(minusDm, period);

  const plus = blank(candles.length);
  const minus = blank(candles.length);
  const dx = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const width = range[index];
    const up = plusSmoothed[index];
    const down = minusSmoothed[index];
    if (width == null || up == null || down == null || width === 0) continue;
    plus[index] = (up / width) * 100;
    minus[index] = (down / width) * 100;
    const sum = plus[index]! + minus[index]!;
    dx[index] = sum === 0 ? 0 : (Math.abs(plus[index]! - minus[index]!) / sum) * 100;
  }
  return { adx: wilderOf(dx, period), plus, minus };
}

/**
 * Parabolic SAR: the dots flip sides when price crosses them, and the
 * acceleration steps up on each new extreme, which is what makes it hug a trend
 * and then catch up when the trend stalls.
 */
export function parabolicSar(candles: Candle[], step = 0.02, max = 0.2): Series {
  const out = blank(candles.length);
  if (candles.length < 2) return out;

  let rising = candles[1].close >= candles[0].close;
  let sar = rising ? candles[0].low : candles[0].high;
  let extreme = rising ? candles[0].high : candles[0].low;
  let acceleration = step;

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    sar += acceleration * (extreme - sar);

    if (rising) {
      // the stop may never move above the last two lows
      sar = Math.min(sar, candles[index - 1].low, candles[Math.max(index - 2, 0)].low);
      if (candle.low < sar) {
        rising = false;
        sar = extreme;
        extreme = candle.low;
        acceleration = step;
      } else if (candle.high > extreme) {
        extreme = candle.high;
        acceleration = Math.min(acceleration + step, max);
      }
    } else {
      sar = Math.max(sar, candles[index - 1].high, candles[Math.max(index - 2, 0)].high);
      if (candle.high > sar) {
        rising = true;
        sar = extreme;
        extreme = candle.high;
        acceleration = step;
      } else if (candle.low < extreme) {
        extreme = candle.low;
        acceleration = Math.min(acceleration + step, max);
      }
    }
    out[index] = sar;
  }
  return out;
}

/** SuperTrend: an ATR band that flips with the trend, drawn as one line. */
export function superTrend(candles: Candle[], period = 10, multiplier = 3) {
  const range = atr(candles, period);
  const line = blank(candles.length);
  const rising: (boolean | null)[] = new Array(candles.length).fill(null);

  let upper: number | null = null;
  let lower: number | null = null;
  let up = true;
  for (let index = 0; index < candles.length; index += 1) {
    const width = range[index];
    if (width == null) continue;
    const mid = (candles[index].high + candles[index].low) / 2;
    const basicUpper = mid + multiplier * width;
    const basicLower = mid - multiplier * width;
    const previousClose = candles[index - 1]?.close ?? candles[index].close;

    upper = upper == null || basicUpper < upper || previousClose > upper ? basicUpper : upper;
    lower = lower == null || basicLower > lower || previousClose < lower ? basicLower : lower;

    if (candles[index].close > upper) up = true;
    else if (candles[index].close < lower) up = false;

    line[index] = up ? lower : upper;
    rising[index] = up;
  }
  return { line, rising };
}

/** Ichimoku's five lines; the spans are drawn ahead, the lagging line behind. */
export function ichimoku(candles: Candle[], conversion = 9, base = 26, spanB = 52) {
  const middleOf = (period: number): Series => {
    const out = blank(candles.length);
    for (let index = period - 1; index < candles.length; index += 1) {
      let high = -Infinity;
      let low = Infinity;
      for (let back = 0; back < period; back += 1) {
        high = Math.max(high, candles[index - back].high);
        low = Math.min(low, candles[index - back].low);
      }
      out[index] = (high + low) / 2;
    }
    return out;
  };

  const conversionLine = middleOf(conversion);
  const baseLine = middleOf(base);
  const spanAraw = blank(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const a = conversionLine[index];
    const b = baseLine[index];
    if (a == null || b == null) continue;
    spanAraw[index] = (a + b) / 2;
  }

  return {
    conversion: conversionLine,
    base: baseLine,
    spanA: shiftBy(spanAraw, base),
    spanB: shiftBy(middleOf(spanB), base),
    lagging: shiftBy(closes(candles), -base),
  };
}

/** Moves a series forward (positive) or back (negative) by `by` bars. */
export function shiftBy(values: Series, by: number): Series {
  const out = blank(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const from = index - by;
    if (from >= 0 && from < values.length) out[index] = values[from];
  }
  return out;
}

/** Bill Williams' Alligator: three shifted smoothed averages. */
export function alligator(
  candles: Candle[],
  jaw = 13,
  jawShift = 8,
  teeth = 8,
  teethShift = 5,
  lips = 5,
  lipsShift = 3,
) {
  const mid = median(candles);
  return {
    jaw: shiftBy(smaOf(mid, jaw), jawShift),
    teeth: shiftBy(smaOf(mid, teeth), teethShift),
    lips: shiftBy(smaOf(mid, lips), lipsShift),
  };
}

/**
 * Williams fractals: a bar whose high is the highest of the five around it, or
 * whose low is the lowest. They are only knowable two bars later, which is why
 * the last two bars never carry one.
 */
export function fractals(candles: Candle[]) {
  const up = blank(candles.length);
  const down = blank(candles.length);
  for (let index = 2; index < candles.length - 2; index += 1) {
    const around = [index - 2, index - 1, index + 1, index + 2];
    if (around.every((at) => candles[index].high > candles[at].high)) up[index] = candles[index].high;
    if (around.every((at) => candles[index].low < candles[at].low)) down[index] = candles[index].low;
  }
  return { up, down };
}

/**
 * ZigZag: the swings big enough to matter, joined up.
 *
 * Only a move of at least `percent` counts as a turn, so the line ignores the
 * noise in between. The last leg is provisional by nature — it moves with the
 * market until the next turn confirms it.
 */
export function zigzag(candles: Candle[], percent = 3): Series {
  const out = blank(candles.length);
  if (candles.length < 2) return out;

  const threshold = percent / 100;
  let pivotIndex = 0;
  let pivotPrice = candles[0].close;
  let rising: boolean | null = null;

  for (let index = 1; index < candles.length; index += 1) {
    const { high, low } = candles[index];
    if (rising !== true && (high - pivotPrice) / pivotPrice >= threshold) {
      out[pivotIndex] = pivotPrice;
      rising = true;
      pivotIndex = index;
      pivotPrice = high;
      continue;
    }
    if (rising !== false && (pivotPrice - low) / pivotPrice >= threshold) {
      out[pivotIndex] = pivotPrice;
      rising = false;
      pivotIndex = index;
      pivotPrice = low;
      continue;
    }
    // no turn yet: the running extreme moves with the market
    if (rising === true && high > pivotPrice) {
      pivotIndex = index;
      pivotPrice = high;
    } else if (rising === false && low < pivotPrice) {
      pivotIndex = index;
      pivotPrice = low;
    }
  }
  out[pivotIndex] = pivotPrice;
  return out;
}
