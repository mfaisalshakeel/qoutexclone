/**
 * Experience and badges against a real database.
 *
 * The parts that only exist across rows: XP that accrues on settle, a daily
 * bonus that is paid once a day, and a badge that can be written exactly once
 * however many callers race for it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('experience and achievements', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let progression: typeof import('../../services/progression.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];

  const made = { users: [] as string[], assets: [] as string[] };
  let asset: { id: string; symbol: string };

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: {
        email: `xp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'XP Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
      },
    });
    made.users.push(user.id);
    return user;
  };

  /** A market of its own, so the suite does not depend on what is seeded. */
  const makeAsset = async () => {
    const symbol = `XP${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100)}`;
    const created = await prisma.asset.create({
      data: {
        symbol,
        feedSymbol: symbol,
        name: 'XP Test',
        pair: 'XP/US',
        assetClass: 'CRYPTO',
        base: 'XP',
        quote: 'US',
        isOtc: true,
        payoutPct: 80,
        basePrice: 100,
        volatility: 0.5,
        precision: 2,
      },
    });
    made.assets.push(created.id);
    return created;
  };

  const settle = async (userId: string, overrides: Record<string, unknown> = {}) => {
    return prisma.trade.create({
      data: {
        userId,
        assetId: asset.id,
        symbol: asset.symbol,
        accountType: 'REAL',
        direction: 'UP',
        stake: 10_000,
        payoutPct: 80,
        entryPrice: 1,
        exitPrice: 2,
        durationSec: 60,
        openedAt: new Date(),
        expiresAt: new Date(),
        settledAt: new Date(),
        status: 'WON',
        profit: 8_000,
        ...overrides,
      },
    });
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    progression = await import('../../services/progression.js');
    settings = (await import('../../services/settings.js')).settings;
    await settings.load();
    asset = await makeAsset();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  it('adds the volume, the win bonus and the daily bonus, then the daily bonus no more', async () => {
    const user = await makeUser();
    const first = await settle(user.id);
    const earnedFirst = await progression.awardTradeXp(first);

    // $100 staked at 1 XP a dollar, +5 for the win, +25 for the first today
    expect(earnedFirst).toBe(130);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xp).toBe(130);

    const second = await settle(user.id);
    expect(await progression.awardTradeXp(second)).toBe(105);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xp).toBe(235);
  });

  it('earns nothing on practice, where the balance refills', async () => {
    const user = await makeUser();
    const practice = await settle(user.id, { accountType: 'DEMO' });
    expect(await progression.awardTradeXp(practice)).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xp).toBe(0);
  });

  it('earns nothing at all once an operator turns it off', async () => {
    const user = await makeUser();
    await settings.set('growth.xpEnabled', false);
    try {
      expect(await progression.awardTradeXp(await settle(user.id))).toBe(0);
    } finally {
      await settings.reset('growth.xpEnabled');
    }
  });

  it('counts what the badges are measured against', async () => {
    const user = await makeUser();
    await settle(user.id);
    await settle(user.id, { status: 'LOST', profit: -10_000 });

    const stats = await progression.statsFor(user.id);
    expect(stats.trades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.volume).toBe(20_000);
    expect(stats.netProfit).toBe(-2_000);
    expect(stats.bestStreak).toBe(1);
    expect(stats.markets).toBe(1);
  });

  it('writes each badge once, however many callers race for it', async () => {
    const user = await makeUser();
    await settle(user.id);

    const [a, b] = await Promise.all([
      progression.syncAchievements(user.id),
      progression.syncAchievements(user.id),
    ]);
    // between them they unlock the first-trade badge exactly once
    expect([...a, ...b].filter((key) => key === 'first-trade')).toHaveLength(1);

    const rows = await prisma.achievement.findMany({ where: { userId: user.id } });
    expect(rows.filter((row) => row.key === 'first-trade')).toHaveLength(1);

    // and asking again adds nothing
    expect(await progression.syncAchievements(user.id)).toEqual([]);
  });

  it('hands the progress page a level and every badge with its progress', async () => {
    const user = await makeUser();
    await settle(user.id);
    await progression.awardTradeXp(await settle(user.id));

    const page = await progression.progressionFor(user.id);
    expect(page.enabled).toBe(true);
    expect(page.progress.level).toBeGreaterThanOrEqual(1);
    expect(page.achievements.length).toBeGreaterThan(5);

    const first = page.achievements.find((achievement) => achievement.key === 'first-trade')!;
    expect(first.unlocked).toBe(true);
    expect(first.unlockedAt).not.toBeNull();

    const far = page.achievements.find((achievement) => achievement.key === 'trades-500')!;
    expect(far.unlocked).toBe(false);
    expect(far.progress).toBe(2);
  });
});
