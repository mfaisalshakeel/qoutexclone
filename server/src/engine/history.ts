import {
  DEFAULT_OTC_PARAMS,
  initialState,
  nextTick,
  resolveParams,
  seedFrom,
  type OtcParams,
} from './otc.js';

/**
 * Generated market history.
 *
 * A broker-priced market has no exchange archive to import, so its past is
 * produced by the same engine that prices its present. Three things have to be
 * true for that history to be usable rather than merely random:
 *
 * 1. **The candles must be scaled to their timeframe.** A daily candle has to
 *    move like a day, not like a ten-second tick. The engine's volatility is
 *    quoted per minute, so walking it with `elapsedMs === tickMs` over one
 *    candle's worth of time makes the square-root-of-time law come out on its
 *    own; where that would cost hundreds of thousands of ticks the walk is
 *    coarsened and its volatility scaled up to compensate.
 * 2. **The level must stay believable.** An unconstrained walk of three hundred
 *    candles is free to end tens of percent from where the market actually
 *    trades, and paging backwards compounds it. Every page is pinned to the
 *    price it joins with a Brownian bridge, and its interior damped into a band
 *    that follows the market's own volatility and the span it covers.
 * 3. **The series must be continuous.** Each candle opens exactly where the
 *    previous one closed, as a real tape does.
 *
 * Everything here is pure and seeded: the same request produces the same page
 * forever, which is what lets a page be regenerated rather than stored twice.
 */

export interface GeneratedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** The engine paces itself in ticks of at most ten seconds. */
const MAX_TICK_MS = 10_000;
const MIN_SUB_STEPS = 4;
/**
 * Ceiling on ticks per candle. A day at ten seconds a tick is 8,640 of them,
 * and 300 of those candles is a visible pause on the first chart load, so long
 * candles are walked coarsely with the volatility scaled up to match.
 */
const MAX_SUB_STEPS = 480;

/** Square-root-of-time holds within the hour. */
const DIFFUSIVE_MINUTES = 60;
/**
 * Beyond it, this exponent takes over. Markets are sub-diffusive over long
 * horizons, and these markets are deliberately livelier than their real
 * counterparts so that a sixty-second trade has something to trade — extending
 * that liveliness by the square-root law would imply a daily candle several
 * times the real one and a yearly chart nobody would believe.
 */
const LONG_HORIZON_EXPONENT = 0.3;

/**
 * The move a market of this per-minute volatility implies over `minutes`.
 *
 * This is the single scale law in the file: it sizes the candles a timeframe
 * gets and it sizes the band a page of history may wander in, so the two can
 * never disagree.
 */
export function horizonSigma(minutes: number, volatility: number): number {
  const span = Math.max(minutes, 0);
  const unit = Math.max(volatility, 0);
  if (span <= DIFFUSIVE_MINUTES) return unit * Math.sqrt(span);
  return unit * Math.sqrt(DIFFUSIVE_MINUTES) * (span / DIFFUSIVE_MINUTES) ** LONG_HORIZON_EXPONENT;
}

export interface TickPlan {
  subSteps: number;
  tickMs: number;
  /** Volatility multiplier that gives the candle its timeframe's true scale. */
  volScale: number;
}

/** Splits one candle into engine ticks of a size the engine accepts. */
export function tickPlan(seconds: number): TickPlan {
  const candleMs = Math.max(Math.round(seconds), 1) * 1000;
  const wanted = Math.max(MIN_SUB_STEPS, Math.ceil(candleMs / MAX_TICK_MS));
  const subSteps = Math.min(MAX_SUB_STEPS, wanted);
  // the cap can leave a tick longer than the engine accepts, and it would be
  // silently clamped there — so shorten it here and let `volScale` pay for it
  const tickMs = Math.min(MAX_TICK_MS, Math.max(1, Math.round(candleMs / subSteps)));

  // The engine compounds `subSteps` ticks into one candle, which covers
  // `walkMinutes` of engine time. Whatever that falls short of the candle's own
  // horizon is made up by raising the volatility handed to the engine.
  const walkMinutes = (subSteps * tickMs) / 60_000;
  const volScale = horizonSigma(candleMs / 60_000, 1) / Math.sqrt(walkMinutes);
  return { subSteps, tickMs, volScale };
}

