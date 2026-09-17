import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound, wrap } from '../lib/errors.js';
import { publicTrade } from '../lib/serialize.js';
import { requireActiveUser, requireAuth } from '../middleware/auth.js';
import { clockExpiries, listTrades, placeTrade } from '../services/trading.js';
import { marketFeed } from '../engine/feed.js';

const router = Router();
router.use(requireAuth);

const placeSchema = z
  .object({
    symbol: z.string().min(3).max(20),
    direction: z.enum(['UP', 'DOWN']),
    // stake arrives in dollars from the UI and is stored in cents
    amount: z.number().positive().max(100000),
    expiryMode: z.enum(['DURATION', 'CLOCK']).default('DURATION'),
    // the durations a market offers are runtime configuration, so the value is
    // checked against the market in the service rather than pinned here
    durationSec: z.number().int().min(1).max(86400).optional(),
    /** Clock mode: the boundary being bought, in epoch milliseconds. */
    expiresAt: z.number().int().positive().optional(),
    accountType: z.enum(['DEMO', 'REAL', 'TOURNAMENT']),
    tournamentId: z.string().optional(),
  })
  .refine((body) => (body.expiryMode === 'CLOCK' ? body.expiresAt != null : body.durationSec != null), {
    message: 'A duration expiry needs durationSec; a clock expiry needs expiresAt',
    path: ['expiryMode'],
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
      expiryMode: body.expiryMode,
      durationSec: body.durationSec,
      expiresAt: body.expiresAt,
      accountType: body.accountType,
      tournamentId: body.tournamentId,
    });
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { demoBalance: true, realBalance: true },
    });
    const entry = trade.entryId
      ? await prisma.tournamentEntry.findUnique({ where: { id: trade.entryId }, select: { balance: true } })
      : null;
    res
      .status(201)
      .json({ trade: publicTrade(trade), balances: user, tournamentBalance: entry?.balance ?? null });
  }),
);

router.get(
  '/',
  wrap(async (req, res) => {
    const query = z
      .object({
        status: z.enum(['OPEN', 'CLOSED']).optional(),
        accountType: z.enum(['DEMO', 'REAL', 'TOURNAMENT']).optional(),
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

/**
 * The clock boundaries buyable right now, with the countdown to each one's
 * cut-off. Resolved server-side so the terminal's countdown and the validation
 * that accepts the trade come from the same clock.
 */
router.get(
  '/expiries',
  wrap(async (_req, res) => {
    res.json({ slots: clockExpiries(), serverTime: Date.now() });
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
