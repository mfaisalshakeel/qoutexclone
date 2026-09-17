import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import { publicDeposit, publicUser, publicWithdrawal } from '../lib/serialize.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { applyLedger } from '../services/wallet.js';
import { completeDeposit, rejectDeposit } from '../services/deposits.js';
import { approveWithdrawal, rejectWithdrawal } from '../services/withdrawals.js';
import { marketFeed } from '../engine/feed.js';
import { listKycSubmissions, reviewKyc } from '../services/kyc.js';
import { PROMO_KINDS, describe } from '../services/promos.js';
import { finishTournament, leaderboard, startTournament } from '../services/tournaments.js';
import { listAllTickets, postMessage, readTicket, setTicketStatus } from '../services/support.js';
import { SETTINGS, settings } from '../services/settings.js';
import { marketHours } from '../services/market-hours.js';
import { describeWindows } from '../lib/sessions.js';
import { DEFAULT_OTC_PARAMS, initialState, nextTick, resolveParams } from '../engine/otc.js';

const router = Router();
router.use(requireAuth, requireAdmin);

async function audit(actorId: string, action: string, targetType: string, targetId: string, detail?: string) {
  await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, detail } });
}

router.get(
  '/overview',
  wrap(async (_req, res) => {
    const [
      users,
      openTrades,
      pendingDeposits,
      pendingWithdrawals,
      deposits,
      withdrawals,
      tradeAgg,
      pendingKyc,
      bonuses,
      openTickets,
      liveTournaments,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.trade.count({ where: { status: 'OPEN' } }),
      prisma.deposit.count({ where: { status: { in: ['AWAITING_PAYMENT', 'CONFIRMING'] } } }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      prisma.deposit.aggregate({ _sum: { creditedAmount: true }, where: { status: 'COMPLETED' } }),
      prisma.withdrawal.aggregate({ _sum: { amount: true }, where: { status: 'COMPLETED' } }),
      prisma.trade.aggregate({
        _sum: { stake: true, profit: true },
        where: { accountType: 'REAL', status: { in: ['WON', 'LOST'] } },
      }),
      prisma.kycSubmission.count({ where: { status: 'PENDING' } }),
      prisma.promoRedemption.aggregate({ _sum: { amount: true } }),
      prisma.supportTicket.count({ where: { unreadByAgent: { gt: 0 } } }),
      prisma.tournament.count({ where: { status: 'RUNNING' } }),
    ]);
    res.json({
      users,
      openTrades,
      pendingDeposits,
      pendingWithdrawals,
      depositVolume: deposits._sum.creditedAmount ?? 0,
      withdrawalVolume: withdrawals._sum.amount ?? 0,
      realVolume: tradeAgg._sum.stake ?? 0,
      // house result is the inverse of trader P&L
      housePnl: -(tradeAgg._sum.profit ?? 0),
      pendingKyc,
      bonusPaid: bonuses._sum.amount ?? 0,
      openTickets,
      liveTournaments,
      feedProvider: marketFeed.provider,
    });
  }),
);

router.get(
  '/users',
  wrap(async (req, res) => {
    const query = z
      .object({
        search: z.string().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const users = await prisma.user.findMany({
      where: query.search
        ? { OR: [{ email: { contains: query.search } }, { name: { contains: query.search } }] }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    res.json({ users: users.map(publicUser) });
  }),
);

router.get(
  '/users/:id',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('User not found');
    const [trades, transactions, deposits, withdrawals] = await Promise.all([
      prisma.trade.findMany({ where: { userId: user.id }, orderBy: { openedAt: 'desc' }, take: 25 }),
      prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
      prisma.deposit.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
      prisma.withdrawal.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
    ]);
    res.json({
      user: publicUser(user),
      trades,
      transactions,
      deposits: deposits.map(publicDeposit),
      withdrawals: withdrawals.map(publicWithdrawal),
    });
  }),
);

router.post(
  '/users/:id/status',
  wrap(async (req, res) => {
    const body = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).parse(req.body);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: body.status } });
    await audit(req.user!.id, 'user.status', 'user', user.id, body.status);
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/users/:id/adjust',
  wrap(async (req, res) => {
    const body = z
      .object({
        accountType: z.enum(['DEMO', 'REAL']),
        amount: z.number().refine((n) => n !== 0, 'Amount cannot be zero'),
        note: z.string().max(200).optional(),
      })
      .parse(req.body);
    const cents = Math.round(body.amount * 100);
    await prisma.$transaction(async (tx) => {
      await applyLedger(tx, {
        userId: req.params.id,
        accountType: body.accountType,
        type: 'ADJUSTMENT',
        amount: cents,
        note: body.note ?? 'Manual adjustment by administrator',
      });
    });
    await audit(req.user!.id, 'user.adjust', 'user', req.params.id, `${body.accountType} ${cents}`);
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    res.json({ user: publicUser(user!) });
  }),
);

