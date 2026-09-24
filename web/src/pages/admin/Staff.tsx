import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { dateTime } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';
import { ADMIN_ROLE_LABELS, ADMIN_ROLES, type AdminRole } from '../../lib/permissions';

interface StaffRow {
  id: string;
  email: string;
  name: string;
  adminRole: AdminRole;
  status: 'ACTIVE' | 'SUSPENDED';
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const EMPTY_FORM = { email: '', name: '', password: '', adminRole: 'SUPPORT' as AdminRole };

/** Back-office accounts: who has a role, what it grants, and whether their 2FA is on. */
export function AdminStaff() {
  const { user: me } = useAuth();
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.get<{ staff: StaffRow[] }>('/admin/staff');
      setStaff(data.staff);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the team');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      await api.post('/admin/staff', form);
      setForm(EMPTY_FORM);
      await load();
      toast.success(`${form.name} added as ${ADMIN_ROLE_LABELS[form.adminRole]}`);
    } catch (err) {
      toast.error('Could not create the account', err instanceof ApiError ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const changeRole = async (row: StaffRow, adminRole: AdminRole) => {
    try {
      await api.patch(`/admin/staff/${row.id}`, { adminRole });
      await load();
      toast.success(`${row.name} is now ${ADMIN_ROLE_LABELS[adminRole]}`);
    } catch (err) {
      toast.error('Could not change role', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggleStatus = async (row: StaffRow) => {
    const status = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.post(`/admin/staff/${row.id}/status`, { status });
      await load();
      toast.success(status === 'ACTIVE' ? 'Account reinstated' : 'Account suspended');
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) {
    return (
      <>
        <PageHead title="Admin users" />
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-300">{error}</p>
          <button onClick={() => void load()} className="btn-ghost mt-3 text-xs">
            Try again
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Admin users"
        subtitle="Back-office accounts and the role that decides what each one can touch."
      />

      <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-5">
        <div>
          <label className="label" htmlFor="s-name">
            Name
          </label>
          <input
            id="s-name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="field !text-xs"
          />
        </div>
        <div>
          <label className="label" htmlFor="s-email">
            Email
          </label>
          <input
            id="s-email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="field !text-xs"
          />
        </div>
        <div>
          <label className="label" htmlFor="s-password">
            Temporary password
          </label>
          <input
            id="s-password"
            type="text"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="field !text-xs"
            placeholder="They should change this"
          />
        </div>
        <div>
          <label className="label" htmlFor="s-role">
            Role
          </label>
          <select
            id="s-role"
            value={form.adminRole}
            onChange={(e) => setForm({ ...form, adminRole: e.target.value as AdminRole })}
            className="field !text-xs"
          >
            {ADMIN_ROLES.map((role) => (
              <option key={role} value={role}>
                {ADMIN_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={creating} className="btn-primary w-full disabled:opacity-50">
            {creating ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
      <p className="mb-4 text-xs text-slate-500">
        A new account can sign in right away, but the back office stays closed to it until they turn on
        two-factor themselves, from Account → Security — the same as everyone else here.
      </p>

      {!staff ? (
        <Loading cols={6} />
      ) : staff.length === 0 ? (
        <Empty text="No admin users yet" />
      ) : (
        <Table head={['Name', 'Role', '2FA', 'Status', 'Last sign-in', 'Actions']}>
          {staff.map((row) => {
            const self = row.id === me?.id;
            return (
              <tr key={row.id}>
                <Td className="text-xs">
                  <span className="block font-semibold">
                    {row.name}
                    {self && <span className="ml-2 chip bg-accent-soft text-accent">you</span>}
                  </span>
                  <span className="block text-[11px] text-slate-500">{row.email}</span>
                </Td>
                <Td>
                  <select
                    value={row.adminRole}
                    disabled={self}
                    onChange={(e) => void changeRole(row, e.target.value as AdminRole)}
                    className="field !w-auto !py-1 !text-[11px] disabled:opacity-50"
                  >
                    {ADMIN_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ADMIN_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td>
                  {row.twoFactorEnabled ? (
                    <span className="chip bg-up-soft text-up">on</span>
                  ) : (
                    <span className="chip bg-down-soft text-down">off</span>
                  )}
                </Td>
                <Td>
                  <StatusPill status={row.status} />
                </Td>
                <Td className="text-[11px] text-slate-500">
                  {row.lastLoginAt ? dateTime(row.lastLoginAt) : 'never'}
                </Td>
                <Td className="text-right">
                  <button
                    onClick={() => void toggleStatus(row)}
                    disabled={self}
                    className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-50"
                  >
                    {row.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                  </button>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
