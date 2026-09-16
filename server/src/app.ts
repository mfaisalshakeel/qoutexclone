import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import marketRoutes from './routes/market.js';
import tradeRoutes from './routes/trades.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';
import tournamentRoutes from './routes/tournaments.js';
import supportRoutes from './routes/support.js';
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
  console.log(`[boot] serving web client from ${dist}`);
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
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
  app.use(express.json({ limit: '256kb' }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Slow down a little' } },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'quotex-clone-api',
      feed: marketFeed.provider,
      symbols: marketFeed.symbols.length,
      uptime: Math.round(process.uptime()),
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

  serveWebClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
