import { Link } from 'react-router-dom';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

/** A real 404 for an unknown route — replaces the old silent redirect-to-home. */
export function NotFound() {
  usePageMeta({ title: 'Page not found', description: 'This page does not exist.', noindex: true });

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto flex max-w-2xl flex-col items-center px-4 pb-24 pt-16 text-center">
        <p className="text-sm font-semibold text-accent">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-3 max-w-md text-sm text-slate-400">
          The page you're looking for doesn't exist, or the link that brought you here is out of date.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/" className="btn-primary !px-5 !py-3">
            Back to the homepage
          </Link>
          <Link to="/contact" className="btn-ghost !px-5 !py-3">
            Tell us what's broken
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
