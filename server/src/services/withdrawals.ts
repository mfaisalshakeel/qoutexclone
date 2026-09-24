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
import {
  assertMethodAvailable,
  assertWithinLimits,
  cryptoMethodKey,
  feeFor,
  findMethod,
  methodByKey,
  providerFor,
} from './payments.js';
import type { PaymentMethod } from '@prisma/client';
import { startOfDay } from './responsible.js';
import { levelFor, statusConfig, type StatusLevel } from './status.js';

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
/**
 * Pure and synchronous on purpose: the network's static mechanics
 * (`NETWORKS`) always apply, and a `PaymentMethod` row — the operator-editable
 * fees and limits — is layered on top when the caller has one. Callers fetch
 * it themselves (`findMethod(cryptoMethodKey(...))`) rather than this function
 * doing it, so quoting a price is not a database call and stays unit-testable.
 */
export function quoteWithdrawal(
  currency: string,
  network: string,
  amountCents: number,
  method?: PaymentMethod | null,
): WithdrawalQuote {
  const spec = findNetwork(currency, network);
  if (!spec) throw badRequest('Unsupported currency/network combination', 'unsupported_network');

  const minAmount = usdToCents(
    Math.max(
      spec.minWithdrawUsd,
      settings.get('wallet.minWithdrawUsd'),
      (method?.minWithdrawCents ?? 0) / 100,
    ),
  );
  const flatFee =
    usdToCents(spec.networkFeeUsd + settings.get('wallet.withdrawFlatFeeUsd')) + (method?.feeFlatCents ?? 0);
  const pctFee = Math.round(
    (amountCents * (settings.get('wallet.withdrawFeePct') + (method?.feePct ?? 0))) / 100,
  );
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

/**
 * How much of the operator's daily cap this trader has already used today.
 *
 * Counts a request the moment it exists, not only once it settles: money held
 * against a pending withdrawal is committed, and letting it back out of the
 * count would let someone file five at once and beat the cap on the gap
 * between "requested" and "completed".
 */
async function withdrawnToday(userId: string): Promise<number> {
  const result = await prisma.withdrawal.aggregate({
    where: {
      userId,
      status: { in: ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED'] },
      createdAt: { gte: startOfDay() },
    },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

/** Refuses a withdrawal that would take the trader past the operator's daily cap. */
async function assertWithinDailyCap(userId: string, amountCents: number): Promise<void> {
  const cap = settings.get('wallet.maxDailyWithdrawalCents');
  if (cap <= 0) return;
  const already = await withdrawnToday(userId);
  if (already + amountCents > cap) {
    const left = Math.max(cap - already, 0);
    throw forbidden(
      left === 0
        ? 'You have reached the daily withdrawal limit on this platform. It resets at midnight UTC.'
        : `That would pass the daily withdrawal limit on this platform. You can withdraw $${(left / 100).toFixed(2)} more today.`,
    );
  }
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

  const method = await findMethod(cryptoMethodKey(input.currency, input.network));
  const quote = quoteWithdrawal(input.currency, input.network, input.amountCents, method);
  if (input.amountCents < quote.minAmount) {
    throw badRequest(`Minimum withdrawal is $${(quote.minAmount / 100).toFixed(2)}`, 'below_minimum');
  }
  if (quote.netAmount <= 0) throw badRequest('Amount does not cover the network fee', 'below_fee');

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { realBalance: true, status: true, totalDeposited: true, kycStatus: true, country: true },
  });
  if (!user) throw notFound('Account not found');
  if (user.status !== 'ACTIVE') throw forbidden('Your account is suspended');

  if (method) {
    assertMethodAvailable(method, user.country);
    assertWithinLimits(method, input.amountCents, 'withdraw');
  }
  if (kycBlocksWithdrawal(user.kycStatus, input.amountCents)) {
    throw forbidden('Identity verification is required before withdrawing this amount');
  }
  if (user.realBalance < input.amountCents) throw badRequest('Insufficient balance', 'insufficient_funds');
  await assertWithinDailyCap(input.userId, input.amountCents);

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

/**
 * An e-wallet withdrawal, in place of a crypto address, network and fee: a
 * handle the sandbox provider will send to, and its own fee schedule from the
 * `PaymentMethod` row. Everything else — KYC, the bonus hold, the pending-
 * request cap, the daily cap, the ledger hold — is the same gate a crypto
 * withdrawal goes through, because none of those checks have anything to do
 * with which provider ends up moving the money.
 */
export interface CreateEwalletWithdrawalInput {
  userId: string;
  destination: string;
  amountCents: number;
}

/** A loose but real check: an e-wallet handle is conventionally an email. */
const EWALLET_HANDLE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createEwalletWithdrawal(input: CreateEwalletWithdrawalInput): Promise<Withdrawal> {
  const destination = input.destination.trim();
  if (!EWALLET_HANDLE.test(destination)) {
    throw badRequest('Enter the email address your e-wallet account uses', 'invalid_address');
  }

  const method = await methodByKey('ewallet-usd');
  const priced = feeFor(method, input.amountCents);
  const netAmount = priced.net;
  if (input.amountCents < method.minWithdrawCents) {
    throw badRequest(`Minimum withdrawal is $${(method.minWithdrawCents / 100).toFixed(2)}`, 'below_minimum');
  }
  if (netAmount <= 0) throw badRequest('Amount does not cover the fee', 'below_fee');

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { realBalance: true, status: true, totalDeposited: true, kycStatus: true, country: true },
  });
  if (!user) throw notFound('Account not found');
  if (user.status !== 'ACTIVE') throw forbidden('Your account is suspended');

  assertMethodAvailable(method, user.country);
  assertWithinLimits(method, input.amountCents, 'withdraw');
  if (kycBlocksWithdrawal(user.kycStatus, input.amountCents)) {
    throw forbidden('Identity verification is required before withdrawing this amount');
  }
  if (user.realBalance < input.amountCents) throw badRequest('Insufficient balance', 'insufficient_funds');
  await assertWithinDailyCap(input.userId, input.amountCents);

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
        currency: method.currency,
        network: method.provider,
        address: destination,
        amount: input.amountCents,
        fee: priced.fee,
        netAmount,
        rate: 1,
        cryptoAmount: (netAmount / 100).toFixed(2),
        status: 'PENDING',
      },
    });
    await holdFunds(tx, input.userId, input.amountCents, created.id);
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
    if (withdrawal.network === 'EWALLET') {
      const method = await methodByKey('ewallet-usd');
      const payout = await providerFor('EWALLET').payout({
        method,
        amountCents: withdrawal.amount,
        destination: withdrawal.address,
        reference: withdrawal.id,
      });
      txHash = payout.externalId;
    } else {
      const payout = await custody.sendPayout({
        currency: withdrawal.currency,
        network: withdrawal.network,
        address: withdrawal.address,
        amount: withdrawal.cryptoAmount,
        reference: withdrawal.id,
      });
      txHash = payout.txHash;
    }
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

/**
 * The pending queue's standing order: a higher trader status level is served
 * first, and within a level the oldest request goes first. This isn't a
 * database column — it's derived from the trader's lifetime deposits and the
 * admin-configurable status thresholds — so it can't be a Prisma `orderBy`
 * and is computed and sorted here instead. Only ever applied to the pending
 * queue; a decided withdrawal is history, in the order it happened.
 */
export function priorityOrder<
  T extends { createdAt: Date; user: { totalDeposited: number; statusLevelOverride?: string | null } },
>(rows: T[]): (T & { level: StatusLevel })[] {
  const config = statusConfig();
  return rows
    .map((row) => ({ ...row, level: levelFor(row.user.totalDeposited, config, row.user.statusLevelOverride) }))
    .sort((a, b) => b.level.priority - a.level.priority || a.createdAt.getTime() - b.createdAt.getTime());
}
