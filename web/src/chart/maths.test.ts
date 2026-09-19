import { describe, expect, it } from 'vitest';
import {
  adx,
  alligator,
  atr,
  awesome,
  bollinger,
  cci,
  donchian,
  ema,
  fractals,
  ichimoku,
  keltner,
  macd,
  momentum,
  parabolicSar,
  rsi,
  sma,
  smaOf,
  stddevOf,
  stochastic,
  superTrend,
  trueRange,
  wilderOf,
  williamsR,
  wma,
  zigzag,
} from './maths';
import type { Candle } from '../lib/types';

/** Candles from a list of closes, with a one-point range around each. */
function fromCloses(values: number[]): Candle[] {
  return values.map((close, index) => ({
    time: 1_700_000_000 + index * 60,
    open: index === 0 ? close : values[index - 1],
    high: close + 1,
    low: close - 1,
    close,
  }));
}

const ramp = fromCloses(Array.from({ length: 60 }, (_, index) => 100 + index));

describe('averages', () => {
  it('say nothing until they have a full window', () => {
    const line = sma(fromCloses([1, 2, 3, 4, 5]), 3);
    expect(line.slice(0, 2)).toEqual([null, null]);
    expect(line[2]).toBeCloseTo(2, 9);
    expect(line[4]).toBeCloseTo(4, 9);
  });

  it('weight the newest bar most, in a weighted average', () => {
    // (3*3 + 2*2 + 1*1) / 6
    expect(wma(fromCloses([1, 2, 3]), 3)![2]).toBeCloseTo(7 / 3, 9);
  });

  it('seed an exponential average with the first window and then decay', () => {
    const line = ema(fromCloses([1, 2, 3, 4, 5]), 3);
    expect(line[2]).toBeCloseTo(2, 9);
    // 4 * 0.5 + 2 * 0.5
    expect(line[3]).toBeCloseTo(3, 9);
    expect(line[4]).toBeCloseTo(4, 9);
  });

  it("use Wilder's smoothing where Wilder's indicators expect it", () => {
    const line = wilderOf([1, 1, 1, 1, 6], 4);
    expect(line[3]).toBeCloseTo(1, 9);
    // (1 * 3 + 6) / 4
    expect(line[4]).toBeCloseTo(2.25, 9);
  });

  it('never average across a gap in the data', () => {
    expect(smaOf([1, 2, null, 4, 5], 3)[3]).toBeNull();
    expect(smaOf([1, 2, null, 4, 5], 2)[4]).toBeCloseTo(4.5, 9);
  });
});

describe('bands', () => {
  it('sit a standard deviation either side of the middle', () => {
    const flat = fromCloses(new Array(30).fill(100));
    const bands = bollinger(flat, 20, 2);
    expect(
      stddevOf(
        flat.map((c) => c.close),
        20,
      )[25],
    ).toBeCloseTo(0, 9);
    expect(bands.upper[25]).toBeCloseTo(100, 9);
    expect(bands.lower[25]).toBeCloseTo(100, 9);

    const noisy = bollinger(ramp, 20, 2);
    expect(noisy.upper[40]!).toBeGreaterThan(noisy.middle[40]!);
    expect(noisy.lower[40]!).toBeLessThan(noisy.middle[40]!);
  });

  it('track the highest high and lowest low, in a Donchian channel', () => {
    const channel = donchian(ramp, 10);
    // closes rise by one a bar, and each bar's range is a point either side
    expect(channel.upper[20]).toBeCloseTo(ramp[20].high, 9);
    expect(channel.lower[20]).toBeCloseTo(ramp[11].low, 9);
    expect(channel.middle[20]).toBeCloseTo((ramp[20].high + ramp[11].low) / 2, 9);
  });

  it('are ATR-wide in a Keltner channel, and always contain the middle', () => {
    const channel = keltner(ramp, 20, 2, 10);
    expect(channel.upper[40]!).toBeGreaterThan(channel.middle[40]!);
    expect(channel.lower[40]!).toBeLessThan(channel.middle[40]!);
  });
});

