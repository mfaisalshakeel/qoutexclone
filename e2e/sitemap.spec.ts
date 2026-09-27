import { expect, test } from '@playwright/test';
import { adminApiToken } from './helpers';

test.describe('sitemap and robots', () => {
  test('the sitemap lists the real public routes as valid XML', async ({ request }) => {
    const res = await request.get('http://localhost:4000/sitemap.xml');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(body).toContain('<loc>');
    expect(body).toMatch(/<loc>[^<]*\/markets<\/loc>/);
    expect(body).toMatch(/<loc>[^<]*\/legal\/terms<\/loc>/);
    // never an authenticated or admin route
    expect(body).not.toMatch(/\/admin|\/trade</);
  });

  test('robots.txt opens the public site, closes the authenticated app, and points at the sitemap', async ({
    request,
  }) => {
    const res = await request.get('http://localhost:4000/robots.txt');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Disallow: /admin');
    expect(body).toContain('Disallow: /trade');
    expect(body).toContain('Sitemap: ');
    expect(body).toContain('/sitemap.xml');
  });

  test('turning the sitemap off makes it a real 404, and robots.txt stops referencing it', async ({
    request,
  }) => {
    const token = await adminApiToken(request);
    try {
      await request.patch('/api/admin/settings', {
        headers: { authorization: `Bearer ${token}` },
        data: { 'seo.sitemapEnabled': false },
      });

      const sitemapRes = await request.get('http://localhost:4000/sitemap.xml');
      expect(sitemapRes.status()).toBe(404);

      const robotsBody = await request.get('http://localhost:4000/robots.txt').then((r) => r.text());
      expect(robotsBody).not.toContain('Sitemap:');
    } finally {
      await request.post('/api/admin/settings/seo.sitemapEnabled/reset', {
        headers: { authorization: `Bearer ${token}` },
      });
    }

    const restored = await request.get('http://localhost:4000/sitemap.xml');
    expect(restored.ok()).toBeTruthy();
  });

  test('turning off indexing publishes a sitewide Disallow, and resets cleanly', async ({ request }) => {
    const token = await adminApiToken(request);
    try {
      await request.patch('/api/admin/settings', {
        headers: { authorization: `Bearer ${token}` },
        data: { 'seo.robotsIndexing': false },
      });

      const body = await request.get('http://localhost:4000/robots.txt').then((r) => r.text());
      expect(body).toBe('User-agent: *\nDisallow: /\n');
    } finally {
      await request.post('/api/admin/settings/seo.robotsIndexing/reset', {
        headers: { authorization: `Bearer ${token}` },
      });
    }

    const restored = await request.get('http://localhost:4000/robots.txt').then((r) => r.text());
    expect(restored).toContain('Disallow: /admin');
    expect(restored).not.toBe('User-agent: *\nDisallow: /\n');
  });
});
