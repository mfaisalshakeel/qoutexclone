import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../store/auth';
import { AuthShell } from './Login';

/**
 * The page the confirmation link lands on.
 *
 * It works signed in or signed out: the token is the proof, not the session.
 * Anyone already signed in has their account refreshed so the banner goes
 * away without a reload.
 */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  // React runs effects twice in development; the token is single-use
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState('failed');
      setMessage('That link is missing its confirmation code.');
      return;
    }

    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        setState('done');
        if (user) await refreshUser().catch(() => undefined);
      })
      .catch((err: unknown) => {
        setState('failed');
        setMessage(
          err instanceof ApiError ? err.message : 'We could not confirm this address. Try the link again.',
        );
      });
  }, [token, user, refreshUser]);

  if (state === 'working') {
    return (
      <AuthShell title="Confirming your address" subtitle="One moment.">
        <p className="text-sm text-slate-400">Checking the link you followed…</p>
      </AuthShell>
    );
  }

  if (state === 'done') {
    return (
      <AuthShell title="Address confirmed" subtitle="Thank you — that is all it took.">
        <Link to={user ? '/trade' : '/login'} className="btn-primary block w-full text-center">
          {user ? 'Back to trading' : 'Sign in'}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="That link did not work" subtitle="It may have expired or already been used.">
      <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
        {message}
      </p>
      <p className="mt-4 text-sm text-slate-400">
        {user ? (
          <>
            Open{' '}
            <Link to="/account/security" className="font-semibold text-accent hover:underline">
              your security settings
            </Link>{' '}
            and send yourself a fresh link.
          </>
        ) : (
          <>
            <Link to="/login" className="font-semibold text-accent hover:underline">
              Sign in
            </Link>{' '}
            and send yourself a fresh link from your security settings.
          </>
        )}
      </p>
    </AuthShell>
  );
}
