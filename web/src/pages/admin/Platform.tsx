import { Fragment, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';
import type { Asset, LeaderboardRow } from '../../lib/types';

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

export function AdminTournaments() {
  const [rows, setRows] = useState<AdminTournament[] | null>(null);
  const [board, setBoard] = useState<{ id: string; rows: LeaderboardRow[] } | null>(null);
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

  const load = useCallback(async () => {
    const { tournaments } = await api.get<{ tournaments: AdminTournament[] }>('/admin/tournaments');
    setRows(tournaments);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
      toast.success('Tournament created');
    } catch (err) {
      toast.error('Could not create', err instanceof ApiError ? err.message : undefined);
    }
  };

  const act = async (id: string, action: 'start' | 'finish') => {
    if (action === 'finish' && !window.confirm('Finish now and pay out the prize pool?')) return;
    try {
      await api.post(`/admin/tournaments/${id}/${action}`);
      await load();
      toast.success(action === 'start' ? 'Tournament started' : 'Prizes paid out');
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const showBoard = async (id: string) => {
    if (board?.id === id) return setBoard(null);
    const { leaderboard } = await api.get<{ leaderboard: LeaderboardRow[] }>(`/admin/tournaments/${id}/leaderboard`);
    setBoard({ id, rows: leaderboard });
  };

  return (
    <>
      <PageHead title="Tournaments" subtitle="Chip-based contests that pay real prizes from the pool" />

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

      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="No tournaments yet" />
      ) : (
        <Table head={['Tournament', 'Window', 'Entry', 'Pool', 'Entrants', 'Actions']}>
          {rows.map((t) => (
            <Fragment key={t.id}>
              <tr>
                <Td>
                  <span className="block text-xs font-semibold">{t.name}</span>
                  {t.description && <span className="block text-[11px] text-slate-500">{t.description}</span>}
                  <span className="mt-1 block">
                    <StatusPill status={t.status} />
                  </span>
                </Td>
                <Td className="text-[11px] text-slate-500">
                  <span className="block">{dateTime(t.startsAt)}</span>
                  <span className="block">→ {dateTime(t.endsAt)}</span>
                </Td>
                <Td className="tabular text-xs">
                  {t.entryFee > 0 ? money(t.entryFee) : 'free'}
                  <span className="block text-[10px] text-slate-500">{money(t.startingBalance)} chips</span>
                </Td>
                <Td className="tabular text-xs font-semibold text-up">
                  {money(t.prizePool)}
                  <span className="block font-mono text-[10px] text-slate-500">{t.prizeSplit}</span>
                </Td>
                <Td className="tabular text-xs">{t.entrants}</Td>
                <Td className="text-right">
                  <span className="flex flex-wrap justify-end gap-2">
                    <button onClick={() => void showBoard(t.id)} className="btn-ghost !px-3 !py-1.5 text-xs">
                      {board?.id === t.id ? 'Hide' : 'Leaderboard'}
                    </button>
                    {t.status === 'SCHEDULED' && (
                      <button onClick={() => void act(t.id, 'start')} className="btn-primary !px-3 !py-1.5 text-xs">
                        Start
                      </button>
                    )}
                    {t.status === 'RUNNING' && (
                      <button onClick={() => void act(t.id, 'finish')} className="btn-up !px-3 !py-1.5 text-xs">
                        Finish & pay
                      </button>
                    )}
                  </span>
                </Td>
              </tr>
              {board?.id === t.id && (
                <tr>
                  <td colSpan={6} className="bg-ink-900/40 px-4 py-3">
                    {board.rows.length === 0 ? (
                      <p className="text-center text-xs text-slate-500">No entrants</p>
                    ) : (
                      <ol className="space-y-1">
                        {board.rows.map((row) => (
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
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </Table>
      )}
    </>
  );
}

export function AdminPromos() {
  const [rows, setRows] = useState<Promo[] | null>(null);
  const [form, setForm] = useState({ code: '', value: 30, minDeposit: 0, maxBonus: 0, maxRedemptions: 0 });

  const load = useCallback(async () => {
    const { promos } = await api.get<{ promos: Promo[] }>('/admin/promos');
    setRows(promos);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
      toast.success('Promo code created');
    } catch (err) {
      toast.error('Could not create', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggle = async (promo: Promo) => {
    try {
      await api.patch(`/admin/promos/${promo.id}`, { enabled: !promo.enabled });
      await load();
    } catch (err) {
      toast.error('Update failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <>
      <PageHead title="Promo codes" subtitle="Deposit bonuses credited automatically when a payment confirms" />

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

      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="No promo codes yet" />
      ) : (
        <Table head={['Code', 'Offer', 'Redeemed', 'Created', 'State', 'Action']}>
          {rows.map((promo) => (
            <tr key={promo.id}>
              <Td className="font-mono text-xs font-semibold">{promo.code}</Td>
              <Td className="text-[11px] text-slate-400">{promo.description}</Td>
              <Td className="tabular text-xs">
                {promo.redemptions}
                {promo.maxRedemptions > 0 ? ` / ${promo.maxRedemptions}` : ''}
              </Td>
              <Td className="text-[11px] text-slate-500">{promo.expiresAt ? dateTime(promo.expiresAt) : 'no expiry'}</Td>
              <Td>
                <StatusPill status={promo.enabled ? 'active' : 'closed'} />
              </Td>
              <Td className="text-right">
                <button onClick={() => void toggle(promo)} className="btn-ghost !px-3 !py-1.5 text-xs">
                  {promo.enabled ? 'Disable' : 'Enable'}
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export function AdminAssets() {
  const [rows, setRows] = useState<(Asset & { enabled: boolean })[] | null>(null);

  const load = useCallback(async () => {
    const { assets } = await api.get<{ assets: (Asset & { enabled: boolean })[] }>('/admin/assets');
    setRows(assets);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (id: string, data: Record<string, unknown>, message: string) => {
    try {
      await api.patch(`/admin/assets/${id}`, data);
      await load();
      toast.success(message);
    } catch (err) {
      toast.error('Update failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (!rows) return <Loading />;

  return (
    <>
      <PageHead title="Markets" subtitle="Payouts and stake limits per instrument" />
      <Table head={['Market', 'Price', 'Payout', 'Stake range', 'State', 'Actions']}>
        {rows.map((asset) => (
          <tr key={asset.id}>
            <Td>
              <span className="block text-xs font-semibold">{asset.name}</span>
              <span className="block text-[11px] text-slate-500">{asset.symbol}</span>
            </Td>
            <Td className="tabular text-xs">{asset.price?.toLocaleString() ?? '—'}</Td>
            <Td className="tabular text-xs font-semibold text-up">{asset.payoutPct}%</Td>
            <Td className="tabular text-[11px] text-slate-400">
              {money(asset.minStake)} – {money(asset.maxStake)}
            </Td>
            <Td>
              <StatusPill status={asset.enabled ? 'active' : 'closed'} />
            </Td>
            <Td className="text-right">
              <span className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    const raw = window.prompt(`Payout % for ${asset.symbol}`, String(asset.payoutPct));
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
                  onClick={() => void patch(asset.id, { enabled: !asset.enabled }, asset.enabled ? 'Market closed' : 'Market opened')}
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                >
                  {asset.enabled ? 'Close' : 'Open'}
                </button>
              </span>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

export function AdminAudit() {
  const [logs, setLogs] = useState<
    { id: string; action: string; targetType: string | null; targetId: string | null; detail: string | null; createdAt: string; actor?: { email: string } }[] | null
  >(null);

  useEffect(() => {
    api
      .get<{ logs: NonNullable<typeof logs> }>('/admin/audit')
      .then(({ logs: list }) => setLogs(list))
      .catch(() => setLogs([]));
  }, []);

  if (!logs) return <Loading />;

  return (
    <>
      <PageHead title="Audit log" subtitle="Every administrative action, newest first" />
      {logs.length === 0 ? (
        <Empty text="Nothing logged yet" />
      ) : (
        <Table head={['Action', 'Target', 'Detail', 'Administrator', 'When']}>
          {logs.map((log) => (
            <tr key={log.id}>
              <Td className="font-mono text-[11px] text-accent">{log.action}</Td>
              <Td className="text-[11px] text-slate-400">
                {log.targetType}
                <span className="block font-mono text-[10px] text-slate-500">{log.targetId?.slice(0, 12)}</span>
              </Td>
              <Td className="text-[11px] text-slate-400">{log.detail ?? '—'}</Td>
              <Td className="text-[11px] text-slate-500">{log.actor?.email ?? 'system'}</Td>
              <Td className="text-right text-[11px] text-slate-500">{dateTime(log.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
