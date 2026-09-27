import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

/** A real 404 for an unknown route — replaces the old silent redirect-to-home. */
export function NotFound() {
  const { t } = useTranslation();
  usePageMeta({ title: t('notFound.title'), description: t('notFound.body'), noindex: true });

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto flex max-w-2xl flex-col items-center px-4 pb-24 pt-16 text-center">
        <p className="text-sm font-semibold text-accent">{t('notFound.eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{t('notFound.title')}</h1>
        <p className="mt-3 max-w-md text-sm text-slate-400">{t('notFound.body')}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/" className="btn-primary !px-5 !py-3">
            {t('notFound.backHome')}
          </Link>
          <Link to="/contact" className="btn-ghost !px-5 !py-3">
            {t('notFound.reportIt')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
