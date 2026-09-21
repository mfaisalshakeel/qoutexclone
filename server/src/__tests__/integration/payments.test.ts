/**
 * The provider framework against a real database.
 *
 * The pure fee/limit maths is covered by `payments.test.ts`; what only shows
 * up across rows is whether a disabled or country-restricted method actually
 * stops a deposit or withdrawal, and whether an operator's fee edit reaches
 * the quote a trader is given.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('payment methods', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let deposits: typeof import('../../services/deposits.js');
  let withdrawals: typeof import('../../services/withdrawals.js');

  const made: string[] = [];
  const KEY = 'crypto-usdt-trc20';

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Payments Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 100_000,
        totalDeposited: 100_000,
        kycStatus: 'APPROVED',
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  const restoreMethod = async () =>
    prisma.paymentMethod.update({
      where: { key: KEY },
      data: {
        enabled: true,
        countries: Prisma.DbNull,
        minDepositCents: 1_000,
        minWithdrawCents: 1_000,
        feeFlatCents: 100,
      },
    });

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    deposits = await import('../../services/deposits.js');
    withdrawals = await import('../../services/withdrawals.js');
    // the seeded row's real fields; a broken earlier run must not leave it wrong
    await restoreMethod();
  });

  afterAll(async () => {
    if (!prisma) return;
    await restoreMethod();
    await prisma.deposit.deleteMany({ where: { userId: { in: made } } });
    await prisma.withdrawal.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('refuses a deposit on a disabled method', async () => {
    const user = await makeUser();
    await prisma.paymentMethod.update({ where: { key: KEY }, data: { enabled: false } });
    try {
      await expect(
        deposits.createDeposit({ userId: user.id, currency: 'USDT', network: 'TRC20', usdAmount: 50 }),
      ).rejects.toMatchObject({ code: 'method_disabled' });
    } finally {
      await restoreMethod();
    }
  });

  it('refuses a deposit not offered in the trader’s country', async () => {
    const user = await makeUser({ country: 'FR' });
    await prisma.paymentMethod.update({ where: { key: KEY }, data: { countries: ['US', 'GB'] } });
    try {
      await expect(
        deposits.createDeposit({ userId: user.id, currency: 'USDT', network: 'TRC20', usdAmount: 50 }),
      ).rejects.toThrow(/not offered in your country/);
    } finally {
      await restoreMethod();
    }
  });

  it('allows a deposit from a listed country', async () => {
    const user = await makeUser({ country: 'US' });
    await prisma.paymentMethod.update({ where: { key: KEY }, data: { countries: ['US', 'GB'] } });
    try {
      const deposit = await deposits.createDeposit({
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        usdAmount: 50,
      });
      expect(deposit.status).toBe('AWAITING_PAYMENT');
    } finally {
      await restoreMethod();
    }
  });

  it('enforces an operator-set deposit maximum', async () => {
    const user = await makeUser();
    await prisma.paymentMethod.update({ where: { key: KEY }, data: { maxDepositCents: 10_000 } });
    try {
      await expect(
        deposits.createDeposit({ userId: user.id, currency: 'USDT', network: 'TRC20', usdAmount: 500 }),
      ).rejects.toMatchObject({ code: 'above_maximum' });
    } finally {
      await prisma.paymentMethod.update({ where: { key: KEY }, data: { maxDepositCents: 0 } });
    }
  });

  it('an operator’s fee edit reaches the withdrawal quote', async () => {
    await prisma.paymentMethod.update({ where: { key: KEY }, data: { feeFlatCents: 500 } });
    try {
      const quote = withdrawals.quoteWithdrawal(
        'USDT',
        'TRC20',
        10_000,
        await prisma.paymentMethod.findUnique({ where: { key: KEY } }),
      );
      // the network's own $1 fee, plus the platform's flat fee, plus the
      // method's own $5 the operator just set
      expect(quote.fee).toBeGreaterThanOrEqual(500);
    } finally {
      await restoreMethod();
    }
  });

  it('refuses a withdrawal on a method disabled after the deposit was made', async () => {
    const user = await makeUser({ realBalance: 100_000 });
    await prisma.paymentMethod.update({ where: { key: KEY }, data: { enabled: false } });
    try {
      await expect(
        withdrawals.createWithdrawal({
          userId: user.id,
          currency: 'USDT',
          network: 'TRC20',
          address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KNQ7gY',
          amountCents: 5_000,
        }),
      ).rejects.toMatchObject({ code: 'method_disabled' });
    } finally {
      await restoreMethod();
    }
  });

  it('still serves a network defined in code but not yet seeded', async () => {
    // simulates the "just added a network in code, migration not run yet" case
    const deleted = await prisma.paymentMethod.delete({ where: { key: KEY } });
    try {
      const user = await makeUser();
      const deposit = await deposits.createDeposit({
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        usdAmount: 50,
      });
      expect(deposit.status).toBe('AWAITING_PAYMENT');
    } finally {
      const { id: _id, ...rest } = deleted;
      await prisma.paymentMethod.create({ data: { ...rest, countries: deleted.countries ?? Prisma.DbNull } });
    }
  });
});
