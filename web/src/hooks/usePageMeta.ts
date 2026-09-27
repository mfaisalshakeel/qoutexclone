import { useEffect } from 'react';
import { useSettings } from '../store/settings';

interface PageMeta {
  /** The page's own title. Filled into `seo.titleTemplate`'s `%s`. */
  title: string;
  description?: string;
  /** `og:type`. Defaults to `website`. */
  type?: string;
  /** Structured data to embed as a `<script type="application/ld+json">`. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Keeps this one page out of the index even while the site as a whole is indexable — a 404, for instance. */
  noindex?: boolean;
}

function upsertMeta(selector: string, build: () => HTMLMetaElement): void {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (existing) existing.remove();
  document.head.appendChild(build());
}

function meta(attr: 'name' | 'property', key: string, content: string): HTMLMetaElement {
  const el = document.createElement('meta');
  el.setAttribute(attr, key);
  el.setAttribute('content', content);
  return el;
}

/**
 * Sets this page's title, description, canonical link, Open Graph and
 * Twitter tags, and (optionally) its JSON-LD structured data — all read from
 * the live `seo.*` settings so an operator's own copy reaches the tag, not a
 * hardcoded default. Runs on mount and whenever the settings finish loading,
 * so a route hit before the settings request resolves still corrects itself.
 *
 * Nothing is restored on unmount: the next page's own call overwrites every
 * tag this one set, which is simpler and just as correct as swapping back to
 * an SPA-wide default that no route actually uses once mounted.
 */
export function usePageMeta({
  title,
  description,
  type = 'website',
  jsonLd,
  noindex = false,
}: PageMeta): void {
  const values = useSettings((s) => s.values);
  const loaded = useSettings((s) => s.loaded);

  useEffect(() => {
    const template = (values['seo.titleTemplate'] as string | undefined) ?? '%s — Quantex';
    const fullTitle = template.includes('%s') ? template.replace('%s', title) : `${title} — ${template}`;
    document.title = fullTitle;

    const desc = description ?? (values['seo.metaDescription'] as string | undefined) ?? '';
    if (desc) upsertMeta('meta[name="description"]', () => meta('name', 'description', desc));

    const base = ((values['seo.canonicalBaseUrl'] as string | undefined) ?? '').replace(/\/$/, '');
    const canonicalUrl = base ? `${base}${window.location.pathname}` : null;
    if (canonicalUrl) {
      const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (existing) existing.remove();
      const link = document.createElement('link');
      link.rel = 'canonical';
      link.href = canonicalUrl;
      document.head.appendChild(link);
    }

    const indexing = !noindex && values['seo.robotsIndexing'] !== false;
    upsertMeta('meta[name="robots"]', () =>
      meta('name', 'robots', indexing ? 'index, follow' : 'noindex, nofollow'),
    );

    upsertMeta('meta[property="og:title"]', () => meta('property', 'og:title', fullTitle));
    upsertMeta('meta[property="og:type"]', () => meta('property', 'og:type', type));
    if (desc) upsertMeta('meta[property="og:description"]', () => meta('property', 'og:description', desc));
    if (canonicalUrl) upsertMeta('meta[property="og:url"]', () => meta('property', 'og:url', canonicalUrl));
    const ogImage = values['seo.ogImageUrl'] as string | undefined;
    if (ogImage) upsertMeta('meta[property="og:image"]', () => meta('property', 'og:image', ogImage));

    const twitterCard = (values['seo.twitterCard'] as string | undefined) ?? 'summary_large_image';
    upsertMeta('meta[name="twitter:card"]', () => meta('name', 'twitter:card', twitterCard));
    upsertMeta('meta[name="twitter:title"]', () => meta('name', 'twitter:title', fullTitle));
    if (desc) upsertMeta('meta[name="twitter:description"]', () => meta('name', 'twitter:description', desc));
    if (ogImage) upsertMeta('meta[name="twitter:image"]', () => meta('name', 'twitter:image', ogImage));

    const scriptId = 'page-json-ld';
    document.getElementById(scriptId)?.remove();
    if (jsonLd) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, type, JSON.stringify(jsonLd), noindex, loaded]);
}
