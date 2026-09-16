import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import { publicUser } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { applyLedger } from '../services/wallet.js';
import { tradingStats } from '../services/trading.js';

const router = Router();
router.use(requireAuth);

const DEMO_START = 1000000; // $10,000.00

router.get(
  '/me',
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Account not found');
    res.json({ user: publicUser(user) });
  }),
);

router.patch(
  '/me',
  wrap(async (req, res) => {
    const body = z
      .object({ name: z.string().min(2).max(60).optional(), country: z.string().max(60).optional() })
      .parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/me/password',
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
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  }),
);

router.post(
  '/me/account',
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
  '/me/demo/reset',
  wrap(async (req, res) => {
    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: req.user!.id }, select: { demoBalance: true } });
      if (!current) throw notFound('Account not found');
      const delta = DEMO_START - current.demoBalance;
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
  '/me/stats',
  wrap(async (req, res) => {
    const accountType = (req.query.accountType === 'REAL' ? 'REAL' : 'DEMO') as 'DEMO' | 'REAL';
    res.json({ stats: await tradingStats(req.user!.id, accountType) });
  }),
);

export default router;
