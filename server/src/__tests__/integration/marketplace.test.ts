/**
 * The marketplace against a real database.
 *
 * Everything here moves money or spends something that cannot be spent twice,
 * so it belongs in an integration test: a purchase that must not overdraw, a
 * use that two settlements might race for, and a coupon one deposit consumes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('marketplace', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let marketplace: typeof import('../../services/marketplace.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];

  const made = { users: [] as string[], items: [] as string[] };

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Shopper',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 100_000,
        points: 10_000,
        ...overrides,
      },
    });
    made.users.push(user.id);
    return user;
  };

  const makeItem = async (kind: string, config: unknown, prices = { cents: 1_000, points: 1_000 }) => {
    const item = await prisma.marketplaceItem.create({
      data: {
        key: `test-${kind.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: `Test ${kind}`,
        description: 'A test item.',
        kind,
        priceCents: prices.cents,
        pricePoints: prices.points,
        config: config as never,
      },
    });
    made.items.push(item.id);
    return item;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    marketplace = await import('../../services/marketplace.js');
    settings = (await import('../../services/settings.js')).settings;
    await settings.load();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.inventoryItem.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.marketplaceItem.deleteMany({ where: { id: { in: made.items } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  });

  it('takes money through the ledger and refuses to overdraw', async () => {
    const user = await makeUser({ realBalance: 1_500 });
    const item = await makeItem('PAYOUT_BOOSTER', { bonusPct: 5, minutes: 30 });

    await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'cents' });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.realBalance).toBe(500);

    const rows = await prisma.transaction.findMany({ where: { userId: user.id, type: 'MARKETPLACE' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(-1_000);

    // the balance cannot go below zero, whatever is in the shop
    await expect(
      marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'cents' }),
    ).rejects.toThrow();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).realBalance).toBe(500);
  });

  it('never lets two purchases spend the same points', async () => {
    const user = await makeUser({ points: 1_000 });
    const item = await makeItem('PRACTICE_REFILL', { amountCents: 1_000_000 }, { cents: 0, points: 1_000 });

    const results = await Promise.allSettled([
      marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' }),
      marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).points).toBe(0);
  });

  it('copies the configuration onto the purchase, so an edit cannot change it', async () => {
    const user = await makeUser();
    const item = await makeItem('PAYOUT_BOOSTER', { bonusPct: 5, minutes: 30 });
    const bought = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });

    await prisma.marketplaceItem.update({
      where: { id: item.id },
      data: { config: { bonusPct: 1, minutes: 1 } },
    });

    const held = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: bought.id } });
    expect(held.config).toEqual({ bonusPct: 5, minutes: 30 });
  });

  it('runs one booster at a time, and quotes its bonus while it lasts', async () => {
    const user = await makeUser();
    const item = await makeItem('PAYOUT_BOOSTER', { bonusPct: 7, minutes: 30 });

    const first = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });
    const second = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });

    expect(await marketplace.activeBoosterBonus(user.id)).toBe(0);
    await marketplace.activateItem(user.id, first.id);
    expect(await marketplace.activeBoosterBonus(user.id)).toBe(7);

    // a second one cannot be stacked on top while the first is running
    await expect(marketplace.activateItem(user.id, second.id)).rejects.toThrow();
  });

  it('cannot activate the same item twice, or one from another account', async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const item = await makeItem('PRACTICE_REFILL', { amountCents: 500_000 });
    const bought = await marketplace.buyItem({ userId: mine.id, itemId: item.id, payWith: 'points' });

    const before = await prisma.user.findUniqueOrThrow({ where: { id: mine.id } });
    await marketplace.activateItem(mine.id, bought.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: mine.id } });
    expect(after.demoBalance - before.demoBalance).toBe(500_000);

    await expect(marketplace.activateItem(mine.id, bought.id)).rejects.toThrow();
    await expect(marketplace.activateItem(theirs.id, bought.id)).rejects.toThrow();
    // one top-up, one ledger row
    const rows = await prisma.transaction.findMany({
      where: { userId: mine.id, type: 'PRACTICE_TOPUP' },
    });
    expect(rows).toHaveLength(1);
  });

  it('refunds a loss once per use, and never more than the cap', async () => {
    const user = await makeUser();
    const item = await makeItem('RISK_FREE', { trades: 2, maxRefundCents: 5_000, hours: 24 });
    const bought = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });
    await marketplace.activateItem(user.id, bought.id);

    // a big loss is capped
    const capped = await prisma.$transaction((tx) =>
      marketplace.coverLoss(tx, {
        userId: user.id,
        tradeId: 'trade-a',
        stake: 20_000,
        accountType: 'REAL',
      }),
    );
    expect(capped).toBe(5_000);

    // a small one is refunded in full
    const small = await prisma.$transaction((tx) =>
      marketplace.coverLoss(tx, { userId: user.id, tradeId: 'trade-b', stake: 800, accountType: 'REAL' }),
    );
    expect(small).toBe(800);

    // and the cover is spent
    const third = await prisma.$transaction((tx) =>
      marketplace.coverLoss(tx, { userId: user.id, tradeId: 'trade-c', stake: 800, accountType: 'REAL' }),
    );
    expect(third).toBe(0);
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: bought.id } })).status).toBe('USED');
  });

  it('never covers a practice loss', async () => {
    const user = await makeUser();
    const item = await makeItem('RISK_FREE', { trades: 1, maxRefundCents: 5_000, hours: 24 });
    const bought = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });
    await marketplace.activateItem(user.id, bought.id);

    const refund = await prisma.$transaction((tx) =>
      marketplace.coverLoss(tx, { userId: user.id, tradeId: 't', stake: 1_000, accountType: 'DEMO' }),
    );
    expect(refund).toBe(0);
  });

  it('picks the coupon worth most and spends it once', async () => {
    const user = await makeUser();
    const small = await makeItem('DEPOSIT_BONUS', { percent: 10, maxBonusCents: 100_000, days: 30 });
    const big = await makeItem('DEPOSIT_BONUS', { percent: 25, maxBonusCents: 100_000, days: 30 });

    for (const item of [small, big]) {
      const bought = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });
      await marketplace.activateItem(user.id, bought.id);
    }

    const chosen = await prisma.$transaction((tx) =>
      marketplace.couponFor(tx, { userId: user.id, depositCents: 20_000 }),
    );
    expect(chosen?.bonus).toBe(5_000);

    const spentOk = await prisma.$transaction((tx) => marketplace.spendCoupon(tx, chosen!.id));
    expect(spentOk).toBe(true);
    const spentAgain = await prisma.$transaction((tx) => marketplace.spendCoupon(tx, chosen!.id));
    expect(spentAgain).toBe(false);

    // the smaller one is still there for the next deposit
    const next = await prisma.$transaction((tx) =>
      marketplace.couponFor(tx, { userId: user.id, depositCents: 20_000 }),
    );
    expect(next?.bonus).toBe(2_000);
  });

  it('stops everything working once an operator closes the shop', async () => {
    const user = await makeUser();
    const item = await makeItem('PAYOUT_BOOSTER', { bonusPct: 5, minutes: 30 });
    const bought = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });
    await marketplace.activateItem(user.id, bought.id);
    expect(await marketplace.activeBoosterBonus(user.id)).toBe(5);

    await settings.set('growth.marketplaceEnabled', false);
    try {
      expect(await marketplace.activeBoosterBonus(user.id)).toBe(0);
      await expect(
        marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' }),
      ).rejects.toThrow();
    } finally {
      await settings.reset('growth.marketplaceEnabled');
    }
  });

  it('expires an item whose window has closed', async () => {
    const user = await makeUser();
    const item = await makeItem('PAYOUT_BOOSTER', { bonusPct: 5, minutes: 30 });
    const bought = await marketplace.buyItem({ userId: user.id, itemId: item.id, payWith: 'points' });
    await marketplace.activateItem(user.id, bought.id);

    await prisma.inventoryItem.update({
      where: { id: bought.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await marketplace.activeBoosterBonus(user.id)).toBe(0);

    await marketplace.expireStale();
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: bought.id } })).status).toBe(
      'EXPIRED',
    );
  });
});
