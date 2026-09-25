import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECENTS,
  filterAssets,
  loadFavourites,
  loadRecents,
  pushRecent,
  saveFavourites,
  sortAssets,
  tabsFor,
  toggleFavourite,
} from './watchlist';
import type { Asset } from './types';

function asset(over: Partial<Asset> & { symbol: string }): Asset {
  return {
    id: over.symbol,
    name: over.symbol,
    pair: over.symbol,
    assetClass: 'CURRENCY',
    isOtc: false,
    icon: null,
    base: 'X',
    quote: 'Y',
    pipSize: 0.0001,
    payoutPct: 80,
    minStake: 100,
    maxStake: 500000,
    precision: 5,
    price: 1,
    priceSource: 'broker',
    changePct: 0,
    isOpen: true,
    nextOpen: null,
    nextClose: null,
    holiday: null,
    schedule: null,
    otcAlternative: null,
    ...over,
  } as Asset;
}

const catalogue = [
  asset({ symbol: 'EURUSD', pair: 'EUR/USD', payoutPct: 85, changePct: 1.2 }),
  asset({ symbol: 'BTCUSDT', pair: 'BTC/USDT', assetClass: 'CRYPTO', payoutPct: 90, changePct: -2 }),
  asset({ symbol: 'XAUUSD', pair: 'XAU/USD', assetClass: 'COMMODITY', payoutPct: 78, changePct: 0.4 }),
  asset({ symbol: 'AAPL', pair: 'AAPL', assetClass: 'STOCK', payoutPct: 82, isOpen: false }),
];

describe('tabs', () => {
  it('offers only the classes the catalogue has', () => {
    expect(tabsFor(catalogue, [])).toEqual(['ALL', 'CURRENCY', 'CRYPTO', 'COMMODITY', 'STOCK']);
  });

  it('adds favourites only once there are some', () => {
    expect(tabsFor(catalogue, ['EURUSD'])).toContain('FAVOURITES');
    expect(tabsFor(catalogue, [])).not.toContain('FAVOURITES');
  });
});

describe('filtering', () => {
  const options = { query: '', tab: 'ALL' as const, favourites: [] as string[] };

  it('returns everything by default', () => {
    expect(filterAssets(catalogue, options)).toHaveLength(4);
  });

  it('narrows to one class', () => {
    expect(filterAssets(catalogue, { ...options, tab: 'CRYPTO' }).map((a) => a.symbol)).toEqual(['BTCUSDT']);
  });

  it('narrows to the starred ones', () => {
    const starred = filterAssets(catalogue, { ...options, tab: 'FAVOURITES', favourites: ['AAPL'] });
    expect(starred.map((a) => a.symbol)).toEqual(['AAPL']);
  });

  it('searches the symbol, the name and the display pair', () => {
    expect(filterAssets(catalogue, { ...options, query: 'btc' })).toHaveLength(1);
    expect(filterAssets(catalogue, { ...options, query: 'EUR/' })).toHaveLength(1);
    expect(filterAssets(catalogue, { ...options, query: '  aapl ' })).toHaveLength(1);
    expect(filterAssets(catalogue, { ...options, query: 'nothing' })).toHaveLength(0);
  });

  it('applies the tab and the search together', () => {
    expect(filterAssets(catalogue, { ...options, tab: 'CRYPTO', query: 'eur' })).toHaveLength(0);
  });

  it('narrows to a tournament\'s own market list when one is given', () => {
    const scoped = filterAssets(catalogue, { ...options, allowedAssetIds: ['EURUSD', 'AAPL'] });
    expect(scoped.map((a) => a.symbol)).toEqual(['EURUSD', 'AAPL']);
  });

  it('offers everything when the tournament allows every market', () => {
    expect(filterAssets(catalogue, { ...options, allowedAssetIds: null })).toHaveLength(4);
    expect(filterAssets(catalogue, { ...options, allowedAssetIds: undefined })).toHaveLength(4);
  });

  it('combines a tournament\'s market list with the tab and the search', () => {
    const narrowed = filterAssets(catalogue, {
      ...options,
      tab: 'CRYPTO',
      allowedAssetIds: ['EURUSD', 'BTCUSDT'],
    });
    expect(narrowed.map((a) => a.symbol)).toEqual(['BTCUSDT']);
  });
});

describe('sorting', () => {
  it('never puts a closed market above an open one', () => {
    for (const key of ['payout', 'name', 'change', 'default'] as const) {
      const sorted = sortAssets(catalogue, key);
      const closedAt = sorted.findIndex((a) => !a.isOpen);
      const openAfter = sorted.slice(closedAt + 1).some((a) => a.isOpen);
      expect(openAfter, key).toBe(false);
    }
  });

  it('orders by payout, then by name for a tie', () => {
    const sorted = sortAssets(catalogue, 'payout').map((a) => a.symbol);
    expect(sorted.slice(0, 3)).toEqual(['BTCUSDT', 'EURUSD', 'XAUUSD']);
  });

  it('orders by name and by change', () => {
    expect(
      sortAssets(catalogue, 'name')
        .map((a) => a.pair)
        .slice(0, 3),
    ).toEqual(['BTC/USDT', 'EUR/USD', 'XAU/USD']);
    expect(sortAssets(catalogue, 'change')[0].symbol).toBe('EURUSD');
  });

  it('keeps a favourite ahead of the rest of its group', () => {
    const sorted = sortAssets(catalogue, 'name', ['XAUUSD']);
    expect(sorted[0].symbol).toBe('XAUUSD');
  });

  it('does not touch the array it was given', () => {
    const original = [...catalogue];
    sortAssets(catalogue, 'payout');
    expect(catalogue).toEqual(original);
  });
});

describe('favourites and recents', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and round-trips', () => {
    expect(loadFavourites()).toEqual([]);
    saveFavourites(['EURUSD']);
    expect(loadFavourites()).toEqual(['EURUSD']);
  });

  it('toggles one on and off', () => {
    const on = toggleFavourite([], 'EURUSD');
    expect(on).toEqual(['EURUSD']);
    expect(loadFavourites()).toEqual(['EURUSD']);
    expect(toggleFavourite(on, 'EURUSD')).toEqual([]);
    expect(loadFavourites()).toEqual([]);
  });

  it('promotes a revisited market rather than duplicating it', () => {
    let recents = pushRecent([], 'A');
    recents = pushRecent(recents, 'B');
    recents = pushRecent(recents, 'A');
    expect(recents).toEqual(['A', 'B']);
  });

  it('caps the recents so the tab strip stays a shortcut', () => {
    let recents: string[] = [];
    for (let index = 0; index < MAX_RECENTS + 4; index += 1) recents = pushRecent(recents, `S${index}`);
    expect(recents).toHaveLength(MAX_RECENTS);
    expect(recents[0]).toBe(`S${MAX_RECENTS + 3}`);
    expect(loadRecents()).toHaveLength(MAX_RECENTS);
  });

  it('survives storage holding something that is not a list of symbols', () => {
    localStorage.setItem('qx.favourites', '{"not":"a list"}');
    expect(loadFavourites()).toEqual([]);
    localStorage.setItem('qx.recents', '[1, null, "OK"]');
    expect(loadRecents()).toEqual(['OK']);
    localStorage.setItem('qx.favourites', 'not json at all');
    expect(loadFavourites()).toEqual([]);
  });
});
