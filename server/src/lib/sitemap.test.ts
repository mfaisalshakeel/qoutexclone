import { describe, expect, it } from 'vitest';
import { buildRobotsTxt, buildSitemapXml, publicRoutePaths } from './sitemap.js';

describe('publicRoutePaths', () => {
  it('lists every legal slug alongside the fixed public pages', () => {
    const paths = publicRoutePaths();
    expect(paths).toContain('/');
    expect(paths).toContain('/markets');
    expect(paths).toContain('/legal/terms');
    expect(paths).toContain('/legal/cookie-policy');
  });

  it('never lists an authenticated or admin route', () => {
    const paths = publicRoutePaths();
    expect(paths.some((p) => p.startsWith('/admin'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/trade'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/account'))).toBe(false);
  });
});

describe('buildSitemapXml', () => {
  it('emits one <url> per path, with the base URL prefixed', () => {
    const xml = buildSitemapXml('https://quantex.example', ['/', '/markets']);
    expect(xml).toContain('<loc>https://quantex.example/</loc>');
    expect(xml).toContain('<loc>https://quantex.example/markets</loc>');
    expect((xml.match(/<url>/g) ?? []).length).toBe(2);
  });

  it('strips a trailing slash from the base URL so a route never doubles up', () => {
    const xml = buildSitemapXml('https://quantex.example/', ['/markets']);
    expect(xml).toContain('<loc>https://quantex.example/markets</loc>');
    expect(xml).not.toContain('//markets');
  });

  it('is well-formed XML with the sitemap namespace', () => {
    const xml = buildSitemapXml('https://quantex.example', ['/']);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });
});

describe('buildRobotsTxt', () => {
  it('disallows everything when indexing is off, and says nothing else', () => {
    const txt = buildRobotsTxt({ indexingAllowed: false, sitemapUrl: 'https://quantex.example/sitemap.xml' });
    expect(txt).toBe('User-agent: *\nDisallow: /\n');
  });

  it('opens the public site and closes the authenticated app when indexing is on', () => {
    const txt = buildRobotsTxt({ indexingAllowed: true, sitemapUrl: null });
    expect(txt).toContain('Disallow: /admin');
    expect(txt).toContain('Disallow: /trade');
    expect(txt).not.toContain('Disallow: /\n');
  });

  it('references the sitemap only when one is given', () => {
    const withSitemap = buildRobotsTxt({
      indexingAllowed: true,
      sitemapUrl: 'https://quantex.example/sitemap.xml',
    });
    expect(withSitemap).toContain('Sitemap: https://quantex.example/sitemap.xml');

    const withoutSitemap = buildRobotsTxt({ indexingAllowed: true, sitemapUrl: null });
    expect(withoutSitemap).not.toContain('Sitemap:');
  });
});