/* -------------------------------- deposits ------------------------------- */

router.get(
  '/deposits',
  wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const deposits = await prisma.deposit.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { email: true, name: true } } },
    });
    res.json({
      deposits: deposits.map((d) => ({ ...publicDeposit(d), user: d.user })),
    });
  }),
);

router.post(
  '/deposits/:id/confirm',
  wrap(async (req, res) => {
    const body = z
      .object({
        txHash: z.string().max(120).optional(),
        cryptoAmount: z.string().max(40).optional(),
        note: z.string().max(200).optional(),
      })
      .parse(req.body ?? {});
    const deposit = await completeDeposit(req.params.id, body);
    await audit(req.user!.id, 'deposit.confirm', 'deposit', deposit.id);
    res.json({ deposit: publicDeposit(deposit) });
  }),
);

router.post(
  '/deposits/:id/reject',
  wrap(async (req, res) => {
    const body = z.object({ note: z.string().min(2).max(200) }).parse(req.body);
    const deposit = await rejectDeposit(req.params.id, body.note);
    await audit(req.user!.id, 'deposit.reject', 'deposit', deposit.id, body.note);
    res.json({ deposit: publicDeposit(deposit) });
  }),
);

/* ------------------------------ withdrawals ------------------------------ */

router.get(
  '/withdrawals',
  wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const withdrawals = await prisma.withdrawal.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { email: true, name: true, totalDeposited: true } } },
    });
    res.json({ withdrawals: withdrawals.map((w) => ({ ...publicWithdrawal(w), user: w.user })) });
  }),
);

router.post(
  '/withdrawals/:id/approve',
  wrap(async (req, res) => {
    const body = z.object({ note: z.string().max(200).optional() }).parse(req.body ?? {});
    const withdrawal = await approveWithdrawal(req.params.id, req.user!.id, body.note);
    await audit(
      req.user!.id,
      'withdrawal.approve',
      'withdrawal',
      withdrawal.id,
      withdrawal.txHash ?? undefined,
    );
    res.json({ withdrawal: publicWithdrawal(withdrawal) });
  }),
);

router.post(
  '/withdrawals/:id/reject',
  wrap(async (req, res) => {
    const body = z.object({ note: z.string().min(2).max(200) }).parse(req.body);
    const withdrawal = await rejectWithdrawal(req.params.id, req.user!.id, body.note);
    await audit(req.user!.id, 'withdrawal.reject', 'withdrawal', withdrawal.id, body.note);
    res.json({ withdrawal: publicWithdrawal(withdrawal) });
  }),
);

/* ---------------------------------- kyc ---------------------------------- */

router.get(
  '/kyc',
  wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json({ submissions: await listKycSubmissions(status) });
  }),
);

router.post(
  '/kyc/:id/review',
  wrap(async (req, res) => {
    const body = z
      .object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().max(300).optional() })
      .parse(req.body);
    if (body.decision === 'REJECTED' && !body.note) {
      throw badRequest('A reason is required when rejecting a verification', 'note_required');
    }
    const submission = await reviewKyc(req.params.id, req.user!.id, body.decision, body.note);
    await audit(req.user!.id, 'kyc.review', 'kyc', submission.id, body.decision);
    res.json({ submission });
  }),
);

/* ------------------------------- promo codes ------------------------------ */

router.get(
  '/promos',
  wrap(async (_req, res) => {
    const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ promos: promos.map((promo) => ({ ...promo, description: describe(promo) })) });
  }),
);

router.post(
  '/promos',
  wrap(async (req, res) => {
    const body = z
      .object({
        code: z.string().min(3).max(32),
        kind: z.enum(PROMO_KINDS).default('DEPOSIT_BONUS_PCT'),
        value: z.number().int().positive(),
        minDeposit: z.number().int().min(0).default(0),
        maxBonus: z.number().int().min(0).default(0),
        maxRedemptions: z.number().int().min(0).default(0),
        expiresAt: z.string().datetime().optional(),
      })
      .parse(req.body);

    const code = body.code.trim().toUpperCase();
    const existing = await prisma.promoCode.findUnique({ where: { code } });
    if (existing) throw badRequest('That code already exists', 'code_taken');

    const promo = await prisma.promoCode.create({
      data: { ...body, code, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null },
    });
    await audit(req.user!.id, 'promo.create', 'promo', promo.id, code);
    res.status(201).json({ promo: { ...promo, description: describe(promo) } });
  }),
);

