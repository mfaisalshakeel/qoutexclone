/**
 * Broker-priced market engine.
 *
 * Every OTC market gets its own deterministic price process: a seeded RNG
 * carried inside the state, GARCH-style volatility clustering, alternating
 * trending and ranging regimes, mean reversion to a slowly drifting anchor,
 * bounded spikes, and a hard cap on how far one tick may move.
 *
 * Two rules shape this file and must not be relaxed:
 *
 * 1. It is **pure**. `nextTick` is a function of (state, params, elapsed) only.
 *    Nothing here reads the database, positions, exposure or anything about a
 *    trader. That is what makes the feed honest, and it is enforced by a test
 *    that asserts this module imports nothing but its own types.
 * 2. It is **resumable**. The whole process lives in `OtcState`, so persisting
 *    that row and loading it at boot continues the same path instead of
 *    restarting the walk and printing a gap.
 */

export interface OtcParams {
  /** Long-run per-minute standard deviation of returns. */
  baseVolatility: number;
  /** GARCH shock weight: how strongly the last move feeds current volatility. */
  garchAlpha: number;
  /** GARCH persistence: how long a volatile patch lasts. */
  garchBeta: number;
  /** Share of time spent trending rather than ranging, 0–1. */
  trendShare: number;
  /** A regime lasts a uniform draw between these two, in minutes. */
  regimeMinMinutes: number;
  regimeMaxMinutes: number;
  /** Drift while trending, as a multiple of the current per-tick sigma. */
  trendStrength: number;
  /** Pull toward the anchor per tick while ranging (and, weaker, while trending). */
  meanReversion: number;
  /** How fast the anchor itself wanders, as a fraction per hour. */
  anchorDriftPerHour: number;
  /** Probability per tick of a spike. */
  spikeProbability: number;
  /** Spike size as a multiple of the current per-tick sigma. */
  spikeSigmaMultiple: number;
  /** Hard cap on a single tick's move, as a fraction of price. */
  maxTickMove: number;
  /** Engine tick interval in ms; the feed uses this to pace this market. */
  tickMs: number;
  /** When true and a spot price is supplied, the anchor tracks the real market. */
  followSpot: boolean;
}

export interface OtcState {
  symbol: string;
  price: number;
  /** The level the price reverts toward; wanders slowly on its own. */
  anchor: number;
  /** Current per-tick variance (GARCH). */
  variance: number;
  /** Last tick's return, feeding the next variance. */
  lastShock: number;
  regime: 'TREND' | 'RANGE';
  /** Ticks remaining in the current regime. */
  regimeTicksLeft: number;
  trendDirection: 1 | -1;
  /** RNG state, so the path resumes exactly where it stopped. */
  rng: number;
  ticks: number;
}

export const DEFAULT_OTC_PARAMS: OtcParams = {
  baseVolatility: 0.0012,
  garchAlpha: 0.08,
  garchBeta: 0.9,
  trendShare: 0.45,
  regimeMinMinutes: 3,
  regimeMaxMinutes: 25,
  trendStrength: 0.35,
  meanReversion: 0.0015,
  anchorDriftPerHour: 0.0025,
  spikeProbability: 0.0008,
  spikeSigmaMultiple: 4,
  maxTickMove: 0.004,
  tickMs: 250,
  followSpot: false,
};

