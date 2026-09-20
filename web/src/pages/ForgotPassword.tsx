import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { AuthShell } from './Login';
import { PasswordMeter } from '../components/PasswordMeter';

interface ForgotResponse {
  ok: boolean;
  message: string;
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<ForgotResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSent(await api.post<ForgotResponse>('/auth/forgot-password', { email }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset link');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle={sent.message}>
        <p className="text-sm text-slate-400">
          The link works once and expires shortly. If it has not arrived in a few minutes, look in your spam
          folder before asking for another.
        </p>
        <p className="mt-5 text-center text-sm text-slate-400">
          <Link to="/login" className="font-semibold text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll send a link to get you back in">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            placeholder="you@example.com"
          />
        </div>
        {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-400">
        Remembered it?{' '}
        <Link to="/login" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="The link works once and expires shortly">
      <form onSubmit={submit} className="space-y-4">
        {!params.get('token') && (
          <div>
            <label className="label" htmlFor="token">
              Reset token
            </label>
            <input
              id="token"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="field font-mono !text-xs"
            />
          </div>
        )}
        <div>
          <label className="label" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            placeholder="At least 8 characters"
          />
          <PasswordMeter password={password} />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Repeat password
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field"
          />
        </div>
        {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthShell>
  );
}
