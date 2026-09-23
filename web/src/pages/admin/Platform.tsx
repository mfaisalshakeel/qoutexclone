import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { toast } from '../../store/toast';
import { Loading, PageHead, StatusPill } from '../../components/admin/ui';
import { DataTable, type DataTableColumn } from '../../components/admin/DataTable';
import type { Asset, LeaderboardRow } from '../../lib/types';

type AdminAsset = Asset & {
  enabled: boolean;
  minStake: number;
  maxStake: number;
  scheduleId: string | null;
};

interface AdminTournament {
  id: string;
  name: string;
  description: string | null;
  status: string;
  entryFee: number;
  prizePool: number;
  startingBalance: number;
  maxEntries: number;
  prizeSplit: string;
  startsAt: string;
  endsAt: string;
  entrants: number;
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

function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString().slice(0, 16);
}

const TOURNAMENT_FILTERS = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum' as const,
    options: [
      { value: 'SCHEDULED', label: 'Scheduled' },
      { value: 'RUNNING', label: 'Running' },
      { value: 'FINISHED', label: 'Finished' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
];

export function AdminTournaments() {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  // paying out is irreversible, so it takes two clicks — in two steps rather
  // than a native confirm, which a keyboard or an automated check cannot reach
  const [confirming, setConfirming] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    entryFee: 5,
    prizePool: 250,
    startingBalance: 1000,
    maxEntries: 0,
    prizeSplit: '50,30,20',
    startsAt: isoIn(0),
    endsAt: isoIn(24),
  });

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/admin/tournaments', {
        name: form.name,
        description: form.description || undefined,
        entryFee: Math.round(form.entryFee * 100),
        prizePool: Math.round(form.prizePool * 100),
        startingBalance: Math.round(form.startingBalance * 100),
        maxEntries: form.maxEntries,
        prizeSplit: form.prizeSplit,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      });
      setForm({ ...form, name: '', description: '' });
      reload();
      toast.success('Tournament created');
    } catch (err) {
      toast.error('Could not create', err instanceof ApiError ? err.message : undefined);
    }
  };

  const act = async (id: string, action: 'start' | 'finish') => {
    setConfirming(null);
    try {
      await api.post(`/admin/tournaments/${id}/${action}`);
      reload();
      toast.success(action === 'start' ? 'Tournament started' : 'Prizes paid out');
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const columns: DataTableColumn<AdminTournament>[] = [
    {
      key: 'name',
      label: 'Tournament',
      sortable: true,
      render: (t) => (
        <>
          <span className="block text-xs font-semibold">{t.name}</span>
          {t.description && <span className="block text-[11px] text-slate-500">{t.description}</span>}
          <span className="mt-1 block">
            <StatusPill status={t.status} />
          </span>
        </>
      ),
    },
    {
      key: 'startsAt',
      label: 'Window',
      sortable: true,
      render: (t) => (
        <span className="text-[11px] text-slate-500">
          <span className="block">{dateTime(t.startsAt)}</span>
          <span className="block">→ {dateTime(t.endsAt)}</span>
        </span>
      ),
    },
    {
      key: 'entryFee',
      label: 'Entry',
      sortable: true,
      render: (t) => (
        <>
          <span className="tabular block text-xs">{t.entryFee > 0 ? money(t.entryFee) : 'free'}</span>
          <span className="tabular block text-[10px] text-slate-500">{money(t.startingBalance)} chips</span>
        </>
      ),
    },
    {
      key: 'prizePool',
      label: 'Pool',
      sortable: true,
      render: (t) => (
        <>
          <span className="tabular block text-xs font-semibold text-up">{money(t.prizePool)}</span>
          <span className="block font-mono text-[10px] text-slate-500">{t.prizeSplit}</span>
        </>
      ),
    },
    {
      key: 'entrants',
      label: 'Entrants',
      align: 'right',
      render: (t) => <span className="tabular text-xs">{t.entrants}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (t) => (
        <span className="flex flex-wrap justify-end gap-2">
          {t.status === 'SCHEDULED' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void act(t.id, 'start');
              }}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              Start
            </button>
          )}
          {t.status === 'RUNNING' &&
            (confirming === t.id ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void act(t.id, 'finish');
                  }}
                  className="btn-up !px-3 !py-1.5 text-xs"
                >
                  Confirm payout
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(null);
                  }}
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                >
                  Keep running
                </button>
              </>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(t.id);
                }}
                className="btn-up !px-3 !py-1.5 text-xs"
              >
                Finish &amp; pay
              </button>
            ))}
        </span>
      ),
    },
  ];

  return (
    <>
      {/* DataTable below owns the page's one heading; this is a lead-in, not a second h1 */}
      <p className="mb-4 text-xs text-slate-500">Chip-based contests that pay real prizes from the pool</p>

      <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="t-name">
            Name
          </label>
          <input
            id="t-name"
            required
            minLength={3}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="field"
            placeholder="Friday Night Sprint"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="t-desc">
            Description
          </label>
          <input
            id="t-desc"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="field"
            placeholder="30 minutes, biggest stack wins"
          />
        </div>
        <div>
          <label className="label" htmlFor="t-fee">
            Entry fee $
          </label>
          <input
            id="t-fee"
            type="number"
            min={0}
            value={form.entryFee}
            onChange={(e) => setForm({ ...form, entryFee: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="t-pool">
            Guaranteed pool $
          </label>
          <input
            id="t-pool"
            type="number"
            min={0}
            value={form.prizePool}
            onChange={(e) => setForm({ ...form, prizePool: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="t-chips">
            Starting chips $
          </label>
          <input
            id="t-chips"
            type="number"
            min={10}
            value={form.startingBalance}
            onChange={(e) => setForm({ ...form, startingBalance: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="t-split">
            Prize split %
          </label>
          <input
            id="t-split"
            value={form.prizeSplit}
            onChange={(e) => setForm({ ...form, prizeSplit: e.target.value })}
            className="field font-mono !text-xs"
          />
        </div>
        <div>
          <label className="label" htmlFor="t-start">
            Starts
          </label>
          <input
            id="t-start"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="t-end">
            Ends
          </label>
          <input
            id="t-end"
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            className="field"
          />
        </div>
        <div className="flex items-end lg:col-span-2">
          <button type="submit" className="btn-primary w-full">
            Create tournament
          </button>
        </div>
      </form>

      <DataTable<AdminTournament>
        title="Tournaments"
        columns={columns}
        filters={TOURNAMENT_FILTERS}
        searchPlaceholder="Search by name"
        rowKey={(t) => t.id}
        reloadToken={reloadToken}
        fetchPage={async (state) => {
          const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
          if (state.sort) params.set('sort', state.sort);
          if (state.search) params.set('search', state.search);
          for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
          const data = await api.get<{ tournaments: AdminTournament[]; total: number; pageCount: number }>(
            `/admin/tournaments?${params.toString()}`,
          );
          return { items: data.tournaments, total: data.total, pageCount: data.pageCount };
        }}
        renderDrawer={(t) => <TournamentLeaderboardDrawer tournament={t} />}
      />
    </>
  );
}

function TournamentLeaderboardDrawer({ tournament }: { tournament: AdminTournament }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [result, setResult] = useState<{ items: LeaderboardRow[]; total: number; pageCount: number } | null>(
    null,
  );
  const [error, setError] = useState('');

  // the search box debounces locally; a change resets to the first page
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput);
        setPage(1);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('search', search);
    api
      .get<{ leaderboard: LeaderboardRow[]; total: number; pageCount: number }>(
        `/admin/tournaments/${tournament.id}/leaderboard?${params.toString()}`,
      )
      .then((data) => {
        if (!cancelled) setResult({ items: data.leaderboard, total: data.total, pageCount: data.pageCount });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the leaderboard');
      });
    return () => {
      cancelled = true;
    };
  }, [tournament.id, page, search]);

  return (
    <div>
      <h2 className="pr-16 text-sm font-bold">{tournament.name}</h2>
      {tournament.description && <p className="mt-0.5 text-xs text-slate-500">{tournament.description}</p>}
      <p className="mt-1.5 flex items-center gap-2">
        <StatusPill status={tournament.status} />
        <span className="text-[11px] text-slate-500">{tournament.entrants} entrants</span>
      </p>

      <input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search by trader name"
        className="field mt-4 !py-2 !text-xs"
      />

      {error ? (
        <div className="mt-4 rounded-lg border border-ink-600 p-4 text-center">
          <p className="text-xs text-slate-400">{error}</p>
        </div>
      ) : !result ? (
        <p className="mt-4 text-center text-xs text-slate-500">Loading…</p>
      ) : result.items.length === 0 ? (
        <p className="mt-4 text-center text-xs text-slate-500">No entrants match</p>
      ) : (
        <>
          <ol className="mt-4 space-y-1.5">
            {result.items.map((row) => (
              <li key={row.id} className="flex items-center gap-3 text-xs">
                <span className="w-6 font-bold text-slate-500">{row.place}</span>
                <span className="flex-1 truncate">{row.name}</span>
                <span className="tabular">{money(row.balance)}</span>
                <span className={`tabular w-20 text-right ${row.profit >= 0 ? 'text-up' : 'text-down'}`}>
                  {money(row.profit, { sign: true })}
                </span>
                <span className="tabular w-20 text-right text-up">
                  {row.prize > 0 ? money(row.prize) : ''}
                </span>
              </li>
            ))}
          </ol>
          {result.pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Page {page} of {result.pageCount} · {result.total} entrants
              </span>
              <span className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn-ghost !px-2.5 !py-1 text-xs disabled:opacity-40"
                >
                  ‹
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(result.pageCount, p + 1))}
                  disabled={page >= result.pageCount}
                  className="btn-ghost !px-2.5 !py-1 text-xs disabled:opacity-40"
                >
                  ›
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const PROMO_FILTERS = [
  {
    key: 'kind',
    label: 'Kind',
    type: 'enum' as const,
    options: [
      { value: 'DEPOSIT_BONUS_PCT', label: 'Deposit bonus %' },
      { value: 'FIXED_CREDIT', label: 'Fixed credit' },
    ],
  },
];

export function AdminPromos() {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const [form, setForm] = useState({ code: '', value: 30, minDeposit: 0, maxBonus: 0, maxRedemptions: 0 });

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/admin/promos', {
        code: form.code,
        kind: 'DEPOSIT_BONUS_PCT',
        value: form.value,
        minDeposit: Math.round(form.minDeposit * 100),
        maxBonus: Math.round(form.maxBonus * 100),
        maxRedemptions: form.maxRedemptions,
      });
      setForm({ ...form, code: '' });
      reload();
      toast.success('Promo code created');
    } catch (err) {
      toast.error('Could not create', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggle = async (promo: Promo) => {
    try {
      await api.patch(`/admin/promos/${promo.id}`, { enabled: !promo.enabled });
      reload();
    } catch (err) {
      toast.error('Update failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const columns: DataTableColumn<Promo>[] = [
    {
      key: 'code',
      label: 'Code',
      render: (promo) => <span className="font-mono text-xs font-semibold">{promo.code}</span>,
    },
    {
      key: 'description',
      label: 'Offer',
      render: (promo) => <span className="text-[11px] text-slate-400">{promo.description}</span>,
    },
    {
      key: 'redemptions',
      label: 'Redeemed',
      sortable: true,
      render: (promo) => (
        <span className="tabular text-xs">
          {promo.redemptions}
          {promo.maxRedemptions > 0 ? ` / ${promo.maxRedemptions}` : ''}
        </span>
      ),
    },
    {
      key: 'expiresAt',
      label: 'Expires',
      sortable: true,
      render: (promo) => (
        <span className="text-[11px] text-slate-500">
          {promo.expiresAt ? dateTime(promo.expiresAt) : 'no expiry'}
        </span>
      ),
    },
    {
      key: 'state',
      label: 'State',
      render: (promo) => <StatusPill status={promo.enabled ? 'active' : 'closed'} />,
    },
    {
      key: 'actions',
      label: 'Action',
      align: 'right',
      render: (promo) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void toggle(promo);
          }}
          className="btn-ghost !px-3 !py-1.5 text-xs"
        >
          {promo.enabled ? 'Disable' : 'Enable'}
        </button>
      ),
    },
  ];

  return (
    <>
      {/* DataTable below owns the page's one heading; this is a lead-in, not a second h1 */}
      <p className="mb-4 text-xs text-slate-500">
        Deposit bonuses credited automatically when a payment confirms
      </p>

      <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-5">
        <div>
          <label className="label" htmlFor="p-code">
            Code
          </label>
          <input
            id="p-code"
            required
            minLength={3}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className="field font-mono !text-xs uppercase"
            placeholder="WELCOME30"
          />
        </div>
        <div>
          <label className="label" htmlFor="p-value">
            Bonus %
          </label>
          <input
            id="p-value"
            type="number"
            min={1}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="p-min">
            Min deposit $
          </label>
          <input
            id="p-min"
            type="number"
            min={0}
            value={form.minDeposit}
            onChange={(e) => setForm({ ...form, minDeposit: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="p-cap">
            Cap $
          </label>
          <input
            id="p-cap"
            type="number"
            min={0}
            value={form.maxBonus}
            onChange={(e) => setForm({ ...form, maxBonus: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full">
            Create
          </button>
        </div>
      </form>

      <DataTable<Promo>
        title="Promo codes"
        columns={columns}
        filters={PROMO_FILTERS}
        searchPlaceholder="Search by code"
        rowKey={(promo) => promo.id}
        reloadToken={reloadToken}
        fetchPage={async (state) => {
          const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
          if (state.sort) params.set('sort', state.sort);
          if (state.search) params.set('search', state.search);
          for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
          const data = await api.get<{ promos: Promo[]; total: number; pageCount: number }>(
            `/admin/promos?${params.toString()}`,
          );
          return { items: data.promos, total: data.total, pageCount: data.pageCount };
        }}
        renderDrawer={(promo) => <PromoRedemptionsDrawer promo={promo} />}
      />
    </>
  );
}

interface PromoRedemptionRow {
  id: string;
  userId: string;
  depositId: string | null;
  amount: number;
  createdAt: string;
  user: { email: string; name: string };
}

function PromoRedemptionsDrawer({ promo }: { promo: Promo }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [result, setResult] = useState<{
    items: PromoRedemptionRow[];
    total: number;
    pageCount: number;
  } | null>(null);
  const [error, setError] = useState('');

  // the search box debounces locally; a change resets to the first page
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput);
        setPage(1);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('search', search);
    api
      .get<{ redemptions: PromoRedemptionRow[]; total: number; pageCount: number }>(
        `/admin/promos/${promo.id}/redemptions?${params.toString()}`,
      )
      .then((data) => {
        if (!cancelled) setResult({ items: data.redemptions, total: data.total, pageCount: data.pageCount });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load redemptions');
      });
    return () => {
      cancelled = true;
    };
  }, [promo.id, page, search]);

  return (
    <div>
      <h2 className="pr-16 font-mono text-sm font-bold">{promo.code}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{promo.description}</p>
      <p className="mt-1.5 flex items-center gap-2">
        <StatusPill status={promo.enabled ? 'active' : 'closed'} />
        <span className="text-[11px] text-slate-500">
          {promo.redemptions}
          {promo.maxRedemptions > 0 ? ` / ${promo.maxRedemptions}` : ''} redeemed
        </span>
      </p>

      <input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search by trader name or email"
        className="field mt-4 !py-2 !text-xs"
      />

      {error ? (
        <div className="mt-4 rounded-lg border border-ink-600 p-4 text-center">
          <p className="text-xs text-slate-400">{error}</p>
        </div>
      ) : !result ? (
        <p className="mt-4 text-center text-xs text-slate-500">Loading…</p>
      ) : result.items.length === 0 ? (
        <p className="mt-4 text-center text-xs text-slate-500">No redemptions match</p>
      ) : (
        <>
          <ol className="mt-4 space-y-2">
            {result.items.map((row) => (
              <li key={row.id} className="flex items-center gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {row.user.name}
                  <span className="block text-[10px] text-slate-500">{row.user.email}</span>
                </span>
                <span className="tabular text-up">{money(row.amount)}</span>
                <span className="w-24 text-right text-[10px] text-slate-500">{dateTime(row.createdAt)}</span>
              </li>
            ))}
          </ol>
          {result.pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Page {page} of {result.pageCount} · {result.total} redemptions
              </span>
              <span className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn-ghost !px-2.5 !py-1 text-xs disabled:opacity-40"
                >
                  ‹
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(result.pageCount, p + 1))}
                  disabled={page >= result.pageCount}
                  className="btn-ghost !px-2.5 !py-1 text-xs disabled:opacity-40"
                >
                  ›
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ASSET_FILTERS = [
  {
    key: 'assetClass',
    label: 'Class',
    type: 'enum' as const,
    options: [
      { value: 'CURRENCY', label: 'Currency' },
      { value: 'CRYPTO', label: 'Crypto' },
      { value: 'COMMODITY', label: 'Commodity' },
      { value: 'STOCK', label: 'Stock' },
      { value: 'INDEX', label: 'Index' },
    ],
  },
];

interface MarketplaceOrder {
  id: string;
  status: 'OWNED' | 'ACTIVE' | 'USED' | 'EXPIRED';
  paidCents: number;
  paidPoints: number;
  usesLeft: number;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  item: { key: string; name: string; kind: string };
  user: { email: string; name: string };
}

const ORDER_FILTERS = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum' as const,
    options: [
      { value: 'OWNED', label: 'Owned' },
      { value: 'ACTIVE', label: 'Active' },
      { value: 'USED', label: 'Used' },
      { value: 'EXPIRED', label: 'Expired' },
    ],
  },
  { key: 'createdAt', label: 'Bought', type: 'dateRange' as const },
];

/** Every marketplace purchase, for support and for seeing whether the shop works. */
export function AdminMarketplaceOrders() {
  const columns: DataTableColumn<MarketplaceOrder>[] = [
    {
      key: 'user',
      label: 'Trader',
      render: (o) => (
        <>
          <span className="block text-xs font-semibold">{o.user.name}</span>
          <span className="block text-[11px] text-slate-500">{o.user.email}</span>
        </>
      ),
    },
    {
      key: 'item',
      label: 'Item',
      render: (o) => (
        <>
          <span className="block text-xs font-semibold">{o.item.name}</span>
          <span className="block text-[11px] text-slate-500">
            {o.item.kind.replace(/_/g, ' ').toLowerCase()}
          </span>
        </>
      ),
    },
    {
      key: 'paidCents',
      label: 'Cost',
      sortable: true,
      render: (o) => (
        <span className="tabular text-xs">
          {o.paidCents > 0 && <span className="block font-semibold">{money(o.paidCents)}</span>}
          {o.paidPoints > 0 && <span className="block text-[11px] text-slate-500">{o.paidPoints} pts</span>}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (o) => (
        <>
          <StatusPill status={o.status} />
          {o.usesLeft > 0 && (
            <span className="mt-1 block text-[10px] text-slate-500">{o.usesLeft} uses left</span>
          )}
          {o.expiresAt && (
            <span className="block text-[10px] text-slate-500">expires {dateTime(o.expiresAt)}</span>
          )}
        </>
      ),
    },
    {
      key: 'createdAt',
      label: 'Bought',
      sortable: true,
      align: 'right',
      render: (o) => <span className="text-[11px] text-slate-500">{dateTime(o.createdAt)}</span>,
    },
  ];

  return (
    <DataTable<MarketplaceOrder>
      title="Marketplace orders"
      columns={columns}
      filters={ORDER_FILTERS}
      searchPlaceholder="Search trader or item"
      rowKey={(o) => o.id}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ orders: MarketplaceOrder[]; total: number; pageCount: number }>(
          `/admin/marketplace/orders?${params.toString()}`,
        );
        return { items: data.orders, total: data.total, pageCount: data.pageCount };
      }}
      exportPath={(params) => `/admin/marketplace/orders/export?${params.toString()}`}
    />
  );
}

export function AdminAssets() {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const patch = async (id: string, data: Record<string, unknown>, message: string) => {
    try {
      await api.patch(`/admin/assets/${id}`, data);
      reload();
      toast.success(message);
    } catch (err) {
      toast.error('Update failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const columns: DataTableColumn<AdminAsset>[] = [
    {
      key: 'symbol',
      label: 'Market',
      sortable: true,
      render: (asset) => (
        <>
          <span className="block text-xs font-semibold">
            {asset.pair}
            {asset.isOtc && <span className="chip ml-2 bg-accent-soft text-accent">OTC</span>}
          </span>
          <span className="block text-[11px] text-slate-500">
            {asset.symbol} · {asset.assetClass.toLowerCase()}
          </span>
        </>
      ),
    },
    {
      key: 'price',
      label: 'Price',
      render: (asset) => <span className="tabular text-xs">{asset.price?.toLocaleString() ?? '—'}</span>,
    },
    {
      key: 'payoutPct',
      label: 'Payout',
      sortable: true,
      render: (asset) => <span className="tabular text-xs font-semibold text-up">{asset.payoutPct}%</span>,
    },
    {
      key: 'minStake',
      label: 'Stake range',
      sortable: true,
      render: (asset) => (
        <span className="tabular text-[11px] text-slate-400">
          {money(asset.minStake)} – {money(asset.maxStake)}
        </span>
      ),
    },
    {
      key: 'session',
      label: 'Session',
      render: (asset) => (
        <>
          <StatusPill status={asset.isOpen ? 'open' : 'closed'} />
          <span className="mt-1 block text-[10px] text-slate-500">
            {asset.schedule ? asset.schedule.hours : '24/7'}
          </span>
          {!asset.isOpen && asset.nextOpen && (
            <span className="block text-[10px] text-slate-500">opens {dateTime(asset.nextOpen)}</span>
          )}
        </>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (asset) => (
        <span className="flex justify-end gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const raw = window.prompt(`Payout % for ${asset.pair}`, String(asset.payoutPct));
              const value = Number(raw);
              if (raw && Number.isFinite(value)) {
                void patch(asset.id, { payoutPct: Math.round(value) }, 'Payout updated');
              }
            }}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            Payout
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void patch(
                asset.id,
                { enabled: !asset.enabled },
                asset.enabled ? 'Market delisted' : 'Market listed',
              );
            }}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            {asset.enabled ? 'Delist' : 'List'}
          </button>
        </span>
      ),
    },
  ];

  return (
    <DataTable<AdminAsset>
      title="Markets"
      columns={columns}
      filters={ASSET_FILTERS}
      searchPlaceholder="Search symbol or name"
      rowKey={(asset) => asset.id}
      reloadToken={reloadToken}
      defaultPageSize={100}
      pageSizeOptions={[25, 50, 100, 200]}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ assets: AdminAsset[]; total: number; pageCount: number }>(
          `/admin/assets?${params.toString()}`,
        );
        return { items: data.assets, total: data.total, pageCount: data.pageCount };
      }}
    />
  );
}

interface Schedule {
  id: string;
  key: string;
  name: string;
  note: string | null;
  hours: string;
  markets: number;
  state: { isOpen: boolean; nextOpen: string | null; nextClose: string | null; holiday?: string };
  windows: { id: string; dayOfWeek: number; openMinute: number; closeMinute: number }[];
  holidays: { id: string; date: string; name: string }[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const asTime = (minutes: number) =>
  `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Opening hours and holidays per exchange calendar. */
export function AdminSchedules() {
  const [rows, setRows] = useState<Schedule[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [holiday, setHoliday] = useState({ date: '', name: '' });

  const load = useCallback(async () => {
    const { schedules } = await api.get<{ schedules: Schedule[] }>('/admin/schedules');
    setRows(schedules);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addHoliday = async (schedule: Schedule) => {
    try {
      await api.post(`/admin/schedules/${schedule.id}/holidays`, holiday);
      setHoliday({ date: '', name: '' });
      await load();
      toast.success('Holiday added', `${schedule.name} closes that day`);
    } catch (err) {
      toast.error('Could not add', err instanceof ApiError ? err.message : undefined);
    }
  };

  const removeHoliday = async (schedule: Schedule, holidayId: string) => {
    try {
      await api.del(`/admin/schedules/${schedule.id}/holidays/${holidayId}`);
      await load();
      toast.info('Holiday removed');
    } catch (err) {
      toast.error('Could not remove', err instanceof ApiError ? err.message : undefined);
    }
  };

  const editWindow = async (schedule: Schedule, windowId: string) => {
    const target = schedule.windows.find((window) => window.id === windowId);
    if (!target) return;
    const raw = window.prompt(
      `${DAY_NAMES[target.dayOfWeek]} hours in UTC (HH:MM-HH:MM)`,
      `${asTime(target.openMinute)}-${asTime(target.closeMinute)}`,
    );
    if (!raw) return;

    const match = raw.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!match) {
      toast.error('Use the HH:MM-HH:MM format');
      return;
    }
    const openMinute = Number(match[1]) * 60 + Number(match[2]);
    const closeMinuteRaw = Number(match[3]) * 60 + Number(match[4]);
    // a close earlier than the open means the session runs past midnight
    const closeMinute = closeMinuteRaw <= openMinute ? closeMinuteRaw + 1440 : closeMinuteRaw;

    try {
      await api.put(`/admin/schedules/${schedule.id}/windows`, {
        windows: schedule.windows.map((window) =>
          window.id === windowId
            ? { dayOfWeek: window.dayOfWeek, openMinute, closeMinute }
            : { dayOfWeek: window.dayOfWeek, openMinute: window.openMinute, closeMinute: window.closeMinute },
        ),
      });
      await load();
      toast.success('Hours updated', 'Markets on this calendar follow it immediately');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (!rows) return <Loading />;

  return (
    <>
      <PageHead title="Trading sessions" subtitle="Opening hours and holidays per exchange calendar" />

      <div className="space-y-3">
        {rows.map((schedule) => (
          <div key={schedule.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <button
                onClick={() => setOpenId(openId === schedule.id ? null : schedule.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {schedule.name}
                  <StatusPill status={schedule.state.isOpen ? 'open' : 'closed'} />
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">{schedule.hours}</span>
                <span className="block text-[11px] text-slate-500">
                  {schedule.markets} markets · {schedule.holidays.length} holidays
                  {!schedule.state.isOpen && schedule.state.nextOpen
                    ? ` · opens ${dateTime(schedule.state.nextOpen)}`
                    : schedule.state.nextClose
                      ? ` · closes ${dateTime(schedule.state.nextClose)}`
                      : ''}
                </span>
              </button>
              <button
                onClick={() => setOpenId(openId === schedule.id ? null : schedule.id)}
                className="btn-ghost !px-2.5 !py-2 text-xs"
                aria-label="Toggle schedule detail"
              >
                {openId === schedule.id ? '▴' : '▾'}
              </button>
            </div>

            {openId === schedule.id && (
              <div className="grid gap-4 border-t border-ink-600 p-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Weekly hours (UTC)
                  </h3>
                  <ul className="space-y-1">
                    {schedule.windows.map((window) => (
                      <li key={window.id} className="flex items-center gap-2 text-xs">
                        <span className="w-20 text-slate-400">{DAY_NAMES[window.dayOfWeek].slice(0, 3)}</span>
                        <span className="tabular flex-1">
                          {asTime(window.openMinute)}–{asTime(window.closeMinute)}
                          {window.closeMinute > 1440 && <span className="ml-1 text-slate-500">(+1d)</span>}
                        </span>
                        <button
                          onClick={() => void editWindow(schedule, window.id)}
                          className="btn-ghost !px-2 !py-1 text-[11px]"
                        >
                          Edit
                        </button>
                      </li>
                    ))}
                    {schedule.windows.length === 0 && <li className="text-xs text-slate-500">Open 24/7</li>}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Holidays
                  </h3>
                  <ul className="mb-3 space-y-1">
                    {schedule.holidays.map((entry) => (
                      <li key={entry.id} className="flex items-center gap-2 text-xs">
                        <span className="tabular w-24 text-slate-400">{entry.date}</span>
                        <span className="flex-1 truncate">{entry.name}</span>
                        <button
                          onClick={() => void removeHoliday(schedule, entry.id)}
                          className="btn-ghost !px-2 !py-1 text-[11px] !text-down"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {schedule.holidays.length === 0 && <li className="text-xs text-slate-500">None</li>}
                  </ul>

                  <div className="flex flex-wrap gap-2">
                    <input
                      type="date"
                      value={holiday.date}
                      onChange={(event) => setHoliday({ ...holiday, date: event.target.value })}
                      className="field !w-40 !py-2 !text-xs"
                      aria-label="Holiday date"
                    />
                    <input
                      value={holiday.name}
                      onChange={(event) => setHoliday({ ...holiday, name: event.target.value })}
                      placeholder="Holiday name"
                      className="field !w-44 !py-2 !text-xs"
                      aria-label="Holiday name"
                    />
                    <button
                      onClick={() => void addHoliday(schedule)}
                      disabled={!holiday.date || holiday.name.length < 2}
                      className="btn-primary !px-3 !py-2 text-xs"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

interface AuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
  actor?: { email: string };
}

const AUDIT_FILTERS = [
  {
    key: 'targetType',
    label: 'Target',
    type: 'enum' as const,
    options: [
      { value: 'user', label: 'user' },
      { value: 'User', label: 'User' },
      { value: 'kyc', label: 'kyc' },
      { value: 'deposit', label: 'deposit' },
      { value: 'withdrawal', label: 'withdrawal' },
      { value: 'tournament', label: 'tournament' },
      { value: 'promo', label: 'promo' },
      { value: 'asset', label: 'asset' },
      { value: 'schedule', label: 'schedule' },
      { value: 'setting', label: 'setting' },
      { value: 'payoutRule', label: 'payoutRule' },
      { value: 'BonusOffer', label: 'BonusOffer' },
      { value: 'EmailMessage', label: 'EmailMessage' },
      { value: 'MarketplaceItem', label: 'MarketplaceItem' },
      { value: 'PaymentMethod', label: 'PaymentMethod' },
    ],
  },
  { key: 'createdAt', label: 'When', type: 'dateRange' as const },
];

export function AdminAudit() {
  const columns: DataTableColumn<AuditLog>[] = [
    {
      key: 'action',
      label: 'Action',
      sortable: true,
      render: (log) => <span className="font-mono text-[11px] text-accent">{log.action}</span>,
    },
    {
      key: 'target',
      label: 'Target',
      render: (log) => (
        <span className="text-[11px] text-slate-400">
          {log.targetType}
          <span className="block font-mono text-[10px] text-slate-500">{log.targetId?.slice(0, 12)}</span>
        </span>
      ),
    },
    {
      key: 'detail',
      label: 'Detail',
      render: (log) => <span className="text-[11px] text-slate-400">{log.detail ?? '—'}</span>,
    },
    {
      key: 'actor',
      label: 'Administrator',
      render: (log) => <span className="text-[11px] text-slate-500">{log.actor?.email ?? 'system'}</span>,
    },
    {
      key: 'createdAt',
      label: 'When',
      sortable: true,
      align: 'right',
      render: (log) => <span className="text-[11px] text-slate-500">{dateTime(log.createdAt)}</span>,
    },
  ];

  return (
    <DataTable<AuditLog>
      title="Audit log"
      columns={columns}
      filters={AUDIT_FILTERS}
      searchPlaceholder="Search action, target or admin"
      rowKey={(log) => log.id}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ logs: AuditLog[]; total: number; pageCount: number }>(
          `/admin/audit?${params.toString()}`,
        );
        return { items: data.logs, total: data.total, pageCount: data.pageCount };
      }}
      exportPath={(params) => `/admin/audit/export?${params.toString()}`}
    />
  );
}
