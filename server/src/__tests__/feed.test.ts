import { describe, expect, it } from 'vitest';
import { MarketFeed, TIMEFRAMES } from '../engine/feed.js';

const spec = { symbol: 'TESTUSD', feedSymbol: 'TESTUSDT', basePrice: 100, volatility: 0.0012, precision: 4 };

function feedWithHistory() {
  const feed = new MarketFeed();
  feed.load([spec]);
  return feed;
}

describe('market feed', () => {
  it('back-fills history for every timeframe', () => {
    const feed = feedWithHistory();
    for (const tf of Object.keys(TIMEFRAMES)) {
      const candles = feed.getCandles('TESTUSD', tf, 400);
      expect(candles.length).toBeGreaterThan(100);
      // ascending, non-overlapping buckets with sane OHLC
      for (let i = 1; i < candles.length; i += 1)
        expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
      for (const c of candles) {
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      }
    }
  });

  it('is deterministic across instances', () => {
    expect(feedWithHistory().getCandles('TESTUSD', '1m', 20)).toEqual(
      feedWithHistory().getCandles('TESTUSD', '1m', 20),
    );
  });

  it('stays near the base price over a long simulated run', () => {
    const feed = feedWithHistory();
    for (let i = 0; i < 5000; i += 1) feed['onInterval']();
    const price = feed.getPrice('TESTUSD')!;
    expect(price).toBeGreaterThan(spec.basePrice * 0.5);
    expect(price).toBeLessThan(spec.basePrice * 2);
  });

  it('keeps 30 second moves within a realistic band', () => {
    const feed = feedWithHistory();
    const start = feed.getPrice('TESTUSD')!;
    for (let i = 0; i < 120; i += 1) feed['onInterval']();
    const move = Math.abs(feed.getPrice('TESTUSD')! - start) / start;
    expect(move).toBeLessThan(0.02);
  });

  it('prices an expiry from the tick at or before that instant', () => {
    const feed = feedWithHistory();
    feed['onInterval']();
    const firstTs = Date.now();
    const first = feed.getPrice('TESTUSD');
    for (let i = 0; i < 20; i += 1) feed['onInterval']();
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
