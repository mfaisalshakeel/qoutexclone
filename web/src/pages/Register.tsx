import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../store/auth';
import { AuthShell } from './Login';
import { PasswordMeter } from '../components/PasswordMeter';

export function Register() {
  const { register, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    country: '',
    referralCode: (params.get('ref') ?? '').toUpperCase(),
  });
  const [error, setError] = useState('');

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        country: form.country || undefined,
        referralCode: form.referralCode || undefined,
      });
      navigate('/trade', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account');
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="$10,000 practice balance, no deposit needed">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            required
            minLength={2}
            value={form.name}
            onChange={update('name')}
            className="field"
            placeholder="Alex Carter"
          />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={update('email')}
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
            required
            minLength={8}
            value={form.password}
            onChange={update('password')}
            className="field"
            placeholder="At least 8 characters"
            aria-describedby="password-strength"
          />
          <div id="password-strength">
            <PasswordMeter password={form.password} email={form.email} name={form.name} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="country">
            Country <span className="normal-case text-slate-500">(optional)</span>
          </label>
          <input
            id="country"
            value={form.country}
            onChange={update('country')}
            className="field"
            placeholder="Pakistan"
          />
        </div>
        <div>
          <label className="label" htmlFor="referralCode">
            Referral code <span className="normal-case text-slate-500">(optional)</span>
          </label>
          <input
            id="referralCode"
            value={form.referralCode}
            onChange={update('referralCode')}
            className="field font-mono !text-xs uppercase"
            placeholder="A1B2C3D4"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-slate-500">
          Trading involves risk. Only trade with funds you can afford to lose.
        </p>
      </form>
      <p className="mt-5 text-center text-sm text-slate-400">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
