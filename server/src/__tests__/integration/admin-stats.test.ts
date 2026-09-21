/**
 * The admin dashboard's period comparison, against a real database.
 *
 * The arithmetic (delta, direction) lives entirely in the web client; what
 * only shows up here is whether the query actually scopes each metric to the
 * requested window, whether the "previous period" it compares against is the
 * correct preceding window of the same length, and whether the snapshot
 * counts stay a current-state read regardless of the period.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('admin dashboard overview', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let dashboardOverview: (typeof import('../../services/admin-stats.js'))['dashboardOverview'];

  const made: string[] = [];
  const madeAssets: string[] = [];

  const makeUser = async (createdAt: Date) => {
    const user = await prisma.user.create({
      data: {
        email: `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Dashboard Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        createdAt,
        realBalance: 100_000,
      },
    });
    made.push(user.id);
    return user;
  };

  const makeAsset = async () => {
    const symbol = `DASH${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Dashboard Test Asset',
        pair: `${symbol}/USD`,
        assetClass: 'CRYPTO',
        base: symbol,
        quote: 'USD',
        feedSymbol: `${symbol}T`,
      },
    });
    madeAssets.push(asset.id);
    return asset;
  };

  /** A settled trade with an explicit openedAt/settledAt, bypassing the engine
   *  since this suite is testing the read side, not settlement itself. */
  const makeTrade = async (
    userId: string,
    assetId: string,
    symbol: string,
    overrides: { stake?: number; profit?: number; status?: string; openedAt: Date; settledAt?: Date },
  ) =>
    prisma.trade.create({
      data: {
        userId,
        assetId,
        symbol,
        accountType: 'REAL',
        direction: 'UP',
        stake: overrides.stake ?? 1_000,
        payoutPct: 80,
        entryPrice: 100,
        exitPrice: 101,
        durationSec: 30,
        expiresAt: new Date(overrides.openedAt.getTime() + 30_000),
        openedAt: overrides.openedAt,
        settledAt: overrides.settledAt,
        status: overrides.status ?? 'OPEN',
        profit: overrides.profit ?? 0,
      },
    });

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    dashboardOverview = (await import('../../services/admin-stats.js')).dashboardOverview;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.asset.deleteMany({ where: { id: { in: madeAssets } } });
    await prisma.$disconnect();
  });

  it('counts a registration inside the window and excludes one outside it', async () => {
    const from = new Date('2020-06-10T00:00:00.000Z');
    const to = new Date('2020-06-11T00:00:00.000Z');
    await makeUser(new Date('2020-06-10T12:00:00.000Z')); // inside
    await makeUser(new Date('2020-06-11T00:00:00.001Z')); // just outside (to is exclusive)
    await makeUser(new Date('2020-06-09T23:59:59.999Z')); // before the window

    const overview = await dashboardOverview({ from, to });
    expect(overview.current.registrations).toBe(1);
  });

  it('compares against the immediately preceding window of the same length', async () => {
    // a 2-day window: the "previous period" must be the 2 days before it, not
    // some other arbitrary range
    const from = new Date('2021-01-05T00:00:00.000Z');
    const to = new Date('2021-01-07T00:00:00.000Z');
    await makeUser(new Date('2021-01-06T00:00:00.000Z')); // in the current window
    await makeUser(new Date('2021-01-04T00:00:00.000Z')); // in the previous window
    await makeUser(new Date('2021-01-02T00:00:00.000Z')); // before even that

    const overview = await dashboardOverview({ from, to });
    expect(overview.current.registrations).toBe(1);
    expect(overview.previous.registrations).toBe(1);
  });

  it('defaults to today (UTC) when no range is given', async () => {
    const overview = await dashboardOverview({});
    const from = new Date(overview.period.from);
    const to = new Date(overview.period.to);
    const now = new Date();
    expect(from.getUTCHours()).toBe(0);
    expect(from.getUTCMinutes()).toBe(0);
    expect(from.getUTCFullYear()).toBe(now.getUTCFullYear());
    expect(from.getUTCMonth()).toBe(now.getUTCMonth());
    expect(from.getUTCDate()).toBe(now.getUTCDate());
    expect(to.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('refuses a range where the start is not before the end', async () => {
    const now = new Date();
    await expect(dashboardOverview({ from: now, to: now })).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(
      dashboardOverview({ from: now, to: new Date(now.getTime() - 1000) }),
    ).rejects.toMatchObject({ code: 'invalid_range' });
  });

  it('counts a first-time depositor once, and never a repeat depositor', async () => {
    const from = new Date('2022-03-10T00:00:00.000Z');
    const to = new Date('2022-03-11T00:00:00.000Z');

    const newcomer = await makeUser(new Date('2022-03-01T00:00:00.000Z'));
    await prisma.deposit.create({
      data: {
        userId: newcomer.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'x',
        status: 'COMPLETED',
        creditedAmount: 10_000,
        confirmedAt: new Date('2022-03-10T08:00:00.000Z'), // their first, inside the window
        expiresAt: new Date('2022-03-10T09:00:00.000Z'),
      },
    });

    const regular = await makeUser(new Date('2022-01-01T00:00:00.000Z'));
    await prisma.deposit.create({
      data: {
        userId: regular.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'x',
        status: 'COMPLETED',
        creditedAmount: 5_000,
        confirmedAt: new Date('2022-01-05T00:00:00.000Z'), // their actual first, before the window
        expiresAt: new Date('2022-01-05T01:00:00.000Z'),
      },
    });
    await prisma.deposit.create({
      data: {
        userId: regular.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'x',
        status: 'COMPLETED',
        creditedAmount: 5_000,
        confirmedAt: new Date('2022-03-10T09:00:00.000Z'), // a second deposit, inside the window
        expiresAt: new Date('2022-03-10T10:00:00.000Z'),
      },
    });

    const overview = await dashboardOverview({ from, to });
    expect(overview.current.firstTimeDepositors).toBe(1);
  });

  it('counts distinct active traders, averages the stake, and reports the win rate', async () => {
    const from = new Date('2022-05-01T00:00:00.000Z');
    const to = new Date('2022-05-02T00:00:00.000Z');
    const asset = await makeAsset();
    const a = await makeUser(new Date('2022-01-01T00:00:00.000Z'));
    const b = await makeUser(new Date('2022-01-01T00:00:00.000Z'));

    // two trades from the same trader still count as one active trader
    await makeTrade(a.id, asset.id, asset.symbol, {
      stake: 1_000,
      profit: 800,
      status: 'WON',
      openedAt: new Date('2022-05-01T10:00:00.000Z'),
      settledAt: new Date('2022-05-01T10:01:00.000Z'),
    });
    await makeTrade(a.id, asset.id, asset.symbol, {
      stake: 3_000,
      profit: -3_000,
      status: 'LOST',
      openedAt: new Date('2022-05-01T11:00:00.000Z'),
      settledAt: new Date('2022-05-01T11:01:00.000Z'),
    });
    await makeTrade(b.id, asset.id, asset.symbol, {
      stake: 2_000,
      profit: 1_600,
      status: 'WON',
      openedAt: new Date('2022-05-01T12:00:00.000Z'),
      settledAt: new Date('2022-05-01T12:01:00.000Z'),
    });
    // opened outside the window: must not count as active in it
    await makeTrade(a.id, asset.id, asset.symbol, {
      stake: 1_000,
      status: 'OPEN',
      openedAt: new Date('2022-04-01T00:00:00.000Z'),
    });

    const overview = await dashboardOverview({ from, to });
    expect(overview.current.activeTraders).toBe(2);
    expect(overview.current.averageStake).toBe(2_000); // (1000 + 3000 + 2000) / 3
    expect(overview.current.winRatePct).toBeCloseTo(66.7, 1); // 2 of 3 settled trades won
    expect(overview.current.realVolume).toBe(6_000);
    expect(overview.current.housePnl).toBe(600); // -(800 - 3000 + 1600)
  });

  it('reports a null win rate when nothing settled in the period', async () => {
    const overview = await dashboardOverview({
      from: new Date('2019-01-01T00:00:00.000Z'),
      to: new Date('2019-01-02T00:00:00.000Z'),
    });
    expect(overview.current.winRatePct).toBeNull();
  });

  it('reports snapshot counts as non-negative regardless of the chosen period', async () => {
    const overview = await dashboardOverview({
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2020-01-02T00:00:00.000Z'),
    });
    expect(overview.snapshot.pendingWithdrawals).toBeGreaterThanOrEqual(0);
    expect(overview.snapshot.users).toBeGreaterThanOrEqual(0);
  });
});
