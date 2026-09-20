import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import { publicNotification, publicUser } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { tradingStats } from '../services/trading.js';
import { DOCUMENT_TYPES, latestKycSubmission, submitKyc } from '../services/kyc.js';
import { referralSummary } from '../services/referrals.js';
import { settings } from '../services/settings.js';
import { leaderboard } from '../services/leaderboard.js';
import { refillPractice } from '../services/practice.js';
import { retryOnConflict } from '../lib/retry.js';
import * as notifications from '../services/notifications.js';
import * as security from '../services/security.js';
import { progressFor, statusConfig } from '../services/status.js';
import { progressionFor } from '../services/progression.js';
import * as marketplace from '../services/marketplace.js';

// mounted at /api/me — every route here needs a signed-in user
const router = Router();
router.use(requireAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    // a running booster rides along here rather than in `publicUser`, which is
    // synchronous and used on every hot path: this is the one place the
    // terminal reads its own account from, and it re-reads it when things change
    res.json({ user: { ...publicUser(user), boost: await marketplace.runningBoost(user.id) } });
  }),
);

router.patch(
  '/',
  wrap(async (req, res) => {
    const body = z
      .object({ name: z.string().min(2).max(60).optional(), country: z.string().max(60).optional() })
      .parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
    res.json({ user: publicUser(user) });
  }),
);

/**
 * Today's top traders, by profit on settled live positions.
 *
 * Names are masked and opted-out traders are excluded before ranking, so the
 * response carries no identity beyond a country and an initial. The reader's
 * own row is marked, which is the one place an identity is known — to them.
 */
router.get(
  '/leaderboard',
  wrap(async (req, res) => {
    if (!settings.get('trading.leaderboardEnabled')) {
      res.json({ rows: [], updatedAt: 0, traders: 0, enabled: false });
      return;
    }
    const board = leaderboard.board({
      viewerId: req.user!.id,
      limit: settings.get('trading.leaderboardSize'),
    });
    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { leaderboardOptOut: true },
    });
    res.json({ ...board, enabled: true, optedOut: !!me?.leaderboardOptOut });
  }),
);

/** A trader's own choice about appearing on the public leaderboard. */
router.patch(
  '/leaderboard',
  wrap(async (req, res) => {
    const body = z.object({ optOut: z.boolean() }).parse(req.body);
    const user = await retryOnConflict(() =>
      prisma.user.update({
        where: { id: req.user!.id },
        data: { leaderboardOptOut: body.optOut },
      }),
    );
    // the board is cached, so the choice has to take effect now rather than at
    // the next refresh
    await leaderboard.refresh();
    res.json({ optedOut: user.leaderboardOptOut });
  }),
);

/**
 * The notification centre.
 *
 * Paged backwards from newest with a `createdAt` cursor, so a centre that has
 * been open for a while does not re-read the whole list to reach the end.
 */
router.get(
  '/notifications',
  wrap(async (req, res) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).optional(),
        before: z.string().datetime().optional(),
        unread: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);

    const page = await notifications.list(req.user!.id, {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
      unreadOnly: query.unread === 'true',
    });
    res.json({
      items: page.items.map(publicNotification),
      unread: page.unread,
      cursor: page.cursor,
      enabled: settings.get('notifications.enabled'),
    });
  }),
);

/** Marks the given notifications read, or all of them when none are named. */
router.post(
  '/notifications/read',
  wrap(async (req, res) => {
    const body = z.object({ ids: z.array(z.string().min(1)).max(100).optional() }).parse(req.body ?? {});
    // scoped to the reader inside the service: another trader's id matches nothing
    const marked = await notifications.markRead(req.user!.id, body.ids);
    res.json({ marked, unread: await notifications.unreadCount(req.user!.id) });
  }),
);

router.delete(
  '/notifications/:id',
  wrap(async (req, res) => {
    const removed = await notifications.remove(req.user!.id, req.params.id);
    if (!removed) throw notFound('Notification not found');
    res.json({ ok: true, unread: await notifications.unreadCount(req.user!.id) });
  }),
);

/**
 * The studies on the trader's chart.
 *
 * Stored as given and validated by the reader, like the layout: the shape is
 * the client's business, and a study from a newer version of the terminal must
 * not be refused by an older server — it simply will not be drawn.
 */
router.patch(
  '/studies',
  wrap(async (req, res) => {
    const body = z
      .object({
        studies: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              values: z.record(z.number()).optional(),
              colors: z.record(z.string().max(32)).optional(),
            }),
          )
          .max(20),
      })
      .parse(req.body);

    // a preference write can lose a race with a settlement touching the same
    // account row; asking again is harmless and beats a 500 over a colour
    const user = await retryOnConflict(() =>
      prisma.user.update({ where: { id: req.user!.id }, data: { chartStudies: body.studies } }),
    );
    res.json({ chartStudies: user.chartStudies });
  }),
);

/**
 * The marks a trader has drawn, keyed by market.
 *
 * Per user per asset: a trend line belongs to the chart it was drawn on, and
 * carrying it to another market would be drawing a line through prices it was
 * never about. Capped so one account cannot fill a column with them.
 */
