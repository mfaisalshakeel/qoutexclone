/**
 * The web client's caching headers: Vite's content-hashed /assets/* files
 * are safe to cache forever (a new build is a new filename); index.html is
 * the one file that must always be revalidated, since it is what points a
 * returning visitor at the current build's hashed names. A real WEB_DIST
 * build isn't needed to prove this — a controlled fixture directory is more
 * reliable than depending on whichever build happens to exist on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

describe('static asset caching', () => {
  let app: Express;
  let dir: string;
  const original = process.env.WEB_DIST;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantex-web-dist-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>test</body></html>');
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log("hi");');
    process.env.WEB_DIST = dir;
    const { createApp } = await import('../app.js');
    app = createApp();
  });

  afterAll(() => {
    process.env.WEB_DIST = original;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('caches a content-hashed asset for a year, immutably', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('never caches index.html — it has to be revalidated to see a new build', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});
