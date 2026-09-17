/**
 * The timeframes the platform keeps, with how long each is retained.
 *
 * Short timeframes are what binary options traders actually watch, so they are
 * kept at full resolution for hours; long ones are cheap and kept for years.
 * Retention is enforced by the candle store, which prunes on a slow interval.
 */
export interface TimeframeSpec {
  /** Label used by the API and the chart. */
  key: string;
  /** Bucket size in seconds. */
  seconds: number;
  /** How long stored candles of this size are kept, in days. */
  retentionDays: number;
}

export const TIMEFRAME_LIST: TimeframeSpec[] = [
  { key: '5s', seconds: 5, retentionDays: 0.25 },
  { key: '10s', seconds: 10, retentionDays: 0.5 },
  { key: '15s', seconds: 15, retentionDays: 0.75 },
  { key: '30s', seconds: 30, retentionDays: 1 },
  { key: '1m', seconds: 60, retentionDays: 5 },
  { key: '2m', seconds: 120, retentionDays: 7 },
  { key: '3m', seconds: 180, retentionDays: 10 },
  { key: '5m', seconds: 300, retentionDays: 20 },
  { key: '10m', seconds: 600, retentionDays: 30 },
  { key: '15m', seconds: 900, retentionDays: 45 },
  { key: '30m', seconds: 1800, retentionDays: 90 },
  { key: '1h', seconds: 3600, retentionDays: 365 },
  { key: '4h', seconds: 14400, retentionDays: 730 },
  { key: '1d', seconds: 86400, retentionDays: 3650 },
];

export const TIMEFRAMES: Record<string, number> = Object.fromEntries(
  TIMEFRAME_LIST.map((spec) => [spec.key, spec.seconds]),
);

export const TIMEFRAME_KEYS = TIMEFRAME_LIST.map((spec) => spec.key);

export function timeframeSeconds(key: string): number | null {
  return TIMEFRAMES[key] ?? null;
}

export function isTimeframe(key: string): boolean {
  return key in TIMEFRAMES;
}

export function retentionSeconds(key: string): number {
  const spec = TIMEFRAME_LIST.find((entry) => entry.key === key);
  return Math.round((spec?.retentionDays ?? 1) * 86400);
}

/** The bucket a timestamp belongs to, in unix seconds. */
export function bucketFor(tsMs: number, seconds: number): number {
  return Math.floor(tsMs / 1000 / seconds) * seconds;
}
