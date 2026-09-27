import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePageMeta } from './usePageMeta';
import { useSettings } from '../store/settings';

function clearHead(): void {
  document.title = '';
  document.head.querySelectorAll('meta, link[rel="canonical"], #page-json-ld').forEach((el) => el.remove());
}

describe('usePageMeta', () => {
  beforeEach(() => {
    clearHead();
    useSettings.setState({
      loaded: true,
      values: {
        'seo.titleTemplate': '%s — Quantex',
        'seo.metaDescription': 'Default description.',
        'seo.canonicalBaseUrl': 'https://quantex.example',
        'seo.robotsIndexing': true,
        'seo.twitterCard': 'summary_large_image',
        'seo.ogImageUrl': 'https://quantex.example/og.png',
      },
    });
  });
  afterEach(clearHead);

  it('fills the page title into the configured template', () => {
    renderHook(() => usePageMeta({ title: 'Markets' }));
    expect(document.title).toBe('Markets — Quantex');
  });

  it('falls back to the site default description when the page gives none of its own', () => {
    renderHook(() => usePageMeta({ title: 'Markets' }));
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Default description.',
    );
  });

  it("prefers the page's own description over the site default", () => {
    renderHook(() => usePageMeta({ title: 'Markets', description: 'Page-specific copy.' }));
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Page-specific copy.',
    );
  });

  it('builds a canonical URL from the configured base and the current path', () => {
    window.history.pushState({}, '', '/markets');
    renderHook(() => usePageMeta({ title: 'Markets' }));
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://quantex.example/markets',
    );
  });

  it('marks the page noindex when asked, regardless of the sitewide indexing setting', () => {
    renderHook(() => usePageMeta({ title: 'Not found', noindex: true }));
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('respects a sitewide noindex even when the page itself does not ask for one', () => {
    useSettings.setState((s) => ({ values: { ...s.values, 'seo.robotsIndexing': false } }));
    renderHook(() => usePageMeta({ title: 'Markets' }));
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('embeds JSON-LD as a script tag when given structured data', () => {
    renderHook(() => usePageMeta({ title: 'Markets', jsonLd: { '@type': 'Organization' } }));
    const script = document.getElementById('page-json-ld');
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.textContent!)).toEqual({ '@type': 'Organization' });
  });

  it('embeds no JSON-LD script at all when none is given', () => {
    renderHook(() => usePageMeta({ title: 'Markets' }));
    expect(document.getElementById('page-json-ld')).toBeNull();
  });

  it('replaces the previous page’s tags rather than accumulating duplicates', () => {
    const { rerender } = renderHook(({ title }) => usePageMeta({ title }), {
      initialProps: { title: 'Markets' },
    });
    rerender({ title: 'Tournaments' });
    expect(document.title).toBe('Tournaments — Quantex');
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
  });
});
