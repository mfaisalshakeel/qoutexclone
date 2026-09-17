import { useEffect, useState } from 'react';
import { useMarket } from '../store/market';
import { countdown, dateTime, money, price } from '../lib/format';
import type { PendingOrder, Trade } from '../lib/types';
import { Skeleton, SkeletonGroup } from './Skeleton';

interface Props {
  open: Trade[];
  closed: Trade[];
  /** Orders waiting on a price or a time; they are not positions yet. */
  pending: PendingOrder[];
  onCancel: (orderId: string) => void | Promise<void>;
  /** Re-opens a position at the current price, optionally at twice the stake. */
  onRepeat: (tradeId: string, multiplier: 1 | 2) => void | Promise<void>;
  loading?: boolean;
}

/** Open positions with a live countdown, plus the most recent settled ones. */
export function Positions({ open, closed, pending, onCancel, onRepeat, loading = false }: Props) {
  const prices = useMarket((s) => s.prices);
  const assets = useMarket((s) => s.assets);
  const [tab, setTab] = useState<'open' | 'pending' | 'closed'>('open');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [repeating, setRepeating] = useState<string | null>(null);
  const allowRepeat = useMarket((s) => s.ticket.allowRepeat);
  const [, force] = useState(0);

  // one timer drives every countdown on screen
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const precisionOf = (symbol: string) => assets.find((a) => a.symbol === symbol)?.precision ?? 2;
  const waiting = pending.filter((order) => order.status === 'PENDING');
  const settledOrders = pending.filter((order) => order.status !== 'PENDING').slice(0, 10);

  const repeat = async (tradeId: string, multiplier: 1 | 2) => {
    setRepeating(tradeId);
    try {
      await onRepeat(tradeId, multiplier);
    } finally {
      setRepeating(null);
    }
  };

  const cancel = async (orderId: string) => {
    setCancelling(orderId);
    try {
      await onCancel(orderId);
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="card flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Positions"
        className="flex shrink-0 gap-1 border-b border-ink-600 p-1.5"
      >
        {(['open', 'pending', 'closed'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            role="tab"
            aria-selected={tab === key}
            className={`min-w-0 flex-1 truncate rounded-lg py-1.5 text-xs font-semibold capitalize transition ${
              tab === key ? 'bg-ink-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {key === 'open'
              ? loading
                ? 'Open'
                : `Open (${open.length})`
              : key === 'pending'
                ? // orders waiting are listed apart from positions, because
                  // they are not risking anything yet
                  `Pending${waiting.length ? ` (${waiting.length})` : ''}`
                : 'Closed'}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-1.5">
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

                  {/* the same trade again, at the price and payout of now — it
                      is a new position, not a copy of this one */}
                  {allowRepeat && (
                    <div className="mt-1.5 flex gap-1">
                      <button
                        onClick={() => void repeat(trade.id, 1)}
                        disabled={repeating === trade.id}
                        className="flex-1 rounded-md bg-ink-700 py-1 text-[10px] font-semibold text-slate-300 hover:bg-ink-600 disabled:opacity-50"
                      >
                        {repeating === trade.id ? 'Placing…' : 'Repeat'}
                      </button>
                      <button
                        onClick={() => void repeat(trade.id, 2)}
                        disabled={repeating === trade.id}
                        title={`Open the same trade at ${money(trade.stake * 2)}`}
                        className="flex-1 rounded-md bg-ink-700 py-1 text-[10px] font-semibold text-slate-300 hover:bg-ink-600 disabled:opacity-50"
                      >
                        Double up
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          ))}

        {!loading &&
          tab === 'pending' &&
          (waiting.length === 0 && settledOrders.length === 0 ? (
            <Empty text="No pending orders" />
          ) : (
            <>
              {waiting.map((order) => (
                <div key={order.id} className="mb-1.5 rounded-lg bg-ink-800/60 p-2 last:mb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                        <span
                          className={`rounded px-1 py-0.5 text-[10px] ${
                            order.direction === 'UP' ? 'bg-up/20 text-up' : 'bg-down/20 text-down'
                          }`}
                        >
                          {order.direction === 'UP' ? '▲' : '▼'}
                        </span>
                        <span className="truncate">{order.symbol}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {describeOrder(order, precisionOf(order.symbol))}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        Expires from purchase ·{' '}
                        {order.expiryMode === 'CLOCK' && order.expiresAt
                          ? dateTime(order.expiresAt)
                          : `${order.durationSec}s`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular text-xs text-slate-300">{money(order.stake)}</span>
                      <button
                        onClick={() => void cancel(order.id)}
                        disabled={cancelling === order.id}
                        className="rounded-md bg-ink-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-ink-600 disabled:opacity-50"
                      >
                        {cancelling === order.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {settledOrders.map((order) => (
                <div key={order.id} className="mb-1.5 rounded-lg bg-ink-800/30 p-2 last:mb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-400">{order.symbol}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {describeOrder(order, precisionOf(order.symbol))}
                      </p>
                      {/* a failed order says why, rather than just disappearing */}
                      {order.failureReason && (
                        <p className="mt-0.5 text-[10px] text-down">{order.failureReason}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {order.status === 'TRIGGERED' ? 'Filled' : order.status.toLowerCase()}
                    </span>
                  </div>
                </div>
              ))}
            </>
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

/** The condition an order is waiting on, as a trader would read it. */
function describeOrder(order: PendingOrder, precision: number): string {
  if (order.trigger === 'TIME') {
    return order.triggerAt ? `Opens at ${dateTime(order.triggerAt)}` : 'Opens at a set time';
  }
  if (order.triggerPrice == null) return 'Opens at a price';
  const side = order.triggerSide === 'BELOW' ? 'at or below' : 'at or above';
  return `Opens ${side} ${price(order.triggerPrice, precision)}`;
}
