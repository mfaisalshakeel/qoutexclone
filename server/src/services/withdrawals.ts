import type { Withdrawal } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { centsToCrypto, usdToCents } from '../lib/money.js';
import { findNetwork, isValidAddress } from '../lib/crypto-networks.js';
import { custody } from './custody.js';
import { usdRate } from './rates.js';
import { holdFunds, releaseHold, settleHold } from './wallet.js';
import { kycBlocksWithdrawal } from './kyc.js';
import { settings } from './settings.js';
import { holdFor } from './bonuses.js';

export const withdrawalEvents = new EventEmitter();

export interface WithdrawalQuote {
  currency: string;
  network: string;
  amount: number; // gross cents
  fee: number; // cents
  netAmount: number; // cents actually sent
  rate: number;
  cryptoAmount: string;
  minAmount: number; // cents
}

/** Fee model: flat network fee plus a percentage of the gross amount. */
export function quoteWithdrawal(currency: string, network: string, amountCents: number): WithdrawalQuote {
  const spec = findNetwork(currency, network);
  if (!spec) throw badRequest('Unsupported currency/network combination', 'unsupported_network');

  const minAmount = usdToCents(Math.max(spec.minWithdrawUsd, settings.get('wallet.minWithdrawUsd')));
  const flatFee = usdToCents(spec.networkFeeUsd + settings.get('wallet.withdrawFlatFeeUsd'));
  const pctFee = Math.round((amountCents * settings.get('wallet.withdrawFeePct')) / 100);
  const fee = flatFee + pctFee;
  const netAmount = amountCents - fee;
  const rate = usdRate(currency);

  return {
    currency,
    network,
    amount: amountCents,
    fee,
    netAmount,
    rate,
    cryptoAmount: netAmount > 0 ? centsToCrypto(netAmount, rate, spec.decimals) : '0',
    minAmount,
  };
}

export interface CreateWithdrawalInput {
  userId: string;
  currency: string;
  network: string;
  address: string;
  amountCents: number;
}

export async function createWithdrawal(input: CreateWithdrawalInput): Promise<Withdrawal> {
  const spec = findNetwork(input.currency, input.network);
  if (!spec) throw badRequest('Unsupported currency/network combination', 'unsupported_network');

  const address = input.address.trim();
  if (!isValidAddress(input.currency, input.network, address)) {
    throw badRequest(`That does not look like a valid ${spec.label} address`, 'invalid_address');
  }

  const quote = quoteWithdrawal(input.currency, input.network, input.amountCents);
  if (input.amountCents < quote.minAmount) {
    throw badRequest(`Minimum withdrawal is $${(quote.minAmount / 100).toFixed(2)}`, 'below_minimum');
  }
  if (quote.netAmount <= 0) throw badRequest('Amount does not cover the network fee', 'below_fee');

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { realBalance: true, status: true, totalDeposited: true, kycStatus: true },
  });
  if (!user) throw notFound('Account not found');
  if (user.status !== 'ACTIVE') throw forbidden('Your account is suspended');
  if (kycBlocksWithdrawal(user.kycStatus, input.amountCents)) {
    throw forbidden('Identity verification is required before withdrawing this amount');
  }
  if (user.realBalance < input.amountCents) throw badRequest('Insufficient balance', 'insufficient_funds');

  // bonus money is on the balance but not yet the trader's to take: it is
  // released by staking it, and until then it cannot leave
  const hold = await holdFor(input.userId);
  if (hold.locked > 0 && user.realBalance - hold.locked < input.amountCents) {
    throw badRequest(
      `$${(hold.locked / 100).toFixed(2)} of bonus is still locked. Stake $${(hold.remaining / 100).toFixed(2)} more to release it.`,
      'bonus_locked',
      { locked: hold.locked, remaining: hold.remaining, percent: hold.percent },
    );
  }

  const pending = await prisma.withdrawal.count({
    where: { userId: input.userId, status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } },
  });
  if (pending >= settings.get('wallet.maxPendingWithdrawals')) {
    throw conflict('You already have withdrawals in progress', 'too_many_pending');
  }

  const withdrawal = await prisma.$transaction(async (tx) => {
    const created = await tx.withdrawal.create({
      data: {
        userId: input.userId,
        currency: input.currency,
        network: input.network,
        address,
        amount: quote.amount,
        fee: quote.fee,
        netAmount: quote.netAmount,
        rate: quote.rate,
        cryptoAmount: quote.cryptoAmount,
        status: 'PENDING',
      },
    });
    // Funds leave the spendable balance immediately so they cannot be traded
    // while the payout is in review.
    await holdFunds(tx, input.userId, quote.amount, created.id);
    return created;
  });

  withdrawalEvents.emit('created', withdrawal);

  if (settings.get('wallet.autoApproveWithdrawals')) {
    return approveWithdrawal(withdrawal.id, null, 'Auto-approved');
  }
  return withdrawal;
}