router.patch(
  '/drawings',
  wrap(async (req, res) => {
    const body = z
      .object({
        symbol: z.string().min(1).max(24),
        drawings: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              kind: z.string().min(1).max(20),
              points: z
                .array(z.object({ time: z.number(), price: z.number() }))
                .min(1)
                .max(2),
              color: z.string().max(32),
              locked: z.boolean().optional(),
              text: z.string().max(120).optional(),
            }),
          )
          .max(60),
      })
      .parse(req.body);

    const current = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { chartDrawings: true },
    });
    const all =
      current?.chartDrawings && typeof current.chartDrawings === 'object'
        ? ({ ...(current.chartDrawings as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    if (body.drawings.length === 0) delete all[body.symbol];
    else all[body.symbol] = body.drawings;

    // a trader with marks on hundreds of markets keeps the newest ones
    const symbols = Object.keys(all);
    if (symbols.length > 40) for (const symbol of symbols.slice(0, symbols.length - 40)) delete all[symbol];

    const user = await retryOnConflict(() =>
      prisma.user.update({
        where: { id: req.user!.id },
        data: { chartDrawings: all as Prisma.InputJsonValue },
      }),
    );
    res.json({ chartDrawings: user.chartDrawings });
  }),
);

/**
 * The terminal workspace. Stored as given and validated by the client that
 * reads it: a layout is a preference, and a stale shape from an older version
 * must never stop the terminal rendering, so the reader is the one that
 * decides what is usable.
 */
router.patch(
  '/layout',
  wrap(async (req, res) => {
    const body = z
      .object({
        kind: z.enum(['single', 'rows', 'cols', 'quad']),
        panes: z
          .array(z.object({ symbol: z.string().min(1).max(24), timeframe: z.string().min(1).max(8) }))
          .min(1)
          .max(4),
        focused: z.number().int().min(0).max(3),
      })
      .parse(req.body);

    const user = await retryOnConflict(() =>
      prisma.user.update({ where: { id: req.user!.id }, data: { terminalLayout: body } }),
    );
    res.json({ terminalLayout: user.terminalLayout });
  }),
);

router.post(
  '/password',
  wrap(async (req, res) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', 'bad_password');
    }
    security.assertPasswordAllowed(body.newPassword, { email: user.email, name: user.name });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
    });
    // Password changed: every other session is invalidated, including the
    // access tokens already in someone else's hands.
    await security.revokeOtherSessions(user.id, req.user!.sessionId ?? null);
    res.json({ ok: true });
  }),
);

router.post(
  '/account',
  wrap(async (req, res) => {
    const body = z.object({ accountType: z.enum(['DEMO', 'REAL']) }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { activeAccount: body.accountType },
    });
    res.json({ user: publicUser(user) });
  }),
);

/**
 * Tops the practice balance up to the configured starting amount.
 *
 * The rule about when that is allowed lives in the service, so the switcher and
 * the API cannot disagree about it.
 */
router.post(
  '/demo/reset',
  wrap(async (req, res) => {
    res.json({ user: publicUser(await refillPractice(req.user!.id)) });
  }),
);

router.get(
  '/stats',
  wrap(async (req, res) => {
    const accountType = (req.query.accountType === 'REAL' ? 'REAL' : 'DEMO') as 'DEMO' | 'REAL';
    res.json({ stats: await tradingStats(req.user!.id, accountType) });
  }),
);

/* --------------------------- identity verification -------------------------- */

router.get(
  '/kyc',
  wrap(async (req, res) => {
    const [user, submission] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { kycStatus: true, kycReviewedAt: true },
      }),
      latestKycSubmission(req.user!.id),
    ]);
    res.json({
      status: user?.kycStatus ?? 'NOT_SUBMITTED',
      reviewedAt: user?.kycReviewedAt ?? null,
      required: settings.get('compliance.requireKycForWithdrawal'),
      thresholdUsd: settings.get('compliance.kycWithdrawalThresholdUsd'),
      submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            note: submission.note,
            documentType: submission.documentType,
            createdAt: submission.createdAt,
            reviewedAt: submission.reviewedAt,
          }
        : null,
    });
  }),
);

router.post(
  '/kyc',
  wrap(async (req, res) => {
    const body = z
      .object({
        fullName: z.string().min(3).max(120),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
        country: z.string().min(2).max(60),
        address: z.string().min(5).max(300),
        documentType: z.enum(DOCUMENT_TYPES),
        documentNumber: z.string().min(3).max(60),
        documentRef: z.string().max(300).optional(),
      })
      .parse(req.body);
    const submission = await submitKyc({ userId: req.user!.id, ...body });
    res.status(201).json({ submission: { id: submission.id, status: submission.status } });
  }),
);

/* ------------------------------ partner program ----------------------------- */

router.get(
  '/referrals',
  wrap(async (req, res) => {
    res.json(await referralSummary(req.user!.id));
  }),
);

/**
 * Where this trader stands, and what the levels are worth.
 *
 * The whole ladder comes back, not just their rung: a progress page that
 * cannot say what the next level gives you is not a progress page.
 */
