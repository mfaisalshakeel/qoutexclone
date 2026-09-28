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
 *
 * The balance read below is `SELECT ... FOR UPDATE`, not a plain read. MySQL's
 * default REPEATABLE READ isolation gives a plain `SELECT` inside a
 * transaction a snapshot taken when the transaction started — it does not
 * block a concurrent transaction from reading the same stale snapshot, so two
 * trades staking the same account at once could each compute "current minus
 * my stake" from the same before-either-committed number and the second
 * `UPDATE` would silently overwrite the first's, losing a debit or a credit
 * with no error at all (not even Prisma's own P2034: that only fires for a
 * conflict InnoDB's deadlock/serialization detector actually catches, which a
 * lost update like this one is not guaranteed to be). `FOR UPDATE` takes a
 * real row lock on the read, so a second concurrent call blocks until the
 * first's transaction resolves and then reads the value it actually left
 * behind — the ordinary, correct way to serialise a read-modify-write in SQL.
 * Found by the "Scale" load test at 1,000 concurrent traders; a unit test
 * cannot reproduce it; `__tests__/integration/scale.test.ts` proves the fix
 * with real concurrent database transactions.
 */
export async function applyLedger(tx: TxClient, entry: LedgerEntry): Promise<number> {
  const field = balanceField(entry.accountType);
  const rows = await tx.$queryRaw<{ demoBalance: number; realBalance: number }[]>`
    SELECT demoBalance, realBalance FROM User WHERE id = ${entry.userId} FOR UPDATE
  `;
  const user = rows[0];
  if (!user) throw new AppError(404, 'Account not found', 'not_found');

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
