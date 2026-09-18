/**
 * Picking the candles that show what happened to a position.
 *
 * A trade's chart snippet has to hold enough bars to read the move but not so
 * many that the trade itself becomes a single pixel. The timeframe therefore
 * follows the position's own length, and the window is padded either side so a
 * trader can see the approach as well as the outcome.
 *
 * Pure, so the window the server returns and any expectation about it can be
 * reasoned about in a test.
 */

/** Roughly how many bars make a readable snippet. */
const TARGET_BARS = 40;

/**
 * Candle sizes the store keeps, smallest first. The chooser only ever picks
 * from these, so a snippet can always be served from stored history.
 */
const CANDLE_SECONDS = [5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 14_400, 86_400];

const LABELS: Record<number, string> = {
  5: '5s',
  10: '10s',
  15: '15s',
  30: '30s',
  60: '1m',
  120: '2m',
  180: '3m',
  300: '5m',
  600: '10m',
  900: '15m',
  1800: '30m',
  3600: '1h',
  14400: '4h',
  86400: '1d',
};

/**
 * The timeframe whose bars divide this position into something readable: the
 * smallest that keeps the whole trade inside `TARGET_BARS`.
 */
export function timeframeForDuration(durationSec: number): string {
  const duration = Math.max(Math.round(durationSec), 1);
  for (const seconds of CANDLE_SECONDS) {
    if (duration / seconds <= TARGET_BARS) return LABELS[seconds];
  }
  return LABELS[86_400];
}

export interface SnapshotWindow {
  timeframe: string;
  /** Inclusive bounds in epoch seconds, aligned to the timeframe's buckets. */
  from: number;
  to: number;
  /** How many candles the window spans. */
  bars: number;
}

/**
 * The window to fetch for one position: the trade plus padding either side, so
 * the entry is not pinned to the left edge.
 */
export function snapshotWindow(openedAtMs: number, expiresAtMs: number, durationSec: number): SnapshotWindow {
  const timeframe = timeframeForDuration(durationSec);
  const seconds = Number(Object.entries(LABELS).find(([, label]) => label === timeframe)?.[0] ?? 60);

  const start = Math.floor(openedAtMs / 1000);
  const end = Math.ceil(expiresAtMs / 1000);
  const span = Math.max(end - start, seconds);
  // a quarter of the trade's length either side, and never less than two bars,
  // so a very short position still has context around it
  const pad = Math.max(Math.round(span / 4), seconds * 2);

  const from = Math.floor((start - pad) / seconds) * seconds;
  const to = Math.ceil((end + pad) / seconds) * seconds;
  return { timeframe, from, to, bars: Math.round((to - from) / seconds) + 1 };
}
