import type { Deposit } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { centsToCrypto, cryptoToCents, usdToCents } from '../lib/money.js';
import { findNetwork, mockTxHash } from '../lib/crypto-networks.js';
import { custody } from './custody.js';
import { usdRate } from './rates.js';
import { applyLedger } from './wallet.js';
import { previewPromo, redeemPromo } from './promos.js';
import { depositBonusFor, levelFor, statusConfig } from './status.js';
import { couponFor, spendCoupon } from './marketplace.js';
import { payReferralCommission } from './referrals.js';
import { settings } from './settings.js';

export const depositEvents = new EventEmitter();

export async function getDepositAddress(userId: string, currency: string, network: string) {
  const spec = findNetwork(currency, network);
  if (!spec) throw badRequest('Unsupported currency/network combination', 'unsupported_network');

  const existing = await prisma.depositAddress.findUnique({
    where: { userId_currency_network: { userId, currency, network } },
  });
  if (existing) return existing;

  const { address, memo } = await custody.getDepositAddress(userId, currency, network);
  return prisma.depositAddress.create({ data: { userId, currency, network, address, memo } });
}

export interface CreateDepositInput {
  userId: string;
  currency: string;
  network: string;
  usdAmount: number; // dollars the user intends to send
  promoCode?: string;
}

/**
 * Opens a deposit invoice: locks in the rate, computes the exact crypto amount
 * to send, and hands back the address to pay. Credit happens only once the
 * payment is confirmed (chain watcher or admin).
 */
export async function createDeposit(input: CreateDepositInput): Promise<Deposit> {
  const spec = findNetwork(input.currency, input.network);
  if (!spec) throw badRequest('Unsupported currency/network combination', 'unsupported_network');

  const minUsd = Math.max(spec.minDepositUsd, settings.get('wallet.minDepositUsd'));
  if (!(input.usdAmount >= minUsd)) {
    throw badRequest(`Minimum deposit for ${input.currency} (${spec.label}) is $${minUsd}`, 'below_minimum');
  }

  const pending = await prisma.deposit.count({
    where: { userId: input.userId, status: { in: ['AWAITING_PAYMENT', 'CONFIRMING'] } },
  });
  if (pending >= 5) throw conflict('You already have too many pending deposits', 'too_many_pending');

  const { address, memo } = await getDepositAddress(input.userId, input.currency, input.network);
  const rate = usdRate(input.currency);
  const cents = usdToCents(input.usdAmount);

  // validated now so a bad code fails at checkout, not silently at credit time
  const promoCode = input.promoCode?.trim().toUpperCase() || undefined;
  if (promoCode) await previewPromo(promoCode, input.userId, cents);

  const deposit = await prisma.deposit.create({
    data: {
      userId: input.userId,
      currency: input.currency,
      network: input.network,
      address,
      cryptoAmount: centsToCrypto(cents, rate, spec.decimals),
      rate,
      requiredConf: spec.confirmations,
      promoCode,
      status: 'AWAITING_PAYMENT',
      expiresAt: new Date(Date.now() + settings.get('wallet.depositWindowMinutes') * 60 * 1000),
      adminNote: memo ? `memo:${memo}` : null,
    },
  });
  depositEvents.emit('created', deposit);
  return deposit;
}

/** Records an observed on-chain payment and moves the invoice to CONFIRMING. */
export async function markSeen(depositId: string, txHash: string, cryptoAmount?: string): Promise<Deposit> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw notFound('Deposit not found');
  if (deposit.status !== 'AWAITING_PAYMENT')
    throw conflict('Deposit is no longer awaiting payment', 'bad_status');

  const updated = await prisma.deposit.update({
    where: { id: depositId },
    data: {
      status: 'CONFIRMING',
      txHash,
      confirmations: 0,
      ...(cryptoAmount ? { cryptoAmount } : {}),
    },
  });
  depositEvents.emit('updated', updated);
  return updated;
}

/**
 * Credits a confirmed deposit to the real balance. Idempotent: a deposit that
 * already reached COMPLETED is returned untouched instead of paying twice.
 */
