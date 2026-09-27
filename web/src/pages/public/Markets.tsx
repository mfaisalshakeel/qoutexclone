import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { percent, price, untilShort } from '../../lib/format';
import {
  CLASS_LABELS,
  SORT_LABELS,
  filterAssets,
  sortAssets,
  tabsFor,
  type PickerTab,
  type SortKey,
} from '../../lib/watchlist';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';
import { RowSkeletons } from '../../components/Skeleton';
import type { Asset } from '../../lib/types';

const SORTS: SortKey[] = ['default', 'payout', 'name', 'change'];
const TAB_LABEL = (tab: PickerTab) =>
  tab === 'ALL' ? 'All' : tab === 'FAVOURITES' ? '★' : CLASS_LABELS[tab];

/** Every market on the platform, with its live payout — the same catalogue the terminal trades, open to anyone. */
export function PublicMarkets() {
  const { t } = useTranslation();
  usePageMeta({
    title: t('markets.title'),
    description: t('markets.description'),
  });

  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<PickerTab>('ALL');
  const [sort, setSort] = useState<SortKey>('default');

  useEffect(() => {
    api
      .get<{ assets: Asset[] }>('/market/assets')
      .then(({ assets: list }) => setAssets(list))
      .catch(() => setAssets([]));
  }, []);

  const tabs = useMemo(() => tabsFor(assets ?? [], []), [assets]);
  const activeTab = tabs.includes(tab) ? tab : 'ALL';
  const shown = useMemo(
    () => sortAssets(filterAssets(assets ?? [], { query, tab: activeTab, favourites: [] }), sort),
    [assets, query, activeTab, sort],
  );

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('markets.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">{t('markets.description')}</p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('markets.searchPlaceholder')}
            aria-label={t('markets.searchPlaceholder')}
            className="field sm:max-w-xs"
          />
          <div role="tablist" aria-label="Market classes" className="flex flex-wrap gap-1">
            {tabs.map((each) => (
              <button
                key={each}
                role="tab"
                aria-selected={activeTab === each}
                onClick={() => setTab(each)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  activeTab === each ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {TAB_LABEL(each)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500 sm:ms-auto">
            {t('markets.sort')}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label={t('markets.sort')}
              className="field !w-auto !py-1.5 text-xs"
            >
              {SORTS.map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="card mt-5 divide-y divide-ink-700 overflow-hidden">
          {assets === null && <RowSkeletons rows={10} avatar rowClassName="p-4" />}
          {assets !== null && shown.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-500">{t('markets.noMatch', { query })}</p>
          )}
          {shown.map((asset) => (
            <div
              key={asset.symbol}
              className={`flex items-center gap-3 p-4 ${asset.isOpen ? '' : 'opacity-60'}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-600 text-[10px] font-bold text-slate-300">
                {asset.icon ?? asset.base}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{asset.pair.replace(' (OTC)', '')}</span>
                  {asset.isOtc && <span className="chip bg-accent-soft text-accent">OTC</span>}
                  {!asset.isOpen && (
                    <span className="chip bg-ink-600 text-slate-400">{t('markets.closed')}</span>
                  )}
                </span>
                <span className="block text-xs text-slate-500">
                  {asset.isOpen
                    ? asset.name.replace(' (OTC)', '')
                    : asset.nextOpen
                      ? t('markets.opensIn', { time: untilShort(asset.nextOpen) })
                      : t('markets.closed')}
                </span>
              </span>
              <span className="text-end">
                <span className="tabular block text-sm font-semibold">
                  {price(asset.price, asset.precision)}
                </span>
                <span
                  className={`tabular block text-[11px] ${asset.changePct >= 0 ? 'text-up' : 'text-down'}`}
                >
                  {percent(asset.changePct)}
                </span>
              </span>
              <span
                className={`chip shrink-0 ${asset.isOpen ? 'bg-up-soft text-up' : 'bg-ink-600 text-slate-500'}`}
              >
                {asset.payoutPct}%
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            {t('markets.tradeTheseMarkets')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
