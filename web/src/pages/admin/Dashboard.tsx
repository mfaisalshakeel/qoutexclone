import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { Empty, Loading, PageHead, StatCard, StatusPill, Table, Td } from '../../components/admin/ui';
import type { Deposit, Withdrawal } from '../../lib/types';
import { Skeleton, StatSkeletons } from '../../components/Skeleton';

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
  openTickets: number;
  liveTournaments: number;
  feedProvider: string;
}

export function AdminDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);

  useEffect(() => {
    void Promise.all([
      api.get<Overview>('/admin/overview').then(setOverview),
      api.get<{ withdrawals: Withdrawal[] }>('/admin/withdrawals').then((d) => setWithdrawals(d.withdrawals.slice(0, 6))),
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
        <StatSkeletons count={8} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" />
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 !rounded-xl" />
          ))}
        </div>
        <Loading rows={4} />
      </>
    );
  }

  const netFlow = overview.depositVolume - overview.withdrawalVolume;

  return (
    <>
      <PageHead
        title="Dashboard"
        subtitle={`Market data: ${overview.feedProvider} · ${overview.openTrades} positions open right now`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Traders" value={String(overview.users)} />
        <StatCard label="Deposit volume" value={money(overview.depositVolume)} tone="up" />
        <StatCard label="Withdrawal volume" value={money(overview.withdrawalVolume)} />
        <StatCard
          label="Net flow"
          value={money(netFlow, { sign: true })}
          tone={netFlow >= 0 ? 'up' : 'down'}
          hint="deposits minus payouts"
        />
        <StatCard
          label="House P&L"
          value={money(overview.housePnl, { sign: true })}
          tone={overview.housePnl >= 0 ? 'up' : 'down'}
          hint={`on ${money(overview.realVolume)} live volume`}
        />
        <StatCard label="Bonuses paid" value={money(overview.bonusPaid)} />
        <StatCard label="Live tournaments" value={String(overview.liveTournaments)} />
        <StatCard
          label="Needs attention"
          value={String(overview.pendingWithdrawals + overview.pendingKyc + overview.openTickets)}
          tone={overview.pendingWithdrawals + overview.pendingKyc + overview.openTickets > 0 ? 'warn' : undefined}
          hint="payouts, verifications, messages"
        />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Queue label="Withdrawals to review" count={overview.pendingWithdrawals} to="/admin/withdrawals" />
        <Queue label="Verifications waiting" count={overview.pendingKyc} to="/admin/kyc" />
        <Queue label="Unread support" count={overview.openTickets} to="/admin/support" />
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

function Queue({ label, count, to }: { label: string; count: number; to: string }) {
  return (
    <Link
      to={to}
      className={`card flex items-center gap-3 p-4 transition hover:border-ink-500 ${
        count > 0 ? 'border-accent/40' : ''
      }`}
    >
      <span className={`tabular text-2xl font-bold ${count > 0 ? 'text-accent' : 'text-slate-500'}`}>{count}</span>
      <span className="text-xs text-slate-400">{label}</span>
      <span className="ml-auto text-slate-500">›</span>
    </Link>
  );
}
