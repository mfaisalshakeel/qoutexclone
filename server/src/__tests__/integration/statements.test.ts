/**
 * Statement generation against real ledger rows.
 *
 * `renderStatementCsv` is proven column-by-column in `statements.test.ts`; what
 * only shows up here is that `statementRows` reads the same ledger
 * `applyLedger` writes, filters to REAL only, and respects a date range — and
 * that `renderStatementPdf` produces an actual PDF, not just a buffer that
 * happens not to throw.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('account statements', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let deposits: typeof import('../../services/deposits.js');
  let withdrawals: typeof import('../../services/withdrawals.js');
  let statements: typeof import('../../services/statements.js');

  const made: string[] = [];

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Statement Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        kycStatus: 'APPROVED',
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    deposits = await import('../../services/deposits.js');
    withdrawals = await import('../../services/withdrawals.js');
    statements = await import('../../services/statements.js');
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.transaction.deleteMany({ where: { userId: { in: made } } });
    await prisma.withdrawal.deleteMany({ where: { userId: { in: made } } });
    await prisma.deposit.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('lists real-account ledger rows in chronological order, demo excluded', async () => {
    const user = await makeUser();
    const deposit = await deposits.createDeposit({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 200,
    });
    await deposits.completeDeposit(deposit.id);
    // a demo reset or practice trade would land on the DEMO account, which a
    // real-money statement must never show
    await prisma.transaction.create({
      data: {
        userId: user.id,
        accountType: 'DEMO',
        type: 'DEMO_RESET',
        amount: 1_000_000,
        balanceAfter: 1_000_000,
        note: 'demo top-up',
      },
    });

    const rows = await statements.statementRows(user.id, {});
    expect(rows.every((r) => r.accountType === 'REAL')).toBe(true);
    expect(rows.some((r) => r.type === 'DEPOSIT')).toBe(true);
    expect(rows.some((r) => r.type === 'DEMO_RESET')).toBe(false);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].createdAt.getTime()).toBeGreaterThanOrEqual(rows[i - 1].createdAt.getTime());
    }
  });

  it('excludes a transaction outside the requested date range', async () => {
    const user = await makeUser();
    const deposit = await deposits.createDeposit({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 50,
    });
    await deposits.completeDeposit(deposit.id);

    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const rows = await statements.statementRows(user.id, { from: farFuture });
    expect(rows).toHaveLength(0);
  });

  it('refuses a range where the start is after the end', async () => {
    const user = await makeUser();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000);
    await expect(statements.statementRows(user.id, { from: now, to: yesterday })).rejects.toMatchObject({
      code: 'invalid_range',
    });
  });

  it('produces a valid, non-trivial PDF covering a deposit and a withdrawal', async () => {
    const user = await makeUser({ realBalance: 100_000 });
    const deposit = await deposits.createDeposit({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 300,
    });
    await deposits.completeDeposit(deposit.id);
    const withdrawal = await withdrawals.createWithdrawal({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      address: 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC',
      amountCents: 20_000,
    });
    await withdrawals.rejectWithdrawal(withdrawal.id, null, 'test cleanup');

    const rows = await statements.statementRows(user.id, {});
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const pdf = await statements.renderStatementPdf(rows, { email: user.email, range: {} });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  it('renders an empty PDF for a trader with no ledger history at all', async () => {
    const user = await makeUser();
    const pdf = await statements.renderStatementPdf([], { email: user.email, range: {} });
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
