/**
 * Limits a trader sets on themselves, against a real database.
 *
 * All of it is server-side by design, so all of it is tested here: the
 * cooling-off on loosening, the day's usage, the refusals, and the exclusion
 * that must never close the door on someone's own money.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('responsible trading', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let responsible: typeof import('../../services/responsible.js');
  let withdrawals: typeof import('../../services/withdrawals.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];

  const made: string[] = [];
  let assetId = '';

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: {
        email: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Careful Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 100_000,
        totalDeposited: 100_000,
        kycStatus: 'APPROVED',
      },
    });
    made.push(user.id);
    return user;
  };

  const loseToday = async (userId: string, cents: number) => {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    await prisma.trade.create({
      data: {
        userId,
        assetId: asset.id,
        symbol: asset.symbol,
        accountType: 'REAL',
        direction: 'UP',
        stake: cents,
        payoutPct: 80,
        entryPrice: 1,
        exitPrice: 0.5,
        durationSec: 60,
        openedAt: new Date(),
        expiresAt: new Date(),
        settledAt: new Date(),
        status: 'LOST',
        profit: -cents,
      },
    });
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    responsible = await import('../../services/responsible.js');
    withdrawals = await import('../../services/withdrawals.js');
    settings = (await import('../../services/settings.js')).settings;
    await settings.load();

    const symbol = `RT${Date.now().toString(36).toUpperCase()}`;
    const asset = await prisma.asset.create({
      data: {
        symbol,
        feedSymbol: symbol,
        name: 'Limit Test',
        pair: 'RT/US',
        assetClass: 'CRYPTO',
        base: 'RT',
        quote: 'US',
        isOtc: true,
        payoutPct: 80,
        basePrice: 100,
        volatility: 0.5,
        precision: 2,
      },
    });
    assetId = asset.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { userId: { in: made } } });
    await prisma.responsibleLimits.deleteMany({ where: { userId: { in: made } } });
    await prisma.withdrawal.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    if (assetId) await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.$disconnect();
  });

  it('applies a tightening at once and makes a loosening wait', async () => {
    const user = await makeUser();

    const tightened = await responsible.setLimits(user.id, { dailyLossCents: 5_000 });
    expect(tightened.dailyLossCents).toBe(5_000);
    expect(tightened.pending).toBeNull();

    const loosened = await responsible.setLimits(user.id, { dailyLossCents: 50_000 });
    expect(loosened.dailyLossCents).toBe(5_000);
    expect(loosened.pending?.dailyLossCents).toBe(50_000);
    expect(loosened.pendingAt).not.toBeNull();
  });

  it('lands the loosening once the cooling-off has passed', async () => {
    const user = await makeUser();
    await responsible.setLimits(user.id, { dailyLossCents: 5_000 });
    await responsible.setLimits(user.id, { dailyLossCents: 50_000 });

    await prisma.responsibleLimits.update({
      where: { userId: user.id },
      data: { pendingAt: new Date(Date.now() - 1_000) },
    });

    const now = await responsible.limitsFor(user.id);
    expect(now.dailyLossCents).toBe(50_000);
    expect(now.pending).toBeNull();
  });

  it('lets a waiting loosening be cancelled', async () => {
    const user = await makeUser();
    await responsible.setLimits(user.id, { dailyLossCents: 5_000 });
    await responsible.setLimits(user.id, { dailyLossCents: 50_000 });

    const cancelled = await responsible.cancelPending(user.id);
    expect(cancelled.pending).toBeNull();
    expect(cancelled.dailyLossCents).toBe(5_000);
  });

  it('refuses a new stake once the day’s losses reach the limit', async () => {
    const user = await makeUser();
    await responsible.setLimits(user.id, { dailyLossCents: 5_000 });

    await responsible.assertCanStake(user.id, 'REAL');
    await loseToday(user.id, 5_000);

    await expect(responsible.assertCanStake(user.id, 'REAL')).rejects.toThrow(/daily loss limit/);
    // practice is never limited: there is nothing there to lose
    await responsible.assertCanStake(user.id, 'DEMO');
  });

  it('refuses a deposit that would pass the day’s limit, and says what is left', async () => {
    const user = await makeUser();
    await responsible.setLimits(user.id, { dailyDepositCents: 20_000 });

    await responsible.assertCanDeposit(user.id, 20_000);
    await expect(responsible.assertCanDeposit(user.id, 20_001)).rejects.toThrow(/\$200\.00 more today/);
  });

  it('closes the account for the period, and only ever extends it', async () => {
    const user = await makeUser();
    const week = await responsible.selfExclude(user.id, 7);
    expect(week.excludedUntil).not.toBeNull();

    // a shorter period cannot shorten it
    const day = await responsible.selfExclude(user.id, 1);
    expect(day.excludedUntil!.getTime()).toBe(week.excludedUntil!.getTime());

    // a longer one extends it
    const month = await responsible.selfExclude(user.id, 30);
    expect(month.excludedUntil!.getTime()).toBeGreaterThan(week.excludedUntil!.getTime());

    await expect(responsible.assertCanStake(user.id, 'REAL')).rejects.toThrow(/close your account/);
    await expect(responsible.assertCanDeposit(user.id, 100)).rejects.toThrow(/close your account/);
  });

  it('never stops a self-excluded trader withdrawing their own money', async () => {
    const user = await makeUser();
    await responsible.selfExclude(user.id, 30);

    const withdrawal = await withdrawals.createWithdrawal({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KNQ7gY',
      amountCents: 10_000,
    });
    expect(withdrawal.amount).toBe(10_000);
  });

  it('counts only today, and only live money', async () => {
    const user = await makeUser();
    await loseToday(user.id, 3_000);

    const usage = await responsible.usageToday(user.id);
    expect(usage.lossCents).toBe(3_000);

    // a loss from yesterday does not count
    await prisma.trade.updateMany({
      where: { userId: user.id },
      data: { settledAt: new Date(Date.now() - 48 * 3_600_000) },
    });
    expect((await responsible.usageToday(user.id)).lossCents).toBe(0);
  });
});
