import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { KycPanel } from '../components/KycPanel';
import { ReferralPanel } from '../components/ReferralPanel';

export function Account() {
  const { user, refreshUser, logout } = useAuth();
  const [profile, setProfile] = useState({ name: user?.name ?? '', country: user?.country ?? '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState<'profile' | 'password' | null>(null);

  if (!user) return null;

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('profile');
    try {
      await api.patch('/me', { name: profile.name, country: profile.country || undefined });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('password');
    try {
      await api.post('/me/password', passwords);
      setPasswords({ currentPassword: '', newPassword: '' });
      toast.success('Password changed', 'Other sessions were signed out');
    } catch (err) {
      toast.error('Could not change password', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-600 text-xl font-bold uppercase">
            {user.name[0]}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{user.name}</p>
            <p className="truncate text-sm text-slate-400">{user.email}</p>
            <p className="text-xs text-slate-500">Member since {dateTime(user.createdAt)}</p>
          </div>
          <span
            className={`chip ml-auto ${user.status === 'ACTIVE' ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}
          >
            {user.status.toLowerCase()}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Live balance" value={money(user.realBalance)} />
          <Stat label="Practice" value={money(user.demoBalance)} />
          <Stat label="Deposited" value={money(user.totalDeposited)} />
          <Stat label="Withdrawn" value={money(user.totalWithdrawn)} />
        </div>
      </div>

      <KycPanel />

      <ReferralPanel />

      <form onSubmit={saveProfile} className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold">Profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="field"
              minLength={2}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="country">
              Country
            </label>
            <input
              id="country"
              value={profile.country ?? ''}
              onChange={(e) => setProfile({ ...profile, country: e.target.value })}
              className="field"
            />
          </div>
        </div>
        <button type="submit" disabled={busy === 'profile'} className="btn-primary">
          Save changes
        </button>
      </form>

      <form onSubmit={changePassword} className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold">Password</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="current">
              Current password
            </label>
            <input
              id="current"
              type="password"
              value={passwords.currentPassword}
              onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
              className="field"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="new">
              New password
            </label>
            <input
              id="new"
              type="password"
              minLength={8}
              value={passwords.newPassword}
              onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
              className="field"
              required
            />
          </div>
        </div>
        <button type="submit" disabled={busy === 'password'} className="btn-primary">
          Change password
        </button>
      </form>

      <button onClick={() => void logout()} className="btn-ghost w-full !text-down">
        Sign out
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-700/60 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="tabular text-sm font-bold">{value}</p>
    </div>
  );
}
