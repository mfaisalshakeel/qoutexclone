import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ApiError, api } from '../../lib/api';
import { useSettings } from '../../store/settings';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

/** A real, working contact form — a submission is delivered straight to the support inbox. */
export function PublicContact() {
  const { t } = useTranslation();
  usePageMeta({ title: t('contact.title'), description: t('contact.description') });

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
      setError(err instanceof ApiError ? err.message : t('contact.genericError'));
    }
  };

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('contact.title')}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {t('contact.signInPrompt')}{' '}
          <Link to="/login" className="text-accent hover:underline">
            {t('common.signIn')}
          </Link>
          .
        </p>

        {state === 'sent' ? (
          <div className="card mt-8 p-6 text-center">
            <p className="text-sm font-semibold">{t('contact.sent')}</p>
            <p className="mt-1 text-sm text-slate-400">{t('contact.sentBody')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-8 space-y-4 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="c-name">
                  {t('contact.name')}
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
                  {t('contact.email')}
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
                {t('contact.subject')}
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
                {t('contact.message')}
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
              {state === 'sending' ? t('contact.sending') : t('contact.send')}
            </button>
          </form>
        )}

        {supportEmail && (
          <p className="mt-6 text-center text-sm text-slate-500">
            <Trans
              i18nKey="contact.emailUsDirectly"
              values={{ email: supportEmail }}
              components={{
                emailLink: (
                  // eslint-disable-next-line jsx-a11y/anchor-has-content -- Trans fills this from the translation string
                  <a href={`mailto:${supportEmail}`} className="text-accent hover:underline" />
                ),
              }}
            />
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
