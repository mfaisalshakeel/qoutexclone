import { describe, expect, it } from 'vitest';
import { RTL_LANGUAGES, applyDocumentDirection, isRtl, isTranslatedRoute } from './config';

describe('isRtl', () => {
  it('treats Arabic and Urdu as right-to-left', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('ur')).toBe(true);
  });

  it('treats every other language as left-to-right', () => {
    expect(isRtl('en')).toBe(false);
    expect(isRtl('es')).toBe(false);
    expect(isRtl('fr')).toBe(false);
  });

  it('matches the exported RTL_LANGUAGES set', () => {
    for (const lang of RTL_LANGUAGES) expect(isRtl(lang)).toBe(true);
  });
});

describe('applyDocumentDirection', () => {
  it('sets dir="rtl" and lang for a right-to-left language', () => {
    applyDocumentDirection('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('sets dir="ltr" and lang for a left-to-right language', () => {
    applyDocumentDirection('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('flips back to ltr when switching away from an RTL language', () => {
    applyDocumentDirection('ar');
    expect(document.documentElement.dir).toBe('rtl');
    applyDocumentDirection('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

describe('isTranslatedRoute', () => {
  it('treats the public marketing pages as translated', () => {
    for (const path of [
      '/',
      '/markets',
      '/tournaments/overview',
      '/status',
      '/affiliate',
      '/help',
      '/contact',
      '/about',
      '/legal/terms',
      '/this-page-does-not-exist',
    ]) {
      expect(isTranslatedRoute(path)).toBe(true);
    }
  });

  it('treats the authenticated app as not translated, so it always stays LTR', () => {
    for (const path of [
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
      '/account',
      '/account/security',
      '/account/status',
    ]) {
      expect(isTranslatedRoute(path)).toBe(false);
    }
  });

  it('treats the entire admin back office as not translated', () => {
    expect(isTranslatedRoute('/admin')).toBe(false);
    expect(isTranslatedRoute('/admin/settings')).toBe(false);
  });

  it('does not confuse the authenticated tournaments page with the public tournaments overview', () => {
    expect(isTranslatedRoute('/tournaments')).toBe(false);
    expect(isTranslatedRoute('/tournaments/overview')).toBe(true);
  });
});
