import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime, money, shortHash } from '../lib/format';
import { toast } from '../store/toast';
import type { Asset, Deposit, User, Withdrawal } from '../lib/types';

interface Overview {
  users: number;
  openTrades: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  depositVolume: number;
  withdrawalVolume: number;
  realVolume: number;
  housePnl: number;
  feedProvider: string;
}

type Tab = 'overview' | 'withdrawals' | 'deposits' | 'users' | 'assets';

export function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const [o, w, d] = await Promise.all([
      api.get<Overview>('/admin/overview'),
      api.get<{ withdrawals: Withdrawal[] }>('/admin/withdrawals'),
      api.get<{ deposits: Deposit[] }>('/admin/deposits'),
    ]);
    setOverview(o);
    setWithdrawals(w.withdrawals);
    setDeposits(d.deposits);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'users') {
      api
        .get<{ users: User[] }>(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`)
        .then(({ users: list }) => setUsers(list))
        .catch(() => undefined);
    }
    if (tab === 'assets') {
      api
        .get<{ assets: Asset[] }>('/admin/assets')
        .then(({ assets: list }) => setAssets(list))
        .catch(() => undefined);
    }
  }, [tab, search]);

  const act = async (path: string, body: unknown, success: string) => {
    try {
      await api.post(path, body);
      await load();
      toast.success(success);
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'PENDING');
  const pendingDeposits = deposits.filter((d) => d.status === 'AWAITING_PAYMENT' || d.status === 'CONFIRMING');

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-lg font-bold">Administration</h1>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-ink-600 bg-ink-800 p-1">
        {(['overview', 'withdrawals', 'deposits', 'users', 'assets'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold capitalize transition ${
              tab === key ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {key}
            {key === 'withdrawals' && pendingWithdrawals.length > 0 && (
              <span className="ml-1.5 rounded-full bg-down px-1.5 text-[10px] text-white">{pendingWithdrawals.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && overview && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Traders" value={String(overview.users)} />
          <Stat label="Open positions" value={String(overview.openTrades)} />
          <Stat label="Pending deposits" value={String(overview.pendingDeposits)} />
          <Stat label="Pending withdrawals" value={String(overview.pendingWithdrawals)} />
          <Stat label="Deposit volume" value={money(overview.depositVolume)} />
          <Stat label="Withdrawal volume" value={money(overview.withdrawalVolume)} />
          <Stat label="Live trade volume" value={money(overview.realVolume)} />
          <Stat
            label="House P&L"
            value={money(overview.housePnl, { sign: true })}
            tone={overview.housePnl >= 0 ? 'up' : 'down'}
          />
          <div className="card col-span-2 p-3 sm:col-span-4">
            <p className="text-xs text-slate-400">
              Market data provider: <span className="font-semibold text-slate-200">{overview.feedProvider}</span>
            </p>
          </div>
        </div>
      )}

      {tab === 'withdrawals' && (
        <div className="space-y-2">
          {withdrawals.length === 0 && <Empty text="No withdrawals yet" />}
          {withdrawals.map((w) => (
            <div key={w.id} className="card p-3.5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {money(w.amount)} → {w.cryptoAmount} {w.currency}
                    <span className="ml-2 text-[11px] font-normal text-slate-500">{w.networkLabel}</span>
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {w.user?.email} · deposited {money(w.user?.totalDeposited ?? 0)}
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500">{w.address}</p>
                  <p className="text-[11px] text-slate-500">
                    {dateTime(w.createdAt)} · fee {money(w.fee)}
                    {w.txHash && ` · tx ${shortHash(w.txHash)}`}
                  </p>
                </div>
                <span className="chip bg-ink-600 text-slate-300">{w.status.toLowerCase()}</span>
                {w.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => void act(`/admin/withdrawals/${w.id}/approve`, { note: 'Approved' }, 'Payout sent')}
                      className="btn-up !px-3 !py-2 text-xs"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        const note = window.prompt('Reason for rejection?');
                        if (note) void act(`/admin/withdrawals/${w.id}/reject`, { note }, 'Withdrawal rejected');
                      }}
                      className="btn-ghost !px-3 !py-2 text-xs !text-down"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'deposits' && (
        <div className="space-y-2">
          {deposits.length === 0 && <Empty text="No deposits yet" />}
          {pendingDeposits.length > 0 && (
            <p className="text-xs text-slate-400">{pendingDeposits.length} awaiting confirmation</p>
          )}
          {deposits.map((d) => (
            <div key={d.id} className="card flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {d.cryptoAmount} {d.currency}
                  <span className="ml-2 text-[11px] font-normal text-slate-500">{d.networkLabel}</span>
                </p>
                <p className="truncate text-[11px] text-slate-400">{d.user?.email}</p>
                <p className="truncate font-mono text-[11px] text-slate-500">{d.address}</p>
                <p className="text-[11px] text-slate-500">
                  {dateTime(d.createdAt)} · {d.confirmations}/{d.requiredConf} conf
                  {d.creditedAmount > 0 && ` · credited ${money(d.creditedAmount)}`}
                </p>
              </div>
              <span className="chip bg-ink-600 text-slate-300">{d.status.toLowerCase().replace(/_/g, ' ')}</span>
              {(d.status === 'AWAITING_PAYMENT' || d.status === 'CONFIRMING') && (
                <div className="flex gap-2">
                  <button
                    onClick={() => void act(`/admin/deposits/${d.id}/confirm`, {}, 'Deposit credited')}
                    className="btn-up !px-3 !py-2 text-xs"
                  >
                    Credit
                  </button>
                  <button
                    onClick={() => {
                      const note = window.prompt('Reason for rejection?');
                      if (note) void act(`/admin/deposits/${d.id}/reject`, { note }, 'Deposit rejected');
                    }}
                    className="btn-ghost !px-3 !py-2 text-xs !text-down"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or name"
            className="field"
          />
          {users.map((u) => (
            <div key={u.id} className="card flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {u.name} <span className="text-[11px] font-normal text-slate-500">{u.email}</span>
                </p>
                <p className="tabular text-[11px] text-slate-400">
                  live {money(u.realBalance)} · demo {money(u.demoBalance)} · held {money(u.lockedBalance)}
                </p>
                <p className="text-[11px] text-slate-500">
                  joined {dateTime(u.createdAt)} · {u.role.toLowerCase()}
                </p>
              </div>
              <span className={`chip ${u.status === 'ACTIVE' ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
                {u.status.toLowerCase()}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const raw = window.prompt('Adjust live balance by (USD, negative to debit):');
                    const value = Number(raw);
                    if (raw && Number.isFinite(value) && value !== 0) {
                      void act(`/admin/users/${u.id}/adjust`, { accountType: 'REAL', amount: value }, 'Balance adjusted');
                    }
                  }}
                  className="btn-ghost !px-3 !py-2 text-xs"
                >
                  Adjust
                </button>
                <button
                  onClick={() =>
                    void act(
                      `/admin/users/${u.id}/status`,
                      { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                      u.status === 'ACTIVE' ? 'User suspended' : 'User reinstated',
                    )
                  }
                  className="btn-ghost !px-3 !py-2 text-xs"
                >
                  {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && <Empty text="No users match" />}
        </div>
      )}

      {tab === 'assets' && (
        <div className="space-y-2">
          {assets.map((asset) => (
            <div key={asset.id} className="card flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {asset.name} <span className="text-[11px] font-normal text-slate-500">{asset.symbol}</span>
                </p>
                <p className="tabular text-[11px] text-slate-400">
                  payout {asset.payoutPct}% · stake {money(asset.minStake)}–{money(asset.maxStake)}
                </p>
              </div>
              <button
                onClick={() => {
                  const raw = window.prompt(`Payout % for ${asset.symbol}`, String(asset.payoutPct));
                  const value = Number(raw);
                  if (raw && Number.isFinite(value)) {
                    api
                      .patch(`/admin/assets/${asset.id}`, { payoutPct: Math.round(value) })
                      .then(() => api.get<{ assets: Asset[] }>('/admin/assets'))
                      .then(({ assets: list }) => {
                        setAssets(list);
                        toast.success('Payout updated');
                      })
                      .catch((err) => toast.error('Update failed', err instanceof ApiError ? err.message : undefined));
                  }
                }}
                className="btn-ghost !px-3 !py-2 text-xs"
              >
                Edit payout
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`tabular text-base font-bold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="card p-10 text-center text-sm text-slate-500">{text}</p>;
}
