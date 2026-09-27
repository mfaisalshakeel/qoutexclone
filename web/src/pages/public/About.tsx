import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

const VALUE_KEYS = ['value1', 'value2', 'value3'] as const;

/** Original copy about the product and how it approaches trading — no borrowed branding or screenshots. */
export function PublicAbout() {
  const { t } = useTranslation();
  usePageMeta({
    title: t('about.title'),
    description: t('about.intro1'),
  });

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('about.title')}</h1>
        <p className="mt-4 text-base leading-relaxed text-slate-400">{t('about.intro1')}</p>
        <p className="mt-4 text-base leading-relaxed text-slate-400">{t('about.intro2')}</p>

        <h2 className="mt-10 text-xl font-bold tracking-tight">{t('about.valuesTitle')}</h2>
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {VALUE_KEYS.map((key) => (
            <div key={key} className="card p-5">
              <p className="text-sm font-semibold">{t(`about.${key}Title`)}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{t(`about.${key}Body`)}</p>
            </div>
          ))}
        </div>

        <div className="card mt-10 p-6">
          <p className="text-sm font-semibold">{t('about.riskTitle')}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('about.riskBody')}</p>
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            {t('about.cta')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