export interface PageRequest {
  /** Seeds the walk; the same key always yields the same page. */
  seedKey: string;
  /** Price the walk starts from, before the bridge moves it onto its target. */
  startPrice: number;
  /** Candle duration in seconds. */
  seconds: number;
  count: number;
  /** Bucket the page ends at, exclusive, in epoch seconds. */
  endBucket: number;
  /** The market's per-minute volatility. */
  volatility: number;
  precision: number;
  otcConfig?: Partial<OtcParams> | null;
}

/** Walks the engine forward and buckets the ticks into candles, oldest first. */
export function walkPage(request: PageRequest): GeneratedCandle[] {
  if (request.count <= 0) return [];
  const plan = tickPlan(request.seconds);
  const overrides = request.otcConfig ?? {};
  const params = resolveParams({
    ...overrides,
    baseVolatility: request.volatility * plan.volScale,
    // the per-tick cap guards the smoothness of the live tape; a coarsened walk
    // has to be allowed the bigger steps it is now standing in for
    maxTickMove: (overrides.maxTickMove ?? DEFAULT_OTC_PARAMS.maxTickMove) * plan.volScale,
    tickMs: plan.tickMs,
    // a generated page has no live spot market to follow
    followSpot: false,
  });

  let state = initialState(request.seedKey, request.startPrice, params);
  state = { ...state, rng: seedFrom(`${request.seedKey}:walk`) };

  const candles: GeneratedCandle[] = [];
  for (let index = request.count; index > 0; index -= 1) {
    const open = state.price;
    let high = open;
    let low = open;
    for (let step = 0; step < plan.subSteps; step += 1) {
      // elapsed === tickMs keeps the volatility scaling honest
      state = nextTick({ state, params, elapsedMs: params.tickMs, precision: request.precision });
      high = Math.max(high, state.price);
      low = Math.min(low, state.price);
    }
    candles.push({
      time: request.endBucket - index * request.seconds,
      open,
      high,
      low,
      close: state.price,
    });
  }
  return candles;
}

/* ---------------------------------- level --------------------------------- */

/** Even minutes of history should not join perfectly flat. */
const MIN_DRIFT = 0.0006;
/** However far back you page, history stays inside this band of the join. */
const MAX_DRIFT = 0.35;
/**
 * Peak-to-trough wander allowed inside a page, as a multiple of the drift its
 * endpoints are allowed.
 */
const SWING_MULTIPLE = 1.5;

/** How far a page covering `spanSeconds` may end from the price it joins. */
export function driftBound(spanSeconds: number, volatility: number): number {
  const implied = horizonSigma(Math.max(spanSeconds, 0) / 60, volatility);
  return Math.min(MAX_DRIFT, Math.max(MIN_DRIFT, implied));
}

/** How far the interior of such a page may wander from its endpoints. */
export function swingBound(spanSeconds: number, volatility: number): number {
  return driftBound(spanSeconds, volatility) * SWING_MULTIPLE;
}

/** A deterministic signed drift inside the bound for this page. */
export function driftFor(seedKey: string, spanSeconds: number, volatility: number): number {
  const unit = seedFrom(`${seedKey}:drift`) / 4294967296 - 0.5;
  return unit * 2 * driftBound(spanSeconds, volatility);
}

export interface BridgeOptions {
  /** Level the first candle should open at. */
  startTarget: number;
  /** Level the last candle must close at, exactly. */
  endTarget: number;
  /** Largest peak-to-trough wander the interior may hold, as a fraction. */
  maxSwing: number;
  precision: number;
}

