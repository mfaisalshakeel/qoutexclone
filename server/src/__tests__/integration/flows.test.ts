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
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let deposits: typeof import('../../services/deposits.js');
  let withdrawals: typeof import('../../services/withdrawals.js');
  let trading: typeof import('../../services/trading.js');
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

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
      select: {
        realBalance: true,
        lockedBalance: true,
        totalDeposited: true,
        totalWithdrawn: true,
        referralEarnings: true,
      },
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
        pair: 'IT/USD',
        assetClass: 'CRYPTO',
        base: 'IT',
        quote: 'USD',
        feedSymbol: 'ITUSDT',
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
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

/** Settings persistence needs a database, so it lives with the money flows. */
suite('runtime settings', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let events: (typeof import('../../services/settings.js'))['settingsEvents'];

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    const module = await import('../../services/settings.js');
    settings = module.settings;
    events = module.settingsEvents;
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { startsWith: 'wallet.' } } });
    settings._clear();
  });

  it('persists an override, serves it from cache and announces it', async () => {
    const changes: { key: string; value: unknown; isPublic: boolean }[] = [];
    events.on('changed', (event) => changes.push(event));

    await settings.set('wallet.withdrawFeePct', 2.5);
    expect(settings.get('wallet.withdrawFeePct')).toBe(2.5);

    const row = await prisma.setting.findUnique({ where: { key: 'wallet.withdrawFeePct' } });
    expect(row?.value).toBe('2.5');
    expect(changes.at(-1)).toMatchObject({ key: 'wallet.withdrawFeePct', value: 2.5, isPublic: true });

    // a fresh process picks the override up from the database
    settings._clear();
    expect(settings.get('wallet.withdrawFeePct')).not.toBe(2.5);
    await settings.load();
    expect(settings.get('wallet.withdrawFeePct')).toBe(2.5);

    // and the fee quote uses it without a restart
    const { quoteWithdrawal } = await import('../../services/withdrawals.js');
    const quote = quoteWithdrawal('USDT', 'TRC20', 10000);
    expect(quote.fee).toBe(200 + Math.round((10000 * 2.5) / 100));

    await settings.reset('wallet.withdrawFeePct');
    expect(await prisma.setting.findUnique({ where: { key: 'wallet.withdrawFeePct' } })).toBeNull();
  });

  it('ignores a stored key that no longer exists in the registry', async () => {
    await prisma.setting.create({ data: { key: 'wallet.removedKey', value: '42' } });
    settings._clear();
    await expect(settings.load()).resolves.toBeUndefined();
    expect(settings.isLoaded).toBe(true);
    await prisma.setting.deleteMany({ where: { key: 'wallet.removedKey' } });
  });
});

/**
 * The hard invariant: a trader's positions must never influence a quote.
 * This drives the real feed against two very different database states and
 * asserts the printed paths are identical.
 */
suite('price independence from positions', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let MarketFeedClass: (typeof import('../../engine/feed.js'))['MarketFeed'];
  const created: { users: string[]; assets: string[] } = { users: [], assets: [] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    MarketFeedClass = (await import('../../engine/feed.js')).MarketFeed;
  });

  afterAll(async () => {
    await prisma.trade.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: created.assets } } });
  });

  const spec = {
    symbol: 'INDEPUSD_OTC',
    feedSymbol: 'INDEPUSD_OTC',
    basePrice: 100,
    volatility: 0.0015,
    precision: 4,
    isOtc: true,
    otcConfig: null,
    spotSymbol: null,
  };

  const walk = (ticks: number) => {
    const feed = new MarketFeedClass();
    // a fixed clock start makes the path reproducible across runs
    let now = 1_750_000_000_000;
    feed.setClock(() => now);
    feed.load([spec]);
    const prices: number[] = [];
    for (let i = 0; i < ticks; i += 1) {
      now += 250;
      (feed as unknown as { onInterval: () => void }).onInterval();
      prices.push(feed.getPrice(spec.symbol)!);
    }
    return prices;
  };

  it('prints the same path with no positions and with heavy one-sided exposure', async () => {
    const quiet = walk(400);

    // now flood the database with one-sided open positions on this market
    const asset = await prisma.asset.create({
      data: {
        symbol: spec.symbol,
        name: 'Independence Test',
        pair: 'INDEP/USD',
        assetClass: 'CURRENCY',
        base: 'INDEP',
        quote: 'USD',
        feedSymbol: spec.feedSymbol,
        isOtc: true,
        basePrice: spec.basePrice,
        volatility: spec.volatility,
        precision: spec.precision,
        pipSize: 0.0001,
        payoutPct: 85,
      },
    });
    created.assets.push(asset.id);

    const whale = await prisma.user.create({
      data: {
        email: `whale-${Date.now()}@test.dev`,
        name: 'Whale',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        demoBalance: 100_000_000,
      },
    });
    created.users.push(whale.id);

    await prisma.trade.createMany({
      data: Array.from({ length: 50 }, () => ({
        userId: whale.id,
        assetId: asset.id,
        symbol: spec.symbol,
        accountType: 'DEMO',
        direction: 'UP' as const,
        stake: 500_000,
        payoutPct: 85,
        entryPrice: spec.basePrice,
        durationSec: 3600,
        expiresAt: new Date(Date.now() + 3_600_000),
        status: 'OPEN',
      })),
    });

    const exposed = walk(400);
    expect(exposed).toEqual(quiet);

    // and the house being deep in the red changes nothing either
    await prisma.trade.updateMany({ where: { assetId: asset.id }, data: { direction: 'DOWN' } });
    expect(walk(400)).toEqual(quiet);
  });
});

