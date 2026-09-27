import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '..');

/**
 * The prerender step needs a real server already answering with the current
 * build — the single-port production server on :4000, which `webServer` in
 * playwright.config.ts (or this environment's own `npm run dev`) already has
 * running. Running the script once here, against that live server, and then
 * reading its output back through raw HTTP is the only way to prove the
 * whole pipeline actually produces what a crawler would receive, rather than
 * just that the script runs without throwing.
 */
test.describe('prerendering for crawlers', () => {
  test.beforeAll(() => {
    execFileSync('node', ['scripts/prerender.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, PRERENDER_BASE_URL: 'http://localhost:4000' },
      stdio: 'pipe',
      timeout: 120_000,
    });
  });

  test('a crawler receives a prerendered snapshot with the real content already in it', async ({
    request,
  }) => {
    const res = await request.get('http://localhost:4000/markets', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('<title>Markets — Quantex</title>');
    // the point of prerendering: the market's own symbol is already in the
    // markup, not waiting on a script tag to fetch and render it
    expect(body).toMatch(/USD|USDT/);
    // no empty shell for a crawler to have to run JS against
    expect(body).not.toContain('<div id="root"></div>');
  });

  test('a real browser still gets the live SPA shell, unchanged', async ({ request }) => {
    const res = await request.get('http://localhost:4000/markets', {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('<div id="root"></div>');
    // the built SPA's own bundle, still referenced — this is the live app, not a static snapshot
    expect(body).toMatch(/assets\/index-.*\.js/);
  });

  test('the homepage snapshot carries Organization and WebSite structured data', async ({ request }) => {
    const res = await request.get('http://localhost:4000/', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });
    const body = await res.text();
    expect(body).toContain('"@type":"Organization"');
    expect(body).toContain('"@type":"WebSite"');
  });

  test('the help centre snapshot carries FAQPage structured data built from real entries', async ({
    request,
  }) => {
    const res = await request.get('http://localhost:4000/help', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });
    const body = await res.text();
    expect(body).toContain('"@type":"FAQPage"');
    expect(body).toContain('"@type":"Question"');
  });

  test('a route with no snapshot still falls back to the ordinary SPA shell for a crawler, never a crash', async ({
    request,
  }) => {
    const res = await request.get('http://localhost:4000/this-was-never-prerendered', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('<div id="root"></div>');
  });

  test('a path-traversal attempt in the URL never reaches outside the snapshot directory', async ({
    request,
  }) => {
    const res = await request.get('http://localhost:4000/..%2f..%2f..%2fetc%2fpasswd', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });
    const body = await res.text();
    expect(body).not.toContain('root:');
    expect(body).toContain('<div id="root">');
  });
});
