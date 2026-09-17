import { describe, expect, it } from 'vitest';
import {
  bridgePage,
  driftBound,
  generateHistory,
  horizonSigma,
  swingBound,
  tickPlan,
  walkPage,
  type GeneratedCandle,
} from '../engine/history.js';
import { timeframeSeconds } from '../engine/timeframes.js';

const AAPL = { volatility: 0.0009, precision: 2, price: 189 };

function generate(timeframe: string, count = 300, market = AAPL, seed = 'AAPL') {
  const seconds = timeframeSeconds(timeframe)!;
  const endBucket = Math.floor(Date.now() / 1000 / seconds) * seconds;
  return generateHistory({
    seedKey: `${seed}:${timeframe}:history`,
    seconds,
    count,
    endBucket,
    endTarget: market.price,
    volatility: market.volatility,
    precision: market.precision,
  });
}

function span(candles: GeneratedCandle[]) {
  const low = Math.min(...candles.map((candle) => candle.low));
  const high = Math.max(...candles.map((candle) => candle.high));
  return (high - low) / candles[candles.length - 1].close;
}

describe('tick plan', () => {
  it('covers exactly one candle with ticks the engine accepts', () => {
    for (const timeframe of ['5s', '15s', '1m', '5m', '1h']) {
      const seconds = timeframeSeconds(timeframe)!;
      const plan = tickPlan(seconds);
      expect(plan.tickMs, timeframe).toBeLessThanOrEqual(10_000);
      expect(plan.subSteps, timeframe).toBeGreaterThanOrEqual(4);
      expect(plan.subSteps * plan.tickMs, timeframe).toBe(seconds * 1000);
      expect(plan.volScale, timeframe).toBeCloseTo(1, 6);
    }
  });

  it('coarsens very long candles and scales their volatility to compensate', () => {
    const plan = tickPlan(86_400);
    expect(plan.subSteps).toBe(480);
    expect(plan.tickMs).toBe(10_000);
    // the walk covers 80 minutes of a 1,440-minute candle, so the engine is
    // handed the volatility that gets a day's move out of those 80 minutes
    expect(plan.volScale).toBeCloseTo(horizonSigma(1440, 1) / Math.sqrt(80), 9);
    expect(plan.volScale).toBeGreaterThan(1);
  });
});

describe('generated history', () => {
  it('is deterministic for the same request', () => {
    expect(generate('1m')).toEqual(generate('1m'));
  });

  it('differs per timeframe and per market', () => {
    const minute = generate('1m').map((candle) => candle.close);
    const fiveMinute = generate('5m').map((candle) => candle.close);
    const other = generate('1m', 300, AAPL, 'MSFT').map((candle) => candle.close);
    expect(fiveMinute).not.toEqual(minute);
    expect(other).not.toEqual(minute);
  });

  it('closes exactly on the price it was pinned to', () => {
    for (const timeframe of ['5s', '1m', '1h', '1d']) {
      const candles = generate(timeframe);
      expect(candles[candles.length - 1].close, timeframe).toBeCloseTo(AAPL.price, 2);
    }
  });

  it('runs one bucket apart with valid OHLC and no gaps', () => {
    const candles = generate('1m');
    expect(candles).toHaveLength(300);
    for (let index = 0; index < candles.length; index += 1) {
      const candle = candles[index];
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
      expect(candle.low).toBeGreaterThan(0);
      if (index === 0) continue;
      expect(candle.time - candles[index - 1].time).toBe(60);
      // a real tape opens where it closed
      expect(candle.open).toBe(candles[index - 1].close);
    }
  });

  it('keeps its closes inside the band the page was allowed', () => {
    for (const timeframe of ['5s', '1m', '5m', '1h', '4h', '1d']) {
      const candles = generate(timeframe);
      const seconds = timeframeSeconds(timeframe)!;
      const closes = candles.map((candle) => candle.close);
      const wander = (Math.max(...closes) - Math.min(...closes)) / AAPL.price;
      // the page's own band, plus the drift its endpoints are allowed
      const allowed =
        swingBound(seconds * candles.length, AAPL.volatility) +
        2 * driftBound(seconds * candles.length, AAPL.volatility);
      expect(wander, `${timeframe} wandered too far`).toBeLessThan(allowed);
    }
  });

  it('keeps each candle the size its timeframe implies', () => {
    for (const timeframe of ['5s', '1m', '1h', '1d']) {
      const candles = generate(timeframe);
      const minutes = timeframeSeconds(timeframe)! / 60;
      const sigma = horizonSigma(minutes, AAPL.volatility);
      const ranges = candles.map((candle) => (candle.high - candle.low) / candle.close);
      const average = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      // An average candle spans a small multiple of one standard deviation:
      // more than sigma alone because the engine's trending regimes push a
      // candle's high and low apart, which is equally true of the live tape, so
      // generated candles and printed ones look like each other.
      expect(average, `${timeframe} average range`).toBeGreaterThan(sigma * 0.5);
      expect(average, `${timeframe} average range`).toBeLessThan(sigma * 4);
      expect(Math.max(...ranges), `${timeframe} widest candle`).toBeLessThan(sigma * 15);
    }
  });

  it('moves like its timeframe rather than like a tick', () => {
    const body = (candles: GeneratedCandle[]) =>
      candles.reduce((sum, candle) => sum + Math.abs(candle.close - candle.open) / candle.open, 0) /
      candles.length;

    const minute = body(generate('1m'));
    const hour = body(generate('1h'));
    const day = body(generate('1d'));
    expect(hour).toBeGreaterThan(minute * 3);
    expect(day).toBeGreaterThan(hour);
  });

  it('gives a quiet market a tighter history than a wild one', () => {
    const quiet = span(generate('1m', 300, { volatility: 0.0002, precision: 5, price: 1.08 }, 'EUR'));
    const wild = span(generate('1m', 300, { volatility: 0.004, precision: 2, price: 63000 }, 'BTC'));
    expect(wild).toBeGreaterThan(quiet * 3);
  });

  it('returns nothing for an empty page', () => {
    expect(generate('1m', 0)).toEqual([]);
  });
});