/** Merges a partial per-asset override over the defaults, clamped to sane ranges. */
export function resolveParams(overrides?: Partial<OtcParams> | null): OtcParams {
  const merged = { ...DEFAULT_OTC_PARAMS, ...(overrides ?? {}) };
  // alpha + beta must stay below 1 or the variance process explodes
  const sum = merged.garchAlpha + merged.garchBeta;
  if (sum >= 0.995) {
    const scale = 0.99 / sum;
    merged.garchAlpha *= scale;
    merged.garchBeta *= scale;
  }
  return {
    ...merged,
    baseVolatility: clamp(merged.baseVolatility, 0.00001, 0.05),
    trendShare: clamp(merged.trendShare, 0, 1),
    regimeMinMinutes: clamp(merged.regimeMinMinutes, 0.5, 240),
    regimeMaxMinutes: clamp(Math.max(merged.regimeMaxMinutes, merged.regimeMinMinutes), 0.5, 480),
    trendStrength: clamp(merged.trendStrength, 0, 3),
    meanReversion: clamp(merged.meanReversion, 0, 0.2),
    anchorDriftPerHour: clamp(merged.anchorDriftPerHour, 0, 0.5),
    spikeProbability: clamp(merged.spikeProbability, 0, 0.05),
    spikeSigmaMultiple: clamp(merged.spikeSigmaMultiple, 1, 12),
    maxTickMove: clamp(merged.maxTickMove, 0.0002, 0.05),
    tickMs: clamp(Math.round(merged.tickMs), 50, 10_000),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/* --------------------------------- random --------------------------------- */

/** mulberry32: small, fast, and its entire state is one uint32 we can persist. */
function nextRandom(state: number): { value: number; state: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

/** Box–Muller, threading the RNG state through both draws. */
function nextGaussian(rng: number): { value: number; state: number } {
  const first = nextRandom(rng);
  const second = nextRandom(first.state);
  // guard the log against exactly zero
  const u1 = Math.max(first.value, Number.EPSILON);
  const value = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * second.value);
  return { value, state: second.state };
}

export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* ---------------------------------- state --------------------------------- */

export function initialState(symbol: string, basePrice: number, params: OtcParams): OtcState {
  const rng = seedFrom(symbol);
  const sigmaTick = params.baseVolatility * Math.sqrt(params.tickMs / 60_000);
  const regime = pickRegime(rng, params);

  return {
    symbol,
    price: basePrice,
    anchor: basePrice,
    variance: sigmaTick * sigmaTick,
    lastShock: 0,
    regime: regime.regime,
    regimeTicksLeft: regime.ticks,
    trendDirection: regime.direction,
    rng: regime.rng,
    ticks: 0,
  };
}

function pickRegime(
  rng: number,
  params: OtcParams,
): { regime: 'TREND' | 'RANGE'; ticks: number; direction: 1 | -1; rng: number } {
  const kind = nextRandom(rng);
  const length = nextRandom(kind.state);
  const side = nextRandom(length.state);

  const minutes =
    params.regimeMinMinutes + length.value * (params.regimeMaxMinutes - params.regimeMinMinutes);
  return {
    regime: kind.value < params.trendShare ? 'TREND' : 'RANGE',
    ticks: Math.max(1, Math.round((minutes * 60_000) / params.tickMs)),
    direction: side.value < 0.5 ? -1 : 1,
    rng: side.state,
  };
}

export interface TickInput {
  state: OtcState;
  params: OtcParams;
  /** Real elapsed time, so a restart or a slow loop does not distort the walk. */
  elapsedMs?: number;
  /** The matching real market's price, used only when `followSpot` is on. */
  spotPrice?: number | null;
  /** Rounding precision of the market. */
  precision: number;
}

/**
 * Advances one market by one tick. Pure: same inputs, same output, forever.
 */
export function nextTick({ state, params, elapsedMs, spotPrice, precision }: TickInput): OtcState {
  const dt = clamp(elapsedMs ?? params.tickMs, 1, 60_000);
  const scale = Math.sqrt(dt / params.tickMs); // a long gap moves proportionally more

  // --- volatility: GARCH(1,1) around the long-run per-tick variance
  const sigmaTick = params.baseVolatility * Math.sqrt(params.tickMs / 60_000);
  const longRun = sigmaTick * sigmaTick;
  const omega = longRun * (1 - params.garchAlpha - params.garchBeta);
  const variance = Math.max(
    omega + params.garchAlpha * state.lastShock * state.lastShock + params.garchBeta * state.variance,
    longRun * 0.05,
  );
  const sigma = Math.sqrt(variance) * scale;

  // --- regime bookkeeping
  let regime = state.regime;
  let regimeTicksLeft = state.regimeTicksLeft - 1;
  let trendDirection = state.trendDirection;
  let rng = state.rng;
  if (regimeTicksLeft <= 0) {
    const next = pickRegime(rng, params);
    regime = next.regime;
    regimeTicksLeft = next.ticks;
    trendDirection = next.direction;
    rng = next.rng;
  }

  // --- the random part of the move
  const gaussian = nextGaussian(rng);
  rng = gaussian.state;
  let shock = gaussian.value * sigma;

  // --- occasional spike, bounded by configuration
  const spikeRoll = nextRandom(rng);
  rng = spikeRoll.state;
  if (spikeRoll.value < params.spikeProbability * (dt / params.tickMs)) {
    const direction = nextRandom(rng);
    rng = direction.state;
    shock += (direction.value < 0.5 ? -1 : 1) * params.spikeSigmaMultiple * sigma;
  }

  // --- drift while trending, and reversion toward the anchor
  const drift = regime === 'TREND' ? trendDirection * params.trendStrength * sigma : 0;
  const reversionStrength = regime === 'RANGE' ? params.meanReversion : params.meanReversion * 0.3;
  const reversion = ((state.anchor - state.price) / state.price) * reversionStrength * (dt / params.tickMs);

  // --- the anchor itself wanders, or tracks the real market when asked to
  let anchor = state.anchor;
  if (params.followSpot && spotPrice && spotPrice > 0) {
    // ease toward spot rather than snapping, so the tape has no gap
    anchor = anchor + (spotPrice - anchor) * clamp(0.02 * (dt / params.tickMs), 0, 1);
  } else {
    const anchorRoll = nextGaussian(rng);
    rng = anchorRoll.state;
    anchor = anchor * (1 + anchorRoll.value * params.anchorDriftPerHour * Math.sqrt(dt / 3_600_000));
  }

  // --- assemble, cap the move, and keep the price positive
  const rawReturn = shock + drift + reversion;
  const limit = params.maxTickMove * scale;
  const capped = clamp(rawReturn, -limit, limit);
  const factor = 10 ** precision;

  // rounding to the market's precision can nudge a capped move just past the
  // cap, so the rounded price is clamped back into the band: "no tick moves
  // more than maxTickMove" then holds exactly, which is what the tape promises
  const bandLow = state.price * (1 - limit);
  const bandHigh = state.price * (1 + limit);
  const rounded = Math.round(state.price * (1 + capped) * factor) / factor;
  const withinBand = Math.min(
    Math.max(rounded, Math.ceil(bandLow * factor) / factor),
    Math.floor(bandHigh * factor) / factor,
  );
  const nextPrice = Math.max(withinBand, 1 / factor);

  return {
    symbol: state.symbol,
    price: nextPrice,
    anchor,
    variance,
    lastShock: nextPrice / state.price - 1,
    regime,
    regimeTicksLeft,
    trendDirection,
    rng,
    ticks: state.ticks + 1,
  };
}

/** Serialisable form for the `OtcMarketState` row. */
export function toRow(state: OtcState) {
  return {
    symbol: state.symbol,
    price: state.price,
    anchor: state.anchor,
    variance: state.variance,
    lastShock: state.lastShock,
    regime: state.regime,
    regimeTicksLeft: state.regimeTicksLeft,
    trendDirection: state.trendDirection,
    rng: state.rng,
    ticks: state.ticks,
  };
}

/** A stored row, whose enum-ish columns arrive as plain strings and numbers. */
export interface OtcStateRow {
  symbol: string;
  price: number;
  anchor: number;
  variance: number;
  lastShock: number;
  regime: string;
  regimeTicksLeft: number;
  trendDirection: number;
  rng: number;
  ticks: number;
}

export function fromRow(row: OtcStateRow): OtcState {
  return {
    symbol: row.symbol,
    price: row.price,
    anchor: row.anchor,
    variance: row.variance,
    lastShock: row.lastShock,
    regime: row.regime === 'TREND' ? 'TREND' : 'RANGE',
    regimeTicksLeft: row.regimeTicksLeft,
    trendDirection: row.trendDirection === -1 ? -1 : 1,
    rng: row.rng,
    ticks: row.ticks,
  };
}
