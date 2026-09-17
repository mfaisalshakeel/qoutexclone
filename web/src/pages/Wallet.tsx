import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { dateTime, money, shortHash } from '../lib/format';
import { realtime } from '../lib/ws';
import { useAuth } from '../store/auth';
import { DepositPanel } from '../components/DepositPanel';
import { WithdrawPanel } from '../components/WithdrawPanel';
import type { Deposit, PaymentMethod, Withdrawal } from '../lib/types';
import { RowSkeletons } from '../components/Skeleton';

type Tab = 'deposit' | 'withdraw' | 'history';

export function Wallet() {
  const user = useAuth((s) => s.user);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'deposit';
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [mockChain, setMockChain] = useState(false);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);

  const loadAll = useCallback(async () => {
    const [d, w] = await Promise.all([
      api.get<{ deposits: Deposit[] }>('/wallet/deposits'),
      api.get<{ withdrawals: Withdrawal[] }>('/wallet/withdrawals'),
    ]);
    setDeposits(d.deposits);
    setWithdrawals(w.withdrawals);
    setListsLoaded(true);
  }, []);

  useEffect(() => {
    api
      .get<{ methods: PaymentMethod[]; mockChain: boolean }>('/wallet/methods')
      .then((data) => {
        setMethods(data.methods);
        setMockChain(data.mockChain);
      })
      .catch(() => undefined);
    void loadAll();
  }, [loadAll]);

  // any wallet-side change pushed by the server refreshes the lists
  useEffect(() => {
    const offs = [
      realtime.on('deposit:updated', () => void loadAll()),
      realtime.on('deposit:created', () => void loadAll()),
      realtime.on('withdrawal:updated', () => void loadAll()),
    ];
    return () => offs.forEach((off) => off());
  }, [loadAll]);

  const setTab = (next: Tab) => setParams(next === 'deposit' ? {} : { tab: next });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        <Stat label="Balance" value={money(user?.realBalance ?? 0)} />
        <Stat label="On hold" value={money(user?.lockedBalance ?? 0)} />
        <Stat label="Deposited" value={money(user?.totalDeposited ?? 0)} />
        <Stat label="Withdrawn" value={money(user?.totalWithdrawn ?? 0)} className="hidden sm:block" />
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-ink-600 bg-ink-800 p-1">
        {(['deposit', 'withdraw', 'history'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition ${
              tab === key ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      {tab === 'deposit' && (
        <DepositPanel methods={methods} mockChain={mockChain} deposits={deposits} onChanged={() => void loadAll()} />
      )}
      {tab === 'withdraw' && (
        <WithdrawPanel methods={methods} withdrawals={withdrawals} onChanged={() => void loadAll()} />
      )}
      {tab === 'history' &&
        (listsLoaded ? (
          <WalletHistory deposits={deposits} withdrawals={withdrawals} />
        ) : (
          <RowSkeletons rows={6} className="card divide-y divide-ink-700" />
        ))}
    </div>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`card p-3 ${className}`}>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="tabular text-base font-bold">{value}</p>
    </div>
  );
}

function WalletHistory({ deposits, withdrawals }: { deposits: Deposit[]; withdrawals: Withdrawal[] }) {
  const rows = [
    ...deposits.map((d) => ({
      id: d.id,
      kind: 'Deposit',
      when: d.createdAt,
      amount: d.creditedAmount || 0,
      detail: `${d.cryptoAmount} ${d.currency} · ${d.networkLabel}`,
      status: d.status,
      hash: d.txHash,
      url: d.explorerUrl,
      positive: true,
    })),
    ...withdrawals.map((w) => ({
      id: w.id,
      kind: 'Withdrawal',
      when: w.createdAt,
      amount: -w.amount,
      detail: `${w.cryptoAmount} ${w.currency} · ${w.networkLabel}`,
      status: w.status,
      hash: w.txHash,
      url: w.explorerUrl,
      positive: false,
    })),
  ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

  if (rows.length === 0) {
    return <p className="card p-10 text-center text-sm text-slate-500">No deposits or withdrawals yet.</p>;
  }

  return (
    <ul className="card divide-y divide-ink-700">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 p-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{row.kind}</span>
            <span className="block truncate text-[11px] text-slate-500">{row.detail}</span>
            <span className="block text-[11px] text-slate-500">{dateTime(row.when)}</span>
          </span>
          <span className="text-right">
            <span className={`tabular block text-sm font-bold ${row.positive ? 'text-up' : 'text-slate-200'}`}>
              {row.amount === 0 ? '—' : money(row.amount, { sign: true })}
            </span>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500">{row.status.toLowerCase()}</span>
            {row.hash &&
              (row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block font-mono text-[10px] text-accent hover:underline"
                >
                  {shortHash(row.hash)}
                </a>
              ) : (
                <span className="block font-mono text-[10px] text-slate-500">{shortHash(row.hash)}</span>
              ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
