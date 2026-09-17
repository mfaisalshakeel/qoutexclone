import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import { marketFeed } from '../engine/feed.js';
import { TIMEFRAME_KEYS, isTimeframe } from '../engine/timeframes.js';
import { candleStore } from '../services/candles.js';
import { clockConfig, clockExpiries, durations, durationsFor, expiryModes } from '../services/trading.js';
import { settings } from '../services/settings.js';
import { marketHours } from '../services/market-hours.js';
import { payouts } from '../services/payouts.js';

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
        // the payout a trade opened this instant would be locked at
        const payout = payouts.resolve(
          {
            id: asset.id,
            symbol: asset.symbol,
            assetClass: asset.assetClass,
            payoutPct: asset.payoutPct,
            volatility: asset.volatility,
          },
          { at: now },
        );
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
          payoutPct: payout.pct,
          basePayoutPct: payout.basePct,
          // what moved it, so the ticket can say why rather than just show a number
          payoutAdjustments: payout.applied.map((rule) => ({
            name: rule.name,
            kind: rule.kind,
            adjustment: rule.adjustment,
          })),
          durations: durationsFor(asset),
          minStake: asset.minStake,
          maxStake: asset.maxStake,
          precision: asset.precision,
          price: marketFeed.getPrice(asset.symbol),
          priceSource: marketFeed.sourceFor(asset.symbol),
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
      // ticket configuration: what the stake buttons offer and whether a
      // position may be repeated
      ticket: {
        presets: settings.get('trading.amountPresets'),
        step: settings.get('trading.amountStep'),
        allowRepeat: settings.get('trading.allowRepeat'),
        hotkeys: settings.get('trading.hotkeysEnabled'),
      },
      // expiry is resolved server-side; the terminal renders what it is told
      expiry: {
        modes: expiryModes(),
        clock: { ...clockConfig(), slots: clockExpiries(now.getTime()) },
      },
      timeframes: TIMEFRAME_KEYS,
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
        timeframe: z.string().default('1m'),
        limit: z.coerce.number().int().min(10).max(500).default(200),
        /** paging cursor: return candles strictly older than this bucket */
        before: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    if (!isTimeframe(query.timeframe)) throw badRequest('Unknown timeframe', 'invalid_timeframe');

    const asset = await prisma.asset.findUnique({ where: { symbol } });
    if (!asset) throw notFound('Unknown asset');

    const candles = await candleStore.history(symbol, query.timeframe, {
      before: query.before,
      limit: query.limit,
    });

    // the live (unclosed) bucket lives in the feed, not the store
    const live = query.before ? [] : marketFeed.getCandles(symbol, query.timeframe, 1);
    const merged = [...candles];
    for (const candle of live) {
      const last = merged[merged.length - 1];
      if (last && last.time === candle.time) merged[merged.length - 1] = candle;
      else if (!last || candle.time > last.time) merged.push(candle);
    }

    res.json({
      symbol,
      timeframe: query.timeframe,
      candles: merged,
      // null when the market has no more history to page into
      nextBefore: candles.length === query.limit ? candles[0].time : null,
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
