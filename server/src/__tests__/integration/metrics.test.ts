/**
 * The Prometheus scrape endpoint, against a real running app — real
 * settlement/feed/ws state is read on every scrape, not mocked, so this
 * proves the route actually wires up rather than just typechecking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

async function loadApp(envPatch: Record<string, string> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(envPatch)) process.env[key] = value;
  const request = (await import('supertest')).default;
  const { createApp } = await import('../../app.js');
  return { request, app: createApp() };
}

suite('GET /metrics', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });
  beforeEach(() => {
    if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
  });

  it('serves Prometheus text format with the platform’s own metric names, open by default', async () => {
    const { request, app } = await loadApp({ METRICS_TOKEN: '' });
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    for (const metric of [
      'quantex_trades_placed_total',
      'quantex_trades_settled_total',
      'quantex_settlement_lag_ms',
      'quantex_ws_connections',
      'quantex_ws_online_users',
      'quantex_feed_staleness_ms',
    ]) {
      expect(res.text).toContain(metric);
    }
  });

  it('refuses without the configured token, and serves with it', async () => {
    const { request, app } = await loadApp({ METRICS_TOKEN: 'let-me-in' });

    const noAuth = await request(app).get('/metrics');
    expect(noAuth.status).toBe(401);

    const wrongToken = await request(app).get('/metrics').set('authorization', 'Bearer wrong');
    expect(wrongToken.status).toBe(401);

    const rightToken = await request(app).get('/metrics').set('authorization', 'Bearer let-me-in');
    expect(rightToken.status).toBe(200);
  });
});
