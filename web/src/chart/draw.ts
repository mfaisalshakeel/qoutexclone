import type { Candle } from '../lib/types';
import { barWidth, indexAt, priceTicks, timeTicks, visibleSlice, xOf, yOf } from './scales';
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

/** Grid lines and the two axes. */
export function drawGrid(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { plot, range, view, candles, precision } = frame;
  ctx.clearRect(0, 0, plot.width + PRICE_AXIS_WIDTH, plot.height + TIME_AXIS_HEIGHT);
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, plot.width + PRICE_AXIS_WIDTH, plot.height + TIME_AXIS_HEIGHT);

  ctx.font = FONT;
  ctx.strokeStyle = THEME.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = 'middle';

  // price levels, labelled in the right gutter
  ctx.textAlign = 'left';
  for (const level of priceTicks(range, Math.max(3, Math.round(plot.height / 70)))) {
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
  ctx.moveTo(0, plot.height + 0.5);
  ctx.lineTo(plot.width + PRICE_AXIS_WIDTH, plot.height + 0.5);
  ctx.stroke();
}

/** Candles, or a line with a fill under it. */
export function drawSeries(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { candles, view, range, plot, type } = frame;
  ctx.clearRect(0, 0, plot.width + PRICE_AXIS_WIDTH, plot.height + TIME_AXIS_HEIGHT);
  if (candles.length === 0) return;

  const slice = visibleSlice(candles.length, view);
  if (type === 'line') {
    drawLine(ctx, frame, slice);
    return;
  }

  const width = barWidth(view, plot);
  // a body narrower than this is a line, and the border eats it
  const body = Math.max(1, Math.min(width * 0.7, width - 1));
  const thin = body <= 2;

  for (let index = slice.from; index <= slice.to; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    const x = xOf(index, view, plot);
    const up = candle.close >= candle.open;
    const colour = up ? THEME.up : THEME.down;
    const high = yOf(candle.high, range, plot);
    const low = yOf(candle.low, range, plot);
    const open = yOf(candle.open, range, plot);
    const close = yOf(candle.close, range, plot);

    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wick = Math.round(x) + 0.5;
    ctx.moveTo(wick, high);
    ctx.lineTo(wick, low);
    ctx.stroke();

    if (thin) continue;
    const top = Math.min(open, close);
    const height = Math.max(Math.abs(close - open), 1);
    ctx.fillRect(Math.round(x - body / 2), Math.round(top), Math.round(body), Math.round(height));
  }
}

function drawLine(ctx: CanvasRenderingContext2D, frame: Frame, slice: { from: number; to: number }) {
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

  ctx.lineTo(xOf(slice.to, view, plot), plot.height);
  ctx.lineTo(xOf(slice.from, view, plot), plot.height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, plot.height);
  gradient.addColorStop(0, THEME.lineFillTop);
  gradient.addColorStop(1, THEME.lineFillBottom);
  ctx.fillStyle = gradient;
  ctx.fill();
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
