import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useSettings } from '../../store/settings';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

/** A real, working contact form — a submission is delivered straight to the support inbox. */
export function PublicContact() {
  usePageMeta({ title: 'Contact us', description: 'Reach the Quantex support team directly.' });

  const supportEmail = useSettings((s) => s.values['general.supportEmail'] as string | undefined);
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('sending');
    setError(null);
    try {
      await api.post('/content/contact', form);
      setState('sent');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiError ? err.message : 'Could not send your message. Try again in a moment.');
    }
  };

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Contact us</h1>
        <p className="mt-2 text-sm text-slate-400">
          Already have an account? Sign in and reach support directly for a faster answer that's tied to your
          own account.{' '}
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
          .
        </p>

        {state === 'sent' ? (
          <div className="card mt-8 p-6 text-center">
            <p className="text-sm font-semibold">Message sent.</p>
            <p className="mt-1 text-sm text-slate-400">We'll reply to the address you gave us.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="c-name">
                  Name
                </label>
                <input
                  id="c-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="field"
                />
              </div>
              <div>
                <label className="label" htmlFor="c-email">
                  Email
                </label>
                <input
                  id="c-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="field"
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="c-subject">
                Subject
              </label>
              <input
                id="c-subject"
                required
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="c-message">
                Message
              </label>
              <textarea
                id="c-message"
                required
                minLength={10}
                rows={5}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="field"
              />
            </div>
            {error && <p className="text-sm text-down">{error}</p>}
            <button type="submit" disabled={state === 'sending'} className="btn-primary w-full">
              {state === 'sending' ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}

        {supportEmail && (
          <p className="mt-6 text-center text-sm text-slate-500">
            Or email us directly at{' '}
            <a href={`mailto:${supportEmail}`} className="text-accent hover:underline">
              {supportEmail}
            </a>
            .
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
