/**
 * End-to-end money flows against a real MySQL database.
 *
 * Skipped unless TEST_DATABASE_URL points at a database whose schema is up to
 * date (`DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy`). These
 * cover the paths where a bug costs real money: crediting, holding, refunding
 * and paying out.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('money flows', () => {
  let prisma: typeof import('../../lib/prisma.js')['prisma'];
  let deposits: typeof import('../../services/deposits.js');
  let withdrawals: typeof import('../../services/withdrawals.js');
  let trading: typeof import('../../services/trading.js');
  let feed: typeof import('../../engine/feed.js')['marketFeed'];

  const made = { users: [] as string[], promos: [] as string[], assets: [] as string[] };

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Integration Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        ...overrides,
      },
    });
    made.users.push(user.id);
    return user;
  };

  const balanceOf = async (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: { realBalance: true, lockedBalance: true, totalDeposited: true, totalWithdrawn: true, referralEarnings: true },
    });

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    deposits = await import('../../services/deposits.js');
    withdrawals = await import('../../services/withdrawals.js');
    trading = await import('../../services/trading.js');
    feed = (await import('../../engine/feed.js')).marketFeed;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.promoCode.deleteMany({ where: { id: { in: made.promos } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  it('credits a confirmed deposit exactly once', async () => {
    const user = await makeUser();
    const deposit = await deposits.createDeposit({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 200,
    });
    expect(deposit.status).toBe('AWAITING_PAYMENT');
    expect(deposit.cryptoAmount).toBe('200.000000');

    await deposits.completeDeposit(deposit.id, { txHash: 'test-hash' });
    const after = await balanceOf(user.id);
    expect(after.realBalance).toBe(20000);
    expect(after.totalDeposited).toBe(20000);

    // a repeated confirmation (webhook retry, admin double-click) must not pay twice
    await deposits.completeDeposit(deposit.id, { txHash: 'test-hash' });
    expect((await balanceOf(user.id)).realBalance).toBe(20000);

    const ledger = await prisma.transaction.findMany({ where: { userId: user.id, type: 'DEPOSIT' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].balanceAfter).toBe(20000);
  });

  it('applies a promo bonus once per user', async () => {
    const user = await makeUser();
    const promo = await prisma.promoCode.create({
      data: { code: `IT${Date.now()}`, kind: 'DEPOSIT_BONUS_PCT', value: 25, maxBonus: 5000 },
    });
    made.promos.push(promo.id);

    const first = await deposits.createDeposit({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 100,
      promoCode: promo.code,
    });
    await deposits.completeDeposit(first.id);
    // $100 deposit + 25% bonus
    expect((await balanceOf(user.id)).realBalance).toBe(12500);

    // the same code cannot be claimed again by the same trader
    await expect(
      deposits.createDeposit({
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        usdAmount: 100,
        promoCode: promo.code,
      }),
    ).rejects.toThrow(/already used/i);
  });

  it('pays the referrer a commission on a referred deposit', async () => {
    const referrer = await makeUser();
    const referred = await makeUser({ referredById: referrer.id });

    const deposit = await deposits.createDeposit({
      userId: referred.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 500,
    });
    await deposits.completeDeposit(deposit.id);

    const earner = await balanceOf(referrer.id);
    expect(earner.referralEarnings).toBe(2500); // 5% of $500
    expect(earner.realBalance).toBe(2500);

    // paying the same deposit twice is blocked by the unique constraint
    await deposits.completeDeposit(deposit.id);
    expect((await balanceOf(referrer.id)).referralEarnings).toBe(2500);
  });

  it('holds funds while a withdrawal is pending and refunds a rejection', async () => {
    const user = await makeUser({ realBalance: 50000 });

    const withdrawal = await withdrawals.createWithdrawal({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      address: 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC',
      amountCents: 20000,
    });
    let state = await balanceOf(user.id);
    expect(state.realBalance).toBe(30000);
    expect(state.lockedBalance).toBe(20000);

    // held funds cannot be spent on a trade
    await expect(
      withdrawals.createWithdrawal({
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC',
        amountCents: 40000,
      }),
    ).rejects.toThrow(/Insufficient balance/i);

    await withdrawals.rejectWithdrawal(withdrawal.id, null, 'test rejection');
    state = await balanceOf(user.id);
    expect(state.realBalance).toBe(50000);
    expect(state.lockedBalance).toBe(0);
  });

  it('consumes the hold when a payout completes', async () => {
    const user = await makeUser({ realBalance: 50000 });
    const withdrawal = await withdrawals.createWithdrawal({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      address: 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC',
      amountCents: 25000,
    });

    const completed = await withdrawals.approveWithdrawal(withdrawal.id, null, 'approved by test');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.txHash).toBeTruthy();

    const state = await balanceOf(user.id);
    expect(state.realBalance).toBe(25000);
    expect(state.lockedBalance).toBe(0);
    expect(state.totalWithdrawn).toBe(25000);
  });

  it('settles an expired position once, whatever calls it', async () => {
    const asset = await prisma.asset.upsert({
      where: { symbol: 'ITUSD' },
      update: {},
      create: {
        symbol: 'ITUSD',
        name: 'Integration Coin',
        base: 'IT',
        quote: 'USD',
        feedSymbol: 'ITUSDT',
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    feed.load([{ symbol: 'ITUSD', feedSymbol: 'ITUSDT', basePrice: 100, volatility: 0.001, precision: 2 }]);

    const user = await makeUser({ realBalance: 10000 });
    const trade = await prisma.trade.create({
      data: {
        userId: user.id,
        assetId: asset.id,
        symbol: 'ITUSD',
        accountType: 'REAL',
        direction: 'UP',
        stake: 1000,
        payoutPct: 80,
        entryPrice: 90, // below the feed price, so an UP position wins
        durationSec: 30,
        expiresAt: new Date(Date.now() - 1000),
        status: 'OPEN',
      },
    });

    const [a, b] = await Promise.all([trading.settleTrade(trade.id), trading.settleTrade(trade.id)]);
    const settled = [a, b].filter(Boolean);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.trade.status).toBe('WON');
    expect(settled[0]!.trade.profit).toBe(800);

    // stake was never debited here, so the balance gains stake + profit once
    expect((await balanceOf(user.id)).realBalance).toBe(11800);
    const payouts = await prisma.transaction.findMany({ where: { refId: trade.id, type: 'TRADE_PAYOUT' } });
    expect(payouts).toHaveLength(1);
  });
});
