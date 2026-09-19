import type { Candle, Trade } from '../lib/types';
import {
  PRICE_AXIS_WIDTH,
  TIME_AXIS_HEIGHT,
  drawCrosshair,
  drawGrid,
  drawIndicators,
  drawPriceLine,
  drawSeries,
} from './draw';
import { atLive, clampView, liveView, panBy, priceRange, visibleSlice, zoomAt } from './scales';
import { gapBetween, glide, pinchFactor, scaleRange, shiftRange, velocityOf } from './motion';
import { heikinAshi } from './series';
import { THEME, type Frame, type PriceRange, type SeriesType, type Viewport } from './types';

/**
 * The chart engine: three stacked canvases, one animation frame, and a dirty
 * flag per layer.
 *
 * The split is what keeps it cheap. Moving the pointer repaints the crosshair
 * alone — a few lines and a label — while the grid and the candles keep the
 * pixels they already have. A new tick repaints the series but not the grid
 * unless the scale moved with it. Nothing paints at all when nothing changed,
 * so an idle chart costs nothing.
 */

type Layer = 'grid' | 'series' | 'cursor';

/** Someone who has asked for less movement does not want a chart coasting. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export interface IndicatorLine {
  color: string;
  dashed?: boolean;
  /** One value per candle, aligned by index; null where it has none yet. */
  points: (number | null)[];
}

export interface EngineOptions {
  precision: number;
  /** Called when the view moves, so the page can page history or show "live". */
  onView?: (state: { oldestVisible: number; atLive: boolean }) => void;
}

export class ChartEngine {
  private readonly container: HTMLElement;
  private readonly canvases: Record<Layer, HTMLCanvasElement>;
  private readonly contexts: Record<Layer, CanvasRenderingContext2D>;
  private readonly dirty: Record<Layer, boolean> = { grid: true, series: true, cursor: true };
  private readonly observer: ResizeObserver;

  private candles: Candle[] = [];
  /**
   * What is actually drawn. Heikin-Ashi is a different set of bars rather than
   * a different way of drawing the same ones, so the transform is cached here
   * and rebuilt when the data or the type changes — never per frame.
   */
  private drawn: Candle[] = [];
  private trades: Trade[] = [];
  private lines: IndicatorLine[] = [];
  private type: SeriesType = 'candles';
  private precision: number;
  private view: Viewport = { rightIndex: 0, barsVisible: 120 };
  private crosshair: { x: number; y: number } | null = null;
  private plot = { width: 0, height: 0 };
  private frameHandle: number | null = null;
  private dragging: { x: number; pointerId: number; at: number } | null = null;
  /** Every pointer currently down, so two of them can be a pinch. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { gap: number; barsVisible: number; x: number } | null = null;
  /** A flick's remaining speed, in pixels per millisecond. */
  private glideVelocity = 0;
  private glideHandle: number | null = null;
  /**
   * A price range the trader set by hand. While it is set the chart stops
   * following the market's own extremes, which is the point — watching a level
   * means keeping it on screen even when the price runs away from it.
   */
  private manualRange: PriceRange | null = null;
  private axisDrag: { y: number; range: PriceRange } | null = null;
  private onView?: EngineOptions['onView'];
  private destroyed = false;

  constructor(container: HTMLElement, options: EngineOptions) {
    this.container = container;
    this.precision = options.precision;
    this.onView = options.onView;

    container.style.position = 'relative';
    container.style.touchAction = 'none';
    const make = (z: number) => {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.zIndex = String(z);
      container.appendChild(canvas);
      return canvas;
    };
    this.canvases = { grid: make(0), series: make(1), cursor: make(2) };
    this.contexts = {
      grid: this.canvases.grid.getContext('2d')!,
      series: this.canvases.series.getContext('2d')!,
      cursor: this.canvases.cursor.getContext('2d')!,
    };

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.bind();
    // a touch anywhere stops a coasting chart, the way a finger stops a
    // scrolling list — including a touch meant for a button over the chart,
    // which the browser swallows while a gesture is in flight
    document.addEventListener('pointerdown', this.onAnyPointerDown, true);
  }

