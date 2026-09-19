import type { Candle } from '../lib/types';
import {
  adx,
  alligator,
  atr,
  awesome,
  bollinger,
  cci,
  donchian,
  ema,
  fractals,
  ichimoku,
  keltner,
  macd,
  momentum,
  parabolicSar,
  rsi,
  sma,
  stochastic,
  superTrend,
  williamsR,
  wma,
  zigzag,
  type Series,
} from './maths';

/**
 * The studies a trader can put on the chart.
 *
 * One entry per indicator: what it is called, what it is drawn from, which
 * numbers it takes, and whether it belongs over the price or in a pane of its
 * own. The terminal's settings panel is generated from this, so an indicator
 * cannot exist without the controls to configure it.
 */

export type StudyId =
  | 'sma'
  | 'ema'
  | 'wma'
  | 'bollinger'
  | 'donchian'
  | 'keltner'
  | 'ichimoku'
  | 'alligator'
  | 'psar'
  | 'supertrend'
  | 'zigzag'
  | 'fractals'
  | 'rsi'
  | 'macd'
  | 'stochastic'
  | 'atr'
  | 'adx'
  | 'cci'
  | 'williams'
  | 'momentum'
  | 'ao';

export interface StudyParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
}

export interface StudyLine {
  points: Series;
  color: string;
  dashed?: boolean;
  width?: number;
  /** Drawn as dots rather than a joined line — a parabolic stop, a fractal. */
  dots?: boolean;
}

export interface StudyDrawing {
  lines: StudyLine[];
  /** Bars around zero, for MACD and the awesome oscillator. */
  histogram?: { points: Series; positive: string; negative: string };
  /** A shaded area between two lines, for a cloud or a channel. */
  cloud?: { upper: Series; lower: Series; color: string };
  /** Reference levels drawn across a pane: 70/30, zero, and so on. */
  levels?: number[];
  /** A pane whose scale never moves, like RSI's 0–100. */
  fixedRange?: [number, number];
}

export interface StudyDefinition {
  id: StudyId;
  label: string;
  /** `main` draws over the price; `own` gets a pane underneath it. */
  pane: 'main' | 'own';
  params: StudyParam[];
  /** One colour control per configurable line. */
  colors: { key: string; label: string; default: string }[];
  build(candles: Candle[], values: Record<string, number>, colors: Record<string, string>): StudyDrawing;
}

const line = (points: Series, color: string, extra: Partial<StudyLine> = {}): StudyLine => ({
  points,
  color,
  ...extra,
});

const period = (value: number, label = 'Period', key = 'period'): StudyParam => ({
  key,
  label,
  min: 2,
  max: 400,
  default: value,
});

