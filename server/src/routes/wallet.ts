import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { badRequest, forbidden, notFound, wrap } from '../lib/errors.js';
import { NETWORKS } from '../lib/crypto-networks.js';
import { publicDeposit, publicTransaction, publicWithdrawal } from '../lib/serialize.js';
import { prisma } from '../lib/prisma.js';
import { requireActiveUser, requireAuth, requireVerifiedEmail } from '../middleware/auth.js';
import { bonusesEnabled, holdFor, listOffers, quoteOffer } from '../services/bonuses.js';
import { cryptoMethodKey, findMethod } from '../services/payments.js';
import { createProviderDeposit, simulateProviderPayment } from '../services/provider-deposits.js';
import * as paymentsService from '../services/payments.js';
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
import { settings } from '../services/settings.js';
import { mockTxHash } from '../lib/crypto-networks.js';

const router = Router();
router.use(requireAuth);

/**
 * Currencies, networks, limits and live rates the wallet UI renders from.
 *
 * Filtered to what the provider framework says is actually on: enabled, and
 * offered in the trader's country. A network defined in code but not yet
 * seeded into `PaymentMethod` still shows with its static defaults, so adding
 * one is never blocked on a migration landing first.
 */
router.get(
  '/methods',
  wrap(async (req, res) => {
    const trader = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { country: true } });
    const rows = await paymentsService.listMethods({ includeDisabled: false });
    const byKey = new Map(rows.map((row) => [row.key, row]));

    const methods = NETWORKS.filter((spec) => {
      const method = byKey.get(cryptoMethodKey(spec.currency, spec.network));
      // no row yet: show it rather than hide a network nobody has seeded
      if (!method) return true;
      return paymentsService.isOfferedIn(method, trader?.country);
    }).map((spec) => {
      const method = byKey.get(cryptoMethodKey(spec.currency, spec.network));
      return {
        currency: spec.currency,
        network: spec.network,
        label: method?.label ?? spec.label,
        decimals: spec.decimals,
        confirmations: spec.confirmations,
        minDepositUsd: Math.max(
          spec.minDepositUsd,
          settings.get('wallet.minDepositUsd'),
          (method?.minDepositCents ?? 0) / 100,
        ),
        minWithdrawUsd: Math.max(
          spec.minWithdrawUsd,
          settings.get('wallet.minWithdrawUsd'),
          (method?.minWithdrawCents ?? 0) / 100,
        ),
        networkFeeUsd:
          spec.networkFeeUsd + settings.get('wallet.withdrawFlatFeeUsd') + (method?.feeFlatCents ?? 0) / 100,
        rate: usdRate(spec.currency),
      };
    });

    // card and e-wallet have no NETWORKS entry — a decimal precision or an
    // on-chain confirmation count means nothing for either — so their rows
    // are read straight from the provider-framework table instead
    const providerMethods = rows
      .filter((row) => row.provider !== 'CRYPTO' && paymentsService.isOfferedIn(row, trader?.country))
      .map((row) => ({
        currency: row.currency,
        network: row.provider,
        label: row.label,
        decimals: 2,
        confirmations: 1,
        minDepositUsd: row.minDepositCents / 100,
        minWithdrawUsd: row.minWithdrawCents / 100,
        networkFeeUsd: row.feeFlatCents / 100,
        rate: 1,
      }));

    res.json({
      methods: [...methods, ...providerMethods],
      withdrawFeePct: settings.get('wallet.withdrawFeePct'),
      mockChain: env.mockChainWatcher,
    });
  }),
);

/**
 * The bonus offers a trader can pick from, and what each is worth on the
 * amount they are about to deposit.
 */
router.get(
  '/bonus-offers',
  wrap(async (req, res) => {
    const amount = z.coerce
      .number()
      .min(0)
      .max(1_000_000)
      .default(0)
      .parse(req.query.amount ?? 0);
    const cents = Math.round(amount * 100);
    const offers = await listOffers();
    res.json({
      enabled: bonusesEnabled(),
      offers: offers.map((offer) => ({
        id: offer.id,
        key: offer.key,
        name: offer.name,
        description: offer.description,
        percent: offer.percent,
        maxBonusCents: offer.maxBonusCents,
        minDepositCents: offer.minDepositCents,
        turnoverMultiplier: offer.turnoverMultiplier,
        ...quoteOffer(offer, cents),
      })),
    });
  }),
);

