import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { badRequest, forbidden, notFound, wrap } from '../lib/errors.js';
import { NETWORKS } from '../lib/crypto-networks.js';
import { publicDeposit, publicTransaction, publicWithdrawal } from '../lib/serialize.js';
import { prisma } from '../lib/prisma.js';
import { requireActiveUser, requireAuth } from '../middleware/auth.js';
import { getBalances, listTransactions } from '../services/wallet.js';
import { createDeposit, getDepositAddress, listDeposits, markSeen } from '../services/deposits.js';
import {
  cancelWithdrawal,
  createWithdrawal,
  listWithdrawals,
  quoteWithdrawal,
} from '../services/withdrawals.js';
import { usdRate } from '../services/rates.js';
import { previewPromo } from '../services/promos.js';
import { mockTxHash } from '../lib/crypto-networks.js';

const router = Router();
router.use(requireAuth);

/** Currencies, networks, limits and live rates the wallet UI renders from. */
router.get('/methods', (_req, res) => {
  res.json({
    methods: NETWORKS.map((spec) => ({
      currency: spec.currency,
      network: spec.network,
      label: spec.label,
      decimals: spec.decimals,
      confirmations: spec.confirmations,
      minDepositUsd: Math.max(spec.minDepositUsd, env.minDepositUsd),
      minWithdrawUsd: Math.max(spec.minWithdrawUsd, env.minWithdrawUsd),
      networkFeeUsd: spec.networkFeeUsd + env.withdrawFlatFeeUsd,
      rate: usdRate(spec.currency),
    })),
    withdrawFeePct: env.withdrawFeePct,
    mockChain: env.mockChainWatcher,
  });
});

router.get(
  '/balances',
  wrap(async (req, res) => {
    res.json({ balances: await getBalances(req.user!.id) });
  }),
);

router.get(
  '/transactions',
  wrap(async (req, res) => {
    const query = z
      .object({
        accountType: z.enum(['DEMO', 'REAL']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
      .parse(req.query);
    const { items, nextCursor } = await listTransactions(req.user!.id, query);
    res.json({ transactions: items.map(publicTransaction), nextCursor });
  }),
);

/* ------------------------------- deposits -------------------------------- */

router.get(
  '/deposit-address',
  wrap(async (req, res) => {
    const query = z.object({ currency: z.string().min(2), network: z.string().min(3) }).parse(req.query);
    const address = await getDepositAddress(req.user!.id, query.currency.toUpperCase(), query.network.toUpperCase());
    res.json({
      address: { currency: address.currency, network: address.network, address: address.address, memo: address.memo },
      rate: usdRate(address.currency),
    });
  }),
);

router.post(
  '/deposits',
  requireActiveUser,
  wrap(async (req, res) => {
    const body = z
      .object({
        currency: z.string().min(2).max(10),
        network: z.string().min(3).max(12),
        amount: z.number().positive().max(1000000),
        promoCode: z.string().max(32).optional(),
      })
      .parse(req.body);
    const deposit = await createDeposit({
      userId: req.user!.id,
      currency: body.currency.toUpperCase(),
      network: body.network.toUpperCase(),
      usdAmount: body.amount,
      promoCode: body.promoCode,
    });
    res.status(201).json({ deposit: publicDeposit(deposit) });
  }),
);

router.get(
  '/deposits',
  wrap(async (req, res) => {
    res.json({ deposits: (await listDeposits(req.user!.id)).map(publicDeposit) });
  }),
);

/**
 * Demo helper: pretends the user broadcast the payment so the invoice moves to
 * CONFIRMING immediately instead of waiting for the mock watcher. Only exists
 * while the mock chain watcher is enabled.
 */
router.post(
  '/deposits/:id/simulate-payment',
  wrap(async (req, res) => {
    if (!env.mockChainWatcher) throw forbidden('Payment simulation is disabled on this deployment');
    const deposit = await prisma.deposit.findUnique({ where: { id: req.params.id } });
    if (!deposit || deposit.userId !== req.user!.id) throw notFound('Deposit not found');
    const updated = await markSeen(deposit.id, mockTxHash(deposit.network, deposit.id));
    res.json({ deposit: publicDeposit(updated) });
  }),
);

router.get(
  '/promo',
  wrap(async (req, res) => {
    const query = z
      .object({ code: z.string().min(2).max(32), amount: z.coerce.number().positive() })
      .parse(req.query);
    res.json({ promo: await previewPromo(query.code, req.user!.id, Math.round(query.amount * 100)) });
  }),
);

/* ------------------------------ withdrawals ------------------------------ */

router.get(
  '/withdrawals/quote',
  wrap(async (req, res) => {
    const query = z
      .object({ currency: z.string().min(2), network: z.string().min(3), amount: z.coerce.number().positive() })
      .parse(req.query);
    res.json({
      quote: quoteWithdrawal(query.currency.toUpperCase(), query.network.toUpperCase(), Math.round(query.amount * 100)),
    });
  }),
);

router.post(
  '/withdrawals',
  requireActiveUser,
  wrap(async (req, res) => {
    const body = z
      .object({
        currency: z.string().min(2).max(10),
        network: z.string().min(3).max(12),
        address: z.string().min(20).max(120),
        amount: z.number().positive().max(1000000),
      })
      .parse(req.body);

    const withdrawal = await createWithdrawal({
      userId: req.user!.id,
      currency: body.currency.toUpperCase(),
      network: body.network.toUpperCase(),
      address: body.address,
      amountCents: Math.round(body.amount * 100),
    });
    const balances = await getBalances(req.user!.id);
    res.status(201).json({ withdrawal: publicWithdrawal(withdrawal), balances });
  }),
);

router.get(
  '/withdrawals',
  wrap(async (req, res) => {
    res.json({ withdrawals: (await listWithdrawals(req.user!.id)).map(publicWithdrawal) });
  }),
);

router.post(
  '/withdrawals/:id/cancel',
  wrap(async (req, res) => {
    const withdrawal = await cancelWithdrawal(req.user!.id, req.params.id);
    const balances = await getBalances(req.user!.id);
    res.json({ withdrawal: publicWithdrawal(withdrawal), balances });
  }),
);

/* -------------------------------- history -------------------------------- */

router.get(
  '/summary',
  wrap(async (req, res) => {
    const [balances, deposits, withdrawals] = await Promise.all([
      getBalances(req.user!.id),
      listDeposits(req.user!.id, 10),
      listWithdrawals(req.user!.id, 10),
    ]);
    const pendingWithdrawals = withdrawals.filter((w) => ['PENDING', 'APPROVED', 'PROCESSING'].includes(w.status));
    if (balances.realBalance < 0) throw badRequest('Balance inconsistency detected', 'balance_error');
    res.json({
      balances,
      deposits: deposits.map(publicDeposit),
      withdrawals: withdrawals.map(publicWithdrawal),
      pendingWithdrawalTotal: pendingWithdrawals.reduce((sum, w) => sum + w.amount, 0),
    });
  }),
);

export default router;
