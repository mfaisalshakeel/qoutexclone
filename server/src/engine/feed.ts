import { EventEmitter } from 'node:events';
import { env } from '../env.js';
import { log } from '../lib/logger.js';

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
  basePrice: number;
  volatility: number;
  precision: number;
}

export const TIMEFRAMES: Record<string, number> = {
  '5s': 5,
  '15s': 15,
  '1m': 60,
  '5m': 300,
};

const HISTORY_CANDLES = 400;
const SQRT3 = Math.sqrt(3);
const DRIFT_DECAY = 0.92; // how long a micro-trend persists
const DRIFT_GAIN = 0.12; // how strongly a shock feeds the trend
const MEAN_REVERSION = 0.0015; // pull back toward the asset's base price

/**
 * Per-tick standard deviation. `volatility` on an asset is expressed per
 * minute, which is how a trader thinks about it; ticks arrive far more often,
 * so it is scaled by the square root of the tick share of a minute.
 */
function tickSigma(spec: AssetSpec): number {
  return spec.volatility * Math.sqrt(env.feedTickMs / 60000);
}
const TICK_BUFFER = 8000; // ~33 min of 250ms ticks, enough to price any expiry

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
  drift: number;
  rand: () => number;
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
  private socket: import('ws').WebSocket | null = null;
  private liveConnected = false;
  private running = false;

  get provider(): string {
    return env.feedProvider === 'binance' && this.liveConnected ? 'binance' : 'simulated';
  }

  get symbols(): string[] {
    return [...this.states.keys()];
  }

  load(assets: AssetSpec[]): void {
    for (const spec of assets) {
      if (this.states.has(spec.symbol)) continue;
      const rand = mulberry32(hashSeed(spec.symbol));
      const state: SymbolState = {
        spec,
        price: spec.basePrice,
        drift: 0,
        rand,
        ticks: [],
        candles: new Map(),
      };
      this.states.set(spec.symbol, state);
      this.seedHistory(state);
    }
  }

  /** Back-fills candle history ending at the current price. */
  private seedHistory(state: SymbolState): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [tf, seconds] of Object.entries(TIMEFRAMES)) {
      const candles: Candle[] = [];
      let close = state.price;
      for (let i = 0; i < HISTORY_CANDLES; i += 1) {
        const time = (Math.floor(now / seconds) - i) * seconds;
        // history has to breathe at the same scale the live ticks do, so a
        // candle's range is the tick sigma scaled by the ticks it contains
        const vol = tickSigma(state.spec) * Math.sqrt((seconds * 1000) / env.feedTickMs);
        const open = close * (1 + (state.rand() - 0.5) * vol * 2);
        const high = Math.max(open, close) * (1 + state.rand() * vol);
        const low = Math.min(open, close) * (1 - state.rand() * vol);
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
    if (env.feedProvider === 'binance') this.connectLive();
    this.timer = setInterval(() => this.onInterval(), env.feedTickMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.liveConnected = false;
  }

  private onInterval(): void {
    // When a live socket is driving prices the simulator stays out of the way.
    if (this.liveConnected) return;
    const now = Date.now();
    for (const state of this.states.values()) this.publish(state, this.nextSimulatedPrice(state), now);
  }

  private nextSimulatedPrice(state: SymbolState): number {
    const sigma = tickSigma(state.spec);
    // Random shock plus a short-lived trend, pulled back toward the base price
    // so a long-running process never drifts into nonsense territory.
    const shock = (state.rand() - 0.5) * 2 * sigma * SQRT3; // uniform with std = sigma
    state.drift = state.drift * DRIFT_DECAY + shock * DRIFT_GAIN;
    const pull = ((state.spec.basePrice - state.price) / state.spec.basePrice) * MEAN_REVERSION;
    const next = state.price * (1 + shock + state.drift + pull);
    return Math.max(next, state.spec.basePrice * 0.2);
  }

  private async connectLive(): Promise<void> {
    try {
      const { WebSocket } = await import('ws');
      const streams = [...this.states.values()]
        .map((s) => `${s.spec.feedSymbol.toLowerCase()}@trade`)
        .join('/');
      const socket = new WebSocket(`${env.binanceWsUrl}?streams=${streams}`);
      this.socket = socket;
      const byFeed = new Map([...this.states.values()].map((s) => [s.spec.feedSymbol.toUpperCase(), s]));

      socket.on('open', () => {
        this.liveConnected = true;
        log.feed.info({ provider: 'binance' }, 'live market data connected');
      });
      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          const data = msg.data ?? msg;
          const state = byFeed.get(String(data.s ?? '').toUpperCase());
          const price = Number(data.p);
          if (state && Number.isFinite(price)) this.publish(state, price, data.T ?? Date.now());
        } catch {
          /* ignore malformed frame */
        }
      });
      const degrade = (reason: string) => {
        if (this.liveConnected) log.feed.warn({ reason }, 'live data lost, using simulated prices');
        this.liveConnected = false;
        this.socket = null;
        if (this.running) setTimeout(() => this.connectLive(), 15000).unref?.();
      };
      socket.on('close', () => degrade('closed'));
      socket.on('error', (err: Error) => degrade(err.message));
    } catch (err) {
      log.feed.warn({ err }, 'live data unavailable, using simulated prices');
      this.liveConnected = false;
    }
  }

  private publish(state: SymbolState, rawPrice: number, ts: number): void {
    const price = round(rawPrice, state.spec.precision);
    state.price = price;
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

  /** Age in ms of the newest tick across all symbols, or null if none yet. */
  lastTickAge(): number | null {
    let newest = 0;
    for (const state of this.states.values()) {
      const tick = state.ticks[state.ticks.length - 1];
      if (tick && tick.ts > newest) newest = tick.ts;
    }
    return newest ? Date.now() - newest : null;
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
