import type { Candle, Trade } from '../lib/types';
import { barWidth, xOf } from './scales';
import type { Plot, Viewport } from './types';

/**
 * What the chart says about a trader's own positions.
 *
 * The numbers here are the ones a trader acts on — whether a position is
 * winning, how long is left, whether a boundary can still be bought — so they
 * are computed in one place and tested, rather than worked out inside a paint
 * call where nobody can see them.
 */

/** Seconds between bars, read from the data rather than passed in and trusted. */
export function spacingOf(candles: Candle[]): number {
  if (candles.length < 2) return 60;
  // the last pair, which is the live end of the tape and never a gap
  const gap = candles[candles.length - 1].time - candles[candles.length - 2].time;
  return gap > 0 ? gap : 60;
}

/**
 * Where an instant falls on the x axis, including one past the newest bar:
 * an expiry is usually in the future, which is the whole point of drawing it.
 */
export function xOfTime(timeSec: number, candles: Candle[], view: Viewport, plot: Plot): number | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const spacing = spacingOf(candles);
  const index = candles.length - 1 + (timeSec - last.time) / spacing;
  return xOf(index, view, plot);
}

/**
 * What an open position is worth right now.
 *
 * A binary option is all or nothing: at this price it either returns the stake
 * plus the payout, or nothing at all. So the live number is not a fraction of
 * anything — it is the result the position would settle at if the market
 * stopped this second, which is exactly what a trader wants to see.
 */
export function liveProfit(trade: Trade, price: number | null): number {
  if (price == null || !Number.isFinite(price)) return 0;
  if (price === trade.entryPrice) return 0; // a tie refunds the stake
  const winning = trade.direction === 'UP' ? price > trade.entryPrice : price < trade.entryPrice;
  return winning ? Math.floor((trade.stake * trade.payoutPct) / 100) : -trade.stake;
}

export type TradeStanding = 'winning' | 'losing' | 'level';

export function standingOf(trade: Trade, price: number | null): TradeStanding {
  if (price == null || price === trade.entryPrice) return 'level';
  const winning = trade.direction === 'UP' ? price > trade.entryPrice : price < trade.entryPrice;
  return winning ? 'winning' : 'losing';
}

/** "0:42", "12s", "—" once it has run out. */
export function countdownTo(expiresAtMs: number, nowMs: number): string {
  const left = Math.floor((expiresAtMs - nowMs) / 1000);
  if (left <= 0) return 'now';
  if (left < 60) return `${left}s`;
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The band before a clock boundary in which it can no longer be bought.
 *
 * Returns nothing when the cut-off has not been reached yet — the shading is
 * there to say "too late for this one", so drawing it early would be a lie.
 */
export function cutoffBand(options: {
  expiresAtMs: number;
  cutoffSec: number;
  nowMs: number;
}): { fromMs: number; toMs: number } | null {
  const closesAt = options.expiresAtMs - options.cutoffSec * 1000;
  if (options.cutoffSec <= 0) return null;
  if (options.nowMs < closesAt) return null;
  if (options.nowMs >= options.expiresAtMs) return null;
  return { fromMs: closesAt, toMs: options.expiresAtMs };
}

/** A soft pulse for the live dot: one breath per second, never fully gone. */
export function pulseAlpha(elapsedMs: number): number {
  const phase = (elapsedMs % 1_000) / 1_000;
  return 0.35 + 0.35 * (1 + Math.cos(phase * 2 * Math.PI)) * 0.5;
}

/** How wide the pulse ring is drawn at this point in the breath. */
export function pulseRadius(elapsedMs: number, base = 4): number {
  const phase = (elapsedMs % 1_000) / 1_000;
  return base + base * 1.6 * phase;
}

/** Keeps a tag inside the plot, so a label near the edge is still readable. */
export function clampLabel(x: number, width: number, plot: Plot): number {
  return Math.min(Math.max(x - width / 2, 2), Math.max(plot.width - width - 2, 2));
}

/** Whether two horizontal lines would print their tags on top of each other. */
export function collides(a: number, b: number, height = 18): boolean {
  return Math.abs(a - b) < height;
}

/** Bars per pixel, for deciding whether an expiry line is even on screen. */
export function onScreen(x: number | null, plot: Plot, margin = 2): x is number {
  return x != null && x >= -margin && x <= plot.width + margin;
}

export { barWidth };
