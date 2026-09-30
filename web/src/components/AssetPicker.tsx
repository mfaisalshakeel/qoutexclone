import { useMemo, useState } from 'react';
import { useMarket } from '../store/market';
import { useTradingAccount } from '../store/tradingAccount';
import { percent, price, untilShort } from '../lib/format';
import {
  CLASS_LABELS,
  SORT_LABELS,
  filterAssets,
  sortAssets,
  tabsFor,
  toggleFavourite,
  type PickerTab,
  type SortKey,
} from '../lib/watchlist';
import { RowSkeletons } from './Skeleton';

interface Props {
  onPicked?: () => void;
}

const SORTS: SortKey[] = ['default', 'payout', 'name', 'change'];

const TAB_LABEL = (tab: PickerTab) =>
  tab === 'ALL' ? 'All' : tab === 'FAVOURITES' ? '★' : CLASS_LABELS[tab];

/**
 * The market list: tabs by class, starred markets, search and sorting, with a
 * live quote, the payout and the session state on every row.
 */
export function AssetPicker({ onPicked }: Props) {
  const { assets, prices, symbol, selectSymbol, loaded } = useMarket();
  const favourites = useMarket((s) => s.favourites);
  const setFavourites = useMarket((s) => s.setFavourites);
  const tournamentId = useTradingAccount((s) => s.tournamentId);
  const allowedAssetIds = useTradingAccount((s) => s.allowedAssetIds);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<PickerTab>('ALL');
  const [sort, setSort] = useState<SortKey>('default');

  // trading with tournament chips only offers that tournament's own markets
  const scope = tournamentId ? allowedAssetIds : null;
  const inScope = useMemo(
    () => (scope ? assets.filter((asset) => scope.includes(asset.id)) : assets),
    [assets, scope],
  );

  const tabs = useMemo(() => tabsFor(inScope, favourites), [inScope, favourites]);
  const shown = useMemo(
    () =>
      sortAssets(filterAssets(assets, { query, tab, favourites, allowedAssetIds: scope }), sort, favourites),
    [assets, query, tab, favourites, sort, scope],
  );

  // a tab can disappear — the last favourite was removed — so never strand it
  const activeTab = tabs.includes(tab) ? tab : 'ALL';

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-2.5 pb-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search markets"
          aria-label="Search markets"
          className="field !py-2 !text-xs"
        />

        <div role="tablist" aria-label="Market classes" className="-mx-0.5 flex gap-1 overflow-x-auto px-0.5">
          {tabs.map((each) => (
            <button
              key={each}
              role="tab"
              aria-selected={activeTab === each}
              aria-label={each === 'FAVOURITES' ? 'Favourites' : undefined}
              onClick={() => setTab(each)}
              className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                activeTab === each ? 'bg-selected text-selected-fg' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {TAB_LABEL(each)}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort markets"
            className="flex-1 rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-slate-200"
          >
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {shown.map((asset) => {
          const live = prices[asset.symbol] ?? asset.price ?? 0;
          const active = asset.symbol === symbol;
          const starred = favourites.includes(asset.symbol);
          return (
            <div
              key={asset.symbol}
              className={`mb-1 flex items-start gap-1 rounded-lg transition ${
                active ? 'bg-accent-soft ring-1 ring-accent/40' : 'hover:bg-ink-700'
              }`}
            >
              <button
                onClick={() => {
                  selectSymbol(asset.symbol);
                  onPicked?.();
                }}
                // the visible label strips "(OTC)" and shows a chip instead, so
                // the accessible name carries the full pair — a spot market and
                // its OTC twin read identically otherwise
                aria-label={asset.pair}
                title={asset.name}
                className="min-w-0 flex-1 px-2.5 py-2 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-600 text-[9px] font-bold text-slate-300">
                    {asset.icon ?? asset.base}
                  </span>
                  {/* The pair is the row's identity, so it is the one thing that
                      never truncates: at rail width the chips give way first, and
                      a rail full of "EU…" and "GB…" tells a trader nothing. */}
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-100">
                    {asset.pair.replace(' (OTC)', '')}
                  </span>
                  {asset.isOtc && (
                    <span className="chip shrink-0 bg-accent-soft !px-1.5 text-accent">OTC</span>
                  )}
                  <span
                    className={`chip ml-auto shrink-0 !px-1.5 ${asset.isOpen ? 'bg-up-soft text-up' : 'bg-ink-600 text-slate-500'}`}
                  >
                    {asset.payoutPct}%
                  </span>
                </span>
                {/* The long name used to sit here and was clipped to a few
                    characters at rail width; it lives on the button's title
                    instead, and the line carries what changes: price and move. */}
                <span className="mt-1 flex items-baseline gap-2 pl-9">
                  <span className="tabular shrink-0 text-xs font-semibold text-slate-100">
                    {price(live, asset.precision)}
                  </span>
                  {asset.isOpen ? (
                    <span
                      className={`tabular ml-auto shrink-0 text-[10px] ${asset.changePct >= 0 ? 'text-up' : 'text-down'}`}
                    >
                      {percent(asset.changePct)}
                    </span>
                  ) : (
                    // a closed market's last price still matters; what it needs
                    // instead of a stale move is when it trades again. This is
                    // also the only "closed" marker on the row now — a chip on
                    // the line above said the same thing in less space.
                    <span className="ml-auto min-w-0 truncate text-[10px] text-slate-500">
                      {asset.nextOpen ? untilShort(asset.nextOpen) : 'closed'}
                    </span>
                  )}
                </span>
              </button>

              <button
                onClick={() => setFavourites(toggleFavourite(favourites, asset.symbol))}
                aria-pressed={starred}
                aria-label={`${starred ? 'Unstar' : 'Star'} ${asset.pair}`}
                className={`shrink-0 px-1.5 py-2 text-sm leading-none transition ${
                  starred ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {starred ? '★' : '☆'}
              </button>
            </div>
          );
        })}

        {!loaded && <RowSkeletons rows={8} avatar rowClassName="px-2.5 py-2.5" />}
        {loaded && shown.length === 0 && (
          <p className="p-4 text-center text-xs text-slate-500">
            {activeTab === 'FAVOURITES' && !query
              ? 'No starred markets yet. Tap a star to keep one here.'
              : `No markets match “${query}”.`}
          </p>
        )}
      </div>
    </div>
  );
}
