import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import {
  buildFilterWhere,
  buildOrderBy,
  buildSearchWhere,
  combineWhere,
  listQuerySchema,
  paginateOffset,
  streamCsvExport,
} from '../lib/list-query.js';
import { publicDeposit, publicUser, publicWithdrawal } from '../lib/serialize.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { applyLedger } from '../services/wallet.js';
import { completeDeposit, rejectDeposit } from '../services/deposits.js';
import { approveWithdrawal, rejectWithdrawal } from '../services/withdrawals.js';
import { marketFeed } from '../engine/feed.js';
import { reviewKyc } from '../services/kyc.js';
import { PROMO_KINDS, describe } from '../services/promos.js';
import { adminLeaderboardPage, finishTournament, startTournament } from '../services/tournaments.js';
import { postMessage, readTicket, setTicketStatus } from '../services/support.js';
import { SETTINGS, settings } from '../services/settings.js';
import { mailTransportName, sendTestEmail, smtpReady } from '../services/mailer.js';
import { previewAll } from '../services/email-preview.js';
import { levelFor, statusConfig } from '../services/status.js';
import * as marketplace from '../services/marketplace.js';
import { forfeitAll, listOffers } from '../services/bonuses.js';
import * as paymentsService from '../services/payments.js';
import { ITEM_KINDS } from '../services/marketplace.js';
import { marketHours } from '../services/market-hours.js';
import { describeWindows } from '../lib/sessions.js';
import { DEFAULT_OTC_PARAMS, initialState, nextTick, resolveParams } from '../engine/otc.js';
import { resolvePayout } from '../engine/payout.js';
import { RULE_KINDS, parseRuleConfig, payouts } from '../services/payouts.js';
import { exposureByMarket } from '../services/risk.js';
import { dashboardOverview } from '../services/admin-stats.js';
import { dashboardCharts } from '../services/admin-charts.js';

const router = Router();
router.use(requireAuth, requireAdmin);

async function audit(actorId: string, action: string, targetType: string, targetId: string, detail?: string) {
  await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, detail } });
}

router.get(
  '/overview',
  wrap(async (req, res) => {
    const query = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    const overview = await dashboardOverview(query);
    res.json({
      ...overview,
      feedProvider: marketFeed.provider,
      providers: marketFeed.providerHealth(),
    });
  }),
);

/** Trailing-window charts: deposits/withdrawals and house P&L over time, a
 *  registration→FTD funnel, volume by asset class and top assets, live
 *  exposure, and an hourly activity heatmap. */
router.get(
  '/charts',
  wrap(async (req, res) => {
    const query = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }).parse(req.query);
    res.json(await dashboardCharts(query.days));
  }),
);

/** Fields a `/users` list request may search, sort or filter on. */
const USER_SEARCH_FIELDS = ['email', 'name'] as const;
const USER_SORT_FIELDS = ['createdAt', 'email', 'name', 'totalDeposited', 'totalWithdrawn'] as const;
const USER_FILTERS = {
  status: { type: 'enum', values: ['ACTIVE', 'SUSPENDED'] },
  kycStatus: { type: 'enum', values: ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] },
  createdAt: { type: 'dateRange' },
} as const;

function usersListWhere(req: { query: Record<string, unknown> }) {
  const query = listQuerySchema.parse(req.query);
  return {
    query,
    where: combineWhere(
      buildSearchWhere(query.search, USER_SEARCH_FIELDS),
      buildFilterWhere(USER_FILTERS, req.query as Record<string, string | undefined>),
    ),
    orderBy: buildOrderBy(query.sort, USER_SORT_FIELDS, { createdAt: 'desc' }),
  };
}