/** Candle history is durable, pages backwards and prunes itself. */
suite('candle history', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let store: (typeof import('../../services/candles.js'))['candleStore'];
  const symbol = `HISTUSD_${Date.now()}`;

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    store = (await import('../../services/candles.js')).candleStore;
    store.register(symbol, { basePrice: 100, volatility: 0.0012, precision: 4 });
  });

  afterAll(async () => {
    await prisma.candle.deleteMany({ where: { symbol } });
    store._reset();
  });

  it('generates a market history once, then serves it from storage', async () => {
    const first = await store.history(symbol, '1m', { limit: 200 });
    expect(first).toHaveLength(200);

    // ascending, one bucket apart, with sane OHLC
    for (let i = 1; i < first.length; i += 1) {
      expect(first[i].time - first[i - 1].time).toBe(60);
      expect(first[i].high).toBeGreaterThanOrEqual(Math.max(first[i].open, first[i].close));
      expect(first[i].low).toBeLessThanOrEqual(Math.min(first[i].open, first[i].close));
    }

    const stored = await prisma.candle.count({ where: { symbol, timeframe: '1m' } });
    expect(stored).toBeGreaterThanOrEqual(200);

    // a second call returns the same series rather than regenerating it
    const again = await store.history(symbol, '1m', { limit: 200 });
    expect(again).toEqual(first);
  });

  it('pages backwards for infinite scroll without overlapping', async () => {
    const recent = await store.history(symbol, '1m', { limit: 50 });
    const older = await store.history(symbol, '1m', { before: recent[0].time, limit: 50 });

    expect(older).toHaveLength(50);
    expect(older[older.length - 1].time).toBeLessThan(recent[0].time);
    const times = new Set([...older, ...recent].map((candle) => candle.time));
    expect(times.size).toBe(100);
  });

  it('keeps separate series per timeframe', async () => {
    const minute = await store.history(symbol, '1m', { limit: 30 });
    const fiveMinute = await store.history(symbol, '5m', { limit: 30 });
    expect(fiveMinute[1].time - fiveMinute[0].time).toBe(300);
    expect(fiveMinute.map((candle) => candle.close)).not.toEqual(minute.map((candle) => candle.close));
  });

  it('upserts a re-flushed bucket instead of duplicating it', async () => {
    const [candle] = await store.history(symbol, '1m', { limit: 1 });
    store.record(symbol, '1m', { ...candle, close: candle.close + 1, high: candle.high + 1 });
    await store.flush();

    const rows = await prisma.candle.findMany({ where: { symbol, timeframe: '1m', time: candle.time } });
    expect(rows).toHaveLength(1);
    expect(rows[0].close).toBeCloseTo(candle.close + 1, 6);
  });

  it('prunes candles past their retention', async () => {
    const ancient = Math.floor(Date.now() / 1000) - 40 * 86400; // far beyond 5s retention
    store.record(symbol, '5s', { time: ancient, open: 1, high: 1, low: 1, close: 1 });
    await store.flush();
    expect(await prisma.candle.count({ where: { symbol, timeframe: '5s', time: ancient } })).toBe(1);

    await store.prune();
    expect(await prisma.candle.count({ where: { symbol, timeframe: '5s', time: ancient } })).toBe(0);
    // and the recent history survives
    expect(await prisma.candle.count({ where: { symbol, timeframe: '1m' } })).toBeGreaterThan(0);
  });

  it('persists the bucket that is still open, so a restart has no hole', async () => {
    const bucket = Math.floor(Date.now() / 1000 / 60) * 60;
    const open = { time: bucket, open: 100, high: 101, low: 99.5, close: 100.5 };
    // the feed only hands over a candle when it closes; the store picks the
    // open one up from the live source on every flush
    store.setLiveSource(() => [{ symbol, timeframe: '1m', candle: open }]);
    await store.flush();
    store.setLiveSource(() => []);

    const stored = await prisma.candle.findFirst({ where: { symbol, timeframe: '1m', time: bucket } });
    expect(stored?.open).toBeCloseTo(100, 6);
    expect(stored?.high).toBeCloseTo(101, 6);

    // and the next process can find it to carry on from
    const adopted = await store.openBuckets([symbol]);
    const minute = adopted.find((row) => row.timeframe === '1m');
    expect(minute?.candle.time).toBe(bucket);
    expect(minute?.candle.open).toBeCloseTo(100, 6);
  });

  it('returns nothing for an unknown timeframe rather than throwing', async () => {
    expect(await store.history(symbol, '7m', { limit: 10 })).toEqual([]);
  });
});

