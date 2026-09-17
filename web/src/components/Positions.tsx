import { useEffect, useState } from 'react';
import { useMarket } from '../store/market';
import { countdown, dateTime, money, price } from '../lib/format';
import type { Trade } from '../lib/types';
import { Skeleton, SkeletonGroup } from './Skeleton';

interface Props {
  open: Trade[];
  closed: Trade[];
  loading?: boolean;
}

/** Open positions with a live countdown, plus the most recent settled ones. */
export function Positions({ open, closed, loading = false }: Props) {
  const prices = useMarket((s) => s.prices);
  const assets = useMarket((s) => s.assets);
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [, force] = useState(0);

  // one timer drives every countdown on screen
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const precisionOf = (symbol: string) => assets.find((a) => a.symbol === symbol)?.precision ?? 2;

  return (
    <div className="card flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-ink-600 p-1.5">
        {(['open', 'closed'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold capitalize transition ${
              tab === key ? 'bg-ink-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {key === 'open' ? (loading ? 'Open' : `Open (${open.length})`) : 'Closed'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && <PositionSkeletons />}

        {!loading &&
          tab === 'open' &&
          (open.length === 0 ? (
            <Empty text="No open positions" />
          ) : (
            open.map((trade) => {
              const live = prices[trade.symbol] ?? trade.entryPrice;
              const winning = trade.direction === 'UP' ? live > trade.entryPrice : live < trade.entryPrice;
              const flat = live === trade.entryPrice;
              return (
                <div key={trade.id} className="mb-1.5 rounded-lg bg-ink-700/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <span className={trade.direction === 'UP' ? 'text-up' : 'text-down'}>
                        {trade.direction === 'UP' ? '▲' : '▼'}
                      </span>
                      {trade.symbol}
                    </span>
                    <span className="tabular rounded-md bg-ink-800 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">
                      {countdown(trade.expiresAt)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-end justify-between text-[11px] text-slate-400">
                    <span className="tabular">
                      {price(trade.entryPrice, precisionOf(trade.symbol))} →{' '}
                      <span className={flat ? 'text-slate-300' : winning ? 'text-up' : 'text-down'}>
                        {price(live, precisionOf(trade.symbol))}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="tabular block text-slate-300">{money(trade.stake)}</span>
                      <span
                        className={`tabular block font-semibold ${flat ? 'text-slate-400' : winning ? 'text-up' : 'text-down'}`}
                      >
                        {flat
                          ? 'at entry'
                          : winning
                            ? `+${money(trade.potentialProfit, { currency: true })}`
                            : `−${money(trade.stake)}`}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })
          ))}

        {!loading &&
          tab === 'closed' &&
          (closed.length === 0 ? (
            <Empty text="No closed trades yet" />
          ) : (
            closed.map((trade) => (
              <div
                key={trade.id}
                className="mb-1.5 flex items-center justify-between rounded-lg bg-ink-700/40 p-2.5"
              >
                <span>
                  <span className="block text-xs font-semibold">
                    <span className={trade.direction === 'UP' ? 'text-up' : 'text-down'}>
                      {trade.direction === 'UP' ? '▲' : '▼'}
                    </span>{' '}
                    {trade.symbol}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {trade.settledAt ? dateTime(trade.settledAt) : '—'}
                  </span>
                </span>
                <span className="text-right">
                  <span
                    className={`tabular block text-xs font-bold ${
                      trade.status === 'WON'
                        ? 'text-up'
                        : trade.status === 'LOST'
                          ? 'text-down'
                          : 'text-slate-300'
                    }`}
                  >
                    {trade.status === 'WON'
                      ? `+${money(trade.profit)}`
                      : trade.status === 'LOST'
                        ? money(trade.profit)
                        : 'refund'}
                  </span>
                  <span className="tabular block text-[10px] text-slate-500">
                    {price(trade.entryPrice, precisionOf(trade.symbol))} →{' '}
                    {price(trade.exitPrice, precisionOf(trade.symbol))}
                  </span>
                </span>
              </div>
            ))
          ))}
      </div>
    </div>
  );
}

function PositionSkeletons() {
  return (
    <SkeletonGroup label="Loading positions">
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-1.5 space-y-2.5 rounded-lg bg-ink-700/40 p-2.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20 bg-ink-600" />
            <Skeleton className="h-4 w-10 bg-ink-600" />
          </div>
          <div className="flex items-end justify-between">
            <Skeleton className="h-2.5 w-28 bg-ink-600" />
            <Skeleton className="h-2.5 w-12 bg-ink-600" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-xs text-slate-500">{text}</p>;
}