router.patch(
  '/promos/:id',
  wrap(async (req, res) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        value: z.number().int().positive().optional(),
        maxRedemptions: z.number().int().min(0).optional(),
      })
      .parse(req.body);
    const promo = await prisma.promoCode.update({ where: { id: req.params.id }, data: body });
    await audit(req.user!.id, 'promo.update', 'promo', promo.id, JSON.stringify(body));
    res.json({ promo: { ...promo, description: describe(promo) } });
  }),
);

/* ------------------------------- tournaments ------------------------------ */

router.get(
  '/tournaments',
  wrap(async (_req, res) => {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { startsAt: 'desc' },
      take: 50,
      include: { _count: { select: { entries: true } } },
    });
    res.json({ tournaments: tournaments.map((t) => ({ ...t, entrants: t._count.entries })) });
  }),
);

router.post(
  '/tournaments',
  wrap(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(3).max(120),
        description: z.string().max(500).optional(),
        entryFee: z.number().int().min(0).default(0),
        prizePool: z.number().int().min(0).default(0),
        startingBalance: z.number().int().min(1000).default(100000),
        maxEntries: z.number().int().min(0).default(0),
        prizeSplit: z.string().max(60).default('50,30,20'),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
      })
      .parse(req.body);

    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) throw badRequest('The tournament must end after it starts', 'bad_window');

    const tournament = await prisma.tournament.create({ data: { ...body, startsAt, endsAt } });
    await audit(req.user!.id, 'tournament.create', 'tournament', tournament.id, tournament.name);
    res.status(201).json({ tournament });
  }),
);

router.get(
  '/tournaments/:id/leaderboard',
  wrap(async (req, res) => {
    res.json({ leaderboard: await leaderboard(req.params.id, 100) });
  }),
);

router.post(
  '/tournaments/:id/start',
  wrap(async (req, res) => {
    const tournament = await startTournament(req.params.id);
    await audit(req.user!.id, 'tournament.start', 'tournament', tournament.id);
    res.json({ tournament });
  }),
);

router.post(
  '/tournaments/:id/finish',
  wrap(async (req, res) => {
    const tournament = await finishTournament(req.params.id);
    await audit(req.user!.id, 'tournament.finish', 'tournament', tournament.id);
    res.json({ tournament });
  }),
);

/* --------------------------------- support -------------------------------- */

router.get(
  '/support',
  wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json({ tickets: await listAllTickets(status) });
  }),
);

router.get(
  '/support/:id',
  wrap(async (req, res) => {
    res.json({ ticket: await readTicket(req.params.id, req.user!.id, true) });
  }),
);

router.post(
  '/support/:id/reply',
  wrap(async (req, res) => {
    const body = z.object({ message: z.string().min(1).max(2000) }).parse(req.body);
    const message = await postMessage({
      ticketId: req.params.id,
      senderId: req.user!.id,
      body: body.message,
      fromSupport: true,
    });
    res.status(201).json({ message });
  }),
);

