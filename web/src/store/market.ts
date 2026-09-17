import { create } from 'zustand';
import { api } from '../lib/api';
import { realtime } from '../lib/ws';
import type { Asset } from '../lib/types';

interface MarketState {
  assets: Asset[];
  durations: number[];
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
  setConnected: (connected: boolean) => void;
}

const LAST_SYMBOL_KEY = 'qx.symbol';

export const useMarket = create<MarketState>((set, get) => ({
  assets: [],
  durations: [30, 60, 120, 300, 900],
  timeframes: ['5s', '15s', '1m', '5m'],
  prices: {},
  symbol: localStorage.getItem(LAST_SYMBOL_KEY) ?? 'BTCUSD',
  timeframe: '1m',
  connected: false,
  loaded: false,

  async load() {
    const data = await api.get<{ assets: Asset[]; durations: number[]; timeframes: string[] }>(
      '/market/assets',
    );
    const symbol = data.assets.some((a) => a.symbol === get().symbol) ? get().symbol : data.assets[0]?.symbol;
    set({
      assets: data.assets,
      durations: data.durations,
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

  setConnected(connected) {
    set({ connected });
  },
}));

export function assetOf(symbol: string, assets: Asset[]): Asset | undefined {
  return assets.find((a) => a.symbol === symbol);
}