export const STUDIES: StudyDefinition[] = [
  {
    id: 'sma',
    label: 'Moving average (SMA)',
    pane: 'main',
    params: [period(20)],
    colors: [{ key: 'line', label: 'Line', default: '#f6c445' }],
    build: (candles, values, colors) => ({ lines: [line(sma(candles, values.period), colors.line)] }),
  },
  {
    id: 'ema',
    label: 'Moving average (EMA)',
    pane: 'main',
    params: [period(50)],
    colors: [{ key: 'line', label: 'Line', default: '#3d7bff' }],
    build: (candles, values, colors) => ({ lines: [line(ema(candles, values.period), colors.line)] }),
  },
  {
    id: 'wma',
    label: 'Moving average (WMA)',
    pane: 'main',
    params: [period(20)],
    colors: [{ key: 'line', label: 'Line', default: '#c084fc' }],
    build: (candles, values, colors) => ({ lines: [line(wma(candles, values.period), colors.line)] }),
  },
  {
    id: 'bollinger',
    label: 'Bollinger bands',
    pane: 'main',
    params: [period(20), { key: 'deviation', label: 'Deviations', min: 1, max: 5, step: 0.5, default: 2 }],
    colors: [{ key: 'band', label: 'Bands', default: '#7c8aa5' }],
    build: (candles, values, colors) => {
      const bands = bollinger(candles, values.period, values.deviation);
      return {
        lines: [
          line(bands.upper, colors.band, { dashed: true }),
          line(bands.middle, colors.band),
          line(bands.lower, colors.band, { dashed: true }),
        ],
        cloud: { upper: bands.upper, lower: bands.lower, color: 'rgba(124,138,165,0.07)' },
      };
    },
  },
  {
    id: 'donchian',
    label: 'Donchian channel',
    pane: 'main',
    params: [period(20)],
    colors: [{ key: 'band', label: 'Channel', default: '#38bdf8' }],
    build: (candles, values, colors) => {
      const channel = donchian(candles, values.period);
      return {
        lines: [
          line(channel.upper, colors.band),
          line(channel.middle, colors.band, { dashed: true }),
          line(channel.lower, colors.band),
        ],
      };
    },
  },
  {
    id: 'keltner',
    label: 'Keltner channel',
    pane: 'main',
    params: [
      period(20),
      { key: 'multiplier', label: 'ATR multiple', min: 0.5, max: 6, step: 0.5, default: 2 },
    ],
    colors: [{ key: 'band', label: 'Channel', default: '#34d399' }],
    build: (candles, values, colors) => {
      const channel = keltner(candles, values.period, values.multiplier);
      return {
        lines: [
          line(channel.upper, colors.band, { dashed: true }),
          line(channel.middle, colors.band),
          line(channel.lower, colors.band, { dashed: true }),
        ],
      };
    },
  },
  {
    id: 'ichimoku',
    label: 'Ichimoku cloud',
    pane: 'main',
    params: [
      period(9, 'Conversion', 'conversion'),
      period(26, 'Base', 'base'),
      period(52, 'Span B', 'spanB'),
    ],
    colors: [
      { key: 'conversion', label: 'Conversion', default: '#38bdf8' },
      { key: 'base', label: 'Base', default: '#f472b6' },
    ],
    build: (candles, values, colors) => {
      const cloud = ichimoku(candles, values.conversion, values.base, values.spanB);
      return {
        lines: [
          line(cloud.conversion, colors.conversion),
          line(cloud.base, colors.base),
          line(cloud.spanA, '#12b886', { dashed: true }),
          line(cloud.spanB, '#f0455e', { dashed: true }),
          line(cloud.lagging, '#94a3b8', { dashed: true }),
        ],
        cloud: { upper: cloud.spanA, lower: cloud.spanB, color: 'rgba(18,184,134,0.08)' },
      };
    },
  },
  {
    id: 'alligator',
    label: 'Alligator',
    pane: 'main',
    params: [period(13, 'Jaw', 'jaw'), period(8, 'Teeth', 'teeth'), period(5, 'Lips', 'lips')],
    colors: [
      { key: 'jaw', label: 'Jaw', default: '#3d7bff' },
      { key: 'teeth', label: 'Teeth', default: '#f0455e' },
      { key: 'lips', label: 'Lips', default: '#12b886' },
    ],
    build: (candles, values, colors) => {
      const jaws = alligator(candles, values.jaw, 8, values.teeth, 5, values.lips, 3);
      return {
        lines: [line(jaws.jaw, colors.jaw), line(jaws.teeth, colors.teeth), line(jaws.lips, colors.lips)],
      };
    },
  },
  {
    id: 'psar',
    label: 'Parabolic SAR',
    pane: 'main',
    params: [
      { key: 'step', label: 'Step', min: 0.005, max: 0.1, step: 0.005, default: 0.02 },
      { key: 'max', label: 'Maximum', min: 0.05, max: 0.5, step: 0.05, default: 0.2 },
    ],
    colors: [{ key: 'dots', label: 'Dots', default: '#e2e8f0' }],
    build: (candles, values, colors) => ({
      lines: [line(parabolicSar(candles, values.step, values.max), colors.dots, { dots: true })],
    }),
  },
  {
    id: 'supertrend',
    label: 'SuperTrend',
    pane: 'main',
    params: [period(10), { key: 'multiplier', label: 'ATR multiple', min: 1, max: 8, step: 0.5, default: 3 }],
    colors: [{ key: 'line', label: 'Line', default: '#12b886' }],
    build: (candles, values, colors) => ({
      lines: [line(superTrend(candles, values.period, values.multiplier).line, colors.line, { width: 2 })],
    }),
  },
  {
    id: 'zigzag',
    label: 'ZigZag',
    pane: 'main',
    params: [{ key: 'percent', label: 'Swing %', min: 0.1, max: 25, step: 0.1, default: 3 }],
    colors: [{ key: 'line', label: 'Line', default: '#facc15' }],
    build: (candles, values, colors) => ({
      lines: [line(zigzag(candles, values.percent), colors.line, { width: 1.5 })],
    }),
  },
  {
    id: 'fractals',
    label: 'Fractals',
    pane: 'main',
    params: [],
    colors: [
      { key: 'up', label: 'Highs', default: '#12b886' },
      { key: 'down', label: 'Lows', default: '#f0455e' },
    ],
    build: (candles, _values, colors) => {
      const marks = fractals(candles);
      return {
        lines: [line(marks.up, colors.up, { dots: true }), line(marks.down, colors.down, { dots: true })],
      };
    },
  },
  {
    id: 'rsi',
    label: 'RSI',
    pane: 'own',
    params: [period(14)],
    colors: [{ key: 'line', label: 'Line', default: '#c084fc' }],
    build: (candles, values, colors) => ({
      lines: [line(rsi(candles, values.period), colors.line)],
      levels: [30, 50, 70],
      fixedRange: [0, 100],
    }),
  },
  {
    id: 'macd',
    label: 'MACD',
    pane: 'own',
    params: [period(12, 'Fast', 'fast'), period(26, 'Slow', 'slow'), period(9, 'Signal', 'signal')],
    colors: [
      { key: 'macd', label: 'MACD', default: '#3d7bff' },
      { key: 'signal', label: 'Signal', default: '#f6c445' },
    ],
    build: (candles, values, colors) => {
      const lines = macd(candles, values.fast, values.slow, values.signal);
      return {
        lines: [line(lines.macd, colors.macd), line(lines.signal, colors.signal)],
        histogram: { points: lines.histogram, positive: '#12b886', negative: '#f0455e' },
        levels: [0],
      };
    },
  },
  {
    id: 'stochastic',
    label: 'Stochastic',
    pane: 'own',
    params: [period(14), period(3, 'Smooth %K', 'smoothK'), period(3, 'Smooth %D', 'smoothD')],
    colors: [
      { key: 'k', label: '%K', default: '#38bdf8' },
      { key: 'd', label: '%D', default: '#f472b6' },
    ],
    build: (candles, values, colors) => {
      const lines = stochastic(candles, values.period, values.smoothK, values.smoothD);
      return {
        lines: [line(lines.k, colors.k), line(lines.d, colors.d, { dashed: true })],
        levels: [20, 50, 80],
        fixedRange: [0, 100],
      };
    },
  },
  {
    id: 'atr',
    label: 'ATR',
    pane: 'own',
    params: [period(14)],
    colors: [{ key: 'line', label: 'Line', default: '#94a3b8' }],
    build: (candles, values, colors) => ({ lines: [line(atr(candles, values.period), colors.line)] }),
  },
  {
    id: 'adx',
    label: 'ADX',
    pane: 'own',
    params: [period(14)],
    colors: [
      { key: 'adx', label: 'ADX', default: '#e2e8f0' },
      { key: 'plus', label: '+DI', default: '#12b886' },
      { key: 'minus', label: '−DI', default: '#f0455e' },
    ],
    build: (candles, values, colors) => {
      const measured = adx(candles, values.period);
      return {
        lines: [
          line(measured.adx, colors.adx, { width: 1.5 }),
          line(measured.plus, colors.plus),
          line(measured.minus, colors.minus),
        ],
        levels: [25],
        fixedRange: [0, 100],
      };
    },
  },
  {
    id: 'cci',
    label: 'CCI',
    pane: 'own',
    params: [period(20)],
    colors: [{ key: 'line', label: 'Line', default: '#fb923c' }],
    build: (candles, values, colors) => ({
      lines: [line(cci(candles, values.period), colors.line)],
      levels: [-100, 0, 100],
    }),
  },
  {
    id: 'williams',
    label: 'Williams %R',
    pane: 'own',
    params: [period(14)],
    colors: [{ key: 'line', label: 'Line', default: '#a3e635' }],
    build: (candles, values, colors) => ({
      lines: [line(williamsR(candles, values.period), colors.line)],
      levels: [-80, -50, -20],
      fixedRange: [-100, 0],
    }),
  },
  {
    id: 'momentum',
    label: 'Momentum',
    pane: 'own',
    params: [period(10)],
    colors: [{ key: 'line', label: 'Line', default: '#22d3ee' }],
    build: (candles, values, colors) => ({
      lines: [line(momentum(candles, values.period), colors.line)],
      levels: [0],
    }),
  },
  {
    id: 'ao',
    label: 'Awesome oscillator',
    pane: 'own',
    params: [period(5, 'Fast', 'fast'), period(34, 'Slow', 'slow')],
    colors: [],
    build: (candles, values) => ({
      lines: [],
      histogram: {
        points: awesome(candles, values.fast, values.slow),
        positive: '#12b886',
        negative: '#f0455e',
      },
      levels: [0],
    }),
  },
];

