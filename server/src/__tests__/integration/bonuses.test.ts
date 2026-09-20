/**
 * Bonus turnover against a real database.
 *
 * Bonus money is credited to the balance like any other money; what a bonus
 * row holds back is the right to withdraw it. That distinction is only
 * testable across rows, which is why it lives here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('bonus turnover', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let bonuses: typeof import('../../services/bonuses.js');
  let withdrawals: typeof import('../../services/withdrawals.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];

  const made = { users: [] as string[], offers: [] as string[] };

  const makeUser = async (realBalance = 100_000) => {
    const user = await prisma.user.create({
      data: {
        email: `bn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Bonus Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance,
        totalDeposited: realBalance,
        kycStatus: 'APPROVED',
      },
    });
    made.users.push(user.id);
    return user;
  };

  const grant = async (userId: string, amount: number, multiplier: number) =>
    prisma.$transaction((tx) => bonuses.recordBonus(tx, { userId, amount, source: 'deposit', multiplier }));

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    bonuses = await import('../../services/bonuses.js');
    withdrawals = await import('../../services/withdrawals.js');
    settings = (await import('../../services/settings.js')).settings;
    await settings.load();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.bonus.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.withdrawal.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.bonusOffer.deleteMany({ where: { id: { in: made.offers } } });
    await prisma.$disconnect();
  });

  it('locks a bonus until it has been staked enough times', async () => {
    const user = await makeUser();
    await grant(user.id, 5_000, 10);

    const hold = await bonuses.holdFor(user.id);
    expect(hold.locked).toBe(5_000);
    expect(hold.remaining).toBe(50_000);
    expect(hold.percent).toBe(0);
  });

  it('releases it at once when the multiplier is zero', async () => {
    const user = await makeUser();
    await grant(user.id, 5_000, 0);
    expect((await bonuses.holdFor(user.id)).locked).toBe(0);
  });

  it('counts live stakes towards it, and releases it exactly on the requirement', async () => {
    const user = await makeUser();
    await grant(user.id, 1_000, 10); // needs 10,000 staked

    await bonuses.creditTurnover({ userId: user.id, stake: 4_000, accountType: 'REAL' });
    expect((await bonuses.holdFor(user.id)).remaining).toBe(6_000);

    // practice never counts
    await bonuses.creditTurnover({ userId: user.id, stake: 100_000, accountType: 'DEMO' });
    expect((await bonuses.holdFor(user.id)).remaining).toBe(6_000);

    await bonuses.creditTurnover({ userId: user.id, stake: 6_000, accountType: 'REAL' });
    const cleared = await bonuses.holdFor(user.id);
    expect(cleared.locked).toBe(0);
    expect(cleared.bonuses).toHaveLength(0);

    const row = await prisma.bonus.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.status).toBe('RELEASED');
    expect(row.releasedAt).not.toBeNull();
  });

  it('pays down one bonus at a time, oldest first', async () => {
    const user = await makeUser();
    await grant(user.id, 1_000, 5); // 5,000
    await grant(user.id, 2_000, 5); // 10,000

    // a $60 stake clears the first and starts the second — not $60 against both
    await bonuses.creditTurnover({ userId: user.id, stake: 6_000, accountType: 'REAL' });

    const rows = await prisma.bonus.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(rows[0].status).toBe('RELEASED');
    expect(rows[1].status).toBe('ACTIVE');
    expect(rows[1].staked).toBe(1_000);
  });

  it('refuses a withdrawal that would take locked bonus money', async () => {
    const user = await makeUser(20_000);
    await grant(user.id, 10_000, 10);

    // $100 more than the free $100
    await expect(
      withdrawals.createWithdrawal({
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KNQ7gY',
        amountCents: 15_000,
      }),
    ).rejects.toMatchObject({ code: 'bonus_locked' });

    // and allows one that stays inside what is free
    const ok = await withdrawals.createWithdrawal({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KNQ7gY',
      amountCents: 10_000,
    });
    expect(ok.amount).toBe(10_000);
  });

  it('lets an operator release the hold without touching the money', async () => {
    const user = await makeUser();
    await grant(user.id, 5_000, 10);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const released = await prisma.$transaction((tx) => bonuses.forfeitAll(tx, user.id));
    expect(released).toBe(5_000);
    expect((await bonuses.holdFor(user.id)).locked).toBe(0);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.realBalance).toBe(before.realBalance);
  });

  it('stops holding anything once an operator turns bonuses off', async () => {
    const user = await makeUser();
    await grant(user.id, 5_000, 10);

    await settings.set('wallet.bonusesEnabled', false);
    try {
      expect((await bonuses.holdFor(user.id)).locked).toBe(0);
    } finally {
      await settings.reset('wallet.bonusesEnabled');
    }
  });
});
