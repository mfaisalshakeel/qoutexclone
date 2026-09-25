import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError, badRequest } from '../lib/errors.js';
import { paginateCursor } from '../lib/list-query.js';

export type AccountType = 'DEMO' | 'REAL' | 'TOURNAMENT';
export type TxClient = Prisma.TransactionClient;

export const TX_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL_HOLD',
  'WITHDRAWAL_REFUND',
  'TRADE_STAKE',
  'TRADE_PAYOUT',
  'TRADE_REFUND',
  'BONUS',
  'REFERRAL_COMMISSION',
  'TOURNAMENT_ENTRY',
  'TOURNAMENT_PRIZE',
  'TOURNAMENT_REBUY',
  'TOURNAMENT_REFUND',
  'ADJUSTMENT',
  'DEMO_RESET',
  // marketplace: what an item cost, what a risk-free item refunded, and the
  // practice balance a refill item added
  'MARKETPLACE',
  'RISK_FREE_REFUND',
  'PRACTICE_TOPUP',
] as const;

export interface LedgerEntry {
  userId: string;
  accountType: AccountType;
  type: (typeof TX_TYPES)[number];
  amount: number; // signed cents
  refType?: string;
  refId?: string;
  note?: string;
}

function balanceField(accountType: AccountType): 'demoBalance' | 'realBalance' {
  // tournament chips live on the entry, not on the user — routing them through
  // the cash ledger would mint real money, so refuse loudly instead
  if (accountType === 'TOURNAMENT') {
    throw new AppError(500, 'Tournament balances are not part of the cash ledger', 'invalid_account');
  }
  return accountType === 'DEMO' ? 'demoBalance' : 'realBalance';
}

/**
 * Single choke point for every balance change: applies the delta, refuses to
 * overdraw, and writes the matching ledger row. Always call inside a
 * `prisma.$transaction` so balance and ledger move together.
 */
export async function applyLedger(tx: TxClient, entry: LedgerEntry): Promise<number> {
  const user = await tx.user.findUnique({
    where: { id: entry.userId },
    select: { demoBalance: true, realBalance: true },
  });
  if (!user) throw new AppError(404, 'Account not found', 'not_found');

  const field = balanceField(entry.accountType);
  const current = user[field];
  const next = current + entry.amount;
  if (next < 0) {
    throw badRequest('Insufficient balance for this operation', 'insufficient_funds', {
      balance: current,
      requested: Math.abs(entry.amount),
    });
  }

  await tx.user.update({ where: { id: entry.userId }, data: { [field]: next } });
  await tx.transaction.create({
    data: {
      userId: entry.userId,
      accountType: entry.accountType,
      type: entry.type,
      amount: entry.amount,
      balanceAfter: next,
      refType: entry.refType,
      refId: entry.refId,
      note: entry.note,
    },
  });
  return next;
}

/** Moves funds from the spendable real balance into the pending-withdrawal hold. */
export async function holdFunds(
  tx: TxClient,
  userId: string,
  amount: number,
  withdrawalId: string,
): Promise<number> {
  const balance = await applyLedger(tx, {
    userId,
    accountType: 'REAL',
    type: 'WITHDRAWAL_HOLD',
    amount: -amount,
    refType: 'withdrawal',
    refId: withdrawalId,
    note: 'Funds reserved for withdrawal',
  });
  await tx.user.update({ where: { id: userId }, data: { lockedBalance: { increment: amount } } });
  return balance;
}

/** Returns held funds to the spendable balance (rejected or cancelled withdrawal). */
export async function releaseHold(
  tx: TxClient,
  userId: string,
  amount: number,
  withdrawalId: string,
  note: string,
): Promise<number> {
  await tx.user.update({ where: { id: userId }, data: { lockedBalance: { decrement: amount } } });
  return applyLedger(tx, {
    userId,
    accountType: 'REAL',
    type: 'WITHDRAWAL_REFUND',
    amount,
    refType: 'withdrawal',
    refId: withdrawalId,
    note,
  });
}

/** Consumes held funds once the payout actually leaves the platform. */
export async function settleHold(tx: TxClient, userId: string, amount: number): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { lockedBalance: { decrement: amount }, totalWithdrawn: { increment: amount } },
  });
}

export async function getBalances(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { demoBalance: true, realBalance: true, lockedBalance: true, activeAccount: true },
  });
  if (!user) throw new AppError(404, 'Account not found', 'not_found');
  return user;
}

export async function listTransactions(
  userId: string,
  options: { accountType?: AccountType; limit?: number; cursor?: string },
) {
  return paginateCursor({
    findMany: (args) => prisma.transaction.findMany(args as never),
    where: { userId, ...(options.accountType ? { accountType: options.accountType } : {}) },
    orderBy: { createdAt: 'desc' },
    cursor: options.cursor,
    pageSize: Math.min(options.limit ?? 50, 200),
  });
}