export const STUDY_BY_ID = new Map(STUDIES.map((study) => [study.id, study]));

/** One trader's configuration of one study. */
export interface StudySettings {
  id: StudyId;
  values: Record<string, number>;
  colors: Record<string, string>;
}

export function defaultSettings(id: StudyId): StudySettings {
  const definition = STUDY_BY_ID.get(id);
  return {
    id,
    values: Object.fromEntries((definition?.params ?? []).map((param) => [param.key, param.default])),
    colors: Object.fromEntries((definition?.colors ?? []).map((color) => [color.key, color.default])),
  };
}

/** Fills in anything a stored configuration is missing or has out of range. */
export function normaliseSettings(settings: StudySettings): StudySettings {
  const definition = STUDY_BY_ID.get(settings.id);
  if (!definition) return settings;
  const values: Record<string, number> = {};
  for (const param of definition.params) {
    const stored = settings.values?.[param.key];
    values[param.key] =
      typeof stored === 'number' && Number.isFinite(stored)
        ? Math.min(Math.max(stored, param.min), param.max)
        : param.default;
  }
  const colors: Record<string, string> = {};
  for (const color of definition.colors) {
    const stored = settings.colors?.[color.key];
    colors[color.key] = typeof stored === 'string' && stored ? stored : color.default;
  }
  return { id: settings.id, values, colors };
}

export interface BuiltStudy extends StudyDrawing {
  id: StudyId;
  label: string;
  pane: 'main' | 'own';
}

/** Turns a trader's settings into everything the renderer needs. */
export function buildStudy(candles: Candle[], settings: StudySettings): BuiltStudy | null {
  const definition = STUDY_BY_ID.get(settings.id);
  if (!definition) return null;
  const safe = normaliseSettings(settings);
  return {
    id: definition.id,
    label: definition.label,
    pane: definition.pane,
    ...definition.build(candles, safe.values, safe.colors),
  };
}
