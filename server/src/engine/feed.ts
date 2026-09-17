import { EventEmitter } from 'node:events';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { initialState, nextTick, resolveParams, type OtcParams, type OtcState } from './otc.js';
import { providerRegistry, type ProviderHealth } from './providers/index.js';
import { TIMEFRAMES, TIMEFRAME_LIST, bucketFor } from './timeframes.js';

export interface Tick {
  symbol: string;
  price: number;
  ts: number;
}

export interface Candle {
  /** bucket start, unix seconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AssetSpec {
  symbol: string;
  feedSymbol: string;
  assetClass?: string;
  basePrice: number;
  volatility: number;
  precision: number;
  /** Broker-priced market: the engine owns its price entirely. */
  isOtc?: boolean;
  /** Per-market engine overrides, straight from `Asset.otcConfig`. */
  otcConfig?: Partial<OtcParams> | null;
  /** The matching real market, whose price the anchor may follow. */
  spotSymbol?: string | null;
}

export { TIMEFRAMES } from './timeframes.js';

/**
 * How many closed candles stay in memory per market and timeframe. The store
 * owns the long history; this is only the tail a chart needs immediately, and
 * it has to stay small because it is held for every market at once.
 */
const MEMORY_CANDLES = 60;

/**
 * Ticks are only kept long enough to price an expiry at its exact instant,
 * which settlement does within seconds. 600 ticks is ~2.5 minutes at the
 * default rate — generous for settlement lag, and small enough to hold for
 * every market in the catalogue at once.
 */
const TICK_BUFFER = 600;

