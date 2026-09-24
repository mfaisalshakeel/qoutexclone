import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { toast } from '../../store/toast';
import { useAuth } from '../../store/auth';
import { hasArea } from '../../lib/permissions';
import { StatusPill } from '../../components/admin/ui';
import { DataTable, type DataTableColumn } from '../../components/admin/DataTable';
import type { User } from '../../lib/types';

export interface KycSubmission {
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

async function adjustBalance(user: User, reload: () => void) {
  const raw = window.prompt(`Adjust ${user.email}'s live balance by (USD, negative to debit):`);
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount === 0) return;
  const note = window.prompt('Note for the ledger:') ?? undefined;
  try {
    await api.post(`/admin/users/${user.id}/adjust`, { accountType: 'REAL', amount, note });
    reload();
    toast.success(`Balance adjusted by ${money(Math.round(amount * 100), { sign: true })}`);
  } catch (err) {
    toast.error('Adjustment failed', err instanceof ApiError ? err.message : undefined);
  }
}

async function setStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED') {
  await api.post(`/admin/users/${userId}/status`, { status });
}

async function toggleStatus(user: User, reload: () => void) {
  const status = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  try {
    await setStatus(user.id, status);
    reload();
    toast.success(status === 'ACTIVE' ? 'Account reinstated' : 'Account suspended');
  } catch (err) {
    toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
  }
}

const USER_FILTERS = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum' as const,
    options: [
      { value: 'ACTIVE', label: 'Active' },
      { value: 'SUSPENDED', label: 'Suspended' },
    ],
  },
  {
    key: 'kycStatus',
    label: 'KYC',
    type: 'enum' as const,
    options: [
      { value: 'NOT_SUBMITTED', label: 'Not submitted' },
      { value: 'PENDING', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' },
    ],
  },
  { key: 'createdAt', label: 'Joined', type: 'dateRange' as const },
];

export function AdminUsers() {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const me = useAuth((s) => s.user);
  const canFinance = hasArea(me?.permissions, 'users.finance');
  const canManage = hasArea(me?.permissions, 'users.manage');

  const columns: DataTableColumn<User>[] = [
    {
      key: 'name',
      label: 'Trader',
      sortable: true,
      render: (user) => (
        <>
          <span className="block text-xs font-semibold">
            {user.name}
            {user.role === 'ADMIN' && <span className="ml-2 chip bg-accent-soft text-accent">admin</span>}
          </span>
          <span className="block text-[11px] text-slate-500">{user.email}</span>
          <span className="block text-[10px] text-slate-500">joined {dateTime(user.createdAt)}</span>
        </>
      ),
    },
    {
      key: 'realBalance',
      label: 'Live balance',
      render: (user) => (
        <>
          <span className="tabular block text-xs font-semibold">{money(user.realBalance)}</span>
          {user.lockedBalance > 0 && (
            <span className="tabular block text-[10px] text-amber-300">{money(user.lockedBalance)} held</span>
          )}
        </>
      ),
    },
    {
      key: 'demoBalance',
      label: 'Practice',
      render: (user) => <span className="tabular text-xs text-slate-400">{money(user.demoBalance)}</span>,
    },
    {
      key: 'totalDeposited',
      label: 'Deposited',
      sortable: true,
      align: 'right',
      render: (user) => <span className="tabular text-[11px] text-slate-400">{money(user.totalDeposited)}</span>,
    },
    {
      key: 'totalWithdrawn',
      label: 'Withdrawn',
      sortable: true,
      align: 'right',
      hiddenByDefault: true,
      render: (user) => <span className="tabular text-[11px] text-slate-400">{money(user.totalWithdrawn)}</span>,
    },
    {
      key: 'kycStatus',
      label: 'Verification',
      render: (user) => (
        <>
          <StatusPill status={user.kycStatus} />
          <span className="mt-1 block">
            <StatusPill status={user.status} />
          </span>
        </>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (user) => (
        <span className="flex justify-end gap-2">
          {canFinance && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void adjustBalance(user, reload);
              }}
              className="btn-ghost !px-3 !py-1.5 text-xs"
            >
              Adjust
            </button>
          )}
          {canManage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void toggleStatus(user, reload);
              }}
              className="btn-ghost !px-3 !py-1.5 text-xs"
            >
              {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <DataTable<User>
      title="Traders"
      columns={columns}
      filters={USER_FILTERS}
      searchPlaceholder="Search name or email"
      rowKey={(user) => user.id}
      reloadToken={reloadToken}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ users: User[]; total: number; pageCount: number }>(
          `/admin/users?${params.toString()}`,
        );
        return { items: data.users, total: data.total, pageCount: data.pageCount };
      }}
      exportPath={(params) => `/admin/users/export?${params.toString()}`}
      bulkActions={
        canManage
          ? [
              {
                label: 'Suspend selected',
                tone: 'danger',
                onClick: async (ids) => {
                  await Promise.all(ids.map((id) => setStatus(id, 'SUSPENDED')));
                  toast.success(`${ids.length} account${ids.length === 1 ? '' : 's'} suspended`);
                },
              },
              {
                label: 'Activate selected',
                onClick: async (ids) => {
                  await Promise.all(ids.map((id) => setStatus(id, 'ACTIVE')));
                  toast.success(`${ids.length} account${ids.length === 1 ? '' : 's'} reinstated`);
                },
              },
            ]
          : undefined
      }
      renderDrawer={(user) => (
        <UserDrawer user={user} reload={reload} canFinance={canFinance} canManage={canManage} />
      )}
    />
  );
}