describe('level bounds', () => {
  it('grows with the span but never past the hard cap', () => {
    const minute = driftBound(300 * 60, AAPL.volatility);
    const hour = driftBound(300 * 3600, AAPL.volatility);
    const decade = driftBound(3650 * 86_400, AAPL.volatility);
    expect(hour).toBeGreaterThan(minute);
    expect(decade).toBeLessThanOrEqual(0.35);
  });

  it('never joins perfectly flat, however short the page', () => {
    expect(driftBound(5, AAPL.volatility)).toBeGreaterThan(0);
  });

  it('scales with the market rather than being one number for all', () => {
    expect(driftBound(300 * 60, 0.004)).toBeGreaterThan(driftBound(300 * 60, 0.0002));
  });
});

describe('bridge', () => {
  const raw = walkPage({
    seedKey: 'BRIDGE',
    startPrice: 100,
    seconds: 60,
    count: 200,
    endBucket: 1_700_000_000,
    volatility: 0.002,
    precision: 4,
  });

  it('pins the last close and starts at the target it was given', () => {
    const bridged = bridgePage(raw, {
      startTarget: 51,
      endTarget: 50,
      maxSwing: 0.02,
      precision: 4,
    });
    expect(bridged[0].open).toBeCloseTo(51, 4);
    expect(bridged[bridged.length - 1].close).toBeCloseTo(50, 4);
  });

  it('damps a runaway walk into the swing it is allowed', () => {
    const bridged = bridgePage(raw, {
      startTarget: 100,
      endTarget: 100,
      maxSwing: 0.01,
      precision: 4,
    });
    for (const candle of bridged) {
      // the line is flat here, so every close must sit inside the band
      // maxSwing is the whole band, so each side gets half of it
      expect(Math.abs(candle.close / 100 - 1)).toBeLessThan(0.006);
    }
  });

  it('keeps the shape of a walk that already fits', () => {
    const bridged = bridgePage(raw, {
      startTarget: raw[0].open,
      endTarget: raw[raw.length - 1].close,
      maxSwing: 10,
      precision: 4,
    });
    for (let index = 0; index < raw.length; index += 1) {
      expect(bridged[index].close).toBeCloseTo(raw[index].close, 3);
    }
  });

  it('handles an empty page and a single candle', () => {
    expect(bridgePage([], { startTarget: 1, endTarget: 1, maxSwing: 0.01, precision: 2 })).toEqual([]);
    const one = bridgePage([{ time: 1, open: 9, high: 11, low: 8, close: 10 }], {
      startTarget: 100,
      endTarget: 100,
      maxSwing: 0.01,
      precision: 2,
    });
    expect(one).toHaveLength(1);
    expect(one[0].close).toBeCloseTo(100, 2);
    expect(one[0].high).toBeGreaterThanOrEqual(one[0].close);
  });
});
