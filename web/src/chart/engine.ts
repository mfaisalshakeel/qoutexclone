import type { Candle, Trade } from '../lib/types';
import {
  PRICE_AXIS_WIDTH,
  TIME_AXIS_HEIGHT,
  drawCrosshair,
  drawGrid,
  drawIndicators,
  drawCloud,
  drawDots,
  drawDrawings,
  drawSeries,
  drawStudyPane,
  drawTradeOverlays,
} from './draw';
import {
  atLive,
  clampView,
  indexAt,
  liveView,
  panBy,
  priceAt,
  priceRange,
  visibleSlice,
  yOf as yOfPrice,
  zoomAt,
} from './scales';
import { gapBetween, glide, pinchFactor, scaleRange, shiftRange, velocityOf } from './motion';
import {
  create as createDrawing,
  handleAt,
  isMeaningful,
  moveBy,
  moveHandle,
  type Drawing,
  type DrawingKind,
  type Point as DataPoint,
  type Screen,
} from './drawings';
import { xOfTime, spacingOf } from './overlays';
import { heikinAshi } from './series';
import type { BuiltStudy } from './studies';
import { THEME, type Frame, type PriceRange, type SeriesType, type Viewport } from './types';

const THEME_AXIS = THEME.axis;

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

type Layer = 'grid' | 'series' | 'overlay' | 'cursor';

/** How often the overlays repaint while a position is open: once a second is
 *  enough for a countdown, and the pulse rides the same beat. */
const OVERLAY_MS = 250;

const LAYERS = ['grid', 'series', 'overlay', 'cursor'] as const;

/** Ids only have to be unique within one trader's own marks. */
function newId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

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
  /** Called whenever the trader's marks change, so they can be saved. */
  onDrawings?: (drawings: Drawing[]) => void;
  /** Called when the selection changes, so the page can offer its controls. */
  onSelect?: (drawing: Drawing | null) => void;
  /** Called when the engine puts a tool away, having drawn one mark with it. */
  onTool?: (tool: DrawingKind | null) => void;
}

