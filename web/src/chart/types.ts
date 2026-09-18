import type { Candle, Trade } from '../lib/types';

export type SeriesType = 'candles' | 'line';

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

export const THEME: ChartTheme = {
  background: '#0f1421',
  grid: '#1a2132',
  axis: '#273149',
  text: '#7c8aa5',
  up: '#12b886',
  down: '#f0455e',
  line: '#3d7bff',
  lineFillTop: 'rgba(61,123,255,0.28)',
  lineFillBottom: 'rgba(61,123,255,0.01)',
  crosshair: '#3a4763',
  label: '#273149',
  labelText: '#e2e8f0',
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
