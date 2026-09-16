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
import { marketFeed } from './engine/feed.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/curl requests have no Origin header.
        if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return callback(null, true);
        callback(new Error('Origin not allowed'));
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
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
