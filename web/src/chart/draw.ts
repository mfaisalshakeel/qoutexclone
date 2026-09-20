import type { Candle } from '../lib/types';
import { barWidth, indexAt, priceTicks, timeTicks, visibleSlice, xOf, yOf } from './scales';
import {
  clampLabel,
  collides,
  countdownTo,
  cutoffBand,
  liveProfit,
  onScreen,
  pulseAlpha,
  pulseRadius,
  standingOf,
  xOfTime,
} from './overlays';
import { extend, fibLevels, type Drawing, type Screen } from './drawings';
import { isBarSeries } from './series';
import { THEME, type Frame } from './types';

/**
 * The painting. Each function takes a context and a frame and draws one layer —
 * no state, no reading back from the canvas, nothing that needs a browser to
 * reason about beyond the 2D context itself.
 */

/** The axis gutters, in CSS pixels. */
export const PRICE_AXIS_WIDTH = 62;
export const TIME_AXIS_HEIGHT = 22;

const FONT = '11px Inter, system-ui, sans-serif';

export function formatPrice(value: number, precision: number): string {
  return value.toFixed(precision);
}

/** A label for the time axis: the clock, and the date when the day turns over. */
export function formatTime(seconds: number, options: { withDate?: boolean } = {}): string {
  const at = new Date(seconds * 1000);
  const clock = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (!options.withDate) return clock;
  return `${at.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${clock}`;
}

/**
 * Grid lines and the two axes.
 *
 * A pane draws its own share: the price levels belong to whichever pane is
 * being drawn, and the time axis belongs to the bottom one, because the chart
 * has several panes but only ever one clock.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: { prices?: boolean; time?: boolean } = {},
): void {
  const { plot, range, view, candles, precision } = frame;
  const withPrices = options.prices ?? true;
  const withTime = options.time ?? true;

  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, plot.width + PRICE_AXIS_WIDTH, plot.height + (withTime ? TIME_AXIS_HEIGHT : 0));

  ctx.font = FONT;
  ctx.strokeStyle = THEME.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = 'middle';

  // price levels, labelled in the right gutter
  ctx.textAlign = 'left';
  for (const level of withPrices ? priceTicks(range, Math.max(3, Math.round(plot.height / 70))) : []) {
    const y = Math.round(yOf(level, range, plot)) + 0.5;
    if (y < 0 || y > plot.height) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plot.width, y);
    ctx.stroke();
    ctx.fillText(formatPrice(level, precision), plot.width + 6, y);
  }

  // times along the bottom. Every tick gets a grid line; a label is only drawn
  // where it fits, because the width of "18 Sep 04:00" depends on the font and
  // guessing it is how an axis ends up with labels printed over each other.
  ctx.textAlign = 'center';
  const ticks = timeTicks(candles, view, plot);
  let previousDay = '';
  let usedUntil = -Infinity;
  for (const tick of ticks) {
    const x = Math.round(xOf(tick.index, view, plot)) + 0.5;
    if (x < 0 || x > plot.width) continue;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plot.height);
    ctx.stroke();

    if (!withTime) continue;
    const day = new Date(tick.time * 1000).toDateString();
    const label = formatTime(tick.time, { withDate: day !== previousDay });
    previousDay = day;
    const half = ctx.measureText(label).width / 2 + 6;
    if (x - half < usedUntil || x + half > plot.width) continue;
    ctx.fillText(label, x, plot.height + 11);
    usedUntil = x + half;
  }

  // the gutters' own borders
  ctx.strokeStyle = THEME.axis;
  ctx.beginPath();
  ctx.moveTo(plot.width + 0.5, 0);
  ctx.lineTo(plot.width + 0.5, plot.height);
  if (withTime) {
    ctx.moveTo(0, plot.height + 0.5);
    ctx.lineTo(plot.width + PRICE_AXIS_WIDTH, plot.height + 0.5);
  }
  ctx.stroke();
}

/**
 * Candles, bars or a line.
 *
 * Two things keep this cheap when the chart is holding thousands of bars.
 *
 * First, when the bars are narrower than a pixel, several of them share a
 * column: those are aggregated into one — first open, last close, highest high,
 * lowest low — so the work is bounded by the width of the plot rather than by
 * the size of the history. That is not an approximation of the picture; it is
 * the same picture, drawn once per column instead of ten times.
 *
 * Second, everything of one colour is drawn in one go: two paths for the wicks
 * and two batches of bodies, rather than a state change per candle. Setting
 * `strokeStyle` five thousand times a frame is most of the cost of a naive
 * renderer.
 */
