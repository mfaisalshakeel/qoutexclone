import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import { publicUser } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { applyLedger } from '../services/wallet.js';
import { tradingStats } from '../services/trading.js';
import { DOCUMENT_TYPES, latestKycSubmission, submitKyc } from '../services/kyc.js';
import { referralSummary } from '../services/referrals.js';
import { settings } from '../services/settings.js';

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
