import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound, wrap } from '../lib/errors.js';
import { publicDeposit, publicUser, publicWithdrawal } from '../lib/serialize.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { applyLedger } from '../services/wallet.js';
import { completeDeposit, rejectDeposit } from '../services/deposits.js';
import { approveWithdrawal, rejectWithdrawal } from '../services/withdrawals.js';
import { marketFeed } from '../engine/feed.js';

const router = Router();
router.use(requireAuth, requireAdmin);

async function audit(actorId: string, action: string, targetType: string, targetId: string, detail?: string) {
  await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, detail } });
}

router.get(
  '/overview',
  wrap(async (_req, res) => {
    const [users, openTrades, pendingDeposits, pendingWithdrawals, deposits, withdrawals, tradeAgg] = await Promise.all([
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
      feedProvider: marketFeed.provider,
    });
  }),
);

router.get(
  '/users',
  wrap(async (req, res) => {
    const query = z
      .object({ search: z.string().max(120).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
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
      .object({ txHash: z.string().max(120).optional(), cryptoAmount: z.string().max(40).optional(), note: z.string().max(200).optional() })
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
    await audit(req.user!.id, 'withdrawal.approve', 'withdrawal', withdrawal.id, withdrawal.txHash ?? undefined);
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

/* --------------------------------- assets -------------------------------- */

router.get(
  '/assets',
  wrap(async (_req, res) => {
    const assets = await prisma.asset.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ assets: assets.map((a) => ({ ...a, price: marketFeed.getPrice(a.symbol) })) });
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