/** Marks the payout approved, broadcasts it through custody and consumes the hold. */
export async function approveWithdrawal(
  withdrawalId: string,
  adminId: string | null,
  note?: string,
): Promise<Withdrawal> {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw notFound('Withdrawal not found');
  if (withdrawal.status !== 'PENDING') throw conflict('Withdrawal is not pending', 'bad_status');

  const claimed = await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: 'PENDING' },
    data: { status: 'PROCESSING', processedById: adminId, adminNote: note ?? null },
  });
  if (claimed.count === 0) throw conflict('Withdrawal is not pending', 'bad_status');

  let txHash: string;
  try {
    const payout = await custody.sendPayout({
      currency: withdrawal.currency,
      network: withdrawal.network,
      address: withdrawal.address,
      amount: withdrawal.cryptoAmount,
      reference: withdrawal.id,
    });
    txHash = payout.txHash;
  } catch (err) {
    // Broadcast failed: park it back in PENDING so the funds stay held and an
    // operator can retry rather than silently losing the request.
    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'PENDING', adminNote: `Payout failed: ${(err as Error).message}` },
    });
    throw conflict('Payout broadcast failed, withdrawal returned to pending', 'payout_failed');
  }

  const completed = await prisma.$transaction(async (tx) => {
    await settleHold(tx, withdrawal.userId, withdrawal.amount);
    return tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'COMPLETED', txHash, processedAt: new Date(), processedById: adminId },
    });
  });

  withdrawalEvents.emit('updated', completed);
  return completed;
}

export async function rejectWithdrawal(
  withdrawalId: string,
  adminId: string | null,
  note: string,
): Promise<Withdrawal> {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw notFound('Withdrawal not found');
  if (!['PENDING', 'APPROVED'].includes(withdrawal.status)) {
    throw conflict('Withdrawal can no longer be rejected', 'bad_status');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'REJECTED', adminNote: note, processedById: adminId, processedAt: new Date() },
    });
    if (claimed.count === 0) throw conflict('Withdrawal can no longer be rejected', 'bad_status');
    await releaseHold(
      tx,
      withdrawal.userId,
      withdrawal.amount,
      withdrawal.id,
      `Withdrawal rejected: ${note}`,
    );
    return tx.withdrawal.findUnique({ where: { id: withdrawalId } });
  });

  withdrawalEvents.emit('updated', updated);
  return updated as Withdrawal;
}

export async function cancelWithdrawal(userId: string, withdrawalId: string): Promise<Withdrawal> {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal || withdrawal.userId !== userId) throw notFound('Withdrawal not found');
  if (withdrawal.status !== 'PENDING')
    throw conflict('Only pending withdrawals can be cancelled', 'bad_status');

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: 'PENDING' },
      data: { status: 'CANCELLED', processedAt: new Date() },
    });
    if (claimed.count === 0) throw conflict('Only pending withdrawals can be cancelled', 'bad_status');
    await releaseHold(tx, userId, withdrawal.amount, withdrawal.id, 'Withdrawal cancelled by user');
    return tx.withdrawal.findUnique({ where: { id: withdrawalId } });
  });

  withdrawalEvents.emit('updated', updated);
  return updated as Withdrawal;
}

export function listWithdrawals(userId: string, limit = 50) {
  return prisma.withdrawal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
