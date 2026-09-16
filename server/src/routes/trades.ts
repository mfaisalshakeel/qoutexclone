import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound, wrap } from '../lib/errors.js';
import { publicTrade } from '../lib/serialize.js';
import { requireActiveUser, requireAuth } from '../middleware/auth.js';
import { DURATIONS, listTrades, placeTrade } from '../services/trading.js';
import { marketFeed } from '../engine/feed.js';

const router = Router();
router.use(requireAuth);

const placeSchema = z.object({
  symbol: z.string().min(3).max(20),
  direction: z.enum(['UP', 'DOWN']),
  // stake arrives in dollars from the UI and is stored in cents
  amount: z.number().positive().max(100000),
  durationSec: z.number().int().refine((d) => (DURATIONS as readonly number[]).includes(d), 'Unsupported expiry'),
  accountType: z.enum(['DEMO', 'REAL']),
});

router.post(
  '/',
  requireActiveUser,
  wrap(async (req, res) => {
    const body = placeSchema.parse(req.body);
    const trade = await placeTrade({
      userId: req.user!.id,
      symbol: body.symbol.toUpperCase(),
      direction: body.direction,
      stake: Math.round(body.amount * 100),
      durationSec: body.durationSec,
      accountType: body.accountType,
    });
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { demoBalance: true, realBalance: true },
    });
    res.status(201).json({ trade: publicTrade(trade), balances: user });
  }),
);

router.get(
  '/',
  wrap(async (req, res) => {
    const query = z
      .object({
        status: z.enum(['OPEN', 'CLOSED']).optional(),
        accountType: z.enum(['DEMO', 'REAL']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const trades = await listTrades(req.user!.id, query);
    res.json({
      trades: trades.map((trade) => ({
        ...publicTrade(trade),
        currentPrice: trade.status === 'OPEN' ? marketFeed.getPrice(trade.symbol) : trade.exitPrice,
      })),
    });
  }),
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const trade = await prisma.trade.findUnique({ where: { id: req.params.id } });
    if (!trade || trade.userId !== req.user!.id) throw notFound('Trade not found');
    res.json({ trade: publicTrade(trade) });
  }),
);

export default router;
