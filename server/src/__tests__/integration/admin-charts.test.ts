/**
 * The admin dashboard's charts, against a real database.
 *
 * Each chart reduces the same underlying rows a different way — by day, by
 * asset class, by weekday/hour — so what is worth proving here is that each
 * reduction actually groups correctly, not that Prisma can sum a column.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('admin dashboard charts', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let dashboardCharts: (typeof import('../../services/admin-charts.js'))['dashboardCharts'];

  const made: string[] = [];
  const madeAssets: string[] = [];

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: {
        email: `chart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Chart Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 100_000,
      },
    });
    made.push(user.id);
    return user;
  };

  const makeAsset = async (assetClass: string) => {
    const symbol = `CHT${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Chart Test Asset',
        pair: `${symbol}/USD`,
        assetClass,
        base: symbol,
        quote: 'USD',
        feedSymbol: `${symbol}T`,
      },
    });
    madeAssets.push(asset.id);
    return asset;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    dashboardCharts = (await import('../../services/admin-charts.js')).dashboardCharts;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.asset.deleteMany({ where: { id: { in: madeAssets } } });
    await prisma.$disconnect();
  });

  it('buckets deposits, withdrawals and house P&L by UTC calendar day', async () => {
    const user = await makeUser();
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);

    await prisma.deposit.create({
      data: {
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'x',
        status: 'COMPLETED',
        creditedAmount: 10_000,
        confirmedAt: today,
        expiresAt: today,
      },
    });
    await prisma.withdrawal.create({
      data: {
        userId: user.id,
        currency: 'USDT',
        network: 'TRC20',
        address: 'x',
        amount: 4_000,
        netAmount: 4_000,
        rate: 1,
        cryptoAmount: '4000',
        status: 'COMPLETED',
        processedAt: yesterday,
      },
    });

    const charts = await dashboardCharts(30);
    const todayKey = today.toISOString().slice(0, 10);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const todayPoint = charts.series.find((p) => p.date === todayKey);
    const yesterdayPoint = charts.series.find((p) => p.date === yesterdayKey);

    expect(todayPoint?.depositVolume).toBeGreaterThanOrEqual(10_000);
    expect(yesterdayPoint?.withdrawalVolume).toBeGreaterThanOrEqual(4_000);
    // every one of the requested days is present, even with nothing in it
    expect(charts.series).toHaveLength(30);
  });

  it('groups trading volume by asset class and finds the top assets', async () => {
    const user = await makeUser();
    const crypto = await makeAsset('CRYPTO');
    const currency = await makeAsset('CURRENCY');
    const now = new Date();

    const trade = (assetId: string, symbol: string, stake: number) =>
      prisma.trade.create({
        data: {
          userId: user.id,
          assetId,
          symbol,
          accountType: 'REAL',
          direction: 'UP',
          stake,
          payoutPct: 80,
          entryPrice: 100,
          exitPrice: 101,
          durationSec: 30,
          expiresAt: now,
          openedAt: now,
          settledAt: now,
          status: 'WON',
          profit: Math.round(stake * 0.8),
        },
      });

    await trade(crypto.id, crypto.symbol, 5_000);
    await trade(currency.id, currency.symbol, 2_000);
    await trade(currency.id, currency.symbol, 3_000);

    const charts = await dashboardCharts(30);
    const cryptoVolume = charts.volumeByAssetClass.find((c) => c.assetClass === 'CRYPTO')?.volume ?? 0;
    const currencyVolume = charts.volumeByAssetClass.find((c) => c.assetClass === 'CURRENCY')?.volume ?? 0;
    expect(cryptoVolume).toBeGreaterThanOrEqual(5_000);
    expect(currencyVolume).toBeGreaterThanOrEqual(5_000);

    const top = charts.topAssets.find((a) => a.symbol === currency.symbol);
    expect(top?.volume).toBeGreaterThanOrEqual(5_000);
  });

  it('places an hour of activity in the correct UTC weekday/hour cell', async () => {
    const user = await makeUser();
    const asset = await makeAsset('CRYPTO');
    // yesterday at a fixed hour, so the expected cell is derived from the
    // same instant rather than hand-matched against an arbitrary date
    const openedAt = new Date(Date.now() - 86_400_000);
    openedAt.setUTCHours(15, 30, 0, 0);
    await prisma.trade.create({
      data: {
        userId: user.id,
        assetId: asset.id,
        symbol: asset.symbol,
        accountType: 'REAL',
        direction: 'UP',
        stake: 1_000,
        payoutPct: 80,
        entryPrice: 100,
        exitPrice: 101,
        durationSec: 30,
        expiresAt: openedAt,
        openedAt,
        settledAt: openedAt,
        status: 'WON',
        profit: 800,
      },
    });

    const charts = await dashboardCharts(7);
    expect(charts.hourlyActivity[openedAt.getUTCDay()][15]).toBeGreaterThanOrEqual(1);
  });

  it('reads exposure straight from the live risk book', async () => {
    const charts = await dashboardCharts(7);
    expect(Array.isArray(charts.exposure)).toBe(true);
    expect(charts.exposure.every((row) => row.up > 0 || row.down > 0)).toBe(true);
  });
});