  /* ------------------------------ data in ------------------------------- */

  setCandles(candles: Candle[], options: { keepView?: boolean } = {}): void {
    const wasLive = this.candles.length === 0 || atLive(this.view, this.candles.length);
    this.candles = candles;
    this.reshape();
    if (!options.keepView || wasLive) this.view = liveView(candles.length, this.view.barsVisible);
    this.mark('grid', 'series');
    this.report();
  }

  /** Older history arriving at the front, with the view held where it was. */
  prepend(older: Candle[]): void {
    if (older.length === 0) return;
    this.candles = [...older, ...this.candles];
    this.reshape();
    // every index has shifted by the number of bars added, so the viewport
    // shifts with them and the trader does not see the chart jump
    this.view = { ...this.view, rightIndex: this.view.rightIndex + older.length };
    this.mark('grid', 'series');
  }

  /** The live candle: replaces the last bar, or starts a new one. */
  update(candle: Candle): void {
    const last = this.candles[this.candles.length - 1];
    const following = atLive(this.view, this.candles.length);
    if (last && last.time === candle.time) this.candles[this.candles.length - 1] = candle;
    else {
      this.candles.push(candle);
      // a chart that was watching the live edge keeps watching it
      if (following) this.view = { ...this.view, rightIndex: this.view.rightIndex + 1 };
    }
    this.reshape();
    this.mark('grid', 'series');
  }

  setTrades(trades: Trade[]): void {
    this.trades = trades;
    this.mark('grid', 'series');
  }

  setIndicators(lines: IndicatorLine[]): void {
    this.lines = lines;
    this.mark('series');
  }

  setType(type: SeriesType): void {
    if (type === this.type) return;
    this.type = type;
    // switching shape is a redraw of what is already loaded: no request, and no
    // gap while one comes back
    this.reshape();
    this.mark('grid', 'series', 'cursor');
  }

  /** Rebuilds the drawn series from the real one. */
  private reshape(): void {
    this.drawn = this.type === 'heikin-ashi' ? heikinAshi(this.candles) : this.candles;
  }

  setPrecision(precision: number): void {
    this.precision = precision;
    this.mark('grid', 'series', 'cursor');
  }

  /* ----------------------------- the view ------------------------------- */

  /** Hands the price scale back to the chart. */
  autoScale(): void {
    this.manualRange = null;
    this.mark('grid', 'series', 'cursor');
    this.report();
  }

  get isAutoScaled(): boolean {
    return this.manualRange === null;
  }

  scrollToLive(): void {
    // any deliberate jump cancels a coast: a chart that slides back off the
    // live edge a moment after the trader asked for it looks broken
    this.stopGlide();
    this.view = liveView(this.candles.length, this.view.barsVisible);
    this.mark('grid', 'series');
    this.report();
  }

  zoom(factor: number, atX = this.plot.width / 2): void {
    this.stopGlide();
    this.view = clampView(zoomAt(this.view, factor, atX, this.plot), this.candles.length, this.plot);
    this.mark('grid', 'series');
    this.report();
  }

  get isLive(): boolean {
    return atLive(this.view, this.candles.length);
  }

  /* ------------------------------ plumbing ------------------------------ */

  private bind(): void {
    const canvas = this.canvases.cursor;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private readonly onAnyPointerDown = () => {
    this.stopGlide();
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    const box = this.canvases.cursor.getBoundingClientRect();
    const local = { x: event.clientX - box.left, y: event.clientY - box.top };
    this.pointers.set(event.pointerId, local);
    this.stopGlide();
    this.canvases.cursor.setPointerCapture(event.pointerId);

    // the gutter scales the price by hand; the plot pans and zooms
    if (local.x > this.plot.width) {
      this.axisDrag = { y: local.y, range: this.manualRange ?? this.frame().range };
      return;
    }

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { gap: gapBetween(a, b), barsVisible: this.view.barsVisible, x: (a.x + b.x) / 2 };
      this.dragging = null;
      return;
    }
    this.dragging = { x: event.clientX, pointerId: event.pointerId, at: Date.now() };
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const box = this.canvases.cursor.getBoundingClientRect();
    const local = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, local);

