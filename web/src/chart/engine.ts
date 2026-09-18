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
import { heikinAshi } from './series';
import { THEME, type Frame, type SeriesType, type Viewport } from './types';

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
  private dragging: { x: number; pointerId: number } | null = null;
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

  scrollToLive(): void {
    this.view = liveView(this.candles.length, this.view.barsVisible);
    this.mark('grid', 'series');
    this.report();
  }

  zoom(factor: number, atX = this.plot.width / 2): void {
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
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.dragging = { x: event.clientX, pointerId: event.pointerId };
    this.canvases.cursor.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const box = this.canvases.cursor.getBoundingClientRect();
    if (this.dragging) {
      const dx = event.clientX - this.dragging.x;
      this.dragging.x = event.clientX;
      this.view = clampView(panBy(this.view, dx, this.plot), this.candles.length, this.plot);
      this.mark('grid', 'series');
      this.report();
    }
    this.crosshair = { x: event.clientX - box.left, y: event.clientY - box.top };
    this.mark('cursor');
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.dragging?.pointerId === event.pointerId) {
      this.canvases.cursor.releasePointerCapture?.(event.pointerId);
      this.dragging = null;
    }
  };

  private readonly onPointerLeave = () => {
    this.crosshair = null;
    this.mark('cursor');
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const box = this.canvases.cursor.getBoundingClientRect();
    // a notch of the wheel is about 10% either way
    this.zoom(event.deltaY > 0 ? 1.1 : 0.9, event.clientX - box.left);
  };

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
      range: priceRange(this.drawn, slice, strikes),
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
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.observer.disconnect();
    const canvas = this.canvases.cursor;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    for (const layer of ['grid', 'series', 'cursor'] as const) this.canvases[layer].remove();
  }
}
