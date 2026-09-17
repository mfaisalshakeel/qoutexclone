import { create } from 'zustand';
import { api } from '../lib/api';
import type { ExpiryConfig, TicketConfig } from '../lib/types';
import { realtime } from '../lib/ws';
import type { Asset } from '../lib/types';

interface MarketState {
  assets: Asset[];
  durations: number[];
  /** What expiry modes the platform offers, and the clock boundaries on offer. */
  expiry: ExpiryConfig;
  /** Stake presets, the ± step, and whether a position may be repeated. */
  ticket: TicketConfig;
  timeframes: string[];
  prices: Record<string, number>;
  symbol: string;
  timeframe: string;
  connected: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  selectSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: string) => void;
  setPrices: (prices: Record<string, number>) => void;
  setPayouts: (
    payouts: Record<
      string,
      { pct: number; basePct: number; adjustments: { name: string; kind: string; adjustment: number }[] }
    >,
  ) => void;
  setConnected: (connected: boolean) => void;
}

const LAST_SYMBOL_KEY = 'qx.symbol';

export const useMarket = create<MarketState>((set, get) => ({
  assets: [],
  durations: [30, 60, 120, 300, 900],
  expiry: { modes: ['DURATION'], clock: { steps: [], cutoffSec: 30, horizonSec: 14400, slots: [] } },
  ticket: {
    presets: [1000, 2500, 5000, 10000, 25000, 50000],
    step: 1000,
    allowRepeat: true,
    hotkeys: true,
  },
  timeframes: ['5s', '10s', '15s', '30s', '1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '4h', '1d'],
  prices: {},
  // the catalogue's lead market; `load` corrects a stored symbol that no longer exists
  symbol: localStorage.getItem(LAST_SYMBOL_KEY) ?? 'EURUSD',
  timeframe: '1m',
  connected: false,
  loaded: false,

  async load() {
    const data = await api.get<{
      assets: Asset[];
      durations: number[];
      expiry: ExpiryConfig;
      ticket: TicketConfig;
      timeframes: string[];
    }>('/market/assets');
    const symbol = data.assets.some((a) => a.symbol === get().symbol) ? get().symbol : data.assets[0]?.symbol;
    set({
      assets: data.assets,
      durations: data.durations,
      expiry: data.expiry,
      ticket: data.ticket,
      timeframes: data.timeframes,
      prices: Object.fromEntries(data.assets.map((a) => [a.symbol, a.price ?? 0])),
      symbol: symbol ?? get().symbol,
      loaded: true,
    });
    realtime.subscribe(symbol ?? get().symbol, get().timeframe);
  },

  selectSymbol(symbol) {
    localStorage.setItem(LAST_SYMBOL_KEY, symbol);
    set({ symbol });
    realtime.subscribe(symbol, get().timeframe);
  },

  setTimeframe(timeframe) {
    set({ timeframe });
    realtime.subscribe(get().symbol, timeframe);
  },

  setPrices(prices) {
    set({ prices: { ...get().prices, ...prices } });
  },

  /**
   * Payouts move on the clock and on volatility, so the server pushes the ones
   * that changed. Patching the catalogue keeps the ticket honest without a
   * reload — and the figure a trade is actually locked at still comes from the
   * server when the trade opens.
   */
  setPayouts(payouts) {
    const assets = get().assets;
    if (!assets.some((asset) => payouts[asset.symbol] !== undefined)) return;
    set({
      assets: assets.map((asset) => {
        const live = payouts[asset.symbol];
        if (!live) return asset;
        return {
          ...asset,
          payoutPct: live.pct,
          basePayoutPct: live.basePct,
          payoutAdjustments: live.adjustments,
        };
      }),
    });
  },

  setConnected(connected) {
    set({ connected });
  },
}));

export function assetOf(symbol: string, assets: Asset[]): Asset | undefined {
  return assets.find((a) => a.symbol === symbol);
}
