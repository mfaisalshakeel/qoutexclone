import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';
import type { User } from '../../lib/types';

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

export function AdminUsers() {
  const [rows, setRows] = useState<User[] | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const { users } = await api.get<{ users: User[] }>(
      `/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    );
    setRows(users);
  }, [search]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(id);
  }, [load]);

  const adjust = async (user: User) => {
    const raw = window.prompt(`Adjust ${user.email}'s live balance by (USD, negative to debit):`);
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount === 0) return;
    const note = window.prompt('Note for the ledger:') ?? undefined;
    try {
      await api.post(`/admin/users/${user.id}/adjust`, { accountType: 'REAL', amount, note });
      await load();
      toast.success(`Balance adjusted by ${money(Math.round(amount * 100), { sign: true })}`);
    } catch (err) {
      toast.error('Adjustment failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggleStatus = async (user: User) => {
    const status = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.post(`/admin/users/${user.id}/status`, { status });
      await load();
      toast.success(status === 'ACTIVE' ? 'Account reinstated' : 'Account suspended');
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <>
      <PageHead
        title="Traders"
        subtitle={rows ? `${rows.length} accounts` : undefined}
        action={
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="field !w-64 !py-2 !text-xs"
          />
        }
      />

      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="No accounts match" />
      ) : (
        <Table head={['Trader', 'Live balance', 'Practice', 'Lifetime', 'Verification', 'Actions']}>
          {rows.map((user) => (
            <tr key={user.id}>
              <Td>
                <span className="block text-xs font-semibold">
                  {user.name}
                  {user.role === 'ADMIN' && (
                    <span className="ml-2 chip bg-accent-soft text-accent">admin</span>
                  )}
                </span>
                <span className="block text-[11px] text-slate-500">{user.email}</span>
                <span className="block text-[10px] text-slate-500">joined {dateTime(user.createdAt)}</span>
              </Td>
              <Td>
                <span className="tabular block text-xs font-semibold">{money(user.realBalance)}</span>
                {user.lockedBalance > 0 && (
                  <span className="tabular block text-[10px] text-amber-300">
                    {money(user.lockedBalance)} held
                  </span>
                )}
              </Td>
              <Td className="tabular text-xs text-slate-400">{money(user.demoBalance)}</Td>
              <Td className="text-[11px] text-slate-400">
                <span className="block">in {money(user.totalDeposited)}</span>
                <span className="block">out {money(user.totalWithdrawn)}</span>
              </Td>
              <Td>
                <StatusPill status={user.kycStatus} />
                <span className="mt-1 block">
                  <StatusPill status={user.status} />
                </span>
              </Td>
              <Td className="text-right">
                <span className="flex justify-end gap-2">
                  <button onClick={() => void adjust(user)} className="btn-ghost !px-3 !py-1.5 text-xs">
                    Adjust
                  </button>
                  <button onClick={() => void toggleStatus(user)} className="btn-ghost !px-3 !py-1.5 text-xs">
                    {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
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

export function AdminKyc() {
  const [rows, setRows] = useState<KycSubmission[] | null>(null);

  const load = useCallback(async () => {
    const { submissions } = await api.get<{ submissions: KycSubmission[] }>('/admin/kyc');
    setRows(submissions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    const note =
      decision === 'REJECTED' ? window.prompt('Reason for rejection? The trader sees this.') : undefined;
    if (decision === 'REJECTED' && !note) return;
    try {
      await api.post(`/admin/kyc/${id}/review`, { decision, note });
      await load();
      toast.success(decision === 'APPROVED' ? 'Identity verified' : 'Verification rejected');
    } catch (err) {
      toast.error('Review failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (!rows) return <Loading />;
  const pending = rows.filter((r) => r.status === 'PENDING');

  return (
    <>
      <PageHead title="Identity verification" subtitle={`${pending.length} waiting for review`} />

      {rows.length === 0 ? (
        <Empty text="No verification requests yet" />
      ) : (
        <Table head={['Trader', 'Identity', 'Document', 'Submitted', 'Status', 'Decision']}>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>
                <span className="block text-xs font-semibold">{row.user?.name}</span>
                <span className="block text-[11px] text-slate-500">{row.user?.email}</span>
                <span className="tabular block text-[10px] text-slate-500">
                  balance {money(row.user?.realBalance ?? 0)}
                </span>
              </Td>
              <Td className="text-[11px] text-slate-400">
                <span className="block text-xs font-semibold text-slate-200">{row.fullName}</span>
                <span className="block">born {row.dateOfBirth}</span>
                <span className="block">
                  {row.address}, {row.country}
                </span>
              </Td>
              <Td className="text-[11px] text-slate-400">
                <span className="block capitalize">{row.documentType.replace(/_/g, ' ').toLowerCase()}</span>
                <span className="block font-mono">{row.documentNumber}</span>
              </Td>
              <Td className="text-[11px] text-slate-500">{dateTime(row.createdAt)}</Td>
              <Td>
                <StatusPill status={row.status} />
                {row.note && <span className="mt-1 block text-[10px] text-slate-500">{row.note}</span>}
              </Td>
              <Td className="text-right">
                {row.status === 'PENDING' && (
                  <span className="flex justify-end gap-2">
                    <button
                      onClick={() => void review(row.id, 'APPROVED')}
                      className="btn-up !px-3 !py-1.5 text-xs"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => void review(row.id, 'REJECTED')}
                      className="btn-ghost !px-3 !py-1.5 text-xs !text-down"
                    >
                      Reject
                    </button>
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