/**
 * Pins a generated page to the level it has to join.
 *
 * Each candle is multiplied by one factor, so its body and wicks keep their
 * proportions; what changes is where the page sits and how far it strays from
 * the line between its endpoints. The last close lands on `endTarget` exactly,
 * which is what makes the joint with the newer page seamless, and every open is
 * stitched to the previous close so the page has no gaps of its own.
 */
export function bridgePage(raw: GeneratedCandle[], options: BridgeOptions): GeneratedCandle[] {
  if (raw.length === 0) return [];

  const factor = 10 ** options.precision;
  const round = (value: number) => Math.round(value * factor) / factor;
  const rawStart = raw[0].open;
  const rawEnd = raw[raw.length - 1].close;
  if (!(rawStart > 0) || !(rawEnd > 0) || !(options.startTarget > 0) || !(options.endTarget > 0)) {
    return raw;
  }

  const logRawStart = Math.log(rawStart);
  const logRawEnd = Math.log(rawEnd);
  const logStart = Math.log(options.startTarget);
  const logEnd = Math.log(options.endTarget);

  const progressOf = (index: number) => (raw.length === 1 ? 1 : index / (raw.length - 1));
  const rawLineAt = (index: number) => {
    const progress = progressOf(index);
    return logRawStart * (1 - progress) + logRawEnd * progress;
  };

  // how far the walk strayed from its own endpoints, and by how much that has
  // to shrink to fit the band this page is allowed
  const widest = raw.reduce(
    (worst, candle, index) => Math.max(worst, Math.abs(Math.log(candle.close) - rawLineAt(index))),
    1e-9,
  );
  // the band is peak-to-trough, so a deviation either side of the line gets
  // half of it
  const damping = Math.min(1, Math.log(1 + options.maxSwing / 2) / widest);

  const scaled = raw.map((candle, index) => {
    const progress = progressOf(index);
    const rawLine = rawLineAt(index);
    const targetLine = logStart * (1 - progress) + logEnd * progress;
    const deviation = Math.log(candle.close) - rawLine;
    const correction = Math.exp(targetLine - rawLine - (1 - damping) * deviation);
    const close = candle.close * correction;
    // Damping the level without damping the candles would leave a series of
    // dojis with full-size wicks. A damped page is simply a calmer version of
    // the same walk, so each candle's own geometry is compressed around its
    // close by the same factor.
    const compress = (value: number) => close * (1 + damping * (value / candle.close - 1));
    return {
      time: candle.time,
      open: round(compress(candle.open)),
      high: round(compress(candle.high)),
      low: round(compress(candle.low)),
      close: round(close),
    };
  });

  // Stitch the series continuous. Damping moves neighbouring candles by
  // slightly different factors, which would otherwise leave a small gap at
  // every boundary; carrying the previous close over as the open removes them,
  // and the wick is widened when that open sits outside the candle's range.
  scaled[0].open = round(options.startTarget);
  for (let index = 0; index < scaled.length; index += 1) {
    const candle = scaled[index];
    if (index > 0) candle.open = scaled[index - 1].close;
    candle.high = Math.max(candle.high, candle.open, candle.close);
    candle.low = Math.min(candle.low, candle.open, candle.close);
  }
  return scaled;
}

/**
 * Generates a page and pins it to `endTarget` in one step: the shape comes from
 * the engine, the level from the bridge.
 */
export function generateHistory(
  request: Omit<PageRequest, 'startPrice'> & { endTarget: number },
): GeneratedCandle[] {
  const raw = walkPage({ ...request, startPrice: request.endTarget });
  if (raw.length === 0) return [];
  const span = request.seconds * raw.length;
  const drift = driftFor(request.seedKey, span, request.volatility);
  return bridgePage(raw, {
    startTarget: request.endTarget * (1 + drift),
    endTarget: request.endTarget,
    maxSwing: swingBound(span, request.volatility),
    precision: request.precision,
  });
}
