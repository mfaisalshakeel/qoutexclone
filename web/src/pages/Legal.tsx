import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { usePageMeta } from '../hooks/usePageMeta';
import { PublicHeader } from '../components/home/PublicHeader';
import { SiteFooter } from '../components/home/Sections';
import { dateTime } from '../lib/format';

interface PublicLegalPage {
  slug: string;
  title: string;
  body: string | null;
  publishedAt: string;
}

/** One of the fixed legal documents, rendered from whatever the content CMS has published. */
export function Legal() {
  const { t } = useTranslation();
  const { slug = '' } = useParams();
  const [page, setPage] = useState<PublicLegalPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setPage(null);
    setError(null);
    setNotFound(false);
    api
      .get<{ page: PublicLegalPage }>(`/content/legal/${slug}`)
      .then(({ page: data }) => setPage(data))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof ApiError ? err.message : t('legal.loadError'));
      });
  }, [slug, t]);

  usePageMeta({
    title: page?.title ?? t('legal.fallbackTitle'),
    description: page?.title ? `${page.title} — Quantex.` : undefined,
    noindex: notFound,
  });

  return (
    <div className="min-h-dvh">
      <PublicHeader />

      <main className="mx-auto max-w-3xl px-4 pb-20">
        {error && (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-400">{error}</p>
          </div>
        )}
        {notFound && !error && (
          <div className="card p-6 text-center">
            <p className="text-sm font-semibold">{t('legal.notPublished')}</p>
            <Link to="/" className="mt-3 inline-block text-sm text-accent hover:underline">
              {t('legal.backHome')}
            </Link>
          </div>
        )}
        {!error && !notFound && !page && (
          <div aria-busy="true" className="space-y-3">
            <div className="skeleton h-8 w-64" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        )}
        {page && (
          <article>
            <h1 className="text-2xl font-bold tracking-tight">{page.title}</h1>
            <p className="mt-1 text-xs text-slate-500">
              {t('legal.lastUpdated', { date: dateTime(page.publishedAt) })}
            </p>
            <div
              className="markdown-body mt-6 text-sm text-slate-400"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body ?? '') }}
            />
          </article>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
