/**
 * The platform-wide stake ceiling/floor (`trading.minStakeCents` /
 * `trading.maxStakeCents`), against a real database and through the actual
 * trade-placement path — `limitsFor`'s own unit test proves the clamping
 * arithmetic; this proves a real `placeTrade` call actually goes through it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('platform-wide stake bounds', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let trading: typeof import('../../services/trading.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    trading = await import('../../services/trading.js');
    ({ settings } = await import('../../services/settings.js'));
    feed = (await import('../../engine/feed.js')).marketFeed;
  });

  afterEach(async () => {
    await settings.reset('trading.maxStakeCents');
    await settings.reset('trading.minStakeCents');
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  const makeUser = async () =>
    prisma.user
      .create({
        data: {
          email: `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
          name: 'Risk Test',
          passwordHash: 'x',
          referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
          realBalance: 10_000_000,
        },
      })
      .then((user) => {
        made.users.push(user.id);
        return user;
      });

  const makeAsset = async (overrides: Record<string, unknown> = {}) => {
    const symbol = `RK${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
    const asset = await prisma.asset.create({
      data: {
        symbol,
        feedSymbol: symbol,
        name: 'Risk Test',
        pair: 'RK/US',
        assetClass: 'CRYPTO',
        base: 'RK',
        quote: 'US',
        isOtc: true,
        payoutPct: 80,
        basePrice: 100,
        volatility: 0.5,
        precision: 2,
        minStake: 100,
        maxStake: 1_000_000, // this market's own row allows $10,000
        ...overrides,
      },
    });
    made.assets.push(asset.id);
    feed.load([
      {
        symbol: asset.symbol,
        feedSymbol: asset.symbol,
        basePrice: asset.basePrice,
        volatility: asset.volatility,
        precision: asset.precision,
        assetClass: asset.assetClass,
        isOtc: true,
        otcConfig: null,
        spotSymbol: null,
      },
    ]);
    return asset;
  };

  it("refuses a stake the asset allows but the platform-wide ceiling does not", async () => {
    await settings.set('trading.maxStakeCents', 50_000); // $500 platform-wide
    const asset = await makeAsset();
    const user = await makeUser();

    await expect(
      trading.placeTrade({
        userId: user.id,
        symbol: asset.symbol,
        accountType: 'REAL',
        direction: 'UP',
        stake: 100_000, // $1,000 — inside the asset's own $10,000 cap
        durationSec: 60,
      }),
    ).rejects.toThrow();

    const trade = await trading.placeTrade({
      userId: user.id,
      symbol: asset.symbol,
      accountType: 'REAL',
      direction: 'UP',
      stake: 40_000, // $400 — inside the tightened $500 ceiling
      durationSec: 60,
    });
    expect(trade.stake).toBe(40_000);
  });

  it("raises a stake the asset allows up to the platform-wide floor", async () => {
    await settings.set('trading.minStakeCents', 20_000); // $200 platform-wide
    const asset = await makeAsset(); // its own row still says $1 minimum
    const user = await makeUser();

    await expect(
      trading.placeTrade({
        userId: user.id,
        symbol: asset.symbol,
        accountType: 'REAL',
        direction: 'UP',
        stake: 10_000, // $100 — the asset alone would allow this
        durationSec: 60,
      }),
    ).rejects.toThrow();
  });
});