function round(value: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

interface SymbolState {
  spec: AssetSpec;
  price: number;
  /** The broker price process for this market. */
  engine: OtcState;
  params: OtcParams;
  lastTickAt: number;
  ticks: Tick[];
  candles: Map<string, Candle[]>;
}

/**
 * Market data hub.
 *
 * `simulated` (default) runs a seeded random walk per asset so the platform is
 * fully usable without any external market data. `binance` streams live trades
 * and falls back to the simulator if the socket cannot be reached — the rest of
 * the app only ever talks to this class.
 */
export class MarketFeed extends EventEmitter {
  private states = new Map<string, SymbolState>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /**
   * Answers whether a market is inside its trading session. A closed exchange
   * must not print new prices, so the simulator skips it and the last tick
   * stands until it reopens. OTC and crypto have no session and always tick.
   */
  private isTradeable: (symbol: string) => boolean = () => true;
  /**
   * Wall clock, injectable so tests can drive time deterministically. Markets
   * tick on their own interval, so the engine must measure real elapsed time
   * rather than assume one step per call.
   */
  private now: () => number = () => Date.now();

  /** Wired at boot to the market-hours service. */
  setSessionResolver(resolver: (symbol: string) => boolean): void {
    this.isTradeable = resolver;
  }

  /** Test seam: replaces the wall clock. */
  setClock(clock: () => number): void {
    this.now = clock;
  }

  /** Overall feed description, e.g. "binance + broker" or "broker". */
  get provider(): string {
    const live = [...new Set(this.symbols.map((symbol) => providerRegistry.sourceFor(symbol)))]
      .filter((source) => source !== 'broker')
      .sort();
    return live.length ? `${live.join(' + ')} + broker` : 'broker';
  }

  /** Where a single market's price is coming from right now. */
  sourceFor(symbol: string): string {
    return providerRegistry.sourceFor(symbol);
  }

  providerHealth(): ProviderHealth[] {
    return providerRegistry.health();
  }

  get symbols(): string[] {
    return [...this.states.keys()];
  }

  load(assets: AssetSpec[]): void {
    for (const spec of assets) {
      if (this.states.has(spec.symbol)) continue;
      // the asset's own volatility is the engine default unless overridden
      const params = resolveParams({
        baseVolatility: spec.volatility,
        tickMs: env.feedTickMs,
        followSpot: Boolean(spec.spotSymbol),
        ...(spec.otcConfig ?? {}),
      });
      const state: SymbolState = {
        spec,
        price: spec.basePrice,
        engine: initialState(spec.symbol, spec.basePrice, params),
        params,
        lastTickAt: this.now(),
        ticks: [],
        candles: new Map(),
      };
      this.states.set(spec.symbol, state);
      this.seedHistory(state);
    }
  }

  /** Restores persisted engine state so a restart continues the same path. */
  resume(states: OtcState[]): void {
    for (const persisted of states) {
      const state = this.states.get(persisted.symbol);
      if (!state) continue;
      state.engine = persisted;
      state.price = persisted.price;
      state.lastTickAt = this.now();
      // history is regenerated around the resumed price, not the seed price
      state.candles.clear();
      this.seedHistory(state);
    }
    if (states.length) log.feed.info({ markets: states.length }, 'resumed broker price state');
  }

  /** Snapshot for persistence. */
  snapshot(): OtcState[] {
    return [...this.states.values()].map((state) => state.engine);
  }

  /** Engine parameters in force for a market, for the admin preview. */
  paramsFor(symbol: string): OtcParams | null {
    return this.states.get(symbol)?.params ?? null;
  }

  /** Applies an operator's parameter change without a restart. */
  applyConfig(symbol: string, overrides: Partial<OtcParams> | null): void {
    const state = this.states.get(symbol);
    if (!state) return;
    state.spec = { ...state.spec, otcConfig: overrides };
    state.params = resolveParams({
      baseVolatility: state.spec.volatility,
      tickMs: env.feedTickMs,
      followSpot: Boolean(state.spec.spotSymbol),
      ...(overrides ?? {}),
    });
  }

  /**
   * Starts each timeframe with a single candle at the current price. Long
   * history comes from the candle store, which persists closed candles and
   * generates a market's past the first time it is charted.
   */
  private seedHistory(state: SymbolState): void {
    for (const spec of TIMEFRAME_LIST) {
      const time = bucketFor(this.now(), spec.seconds);
      const price = state.price;
      state.candles.set(spec.key, [{ time, open: price, high: price, low: price, close: price }]);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connectProviders();
    this.timer = setInterval(() => this.onInterval(), env.feedTickMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    providerRegistry.stop();
  }

  private onInterval(): void {
    const now = this.now();
    for (const state of this.states.values()) {
      if (!this.isTradeable(state.spec.symbol)) continue; // market closed: price is frozen
      // a live provider owns this market's price; the engine only fills gaps
      if (providerRegistry.isLive(state.spec.symbol)) continue;
      this.stepMarket(state, now);
    }
  }

  /** One engine step for one market, honouring its own tick rate. */
  private stepMarket(state: SymbolState, now: number): void {
    const elapsed = now - state.lastTickAt;
    if (elapsed + 1 < state.params.tickMs) return; // this market ticks more slowly
    state.lastTickAt = now;

    state.engine = nextTick({
      state: state.engine,
      params: state.params,
      elapsedMs: elapsed,
      spotPrice: state.spec.spotSymbol ? this.getPrice(state.spec.spotSymbol) : null,
      precision: state.spec.precision,
    });
    this.publish(state, state.engine.price, now);
  }

  /**
   * Hands every market to the provider registry. Providers push ticks straight
   * into `publish`; anything they cannot price (or stop pricing) is simulated.
   */
  private async connectProviders(): Promise<void> {
    // live data is opt-in; `simulated` keeps every market on the broker engine
    if (env.feedProvider === 'simulated') {
      log.feed.info('feed provider is "simulated": every market is broker-priced');
      return;
    }

    const markets = [...this.states.values()].map((state) => ({
      symbol: state.spec.symbol,
      feedSymbol: state.spec.feedSymbol,
      assetClass: state.spec.assetClass ?? 'CRYPTO',
      isOtc: Boolean(state.spec.isOtc),
      precision: state.spec.precision,
    }));

    await providerRegistry.start(markets, (tick) => {
      const state = this.states.get(tick.symbol);
      if (state) this.publish(state, tick.price, tick.ts);
    });
  }

  private publish(state: SymbolState, rawPrice: number, ts: number): void {
    const price = round(rawPrice, state.spec.precision);
    state.price = price;
    // keep the engine anchored to reality so a fallback continues smoothly
    if (state.engine.price !== price)
      state.engine = { ...state.engine, price, anchor: state.engine.anchor || price };
    state.ticks.push({ symbol: state.spec.symbol, price, ts });
    if (state.ticks.length > TICK_BUFFER) state.ticks.splice(0, state.ticks.length - TICK_BUFFER);
    this.updateCandles(state, price, ts);
    this.emit('tick', { symbol: state.spec.symbol, price, ts } satisfies Tick);
  }

  private updateCandles(state: SymbolState, price: number, ts: number): void {
    const seconds = Math.floor(ts / 1000);
    for (const [tf, size] of Object.entries(TIMEFRAMES)) {
      const series = state.candles.get(tf);
      if (!series) continue;
      const bucket = Math.floor(seconds / size) * size;
      const last = series[series.length - 1];

      if (!last || last.time < bucket) {
        // the previous bucket is final: hand it to the store for persistence
        if (last)
          this.emit('candleClosed', { symbol: state.spec.symbol, timeframe: tf, candle: { ...last } });

        const candle: Candle = { time: bucket, open: price, high: price, low: price, close: price };
        series.push(candle);
        if (series.length > MEMORY_CANDLES) series.shift();
        this.emit('candle', { symbol: state.spec.symbol, timeframe: tf, candle, closed: false });
      } else {
        last.close = price;
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;
        this.emit('candle', { symbol: state.spec.symbol, timeframe: tf, candle: last, closed: false });
      }
    }
  }

  getPrice(symbol: string): number | null {
    return this.states.get(symbol)?.price ?? null;
  }

  /** Whether this market is currently printing prices. */
  isLive(symbol: string): boolean {
    return this.states.has(symbol) && this.isTradeable(symbol);
  }

  /** Age in ms of the newest tick across all symbols, or null if none yet. */
  lastTickAge(): number | null {
    let newest = 0;
    for (const state of this.states.values()) {
      const tick = state.ticks[state.ticks.length - 1];
      if (tick && tick.ts > newest) newest = tick.ts;
    }
    return newest ? this.now() - newest : null;
  }

  /**
   * Realised per-minute volatility over the last `minutes`, as a fraction, so
   * it is directly comparable with the market's configured `volatility`.
   *
   * Measured from the closed one-minute candles the feed already holds, which
   * is why it needs no extra bookkeeping. Returns null until there are enough
   * of them — a payout rule must not fire on a guess.
   */
  realisedVolatility(symbol: string, minutes = 15): number | null {
    const series = this.states.get(symbol)?.candles.get('1m');
    if (!series || series.length < 4) return null;
    // the last candle is still open, so it is left out of the measurement
    const closed = series.slice(-Math.min(minutes + 1, series.length), -1);
    if (closed.length < 3) return null;

    const returns: number[] = [];
    for (let index = 1; index < closed.length; index += 1) {
      const previous = closed[index - 1].close;
      if (previous > 0) returns.push(Math.log(closed[index].close / previous));
    }
    if (returns.length < 2) return null;

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  getPrices(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [symbol, state] of this.states) out[symbol] = state.price;
    return out;
  }

  /** Price as of `ts` (ms) — the last tick at or before that moment. */
  priceAt(symbol: string, ts: number): number | null {
    const state = this.states.get(symbol);
    if (!state) return null;
    let match: number | null = null;
    for (let i = state.ticks.length - 1; i >= 0; i -= 1) {
      if (state.ticks[i].ts <= ts) {
        match = state.ticks[i].price;
        break;
      }
    }
    return match ?? state.price;
  }

  /** 24h-style change computed from the 5m series we keep in memory. */
  getChangePct(symbol: string): number {
    const series = this.states.get(symbol)?.candles.get('5m');
    if (!series || series.length < 2) return 0;
    const first = series[0].open;
    const last = series[series.length - 1].close;
    if (!first) return 0;
    return ((last - first) / first) * 100;
  }

  /**
   * Adopts buckets the last process left open, so the current candle continues
   * with its original open and its high and low intact rather than restarting
   * from the resumed price.
   */
  primeCandles(rows: { symbol: string; timeframe: string; candle: Candle }[]): void {
    for (const { symbol, timeframe, candle } of rows) {
      const series = this.states.get(symbol)?.candles.get(timeframe);
      if (!series) continue;
      const last = series[series.length - 1];
      // only the bucket the feed has just opened for itself may be replaced
      if (!last || last.time !== candle.time) continue;
      series[series.length - 1] = {
        time: candle.time,
        open: candle.open,
        high: Math.max(candle.high, last.close),
        low: Math.min(candle.low, last.close),
        close: last.close,
      };
    }
  }

  /**
   * Every bucket currently open, across all markets and timeframes.
   *
   * The store only hears about a candle when it closes, so without this the
   * bucket that happened to be open when the process stopped would never be
   * written and the chart would show a one-bucket hole after a restart.
   */
  openCandles(): { symbol: string; timeframe: string; candle: Candle }[] {
    const open: { symbol: string; timeframe: string; candle: Candle }[] = [];
    for (const [symbol, state] of this.states) {
      for (const [timeframe, series] of state.candles) {
        const last = series[series.length - 1];
        if (last) open.push({ symbol, timeframe, candle: { ...last } });
      }
    }
    return open;
  }

  getCandles(symbol: string, timeframe: string, limit = 200): Candle[] {
    const series = this.states.get(symbol)?.candles.get(timeframe);
    if (!series) return [];
    return series.slice(-Math.min(limit, series.length)).map((c) => ({ ...c }));
  }
}

export const marketFeed = new MarketFeed();