router.get(
  '/status',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { totalDeposited: true },
    });
    if (!user) throw notFound('Account not found');
    const config = statusConfig();
    res.json({
      enabled: config.enabled,
      maxPayoutPct: config.maxPayoutPct,
      levels: config.levels,
      progress: progressFor(user.totalDeposited, config),
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Marketplace                                                                */
/* -------------------------------------------------------------------------- */

/** The shop and what the trader can spend in it. */
router.get(
  '/marketplace',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { points: true, realBalance: true },
    });
    if (!user) throw notFound('Account not found');
    res.json({
      enabled: settings.get('growth.marketplaceEnabled'),
      points: user.points,
      balance: user.realBalance,
      items: await marketplace.listItems(),
      inventory: await marketplace.inventoryFor(req.user!.id),
    });
  }),
);

router.post(
  '/marketplace/buy',
  wrap(async (req, res) => {
    const body = z
      .object({ itemId: z.string().min(1).max(40), payWith: z.enum(['cents', 'points']) })
      .parse(req.body);
    const bought = await marketplace.buyItem({ userId: req.user!.id, ...body });
    res.status(201).json({ item: bought });
  }),
);

router.post(
  '/marketplace/activate',
  wrap(async (req, res) => {
    const body = z.object({ inventoryId: z.string().min(1).max(40) }).parse(req.body);
    // ownership is checked inside the service, so no id can reach another account
    const activated = await marketplace.activateItem(req.user!.id, body.inventoryId);
    res.json({ item: activated });
  }),
);

/**
 * Level, experience and every badge with its progress.
 *
 * Reading the page also catches up on anything earned since the last position
 * settled — confirming an address or turning on two-factor is not a trade, and
 * would otherwise sit unrewarded until the next one.
 */
router.get(
  '/progress',
  wrap(async (req, res) => {
    res.json(await progressionFor(req.user!.id));
  }),
);

/* -------------------------------------------------------------------------- */
/* Account security                                                           */
/* -------------------------------------------------------------------------- */

/** Sends the confirmation link again, for an address that is still unproven. */
router.post(
  '/verify-email/resend',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    const issued = await security.issueEmailVerification(user);
    res.json({ ok: true, expiresAt: issued.expiresAt });
  }),
);

/** Every device currently signed in, newest first, with this one marked. */
router.get(
  '/sessions',
  wrap(async (req, res) => {
    res.json({ sessions: await security.listSessions(req.user!.id, req.user!.sessionId ?? null) });
  }),
);

router.delete(
  '/sessions/:id',
  wrap(async (req, res) => {
    const id = z.string().min(1).max(40).parse(req.params.id);
    if (id === req.user!.sessionId) {
      throw badRequest('That is the device you are using. Sign out instead.', 'current_session');
    }
    // ownership is enforced inside the service, so no id can reach another account
    await security.revokeSession(req.user!.id, id);
    res.json({ ok: true });
  }),
);

router.post(
  '/sessions/revoke-others',
  wrap(async (req, res) => {
    const count = await security.revokeOtherSessions(req.user!.id, req.user!.sessionId ?? null);
    res.json({ ok: true, count });
  }),
);

router.get(
  '/login-history',
  wrap(async (req, res) => {
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .parse(req.query.limit ?? 25);
    res.json({ events: await security.listLoginHistory(req.user!.id, limit) });
  }),
);

/** Starts enrolment: a secret to scan and a code to prove it arrived. */
router.post(
  '/2fa/setup',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    res.json(await security.startTwoFactor(user));
  }),
);

router.post(
  '/2fa/enable',
  wrap(async (req, res) => {
    const body = z.object({ code: z.string().min(6).max(10) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    // shown once and never again: the response is the only copy the trader gets
    res.json({ backupCodes: await security.enableTwoFactor(user, body.code) });
  }),
);

router.post(
  '/2fa/disable',
  wrap(async (req, res) => {
    const body = z.object({ password: z.string().min(1), code: z.string().min(6).max(20) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    await security.disableTwoFactor(user, body.password, body.code);
    res.json({ ok: true });
  }),
);

router.post(
  '/2fa/backup-codes',
  wrap(async (req, res) => {
    const body = z.object({ code: z.string().min(6).max(20) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    res.json({ backupCodes: await security.regenerateBackupCodes(user, body.code) });
  }),
);

/** What the security page needs in one request. */
router.get(
  '/security',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    const [sessions, events, backupCodesLeft] = await Promise.all([
      security.listSessions(user.id, req.user!.sessionId ?? null),
      security.listLoginHistory(user.id, 25),
      user.twoFactorEnabledAt ? security.backupCodesLeft(user.id) : Promise.resolve(0),
    ]);
    res.json({
      emailVerifiedAt: user.emailVerifiedAt,
      emailVerification: settings.get('security.emailVerification'),
      twoFactorEnabled: user.twoFactorEnabledAt !== null,
      twoFactorEnabledAt: user.twoFactorEnabledAt,
      backupCodesLeft,
      sessions,
      events,
      passwordPolicy: security.passwordPolicy(),
    });
  }),
);

export default router;