function UserDrawer({
  user,
  reload,
  canFinance,
  canManage,
}: {
  user: User;
  reload: () => void;
  canFinance: boolean;
  canManage: boolean;
}) {
  return (
    <div>
      <h2 className="pr-16 text-sm font-bold">{user.name}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">joined {dateTime(user.createdAt)}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="card p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Live balance</p>
          <p className="tabular mt-1 text-sm font-bold">{money(user.realBalance)}</p>
          {user.lockedBalance > 0 && (
            <p className="tabular text-[10px] text-amber-300">{money(user.lockedBalance)} held</p>
          )}
        </div>
        <div className="card p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Practice balance</p>
          <p className="tabular mt-1 text-sm font-bold">{money(user.demoBalance)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Deposited</p>
          <p className="tabular mt-1 text-sm font-bold">{money(user.totalDeposited)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Withdrawn</p>
          <p className="tabular mt-1 text-sm font-bold">{money(user.totalWithdrawn)}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <StatusPill status={user.kycStatus} />
        <StatusPill status={user.status} />
        {user.role === 'ADMIN' && <span className="chip bg-accent-soft text-accent">admin</span>}
      </div>

      {(canFinance || canManage) && (
        <div className="mt-5 flex gap-2">
          {canFinance && (
            <button
              onClick={() => void adjustBalance(user, reload)}
              className="btn-ghost flex-1 !py-2 text-xs"
            >
              Adjust balance
            </button>
          )}
          {canManage && (
            <button
              onClick={() => void toggleStatus(user, reload)}
              className="btn-ghost flex-1 !py-2 text-xs"
            >
              {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
            </button>
          )}
        </div>
      )}

      <Link to={`/admin/users/${user.id}`} className="btn-primary mt-2 block w-full !py-2 text-center text-xs">
        View full profile →
      </Link>
    </div>
  );
}

const KYC_FILTERS = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum' as const,
    options: [
      { value: 'PENDING', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' },
    ],
  },
  {
    key: 'documentType',
    label: 'Document',
    type: 'enum' as const,
    options: [
      { value: 'PASSPORT', label: 'Passport' },
      { value: 'ID_CARD', label: 'ID card' },
      { value: 'DRIVING_LICENCE', label: 'Driving licence' },
    ],
  },
  { key: 'createdAt', label: 'Submitted', type: 'dateRange' as const },
];

export function AdminKyc() {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const review = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    const note =
      decision === 'REJECTED' ? window.prompt('Reason for rejection? The trader sees this.') : undefined;
    if (decision === 'REJECTED' && !note) return;
    try {
      await api.post(`/admin/kyc/${id}/review`, { decision, note });
      reload();
      toast.success(decision === 'APPROVED' ? 'Identity verified' : 'Verification rejected');
    } catch (err) {
      toast.error('Review failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const columns: DataTableColumn<KycSubmission>[] = [
    {
      key: 'user',
      label: 'Trader',
      render: (row) => (
        <>
          <span className="block text-xs font-semibold">{row.user?.name}</span>
          <span className="block text-[11px] text-slate-500">{row.user?.email}</span>
          <span className="tabular block text-[10px] text-slate-500">
            balance {money(row.user?.realBalance ?? 0)}
          </span>
        </>
      ),
    },
    {
      key: 'fullName',
      label: 'Identity',
      sortable: true,
      render: (row) => (
        <>
          <span className="block text-xs font-semibold text-slate-200">{row.fullName}</span>
          <span className="block text-[11px] text-slate-400">born {row.dateOfBirth}</span>
          <span className="block text-[11px] text-slate-400">
            {row.address}, {row.country}
          </span>
        </>
      ),
    },
    {
      key: 'document',
      label: 'Document',
      render: (row) => (
        <>
          <span className="block text-[11px] text-slate-400 capitalize">
            {row.documentType.replace(/_/g, ' ').toLowerCase()}
          </span>
          <span className="block font-mono text-[11px] text-slate-400">{row.documentNumber}</span>
        </>
      ),
    },
    {
      key: 'createdAt',
      label: 'Submitted',
      sortable: true,
      render: (row) => <span className="text-[11px] text-slate-500">{dateTime(row.createdAt)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <>
          <StatusPill status={row.status} />
          {row.note && <span className="mt-1 block text-[10px] text-slate-500">{row.note}</span>}
        </>
      ),
    },
    {
      key: 'decision',
      label: 'Decision',
      align: 'right',
      render: (row) =>
        row.status === 'PENDING' ? (
          <span className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                void review(row.id, 'APPROVED');
              }}
              className="btn-up !px-3 !py-1.5 text-xs"
            >
              Approve
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void review(row.id, 'REJECTED');
              }}
              className="btn-ghost !px-3 !py-1.5 text-xs !text-down"
            >
              Reject
            </button>
          </span>
        ) : null,
    },
  ];

  return (
    <DataTable<KycSubmission>
      title="Identity verification"
      columns={columns}
      filters={KYC_FILTERS}
      searchPlaceholder="Search trader, name or document number"
      rowKey={(row) => row.id}
      reloadToken={reloadToken}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ submissions: KycSubmission[]; total: number; pageCount: number }>(
          `/admin/kyc?${params.toString()}`,
        );
        return { items: data.submissions, total: data.total, pageCount: data.pageCount };
      }}
    />
  );
}
