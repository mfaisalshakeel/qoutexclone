import { themeColor } from '../store/theme';
import type { Candle, Trade } from '../lib/types';
import type { SeriesKind } from './series';

export type SeriesType = SeriesKind;

/** What part of the series is on screen, in bar coordinates. */
export interface Viewport {
  /**
   * The bar index at the right edge of the plot. A fraction is fine, and it may
   * run past the last bar — that gap is the breathing room a live chart needs
   * so the newest candle is not painted against the axis.
   */
  rightIndex: number;
  /** How many bars fit across the plot. */
  barsVisible: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

/** The plot area, in CSS pixels, inside the axes. */
export interface Plot {
  width: number;
  height: number;
}

export interface ChartTheme {
  background: string;
  grid: string;
  axis: string;
  text: string;
  up: string;
  down: string;
  line: string;
  lineFillTop: string;
  lineFillBottom: string;
  crosshair: string;
  label: string;
  labelText: string;
}

/**
 * Read from the theme rather than fixed: the canvas paints outside CSS, so a
 * light theme would otherwise leave a near-black plot on a white page. These
 * are getters because a frame reads them at draw time, which is exactly when
 * the answer should reflect the theme that is on.
 */
export const THEME: ChartTheme = {
  get background() {
    return themeColor('ink-800');
  },
  get grid() {
    return themeColor('ink-700');
  },
  get axis() {
    return themeColor('ink-500');
  },
  get text() {
    return themeColor('muted');
  },
  get up() {
    return themeColor('up');
  },
  get down() {
    return themeColor('down');
  },
  get line() {
    return themeColor('accent');
  },
  get lineFillTop() {
    return themeColor('accent', 0.28);
  },
  get lineFillBottom() {
    return themeColor('accent', 0.01);
  },
  get crosshair() {
    return themeColor('ink-400');
  },
  get label() {
    return themeColor('ink-500');
  },
  get labelText() {
    return themeColor('text');
  },
};

/** Everything a frame needs, assembled once per paint. */
export interface Frame {
  candles: Candle[];
  view: Viewport;
  range: PriceRange;
  plot: Plot;
  precision: number;
  timeframeSec: number;
  type: SeriesType;
  trades: Trade[];
  /** Indicator lines, already computed, in draw order. */
  lines: { color: string; dashed?: boolean; points: (number | null)[] }[];
  crosshair: { x: number; y: number } | null;
}