/** Paging must keep going until retention runs out, not stop at the seed page. */
suite('deep candle paging', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let store: (typeof import('../../services/candles.js'))['candleStore'];
  const symbol = `DEEPUSD_${Date.now()}`;

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    store = (await import('../../services/candles.js')).candleStore;
    store.register(symbol, { basePrice: 50, volatility: 0.0012, precision: 3 });
  });

  afterAll(async () => {
    await prisma.candle.deleteMany({ where: { symbol } });
    store._reset();
  });

  it('pages several windows back, each joining the last seamlessly', async () => {
    const page = await store.history(symbol, '1m', { limit: 100 });
    expect(page).toHaveLength(100);

    const seen: number[] = page.map((candle) => candle.time);
    let cursor = page[0].time;

    for (let index = 0; index < 5; index += 1) {
      const older = await store.history(symbol, '1m', { before: cursor, limit: 100 });
      expect(older.length, `page ${index + 2} came back short`).toBe(100);

      // contiguous with the previous page, and no duplicated buckets
      expect(older[older.length - 1].time).toBe(cursor - 60);
      for (const candle of older) expect(seen).not.toContain(candle.time);
      seen.push(...older.map((candle) => candle.time));

      cursor = older[0].time;
    }

    expect(seen).toHaveLength(600);

    // the join is seamless: no page starts with an impossible gap
    const all = await prisma.candle.findMany({
      where: { symbol, timeframe: '1m' },
      orderBy: { time: 'asc' },
    });
    for (let index = 1; index < all.length; index += 1) {
      const jump = Math.abs(all[index].open - all[index - 1].close) / all[index - 1].close;
      expect(jump, `gap at ${all[index].time}`).toBeLessThan(0.05);
    }
  });

  it('stops at the retention boundary instead of generating forever', async () => {
    // 5s candles are kept for six hours, so paging back a day must run out
    let cursor: number | undefined = undefined;
    let pages = 0;
    for (; pages < 60; pages += 1) {
      const page: Awaited<ReturnType<typeof store.history>> = await store.history(symbol, '5s', {
        before: cursor,
        limit: 100,
      });
      if (page.length === 0) break;
      cursor = page[0].time;
    }
    expect(pages).toBeLessThan(60);
  });
});

/** Generated history must stay in a believable band, however far back you page. */
suite('history level stability', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let store: (typeof import('../../services/candles.js'))['candleStore'];
  const symbol = `BANDUSD_${Date.now()}`;
  const basePrice = 190;

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    store = (await import('../../services/candles.js')).candleStore;
    store.register(symbol, { basePrice, volatility: 0.0009, precision: 2 });
  });

  afterAll(async () => {
    await prisma.candle.deleteMany({ where: { symbol } });
    store._reset();
  });

  it('keeps ten pages of generated history near the market price', async () => {
    let page = await store.history(symbol, '1m', { limit: 100 });
    let cursor = page[0].time;

    for (let index = 0; index < 10; index += 1) {
      page = await store.history(symbol, '1m', { before: cursor, limit: 100 });
      if (page.length === 0) break;
      cursor = page[0].time;
    }

    const all = await prisma.candle.findMany({
      where: { symbol, timeframe: '1m' },
      orderBy: { time: 'asc' },
    });
    const lows = Math.min(...all.map((candle) => candle.low));
    const highs = Math.max(...all.map((candle) => candle.high));

    // eleven pages is ~18 hours of one-minute candles; a market this quiet
    // cannot have been 10% away from its own price this morning
    expect(lows).toBeGreaterThan(basePrice * 0.9);
    expect(highs).toBeLessThan(basePrice * 1.1);

    // and every page still joins its neighbour exactly, as a tape does
    for (let index = 1; index < all.length; index += 1) {
      expect(all[index].open, `gap at ${all[index].time}`).toBeCloseTo(all[index - 1].close, 6);
    }
  });

  it('ends generated history on the price the market is trading at', async () => {
    const live = `LIVEUSD_${Date.now()}`;
    store.register(live, {
      basePrice: 100,
      volatility: 0.0009,
      precision: 2,
      // the market has moved a long way from where it was seeded
      priceNow: () => 137.5,
    });

    const page = await store.history(live, '1m', { limit: 120 });
    expect(page[page.length - 1].close).toBeCloseTo(137.5, 2);
    // and the rest of the history sits around that price, not around the seed
    const closes = page.map((candle) => candle.close);
    expect(Math.min(...closes)).toBeGreaterThan(137.5 * 0.97);
    expect(Math.max(...closes)).toBeLessThan(137.5 * 1.03);

    await prisma.candle.deleteMany({ where: { symbol: live } });
  });
});

