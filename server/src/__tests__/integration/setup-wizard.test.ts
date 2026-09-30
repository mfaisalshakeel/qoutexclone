/**
 * The setup wizard's HTTP surface (`server/src/setup/setup-server.ts`) — the
 * one server this codebase runs *before* `DATABASE_URL` exists, so it cannot
 * import `env.js`/`app.js` and cannot be exercised through `createApp()`
 * like everything else. `createSetupApp({ exitAfterInstall: false })` is
 * the same app the real process serves, minus the `process.exit(0)` a real
 * install schedules once it hands off to a process manager to restart into
 * configured mode — which is exactly what would end this test file's own
 * process too.
 *
 * The full happy path (`POST /install` actually writing `server/.env`,
 * running `prisma migrate deploy` and seeding, then the process really
 * exiting) was verified by hand instead of here: it shells out to spawn
 * `npx prisma migrate deploy` and a seed script against a real throwaway
 * database, several real seconds of work each run, and a real process exit
 * — reproducing it as a fast, hermetic unit test would mean faking the one
 * thing worth proving. What *is* unit-tested here is everything the route
 * decides before or around that: request validation, the connection check,
 * and the guard that refuses a second install once one has already run.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const TEST_DB = process.env.TEST_DATABASE_URL;

function parseMysqlUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    database: parsed.pathname.replace(/^\//, ''),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

describe('setup wizard', () => {
  let app: Express;

  const load = async () => {
    if (!app) {
      const { createSetupApp } = await import('../../setup/setup-server.js');
      app = createSetupApp({ exitAfterInstall: false });
    }
    return app;
  };

  it('reports itself as not configured', async () => {
    const res = await request(await load()).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  it('reports the running Node version against the minimum this app requires', async () => {
    const res = await request(await load()).get('/api/setup/requirements');
    expect(res.status).toBe(200);
    expect(res.body.node.required).toBe('20+');
    expect(typeof res.body.node.ok).toBe('boolean');
  });

  it('refuses a malformed connection test', async () => {
    const res = await request(await load()).post('/api/setup/test-db').send({ host: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('reports a database it cannot reach', async () => {
    const res = await request(await load())
      .post('/api/setup/test-db')
      // nothing listens on port 1 — a fast, guaranteed refusal, not a hang
      .send({ host: '127.0.0.1', port: 1, database: 'quotex', user: 'quotex', password: 'quotex' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('db_unreachable');
  }, 15_000);

  it('refuses a malformed install request the same way', async () => {
    const res = await request(await load())
      .post('/api/setup/install')
      .send({ db: { host: '127.0.0.1' }, admin: { email: 'not-an-email', password: 'short' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // this repo's own checkout always has `server/.env` (every other test file
  // depends on it), so the route's "already configured" guard is exercised
  // against the real file the wizard itself would check — not a fake
  it('refuses to install over a configuration that already exists', async () => {
    const res = await request(await load())
      .post('/api/setup/install')
      .send({
        db: { host: '127.0.0.1', port: 3306, database: 'quotex', user: 'quotex', password: 'quotex' },
        admin: { email: 'admin@quotexclone.dev', password: 'Password123' },
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_configured');
  });

  const suite = TEST_DB ? it : it.skip;
  suite('confirms a real, reachable database', async () => {
    const res = await request(await load())
      .post('/api/setup/test-db')
      .send(parseMysqlUrl(TEST_DB!));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
