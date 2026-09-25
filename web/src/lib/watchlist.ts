import type { Asset } from './types';

/**
 * Which markets a trader keeps close: the ones they starred, and the ones they
 * were just looking at.
 *
 * Both live in the browser. They are a per-device convenience, not account
 * data — someone watching gold on a laptop and crypto on a phone wants exactly
 * that, and neither is worth a round trip.
 */

const FAVOURITES_KEY = 'qx.favourites';
const RECENTS_KEY = 'qx.recents';

/** More than this and the tab strip stops being a shortcut. */
export const MAX_RECENTS = 6;

export type AssetClass = 'CURRENCY' | 'CRYPTO' | 'COMMODITY' | 'STOCK' | 'INDEX';
export type PickerTab = 'ALL' | 'FAVOURITES' | AssetClass;
export type SortKey = 'default' | 'payout' | 'name' | 'change';

export const CLASS_LABELS: Record<AssetClass, string> = {
  CURRENCY: 'Forex',
  CRYPTO: 'Crypto',
  COMMODITY: 'Commodities',
  STOCK: 'Stocks',
  INDEX: 'Indices',
};

export const SORT_LABELS: Record<SortKey, string> = {
  default: 'Default',
  payout: 'Payout',
  name: 'Name',
  change: 'Change',
};

/** Reads a stored list of symbols, tolerating anything that is not one. */
function readSymbols(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

function writeSymbols(key: string, symbols: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(symbols));
  } catch {
    /* storage blocked: the list lasts for this session only */
  }
}

export function loadFavourites(): string[] {
  return readSymbols(FAVOURITES_KEY);
}

export function saveFavourites(symbols: string[]): void {
  writeSymbols(FAVOURITES_KEY, symbols);
}

/** Adds or removes one, returning the new list. */
export function toggleFavourite(favourites: string[], symbol: string): string[] {
  const next = favourites.includes(symbol)
    ? favourites.filter((each) => each !== symbol)
    : [...favourites, symbol];
  saveFavourites(next);
  return next;
}

export function loadRecents(): string[] {
  return readSymbols(RECENTS_KEY).slice(0, MAX_RECENTS);
}

/**
 * Moves a market to the front of the recents, keeping the list unique and
 * capped. Re-visiting a market promotes it rather than duplicating it.
 */
export function pushRecent(recents: string[], symbol: string): string[] {
  const next = [symbol, ...recents.filter((each) => each !== symbol)].slice(0, MAX_RECENTS);
  writeSymbols(RECENTS_KEY, next);
  return next;
}

/** The tabs worth showing: only classes the catalogue actually has. */
export function tabsFor(assets: Asset[], favourites: string[]): PickerTab[] {
  const classes = new Set(assets.map((asset) => asset.assetClass as AssetClass));
  const ordered: AssetClass[] = ['CURRENCY', 'CRYPTO', 'COMMODITY', 'STOCK', 'INDEX'];
  return [
    'ALL' as const,
    ...(favourites.length > 0 ? (['FAVOURITES'] as const) : []),
    ...ordered.filter((each) => classes.has(each)),
  ];
}

export interface FilterOptions {
  query: string;
  tab: PickerTab;
  favourites: string[];
  /** Trading with tournament chips against a scoped tournament: only these
   *  symbols are offered. Undefined or null means every market, as usual. */
  allowedAssetIds?: string[] | null;
}

/** Narrows the catalogue to what the tab, the search box and an active tournament's own market list ask for. */
export function filterAssets(assets: Asset[], options: FilterOptions): Asset[] {
  const query = options.query.trim().toLowerCase();
  return assets.filter((asset) => {
    if (options.allowedAssetIds && !options.allowedAssetIds.includes(asset.id)) return false;
    if (options.tab === 'FAVOURITES' && !options.favourites.includes(asset.symbol)) return false;
    if (options.tab !== 'ALL' && options.tab !== 'FAVOURITES' && asset.assetClass !== options.tab) {
      return false;
    }
    if (!query) return true;
    return (
      asset.symbol.toLowerCase().includes(query) ||
      asset.name.toLowerCase().includes(query) ||
      asset.pair.toLowerCase().includes(query)
    );
  });
}

/**
 * Sorts a copy, never the array it was given.
 *
 * An open market always outranks a closed one whatever the sort: a list headed
 * by markets nobody can trade is a worse list, however it is ordered.
 */
export function sortAssets(assets: Asset[], key: SortKey, favourites: string[] = []): Asset[] {
  const rank = (asset: Asset) => (asset.isOpen ? 0 : 1);
  const starred = (asset: Asset) => (favourites.includes(asset.symbol) ? 0 : 1);

  return [...assets].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    // starred markets lead within each group, so a favourite is never buried
    if (starred(a) !== starred(b)) return starred(a) - starred(b);
    switch (key) {
      case 'payout':
        return b.payoutPct - a.payoutPct || a.pair.localeCompare(b.pair);
      case 'name':
        return a.pair.localeCompare(b.pair);
      case 'change':
        return (b.changePct ?? 0) - (a.changePct ?? 0) || a.pair.localeCompare(b.pair);
      default:
        return 0;
    }
  });
}
