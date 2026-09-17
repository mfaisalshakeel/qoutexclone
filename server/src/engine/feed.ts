import { EventEmitter } from 'node:events';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { initialState, nextTick, resolveParams, type OtcParams, type OtcState } from './otc.js';
import { providerRegistry, type ProviderHealth } from './providers/index.js';

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

export const TIMEFRAMES: Record<string, number> = {
  '5s': 5,
  '15s': 15,
  '1m': 60,
  '5m': 300,
};

const HISTORY_CANDLES = 400;

/**
 * Per-tick standard deviation. `baseVolatility` is per minute, which is how a
 * trader thinks about it; ticks arrive far more often, so it is scaled by the
 * square root of the tick's share of a minute.
 */
function tickSigma(params: { baseVolatility: number; tickMs: number }): number {
  return params.baseVolatility * Math.sqrt(params.tickMs / 60000);
}
/**
 * Ticks are only kept long enough to price an expiry at its exact instant,
 * which settlement does within seconds. 600 ticks is ~2.5 minutes at the
 * default rate — generous for settlement lag, and small enough to hold for
 * every market in the catalogue at once.
 */
const TICK_BUFFER = 600;

/** Deterministic PRNG so restarts do not reshuffle chart history. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
   * Back-fills candle history ending at the current price, walking backwards so
   * the newest candle closes exactly where the live price is. It uses its own
   * seeded generator (derived from the symbol) rather than the live engine
   * state, which must not be consumed by drawing history.
   */
  private seedHistory(state: SymbolState): void {
    const now = Math.floor(this.now() / 1000);
    const random = mulberry32(hashSeed(`${state.spec.symbol}:history`));
    for (const [tf, seconds] of Object.entries(TIMEFRAMES)) {
      const candles: Candle[] = [];
      let close = state.price;
      for (let i = 0; i < HISTORY_CANDLES; i += 1) {
        const time = (Math.floor(now / seconds) - i) * seconds;
        // history has to breathe at the same scale the live ticks do, so a
        // candle's range is the tick sigma scaled by the ticks it contains
        const vol = tickSigma(state.params) * Math.sqrt((seconds * 1000) / state.params.tickMs);
        const open = close * (1 + (random() - 0.5) * vol * 2);
        const high = Math.max(open, close) * (1 + random() * vol);
        const low = Math.min(open, close) * (1 - random() * vol);
        candles.push({
          time,
          open: round(open, state.spec.precision),
          high: round(high, state.spec.precision),
          low: round(low, state.spec.precision),
          close: round(close, state.spec.precision),
        });
        close = open;
      }
      candles.reverse();
      state.candles.set(tf, candles);
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
        const candle: Candle = { time: bucket, open: price, high: price, low: price, close: price };
        series.push(candle);
        if (series.length > HISTORY_CANDLES) series.shift();
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

  getCandles(symbol: string, timeframe: string, limit = 200): Candle[] {
    const series = this.states.get(symbol)?.candles.get(timeframe);
    if (!series) return [];
    return series.slice(-Math.min(limit, series.length)).map((c) => ({ ...c }));
  }
}

export const marketFeed = new MarketFeed();
