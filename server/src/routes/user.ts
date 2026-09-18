import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import { publicNotification, publicUser } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { applyLedger } from '../services/wallet.js';
import { tradingStats } from '../services/trading.js';
import { DOCUMENT_TYPES, latestKycSubmission, submitKyc } from '../services/kyc.js';
import { referralSummary } from '../services/referrals.js';
import { settings } from '../services/settings.js';
import { leaderboard } from '../services/leaderboard.js';
import * as notifications from '../services/notifications.js';

// mounted at /api/me — every route here needs a signed-in user
const router = Router();
router.use(requireAuth);

// the practice starting balance is operator-configurable
const practiceStart = () => settings.get('trading.practiceStartBalance');

router.get(
  '/',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    res.json({ user: publicUser(user) });
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
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { leaderboardOptOut: body.optOut },
    });
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

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { terminalLayout: body },
    });
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
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
    });
    // Password changed: every other session is invalidated.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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

router.post(
  '/demo/reset',
  wrap(async (req, res) => {
    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: req.user!.id },
        select: { demoBalance: true },
      });
      if (!current) throw notFound('Account not found');
      const delta = practiceStart() - current.demoBalance;
      if (delta !== 0) {
        await applyLedger(tx, {
          userId: req.user!.id,
          accountType: 'DEMO',
          type: 'DEMO_RESET',
          amount: delta,
          note: 'Practice balance reset',
        });
      }
      return tx.user.findUnique({ where: { id: req.user!.id } });
    });
    res.json({ user: publicUser(user!) });
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

export default router;
