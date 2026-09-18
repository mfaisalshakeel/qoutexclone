import { create } from 'zustand';
import { api, tokens } from '../lib/api';
import type { ExpiryConfig, TicketConfig, TraderSentiment } from '../lib/types';
import { loadFavourites, loadRecents, pushRecent } from '../lib/watchlist';
import type { PracticeConfig } from '../lib/accounts';
import {
  clampFocus,
  defaultLayout,
  parseLayout,
  resize,
  updatePane,
  type LayoutKind,
  type TerminalLayout,
} from '../lib/layout';

/**
 * Saves the workspace to the account, so it follows the trader to another
 * device.
 *
 * Debounced, because walking through layouts or timeframes would otherwise
 * write on every click. The debounce has to be flushed when the page goes away,
 * though: without that, changing the layout and immediately reloading loses it,
 * since each change cancels the previous timer and the last one never fires.
 * A failure is silent — a layout that did not save is not worth interrupting
 * anyone over.
 */
const PERSIST_DEBOUNCE_MS = 600;
let layoutTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLayout: TerminalLayout | null = null;

function sendLayout(layout: TerminalLayout): void {
  void api.patch('/me/layout', layout).catch(() => undefined);
}

function persistLayout(layout: TerminalLayout): void {
  if (!tokens.access) return;
  pendingLayout = layout;
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    layoutTimer = null;
    const next = pendingLayout;
    pendingLayout = null;
    if (next) sendLayout(next);
  }, PERSIST_DEBOUNCE_MS);
}

/** Sends whatever is still waiting, before the page is gone. */
export function flushLayout(): void {
  if (layoutTimer) {
    clearTimeout(layoutTimer);
    layoutTimer = null;
  }
  const next = pendingLayout;
  pendingLayout = null;
  if (!next || !tokens.access) return;
  // keepalive lets the request outlive the page it started on
  void fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/me/layout`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access}` },
    body: JSON.stringify(next),
    keepalive: true,
  }).catch(() => undefined);
}

if (typeof window !== 'undefined') {
  // pagehide covers reload, navigation and the mobile bfcache; visibilitychange
  // covers a tab being switched away from and never coming back
  window.addEventListener('pagehide', flushLayout);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLayout();
  });
}
import type { Asset } from '../lib/types';

