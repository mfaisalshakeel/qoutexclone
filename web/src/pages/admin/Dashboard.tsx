import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { Empty, Loading, PageHead, StatCard, StatusPill, Table, Td } from '../../components/admin/ui';
import type { Deposit, Withdrawal } from '../../lib/types';
import { Skeleton, StatSkeletons } from '../../components/Skeleton';

interface PeriodStats {
  registrations: number;
  firstTimeDepositors: number;
  depositVolume: number;
  withdrawalVolume: number;
  netFlow: number;
  realVolume: number;
  housePnl: number;
  bonusPaid: number;
  activeTraders: number;
  averageStake: number;
  winRatePct: number | null;
}

interface Overview {
  period: { from: string; to: string };
  current: PeriodStats;
  previous: PeriodStats;
  snapshot: {
    users: number;
    openTrades: number;
    pendingDeposits: number;
    pendingWithdrawals: number;
    pendingKyc: number;
    openTickets: number;
    liveTournaments: number;
  };
  feedProvider: string;
  providers: { name: string; status: string; symbols: number; lastTickAt: number | null; detail?: string }[];
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Every preset resolves to an explicit [from, to) the server just aggregates over. */
function presetRange(preset: Preset, custom: { from: string; to: string }): { from: Date; to: Date } {
  const now = new Date();
  const today0 = startOfUtcDay(now);
  switch (preset) {
    case 'today':
      return { from: today0, to: now };
    case 'yesterday':
      return { from: new Date(today0.getTime() - 86_400_000), to: today0 };
    case '7d':
      return { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
    case '30d':
      return { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
    case 'month':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
    case 'custom': {
      if (!custom.from || !custom.to) return { from: today0, to: now };
      const to = new Date(`${custom.to}T23:59:59.999Z`);
      return { from: new Date(`${custom.from}T00:00:00.000Z`), to: to > now ? now : to };
    }
  }
}

export function AdminDashboard() {
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);

  const range = useMemo(() => presetRange(preset, custom), [preset, custom]);

  useEffect(() => {
    const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    setOverview(null);
    void api.get<Overview>(`/admin/overview?${params.toString()}`).then(setOverview).catch(() => undefined);
  }, [range]);

  useEffect(() => {
    void Promise.all([
      api
        .get<{ withdrawals: Withdrawal[] }>('/admin/withdrawals')
        .then((d) => setWithdrawals(d.withdrawals.slice(0, 6))),
      api.get<{ deposits: Deposit[] }>('/admin/deposits').then((d) => setDeposits(d.deposits.slice(0, 6))),
    ]).catch(() => undefined);
  }, []);

  if (!overview) {
    return (
      <>
        <div className="mb-5 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-2.5 w-64 max-w-full" />
        </div>
        <StatSkeletons count={13} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" />
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 !rounded-xl" />
          ))}
        </div>
        <Loading rows={4} />
      </>
    );
  }

  const { current, previous, snapshot } = overview;

  return (
    <>
      <PageHead
        title="Dashboard"
        subtitle={`Market data: ${overview.feedProvider} · ${snapshot.openTrades} positions open right now`}
        action={<PeriodPicker preset={preset} onChange={setPreset} custom={custom} onCustom={setCustom} />}
      />

      <h2 className="mb-2 text-sm font-semibold">This period</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="New registrations"
          value={String(current.registrations)}
          delta={<Delta current={current.registrations} previous={previous.registrations} />}
        />
        <StatCard
          label="First-time depositors"
          value={String(current.firstTimeDepositors)}
          delta={<Delta current={current.firstTimeDepositors} previous={previous.firstTimeDepositors} />}
        />
        <StatCard
          label="Deposit volume"
          value={money(current.depositVolume)}
          tone="up"
          delta={<Delta current={current.depositVolume} previous={previous.depositVolume} />}
        />
        <StatCard
          label="Withdrawal volume"
          value={money(current.withdrawalVolume)}
          delta={<Delta current={current.withdrawalVolume} previous={previous.withdrawalVolume} />}
        />
        <StatCard
          label="Net deposits"
          value={money(current.netFlow, { sign: true })}
          tone={current.netFlow >= 0 ? 'up' : 'down'}
          hint="deposits minus withdrawals"
          delta={<Delta current={current.netFlow} previous={previous.netFlow} />}
        />
        <StatCard
          label="House P&L"
          value={money(current.housePnl, { sign: true })}
          tone={current.housePnl >= 0 ? 'up' : 'down'}
          hint="live accounts only"
          delta={<Delta current={current.housePnl} previous={previous.housePnl} />}
        />
        <StatCard
          label="Trading volume"
          value={money(current.realVolume)}
          hint="live stakes"
          delta={<Delta current={current.realVolume} previous={previous.realVolume} />}
        />
        <StatCard
          label="Bonuses paid"
          value={money(current.bonusPaid)}
          delta={<Delta current={current.bonusPaid} previous={previous.bonusPaid} />}
        />
        <StatCard
          label="Active traders"
          value={String(current.activeTraders)}
          hint="placed a live trade"
          delta={<Delta current={current.activeTraders} previous={previous.activeTraders} />}
        />
        <StatCard
          label="Average stake"
          value={money(current.averageStake)}
          delta={<Delta current={current.averageStake} previous={previous.averageStake} />}
        />
        <StatCard
          label="Win rate"
          value={current.winRatePct === null ? '—' : `${current.winRatePct}%`}
          hint="platform-wide, live accounts"
          delta={
            current.winRatePct !== null && previous.winRatePct !== null ? (
              <Delta current={current.winRatePct} previous={previous.winRatePct} />
            ) : undefined
          }
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Right now</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total traders" value={String(snapshot.users)} hint="all time" />
        <StatCard label="Live tournaments" value={String(snapshot.liveTournaments)} />
        <StatCard
          label="Needs attention"
          value={String(snapshot.pendingWithdrawals + snapshot.pendingKyc + snapshot.openTickets)}
          tone={
            snapshot.pendingWithdrawals + snapshot.pendingKyc + snapshot.openTickets > 0 ? 'warn' : undefined
          }
          hint="payouts, verifications, messages"
        />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Queue label="Withdrawals to review" count={snapshot.pendingWithdrawals} to="/admin/withdrawals" />
        <Queue label="Verifications waiting" count={snapshot.pendingKyc} to="/admin/kyc" />
        <Queue label="Unread support" count={snapshot.openTickets} to="/admin/support" />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Market data</h2>
      <div className="card mb-4 divide-y divide-ink-700">
        {(overview.providers ?? []).length === 0 && (
          <p className="p-4 text-xs text-slate-500">
            Every market is priced by the broker engine. Set FEED_PROVIDER to enable live data.
          </p>
        )}
        {(overview.providers ?? []).map((provider) => (
          <div key={provider.name} className="flex flex-wrap items-center gap-3 p-3.5">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{provider.name}</span>
              <span className="block text-[11px] text-slate-500">
                {provider.symbols} markets
                {provider.detail ? ` · ${provider.detail}` : ''}
                {provider.lastTickAt ? ` · last tick ${dateTime(new Date(provider.lastTickAt))}` : ''}
              </span>
            </span>
            <StatusPill status={provider.status} />
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Latest withdrawals</h2>
      {withdrawals.length === 0 ? (
        <Empty text="No withdrawals yet" />
      ) : (
        <Table head={['Trader', 'Amount', 'Destination', 'When', 'Status']}>
          {withdrawals.map((w) => (
            <tr key={w.id}>
              <Td className="text-xs">{w.user?.email ?? '—'}</Td>
              <Td className="tabular text-xs font-semibold">{money(w.amount)}</Td>
              <Td className="font-mono text-[11px] text-slate-400">
                {w.cryptoAmount} {w.currency}
                <span className="block text-slate-500">{w.networkLabel}</span>
              </Td>
              <Td className="text-[11px] text-slate-500">{dateTime(w.createdAt)}</Td>
              <Td className="text-right">
                <StatusPill status={w.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Latest deposits</h2>
      {deposits.length === 0 ? (
        <Empty text="No deposits yet" />
      ) : (
        <Table head={['Trader', 'Amount', 'Network', 'When', 'Status']}>
          {deposits.map((d) => (
            <tr key={d.id}>
              <Td className="text-xs">{d.user?.email ?? '—'}</Td>
              <Td className="tabular text-xs font-semibold">
                {d.creditedAmount > 0 ? money(d.creditedAmount) : `${d.cryptoAmount} ${d.currency}`}
                {d.bonusAmount > 0 && <span className="ml-1 text-up">+{money(d.bonusAmount)}</span>}
              </Td>
              <Td className="text-[11px] text-slate-400">{d.networkLabel}</Td>
              <Td className="text-[11px] text-slate-500">{dateTime(d.createdAt)}</Td>
              <Td className="text-right">
                <StatusPill status={d.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

/** A comparison against the immediately preceding period of the same length. */
function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) {
    return <span className="text-[11px] font-semibold text-up">▲ new</span>;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.round(pct) === 0) return <span className="text-[11px] font-semibold text-slate-500">flat</span>;
  const up = pct > 0;
  return (
    <span className={`text-[11px] font-semibold ${up ? 'text-up' : 'text-down'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function PeriodPicker({
  preset,
  onChange,
  custom,
  onCustom,
}: {
  preset: Preset;
  onChange: (p: Preset) => void;
  custom: { from: string; to: string };
  onCustom: (c: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex gap-1 rounded-lg border border-ink-600 bg-ink-800 p-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition ${
              preset === p.key ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="From"
            value={custom.from}
            max={custom.to || undefined}
            onChange={(e) => onCustom({ ...custom, from: e.target.value })}
            className="field !w-auto !py-1.5 !text-xs"
          />
          <span className="text-slate-500">–</span>
          <input
            type="date"
            aria-label="To"
            value={custom.to}
            min={custom.from || undefined}
            onChange={(e) => onCustom({ ...custom, to: e.target.value })}
            className="field !w-auto !py-1.5 !text-xs"
          />
        </div>
      )}
    </div>
  );
}

function Queue({ label, count, to }: { label: string; count: number; to: string }) {
  return (
    <Link
      to={to}
      className={`card flex items-center gap-3 p-4 transition hover:border-ink-500 ${
        count > 0 ? 'border-accent/40' : ''
      }`}
    >
      <span className={`tabular text-2xl font-bold ${count > 0 ? 'text-accent' : 'text-slate-500'}`}>
        {count}
      </span>
      <span className="text-xs text-slate-400">{label}</span>
      <span className="ml-auto text-slate-500">›</span>
    </Link>
  );
}
