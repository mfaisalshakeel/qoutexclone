import { describe, expect, it } from 'vitest';
import {
  clampLabel,
  collides,
  countdownTo,
  cutoffBand,
  liveProfit,
  onScreen,
  pulseAlpha,
  pulseRadius,
  spacingOf,
  standingOf,
  xOfTime,
} from './overlays';
import { xOf } from './scales';
import type { Candle, Trade } from '../lib/types';

const plot = { width: 800, height: 400 };
const view = { rightIndex: 99, barsVisible: 100 };

const candles: Candle[] = Array.from({ length: 100 }, (_, index) => ({
  time: 1_700_000_000 + index * 60,
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
}));

const trade = (over: Partial<Trade> = {}): Trade =>
  ({
    id: 't1',
    symbol: 'EURUSD',
    accountType: 'DEMO',
    direction: 'UP',
    stake: 1_000,
    payoutPct: 85,
    entryPrice: 100,
    exitPrice: null,
    durationSec: 60,
    openedAt: '2026-09-19T10:00:00.000Z',
    expiresAt: '2026-09-19T10:01:00.000Z',
    settledAt: null,
    status: 'OPEN',
    profit: 0,
    potentialProfit: 850,
    ...over,
  }) as Trade;

describe('an open position on the chart', () => {
  it('is worth the payout when it is in front, and the stake when it is not', () => {
    expect(liveProfit(trade(), 100.5)).toBe(850);
    expect(liveProfit(trade(), 99.5)).toBe(-1_000);
    expect(liveProfit(trade({ direction: 'DOWN' }), 99.5)).toBe(850);
    expect(liveProfit(trade({ direction: 'DOWN' }), 100.5)).toBe(-1_000);
  });

  it('is worth nothing at all at exactly the entry, because a tie refunds', () => {
    expect(liveProfit(trade(), 100)).toBe(0);
    expect(standingOf(trade(), 100)).toBe('level');
  });

  it('says which way it stands, and says nothing without a price', () => {
    expect(standingOf(trade(), 100.5)).toBe('winning');
    expect(standingOf(trade(), 99)).toBe('losing');
    expect(standingOf(trade(), null)).toBe('level');
    expect(liveProfit(trade(), null)).toBe(0);
  });
});

describe('time on the x axis', () => {
  it('reads the bar spacing off the tape', () => {
    expect(spacingOf(candles)).toBe(60);
    expect(spacingOf([])).toBe(60);
    expect(spacingOf(candles.slice(0, 1))).toBe(60);
  });

  it('places an instant on a bar it already has', () => {
    const at = xOfTime(candles[50].time, candles, view, plot);
    expect(at).toBeCloseTo(xOf(50, view, plot), 6);
  });

  it('places an expiry beyond the newest bar, which is where expiries live', () => {
    const last = candles[candles.length - 1].time;
    const future = xOfTime(last + 180, candles, view, plot)!;
    expect(future).toBeGreaterThan(xOf(candles.length - 1, view, plot));
    // three bars of 60s into the future
    expect(future).toBeCloseTo(xOf(candles.length - 1 + 3, view, plot), 6);
  });

  it('has nowhere to put anything without candles', () => {
    expect(xOfTime(1, [], view, plot)).toBeNull();
  });

  it('knows what is off the edge of the plot', () => {
    expect(onScreen(400, plot)).toBe(true);
    expect(onScreen(-40, plot)).toBe(false);
    expect(onScreen(null, plot)).toBe(false);
  });
});

describe('the countdown', () => {
  const now = Date.UTC(2026, 8, 19, 10, 0, 0);

  it('counts seconds, then minutes, then hours', () => {
    expect(countdownTo(now + 42_000, now)).toBe('42s');
    expect(countdownTo(now + 90_000, now)).toBe('1:30');
    expect(countdownTo(now + 3 * 3_600_000 + 300_000, now)).toBe('3h 05m');
  });

  it('says "now" rather than counting backwards past the expiry', () => {
    expect(countdownTo(now, now)).toBe('now');
    expect(countdownTo(now - 5_000, now)).toBe('now');
  });
});

describe('the purchase cut-off', () => {
  const expiresAtMs = Date.UTC(2026, 8, 19, 10, 5, 0);

  it('is not shaded while the boundary can still be bought', () => {
    expect(cutoffBand({ expiresAtMs, cutoffSec: 30, nowMs: expiresAtMs - 31_000 })).toBeNull();
  });

  it('shades the last stretch once buying has closed', () => {
    const band = cutoffBand({ expiresAtMs, cutoffSec: 30, nowMs: expiresAtMs - 20_000 })!;
    expect(band.fromMs).toBe(expiresAtMs - 30_000);
    expect(band.toMs).toBe(expiresAtMs);
  });

  it('stops once the boundary has passed, and when there is no cut-off at all', () => {
    expect(cutoffBand({ expiresAtMs, cutoffSec: 30, nowMs: expiresAtMs })).toBeNull();
    expect(cutoffBand({ expiresAtMs, cutoffSec: 0, nowMs: expiresAtMs - 1_000 })).toBeNull();
  });
});

describe('the live dot', () => {
  it('breathes once a second and never disappears', () => {
    for (let ms = 0; ms < 3_000; ms += 37) {
      const alpha = pulseAlpha(ms);
      expect(alpha).toBeGreaterThan(0.3);
      expect(alpha).toBeLessThanOrEqual(1);
    }
    expect(pulseAlpha(0)).toBeCloseTo(pulseAlpha(1_000), 9);
  });

  it('spreads as it fades, and starts over each second', () => {
    expect(pulseRadius(0)).toBeLessThan(pulseRadius(900));
    expect(pulseRadius(0)).toBeCloseTo(pulseRadius(1_000), 9);
  });
});

describe('labels', () => {
  it('stay inside the plot at either edge', () => {
    expect(clampLabel(0, 60, plot)).toBe(2);
    expect(clampLabel(800, 60, plot)).toBe(738);
    expect(clampLabel(400, 60, plot)).toBe(370);
  });

  it('know when two of them would overlap', () => {
    expect(collides(100, 110)).toBe(true);
    expect(collides(100, 140)).toBe(false);
  });
});