describe('range', () => {
  it('takes the widest of the bar and the gaps around the last close', () => {
    const gap = fromCloses([100, 120]);
    // high 121, low 119, previous close 100 -> 21
    expect(trueRange(gap)[1]).toBeCloseTo(21, 9);
  });

  it('smooths into an ATR that is never negative', () => {
    for (const value of atr(ramp, 14)) {
      if (value != null) expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('oscillators', () => {
  it('peg RSI at 100 when nothing ever falls, and at 0 when nothing rises', () => {
    expect(rsi(ramp, 14).at(-1)).toBe(100);
    const falling = fromCloses(Array.from({ length: 40 }, (_, index) => 200 - index));
    expect(rsi(falling, 14).at(-1)).toBe(0);
  });

  it('keep RSI between 0 and 100 on a noisy market', () => {
    const noisy = fromCloses(
      Array.from({ length: 80 }, (_, index) => 100 + Math.sin(index / 3) * 5 + index * 0.1),
    );
    for (const value of rsi(noisy, 14)) {
      if (value != null) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('make MACD the gap between two averages, and the histogram the gap to its signal', () => {
    const lines = macd(ramp, 12, 26, 9);
    const at = 50;
    expect(lines.macd[at]).not.toBeNull();
    expect(lines.histogram[at]).toBeCloseTo(lines.macd[at]! - lines.signal[at]!, 9);
  });

  it('put stochastic at the top of its range in an unbroken rise', () => {
    const { k, d } = stochastic(ramp, 14, 3, 3);
    expect(k.at(-1)!).toBeGreaterThan(90);
    expect(d.at(-1)!).toBeGreaterThan(90);
    for (const value of k) if (value != null) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('keep Williams %R between -100 and 0', () => {
    for (const value of williamsR(ramp, 14)) {
      if (value != null) {
        expect(value).toBeLessThanOrEqual(0);
        expect(value).toBeGreaterThanOrEqual(-100);
      }
    }
  });

  it('read momentum as the change over the window', () => {
    expect(momentum(ramp, 10)[20]).toBeCloseTo(10, 9);
  });

  it('read CCI as positive in a rise and negative in a fall', () => {
    expect(cci(ramp, 20).at(-1)!).toBeGreaterThan(0);
    const falling = fromCloses(Array.from({ length: 60 }, (_, index) => 200 - index));
    expect(cci(falling, 20).at(-1)!).toBeLessThan(0);
  });

  it('read the awesome oscillator as the gap between two midpoint averages', () => {
    expect(awesome(ramp, 5, 34).at(-1)!).toBeGreaterThan(0);
    expect(awesome(ramp, 5, 34)[10]).toBeNull();
  });

  it('give ADX a rising trend to measure, with +DI above -DI', () => {
    const measured = adx(ramp, 14);
    expect(measured.plus.at(-1)!).toBeGreaterThan(measured.minus.at(-1)!);
    expect(measured.adx.at(-1)!).toBeGreaterThan(20);
  });
});

describe('trend tools', () => {
  it('keep the parabolic stop below a rising market', () => {
    const dots = parabolicSar(ramp);
    for (let index = 5; index < ramp.length; index += 1) {
      expect(dots[index]!).toBeLessThanOrEqual(ramp[index].high);
    }
  });

  it('flip the parabolic stop when the market turns', () => {
    const turn = fromCloses([
      ...Array.from({ length: 30 }, (_, index) => 100 + index),
      ...Array.from({ length: 30 }, (_, index) => 130 - index * 2),
    ]);
    const dots = parabolicSar(turn);
    // below the market while it rose, above it once it fell hard
    expect(dots[25]!).toBeLessThan(turn[25].close);
    expect(dots.at(-1)!).toBeGreaterThan(turn.at(-1)!.close);
  });

  it('keep SuperTrend below a rising market and say it is rising', () => {
    const trend = superTrend(ramp, 10, 3);
    expect(trend.line.at(-1)!).toBeLessThan(ramp.at(-1)!.close);
    expect(trend.rising.at(-1)).toBe(true);
  });

  it("shift Ichimoku's spans forward and its lagging line back", () => {
    const cloud = ichimoku(ramp, 9, 26, 52);
    // the span at bar 55 is the value computed 26 bars earlier — and bar 29 is
    // the first that has one, because the base line needs 26 bars of its own
    expect(cloud.spanA[55]).toBeCloseTo((cloud.conversion[29]! + cloud.base[29]!) / 2, 9);
    expect(cloud.spanA[40]).toBeNull();
    expect(cloud.lagging[10]).toBeCloseTo(ramp[36].close, 9);
    expect(cloud.lagging.at(-1)).toBeNull();
  });

  it("shift each of the Alligator's jaws by its own offset", () => {
    const jaws = alligator(ramp);
    expect(jaws.lips[30]).not.toBeNull();
    expect(jaws.jaw[30]).not.toBeNull();
    // the lips are the fastest and sit nearest the price in a rise
    expect(jaws.lips[40]!).toBeGreaterThan(jaws.teeth[40]!);
    expect(jaws.teeth[40]!).toBeGreaterThan(jaws.jaw[40]!);
  });
});

describe('structure', () => {
  it('marks a fractal only where a bar is the extreme of its five', () => {
    const peak = fromCloses([100, 101, 105, 101, 100, 99, 98]);
    const marks = fractals(peak);
    expect(marks.up[2]).toBeCloseTo(peak[2].high, 9);
    expect(marks.up[1]).toBeNull();
    // the last two bars can never carry one: it is not knowable yet
    expect(marks.up.at(-1)).toBeNull();
    expect(marks.down.at(-1)).toBeNull();
  });

  it('joins up only the swings worth calling swings', () => {
    const swings = fromCloses([100, 101, 100.5, 110, 109, 100, 101, 112]);
    const line = zigzag(swings, 5);
    const turns = line.filter((value) => value != null);
    // four turns: the start, the top, the bottom, and the running end
    expect(turns.length).toBeGreaterThanOrEqual(3);
    expect(turns.length).toBeLessThanOrEqual(5);

    // noise below the threshold produces no turns at all
    const quiet = fromCloses(Array.from({ length: 40 }, (_, index) => 100 + (index % 2) * 0.1));
    expect(zigzag(quiet, 5).filter((value) => value != null)).toHaveLength(1);
  });
});

describe('every indicator', () => {
  const short = fromCloses([100, 101]);

  it('survives a series far shorter than its window', () => {
    expect(() => {
      sma(short, 20);
      ema(short, 20);
      wma(short, 20);
      bollinger(short);
      donchian(short);
      keltner(short);
      rsi(short);
      macd(short);
      stochastic(short);
      williamsR(short);
      cci(short);
      momentum(short);
      awesome(short);
      adx(short);
      parabolicSar(short);
      superTrend(short);
      ichimoku(short);
      alligator(short);
      fractals(short);
      zigzag(short);
      atr(short);
    }).not.toThrow();
  });

  it('survives no candles at all', () => {
    expect(sma([], 20)).toEqual([]);
    expect(rsi([])).toEqual([]);
    expect(macd([]).macd).toEqual([]);
    expect(zigzag([])).toEqual([]);
    expect(fractals([]).up).toEqual([]);
  });
});
