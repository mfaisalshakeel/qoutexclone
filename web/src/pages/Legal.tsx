import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { IconLogo } from '../components/Icons';
import { dateTime } from '../lib/format';

interface PublicLegalPage {
  slug: string;
  title: string;
  body: string | null;
  publishedAt: string;
}

/** One of the fixed legal documents, rendered from whatever the content CMS has published. */
export function Legal() {
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
        else setError(err instanceof ApiError ? err.message : 'Could not load this page');
      });
  }, [slug]);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center px-4 py-5">
        <Link to="/" className="flex items-center gap-2">
          <IconLogo className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">Quantex</span>
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20">
        {error && (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-400">{error}</p>
          </div>
        )}
        {notFound && !error && (
          <div className="card p-6 text-center">
            <p className="text-sm font-semibold">This page has not been published yet.</p>
            <Link to="/" className="mt-3 inline-block text-sm text-accent hover:underline">
              Back to the homepage
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
            <p className="mt-1 text-xs text-slate-500">Last updated {dateTime(page.publishedAt)}</p>
            <div
              className="markdown-body mt-6 text-sm text-slate-400"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body ?? '') }}
            />
          </article>
        )}
      </main>
    </div>
  );
}