router.post(
  '/support/:id/status',
  wrap(async (req, res) => {
    const body = z.object({ status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']) }).parse(req.body);
    const ticket = await setTicketStatus(req.params.id, body.status);
    res.json({ ticket });
  }),
);

/* ------------------------------- otc engine ------------------------------- */

const otcConfigSchema = z
  .object({
    baseVolatility: z.number().min(0.00001).max(0.05),
    garchAlpha: z.number().min(0).max(0.9),
    garchBeta: z.number().min(0).max(0.99),
    trendShare: z.number().min(0).max(1),
    regimeMinMinutes: z.number().min(0.5).max(240),
    regimeMaxMinutes: z.number().min(0.5).max(480),
    trendStrength: z.number().min(0).max(3),
    meanReversion: z.number().min(0).max(0.2),
    anchorDriftPerHour: z.number().min(0).max(0.5),
    spikeProbability: z.number().min(0).max(0.05),
    spikeSigmaMultiple: z.number().min(1).max(12),
    maxTickMove: z.number().min(0.0002).max(0.05),
    tickMs: z.number().int().min(50).max(10000),
    followSpot: z.boolean(),
  })
  .partial();

router.get(
  '/otc/:symbol',
  wrap(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const asset = await prisma.asset.findUnique({ where: { symbol } });
    if (!asset) throw notFound('Market not found');

    res.json({
      symbol,
      pair: asset.pair,
      isOtc: asset.isOtc,
      defaults: DEFAULT_OTC_PARAMS,
      overrides: asset.otcConfig ?? {},
      effective: marketFeed.paramsFor(symbol) ?? resolveParams({ baseVolatility: asset.volatility }),
    });
  }),
);

/**
 * Renders a candle preview from the engine without touching the live feed, so
 * an operator can see what a parameter change does before saving it.
 */
router.post(
  '/otc/:symbol/preview',
  wrap(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const asset = await prisma.asset.findUnique({ where: { symbol } });
    if (!asset) throw notFound('Market not found');

    const body = z
      .object({
        overrides: otcConfigSchema.optional(),
        candles: z.number().int().min(20).max(300).default(120),
      })
      .parse(req.body ?? {});

    const params = resolveParams({
      baseVolatility: asset.volatility,
      ...((asset.otcConfig as Record<string, number> | null) ?? {}),
      ...(body.overrides ?? {}),
    });

    // one preview candle per 60 engine seconds, from a fresh seeded state
    const ticksPerCandle = Math.max(1, Math.round(60_000 / params.tickMs));
    let state = initialState(`${symbol}:preview`, asset.basePrice, params);
    const candles: { time: number; open: number; high: number; low: number; close: number }[] = [];
    const startedAt = Math.floor(Date.now() / 1000) - body.candles * 60;

    for (let index = 0; index < body.candles; index += 1) {
      const open = state.price;
      let high = open;
      let low = open;
      for (let tick = 0; tick < ticksPerCandle; tick += 1) {
        state = nextTick({ state, params, precision: asset.precision });
        high = Math.max(high, state.price);
        low = Math.min(low, state.price);
      }
      candles.push({ time: startedAt + index * 60, open, high, low, close: state.price });
    }

    res.json({ symbol, params, candles });
  }),
);

router.put(
  '/otc/:symbol',
  wrap(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const body = z.object({ overrides: otcConfigSchema.nullable() }).parse(req.body);

    const asset = await prisma.asset.findUnique({ where: { symbol } });
    if (!asset) throw notFound('Market not found');
    if (body.overrides && body.overrides.regimeMaxMinutes && body.overrides.regimeMinMinutes) {
      if (body.overrides.regimeMaxMinutes < body.overrides.regimeMinMinutes) {
        throw badRequest('The longest regime must not be shorter than the shortest', 'invalid_regime');
      }
    }

    // Prisma needs the explicit JsonNull sentinel to clear a nullable Json column
    await prisma.asset.update({
      where: { symbol },
      data: { otcConfig: body.overrides ?? Prisma.DbNull },
    });
    // the running feed picks the change up immediately
    marketFeed.applyConfig(symbol, body.overrides ?? null);
    await audit(req.user!.id, 'otc.config', 'asset', asset.id, JSON.stringify(body.overrides ?? {}));

    res.json({ symbol, overrides: body.overrides ?? {}, effective: marketFeed.paramsFor(symbol) });
  }),
);

/* ------------------------------- schedules -------------------------------- */

const windowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(1).max(2880),
});

router.get(
  '/schedules',
  wrap(async (_req, res) => {
    const schedules = await prisma.tradingSchedule.findMany({
      orderBy: { key: 'asc' },
      include: {
        windows: { orderBy: [{ dayOfWeek: 'asc' }, { openMinute: 'asc' }] },
        holidays: { orderBy: { date: 'asc' } },
        _count: { select: { assets: true } },
      },
    });
    res.json({
      schedules: schedules.map((schedule) => ({
        ...schedule,
        markets: schedule._count.assets,
        hours: describeWindows(schedule.windows),
        state: marketHours.stateFor(schedule.id),
      })),
    });
  }),
);

router.put(
  '/schedules/:id/windows',
  wrap(async (req, res) => {
    const body = z.object({ windows: z.array(windowSchema).max(40) }).parse(req.body);
    const schedule = await prisma.tradingSchedule.findUnique({ where: { id: req.params.id } });
    if (!schedule) throw notFound('Schedule not found');

    for (const window of body.windows) {
      if (window.closeMinute <= window.openMinute) {
        throw badRequest('Each window must close after it opens', 'invalid_window');
      }
    }

    // windows describe one calendar, so they are replaced as a set
    await prisma.$transaction([
      prisma.scheduleWindow.deleteMany({ where: { scheduleId: schedule.id } }),
      prisma.scheduleWindow.createMany({
        data: body.windows.map((window) => ({ ...window, scheduleId: schedule.id })),
      }),
    ]);
    await marketHours.reload();
    await audit(req.user!.id, 'schedule.windows', 'schedule', schedule.id, `${body.windows.length} windows`);
    res.json({ ok: true, hours: describeWindows(body.windows) });
  }),
);

