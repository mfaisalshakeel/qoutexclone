/** Languages this build ships real translations for, independent of what an operator has enabled. */
export const RTL_LANGUAGES = new Set(['ar', 'ur']);

export function isRtl(language: string): boolean {
  return RTL_LANGUAGES.has(language);
}

export const STORAGE_KEY = 'quantex-lang';

/** Applies the language's own text direction to the document, so the browser's bidi
 *  algorithm and every logical-property utility class (`ms-*`, `text-start`, …) flip
 *  correctly without per-component overrides. */
export function applyDocumentDirection(language: string): void {
  document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr';
  document.documentElement.lang = language;
}

/**
 * Routes with no real translation yet — the authenticated terminal, account
 * pages, and the whole admin back office. A trader who switches the public
 * site to Arabic must not carry a mirrored, RTL-flowed layout into pages
 * whose copy stays English; those always read left-to-right regardless of
 * the language chosen on the marketing site.
 */
export function isTranslatedRoute(pathname: string): boolean {
  if (pathname.startsWith('/admin')) return false;
  if (pathname.startsWith('/account/') || pathname === '/account') return false;
  const untranslated = new Set([
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/trade',
    '/tournaments',
    '/wallet',
    '/history',
    '/leaderboard',
    '/marketplace',
  ]);
  return !untranslated.has(pathname);
}