/** What is still locked behind a turnover requirement, and how far off it is. */
router.get(
  '/bonuses',
  wrap(async (req, res) => {
    res.json(await holdFor(req.user!.id));
  }),
);

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
    const address = await getDepositAddress(
      req.user!.id,
      query.currency.toUpperCase(),
      query.network.toUpperCase(),
    );
    res.json({
      address: {
        currency: address.currency,
        network: address.network,
        address: address.address,
        memo: address.memo,
      },
      rate: usdRate(address.currency),
    });
  }),
);

router.post(
  '/deposits',
  requireActiveUser,
  requireVerifiedEmail,
  wrap(async (req, res) => {
    const body = z
      .object({
        currency: z.string().min(2).max(10),
        network: z.string().min(3).max(12),
        amount: z.number().positive().max(1000000),
        promoCode: z.string().max(32).optional(),
        bonusOfferId: z.string().max(40).optional(),
      })
      .parse(req.body);
    const deposit = await createDeposit({
      userId: req.user!.id,
      currency: body.currency.toUpperCase(),
      network: body.network.toUpperCase(),
      usdAmount: body.amount,
      promoCode: body.promoCode,
      bonusOfferId: body.bonusOfferId,
    });
    res.status(201).json({ deposit: publicDeposit(deposit) });
  }),
);

/** The provider-framework deposit path: a checkout session, not an address. */
router.post(
  '/deposits/provider',
  requireActiveUser,
  requireVerifiedEmail,
  wrap(async (req, res) => {
    const body = z
      .object({
        methodKey: z.string().min(2).max(40),
        amount: z.number().positive().max(1_000_000),
        promoCode: z.string().max(32).optional(),
        bonusOfferId: z.string().max(40).optional(),
      })
      .parse(req.body);
    const deposit = await createProviderDeposit({
      userId: req.user!.id,
      methodKey: body.methodKey,
      usdAmount: body.amount,
      promoCode: body.promoCode,
      bonusOfferId: body.bonusOfferId,
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
 * Demo helper: simulates the payment that would otherwise arrive from a real
 * chain, card gateway or e-wallet, so the invoice completes without one.
 *
 * Crypto pretends the trader broadcast the payment, moving the invoice to
 * CONFIRMING for the mock watcher to pick up. Card and e-wallet instead build
 * and deliver a genuinely signed webhook through the real verification path —
 * this button is the sandbox's "customer paid", not a shortcut around it.
 */
router.post(
  '/deposits/:id/simulate-payment',
  wrap(async (req, res) => {
    const deposit = await prisma.deposit.findUnique({ where: { id: req.params.id } });
    if (!deposit || deposit.userId !== req.user!.id) throw notFound('Deposit not found');

    if (deposit.network === 'CARD' || deposit.network === 'EWALLET') {
      await simulateProviderPayment(req.user!.id, deposit.id);
    } else {
      if (!env.mockChainWatcher) throw forbidden('Payment simulation is disabled on this deployment');
      await markSeen(deposit.id, mockTxHash(deposit.network, deposit.id));
    }
    const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
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
      .object({
        currency: z.string().min(2),
        network: z.string().min(3),
        amount: z.coerce.number().positive(),
      })
      .parse(req.query);
    const currency = query.currency.toUpperCase();
    const network = query.network.toUpperCase();
    const method = await findMethod(cryptoMethodKey(currency, network));
    res.json({
      quote: quoteWithdrawal(currency, network, Math.round(query.amount * 100), method),
    });
  }),
);

router.post(
  '/withdrawals',
  requireActiveUser,
  requireVerifiedEmail,
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
    const pendingWithdrawals = withdrawals.filter((w) =>
      ['PENDING', 'APPROVED', 'PROCESSING'].includes(w.status),
    );
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
