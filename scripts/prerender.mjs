/**
 * Prerenders every public route to static HTML, so a crawler gets a page
 * that already carries the real content — live markets, real testimonials,
 * the actual FAQ — instead of an empty `<div id="root">` it would have to
 * run JavaScript to fill in. A real browser is used, not `renderToString`,
 * because the pages fetch their own data client-side after mount; the only
 * way to capture what a visitor actually sees is to let the app finish
 * loading and then read the DOM, the same as a search engine's own renderer
 * eventually does.
 *
 * Run against a server that is already serving the fresh build (`npm start`
 * in `server/`, or the dev server) — this script does not start one itself,
 * since prerendering needs live data from a real API, not a static export.
 *
 *   PRERENDER_BASE_URL=http://localhost:4000 node scripts/prerender.mjs
 *
 * Snapshots land in `web/dist/__prerendered__/<route>.html`. The server
 * serves them only to a recognised crawler; every other visitor still gets
 * the normal SPA shell and hydrates it live.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../web/dist');
const outDir = path.join(distDir, '__prerendered__');

const BASE_URL = process.env.PRERENDER_BASE_URL ?? 'http://localhost:4000';

// every public route worth a crawler's time — the authenticated app and the
// admin back office are never prerendered; neither has anything for a
// search engine to index
const ROUTES = [
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
  '/legal/terms',
  '/legal/privacy',
  '/legal/risk-disclosure',
  '/legal/aml-kyc',
  '/legal/cookie-policy',
];

function outputPathFor(route) {
  const trimmed = route === '/' ? 'index' : route.replace(/^\//, '');
  return path.join(outDir, `${trimmed}.html`);
}

async function prerenderRoute(page, route) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 30_000 });
  // the cookie banner's own localStorage flag is a per-visitor UI
  // convenience, not page content — a crawler's snapshot naturally omits
  // it, but the live page itself can still race a slow settings fetch, so
  // give it one more tick before reading the DOM
  await page.waitForTimeout(150);
  const html = await page.content();
  const outPath = outputPathFor(route);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html);
  return outPath;
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || undefined });
  const page = await browser.newPage();

  let failed = 0;
  for (const route of ROUTES) {
    try {
      const outPath = await prerenderRoute(page, route);
      console.log(`prerendered ${route} -> ${path.relative(distDir, outPath)}`);
    } catch (err) {
      failed += 1;
      console.error(`failed to prerender ${route}:`, err instanceof Error ? err.message : err);
    }
  }

  await browser.close();

  if (failed > 0) {
    console.error(`${failed} of ${ROUTES.length} routes failed to prerender`);
    process.exitCode = 1;
  } else {
    console.log(`prerendered ${ROUTES.length} routes to ${path.relative(process.cwd(), outDir)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
