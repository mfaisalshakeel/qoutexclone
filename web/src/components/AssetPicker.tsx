import { useMemo, useState } from 'react';
import { useMarket } from '../store/market';
import { percent, price } from '../lib/format';
import { RowSkeletons } from './Skeleton';

interface Props {
  onPicked?: () => void;
}

/** Searchable market list with live quotes — the left rail on desktop. */
export function AssetPicker({ onPicked }: Props) {
  const { assets, prices, symbol, selectSymbol, loaded } = useMarket();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [assets, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets"
          className="field !py-2 !text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {filtered.map((asset) => {
          const live = prices[asset.symbol] ?? asset.price ?? 0;
          const active = asset.symbol === symbol;
          return (
            <button
              key={asset.symbol}
              onClick={() => {
                selectSymbol(asset.symbol);
                onPicked?.();
              }}
              className={`mb-1 block w-full rounded-lg px-2.5 py-2 text-left transition ${
                active ? 'bg-accent-soft ring-1 ring-accent/40' : 'hover:bg-ink-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-600 text-[9px] font-bold text-slate-300">
                  {asset.base}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{asset.name}</span>
                <span className="chip shrink-0 bg-up-soft text-up">{asset.payoutPct}%</span>
              </span>
              <span className="mt-1 flex items-baseline gap-2 pl-9">
                <span className="flex-1 text-[10px] text-slate-500">{asset.symbol}</span>
                <span className="tabular text-xs font-semibold text-slate-100">{price(live, asset.precision)}</span>
                <span className={`tabular text-[10px] ${asset.changePct >= 0 ? 'text-up' : 'text-down'}`}>
                  {percent(asset.changePct)}
                </span>
              </span>
            </button>
          );
        })}
        {!loaded && <RowSkeletons rows={8} avatar rowClassName="px-2.5 py-2.5" />}
        {loaded && filtered.length === 0 && <p className="p-4 text-center text-xs text-slate-500">No markets match “{query}”.</p>}
      </div>
    </div>
  );
}
