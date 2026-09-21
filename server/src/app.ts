import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requestLog } from './middleware/request-log.js';
import { log } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import marketRoutes from './routes/market.js';
import tradeRoutes from './routes/trades.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';
import tournamentRoutes from './routes/tournaments.js';
import supportRoutes from './routes/support.js';
import webhookRoutes from './routes/webhooks.js';
import { marketFeed } from './engine/feed.js';

/**
 * Single-port deployment: when the web client has been built, the API serves
 * it too, so the whole platform runs as one process behind one domain. If the
 * build is missing the API simply keeps serving /api and nothing else.
 */
function serveWebClient(app: express.Express): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.WEB_DIST,
    path.resolve(here, '../../web/dist'), // running from server/dist
    path.resolve(here, '../../../web/dist'), // running from source via tsx
  ].filter(Boolean) as string[];

  const dist = candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
  if (!dist) return;

  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
  log.boot.info({ dist }, 'serving web client');
}

/** A feed quieter than this means the price engine has stalled. */
const FEED_STALE_MS = 10_000;

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(requestLog);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // the single-port build serves the SPA from here: allow its socket,
      // Google Fonts and canvas-generated images
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header means same-origin or a non-browser client.
        if (!origin || env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Answer without CORS headers rather than failing the request: the
        // browser still blocks the cross-origin read, while same-origin asset
        // requests (single-port deployments) keep working.
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: '256kb',
      // captured for webhook signature verification — a provider signs the
      // exact bytes it sent, and re-serialising the parsed JSON would not
      // reliably reproduce them
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Slow down a little' } },
    }),
  );

  // liveness: the process is up and serving
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'quantex-api',
      version: process.env.npm_package_version ?? 'dev',
      uptime: Math.round(process.uptime()),
    });
  });

  /**
   * Readiness: only true when this instance can actually serve traffic — the
   * database answers and the feed is ticking. Load balancers should gate on
   * this, not on liveness.
   */
  app.get('/api/ready', async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (err) {
      checks.database = { ok: false, detail: (err as Error).message };
    }

    const symbols = marketFeed.symbols.length;
    const tickAge = marketFeed.lastTickAge();
    const feedFresh = tickAge !== null && tickAge < FEED_STALE_MS;
    checks.feed = {
      ok: symbols > 0 && feedFresh,
      detail:
        symbols === 0
          ? 'no markets loaded'
          : tickAge === null
            ? 'no ticks yet'
            : `last tick ${tickAge}ms ago`,
    };

    const ok = Object.values(checks).every((check) => check.ok);
    res.status(ok ? 200 : 503).json({
      ok,
      provider: marketFeed.provider,
      symbols,
      checks,
      // a provider falling back to the broker engine is degraded, not unready
      providers: marketFeed.providerHealth(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/me', userRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/trades', tradeRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api/support', supportRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/webhooks', webhookRoutes);

  serveWebClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