    if (this.axisDrag) {
      // dragging the price gutter moves the range with the finger
      this.manualRange = shiftRange(this.axisDrag.range, local.y - this.axisDrag.y, this.plot);
      this.mark('grid', 'series', 'cursor');
      this.report();
      return;
    }

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const factor = pinchFactor(this.pinch.gap, gapBetween(a, b));
      this.view = clampView(
        zoomAt({ ...this.view, barsVisible: this.pinch.barsVisible }, factor, this.pinch.x, this.plot),
        this.candles.length,
        this.plot,
      );
      this.mark('grid', 'series');
      this.report();
      return;
    }

    if (this.dragging) {
      const dx = event.clientX - this.dragging.x;
      const elapsed = Date.now() - this.dragging.at;
      this.dragging.x = event.clientX;
      this.dragging.at = Date.now();
      // the speed of the last leg is what a flick carries on with
      this.glideVelocity = velocityOf(dx, elapsed);
      this.lastMoveAt = Date.now();
      this.view = clampView(panBy(this.view, dx, this.plot), this.candles.length, this.plot);
      this.mark('grid', 'series');
      this.report();
    }

    this.crosshair = local;
    this.mark('cursor');
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    this.canvases.cursor.releasePointerCapture?.(event.pointerId);
    this.axisDrag = null;
    if (this.pointers.size < 2) this.pinch = null;

    if (this.dragging?.pointerId === event.pointerId) {
      this.dragging = null;
      // a flick keeps going and slows down, the way a list does on a phone
      const stale = Date.now() - (this.lastMoveAt ?? 0) > 120;
      if (!stale && Math.abs(this.glideVelocity) > 0.05 && !prefersReducedMotion()) this.startGlide();
      else this.glideVelocity = 0;
    }
  };

  private readonly onPointerLeave = () => {
    this.crosshair = null;
    this.mark('cursor');
  };

  private readonly onDoubleClick = (event: MouseEvent) => {
    const box = this.canvases.cursor.getBoundingClientRect();
    // a double click on the gutter hands the price scale back to the chart
    if (event.clientX - box.left > this.plot.width) this.autoScale();
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const box = this.canvases.cursor.getBoundingClientRect();
    const x = event.clientX - box.left;

    // over the gutter, the wheel stretches the price scale by hand
    if (x > this.plot.width) {
      const current = this.manualRange ?? this.frame().range;
      this.manualRange = scaleRange(current, event.deltaY > 0 ? 1.1 : 0.9);
      this.mark('grid', 'series', 'cursor');
      this.report();
      return;
    }

    // a trackpad's sideways scroll, or shift+wheel, pans instead of zooming
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      const dx = event.shiftKey && event.deltaX === 0 ? -event.deltaY : -event.deltaX;
      this.view = clampView(panBy(this.view, dx, this.plot), this.candles.length, this.plot);
      this.mark('grid', 'series');
      this.report();
      return;
    }
    // a notch of the wheel is about 10% either way
    this.zoom(event.deltaY > 0 ? 1.1 : 0.9, x);
  };

  private lastMoveAt: number | null = null;

  private startGlide(): void {
    let previous = performance.now();
    const step = () => {
      const now = performance.now();
      const moved = glide(this.glideVelocity, now - previous);
      previous = now;
      if (!moved || this.destroyed) {
        this.glideHandle = null;
        this.glideVelocity = 0;
        return;
      }
      this.glideVelocity = moved.velocity;
      const before = this.view.rightIndex;
      this.view = clampView(panBy(this.view, moved.dxPx, this.plot), this.candles.length, this.plot);
      // hitting the end of the data stops the glide rather than grinding on it
      if (this.view.rightIndex === before) {
        this.glideHandle = null;
        this.glideVelocity = 0;
        return;
      }
      this.mark('grid', 'series');
      this.report();
      this.glideHandle = requestAnimationFrame(step);
    };
    this.glideHandle = requestAnimationFrame(step);
  }

  private stopGlide(): void {
    if (this.glideHandle !== null) cancelAnimationFrame(this.glideHandle);
    this.glideHandle = null;
    this.glideVelocity = 0;
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;

    const dpr = window.devicePixelRatio || 1;
    for (const layer of ['grid', 'series', 'cursor'] as const) {
      const canvas = this.canvases[layer];
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
      // the backing store is in device pixels; everything drawn is in CSS ones
      canvas.width = Math.round(clientWidth * dpr);
      canvas.height = Math.round(clientHeight * dpr);
      this.contexts[layer].setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.plot = {
      width: Math.max(clientWidth - PRICE_AXIS_WIDTH, 10),
      height: Math.max(clientHeight - TIME_AXIS_HEIGHT, 10),
    };
    this.view = clampView(this.view, this.candles.length, this.plot);
    this.mark('grid', 'series', 'cursor');
  }

  private mark(...layers: Layer[]): void {
    for (const layer of layers) this.dirty[layer] = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frameHandle !== null || this.destroyed) return;
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = null;
      this.paint();
    });
  }

  /** The frame every layer is drawn from, so they cannot disagree. */
  private frame(): Frame {
    const slice = visibleSlice(this.drawn.length, this.view);
    const strikes = this.openTrades().map((trade) => trade.entryPrice);
    return {
      candles: this.drawn,
      view: this.view,
      range: this.manualRange ?? priceRange(this.drawn, slice, strikes),
      plot: this.plot,
      precision: this.precision,
      timeframeSec: 60,
      type: this.type,
      trades: this.trades,
      lines: this.lines,
      crosshair: this.crosshair,
    };
  }

  private openTrades(): Trade[] {
    return this.trades.filter((trade) => trade.status === 'OPEN');
  }

  private paint(): void {
    if (this.destroyed || this.plot.width <= 0) return;
    const frame = this.frame();

    if (this.dirty.grid) {
      drawGrid(this.contexts.grid, frame);
      this.dirty.grid = false;
    }
    if (this.dirty.series) {
      const ctx = this.contexts.series;
      drawSeries(ctx, frame);
      drawIndicators(ctx, frame);
      this.drawOverlays(ctx, frame);
      this.dirty.series = false;
    }
    if (this.dirty.cursor) {
      drawCrosshair(this.contexts.cursor, frame);
      this.dirty.cursor = false;
    }
  }

  /** The last price, and every open position's strike. */
  private drawOverlays(ctx: CanvasRenderingContext2D, frame: Frame): void {
    for (const trade of this.openTrades()) {
      drawPriceLine(ctx, frame, {
        price: trade.entryPrice,
        color: trade.direction === 'UP' ? THEME.up : THEME.down,
        dashed: true,
        tag: `${trade.direction === 'UP' ? '▲' : '▼'} $${(trade.stake / 100).toFixed(0)}`,
      });
    }

    // the real close, never the smoothed one: a Heikin-Ashi close is an average
    // of four numbers and nobody trades at it
    const last = this.candles[this.candles.length - 1];
    if (!last) return;
    drawPriceLine(ctx, frame, {
      price: last.close,
      color: last.close >= last.open ? THEME.up : THEME.down,
      dashed: true,
    });
  }

  private report(): void {
    if (!this.onView) return;
    const slice = visibleSlice(this.candles.length, this.view);
    this.onView({ oldestVisible: slice.from, atLive: this.isLive });
  }

  destroy(): void {
    this.destroyed = true;
    this.stopGlide();
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.observer.disconnect();
    document.removeEventListener('pointerdown', this.onAnyPointerDown, true);
    const canvas = this.canvases.cursor;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('wheel', this.onWheel);
    for (const layer of ['grid', 'series', 'cursor'] as const) this.canvases[layer].remove();
  }
}