export async function completeDeposit(
  depositId: string,
  options: { txHash?: string; cryptoAmount?: string; note?: string } = {},
): Promise<Deposit> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw notFound('Deposit not found');
  if (deposit.status === 'COMPLETED') return deposit;
  if (deposit.status === 'REJECTED' || deposit.status === 'EXPIRED') {
    throw conflict('Deposit was already closed', 'bad_status');
  }

  const amount = options.cryptoAmount ?? deposit.cryptoAmount;
  const rate = deposit.rate > 0 ? deposit.rate : usdRate(deposit.currency);
  const credited = cryptoToCents(amount, rate);
  if (credited <= 0) throw badRequest('Deposit amount is zero', 'zero_amount');

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.deposit.updateMany({
      where: { id: depositId, status: { in: ['AWAITING_PAYMENT', 'CONFIRMING'] } },
      data: {
        status: 'COMPLETED',
        confirmations: deposit.requiredConf,
        cryptoAmount: amount,
        creditedAmount: credited,
        txHash: options.txHash ?? deposit.txHash ?? mockTxHash(deposit.network, deposit.id),
        confirmedAt: new Date(),
        adminNote: options.note ?? deposit.adminNote,
      },
    });
    if (claimed.count === 0) return tx.deposit.findUnique({ where: { id: depositId } });

    // read before the increment: the deposit that promotes a trader is paid at
    // the level they held when they made it, not the one it earns them
    const before = await tx.user.findUniqueOrThrow({
      where: { id: deposit.userId },
      select: { totalDeposited: true },
    });

    await applyLedger(tx, {
      userId: deposit.userId,
      accountType: 'REAL',
      type: 'DEPOSIT',
      amount: credited,
      refType: 'deposit',
      refId: deposit.id,
      note: `${amount} ${deposit.currency} (${deposit.network})`,
    });
    await tx.user.update({
      where: { id: deposit.userId },
      data: { totalDeposited: { increment: credited } },
    });

    // every bonus and the partner commission ride on the same transaction as
    // the credit, so a deposit is whole or it did not happen
    const config = statusConfig();
    const level = levelFor(before.totalDeposited, config);
    const statusBonus = depositBonusFor(credited, level, config);
    if (statusBonus > 0) {
      await applyLedger(tx, {
        userId: deposit.userId,
        accountType: 'REAL',
        type: 'BONUS',
        amount: statusBonus,
        refType: 'deposit',
        refId: deposit.id,
        note: `${level.name} deposit bonus`,
      });
    }

    // a coupon bought in the marketplace, if one is held and worth more than
    // nothing on this deposit. Spent conditionally, so one deposit uses it once.
    const coupon = await couponFor(tx, { userId: deposit.userId, depositCents: credited });
    let couponBonus = 0;
    if (coupon && (await spendCoupon(tx, coupon.id))) {
      couponBonus = coupon.bonus;
      await applyLedger(tx, {
        userId: deposit.userId,
        accountType: 'REAL',
        type: 'BONUS',
        amount: couponBonus,
        refType: 'deposit',
        refId: deposit.id,
        note: 'Deposit bonus coupon',
      });
    }

    const bonus = deposit.promoCode
      ? await redeemPromo(tx, {
          code: deposit.promoCode,
          userId: deposit.userId,
          depositId: deposit.id,
          depositCents: credited,
        })
      : 0;
    const bonusTotal = bonus + statusBonus + couponBonus;
    if (bonusTotal > 0) {
      await tx.deposit.update({ where: { id: depositId }, data: { bonusAmount: bonusTotal } });
    }

    await payReferralCommission(tx, {
      referredId: deposit.userId,
      depositId: deposit.id,
      depositCents: credited,
    });

    return tx.deposit.findUnique({ where: { id: depositId } });
  });

  depositEvents.emit('updated', updated);
  return updated as Deposit;
}

export async function rejectDeposit(depositId: string, note: string): Promise<Deposit> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw notFound('Deposit not found');
  if (deposit.status === 'COMPLETED') throw conflict('Deposit was already credited', 'bad_status');
  const updated = await prisma.deposit.update({
    where: { id: depositId },
    data: { status: 'REJECTED', adminNote: note },
  });
  depositEvents.emit('updated', updated);
  return updated;
}

export async function expireStaleDeposits(): Promise<number> {
  const result = await prisma.deposit.updateMany({
    where: { status: 'AWAITING_PAYMENT', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

export function listDeposits(userId: string, limit = 50) {
  return prisma.deposit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
