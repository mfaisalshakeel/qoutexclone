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
  pendingKyc: number;
  bonusPaid: number;
  feedProvider: string;
}

type Tab = 'overview' | 'withdrawals' | 'deposits' | 'kyc' | 'promos' | 'users' | 'assets';

interface KycSubmission {
  id: string;
  fullName: string;
  dateOfBirth: string;
  country: string;
  address: string;
  documentType: string;
  documentNumber: string;
  status: string;
  note: string | null;
  createdAt: string;
  user?: { email: string; name: string; realBalance: number };
}

interface Promo {
  id: string;
  code: string;
  kind: string;
  value: number;
  minDeposit: number;
  maxBonus: number;
  maxRedemptions: number;
  redemptions: number;
  enabled: boolean;
  expiresAt: string | null;
  description: string;
}

export function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [kyc, setKyc] = useState<KycSubmission[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [search, setSearch] = useState('');
  const [newPromo, setNewPromo] = useState({ code: '', value: 30, minDeposit: 0, maxBonus: 0 });

  const load = useCallback(async () => {
    const [o, w, d, k] = await Promise.all([
      api.get<Overview>('/admin/overview'),
      api.get<{ withdrawals: Withdrawal[] }>('/admin/withdrawals'),
      api.get<{ deposits: Deposit[] }>('/admin/deposits'),
      api.get<{ submissions: KycSubmission[] }>('/admin/kyc'),
    ]);
    setOverview(o);
    setWithdrawals(w.withdrawals);
    setDeposits(d.deposits);
    setKyc(k.submissions);
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
    if (tab === 'promos') {
      api
        .get<{ promos: Promo[] }>('/admin/promos')
        .then(({ promos: list }) => setPromos(list))
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
  const pendingKyc = kyc.filter((k) => k.status === 'PENDING');
  const pendingDeposits = deposits.filter((d) => d.status === 'AWAITING_PAYMENT' || d.status === 'CONFIRMING');

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-lg font-bold">Administration</h1>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-ink-600 bg-ink-800 p-1">
        {(['overview', 'withdrawals', 'deposits', 'kyc', 'promos', 'users', 'assets'] as const).map((key) => (
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
            {key === 'kyc' && pendingKyc.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{pendingKyc.length}</span>
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
          <Stat label="Pending verifications" value={String(overview.pendingKyc)} />
          <Stat label="Bonuses paid" value={money(overview.bonusPaid)} />
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

      {tab === 'kyc' && (
        <div className="space-y-2">
          {kyc.length === 0 && <Empty text="No verification requests yet" />}
          {kyc.map((submission) => (
            <div key={submission.id} className="card p-3.5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {submission.fullName}
                    <span className="ml-2 text-[11px] font-normal text-slate-500">{submission.user?.email}</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {submission.documentType.replace(/_/g, ' ').toLowerCase()} · {submission.documentNumber} ·{' '}
                    born {submission.dateOfBirth}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {submission.address}, {submission.country}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    submitted {dateTime(submission.createdAt)} · balance {money(submission.user?.realBalance ?? 0)}
                  </p>
                  {submission.note && <p className="mt-1 text-[11px] text-slate-400">Note: {submission.note}</p>}
                </div>
                <span className="chip bg-ink-600 text-slate-300">{submission.status.toLowerCase()}</span>
                {submission.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => void act(`/admin/kyc/${submission.id}/review`, { decision: 'APPROVED' }, 'Identity verified')}
                      className="btn-up !px-3 !py-2 text-xs"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        const note = window.prompt('Why is this being rejected?');
                        if (note) void act(`/admin/kyc/${submission.id}/review`, { decision: 'REJECTED', note }, 'Verification rejected');
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

      {tab === 'promos' && (
        <div className="space-y-3">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api.post('/admin/promos', {
                  code: newPromo.code,
                  kind: 'DEPOSIT_BONUS_PCT',
                  value: newPromo.value,
                  minDeposit: Math.round(newPromo.minDeposit * 100),
                  maxBonus: Math.round(newPromo.maxBonus * 100),
                });
                const { promos: list } = await api.get<{ promos: Promo[] }>('/admin/promos');
                setPromos(list);
                setNewPromo({ code: '', value: 30, minDeposit: 0, maxBonus: 0 });
                toast.success('Promo code created');
              } catch (err) {
                toast.error('Could not create', err instanceof ApiError ? err.message : undefined);
              }
            }}
            className="card grid gap-3 p-4 sm:grid-cols-5"
          >
            <div className="sm:col-span-2">
              <label className="label" htmlFor="promo-new-code">
                Code
              </label>
              <input
                id="promo-new-code"
                required
                minLength={3}
                value={newPromo.code}
                onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                className="field font-mono !text-xs uppercase"
                placeholder="WELCOME30"
              />
            </div>
            <div>
              <label className="label" htmlFor="promo-new-value">
                Bonus %
              </label>
              <input
                id="promo-new-value"
                type="number"
                min={1}
                value={newPromo.value}
                onChange={(e) => setNewPromo({ ...newPromo, value: Number(e.target.value) })}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="promo-new-min">
                Min deposit $
              </label>
              <input
                id="promo-new-min"
                type="number"
                min={0}
                value={newPromo.minDeposit}
                onChange={(e) => setNewPromo({ ...newPromo, minDeposit: Number(e.target.value) })}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="promo-new-cap">
                Cap $
              </label>
              <input
                id="promo-new-cap"
                type="number"
                min={0}
                value={newPromo.maxBonus}
                onChange={(e) => setNewPromo({ ...newPromo, maxBonus: Number(e.target.value) })}
                className="field"
              />
            </div>
            <button type="submit" className="btn-primary sm:col-span-5">
              Create promo code
            </button>
          </form>

          {promos.length === 0 && <Empty text="No promo codes yet" />}
          {promos.map((promo) => (
            <div key={promo.id} className="card flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold">{promo.code}</p>
                <p className="text-[11px] text-slate-400">{promo.description}</p>
                <p className="text-[11px] text-slate-500">
                  {promo.redemptions} redeemed
                  {promo.maxRedemptions > 0 ? ` of ${promo.maxRedemptions}` : ''}
                  {promo.expiresAt ? ` · expires ${dateTime(promo.expiresAt)}` : ''}
                </p>
              </div>
              <span className={`chip ${promo.enabled ? 'bg-up-soft text-up' : 'bg-ink-600 text-slate-400'}`}>
                {promo.enabled ? 'active' : 'disabled'}
              </span>
              <button
                onClick={async () => {
                  try {
                    await api.patch(`/admin/promos/${promo.id}`, { enabled: !promo.enabled });
                    const { promos: list } = await api.get<{ promos: Promo[] }>('/admin/promos');
                    setPromos(list);
                  } catch (err) {
                    toast.error('Update failed', err instanceof ApiError ? err.message : undefined);
                  }
                }}
                className="btn-ghost !px-3 !py-2 text-xs"
              >
                {promo.enabled ? 'Disable' : 'Enable'}
              </button>
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
