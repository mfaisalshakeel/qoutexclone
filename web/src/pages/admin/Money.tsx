import { useCallback, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime, money, shortHash } from '../../lib/format';
import { toast } from '../../store/toast';
import { StatusPill } from '../../components/admin/ui';
import { DataTable, type DataTableColumn } from '../../components/admin/DataTable';
import type { Deposit, Withdrawal } from '../../lib/types';

/** A withdrawal as the back office sees it, with the trader's status level. */
interface AdminWithdrawal extends Withdrawal {
  level?: { id: string; name: string; priority: number };
}

const WITHDRAWAL_FILTERS = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum' as const,
    options: [
      { value: 'PENDING', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'PROCESSING', label: 'Processing' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'REJECTED', label: 'Rejected' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
  {
    key: 'currency',
    label: 'Currency',
    type: 'enum' as const,
    options: [
      { value: 'BTC', label: 'BTC' },
      { value: 'ETH', label: 'ETH' },
      { value: 'USDT', label: 'USDT' },
      { value: 'USD', label: 'USD' },
    ],
  },
  { key: 'createdAt', label: 'Requested', type: 'dateRange' as const },
];

export function AdminWithdrawals() {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const [pending, setPending] = useState<{ count: number; amount: number } | null>(null);
  // one free-text note per row, kept until the row is acted on or reloaded —
  // a reviewer types it once and it applies to whichever button they press
  const [notes, setNotes] = useState<Record<string, string>>({});

  const act = async (id: string, action: 'approve' | 'reject') => {
    const note = notes[id]?.trim();
    // rejecting without a reason leaves the trader guessing; approving does not
    if (action === 'reject' && !note) {
      toast.error('Add a note first', 'The trader sees this when a withdrawal is rejected');
      return;
    }
    try {
      await api.post(`/admin/withdrawals/${id}/${action}`, {
        note: note || (action === 'approve' ? 'Approved from back office' : undefined),
      });
      setNotes((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      reload();
      toast.success(action === 'approve' ? 'Payout sent' : 'Withdrawal rejected, funds returned');
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const columns: DataTableColumn<AdminWithdrawal>[] = [
    {
      key: 'user',
      label: 'Trader',
      render: (w) => (
        <>
          <span className="block text-xs font-semibold">{w.user?.name ?? '—'}</span>
          <span className="block text-[11px] text-slate-500">{w.user?.email}</span>
          <span className="block text-[11px] text-slate-500">
            deposited {money(w.user?.totalDeposited ?? 0)}
          </span>
          {/* the pending queue is ordered by this, so the reason a row sits
              where it does is on the row */}
          {w.level && w.level.priority > 0 && (
            <span className="chip mt-1 bg-accent/15 text-accent">{w.level.name}</span>
          )}
        </>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (w) => (
        <>
          <span className="tabular block text-xs font-semibold">{money(w.amount)}</span>
          <span className="tabular block text-[11px] text-slate-500">fee {money(w.fee)}</span>
        </>
      ),
    },
    {
      key: 'address',
      label: 'Destination',
      render: (w) => (
        <>
          <span className="block text-xs">
            {w.cryptoAmount} {w.currency}
          </span>
          <span className="block font-mono text-[10px] text-slate-500">{w.address}</span>
          <span className="block text-[10px] text-slate-500">{w.networkLabel}</span>
          {w.txHash && <span className="block font-mono text-[10px] text-accent">{shortHash(w.txHash)}</span>}
        </>
      ),
    },
    {
      key: 'createdAt',
      label: 'Requested',
      sortable: true,
      render: (w) => <span className="text-[11px] text-slate-500">{dateTime(w.createdAt)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (w) => (
        <>
          <StatusPill status={w.status} />
          {w.adminNote && <span className="mt-1 block text-[10px] text-slate-500">{w.adminNote}</span>}
        </>
      ),
    },
    {
      key: 'actions',
      label: 'Action',
      align: 'right',
      render: (w) =>
        w.status === 'PENDING' ? (
          <div className="flex flex-col items-end gap-1.5">
            <input
              aria-label={`Note for ${w.user?.name ?? 'this withdrawal'}`}
              value={notes[w.id] ?? ''}
              onChange={(e) => setNotes((current) => ({ ...current, [w.id]: e.target.value }))}
              placeholder="Note (required to reject)"
              className="field !py-1 !text-[11px]"
            />
            <span className="flex justify-end gap-2">
              <button onClick={() => void act(w.id, 'approve')} className="btn-up !px-3 !py-1.5 text-xs">
                Approve
              </button>
              <button
                onClick={() => void act(w.id, 'reject')}
                className="btn-ghost !px-3 !py-1.5 text-xs !text-down"
              >
                Reject
              </button>
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500">{w.processedAt ? dateTime(w.processedAt) : '—'}</span>
        ),
    },
  ];

  return (
    <>
      {/* DataTable below owns the page's one heading; this is a lead-in, not
          a second h1. Sourced from the endpoint's own pendingSummary rather
          than the loaded page, so it stays the true total under search,
          filters and pagination, not just what is currently on screen. */}
      {pending && (
        <p className="mb-4 text-xs text-slate-500">
          {pending.count} awaiting review · {money(pending.amount)} held
        </p>
      )}
      <DataTable<AdminWithdrawal>
        title="Withdrawals"
        columns={columns}
        filters={WITHDRAWAL_FILTERS}
        searchPlaceholder="Search trader, address or tx hash"
        rowKey={(w) => w.id}
        reloadToken={reloadToken}
        fetchPage={async (state) => {
          const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
          if (state.sort) params.set('sort', state.sort);
          if (state.search) params.set('search', state.search);
          for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
          const data = await api.get<{
            withdrawals: AdminWithdrawal[];
            total: number;
            pageCount: number;
            pendingSummary: { count: number; amount: number };
          }>(`/admin/withdrawals?${params.toString()}`);
          setPending(data.pendingSummary);
          return { items: data.withdrawals, total: data.total, pageCount: data.pageCount };
        }}
      />
    </>
  );
}

const DEPOSIT_FILTERS = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum' as const,
    options: [
      { value: 'AWAITING_PAYMENT', label: 'Awaiting payment' },
      { value: 'CONFIRMING', label: 'Confirming' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'REJECTED', label: 'Rejected' },
      { value: 'EXPIRED', label: 'Expired' },
    ],
  },
  {
    key: 'currency',
    label: 'Currency',
    type: 'enum' as const,
    options: [
      { value: 'BTC', label: 'BTC' },
      { value: 'ETH', label: 'ETH' },
      { value: 'USDT', label: 'USDT' },
      { value: 'USD', label: 'USD' },
    ],
  },
  { key: 'createdAt', label: 'Created', type: 'dateRange' as const },
];

export function AdminDeposits() {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const act = async (id: string, action: 'confirm' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Why is this deposit being rejected?') : undefined;
    if (action === 'reject' && !note) return;
    try {
      await api.post(`/admin/deposits/${id}/${action}`, note ? { note } : {});
      reload();
      toast.success(action === 'confirm' ? 'Deposit credited' : 'Deposit rejected');
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const columns: DataTableColumn<Deposit>[] = [
    {
      key: 'user',
      label: 'Trader',
      render: (d) => (
        <>
          <span className="block text-xs font-semibold">{d.user?.name ?? '—'}</span>
          <span className="block text-[11px] text-slate-500">{d.user?.email}</span>
        </>
      ),
    },
    {
      key: 'creditedAmount',
      label: 'Amount',
      sortable: true,
      render: (d) => (
        <>
          <span className="block text-xs font-semibold">
            {d.cryptoAmount} {d.currency}
          </span>
          {d.creditedAmount > 0 && (
            <span className="tabular block text-[11px] text-up">credited {money(d.creditedAmount)}</span>
          )}
          {d.bonusAmount > 0 && (
            <span className="tabular block text-[11px] text-up">bonus {money(d.bonusAmount)}</span>
          )}
          {d.promoCode && <span className="block font-mono text-[10px] text-slate-500">{d.promoCode}</span>}
        </>
      ),
    },
    {
      key: 'address',
      label: 'Address',
      render: (d) => (
        <>
          <span className="block font-mono text-[10px] text-slate-500">{d.address}</span>
          <span className="block text-[10px] text-slate-500">
            {d.networkLabel} · {d.confirmations}/{d.requiredConf} conf
          </span>
          {d.txHash && <span className="block font-mono text-[10px] text-accent">{shortHash(d.txHash)}</span>}
        </>
      ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      sortable: true,
      render: (d) => <span className="text-[11px] text-slate-500">{dateTime(d.createdAt)}</span>,
    },
    { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
    {
      key: 'actions',
      label: 'Action',
      align: 'right',
      render: (d) =>
        d.status === 'AWAITING_PAYMENT' || d.status === 'CONFIRMING' ? (
          <span className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                void act(d.id, 'confirm');
              }}
              className="btn-up !px-3 !py-1.5 text-xs"
            >
              Credit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void act(d.id, 'reject');
              }}
              className="btn-ghost !px-3 !py-1.5 text-xs !text-down"
            >
              Reject
            </button>
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">{d.confirmedAt ? dateTime(d.confirmedAt) : '—'}</span>
        ),
    },
  ];

  return (
    <DataTable<Deposit>
      title="Deposits"
      columns={columns}
      filters={DEPOSIT_FILTERS}
      searchPlaceholder="Search trader, address or tx hash"
      rowKey={(d) => d.id}
      reloadToken={reloadToken}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ deposits: Deposit[]; total: number; pageCount: number }>(
          `/admin/deposits?${params.toString()}`,
        );
        return { items: data.deposits, total: data.total, pageCount: data.pageCount };
      }}
      exportPath={(params) => `/admin/deposits/export?${params.toString()}`}
    />
  );
}
