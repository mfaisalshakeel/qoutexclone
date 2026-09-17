import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound, wrap } from '../lib/errors.js';
import { TIMEFRAMES, marketFeed } from '../engine/feed.js';
import { durations } from '../services/trading.js';
import { settings } from '../services/settings.js';
import { marketHours } from '../services/market-hours.js';

const router = Router();

router.get(
  '/assets',
  wrap(async (_req, res) => {
    const assets = await prisma.asset.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } });
    const now = new Date();
    // the OTC twin is found in memory rather than with a query per market
    const symbols = new Set(assets.map((asset) => asset.symbol));

    res.json({
      assets: assets.map((asset) => {
        const session = marketHours.stateFor(asset.scheduleId, now);
        const otcSymbol = `${asset.symbol}_OTC`;
        return {
          id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          pair: asset.pair,
          assetClass: asset.assetClass,
          isOtc: asset.isOtc,
          icon: asset.icon,
          base: asset.base,
          quote: asset.quote,
          pipSize: asset.pipSize,
          payoutPct: asset.payoutPct,
          minStake: asset.minStake,
          maxStake: asset.maxStake,
          precision: asset.precision,
          price: marketFeed.getPrice(asset.symbol),
          changePct: Math.round(marketFeed.getChangePct(asset.symbol) * 100) / 100,
          isOpen: session.isOpen,
          nextOpen: session.nextOpen,
          nextClose: session.nextClose,
          holiday: session.holiday ?? null,
          schedule: marketHours.describe(asset.scheduleId),
          otcAlternative: !asset.isOtc && symbols.has(otcSymbol) ? otcSymbol : null,
        };
      }),
      durations: durations(),
      timeframes: Object.keys(TIMEFRAMES),
      provider: marketFeed.provider,
    });
  }),
);

router.get(
  '/candles/:symbol',
  wrap(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const query = z
      .object({
        timeframe: z.enum(['5s', '15s', '1m', '5m']).default('1m'),
        limit: z.coerce.number().int().min(10).max(400).default(200),
      })
      .parse(req.query);

    const asset = await prisma.asset.findUnique({ where: { symbol } });
    if (!asset) throw notFound('Unknown asset');

    res.json({
      symbol,
      timeframe: query.timeframe,
      candles: marketFeed.getCandles(symbol, query.timeframe, query.limit),
      price: marketFeed.getPrice(symbol),
    });
  }),
);

router.get('/prices', (_req, res) => {
  res.json({ prices: marketFeed.getPrices(), provider: marketFeed.provider, ts: Date.now() });
});

/** Public runtime configuration the client renders from. */
router.get('/settings', (_req, res) => {
  res.json({ settings: settings.publicValues() });
});

export default router;
