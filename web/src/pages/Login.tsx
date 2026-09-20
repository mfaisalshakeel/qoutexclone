import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../store/auth';
import { IconLogo } from '../components/Icons';

export function Login() {
  const { login, submitSecondFactor, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // set once the password is accepted but the account carries a second factor
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  // the code field is the only thing on the step, so the caret belongs in it
  useEffect(() => {
    if (challenge) codeRef.current?.focus();
  }, [challenge]);

  const done = () => navigate(location.state?.from ?? '/trade', { replace: true });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const result = await login(email, password);
      if (result.done) done();
      else setChallenge(result.challengeToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await submitSecondFactor(challenge!, code);
      done();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      setCode('');
    }
  };

  if (challenge) {
    return (
      <AuthShell title="One more step" subtitle="Enter the code from your authenticator app">
        <form onSubmit={submitCode} className="space-y-4">
          <div>
            <label className="label" htmlFor="code">
              Six-digit code
            </label>
            {/* a backup code is longer and has a dash, so the field cannot be
                numeric-only — the server accepts either */}
            <input
              id="code"
              ref={codeRef}
              inputMode="text"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="field tabular tracking-[0.3em]"
              placeholder="000000"
            />
            <p className="mt-2 text-xs text-slate-500">
              Lost your phone? Use one of the backup codes you saved when you turned this on.
            </p>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Checking…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setCode('');
              setError('');
            }}
            className="btn-ghost w-full"
          >
            Back
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your trading account">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            placeholder="••••••••"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-center">
          <Link to="/forgot-password" className="text-xs text-slate-400 hover:text-accent">
            Forgot your password?
          </Link>
        </p>
      </form>
      <p className="mt-5 text-center text-sm text-slate-400">
        New here?{' '}
        <Link to="/register" className="font-semibold text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2">
        <IconLogo className="h-9 w-9" />
        <span className="text-xl font-bold tracking-tight">Quantex</span>
      </Link>
      <div className="card w-full max-w-md p-6 sm:p-8">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-slate-400">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