router.post(
  '/schedules/:id/holidays',
  wrap(async (req, res) => {
    const body = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
        name: z.string().min(2).max(80),
      })
      .parse(req.body);
    const schedule = await prisma.tradingSchedule.findUnique({ where: { id: req.params.id } });
    if (!schedule) throw notFound('Schedule not found');

    const holiday = await prisma.marketHoliday.upsert({
      where: { scheduleId_date: { scheduleId: schedule.id, date: body.date } },
      update: { name: body.name },
      create: { scheduleId: schedule.id, date: body.date, name: body.name },
    });
    await marketHours.reload();
    await audit(req.user!.id, 'schedule.holiday.add', 'schedule', schedule.id, `${body.date} ${body.name}`);
    res.status(201).json({ holiday });
  }),
);

router.delete(
  '/schedules/:id/holidays/:holidayId',
  wrap(async (req, res) => {
    const deleted = await prisma.marketHoliday.deleteMany({
      where: { id: req.params.holidayId, scheduleId: req.params.id },
    });
    if (deleted.count === 0) throw notFound('Holiday not found');
    await marketHours.reload();
    await audit(req.user!.id, 'schedule.holiday.remove', 'schedule', req.params.id, req.params.holidayId);
    res.json({ ok: true });
  }),
);

/* -------------------------------- settings -------------------------------- */

router.get(
  '/settings',
  wrap(async (_req, res) => {
    res.json({ settings: settings.describe() });
  }),
);

router.patch(
  '/settings',
  wrap(async (req, res) => {
    const known = Object.keys(SETTINGS);
    const body = z.record(z.unknown()).parse(req.body);

    const unknownKeys = Object.keys(body).filter((key) => !known.includes(key));
    if (unknownKeys.length)
      throw badRequest(`Unknown settings: ${unknownKeys.join(', ')}`, 'unknown_setting');

    const applied = await settings.setMany(body);
    for (const [key, value] of Object.entries(applied)) {
      await audit(req.user!.id, 'setting.update', 'setting', key, JSON.stringify(value));
    }
    res.json({ settings: settings.describe(), applied });
  }),
);

router.post(
  '/settings/:key/reset',
  wrap(async (req, res) => {
    const key = req.params.key as keyof typeof SETTINGS;
    if (!SETTINGS[key]) throw badRequest(`Unknown setting: ${req.params.key}`, 'unknown_setting');
    const value = await settings.reset(key);
    await audit(req.user!.id, 'setting.reset', 'setting', req.params.key);
    res.json({ key, value, settings: settings.describe() });
  }),
);

/* --------------------------------- assets -------------------------------- */

router.get(
  '/assets',
  wrap(async (req, res) => {
    const query = z
      .object({ assetClass: z.string().optional(), search: z.string().max(60).optional() })
      .parse(req.query);

    const assets = await prisma.asset.findMany({
      where: {
        ...(query.assetClass ? { assetClass: query.assetClass } : {}),
        ...(query.search
          ? { OR: [{ symbol: { contains: query.search } }, { name: { contains: query.search } }] }
          : {}),
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({
      assets: assets.map((asset) => {
        const session = marketHours.stateFor(asset.scheduleId);
        return {
          ...asset,
          price: marketFeed.getPrice(asset.symbol),
          isOpen: session.isOpen,
          nextOpen: session.nextOpen,
          schedule: marketHours.describe(asset.scheduleId),
        };
      }),
    });
  }),
);

router.patch(
  '/assets/:id',
  wrap(async (req, res) => {
    const body = z
      .object({
        payoutPct: z.number().int().min(10).max(500).optional(),
        minStake: z.number().int().min(1).optional(),
        maxStake: z.number().int().min(100).optional(),
        enabled: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        scheduleId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const asset = await prisma.asset.update({ where: { id: req.params.id }, data: body });
    await audit(req.user!.id, 'asset.update', 'asset', asset.id, JSON.stringify(body));
    res.json({ asset });
  }),
);

router.get(
  '/audit',
  wrap(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { email: true } } },
    });
    res.json({ logs });
  }),
);

export default router;