export class ChartEngine {
  private readonly container: HTMLElement;
  private readonly canvases: Record<Layer, HTMLCanvasElement>;
  private readonly contexts: Record<Layer, CanvasRenderingContext2D>;
  private readonly dirty: Record<Layer, boolean> = {
    grid: true,
    series: true,
    overlay: true,
    cursor: true,
  };
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
  private studies: BuiltStudy[] = [];
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
  /** Seconds before a clock boundary at which buying closes; from settings. */
  private cutoffSec = 0;
  private drawings: Drawing[] = [];
  private tool: DrawingKind | null = null;
  private selectedId: string | null = null;
  /** The mark being drawn or dragged right now. */
  private sketch: {
    drawing: Drawing;
    handle: number | 'body';
    from: DataPoint;
    original: Drawing;
  } | null = null;
  private onDrawings?: EngineOptions['onDrawings'];
  private onSelect?: EngineOptions['onSelect'];
  private onTool?: EngineOptions['onTool'];
  private lastTickAt = Date.now();
  private overlayTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(container: HTMLElement, options: EngineOptions) {
    this.container = container;
    this.precision = options.precision;
    this.onView = options.onView;
    this.onDrawings = options.onDrawings;
    this.onSelect = options.onSelect;
    this.onTool = options.onTool;

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
    this.canvases = { grid: make(0), series: make(1), overlay: make(2), cursor: make(3) };
    this.contexts = {
      grid: this.canvases.grid.getContext('2d')!,
      series: this.canvases.series.getContext('2d')!,
      overlay: this.canvases.overlay.getContext('2d')!,
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
    this.lastTickAt = Date.now();
    this.mark('grid', 'series', 'overlay');
  }

  setTrades(trades: Trade[]): void {
    this.trades = trades;
    // an open position widens the price range to keep its strike on screen
    this.mark('grid', 'series', 'overlay');
    this.watchClock();
  }

  /** The purchase cut-off for clock expiries, which the platform configures. */
  setCutoff(seconds: number): void {
    this.cutoffSec = seconds;
    this.mark('overlay');
  }

  /**
   * The overlays tick on their own: a countdown and a pulse change with the
   * clock rather than with the data. The timer only runs while there is
   * something to count down, so an idle chart still costs nothing.
   */
  private watchClock(): void {
    const wanted = this.trades.some((trade) => trade.status === 'OPEN');
    if (wanted && !this.overlayTimer) {
      this.overlayTimer = setInterval(() => this.mark('overlay'), OVERLAY_MS);
    } else if (!wanted && this.overlayTimer) {
      clearInterval(this.overlayTimer);
      this.overlayTimer = null;
      this.mark('overlay');
    }
  }

  setIndicators(lines: IndicatorLine[]): void {
    this.lines = lines;
    this.mark('series');
  }

  /**
   * The studies on the chart. Those with a pane of their own change the
   * layout — the price loses height to them — so the grid is redrawn too.
   */
  setStudies(studies: BuiltStudy[]): void {
    const panesBefore = this.studies.filter((study) => study.pane === 'own').length;
    this.studies = studies;
    const panesAfter = studies.filter((study) => study.pane === 'own').length;
    this.mark('series', 'overlay', 'cursor');
    if (panesBefore !== panesAfter) this.mark('grid');
    else this.mark('grid');
  }

  /**
   * How the plot is divided between the price and the study panes.
   *
   * A pane takes a fifth of the plot, floored at 64px and capped so the price
   * always keeps at least half the height: four oscillators should squeeze the
   * chart, never swallow it.
   */
  private panes(): { top: number; height: number; study: BuiltStudy | null }[] {
    const own = this.studies.filter((study) => study.pane === 'own');
    if (own.length === 0) return [{ top: 0, height: this.plot.height, study: null }];

    const each = Math.max(Math.min(this.plot.height * 0.2, 130), 52);
    const total = Math.min(each * own.length, this.plot.height * 0.5);
    const paneHeight = total / own.length;
    const mainHeight = this.plot.height - total;

    const boxes = [{ top: 0, height: mainHeight, study: null as BuiltStudy | null }];
    own.forEach((study, index) => {
      boxes.push({ top: mainHeight + index * paneHeight, height: paneHeight, study });
    });
    return boxes;
  }

  /** The price range a study pane is drawn on: its own, or fixed. */
  private paneRange(study: BuiltStudy): PriceRange {
    if (study.fixedRange) return { min: study.fixedRange[0], max: study.fixedRange[1] };
    const slice = visibleSlice(this.candles.length, this.view);
    let min = Infinity;
    let max = -Infinity;
    const consider = (points: (number | null)[]) => {
      for (let index = slice.from; index <= slice.to; index += 1) {
        const value = points[index];
        if (value == null) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    };
    for (const each of study.lines) consider(each.points);
    if (study.histogram) consider(study.histogram.points);
    for (const level of study.levels ?? []) {
      if (level < min) min = level;
      if (level > max) max = level;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    if (max - min < Number.EPSILON) return { min: min - 1, max: max + 1 };
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
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

  setDrawings(drawings: Drawing[]): void {
    this.drawings = drawings;
    if (this.selectedId && !drawings.some((each) => each.id === this.selectedId)) {
      this.selectedId = null;
      this.onSelect?.(null);
    }
    this.mark('overlay');
  }

  /** The tool a drag will draw with, or null to select and move instead. */
  setTool(tool: DrawingKind | null): void {
    this.tool = tool;
    if (tool) this.select(null);
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.onSelect?.(this.drawings.find((each) => each.id === id) ?? null);
    this.mark('overlay');
  }

  get selected(): Drawing | null {
    return this.drawings.find((each) => each.id === this.selectedId) ?? null;
  }

  /** The topmost mark under a pixel, and what a drag there would move. */
  private pickAt(
    local: { x: number; y: number },
    screen: Screen,
  ): { drawing: Drawing; handle: number | 'body' | 'select' } | null {
    // the selected one first, so its handles stay grabbable under another mark
    const order = [...this.drawings].sort((a, b) =>
      a.id === this.selectedId ? 1 : b.id === this.selectedId ? -1 : 0,
    );
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const handle = handleAt(order[index], local, screen);
      if (handle !== null) return { drawing: order[index], handle };
    }
    return null;
  }

  /** The colour new marks are drawn in. */
  drawColor = '#f6c445';

  /** Changes something about a mark: its colour, its lock, its text. */
  updateDrawing(id: string, patch: Partial<Drawing>): void {
    this.drawings = this.drawings.map((each) => (each.id === id ? { ...each, ...patch } : each));
    this.onDrawings?.(this.drawings);
    this.onSelect?.(this.drawings.find((each) => each.id === id) ?? null);
    this.mark('overlay');
  }

  removeDrawing(id: string): void {
    this.drawings = this.drawings.filter((each) => each.id !== id);
    if (this.selectedId === id) this.select(null);
    this.onDrawings?.(this.drawings);
    this.mark('overlay');
  }

  clearDrawings(): void {
    this.drawings = [];
    this.select(null);
    this.onDrawings?.(this.drawings);
    this.mark('overlay');
  }

  /** Where a pixel lands in the chart's own coordinates, and back again. */
  private screen(): Screen {
    const frame = this.frame();
    const spacing = spacingOf(this.candles);
    const last = this.candles[this.candles.length - 1];
    return {
      x: (time) => xOfTime(time, this.candles, this.view, this.plot) ?? 0,
      y: (price) => yOfPrice(price, frame.range, this.plot),
      time: (x) => {
        if (!last) return 0;
        const index = indexAt(x, this.view, this.plot);
        return Math.round(last.time + (index - (this.candles.length - 1)) * spacing);
      },
      price: (y) => priceAt(y, frame.range, this.plot),
      width: this.plot.width,
      height: this.plot.height,
    };
  }

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

  /** How many bars the renderer is holding; the performance harness reads it. */
  get candleCount(): number {
    return this.candles.length;
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
      this.sketch = null;
      return;
    }

    // a tool draws; without one, a click selects a mark and drags it
    const screen = this.screen();
    const at: DataPoint = { time: screen.time(local.x), price: screen.price(local.y) };
    if (this.tool) {
      const drawing = createDrawing(this.tool, at, at, { color: this.drawColor, id: newId() });
      this.sketch = { drawing, handle: 1, from: at, original: drawing };
      this.mark('overlay');
      return;
    }

    const grabbed = this.pickAt(local, screen);
    if (grabbed?.handle === 'select') {
      // locked: selected so it can be unlocked or deleted, but never dragged
      this.select(grabbed.drawing.id);
      this.dragging = { x: event.clientX, pointerId: event.pointerId, at: Date.now() };
      return;
    }
    if (grabbed) {
      this.sketch = { drawing: grabbed.drawing, handle: grabbed.handle, from: at, original: grabbed.drawing };
      this.select(grabbed.drawing.id);
      return;
    }
    if (this.selectedId) this.select(null);

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

    if (this.sketch) {
      const screen = this.screen();
      const at: DataPoint = { time: screen.time(local.x), price: screen.price(local.y) };
      const { handle, original, from } = this.sketch;
      this.sketch.drawing =
        handle === 'body'
          ? moveBy(original, { time: at.time - from.time, price: at.price - from.price })
          : moveHandle(this.sketch.drawing, handle, at);
      this.crosshair = local;
      this.mark('overlay', 'cursor');
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

    // a finger covers whatever a crosshair would show, so touch does not draw
    // one — and skipping it saves a full-screen layer on every frame of a pan,
    // which is most of a phone's frame budget
    if (event.pointerType !== 'touch') {
      this.crosshair = local;
      this.mark('cursor');
    }
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    this.canvases.cursor.releasePointerCapture?.(event.pointerId);
    this.axisDrag = null;
    if (this.pointers.size < 2) this.pinch = null;

    if (this.sketch) {
      const { drawing, original, handle } = this.sketch;
      const fresh = !this.drawings.some((each) => each.id === drawing.id);
      this.sketch = null;
      const screen = this.screen();
      // a drag too short to have been meant leaves nothing behind
      const keep = !fresh || isMeaningful(drawing.kind, drawing.points[0], drawing.points.at(-1)!, screen);
      if (keep) {
        this.drawings = fresh
          ? [...this.drawings, drawing]
          : this.drawings.map((each) => (each.id === drawing.id ? drawing : each));
        this.onDrawings?.(this.drawings);
        if (fresh) {
          // one mark per click of a tool: the tool puts itself away afterwards,
          // and says so, or the button would stay lit over a chart that pans
          this.tool = null;
          this.onTool?.(null);
          this.select(drawing.id);
        }
      } else if (handle !== 'body') {
        this.drawings = this.drawings.map((each) => (each.id === original.id ? original : each));
      }
      this.mark('overlay');
      return;
    }

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
    for (const layer of LAYERS) {
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
    // the performance harness measures the engine's own work this way, apart
    // from the rasterisation a headless browser does in software
    const started = import.meta.env.DEV ? performance.now() : 0;
    const frame = this.frame();
    const boxes = this.panes();
    const main = boxes[0];

    if (this.dirty.grid) {
      const ctx = this.contexts.grid;
      // no clear: the grid paints its own background over every pixel it owns
      // the price keeps the grid and the time axis; a study pane gets a rule
      // above it and its own levels, drawn with the pane itself
      this.inPane(ctx, main, () => drawGrid(ctx, this.frameFor(frame, main), { time: boxes.length === 1 }));
      boxes.slice(1).forEach((box, index) => {
        const last = index === boxes.length - 2;
        // a study pane takes the vertical grid and, if it is the bottom one,
        // the clock; its own levels are drawn with the study
        this.inPane(ctx, box, () => drawGrid(ctx, this.frameFor(frame, box), { prices: false, time: last }));
        ctx.save();
        ctx.strokeStyle = THEME_AXIS;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(box.top) + 0.5);
        ctx.lineTo(this.plot.width + PRICE_AXIS_WIDTH, Math.round(box.top) + 0.5);
        ctx.stroke();
        ctx.restore();
      });
      this.dirty.grid = false;
    }

    if (this.dirty.series) {
      const ctx = this.contexts.series;
      ctx.clearRect(0, 0, this.plot.width + PRICE_AXIS_WIDTH, this.plot.height + TIME_AXIS_HEIGHT);
      const priceFrame = this.frameFor(frame, main);
      this.inPane(ctx, main, () => {
        // clouds sit under the series; dotted studies over it
        for (const study of this.studies) {
          if (study.pane !== 'main' || !study.cloud) continue;
          drawCloud(ctx, priceFrame, study.cloud);
        }
        drawSeries(ctx, priceFrame);
        drawIndicators(ctx, {
          ...priceFrame,
          lines: this.mainLines(),
        });
        for (const study of this.studies) {
          if (study.pane !== 'main') continue;
          for (const each of study.lines) {
            if (each.dots) drawDots(ctx, priceFrame, each.points, each.color);
          }
        }
      });

      for (const box of boxes.slice(1)) {
        if (!box.study) continue;
        const paneFrame = this.frameFor(frame, box, this.paneRange(box.study));
        this.inPane(ctx, box, () => drawStudyPane(ctx, paneFrame, box.study!));
      }
      this.dirty.series = false;
    }

    if (this.dirty.overlay) {
      const ctx = this.contexts.overlay;
      ctx.clearRect(0, 0, this.plot.width + PRICE_AXIS_WIDTH, this.plot.height + TIME_AXIS_HEIGHT);
      const priceFrame = this.frameFor(frame, main);
      this.inPane(ctx, main, () => {
        drawTradeOverlays(ctx, priceFrame, {
          price: this.candles[this.candles.length - 1]?.close ?? null,
          nowMs: Date.now(),
          cutoffSec: this.cutoffSec,
          sinceTickMs: Date.now() - this.lastTickAt,
        });
        const marks = this.sketch
          ? [...this.drawings.filter((each) => each.id !== this.sketch!.drawing.id), this.sketch.drawing]
          : this.drawings;
        drawDrawings(ctx, priceFrame, marks, {
          selectedId: this.sketch?.drawing.id ?? this.selectedId,
          screen: this.screen(),
        });
      });
      this.dirty.overlay = false;
    }

    if (this.dirty.cursor) {
      const ctx = this.contexts.cursor;
      ctx.clearRect(0, 0, this.plot.width + PRICE_AXIS_WIDTH, this.plot.height + TIME_AXIS_HEIGHT);
      // the crosshair reads the pane the pointer is actually in, so the price
      // label belongs to that pane's scale rather than the chart's
      const box = this.paneAt(this.crosshair?.y ?? 0, boxes) ?? main;
      const paneFrame = this.frameFor(frame, box, box.study ? this.paneRange(box.study) : undefined);
      this.inPane(ctx, box, () =>
        drawCrosshair(ctx, {
          ...paneFrame,
          crosshair: this.crosshair ? { x: this.crosshair.x, y: this.crosshair.y - box.top } : null,
        }),
      );
      this.dirty.cursor = false;
    }

    if (import.meta.env.DEV) {
      const store = (window as Window & { __paints?: number[] }).__paints;
      if (store) store.push(performance.now() - started);
    }
  }

  /** The main pane's indicator lines: the legacy ones plus the studies'. */
  private mainLines(): IndicatorLine[] {
    const fromStudies = this.studies
      .filter((study) => study.pane === 'main')
      .flatMap((study) =>
        study.lines
          .filter((each) => !each.dots)
          .map((each) => ({ color: each.color, dashed: each.dashed, points: each.points })),
      );
    return [...this.lines, ...fromStudies];
  }

  /** Runs a draw call in a pane's own coordinates. */
  private inPane(
    ctx: CanvasRenderingContext2D,
    box: { top: number; height: number },
    draw: () => void,
  ): void {
    ctx.save();
    ctx.translate(0, box.top);
    // a pane may not paint over its neighbours, whatever it is asked to draw
    ctx.beginPath();
    ctx.rect(0, 0, this.plot.width + PRICE_AXIS_WIDTH, box.height + TIME_AXIS_HEIGHT);
    ctx.clip();
    draw();
    ctx.restore();
  }

  /** A frame sized to one pane, and optionally scaled to its own values. */
  private frameFor(frame: Frame, box: { height: number }, range?: PriceRange): Frame {
    return {
      ...frame,
      plot: { width: this.plot.width, height: box.height },
      range: range ?? frame.range,
    };
  }

  private paneAt(
    y: number,
    boxes: { top: number; height: number; study: BuiltStudy | null }[],
  ): { top: number; height: number; study: BuiltStudy | null } | null {
    return boxes.find((box) => y >= box.top && y <= box.top + box.height) ?? null;
  }

  private report(): void {
    if (!this.onView) return;
    const slice = visibleSlice(this.candles.length, this.view);
    this.onView({ oldestVisible: slice.from, atLive: this.isLive });
  }

  destroy(): void {
    this.destroyed = true;
    this.stopGlide();
    if (this.overlayTimer) clearInterval(this.overlayTimer);
    this.overlayTimer = null;
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
    for (const layer of LAYERS) this.canvases[layer].remove();
  }
}
