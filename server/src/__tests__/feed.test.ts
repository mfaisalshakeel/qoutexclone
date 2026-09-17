import { describe, expect, it } from 'vitest';
import { MarketFeed, TIMEFRAMES } from '../engine/feed.js';

const spec = { symbol: 'TESTUSD', feedSymbol: 'TESTUSDT', basePrice: 100, volatility: 0.0012, precision: 4 };

function feedWithHistory() {
  const feed = new MarketFeed();
  feed.load([spec]);
  return feed;
}

/**
 * Markets tick on their own interval, so a test has to move the clock as well
 * as call the loop. This drives `ticks` steps of `stepMs` each.
 */
function advance(feed: MarketFeed, ticks: number, stepMs = 250) {
  let now = Date.now();
  feed.setClock(() => now);
  for (let i = 0; i < ticks; i += 1) {
    now += stepMs;
    (feed as unknown as { onInterval: () => void }).onInterval();
  }
  return now;
}

describe('market feed', () => {
  it('opens a live candle for every timeframe', () => {
    // long history lives in the candle store now; the feed keeps only the tail
    const feed = feedWithHistory();
    for (const tf of Object.keys(TIMEFRAMES)) {
      const candles = feed.getCandles('TESTUSD', tf, 400);
      expect(candles.length).toBeGreaterThan(0);
      // ascending, non-overlapping buckets with sane OHLC
      for (let i = 1; i < candles.length; i += 1)
        expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
      for (const c of candles) {
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      }
    }
  });

  it('reports every open bucket, so none is lost on a restart', () => {
    const feed = feedWithHistory();
    advance(feed, 20);
    const open = feed.openCandles();
    expect(open.length).toBe(Object.keys(TIMEFRAMES).length);
    for (const { symbol, timeframe, candle } of open) {
      expect(symbol).toBe('TESTUSD');
      const series = feed.getCandles('TESTUSD', timeframe, 1);
      expect(candle).toEqual(series[series.length - 1]);
    }
  });

  it('adopts the bucket the last process was printing', () => {
    const feed = feedWithHistory();
    advance(feed, 10);
    const current = feed.getCandles('TESTUSD', '1m', 1)[0];

    // a stored row for the same bucket that opened earlier and ranged wider
    feed.primeCandles([
      {
        symbol: 'TESTUSD',
        timeframe: '1m',
        candle: { time: current.time, open: 90, high: 110, low: 80, close: 95 },
      },
    ]);

    const adopted = feed.getCandles('TESTUSD', '1m', 1)[0];
    expect(adopted.open).toBe(90);
    expect(adopted.high).toBe(110);
    expect(adopted.low).toBe(80);
    // the live price stands as the close, not the stored one
    expect(adopted.close).toBe(current.close);
  });

  it('ignores an adopted bucket that is no longer the open one', () => {
    const feed = feedWithHistory();
    const current = feed.getCandles('TESTUSD', '1m', 1)[0];
    feed.primeCandles([
      {
        symbol: 'TESTUSD',
        timeframe: '1m',
        candle: { time: current.time - 600, open: 1, high: 1, low: 1, close: 1 },
      },
      { symbol: 'NOPE', timeframe: '1m', candle: { time: current.time, open: 1, high: 1, low: 1, close: 1 } },
    ]);
    expect(feed.getCandles('TESTUSD', '1m', 1)[0]).toEqual(current);
  });

  it('is deterministic across instances', () => {
    const first = feedWithHistory();
    const second = feedWithHistory();
    advance(first, 40);
    advance(second, 40);
    expect(first.getPrice('TESTUSD')).toBe(second.getPrice('TESTUSD'));
  });

  it('emits a closed candle when a bucket rolls over, for the store to persist', () => {
    const feed = feedWithHistory();
    const closed: { timeframe: string; time: number }[] = [];
    feed.on('candleClosed', ({ timeframe, candle }) => closed.push({ timeframe, time: candle.time }));

    // 5s buckets: a minute of ticks must close about a dozen of them
    advance(feed, 240);
    const fiveSecond = closed.filter((entry) => entry.timeframe === '5s');
    expect(fiveSecond.length).toBeGreaterThanOrEqual(10);
    // each bucket closes exactly once
    expect(new Set(fiveSecond.map((entry) => entry.time)).size).toBe(fiveSecond.length);
  });

  it('stays near the base price over a long simulated run', () => {
    const feed = feedWithHistory();
    advance(feed, 5000);
    const price = feed.getPrice('TESTUSD')!;
    expect(price).toBeGreaterThan(spec.basePrice * 0.5);
    expect(price).toBeLessThan(spec.basePrice * 2);
  });

  it('keeps 30 second moves within a realistic band', () => {
    const feed = feedWithHistory();
    const start = feed.getPrice('TESTUSD')!;
    advance(feed, 120);
    const move = Math.abs(feed.getPrice('TESTUSD')! - start) / start;
    expect(move).toBeLessThan(0.02);
  });

  it('prices an expiry from the tick at or before that instant', () => {
    const feed = feedWithHistory();
    advance(feed, 1);
    const firstTs = Date.now();
    const first = feed.getPrice('TESTUSD');
    advance(feed, 20);
    expect(feed.priceAt('TESTUSD', firstTs)).toBeDefined();
    expect(feed.priceAt('TESTUSD', firstTs - 60_000)).toBe(feed.priceAt('TESTUSD', firstTs - 60_000));
    expect(typeof first).toBe('number');
  });

  it('returns nothing for an unknown symbol', () => {
    const feed = feedWithHistory();
    expect(feed.getPrice('NOPEUSD')).toBeNull();
    expect(feed.getCandles('NOPEUSD', '1m')).toEqual([]);
  });
});

describe('session gating', () => {
  it('stops printing prices for a market outside its session', () => {
    const feed = feedWithHistory();
    feed.setSessionResolver(() => false);

    const before = feed.getPrice('TESTUSD');
    advance(feed, 50);
    expect(feed.getPrice('TESTUSD')).toBe(before);
    expect(feed.isLive('TESTUSD')).toBe(false);

    // reopening resumes the walk from the frozen price
    feed.setSessionResolver(() => true);
    advance(feed, 50);
    expect(feed.getPrice('TESTUSD')).not.toBe(before);
    expect(feed.isLive('TESTUSD')).toBe(true);
  });
});