router.get(
  '/users',
  wrap(async (req, res) => {
    // pageSize defaults to the old endpoint's fixed limit, so a client that
    // has not adopted pagination yet still sees the same first page it always did
    const { query, where, orderBy } = usersListWhere({ query: { pageSize: '50', ...req.query } });
    const page = await paginateOffset({
      findMany: (args) =>
        prisma.user.findMany(
          args as {
            where: Prisma.UserWhereInput;
            orderBy: Prisma.UserOrderByWithRelationInput[];
            skip: number;
            take: number;
          },
        ),
      count: (args) => prisma.user.count(args as { where: Prisma.UserWhereInput }),
      where,
      orderBy,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      users: page.items.map(publicUser),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
  }),
);

/** The same search/sort/filter as the list, but every matching row, streamed. */
router.get(
  '/users/export',
  wrap(async (req, res) => {
    const { where, orderBy } = usersListWhere({ query: req.query as Record<string, unknown> });
    await streamCsvExport<Prisma.UserGetPayload<object>>(
      res,
      'traders.csv',
      ['Email', 'Name', 'Country', 'Status', 'KYC', 'Created', 'Deposited (USD)', 'Withdrawn (USD)'],
      (user) => [
        user.email,
        user.name,
        user.country ?? '',
        user.status,
        user.kycStatus,
        user.createdAt.toISOString(),
        (user.totalDeposited / 100).toFixed(2),
        (user.totalWithdrawn / 100).toFixed(2),
      ],
      (skip, take) =>
        prisma.user.findMany({
          where: where as Prisma.UserWhereInput,
          orderBy: orderBy as Prisma.UserOrderByWithRelationInput[],
          skip,
          take,
        }),
    );
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

const DEPOSIT_SEARCH_FIELDS = ['user.email', 'user.name', 'address', 'txHash'] as const;
const DEPOSIT_SORT_FIELDS = ['createdAt', 'creditedAmount', 'confirmedAt'] as const;
const DEPOSIT_FILTERS = {
  status: {
    type: 'enum',
    values: ['AWAITING_PAYMENT', 'CONFIRMING', 'COMPLETED', 'REJECTED', 'EXPIRED'],
  },
  currency: { type: 'enum', values: ['BTC', 'ETH', 'USDT', 'USD'] },
  createdAt: { type: 'dateRange' },
} as const;

router.get(
  '/deposits',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = combineWhere(
      buildSearchWhere(query.search, DEPOSIT_SEARCH_FIELDS),
      buildFilterWhere(DEPOSIT_FILTERS, req.query as Record<string, string | undefined>),
    );
    const orderBy = buildOrderBy(query.sort, DEPOSIT_SORT_FIELDS, { createdAt: 'desc' });

    const page = await paginateOffset({
      findMany: (args) =>
        prisma.deposit.findMany({
          ...(args as {
            where: Prisma.DepositWhereInput;
            orderBy: Prisma.DepositOrderByWithRelationInput[];
            skip: number;
            take: number;
          }),
          include: { user: { select: { email: true, name: true } } },
        }),
      count: (args) => prisma.deposit.count(args as { where: Prisma.DepositWhereInput }),
      where,
      orderBy,
      page: query.page,
      pageSize: query.pageSize,
    });

    res.json({
      // externalRef is the provider's own checkout/session reference — not
      // secret, and useful to an operator matching a support ticket to a
      // provider's own dashboard, so it rides along here though not in the
      // trader-facing shape
      deposits: page.items.map((d) => ({ ...publicDeposit(d), user: d.user, externalRef: d.externalRef })),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
  }),
);

router.get(
  '/deposits/export',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = combineWhere(
      buildSearchWhere(query.search, DEPOSIT_SEARCH_FIELDS),
      buildFilterWhere(DEPOSIT_FILTERS, req.query as Record<string, string | undefined>),
    );
    const orderBy = buildOrderBy(query.sort, DEPOSIT_SORT_FIELDS, { createdAt: 'desc' });
    await streamCsvExport(
      res,
      'deposits.csv',
      ['Trader', 'Currency', 'Amount (crypto)', 'Credited (USD)', 'Status', 'Created'],
      (d: Prisma.DepositGetPayload<{ include: { user: { select: { email: true } } } }>) => [
        d.user.email,
        d.currency,
        d.cryptoAmount,
        (d.creditedAmount / 100).toFixed(2),
        d.status,
        d.createdAt.toISOString(),
      ],
      (skip, take) =>
        prisma.deposit.findMany({
          where: where as Prisma.DepositWhereInput,
          orderBy: orderBy as Prisma.DepositOrderByWithRelationInput[],
          skip,
          take,
          include: { user: { select: { email: true } } },
        }),
    );
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

    // withdrawal priority is a status perk: a higher level is served first, and
    // within a level the oldest request still goes first. Only the pending
    // queue is reordered — history stays in the order things happened.
    const config = statusConfig();
    const rows = withdrawals.map((w) => ({
      ...publicWithdrawal(w),
      user: w.user,
      level: levelFor(w.user.totalDeposited, config),
    }));
    if (status === 'PENDING') {
      rows.sort(
        (a, b) =>
          b.level.priority - a.level.priority ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
    res.json({ withdrawals: rows });
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

const KYC_SEARCH_FIELDS = ['user.email', 'fullName', 'documentNumber'] as const;
const KYC_SORT_FIELDS = ['createdAt', 'reviewedAt', 'fullName'] as const;
const KYC_FILTERS = {
  status: { type: 'enum', values: ['PENDING', 'APPROVED', 'REJECTED'] },
  documentType: { type: 'enum', values: ['PASSPORT', 'ID_CARD', 'DRIVING_LICENCE'] },
  createdAt: { type: 'dateRange' },
} as const;

router.get(
  '/kyc',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = combineWhere(
      buildSearchWhere(query.search, KYC_SEARCH_FIELDS),
      buildFilterWhere(KYC_FILTERS, req.query as Record<string, string | undefined>),
    );
    const orderBy = buildOrderBy(query.sort, KYC_SORT_FIELDS, { createdAt: 'desc' });
    const page = await paginateOffset({
      findMany: (args) =>
        prisma.kycSubmission.findMany({
          ...(args as {
            where: Prisma.KycSubmissionWhereInput;
            orderBy: Prisma.KycSubmissionOrderByWithRelationInput[];
            skip: number;
            take: number;
          }),
          include: { user: { select: { email: true, name: true, realBalance: true } } },
        }),
      count: (args) => prisma.kycSubmission.count(args as { where: Prisma.KycSubmissionWhereInput }),
      where,
      orderBy,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      submissions: page.items,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
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

const PROMO_SEARCH_FIELDS = ['code'] as const;
const PROMO_SORT_FIELDS = ['createdAt', 'redemptions', 'value', 'expiresAt'] as const;
const PROMO_FILTERS = {
  kind: { type: 'enum', values: PROMO_KINDS },
  enabled: { type: 'boolean' },
} as const;

router.get(
  '/promos',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = combineWhere(
      buildSearchWhere(query.search, PROMO_SEARCH_FIELDS),
      buildFilterWhere(PROMO_FILTERS, req.query as Record<string, string | undefined>),
    );
    const orderBy = buildOrderBy(query.sort, PROMO_SORT_FIELDS, { createdAt: 'desc' });
    const page = await paginateOffset({
      findMany: (args) =>
        prisma.promoCode.findMany(
          args as {
            where: Prisma.PromoCodeWhereInput;
            orderBy: Prisma.PromoCodeOrderByWithRelationInput[];
            skip: number;
            take: number;
          },
        ),
      count: (args) => prisma.promoCode.count(args as { where: Prisma.PromoCodeWhereInput }),
      where,
      orderBy,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      promos: page.items.map((promo) => ({ ...promo, description: describe(promo) })),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
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

const PROMO_REDEMPTION_SEARCH_FIELDS = ['user.email', 'user.name'] as const;

router.get(
  '/promos/:id/redemptions',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = combineWhere(
      { promoCodeId: req.params.id },
      buildSearchWhere(query.search, PROMO_REDEMPTION_SEARCH_FIELDS),
    );
    const page = await paginateOffset({
      findMany: (args) =>
        prisma.promoRedemption.findMany({
          ...(args as {
            where: Prisma.PromoRedemptionWhereInput;
            orderBy: Prisma.PromoRedemptionOrderByWithRelationInput[];
            skip: number;
            take: number;
          }),
          include: { user: { select: { email: true, name: true } } },
        }),
      count: (args) => prisma.promoRedemption.count(args as { where: Prisma.PromoRedemptionWhereInput }),
      where,
      orderBy: [{ createdAt: 'desc' }],
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      redemptions: page.items,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
  }),
);

/* ------------------------------- tournaments ------------------------------ */

const TOURNAMENT_SEARCH_FIELDS = ['name'] as const;
const TOURNAMENT_SORT_FIELDS = ['startsAt', 'endsAt', 'createdAt', 'prizePool', 'entryFee'] as const;
const TOURNAMENT_FILTERS = {
  status: { type: 'enum', values: ['SCHEDULED', 'RUNNING', 'FINISHED', 'CANCELLED'] },
} as const;

router.get(
  '/tournaments',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = combineWhere(
      buildSearchWhere(query.search, TOURNAMENT_SEARCH_FIELDS),
      buildFilterWhere(TOURNAMENT_FILTERS, req.query as Record<string, string | undefined>),
    );
    const orderBy = buildOrderBy(query.sort, TOURNAMENT_SORT_FIELDS, { startsAt: 'desc' });
    const page = await paginateOffset({
      findMany: (args) =>
        prisma.tournament.findMany({
          ...(args as {
            where: Prisma.TournamentWhereInput;
            orderBy: Prisma.TournamentOrderByWithRelationInput[];
            skip: number;
            take: number;
          }),
          include: { _count: { select: { entries: true } } },
        }),
      count: (args) => prisma.tournament.count(args as { where: Prisma.TournamentWhereInput }),
      where,
      orderBy,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      tournaments: page.items.map((t) => ({ ...t, entrants: t._count.entries })),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
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
    const query = listQuerySchema.parse(req.query);
    const page = await adminLeaderboardPage(req.params.id, {
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      leaderboard: page.items,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
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

const SUPPORT_SEARCH_FIELDS = ['subject', 'user.email', 'user.name'] as const;
const SUPPORT_SORT_FIELDS = ['lastMessageAt', 'createdAt'] as const;
const SUPPORT_FILTERS = {
  status: { type: 'enum', values: ['OPEN', 'ANSWERED', 'CLOSED'] },
} as const;

router.get(
  '/support',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = combineWhere(
      buildSearchWhere(query.search, SUPPORT_SEARCH_FIELDS),
      buildFilterWhere(SUPPORT_FILTERS, req.query as Record<string, string | undefined>),
    );
    // the pending-first queue (unread-by-agent, then most recently active) is the
    // standing default so nothing urgent slides off page one; an explicit sort
    // still overrides it completely.
    const orderBy = buildOrderBy(query.sort, SUPPORT_SORT_FIELDS, [
      { unreadByAgent: 'desc' },
      { lastMessageAt: 'desc' },
    ]);
    const page = await paginateOffset({
      findMany: (args) =>
        prisma.supportTicket.findMany({
          ...(args as {
            where: Prisma.SupportTicketWhereInput;
            orderBy: Prisma.SupportTicketOrderByWithRelationInput[];
            skip: number;
            take: number;
          }),
          include: {
            user: { select: { email: true, name: true, realBalance: true } },
            messages: { orderBy: { createdAt: 'asc' }, take: 100 },
          },
        }),
      count: (args) => prisma.supportTicket.count(args as { where: Prisma.SupportTicketWhereInput }),
      where,
      orderBy,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      tickets: page.items,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
    });
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
    trendStrength: z.number().min(0).max(5),
    meanReversion: z.number().min(0).max(5),
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

const ASSET_SEARCH_FIELDS = ['symbol', 'name', 'pair'] as const;
const ASSET_SORT_FIELDS = ['symbol', 'payoutPct', 'minStake', 'maxStake', 'sortOrder'] as const;
const ASSET_FILTERS = {
  assetClass: { type: 'enum', values: ['CURRENCY', 'CRYPTO', 'COMMODITY', 'STOCK', 'INDEX'] },
} as const;

router.get(
  '/assets',
  wrap(async (req, res) => {
    // pageSize defaults generously — the market catalogue is small and a
    // caller that never adopts pagination (the OTC engine's market picker)
    // expects to still get the whole thing back in one page, as it always has
    const query = listQuerySchema.parse({ pageSize: '200', ...req.query });
    const where = combineWhere(
      buildSearchWhere(query.search, ASSET_SEARCH_FIELDS),
      buildFilterWhere(ASSET_FILTERS, req.query as Record<string, string | undefined>),
    );
    const orderBy = buildOrderBy(query.sort, ASSET_SORT_FIELDS, { sortOrder: 'asc' });
    const page = await paginateOffset({
      findMany: (args) =>
        prisma.asset.findMany(
          args as {
            where: Prisma.AssetWhereInput;
            orderBy: Prisma.AssetOrderByWithRelationInput[];
            skip: number;
            take: number;
          },
        ),
      count: (args) => prisma.asset.count(args as { where: Prisma.AssetWhereInput }),
      where,
      orderBy,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      assets: page.items.map((asset) => {
        const session = marketHours.stateFor(asset.scheduleId);
        return {
          ...asset,
          price: marketFeed.getPrice(asset.symbol),
          isOpen: session.isOpen,
          nextOpen: session.nextOpen,
          schedule: marketHours.describe(asset.scheduleId),
        };
      }),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: page.pageCount,
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

/* --------------------------------- email ---------------------------------- */

/**
 * The outbox.
 *
 * Every message the platform composed, whether or not it was delivered — which
 * is the only way an operator can tell "we never sent it" from "their provider
 * dropped it", and the only record when no transport is configured at all.
 */
router.get(
  '/emails',
  wrap(async (req, res) => {
    const query = z
      .object({
        status: z.enum(['QUEUED', 'SENT', 'FAILED']).optional(),
        template: z.string().max(60).optional(),
        search: z.string().max(160).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(5).max(100).default(25),
      })
      .parse(req.query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.template ? { template: query.template } : {}),
      ...(query.search ? { to: { contains: query.search } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.emailMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        // the bodies are large and the list does not show them
        select: {
          id: true,
          to: true,
          subject: true,
          template: true,
          transport: true,
          status: true,
          error: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      prisma.emailMessage.count({ where }),
    ]);

    res.json({ emails: rows, total, page: query.page, pageSize: query.pageSize });
  }),
);

/** One message, with the HTML as it was composed, for the preview pane. */
router.get(
  '/emails/:id',
  wrap(async (req, res) => {
    const id = z.string().min(1).max(40).parse(req.params.id);
    const email = await prisma.emailMessage.findUnique({ where: { id } });
    if (!email) throw notFound('That message is not in the outbox');
    res.json({ email });
  }),
);

/** Every template, rendered with sample data — the preview in the back office. */
router.get(
  '/email-templates',
  wrap(async (_req, res) => {
    res.json({ templates: previewAll() });
  }),
);

/**
 * Proves the SMTP settings.
 *
 * A configuration that looks right and a configuration that delivers are not
 * the same thing, and the difference only shows up when someone tries it.
 */
router.post(
  '/emails/test',
  wrap(async (req, res) => {
    const body = z.object({ to: z.string().email() }).parse(req.body);
    const result = await sendTestEmail(body.to);
    await audit(req.user!.id, 'email.test', 'EmailMessage', result.id, body.to);
    res.json({
      ...result,
      transport: mailTransportName(),
      configured: smtpReady(),
    });
  }),
);

/* ------------------------------ marketplace ------------------------------- */

const marketplaceItemSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Use lower-case letters, numbers and hyphens'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(400),
  kind: z.enum(ITEM_KINDS),
  priceCents: z.number().int().min(0).max(10_000_000),
  pricePoints: z.number().int().min(0).max(10_000_000),
  config: z.unknown(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

/** An item nobody can buy is a mistake, not a configuration. */
function assertBuyable(input: { priceCents: number; pricePoints: number }): void {
  if (input.priceCents <= 0 && input.pricePoints <= 0) {
    throw badRequest('Set a price in money, in points, or both', 'no_price');
  }
}

router.get(
  '/marketplace/items',
  wrap(async (_req, res) => {
    res.json({ items: await marketplace.listItems({ includeDisabled: true }), kinds: ITEM_KINDS });
  }),
);

router.post(
  '/marketplace/items',
  wrap(async (req, res) => {
    const body = marketplaceItemSchema.parse(req.body);
    assertBuyable(body);
    const config = marketplace.parseItemConfig(body.kind, body.config);

    const existing = await prisma.marketplaceItem.findUnique({ where: { key: body.key } });
    if (existing) throw badRequest('An item with that key already exists', 'duplicate_key');

    const item = await prisma.marketplaceItem.create({ data: { ...body, config } });
    await audit(req.user!.id, 'marketplace.create', 'MarketplaceItem', item.id, item.key);
    res.status(201).json({ item });
  }),
);

router.patch(
  '/marketplace/items/:id',
  wrap(async (req, res) => {
    const id = z.string().min(1).max(40).parse(req.params.id);
    const body = marketplaceItemSchema.partial().parse(req.body);

    const existing = await prisma.marketplaceItem.findUnique({ where: { id } });
    if (!existing) throw notFound('That item does not exist');

    const kind = (body.kind ?? existing.kind) as (typeof ITEM_KINDS)[number];
    const config =
      body.config === undefined
        ? marketplace.parseItemConfig(kind, existing.config)
        : marketplace.parseItemConfig(kind, body.config);
    assertBuyable({
      priceCents: body.priceCents ?? existing.priceCents,
      pricePoints: body.pricePoints ?? existing.pricePoints,
    });

    // an edit changes what is on sale; what people already bought carries its
    // own copy of the configuration and is untouched
    const item = await prisma.marketplaceItem.update({ where: { id }, data: { ...body, config } });
    await audit(req.user!.id, 'marketplace.update', 'MarketplaceItem', item.id, item.key);
    res.json({ item });
  }),
);

/** Items are disabled, never deleted: an inventory row points at one for ever. */
router.delete(
  '/marketplace/items/:id',
  wrap(async (req, res) => {
    const id = z.string().min(1).max(40).parse(req.params.id);
    const item = await prisma.marketplaceItem.update({ where: { id }, data: { enabled: false } });
    await audit(req.user!.id, 'marketplace.disable', 'MarketplaceItem', item.id, item.key);
    res.json({ item });
  }),
);

/** What has been bought, for support and for seeing whether the shop works. */
router.get(
  '/marketplace/orders',
  wrap(async (req, res) => {
    const query = z
      .object({
        status: z.enum(['OWNED', 'ACTIVE', 'USED', 'EXPIRED']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(5).max(100).default(25),
      })
      .parse(req.query);
    const where = query.status ? { status: query.status } : {};

    const [orders, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          item: { select: { key: true, name: true, kind: true } },
          user: { select: { email: true, name: true } },
        },
      }),
      prisma.inventoryItem.count({ where }),
    ]);
    res.json({ orders, total, page: query.page, pageSize: query.pageSize });
  }),
);

/* -------------------------------- bonuses --------------------------------- */

const bonusOfferSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Use lower-case letters, numbers and hyphens'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(400),
  percent: z.number().min(1).max(500),
  maxBonusCents: z.number().int().min(100).max(100_000_000),
  minDepositCents: z.number().int().min(0).max(100_000_000),
  turnoverMultiplier: z.number().int().min(0).max(100),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

router.get(
  '/bonus-offers',
  wrap(async (_req, res) => {
    res.json({ offers: await listOffers({ includeDisabled: true }) });
  }),
);

router.post(
  '/bonus-offers',
  wrap(async (req, res) => {
    const body = bonusOfferSchema.parse(req.body);
    const existing = await prisma.bonusOffer.findUnique({ where: { key: body.key } });
    if (existing) throw badRequest('An offer with that key already exists', 'duplicate_key');
    const offer = await prisma.bonusOffer.create({ data: body });
    await audit(req.user!.id, 'bonus.offer.create', 'BonusOffer', offer.id, offer.key);
    res.status(201).json({ offer });
  }),
);

router.patch(
  '/bonus-offers/:id',
  wrap(async (req, res) => {
    const id = z.string().min(1).max(40).parse(req.params.id);
    const body = bonusOfferSchema.partial().parse(req.body);
    const offer = await prisma.bonusOffer.update({ where: { id }, data: body });
    await audit(req.user!.id, 'bonus.offer.update', 'BonusOffer', offer.id, offer.key);
    res.json({ offer });
  }),
);

/** Granted bonuses and how far each is through its turnover. */
router.get(
  '/bonuses',
  wrap(async (req, res) => {
    const query = z
      .object({
        status: z.enum(['ACTIVE', 'RELEASED', 'FORFEITED']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(5).max(100).default(25),
      })
      .parse(req.query);
    const where = query.status ? { status: query.status } : {};

    const [bonuses, total] = await Promise.all([
      prisma.bonus.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { email: true, name: true } } },
      }),
      prisma.bonus.count({ where }),
    ]);
    res.json({ bonuses, total, page: query.page, pageSize: query.pageSize });
  }),
);

/**
 * Cancels a trader's outstanding bonuses.
 *
 * The money is not clawed back: it was credited through the ledger and taking
 * it away silently would leave a balance nobody can explain. What this removes
 * is the hold, which is what an operator actually wants when they are settling
 * a complaint.
 */
router.post(
  '/users/:id/bonuses/forfeit',
  wrap(async (req, res) => {
    const id = z.string().min(1).max(40).parse(req.params.id);
    const total = await prisma.$transaction((tx) => forfeitAll(tx, id));
    await audit(req.user!.id, 'bonus.forfeit', 'User', id, `${total} cents released from hold`);
    res.json({ ok: true, released: total });
  }),
);

/* ------------------------------ payment methods ---------------------------- */

const paymentMethodSchema = z.object({
  label: z.string().trim().min(2).max(80),
  enabled: z.boolean(),
  feePct: z.number().min(0).max(100),
  feeFlatCents: z.number().int().min(0).max(10_000_000),
  minDepositCents: z.number().int().min(0).max(100_000_000),
  maxDepositCents: z.number().int().min(0).max(100_000_000),
  minWithdrawCents: z.number().int().min(0).max(100_000_000),
  maxWithdrawCents: z.number().int().min(0).max(100_000_000),
  /** ISO 3166-1 alpha-2 codes. Empty array means every country. */
  countries: z.array(z.string().length(2)).max(300),
  sortOrder: z.number().int().min(0).max(10_000),
});

/**
 * The methods behind the provider framework.
 *
 * Structural fields (provider, key, currency, network) are not editable here:
 * they identify which `PaymentProvider` implementation and which of its
 * mechanics a row configures, and changing them would silently repoint a
 * method's money at a different provider. Only the operator-editable half —
 * fees, limits, countries, whether it is offered — can be patched.
 */
router.get(
  '/payment-methods',
  wrap(async (_req, res) => {
    res.json({ methods: await paymentsService.listMethods({ includeDisabled: true }) });
  }),
);

router.patch(
  '/payment-methods/:id',
  wrap(async (req, res) => {
    const id = z.string().min(1).max(40).parse(req.params.id);
    const body = paymentMethodSchema.partial().parse(req.body);
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing) throw notFound('That payment method does not exist');

    if (body.maxDepositCents !== undefined && body.maxDepositCents > 0) {
      const min = body.minDepositCents ?? existing.minDepositCents;
      if (body.maxDepositCents < min) {
        throw badRequest('The deposit maximum cannot be below the minimum', 'bad_limits');
      }
    }
    if (body.maxWithdrawCents !== undefined && body.maxWithdrawCents > 0) {
      const min = body.minWithdrawCents ?? existing.minWithdrawCents;
      if (body.maxWithdrawCents < min) {
        throw badRequest('The withdrawal maximum cannot be below the minimum', 'bad_limits');
      }
    }

    const method = await prisma.paymentMethod.update({ where: { id }, data: body });
    await audit(req.user!.id, 'payment-method.update', 'PaymentMethod', method.id, method.key);
    res.json({ method });
  }),
);

export default router;

/* ------------------------------ payout rules ------------------------------ */

const ASSET_CLASSES = ['CURRENCY', 'CRYPTO', 'COMMODITY', 'STOCK', 'INDEX'] as const;

const payoutRuleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['TIME_OF_DAY', 'VOLATILITY', 'SCHEDULE']),
  assetId: z.string().cuid().nullish(),
  assetClass: z.enum(ASSET_CLASSES).nullish(),
  adjustment: z.number().int().min(-90).max(90),
  config: z.unknown(),
  priority: z.number().int().min(0).max(1000).default(0),
  exclusive: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

/** Parses the body and its kind-specific config together. */
function parsePayoutRule(body: unknown) {
  const parsed = payoutRuleSchema.parse(body);
  let config: unknown;
  try {
    config = parseRuleConfig(parsed.kind, parsed.config);
  } catch (err) {
    if (err instanceof z.ZodError)
      throw badRequest(err.issues[0]?.message ?? 'Invalid rule configuration', 'validation_error');
    throw err;
  }
  // a rule is scoped to one market or one class, never both
  return { ...parsed, config, assetClass: parsed.assetId ? null : (parsed.assetClass ?? null) };
}

router.get(
  '/payout-rules',
  wrap(async (_req, res) => {
    const [rules, assets] = await Promise.all([
      prisma.payoutRule.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        include: { asset: { select: { symbol: true, pair: true } } },
      }),
      prisma.asset.findMany({
        where: { enabled: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, symbol: true, pair: true, assetClass: true, payoutPct: true, volatility: true },
      }),
    ]);

    const now = new Date();
    res.json({
      rules,
      kinds: RULE_KINDS,
      assetClasses: ASSET_CLASSES,
      bounds: { min: settings.get('trading.minPayoutPct'), max: settings.get('trading.maxPayoutPct') },
      // what every market is paying this instant, so the effect is visible
      markets: assets.map((asset) => {
        const resolved = payouts.resolve(asset, { at: now });
        return {
          id: asset.id,
          symbol: asset.symbol,
          pair: asset.pair,
          assetClass: asset.assetClass,
          basePct: resolved.basePct,
          pct: resolved.pct,
          applied: resolved.applied,
        };
      }),
    });
  }),
);

/**
 * Resolves a market's payout at an arbitrary instant, optionally with a rule
 * that has not been saved, so an operator can check a window before committing.
 */
router.post(
  '/payout-rules/preview',
  wrap(async (req, res) => {
    const body = z
      .object({
        symbol: z.string().min(2).max(24),
        at: z.string().datetime().optional(),
        rule: z.unknown().optional(),
      })
      .parse(req.body);

    const asset = await prisma.asset.findUnique({ where: { symbol: body.symbol.toUpperCase() } });
    if (!asset) throw notFound('Market not found');

    const at = body.at ? new Date(body.at) : new Date();
    const market = {
      id: asset.id,
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      payoutPct: asset.payoutPct,
      volatility: asset.volatility,
    };

    const candidate = body.rule ? parsePayoutRule(body.rule) : null;
    const rules = [
      ...payouts.all(),
      ...(candidate
        ? [{ ...candidate, id: 'preview', assetId: candidate.assetId ?? null, config: candidate.config }]
        : []),
    ];

    const resolved = resolvePayout({
      market,
      rules,
      at,
      realisedVolatility: marketFeed.realisedVolatility(asset.symbol, 15),
      minPct: settings.get('trading.minPayoutPct'),
      maxPct: settings.get('trading.maxPayoutPct'),
    });

    res.json({ symbol: asset.symbol, at: at.toISOString(), ...resolved });
  }),
);

router.post(
  '/payout-rules',
  wrap(async (req, res) => {
    const data = parsePayoutRule(req.body);
    if (data.assetId) {
      const asset = await prisma.asset.findUnique({ where: { id: data.assetId } });
      if (!asset) throw notFound('Market not found');
    }

    const rule = await prisma.payoutRule.create({
      data: { ...data, config: data.config as Prisma.InputJsonValue },
    });
    await payouts.load();
    await audit(req.user!.id, 'payout.rule.create', 'payoutRule', rule.id, `${rule.kind} ${rule.adjustment}`);
    res.status(201).json(rule);
  }),
);

router.put(
  '/payout-rules/:id',
  wrap(async (req, res) => {
    const existing = await prisma.payoutRule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Rule not found');

    const data = parsePayoutRule(req.body);
    const rule = await prisma.payoutRule.update({
      where: { id: existing.id },
      data: { ...data, config: data.config as Prisma.InputJsonValue },
    });
    await payouts.load();
    await audit(req.user!.id, 'payout.rule.update', 'payoutRule', rule.id, `${rule.kind} ${rule.adjustment}`);
    res.json(rule);
  }),
);

router.delete(
  '/payout-rules/:id',
  wrap(async (req, res) => {
    const existing = await prisma.payoutRule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Rule not found');

    await prisma.payoutRule.delete({ where: { id: existing.id } });
    await payouts.load();
    await audit(req.user!.id, 'payout.rule.delete', 'payoutRule', existing.id, existing.name);
    res.json({ ok: true });
  }),
);

/* -------------------------------- risk book ------------------------------- */

/**
 * Live exposure per market, plus the limits capping it.
 *
 * Read on an interval by the Risk screen. Limits reject new stakes; they never
 * touch a price, a payout or an outcome, which is why this sits beside the
 * book rather than anywhere near the engine.
 */
router.get(
  '/risk',
  wrap(async (_req, res) => {
    const markets = await exposureByMarket();
    const totals = markets.reduce(
      (sum, market) => ({
        up: sum.up + market.up,
        down: sum.down + market.down,
        openPositions: sum.openPositions + market.openPositions,
        liability: sum.liability + Math.max(market.liabilityUp, market.liabilityDown),
      }),
      { up: 0, down: 0, openPositions: 0, liability: 0 },
    );

    res.json({
      markets,
      totals: { ...totals, net: totals.up - totals.down },
      defaults: {
        maxOpenStakePerUser: settings.get('risk.maxOpenStakePerUser'),
        maxExposurePerDirection: settings.get('risk.maxExposurePerDirection'),
      },
    });
  }),
);

router.put(
  '/risk/:symbol',
  wrap(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const body = z
      .object({
        minStake: z.number().int().min(1).max(100_000_000),
        maxStake: z.number().int().min(1).max(100_000_000),
        // 0 means "use the runtime default", which itself may mean no limit
        maxOpenStakePerUser: z.number().int().min(0).max(1_000_000_000),
        maxExposurePerDirection: z.number().int().min(0).max(1_000_000_000),
      })
      .refine((value) => value.maxStake >= value.minStake, {
        message: 'The maximum stake cannot be below the minimum',
      })
      .parse(req.body);

    const asset = await prisma.asset.findUnique({ where: { symbol } });
    if (!asset) throw notFound('Market not found');

    const updated = await prisma.asset.update({ where: { id: asset.id }, data: body });
    await audit(
      req.user!.id,
      'risk.limits',
      'asset',
      asset.id,
      `${symbol} stake ${body.minStake}-${body.maxStake} user ${body.maxOpenStakePerUser} side ${body.maxExposurePerDirection}`,
    );
    res.json({
      symbol: updated.symbol,
      minStake: updated.minStake,
      maxStake: updated.maxStake,
      maxOpenStakePerUser: updated.maxOpenStakePerUser,
      maxExposurePerDirection: updated.maxExposurePerDirection,
    });
  }),
);
