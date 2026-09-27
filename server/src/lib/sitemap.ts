import { LEGAL_PAGES } from '../services/content.js';

/**
 * Every public route worth a crawler's time — the same list
 * `scripts/prerender.mjs` prerenders, kept here in code rather than shared
 * across a script and the server boundary. The authenticated app and the
 * admin back office are never listed: a crawler cannot reach anything past
 * the login wall anyway, and listing a URL nobody can actually visit
 * without an account is not what a sitemap is for.
 */
export function publicRoutePaths(): string[] {
  return [
    '/',
    '/markets',
    '/tournaments/overview',
    '/status',
    '/affiliate',
    '/help',
    '/contact',
    '/about',
    '/login',
    '/register',
    ...LEGAL_PAGES.map((page) => `/legal/${page.slug}`),
  ];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A standard XML sitemap for the given base URL. `lastmod` is the moment
 * this was generated — the platform has no per-route "last actually changed"
 * timestamp to offer honestly, so it says only what it knows: that the route
 * existed and was reachable as of this build.
 */
export function buildSitemapXml(baseUrl: string, paths: string[] = publicRoutePaths()): string {
  const base = baseUrl.replace(/\/$/, '');
  const now = new Date().toISOString();
  const urls = paths
    .map(
      (route) =>
        `  <url>\n    <loc>${escapeXml(`${base}${route}`)}</loc>\n    <lastmod>${now}</lastmod>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * `robots.txt`. `indexingAllowed` off publishes a sitewide `Disallow: /` —
 * for a staging deploy that should never be found — otherwise it opens the
 * public site and closes the authenticated app and admin back office, which
 * a crawler could never usefully render anyway since both sit behind a
 * login.
 */
export function buildRobotsTxt(options: { indexingAllowed: boolean; sitemapUrl: string | null }): string {
  if (!options.indexingAllowed) {
    return 'User-agent: *\nDisallow: /\n';
  }
  const lines = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /trade',
    'Disallow: /account',
    'Disallow: /wallet',
  ];
  if (options.sitemapUrl) lines.push('', `Sitemap: ${options.sitemapUrl}`);
  return `${lines.join('\n')}\n`;
}
