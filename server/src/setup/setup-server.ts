import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import express, { type Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { buildDatabaseUrl, buildEnvFile, randomSecret } from './env-template.js';

const execFileAsync = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src/setup or server/dist/setup -> server -> repo root, either way
const repoRoot = path.resolve(here, '../../..');
const serverRoot = path.resolve(here, '..', '..');
const envPath = path.join(serverRoot, '.env');
const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');

/**
 * Reused from `app.ts`'s `serveWebClient`, deliberately not imported from
 * there: that file imports `env.js`, which is exactly the module this whole
 * server exists to run *before* — importing it here would defeat the point.
 */
function serveWebClient(app: Express): void {
  const candidates = [
    process.env.WEB_DIST,
    path.resolve(here, '../../web/dist'), // running from server/dist/setup
    path.resolve(here, '../../../web/dist'), // running from source via tsx
  ].filter(Boolean) as string[];
  const dist = candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
  if (!dist) return;

  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(dist, { index: false, maxAge: '5m' }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const dbSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(3306),
  database: z.string().min(1).max(64),
  user: z.string().min(1).max(64),
  password: z.string().max(255).default(''),
});

const installSchema = z.object({
  db: dbSchema,
  admin: z.object({
    email: z.string().email().max(160),
    password: z.string().min(8).max(128),
  }),
});

/** A `SELECT 1` against a candidate connection string — nothing schema-shaped
 *  exists yet, so this is the only thing worth asking the database. */
async function testConnection(databaseUrl: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Prisma's own error text is long and full of internal detail; a
    // first-time installer just needs to know which of the few things that
    // can actually be wrong here is the one that is
    let friendly = 'Could not connect with these details.';
    if (/was denied access on the database/i.test(message)) {
      friendly = 'That user cannot access this database — check the username, password and grants.';
    } else if (/authentication failed|access denied/i.test(message)) {
      friendly = 'Access denied — check the username and password.';
    } else if (/unknown database/i.test(message)) {
      friendly = 'That database does not exist yet — create it first, or check the name.';
    } else if (/can't reach database|econnrefused|etimedout/i.test(message)) {
      friendly = 'Could not reach a database at that host and port.';
    }
    return { ok: false, message: friendly };
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

async function runMigrationsAndSeed(): Promise<void> {
  await execFileAsync('npx', ['--yes', 'prisma', 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: serverRoot,
    env: process.env,
  });

  const compiledSeed = path.join(serverRoot, 'dist', 'seed.js');
  const sourceSeed = path.join(serverRoot, 'src', 'seed.ts');
  if (fs.existsSync(compiledSeed)) {
    await execFileAsync('node', [compiledSeed], { cwd: serverRoot, env: process.env });
  } else {
    await execFileAsync('npx', ['--yes', 'tsx', sourceSeed], { cwd: repoRoot, env: process.env });
  }
}

/**
 * Split from `startSetupServer` so a test can exercise the routes with
 * `supertest` against a real Express app without also binding a port or
 * risking the install route's own `process.exit(0)` — `exitAfterInstall:
 * false` is exactly what a test for that route passes.
 */
export function createSetupApp(options: { exitAfterInstall?: boolean } = {}): Express {
  const exitAfterInstall = options.exitAfterInstall ?? true;
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '64kb' }));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Slow down a little' } },
  });
  app.use('/api/setup', limiter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'quantex-api', setup: true });
  });

  app.get('/api/setup/status', (_req, res) => {
    res.json({ configured: false });
  });

  app.get('/api/setup/requirements', (_req, res) => {
    const nodeVersion = process.versions.node;
    const nodeMajor = Number(nodeVersion.split('.')[0]);
    res.json({
      node: { version: nodeVersion, ok: nodeMajor >= 20, required: '20+' },
      platform: process.platform,
    });
  });

  app.post('/api/setup/test-db', async (req, res) => {
    const parsed = dbSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'validation_error', message: 'Check the connection details.' } });
      return;
    }
    const result = await testConnection(buildDatabaseUrl(parsed.data));
    if (result.ok) res.json({ ok: true });
    else res.status(400).json({ error: { code: 'db_unreachable', message: result.message } });
  });

  app.post('/api/setup/install', async (req, res) => {
    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error: { code: 'validation_error', message: 'Check the form for missing or invalid fields.' },
        });
      return;
    }

    // a second tab, or a second run of the wizard, must not clobber a
    // configuration another request already completed
    if (fs.existsSync(envPath)) {
      const existing = fs.readFileSync(envPath, 'utf8');
      if (/^DATABASE_URL=.+$/m.test(existing)) {
        res
          .status(409)
          .json({
            error: { code: 'already_configured', message: 'This installation is already configured.' },
          });
        return;
      }
    }

    const { db, admin } = parsed.data;
    const databaseUrl = buildDatabaseUrl(db);

    const connection = await testConnection(databaseUrl);
    if (!connection.ok) {
      res.status(400).json({ error: { code: 'db_unreachable', message: connection.message } });
      return;
    }

    const envContent = buildEnvFile({
      databaseUrl,
      jwtSecret: randomSecret(),
      jwtRefreshSecret: randomSecret(),
      admin,
      port: Number(process.env.PORT) || 4000,
    });

    await fsp.writeFile(envPath, envContent, { mode: 0o600 });

    try {
      await runMigrationsAndSeed();
    } catch (err) {
      // leave the installer retry-able rather than stuck half-configured:
      // a failed migration means no schema exists yet, so keeping
      // DATABASE_URL set would make the *next* boot try (and fail) to start
      // the whole app instead of reopening the wizard
      await fsp.rm(envPath, { force: true });
      const stderr =
        err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : '';
      const message = err instanceof Error ? err.message : String(err);
      console.error('[setup] install failed', message, stderr);
      res.status(500).json({
        error: {
          code: 'install_failed',
          message: 'Could not finish setting up the database. Check the server logs for details.',
        },
      });
      return;
    }

    res.json({ ok: true });
    // give the response time to flush before the process exits; a real
    // deployment's process manager (pm2, systemd, cPanel's Node App Manager,
    // Docker's restart policy) brings it back up in configured mode, the
    // same restart-to-apply pattern the CLI installer's own README already
    // asks for after writing `server/.env` by hand
    if (exitAfterInstall) setTimeout(() => process.exit(0), 300);
  });

  serveWebClient(app);

  return app;
}

export async function startSetupServer(): Promise<void> {
  const app = createSetupApp();
  const port = Number(process.env.PORT) || 4000;
  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`[setup] no configuration found — serving the setup wizard on port ${port}`);
      resolve();
    });
  });
}
