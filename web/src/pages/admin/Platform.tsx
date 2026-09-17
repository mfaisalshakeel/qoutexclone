import { Fragment, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';
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
    const { leaderboard } = await api.get<{ leaderboard: LeaderboardRow[] }>(
      `/admin/tournaments/${id}/leaderboard`,
    );
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
                      <button
                        onClick={() => void act(t.id, 'start')}
                        className="btn-primary !px-3 !py-1.5 text-xs"
                      >
                        Start
                      </button>
                    )}
                    {t.status === 'RUNNING' && (
                      <button
                        onClick={() => void act(t.id, 'finish')}
                        className="btn-up !px-3 !py-1.5 text-xs"
                      >
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
                            <span
                              className={`tabular w-20 text-right ${row.profit >= 0 ? 'text-up' : 'text-down'}`}
                            >
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
      <PageHead
        title="Promo codes"
        subtitle="Deposit bonuses credited automatically when a payment confirms"
      />

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
              <Td className="text-[11px] text-slate-500">
                {promo.expiresAt ? dateTime(promo.expiresAt) : 'no expiry'}
              </Td>
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
  const [rows, setRows] = useState<AdminAsset[] | null>(null);
  const [assetClass, setAssetClass] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (assetClass !== 'ALL') params.set('assetClass', assetClass);
      if (search) params.set('search', search);
      const { assets } = await api.get<{ assets: AdminAsset[] }>(`/admin/assets?${params}`);
      setRows(assets);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load markets');
    }
  }, [assetClass, search]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(id);
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

  const CLASSES = ['ALL', 'CURRENCY', 'CRYPTO', 'COMMODITY', 'STOCK', 'INDEX'];

  return (
    <>
      <PageHead
        title="Markets"
        subtitle={rows ? `${rows.length} markets · payouts, stake limits and sessions` : undefined}
        action={
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search symbol or name"
            className="field !w-56 !py-2 !text-xs"
          />
        }
      />

      <div className="mb-3 flex gap-1 overflow-x-auto rounded-lg border border-ink-600 bg-ink-800 p-1">
        {CLASSES.map((option) => (
          <button
            key={option}
            onClick={() => setAssetClass(option)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize transition ${
              assetClass === option ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {option.toLowerCase()}
          </button>
        ))}
      </div>

      {error ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-300">{error}</p>
          <button onClick={() => void load()} className="btn-ghost mt-3 text-xs">
            Try again
          </button>
        </div>
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="No markets match" />
      ) : (
        <Table head={['Market', 'Price', 'Payout', 'Stake range', 'Session', 'Actions']}>
          {rows.map((asset) => (
            <tr key={asset.id}>
              <Td>
                <span className="block text-xs font-semibold">
                  {asset.pair}
                  {asset.isOtc && <span className="chip ml-2 bg-accent-soft text-accent">OTC</span>}
                </span>
                <span className="block text-[11px] text-slate-500">
                  {asset.symbol} · {asset.assetClass.toLowerCase()}
                </span>
              </Td>
              <Td className="tabular text-xs">{asset.price?.toLocaleString() ?? '—'}</Td>
              <Td className="tabular text-xs font-semibold text-up">{asset.payoutPct}%</Td>
              <Td className="tabular text-[11px] text-slate-400">
                {money(asset.minStake)} – {money(asset.maxStake)}
              </Td>
              <Td>
                <StatusPill status={asset.isOpen ? 'open' : 'closed'} />
                <span className="mt-1 block text-[10px] text-slate-500">
                  {asset.schedule ? asset.schedule.hours : '24/7'}
                </span>
                {!asset.isOpen && asset.nextOpen && (
                  <span className="block text-[10px] text-slate-500">opens {dateTime(asset.nextOpen)}</span>
                )}
              </Td>
              <Td className="text-right">
                <span className="flex justify-end gap-2">
                  <button
                    onClick={() => {
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
                    onClick={() =>
                      void patch(
                        asset.id,
                        { enabled: !asset.enabled },
                        asset.enabled ? 'Market delisted' : 'Market listed',
                      )
                    }
                    className="btn-ghost !px-3 !py-1.5 text-xs"
                  >
                    {asset.enabled ? 'Delist' : 'List'}
                  </button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
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

export function AdminAudit() {
  const [logs, setLogs] = useState<
    | {
        id: string;
        action: string;
        targetType: string | null;
        targetId: string | null;
        detail: string | null;
        createdAt: string;
        actor?: { email: string };
      }[]
    | null
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
                <span className="block font-mono text-[10px] text-slate-500">
                  {log.targetId?.slice(0, 12)}
                </span>
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
