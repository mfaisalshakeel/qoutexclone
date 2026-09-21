/**
 * E-wallet withdrawals and the operator daily cap, against a real database.
 *
 * `createEwalletWithdrawal` shares every gate with the crypto path
 * (`createWithdrawal`, covered in `flows.test.ts`) by design rather than by a
 * shared function — see withdrawals.ts. What is genuinely new here is the
 * handle validation, the EWALLET branch of `approveWithdrawal`, and the daily
 * cap, which crypto withdrawals go through too but nothing exercises yet.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('e-wallet withdrawals', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let withdrawals: typeof import('../../services/withdrawals.js');
  let payments: typeof import('../../services/payments.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let ewalletProvider: (typeof import('../../services/providers/ewallet.js'))['ewalletProvider'];
  let cardProvider: (typeof import('../../services/providers/card.js'))['cardProvider'];

  const made: string[] = [];

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `ew-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'E-wallet Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 500_000,
        totalDeposited: 500_000,
        kycStatus: 'APPROVED',
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    withdrawals = await import('../../services/withdrawals.js');
    payments = await import('../../services/payments.js');
    settings = (await import('../../services/settings.js')).settings;
    ewalletProvider = (await import('../../services/providers/ewallet.js')).ewalletProvider;
    cardProvider = (await import('../../services/providers/card.js')).cardProvider;
    payments.registerProvider(ewalletProvider);
    payments.registerProvider(cardProvider);
  });

  afterEach(async () => {
    await settings.reset('wallet.maxDailyWithdrawalCents');
    await settings.reset('wallet.maxPendingWithdrawals');
    await settings.reset('compliance.requireKycForWithdrawal');
    await settings.reset('compliance.kycWithdrawalThresholdUsd');
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.transaction.deleteMany({ where: { userId: { in: made } } });
    await prisma.withdrawal.deleteMany({ where: { userId: { in: made } } });
    await prisma.bonus.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('refuses a destination that is not email-shaped', async () => {
    const user = await makeUser();
    await expect(
      withdrawals.createEwalletWithdrawal({ userId: user.id, destination: 'not-an-email', amountCents: 5_000 }),
    ).rejects.toMatchObject({ code: 'invalid_address' });
  });

  it('quotes with the ewallet-usd method fee schedule and holds the gross amount', async () => {
    const user = await makeUser();
    const withdrawal = await withdrawals.createEwalletWithdrawal({
      userId: user.id,
      destination: 'trader@example.test',
      amountCents: 10_000, // $100
    });
    expect(withdrawal.network).toBe('EWALLET');
    expect(withdrawal.address).toBe('trader@example.test');
    expect(withdrawal.fee).toBe(150); // 1.5% of $100, matching the seeded method
    expect(withdrawal.netAmount).toBe(9_850);
    expect(withdrawal.status).toBe('PENDING');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.realBalance).toBe(500_000 - 10_000);
    expect(after.lockedBalance).toBe(10_000);
  });

  it('refuses an amount below the method minimum', async () => {
    const user = await makeUser();
    await expect(
      withdrawals.createEwalletWithdrawal({ userId: user.id, destination: 'trader@example.test', amountCents: 500 }),
    ).rejects.toMatchObject({ code: 'below_minimum' });
  });

  it('blocks withdrawal when KYC is required and not approved', async () => {
    await settings.set('compliance.requireKycForWithdrawal', true);
    await settings.set('compliance.kycWithdrawalThresholdUsd', 0);
    const user = await makeUser({ kycStatus: 'PENDING' });
    await expect(
      withdrawals.createEwalletWithdrawal({
        userId: user.id,
        destination: 'trader@example.test',
        amountCents: 5_000,
      }),
    ).rejects.toThrow(/Identity verification/i);
  });

  it('blocks a withdrawal that would dip into locked bonus money', async () => {
    const user = await makeUser({ realBalance: 10_000 });
    await prisma.bonus.create({
      data: { userId: user.id, source: 'deposit', amount: 10_000, required: 200_000, staked: 0 },
    });
    await expect(
      withdrawals.createEwalletWithdrawal({
        userId: user.id,
        destination: 'trader@example.test',
        amountCents: 5_000,
      }),
    ).rejects.toMatchObject({ code: 'bonus_locked' });
  });

  it('caps how many requests can be in flight at once', async () => {
    await settings.set('wallet.maxPendingWithdrawals', 1);
    const user = await makeUser();
    await withdrawals.createEwalletWithdrawal({
      userId: user.id,
      destination: 'trader@example.test',
      amountCents: 5_000,
    });
    await expect(
      withdrawals.createEwalletWithdrawal({
        userId: user.id,
        destination: 'trader@example.test',
        amountCents: 5_000,
      }),
    ).rejects.toMatchObject({ code: 'too_many_pending' });
  });

  it('pays out through the e-wallet provider and settles the hold', async () => {
    const user = await makeUser();
    const withdrawal = await withdrawals.createEwalletWithdrawal({
      userId: user.id,
      destination: 'trader@example.test',
      amountCents: 20_000,
    });

    const completed = await withdrawals.approveWithdrawal(withdrawal.id, null, 'approved by test');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.txHash).toBeTruthy();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedBalance).toBe(0);
    expect(after.totalWithdrawn).toBe(20_000);
  });

  it('returns the note and refunds the hold on rejection', async () => {
    const user = await makeUser();
    const withdrawal = await withdrawals.createEwalletWithdrawal({
      userId: user.id,
      destination: 'trader@example.test',
      amountCents: 15_000,
    });
    const rejected = await withdrawals.rejectWithdrawal(withdrawal.id, null, 'destination could not be verified');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.adminNote).toBe('destination could not be verified');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.realBalance).toBe(500_000);
    expect(after.lockedBalance).toBe(0);
  });

  describe('the operator daily cap', () => {
    it('sums pending, approved, processing and completed requests made today', async () => {
      await settings.set('wallet.maxDailyWithdrawalCents', 25_000);
      const user = await makeUser();

      await withdrawals.createEwalletWithdrawal({
        userId: user.id,
        destination: 'trader@example.test',
        amountCents: 20_000,
      });

      // a second request today would pass the $250 cap
      await expect(
        withdrawals.createEwalletWithdrawal({
          userId: user.id,
          destination: 'trader@example.test',
          amountCents: 10_000,
        }),
      ).rejects.toThrow(/daily withdrawal limit/i);
    });

    it('does not count a rejected withdrawal against the cap', async () => {
      await settings.set('wallet.maxDailyWithdrawalCents', 25_000);
      const user = await makeUser();

      const first = await withdrawals.createEwalletWithdrawal({
        userId: user.id,
        destination: 'trader@example.test',
        amountCents: 20_000,
      });
      await withdrawals.rejectWithdrawal(first.id, null, 'test rejection');

      // the rejected request freed its share of the cap back up
      await expect(
        withdrawals.createEwalletWithdrawal({
          userId: user.id,
          destination: 'trader@example.test',
          amountCents: 20_000,
        }),
      ).resolves.toMatchObject({ status: 'PENDING' });
    });

    it('a cap of zero means uncapped', async () => {
      await settings.set('wallet.maxDailyWithdrawalCents', 0);
      const user = await makeUser();
      await expect(
        withdrawals.createEwalletWithdrawal({
          userId: user.id,
          destination: 'trader@example.test',
          amountCents: 400_000,
        }),
      ).resolves.toMatchObject({ status: 'PENDING' });
    });

    it('applies the same cap to the crypto withdrawal path', async () => {
      await settings.set('wallet.maxDailyWithdrawalCents', 15_000);
      const user = await makeUser();
      await withdrawals.createWithdrawal({
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC',
        amountCents: 10_000,
      });
      await expect(
        withdrawals.createEwalletWithdrawal({
          userId: user.id,
          destination: 'trader@example.test',
          amountCents: 10_000,
        }),
      ).rejects.toThrow(/daily withdrawal limit/i);
    });
  });
});
