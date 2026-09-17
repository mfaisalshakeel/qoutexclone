import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, duration, money, price } from '../lib/format';
import { useAuth } from '../store/auth';
import { useMarket } from '../store/market';
import type { AccountType, Trade, TradingStats, Transaction } from '../lib/types';
import { RowSkeletons, StatSkeletons } from '../components/Skeleton';

export function History() {
  const user = useAuth((s) => s.user);
  const assets = useMarket((s) => s.assets);
  const [accountType, setAccountType] = useState<AccountType>(user?.activeAccount ?? 'DEMO');
  const [view, setView] = useState<'trades' | 'ledger'>('trades');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<TradingStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, s, tx] = await Promise.all([
      api.get<{ trades: Trade[] }>(`/trades?status=CLOSED&accountType=${accountType}&limit=100`),
      api.get<{ stats: TradingStats }>(`/me/stats?accountType=${accountType}`),
      api.get<{ transactions: Transaction[] }>(`/wallet/transactions?accountType=${accountType}&limit=100`),
    ]);
    setTrades(t.trades);
    setStats(s.stats);
    setTransactions(tx.transactions);
    setLoading(false);
  }, [accountType]);

  useEffect(() => {
    void load();
  }, [load]);

  const precisionOf = (symbol: string) => assets.find((a) => a.symbol === symbol)?.precision ?? 2;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Trading history</h1>
        <div className="flex gap-1 rounded-lg border border-ink-600 bg-ink-800 p-1">
          {(['DEMO', 'REAL'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setAccountType(type)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                accountType === type ? 'bg-ink-600 text-white' : 'text-slate-400'
              }`}
            >
              {type === 'DEMO' ? 'Practice' : 'Live'}
            </button>
          ))}
        </div>
      </div>

      {loading && <StatSkeletons count={4} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" />}
      {!loading && stats && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Trades" value={String(stats.total)} />
          <Stat label="Win rate" value={`${stats.winRate}%`} tone={stats.winRate >= 50 ? 'up' : 'down'} />
          <Stat
            label="Net P&L"
            value={money(stats.netProfit, { sign: true })}
            tone={stats.netProfit >= 0 ? 'up' : 'down'}
          />
          <Stat label="Volume" value={money(stats.volume)} />
        </div>
      )}

      <div className="mb-3 flex gap-1 rounded-xl border border-ink-600 bg-ink-800 p-1">
        {(['trades', 'ledger'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition ${
              view === key ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {key === 'trades' ? 'Closed trades' : 'Account ledger'}
          </button>
        ))}
      </div>

      {loading ? (
        <RowSkeletons rows={7} className="card divide-y divide-ink-700" />
      ) : view === 'trades' ? (
        trades.length === 0 ? (
          <p className="card p-10 text-center text-sm text-slate-500">
            No closed trades on this account yet.
          </p>
        ) : (
          <>
            {/* table on desktop, cards on mobile */}
            <div className="card hidden overflow-hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-ink-700/60 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <Th>Market</Th>
                    <Th>Direction</Th>
                    <Th>Stake</Th>
                    <Th>Entry → Exit</Th>
                    <Th>Expiry</Th>
                    <Th className="text-right">Result</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700">
                  {trades.map((trade) => (
                    <tr key={trade.id}>
                      <Td>
                        <span className="font-semibold">{trade.symbol}</span>
                        <span className="block text-[11px] text-slate-500">
                          {trade.settledAt ? dateTime(trade.settledAt) : '—'}
                        </span>
                      </Td>
                      <Td>
                        <span className={trade.direction === 'UP' ? 'text-up' : 'text-down'}>
                          {trade.direction === 'UP' ? '▲ Higher' : '▼ Lower'}
                        </span>
                      </Td>
                      <Td className="tabular">{money(trade.stake)}</Td>
                      <Td className="tabular text-xs text-slate-400">
                        {price(trade.entryPrice, precisionOf(trade.symbol))} →{' '}
                        {price(trade.exitPrice, precisionOf(trade.symbol))}
                      </Td>
                      <Td className="text-xs text-slate-400">{duration(trade.durationSec)}</Td>
                      <Td className="text-right">
                        <span
                          className={`tabular font-bold ${
                            trade.status === 'WON'
                              ? 'text-up'
                              : trade.status === 'LOST'
                                ? 'text-down'
                                : 'text-slate-300'
                          }`}
                        >
                          {trade.status === 'REFUNDED' ? 'Refunded' : money(trade.profit, { sign: true })}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-2 sm:hidden">
              {trades.map((trade) => (
                <li key={trade.id} className="card flex items-center gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      <span className={trade.direction === 'UP' ? 'text-up' : 'text-down'}>
                        {trade.direction === 'UP' ? '▲' : '▼'}
                      </span>{' '}
                      {trade.symbol}
                    </span>
                    <span className="tabular block text-[11px] text-slate-500">
                      {money(trade.stake)} · {duration(trade.durationSec)} ·{' '}
                      {trade.settledAt ? dateTime(trade.settledAt) : '—'}
                    </span>
                  </span>
                  <span
                    className={`tabular text-sm font-bold ${
                      trade.status === 'WON'
                        ? 'text-up'
                        : trade.status === 'LOST'
                          ? 'text-down'
                          : 'text-slate-300'
                    }`}
                  >
                    {trade.status === 'REFUNDED' ? 'Refund' : money(trade.profit, { sign: true })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )
      ) : transactions.length === 0 ? (
        <p className="card p-10 text-center text-sm text-slate-500">No ledger entries yet.</p>
      ) : (
        <ul className="card divide-y divide-ink-700">
          {transactions.map((tx) => (
            <li key={tx.id} className="flex items-center gap-3 p-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold capitalize">
                  {tx.type.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="block truncate text-[11px] text-slate-500">{tx.note ?? '—'}</span>
                <span className="block text-[11px] text-slate-500">{dateTime(tx.createdAt)}</span>
              </span>
              <span className="text-right">
                <span
                  className={`tabular block text-sm font-bold ${tx.amount >= 0 ? 'text-up' : 'text-down'}`}
                >
                  {money(tx.amount, { sign: true })}
                </span>
                <span className="tabular block text-[11px] text-slate-500">bal {money(tx.balanceAfter)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`tabular text-base font-bold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

const Th = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <th className={`px-4 py-2.5 text-left font-medium ${className}`}>{children}</th>
);
const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-4 py-3 ${className}`}>{children}</td>
);