export function drawSeries(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { candles, view, range, plot, type } = frame;
  ctx.clearRect(0, 0, plot.width + PRICE_AXIS_WIDTH, plot.height + TIME_AXIS_HEIGHT);
  if (candles.length === 0) return;

  const slice = visibleSlice(candles.length, view);
  if (!isBarSeries(type)) {
    drawLine(ctx, frame, slice, { filled: type === 'area' });
    return;
  }

  const width = barWidth(view, plot);
  const body = Math.max(1, Math.min(width * 0.7, width - 1));
  const thin = body <= 2;
  const tick = Math.max(1, Math.min(width * 0.35, 6));
  // several bars to a pixel: they are drawn as the column they occupy
  const perColumn = Math.max(1, Math.ceil(1 / Math.max(width, 0.0001)));

  const upWicks = new Path2D();
  const downWicks = new Path2D();
  const upBodies: number[][] = [];
  const downBodies: number[][] = [];

  for (let index = slice.from; index <= slice.to; index += perColumn) {
    let candle = candles[index];
    if (!candle) continue;

    if (perColumn > 1) {
      // the column's own open, close, high and low
      let high = candle.high;
      let low = candle.low;
      const open = candle.open;
      let close = candle.close;
      for (let step = 1; step < perColumn && index + step <= slice.to; step += 1) {
        const next = candles[index + step];
        if (!next) break;
        if (next.high > high) high = next.high;
        if (next.low < low) low = next.low;
        close = next.close;
      }
      candle = { time: candle.time, open, high, low, close };
    }

    const x = xOf(index + (perColumn - 1) / 2, view, plot);
    const up = candle.close >= candle.open;
    const high = yOf(candle.high, range, plot);
    const low = yOf(candle.low, range, plot);
    const open = yOf(candle.open, range, plot);
    const close = yOf(candle.close, range, plot);
    const spine = Math.round(x) + 0.5;

    const wicks = up ? upWicks : downWicks;
    wicks.moveTo(spine, high);
    wicks.lineTo(spine, low);

    if (type === 'bars') {
      wicks.moveTo(spine - tick, Math.round(open) + 0.5);
      wicks.lineTo(spine, Math.round(open) + 0.5);
      wicks.moveTo(spine, Math.round(close) + 0.5);
      wicks.lineTo(spine + tick, Math.round(close) + 0.5);
      continue;
    }

    if (thin) continue;
    const top = Math.min(open, close);
    const height = Math.max(Math.abs(close - open), 1);
    (up ? upBodies : downBodies).push([
      Math.round(x - body / 2),
      Math.round(top),
      Math.round(body),
      Math.round(height),
    ]);
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.up;
  ctx.stroke(upWicks);
  ctx.strokeStyle = THEME.down;
  ctx.stroke(downWicks);

  ctx.fillStyle = THEME.up;
  for (const [x, y, w, h] of upBodies) ctx.fillRect(x, y, w, h);
  ctx.fillStyle = THEME.down;
  for (const [x, y, w, h] of downBodies) ctx.fillRect(x, y, w, h);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  slice: { from: number; to: number },
  options: { filled: boolean },
) {
  const { candles, view, range, plot } = frame;
  ctx.beginPath();
  for (let index = slice.from; index <= slice.to; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    const x = xOf(index, view, plot);
    const y = yOf(candle.close, range, plot);
    if (index === slice.from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = THEME.line;
  ctx.stroke();

  if (options.filled) {
    ctx.lineTo(xOf(slice.to, view, plot), plot.height);
    ctx.lineTo(xOf(slice.from, view, plot), plot.height);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, plot.height);
    gradient.addColorStop(0, THEME.lineFillTop);
    gradient.addColorStop(1, THEME.lineFillBottom);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  ctx.restore();
}

/** Indicator polylines, drawn over the series and under the overlays. */
export function drawIndicators(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { lines, candles, view, range, plot } = frame;
  if (lines.length === 0 || candles.length === 0) return;
  const slice = visibleSlice(candles.length, view);

  for (const line of lines) {
    ctx.save();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.2;
    if (line.dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    let drawing = false;
    for (let index = slice.from; index <= slice.to; index += 1) {
      const value = line.points[index];
      if (value == null || !Number.isFinite(value)) {
        drawing = false;
        continue;
      }
      const x = xOf(index, view, plot);
      const y = yOf(value, range, plot);
      if (!drawing) {
        ctx.moveTo(x, y);
        drawing = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** A price with a label in the gutter — the last price, a strike, a level. */
export function drawPriceLine(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: { price: number; color: string; dashed?: boolean; label?: string; tag?: string },
): void {
  const { range, plot, precision } = frame;
  const y = Math.round(yOf(options.price, range, plot)) + 0.5;
  if (y < -2 || y > plot.height + 2) return;

  ctx.save();
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 1;
  if (options.dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plot.width, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // the price itself, in the gutter
  ctx.fillStyle = options.color;
  ctx.fillRect(plot.width + 1, y - 8, PRICE_AXIS_WIDTH - 1, 16);
  ctx.fillStyle = '#ffffff';
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(options.label ?? formatPrice(options.price, precision), plot.width + 6, y);

  // and a tag on the line itself, for what the level means
  if (options.tag) {
    ctx.textAlign = 'left';
    const width = ctx.measureText(options.tag).width + 10;
    ctx.fillStyle = options.color;
    ctx.fillRect(6, y - 9, width, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(options.tag, 11, y);
  }
  ctx.restore();
}

/** The crosshair, its axis labels and the bar's OHLC. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { crosshair, plot, range, view, candles, precision } = frame;
  ctx.clearRect(0, 0, plot.width + PRICE_AXIS_WIDTH, plot.height + TIME_AXIS_HEIGHT);
  if (!crosshair) return;

  const { x, y } = crosshair;
  if (x < 0 || x > plot.width || y < 0 || y > plot.height) return;

  // the vertical line snaps to the bar being read, so the line and the tooltip
  // can never disagree about which candle is under the pointer
  const index = Math.round(indexAt(x, view, plot));
  const snapped = candles[index] ? xOf(index, view, plot) : x;

  ctx.save();
  ctx.strokeStyle = THEME.crosshair;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(snapped) + 0.5, 0);
  ctx.lineTo(Math.round(snapped) + 0.5, plot.height);
  ctx.moveTo(0, Math.round(y) + 0.5);
  ctx.lineTo(plot.width, Math.round(y) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';

  // the price under the pointer, in the gutter
  const price = range.min + ((plot.height - y) / plot.height) * (range.max - range.min);
  ctx.fillStyle = THEME.label;
  ctx.fillRect(plot.width + 1, y - 8, PRICE_AXIS_WIDTH - 1, 16);
  ctx.fillStyle = THEME.labelText;
  ctx.textAlign = 'left';
  ctx.fillText(formatPrice(price, precision), plot.width + 6, y);

  // the time under the pointer, on the axis
  const candle = candles[index];
  if (candle) {
    const label = formatTime(candle.time, { withDate: true });
    const width = ctx.measureText(label).width + 12;
    const left = Math.min(Math.max(snapped - width / 2, 0), plot.width - width);
    ctx.fillStyle = THEME.label;
    ctx.fillRect(left, plot.height + 2, width, 17);
    ctx.fillStyle = THEME.labelText;
    ctx.textAlign = 'center';
    ctx.fillText(label, left + width / 2, plot.height + 11);
    drawTooltip(ctx, frame, candle);
  }
  ctx.restore();
}

/** The hovered bar's numbers, in the corner the pointer is not in. */
function drawTooltip(ctx: CanvasRenderingContext2D, frame: Frame, candle: Candle): void {
  const { plot, precision, crosshair } = frame;
  const rows = [
    ['O', formatPrice(candle.open, precision)],
    ['H', formatPrice(candle.high, precision)],
    ['L', formatPrice(candle.low, precision)],
    ['C', formatPrice(candle.close, precision)],
  ];

  const width = 104;
  const height = 18 * rows.length + 10;
  const left = crosshair && crosshair.x > plot.width / 2 ? 8 : plot.width - width - 8;
  const top = 8;

  ctx.save();
  ctx.fillStyle = 'rgba(15,20,33,0.92)';
  ctx.strokeStyle = THEME.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 8);
  ctx.fill();
  ctx.stroke();

  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  const up = candle.close >= candle.open;
  rows.forEach(([key, value], row) => {
    const y = top + 14 + row * 18;
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'left';
    ctx.fillText(key, left + 10, y);
    ctx.fillStyle = up ? THEME.up : THEME.down;
    ctx.textAlign = 'right';
    ctx.fillText(value, left + width - 10, y);
  });
  ctx.restore();
}

/**
 * A trader's own positions, the live price and the clock.
 *
 * This is the layer that changes every second without the data changing, which
 * is why it has a canvas of its own: the candles underneath keep their pixels
 * while the countdown ticks.
 */
export function drawTradeOverlays(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  options: {
    /** The live price, which is the real close even on a smoothed series. */
    price: number | null;
    nowMs: number;
    /** Seconds before a clock boundary at which buying closes. */
    cutoffSec: number;
    /** Milliseconds since the last tick arrived, for the pulse. */
    sinceTickMs: number;
  },
): void {
  const { plot, range, view, candles, trades, precision } = frame;
  ctx.clearRect(0, 0, plot.width + PRICE_AXIS_WIDTH, plot.height + TIME_AXIS_HEIGHT);
  if (candles.length === 0) return;

  const open = trades.filter((trade) => trade.status === 'OPEN');

  // the shaded stretch where a clock boundary can no longer be bought
  for (const trade of open) {
    if (trade.expiryMode !== 'CLOCK') continue;
    const band = cutoffBand({
      expiresAtMs: new Date(trade.expiresAt).getTime(),
      cutoffSec: options.cutoffSec,
      nowMs: options.nowMs,
    });
    if (!band) continue;
    const from = xOfTime(band.fromMs / 1000, candles, view, plot);
    const to = xOfTime(band.toMs / 1000, candles, view, plot);
    if (from == null || to == null) continue;
    ctx.save();
    ctx.fillStyle = 'rgba(240,69,94,0.10)';
    ctx.fillRect(from, 0, Math.max(to - from, 1), plot.height);
    ctx.restore();
  }

  // one strike line per position, with what it is worth right now
  const used: number[] = [];
  for (const trade of open) {
    const winning = standingOf(trade, options.price);
    const colour = trade.direction === 'UP' ? THEME.up : THEME.down;
    const profit = liveProfit(trade, options.price);
    const money = `${profit > 0 ? '+' : profit < 0 ? '−' : ''}$${Math.abs(profit / 100).toFixed(2)}`;
    const tag = `${trade.direction === 'UP' ? '▲' : '▼'} $${(trade.stake / 100).toFixed(0)} · ${money}`;

    const y = yOf(trade.entryPrice, range, plot);
    // a second position at nearly the same price would print over the first
    const shifted = used.some((each) => collides(each, y)) ? y + 20 : y;
    used.push(shifted);

    drawPriceLine(ctx, frame, { price: trade.entryPrice, color: colour, dashed: true });
    if (shifted >= -10 && shifted <= plot.height + 10) {
      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const width = ctx.measureText(tag).width + 12;
      ctx.fillStyle = winning === 'winning' ? THEME.up : winning === 'losing' ? THEME.down : THEME.label;
      ctx.beginPath();
      ctx.roundRect(6, shifted - 9, width, 18, 5);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tag, 12, shifted);
      ctx.restore();
    }

    // and a line at the instant it settles, with the time left on it
    const expiresAtMs = new Date(trade.expiresAt).getTime();
    const x = xOfTime(expiresAtMs / 1000, candles, view, plot);
    if (!onScreen(x, plot)) continue;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, plot.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const left = countdownTo(expiresAtMs, options.nowMs);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const width = ctx.measureText(left).width + 12;
    const boxX = clampLabel(x, width, plot);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(boxX, 6, width, 17, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(left, boxX + width / 2, 15);
    ctx.restore();
  }

  // the live price, and a dot that breathes with each tick
  const last = candles[candles.length - 1];
  const price = options.price ?? last.close;
  drawPriceLine(ctx, frame, {
    price,
    color: price >= last.open ? THEME.up : THEME.down,
    dashed: true,
    label: formatPrice(price, precision),
  });

  const dotX = xOf(candles.length - 1, view, plot);
  const dotY = yOf(price, range, plot);
  if (dotX >= 0 && dotX <= plot.width && dotY >= 0 && dotY <= plot.height) {
    const colour = price >= last.open ? THEME.up : THEME.down;
    ctx.save();
    ctx.fillStyle = colour;
    ctx.globalAlpha = pulseAlpha(options.sinceTickMs) * 0.35;
    ctx.beginPath();
    ctx.arc(dotX, dotY, pulseRadius(options.sinceTickMs), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * A study in a pane of its own.
 *
 * The caller has already translated the context to the pane's top and sized the
 * frame to its height, so everything here is drawn in the pane's own
 * coordinates — the same code that draws the main chart's lines.
 */
export function drawStudyPane(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  study: { label: string; lines: StudyLine[]; histogram?: StudyHistogram; levels?: number[] },
): void {
  const { plot, range, view, candles } = frame;
  const slice = visibleSlice(candles.length, view);

  // the levels a reader measures against: 70/30, zero, 25
  ctx.save();
  ctx.strokeStyle = THEME.grid;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const level of study.levels ?? []) {
    const y = Math.round(yOf(level, range, plot)) + 0.5;
    if (y < 0 || y > plot.height) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plot.width, y);
    ctx.stroke();
    ctx.fillText(String(level), plot.width + 6, y);
  }
  ctx.setLineDash([]);

  // the pane says what it is, since several can be open at once
  ctx.fillStyle = THEME.text;
  ctx.textAlign = 'left';
  ctx.fillText(study.label, 8, 10);
  ctx.restore();

  if (study.histogram) drawHistogram(ctx, frame, study.histogram, slice);
  drawIndicators(ctx, { ...frame, lines: study.lines });
}

interface StudyLine {
  points: (number | null)[];
  color: string;
  dashed?: boolean;
  width?: number;
  dots?: boolean;
}

interface StudyHistogram {
  points: (number | null)[];
  positive: string;
  negative: string;
}

/** Bars from a baseline of zero — MACD, the awesome oscillator. */
function drawHistogram(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  histogram: StudyHistogram,
  slice: { from: number; to: number },
): void {
  const { view, range, plot } = frame;
  const width = Math.max(1, barWidth(view, plot) * 0.6);
  const zero = yOf(0, range, plot);
  ctx.save();
  for (let index = slice.from; index <= slice.to; index += 1) {
    const value = histogram.points[index];
    if (value == null) continue;
    const x = xOf(index, view, plot);
    const y = yOf(value, range, plot);
    ctx.fillStyle = value >= 0 ? histogram.positive : histogram.negative;
    ctx.fillRect(
      Math.round(x - width / 2),
      Math.min(y, zero),
      Math.round(width),
      Math.max(Math.abs(zero - y), 1),
    );
  }
  ctx.restore();
}

/** A shaded area between two lines: a Bollinger band, an Ichimoku cloud. */
export function drawCloud(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  cloud: { upper: (number | null)[]; lower: (number | null)[]; color: string },
): void {
  const { candles, view, range, plot } = frame;
  const slice = visibleSlice(candles.length, view);
  ctx.save();
  ctx.fillStyle = cloud.color;
  ctx.beginPath();
  let started = false;
  for (let index = slice.from; index <= slice.to; index += 1) {
    const value = cloud.upper[index];
    if (value == null) continue;
    const x = xOf(index, view, plot);
    const y = yOf(value, range, plot);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  for (let index = slice.to; index >= slice.from; index -= 1) {
    const value = cloud.lower[index];
    if (value == null) continue;
    ctx.lineTo(xOf(index, view, plot), yOf(value, range, plot));
  }
  if (started) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Dots rather than a joined line: a parabolic stop, a fractal. */
export function drawDots(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  points: (number | null)[],
  color: string,
): void {
  const { candles, view, range, plot } = frame;
  const slice = visibleSlice(candles.length, view);
  const radius = Math.max(1, Math.min(barWidth(view, plot) * 0.18, 3));
  ctx.save();
  ctx.fillStyle = color;
  for (let index = slice.from; index <= slice.to; index += 1) {
    const value = points[index];
    if (value == null) continue;
    ctx.beginPath();
    ctx.arc(xOf(index, view, plot), yOf(value, range, plot), radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The trader's own marks: lines, boxes, retracements and notes.
 *
 * Drawn over the series and under the crosshair, with the selected one wearing
 * handles so it is obvious what a drag would move.
 */
export function drawDrawings(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  drawings: Drawing[],
  options: { selectedId: string | null; screen: Screen },
): void {
  const { plot } = frame;
  const { screen } = options;

  for (const drawing of drawings) {
    const points = drawing.points.map((point) => ({
      x: screen.x(point.time),
      y: screen.y(point.price),
    }));
    const [first, second] = points;
    if (!first) continue;
    const selected = drawing.id === options.selectedId;

    ctx.save();
    ctx.strokeStyle = drawing.color;
    ctx.fillStyle = drawing.color;
    ctx.lineWidth = selected ? 2 : 1.4;
    ctx.font = FONT;
    ctx.textBaseline = 'middle';

    switch (drawing.kind) {
      case 'horizontal':
        ctx.beginPath();
        ctx.moveTo(0, Math.round(first.y) + 0.5);
        ctx.lineTo(plot.width, Math.round(first.y) + 0.5);
        ctx.stroke();
        break;
      case 'vertical':
        ctx.beginPath();
        ctx.moveTo(Math.round(first.x) + 0.5, 0);
        ctx.lineTo(Math.round(first.x) + 0.5, plot.height);
        ctx.stroke();
        break;
      case 'trend':
      case 'ray': {
        if (!second) break;
        const end = drawing.kind === 'ray' ? extend(first, second, plot.width) : second;
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        break;
      }
      case 'rect': {
        if (!second) break;
        const left = Math.min(first.x, second.x);
        const top = Math.min(first.y, second.y);
        const width = Math.abs(second.x - first.x);
        const height = Math.abs(second.y - first.y);
        ctx.globalAlpha = 0.08;
        ctx.fillRect(left, top, width, height);
        ctx.globalAlpha = 1;
        ctx.strokeRect(left, top, width, height);
        break;
      }
      case 'fib': {
        if (!second) break;
        const left = Math.min(first.x, second.x);
        const right = Math.max(first.x, second.x);
        for (const level of fibLevels(drawing.points[0], drawing.points[1])) {
          const y = Math.round(screen.y(level.price)) + 0.5;
          ctx.globalAlpha = level.ratio === 0 || level.ratio === 1 ? 1 : 0.65;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.textAlign = 'left';
          ctx.fillText(`${(level.ratio * 100).toFixed(1)}%`, right + 4, y);
        }
        break;
      }
      case 'text': {
        ctx.textAlign = 'left';
        const label = drawing.text ?? 'Note';
        const width = ctx.measureText(label).width + 12;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.roundRect(first.x, first.y - 10, width, 20, 5);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillText(label, first.x + 6, first.y);
        break;
      }
    }

    // handles, so it is obvious what a drag would move — and a lock is shown
    if (selected) {
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = drawing.locked ? THEME.text : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