/** A payout rule must change what a new trade is quoted, and nothing else. */
suite('payout rules', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let trading: typeof import('../../services/trading.js');
  let payouts: (typeof import('../../services/payouts.js'))['payouts'];
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const symbol = `PAYUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[], rules: [] as string[] };
  let assetId = '';

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    trading = await import('../../services/trading.js');
    payouts = (await import('../../services/payouts.js')).payouts;
    settings = (await import('../../services/settings.js')).settings;
    feed = (await import('../../engine/feed.js')).marketFeed;
    await settings.load();

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Payout Coin',
        pair: 'PAY/USD',
        assetClass: 'CRYPTO',
        base: 'PAY',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    assetId = asset.id;
    made.assets.push(asset.id);
    feed.load([{ symbol, feedSymbol: symbol, basePrice: 100, volatility: 0.001, precision: 2 }]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.payoutRule.deleteMany({ where: { id: { in: made.rules } } });
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await payouts.load();
    await prisma.$disconnect();
  });

  const makeTrader = async () => {
    const user = await prisma.user.create({
      data: {
        email: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Payout Trader',
        passwordHash: 'x',
        referralCode: `PAY${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        demoBalance: 1_000_000,
      },
    });
    made.users.push(user.id);
    return user;
  };

  const open = async (userId: string) =>
    trading.placeTrade({
      userId,
      symbol,
      direction: 'UP',
      stake: 10_000,
      durationSec: 60,
      accountType: 'DEMO',
    });

  it('locks the base payout into the trade when no rule fires', async () => {
    await payouts.load();
    const user = await makeTrader();
    const trade = await open(user.id);
    expect(trade.payoutPct).toBe(80);
  });

  it('locks the adjusted payout, and leaves positions already open alone', async () => {
    const before = await open((await makeTrader()).id);
    expect(before.payoutPct).toBe(80);

    // a window covering the whole day, so it fires whenever this test runs
    const rule = await prisma.payoutRule.create({
      data: {
        name: 'Integration cut',
        kind: 'TIME_OF_DAY',
        assetId,
        adjustment: -15,
        config: { fromMinute: 0, toMinute: 1440 },
      },
    });
    made.rules.push(rule.id);
    await payouts.load();

    const after = await open((await makeTrader()).id);
    expect(after.payoutPct).toBe(65);

    // the earlier position keeps what it was quoted
    const untouched = await prisma.trade.findUniqueOrThrow({ where: { id: before.id } });
    expect(untouched.payoutPct).toBe(80);
  });

  it('pays the locked payout at settlement, not the current one', async () => {
    const user = await makeTrader();
    const trade = await open(user.id);
    const locked = trade.payoutPct;

    // the rule changes after the position is open
    const rule = await prisma.payoutRule.create({
      data: {
        name: 'Integration later cut',
        kind: 'TIME_OF_DAY',
        assetId,
        adjustment: -40,
        config: { fromMinute: 0, toMinute: 1440 },
      },
    });
    made.rules.push(rule.id);
    await payouts.load();

    const outcome = trading.resolveOutcome({
      direction: 'UP',
      entryPrice: 100,
      exitPrice: 101,
      stake: trade.stake,
      payoutPct: trade.payoutPct,
    });
    expect(trade.payoutPct).toBe(locked);
    expect(outcome.status).toBe('WON');
    expect(outcome.profit).toBe(Math.floor((trade.stake * locked) / 100));
    expect(outcome.credit).toBe(trade.stake + outcome.profit);
  });

  it('never pays outside the configured floor and ceiling', async () => {
    const rule = await prisma.payoutRule.create({
      data: {
        name: 'Integration absurd cut',
        kind: 'TIME_OF_DAY',
        assetId,
        adjustment: -90,
        config: { fromMinute: 0, toMinute: 1440 },
      },
    });
    made.rules.push(rule.id);
    await payouts.load();

    const trade = await open((await makeTrader()).id);
    expect(trade.payoutPct).toBe(settings.get('trading.minPayoutPct'));
  });
});