interface MarketState {
  assets: Asset[];
  durations: number[];
  /** What expiry modes the platform offers, and the clock boundaries on offer. */
  expiry: ExpiryConfig;
  /** Stake presets, the ± step, and whether a position may be repeated. */
  ticket: TicketConfig;
  /** Whether sentiment is shown, and how much activity it needs. */
  sentimentConfig: { enabled: boolean; windowMin: number; minTrades: number };
  /** The practice account's rules, so the switcher can say what is on offer. */
  practice: PracticeConfig;
  /** Starred markets and the ones just visited, both per browser. */
  favourites: string[];
  recents: string[];
  setFavourites: (symbols: string[]) => void;
  /** Chart layout. The focused pane is what `symbol` and `timeframe` refer to. */
  layout: TerminalLayout;
  setLayoutKind: (kind: LayoutKind) => void;
  focusPane: (index: number) => void;
  setPaneSymbol: (index: number, symbol: string) => void;
  setPaneTimeframe: (index: number, timeframe: string) => void;
  adoptLayout: (stored: unknown) => void;
  /**
   * True once the trader has moved the workspace themselves in this session.
   * The stored layout arrives with the account, which can be well after the
   * terminal is usable, and it must never overwrite a market just chosen.
   */
  layoutTouched: boolean;
  /** Forgets that, so the next account adopts its own workspace. */
  forgetLayout: () => void;
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
  setSentiment: (book: Record<string, TraderSentiment>) => void;
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
  sentimentConfig: { enabled: true, windowMin: 15, minTrades: 5 },
  practice: { startBalance: 1_000_000, refillBelow: 0 },
  timeframes: ['5s', '10s', '15s', '30s', '1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '4h', '1d'],
  prices: {},
  favourites: loadFavourites(),
  recents: loadRecents(),
  layout: defaultLayout(localStorage.getItem(LAST_SYMBOL_KEY) ?? 'EURUSD', '1m'),
  layoutTouched: false,
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
      sentiment: { enabled: boolean; windowMin: number; minTrades: number };
      practice: PracticeConfig;
      timeframes: string[];
    }>('/market/assets');
    const symbol = data.assets.some((a) => a.symbol === get().symbol) ? get().symbol : data.assets[0]?.symbol;
    set({
      assets: data.assets,
      durations: data.durations,
      expiry: data.expiry,
      ticket: data.ticket,
      sentimentConfig: data.sentiment,
      practice: data.practice,
      timeframes: data.timeframes,
      prices: Object.fromEntries(data.assets.map((a) => [a.symbol, a.price ?? 0])),
      symbol: symbol ?? get().symbol,
      loaded: true,
    });
  },

  selectSymbol(symbol) {
    localStorage.setItem(LAST_SYMBOL_KEY, symbol);
    // visiting a market moves it to the front of the recent tabs, and changes
    // the pane the ticket is trading from — never a pane nobody is looking at
    const { layout } = get();
    set({
      symbol,
      recents: pushRecent(get().recents, symbol),
      layout: updatePane(layout, layout.focused, { symbol }),
      layoutTouched: true,
    });
    persistLayout(get().layout);
  },

  setFavourites(symbols) {
    set({ favourites: symbols });
  },

  setTimeframe(timeframe) {
    const { layout } = get();
    set({ timeframe, layout: updatePane(layout, layout.focused, { timeframe }), layoutTouched: true });
    persistLayout(get().layout);
  },

  setLayoutKind(kind) {
    const { layout, symbol, timeframe } = get();
    const panes = resize(layout.panes, kind, { symbol, timeframe });
    const focused = clampFocus(layout.focused, kind);
    const next = { kind, panes, focused };
    set({
      layout: next,
      symbol: panes[focused].symbol,
      timeframe: panes[focused].timeframe,
      layoutTouched: true,
    });
    persistLayout(next);
  },

  focusPane(index) {
    const { layout } = get();
    const focused = clampFocus(index, layout.kind);
    const pane = layout.panes[focused];
    if (!pane) return;
    const next = { ...layout, focused };
    set({ layout: next, symbol: pane.symbol, timeframe: pane.timeframe, layoutTouched: true });
    persistLayout(next);
  },

  setPaneSymbol(index, symbol) {
    const { layout } = get();
    const next = updatePane(layout, index, { symbol });
    set({
      layout: next,
      recents: pushRecent(get().recents, symbol),
      layoutTouched: true,
      ...(index === layout.focused ? { symbol } : {}),
    });
    persistLayout(next);
  },

  setPaneTimeframe(index, timeframe) {
    const { layout } = get();
    const next = updatePane(layout, index, { timeframe });
    set({ layout: next, layoutTouched: true, ...(index === layout.focused ? { timeframe } : {}) });
    persistLayout(next);
  },

  /**
   * Takes the layout stored on the account, whatever shape it is in.
   *
   * Ignored once the trader has moved the workspace in this session: the
   * account arrives after the terminal is already usable, and a market chosen
   * in between must not be thrown away by a layout saved yesterday.
   */
  adoptLayout(stored) {
    if (get().layoutTouched) return;
    const { symbol, timeframe } = get();
    const layout = parseLayout(stored, defaultLayout(symbol, timeframe));
    const pane = layout.panes[layout.focused];
    set({ layout, symbol: pane.symbol, timeframe: pane.timeframe });
  },

  forgetLayout() {
    set({ layoutTouched: false });
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
  /** Sentiment arrives for every active market at once; absent means unchanged. */
  setSentiment(book) {
    const assets = get().assets;
    if (assets.length === 0) return;
    set({
      assets: assets.map((asset) =>
        book[asset.symbol] ? { ...asset, sentiment: book[asset.symbol] } : asset,
      ),
    });
  },

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
