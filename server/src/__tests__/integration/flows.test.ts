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

  it('never returns two candles for the same instant', async () => {
    // a page that comes back short is extended, and the extension has to start
    // where the stored rows end — deriving it from the cursor overlapped them
    const recent = await store.history(symbol, '1m', { limit: 100 });
    const times = new Set<number>();
    let cursor: number | undefined = recent[0].time;

    for (let page = 0; page < 6; page += 1) {
      const older: Awaited<ReturnType<typeof store.history>> = await store.history(symbol, '1m', {
        before: cursor,
        limit: 100,
      });
      if (older.length === 0) break;
      for (const candle of older) {
        expect(times.has(candle.time), `duplicate candle at ${candle.time}`).toBe(false);
        times.add(candle.time);
      }
      cursor = older[0].time;
    }
    expect(times.size).toBeGreaterThan(100);
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

/** Risk limits reject new stakes, and touch nothing else. */
suite('risk limits', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let trading: typeof import('../../services/trading.js');
  let risk: typeof import('../../services/risk.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const symbol = `RISKUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[] };
  let assetId = '';

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    trading = await import('../../services/trading.js');
    risk = await import('../../services/risk.js');
    settings = (await import('../../services/settings.js')).settings;
    feed = (await import('../../engine/feed.js')).marketFeed;
    await settings.load();

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Risk Coin',
        pair: 'RISK/USD',
        assetClass: 'CRYPTO',
        base: 'RISK',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
        minStake: 100,
        maxStake: 100_000,
        maxOpenStakePerUser: 30_000,
        maxExposurePerDirection: 50_000,
      },
    });
    assetId = asset.id;
    made.assets.push(asset.id);
    feed.load([{ symbol, feedSymbol: symbol, basePrice: 100, volatility: 0.001, precision: 2 }]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  const makeTrader = async (balance = 10_000_000) => {
    const user = await prisma.user.create({
      data: {
        email: `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Risk Trader',
        passwordHash: 'x',
        referralCode: `RSK${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        realBalance: balance,
        demoBalance: balance,
      },
    });
    made.users.push(user.id);
    return user;
  };

  const open = (userId: string, stake: number, accountType = 'REAL', direction: 'UP' | 'DOWN' = 'UP') =>
    trading.placeTrade({
      userId,
      symbol,
      direction,
      stake,
      durationSec: 3600,
      accountType: accountType as 'REAL' | 'DEMO',
    });

  it('accepts a stake inside every limit', async () => {
    const user = await makeTrader();
    const trade = await open(user.id, 10_000);
    expect(trade.stake).toBe(10_000);
  });

  it('refuses a stake above the market maximum', async () => {
    const user = await makeTrader();
    await expect(open(user.id, 100_001)).rejects.toMatchObject({ code: 'stake_too_high' });
  });

  it('refuses what would take one trader past their own limit, and says what is left', async () => {
    const user = await makeTrader();
    await open(user.id, 20_000);
    // 30,000 is the per-trader cap on this market, so 10,000 fits and 10,001 does not
    await expect(open(user.id, 10_001)).rejects.toMatchObject({
      code: 'user_exposure_limit',
      details: { remaining: 10_000 },
    });
    const allowed = await open(user.id, 10_000);
    expect(allowed.stake).toBe(10_000);

    // and the rejection left no trace: no position, no money moved
    const open_ = await prisma.trade.count({ where: { userId: user.id, status: 'OPEN' } });
    expect(open_).toBe(2);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.realBalance).toBe(10_000_000 - 30_000);
  });

  it('refuses what would take the house past its limit on that side', async () => {
    // the earlier traders hold 40,000 of the 50,000 this side allows
    const before = await risk.openStakes(prisma, {
      assetId,
      userId: 'nobody',
      accountType: 'REAL',
      direction: 'UP',
    });
    expect(before.directionExposure).toBe(40_000);

    const user = await makeTrader();
    // the last 10,000 of room is available, and nothing beyond it
    const fill = await open(user.id, 10_000);
    expect(fill.stake).toBe(10_000);
    await expect(open(user.id, 1_000)).rejects.toMatchObject({ code: 'market_exposure_limit' });

    // the other side is untouched, which is the point of a per-direction cap
    const down = await open(user.id, 10_000, 'REAL', 'DOWN');
    expect(down.direction).toBe('DOWN');
  });

  it('never counts practice money against the house', async () => {
    // the UP side is full of live money, and a practice trade still goes through
    const user = await makeTrader();
    const trade = await open(user.id, 20_000, 'DEMO');
    expect(trade.accountType).toBe('DEMO');
    expect(trade.stake).toBe(20_000);

    const exposure = await risk.exposureByMarket();
    const market = exposure.find((row) => row.symbol === symbol);
    // 50,000 live on UP, and the practice position is not in the book
    expect(market?.up).toBe(50_000);
  });

  it('reports the book the back office shows', async () => {
    const market = (await risk.exposureByMarket()).find((row) => row.symbol === symbol);
    expect(market).toBeDefined();
    expect(market?.up).toBe(50_000);
    expect(market?.down).toBe(10_000);
    expect(market?.net).toBe(40_000);
    // the house's worst case on a side is the payout, not the stake
    expect(market?.liabilityUp).toBe(Math.floor((50_000 * 80) / 100));
    expect(market?.roomUp).toBe(0);
    expect(market?.roomDown).toBe(40_000);
    expect(market?.utilisation).toBe(1);
  });

  it('falls back to the platform default when a market sets no limit of its own', async () => {
    const plain = await prisma.asset.create({
      data: {
        symbol: `${symbol}_PLAIN`,
        name: 'Plain Coin',
        pair: 'PLAIN/USD',
        assetClass: 'CRYPTO',
        base: 'PLAIN',
        quote: 'USD',
        feedSymbol: `${symbol}_PLAIN`,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
        minStake: 100,
        maxStake: 100_000,
      },
    });
    made.assets.push(plain.id);

    // with the default at zero the market is unrestricted beyond its stake bounds
    const unlimited = risk.limitsFor(plain);
    expect(unlimited.maxOpenStakePerUser).toBe(settings.get('risk.maxOpenStakePerUser'));

    await settings.set('risk.maxOpenStakePerUser', 25_000);
    try {
      const applied = risk.limitsFor(plain);
      expect(applied.maxOpenStakePerUser).toBe(25_000);
      // the market's own figure still wins where it has one
      const own = risk.limitsFor(await prisma.asset.findUniqueOrThrow({ where: { id: assetId } }));
      expect(own.maxOpenStakePerUser).toBe(30_000);
    } finally {
      await settings.reset('risk.maxOpenStakePerUser');
    }
  });
});

/** Both expiry modes are validated by the server, not trusted from the client. */
suite('expiry modes', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let trading: typeof import('../../services/trading.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const symbol = `EXPUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    trading = await import('../../services/trading.js');
    settings = (await import('../../services/settings.js')).settings;
    feed = (await import('../../engine/feed.js')).marketFeed;
    await settings.load();

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Expiry Coin',
        pair: 'EXP/USD',
        assetClass: 'CRYPTO',
        base: 'EXP',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
        // this market offers a narrower set than the platform
        durations: [60, 300],
      },
    });
    made.assets.push(asset.id);
    feed.load([{ symbol, feedSymbol: symbol, basePrice: 100, volatility: 0.001, precision: 2 }]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  const makeTrader = async () => {
    const user = await prisma.user.create({
      data: {
        email: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Expiry Trader',
        passwordHash: 'x',
        referralCode: `EXP${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        demoBalance: 1_000_000,
      },
    });
    made.users.push(user.id);
    return user;
  };

  it('opens a duration position and records the mode', async () => {
    const user = await makeTrader();
    const trade = await trading.placeTrade({
      userId: user.id,
      symbol,
      direction: 'UP',
      stake: 5_000,
      durationSec: 300,
      accountType: 'DEMO',
    });
    expect(trade.expiryMode).toBe('DURATION');
    expect(trade.durationSec).toBe(300);
    expect(trade.expiresAt.getTime() - trade.openedAt.getTime()).toBeGreaterThanOrEqual(299_000);
  });

  it('refuses a duration this market does not offer, even when the platform does', async () => {
    expect(trading.durations()).toContain(30);
    expect(trading.durationsFor({ durations: [60, 300] })).toEqual([60, 300]);

    const user = await makeTrader();
    await expect(
      trading.placeTrade({
        userId: user.id,
        symbol,
        direction: 'UP',
        stake: 5_000,
        durationSec: 30,
        accountType: 'DEMO',
      }),
    ).rejects.toMatchObject({ code: 'invalid_duration' });
  });

  it('never lets a market widen the platform list', async () => {
    // 7 seconds is not a platform duration, so it cannot be offered
    expect(trading.durationsFor({ durations: [7, 60] })).toEqual([60]);
    // and a list with nothing usable falls back to the platform's
    expect(trading.durationsFor({ durations: [7] })).toEqual(trading.durations());
    expect(trading.durationsFor({ durations: 'nonsense' })).toEqual(trading.durations());
  });

  it('opens a clock position on a boundary the server offered', async () => {
    const [slot] = trading.clockExpiries();
    expect(slot).toBeDefined();

    const user = await makeTrader();
    const trade = await trading.placeTrade({
      userId: user.id,
      symbol,
      direction: 'DOWN',
      stake: 5_000,
      expiryMode: 'CLOCK',
      expiresAt: slot.expiresAt,
      accountType: 'DEMO',
    });
    expect(trade.expiryMode).toBe('CLOCK');
    expect(trade.expiresAt.getTime()).toBe(slot.expiresAt);
    // the length is derived from the boundary, not sent by the client
    expect(trade.durationSec).toBeGreaterThan(0);
    expect(trade.durationSec).toBeLessThanOrEqual(slot.durationSec + 1);
  });

  it('refuses an instant that is not a boundary', async () => {
    const user = await makeTrader();
    await expect(
      trading.placeTrade({
        userId: user.id,
        symbol,
        direction: 'UP',
        stake: 5_000,
        expiryMode: 'CLOCK',
        // deliberately 17 seconds past a minute
        expiresAt: Math.floor(Date.now() / 60_000) * 60_000 + 137_000,
        accountType: 'DEMO',
      }),
    ).rejects.toMatchObject({ code: 'invalid_expiry' });
  });

  it('refuses a boundary inside its purchase cut-off', async () => {
    const cutoff = settings.get('trading.clockCutoffSec');
    // the boundary immediately after now is inside the cut-off by construction
    const soon = Math.floor((Date.now() + 1_000) / 60_000) * 60_000 + 60_000;
    const insideCutoff = soon - Date.now() <= cutoff * 1000;

    const user = await makeTrader();
    const attempt = trading.placeTrade({
      userId: user.id,
      symbol,
      direction: 'UP',
      stake: 5_000,
      expiryMode: 'CLOCK',
      expiresAt: soon,
      accountType: 'DEMO',
    });

    if (insideCutoff) await expect(attempt).rejects.toMatchObject({ code: 'expiry_closed' });
    else expect((await attempt).expiresAt.getTime()).toBe(soon);
  });

  it('refuses a boundary already in the past', async () => {
    const user = await makeTrader();
    await expect(
      trading.placeTrade({
        userId: user.id,
        symbol,
        direction: 'UP',
        stake: 5_000,
        expiryMode: 'CLOCK',
        expiresAt: Math.floor((Date.now() - 600_000) / 60_000) * 60_000,
        accountType: 'DEMO',
      }),
    ).rejects.toMatchObject({ code: 'expiry_closed' });
  });

  it('offers only boundaries it will accept', async () => {
    // the contract between the list a trader sees and the validation
    const user = await makeTrader();
    for (const slot of trading.clockExpiries().slice(0, 3)) {
      const trade = await trading.placeTrade({
        userId: user.id,
        symbol,
        direction: 'UP',
        stake: 1_000,
        expiryMode: 'CLOCK',
        expiresAt: slot.expiresAt,
        accountType: 'DEMO',
      });
      expect(trade.expiresAt.getTime()).toBe(slot.expiresAt);
    }
  });

  it('refuses a mode the platform has turned off', async () => {
    await settings.set('trading.expiryModes', ['DURATION']);
    try {
      const [slot] = trading.clockExpiries();
      expect(slot).toBeUndefined();
      const user = await makeTrader();
      await expect(
        trading.placeTrade({
          userId: user.id,
          symbol,
          direction: 'UP',
          stake: 5_000,
          expiryMode: 'CLOCK',
          expiresAt: Math.floor(Date.now() / 60_000) * 60_000 + 300_000,
          accountType: 'DEMO',
        }),
      ).rejects.toMatchObject({ code: 'invalid_expiry' });
    } finally {
      await settings.reset('trading.expiryModes');
    }
  });
});

/** Pending orders open exactly once, from the feed, and can be cancelled. */
suite('pending orders', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let orders: typeof import('../../services/orders.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const symbol = `PENDUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    orders = await import('../../services/orders.js');
    settings = (await import('../../services/settings.js')).settings;
    feed = (await import('../../engine/feed.js')).marketFeed;
    await settings.load();

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Pending Coin',
        pair: 'PEND/USD',
        assetClass: 'CRYPTO',
        base: 'PEND',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    feed.load([{ symbol, feedSymbol: symbol, basePrice: 100, volatility: 0.001, precision: 2 }]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.pendingTrade.deleteMany({ where: { symbol } });
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  const makeTrader = async (balance = 1_000_000) => {
    const user = await prisma.user.create({
      data: {
        email: `pend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Pending Trader',
        passwordHash: 'x',
        referralCode: `PND${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        demoBalance: balance,
      },
    });
    made.users.push(user.id);
    return user;
  };

  /** Pins the feed to an exact price, so a level can be crossed on demand. */
  const setPrice = (price: number) => {
    feed.resume([
      {
        symbol,
        price,
        anchor: price,
        variance: 1e-8,
        lastShock: 0,
        regime: 'RANGE',
        regimeTicks: 10,
        regimeTicksLeft: 10,
        trendDirection: 1,
        rng: 12345,
        ticks: 1,
      },
    ]);
    return price;
  };

  const place = (userId: string, over: Record<string, unknown> = {}) =>
    orders.createOrder({
      userId,
      symbol,
      accountType: 'DEMO',
      direction: 'UP',
      stake: 5_000,
      trigger: 'PRICE',
      triggerPrice: 110,
      durationSec: 60,
      ...over,
    });

  it('waits until the level is met, then opens exactly one position', async () => {
    const user = await makeTrader();
    setPrice(100);
    const order = await place(user.id, { triggerPrice: 105 });
    expect(order.status).toBe('PENDING');
    expect(order.triggerSide).toBe('ABOVE');

    // the market is at 100, so nothing fires
    expect(await orders.sweepOrders()).toEqual({ filled: 0, expired: 0 });
    expect((await prisma.pendingTrade.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');

    // move the market through the level
    setPrice(106);
    expect(feed.getPrice(symbol)).toBe(106);

    const swept = await orders.sweepOrders();
    expect(swept.filled).toBe(1);

    const filled = await prisma.pendingTrade.findUniqueOrThrow({ where: { id: order.id } });
    expect(filled.status).toBe('TRIGGERED');
    expect(filled.tradeId).toBeTruthy();

    const trade = await prisma.trade.findUniqueOrThrow({ where: { id: filled.tradeId! } });
    expect(trade.stake).toBe(5_000);
    expect(trade.direction).toBe('UP');
    expect(trade.durationSec).toBe(60);

    // a second sweep must not open another position
    expect((await orders.sweepOrders()).filled).toBe(0);
    expect(await prisma.trade.count({ where: { symbol, userId: user.id } })).toBe(1);
  });

  it('opens once even when two sweeps run at the same time', async () => {
    const user = await makeTrader();
    const price = setPrice(100);
    // placed above the market, then the market crosses it
    const order = await place(user.id, { triggerPrice: price + 2 });
    setPrice(price + 3);

    // the same guarantee settlement has: the row is claimed before anything is
    // placed, so overlapping passes cannot both fill it
    const [a, b] = await Promise.all([orders.sweepOrders(), orders.sweepOrders()]);
    expect(a.filled + b.filled).toBe(1);
    expect(await prisma.trade.count({ where: { symbol, userId: user.id } })).toBe(1);
    expect((await prisma.pendingTrade.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'TRIGGERED',
    );
  });

  it('fires a time order when its moment arrives', async () => {
    const user = await makeTrader();
    const triggerAt = new Date(Date.now() + 1_500);
    const order = await orders.createOrder({
      userId: user.id,
      symbol,
      accountType: 'DEMO',
      direction: 'DOWN',
      stake: 2_000,
      trigger: 'TIME',
      triggerAt,
      durationSec: 60,
    });
    expect(order.triggerAt?.getTime()).toBe(triggerAt.getTime());

    expect((await orders.sweepOrders()).filled).toBe(0);
    // the sweep takes `now`, so the clock does not have to be waited out
    expect((await orders.sweepOrders(triggerAt.getTime())).filled).toBe(1);

    const filled = await prisma.pendingTrade.findUniqueOrThrow({ where: { id: order.id } });
    expect(filled.status).toBe('TRIGGERED');
  });

  it('can be cancelled while it waits, and not after it fills', async () => {
    const user = await makeTrader();
    const order = await place(user.id, { triggerPrice: 5_000 });

    const cancelled = await orders.cancelOrder(user.id, order.id);
    expect(cancelled.status).toBe('CANCELLED');
    // a cancelled order never fires
    expect((await orders.sweepOrders()).filled).toBe(0);
    await expect(orders.cancelOrder(user.id, order.id)).rejects.toMatchObject({
      code: 'order_not_pending',
    });
  });

  it('belongs to its owner and nobody else', async () => {
    const owner = await makeTrader();
    const stranger = await makeTrader();
    const order = await place(owner.id, { triggerPrice: 5_000 });

    // no IDOR: another trader cannot see or cancel it
    await expect(orders.cancelOrder(stranger.id, order.id)).rejects.toMatchObject({ status: 404 });
    const theirs = await orders.listOrders(stranger.id);
    expect(theirs.find((row) => row.id === order.id)).toBeUndefined();
    await orders.cancelOrder(owner.id, order.id);
  });

  it('retires an order that ran out of time without filling', async () => {
    const user = await makeTrader();
    const order = await place(user.id, {
      triggerPrice: 5_000,
      goodUntil: new Date(Date.now() + 1_000),
    });

    const swept = await orders.sweepOrders(Date.now() + 2_000);
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.pendingTrade.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('EXPIRED');
  });

  it('records why an order could not be opened rather than retrying it', async () => {
    // a trader with almost no balance: the order is accepted, and fails when it
    // fires, which is the honest outcome — no money is held while it waits
    const user = await makeTrader(100);
    const price = setPrice(100);
    const order = await place(user.id, { triggerPrice: price + 1, stake: 50_000 });

    setPrice(price + 2);
    await orders.sweepOrders();

    const failed = await prisma.pendingTrade.findUniqueOrThrow({ where: { id: order.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toBeTruthy();
    expect(failed.tradeId).toBeNull();

    // and it is not tried again
    expect((await orders.sweepOrders()).filled).toBe(0);
    expect(await prisma.trade.count({ where: { userId: user.id } })).toBe(0);
  });

  it('refuses a level sitting exactly on the market price', async () => {
    const price = feed.getPrice(symbol)!;
    const user = await makeTrader();
    await expect(place(user.id, { triggerPrice: price })).rejects.toMatchObject({
      code: 'invalid_trigger_price',
    });
  });

  it('refuses a start time in the past and a window that closes first', async () => {
    const user = await makeTrader();
    await expect(
      place(user.id, { trigger: 'TIME', triggerAt: new Date(Date.now() - 60_000), triggerPrice: undefined }),
    ).rejects.toMatchObject({ code: 'invalid_trigger_time' });

    await expect(
      place(user.id, {
        trigger: 'TIME',
        triggerPrice: undefined,
        triggerAt: new Date(Date.now() + 600_000),
        goodUntil: new Date(Date.now() + 60_000),
      }),
    ).rejects.toMatchObject({ code: 'invalid_trigger_time' });
  });

  it('lists waiting orders first, and never drops them for old ones', async () => {
    const user = await makeTrader();
    setPrice(100);

    // a history of finished orders, then one that is still waiting
    for (let index = 0; index < 4; index += 1) {
      const done = await place(user.id, { triggerPrice: 200 + index });
      await orders.cancelOrder(user.id, done.id);
    }
    const waiting = await place(user.id, { triggerPrice: 300 });

    // sorting by the status column would put CANCELLED before PENDING and, with
    // a tight limit, lose the live order altogether
    const listed = await orders.listOrders(user.id, { limit: 2 });
    expect(listed[0].id).toBe(waiting.id);
    expect(listed[0].status).toBe('PENDING');

    const onlyWaiting = await orders.listOrders(user.id, { status: 'PENDING' });
    expect(onlyWaiting.map((row) => row.id)).toEqual([waiting.id]);

    const onlyDone = await orders.listOrders(user.id, { status: 'DONE' });
    expect(onlyDone).toHaveLength(4);
    expect(onlyDone.every((row) => row.status === 'CANCELLED')).toBe(true);

    await orders.cancelOrder(user.id, waiting.id);
  });

  it('caps how many orders one trader may have waiting', async () => {
    const user = await makeTrader();
    await settings.set('trading.maxPendingOrders', 2);
    try {
      await place(user.id, { triggerPrice: 4_001 });
      await place(user.id, { triggerPrice: 4_002 });
      await expect(place(user.id, { triggerPrice: 4_003 })).rejects.toMatchObject({
        code: 'too_many_pending_orders',
      });
    } finally {
      await settings.reset('trading.maxPendingOrders');
      await prisma.pendingTrade.updateMany({
        where: { userId: user.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    }
  });
});

/** Repeating a position opens a new trade at the price and payout of now. */
suite('repeat a position', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let trading: typeof import('../../services/trading.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const symbol = `REPUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    trading = await import('../../services/trading.js');
    settings = (await import('../../services/settings.js')).settings;
    feed = (await import('../../engine/feed.js')).marketFeed;
    await settings.load();

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Repeat Coin',
        pair: 'REP/USD',
        assetClass: 'CRYPTO',
        base: 'REP',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
        durations: [60, 300],
      },
    });
    made.assets.push(asset.id);
    feed.load([{ symbol, feedSymbol: symbol, basePrice: 100, volatility: 0.001, precision: 2 }]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  const makeTrader = async (balance = 1_000_000) => {
    const user = await prisma.user.create({
      data: {
        email: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Repeat Trader',
        passwordHash: 'x',
        referralCode: `REP${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        demoBalance: balance,
      },
    });
    made.users.push(user.id);
    return user;
  };

  const open = (userId: string, over: Record<string, unknown> = {}) =>
    trading.placeTrade({
      userId,
      symbol,
      direction: 'UP',
      stake: 5_000,
      durationSec: 60,
      accountType: 'DEMO',
      ...over,
    });

  it('opens the same market, direction and expiry at the same stake', async () => {
    const user = await makeTrader();
    const first = await open(user.id);
    const again = await trading.repeatTrade(user.id, first.id);

    expect(again.id).not.toBe(first.id);
    expect(again.symbol).toBe(first.symbol);
    expect(again.direction).toBe(first.direction);
    expect(again.durationSec).toBe(first.durationSec);
    expect(again.stake).toBe(first.stake);
    // it is a new trade, priced now
    expect(again.openedAt.getTime()).toBeGreaterThanOrEqual(first.openedAt.getTime());
  });

  it('doubles the stake when asked, and charges for it', async () => {
    const user = await makeTrader();
    const first = await open(user.id, { stake: 3_000 });
    const doubled = await trading.repeatTrade(user.id, first.id, 2);

    expect(doubled.stake).toBe(6_000);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.demoBalance).toBe(1_000_000 - 3_000 - 6_000);
  });

  it('belongs to its owner and nobody else', async () => {
    const owner = await makeTrader();
    const stranger = await makeTrader();
    const trade = await open(owner.id);
    await expect(trading.repeatTrade(stranger.id, trade.id)).rejects.toMatchObject({ status: 404 });
  });

  it('is still checked against every limit, like any other trade', async () => {
    // a trader who cannot afford the double
    const user = await makeTrader(7_000);
    const first = await open(user.id, { stake: 5_000 });
    await expect(trading.repeatTrade(user.id, first.id, 2)).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
  });

  it('refuses when an operator has turned it off', async () => {
    const user = await makeTrader();
    const trade = await open(user.id);
    await settings.set('trading.allowRepeat', false);
    try {
      await expect(trading.repeatTrade(user.id, trade.id)).rejects.toMatchObject({
        code: 'repeat_disabled',
      });
    } finally {
      await settings.reset('trading.allowRepeat');
    }
  });

  it('refuses a duration the market has since stopped offering', async () => {
    const user = await makeTrader();
    const trade = await open(user.id, { durationSec: 300 });
    await prisma.asset.update({ where: { symbol }, data: { durations: [60] } });
    try {
      await expect(trading.repeatTrade(user.id, trade.id)).rejects.toMatchObject({
        code: 'invalid_duration',
      });
    } finally {
      await prisma.asset.update({ where: { symbol }, data: { durations: [60, 300] } });
    }
  });

  it('re-buys the soonest boundary for a clock position, not the one that passed', async () => {
    const user = await makeTrader();
    const [slot] = trading.clockExpiries();
    const first = await open(user.id, {
      durationSec: undefined,
      expiryMode: 'CLOCK',
      expiresAt: slot.expiresAt,
    });
    expect(first.expiryMode).toBe('CLOCK');

    const again = await trading.repeatTrade(user.id, first.id);
    expect(again.expiryMode).toBe('CLOCK');
    // the original boundary may already be inside its cut-off, so the repeat
    // takes whatever is open now
    expect(again.expiresAt.getTime()).toBeGreaterThanOrEqual(Date.now());
    const offered = trading.clockExpiries().map((each) => each.expiresAt);
    expect([...offered, slot.expiresAt]).toContain(again.expiresAt.getTime());
  });
});

/** A settled position can be reviewed: its own candles, and nobody else's. */
suite('trade detail', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let trading: typeof import('../../services/trading.js');
  let store: (typeof import('../../services/candles.js'))['candleStore'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];
  let snapshot: typeof import('../../engine/snapshot.js');

  const symbol = `SNAPUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    trading = await import('../../services/trading.js');
    store = (await import('../../services/candles.js')).candleStore;
    feed = (await import('../../engine/feed.js')).marketFeed;
    snapshot = await import('../../engine/snapshot.js');

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Snapshot Coin',
        pair: 'SNAP/USD',
        assetClass: 'CRYPTO',
        base: 'SNAP',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    feed.load([{ symbol, feedSymbol: symbol, basePrice: 100, volatility: 0.001, precision: 2 }]);
    store.register(symbol, { basePrice: 100, volatility: 0.001, precision: 2 });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.candle.deleteMany({ where: { symbol } });
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    store._reset();
    await prisma.$disconnect();
  });

  const makeTrader = async () => {
    const user = await prisma.user.create({
      data: {
        email: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Snapshot Trader',
        passwordHash: 'x',
        referralCode: `SNP${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        demoBalance: 1_000_000,
      },
    });
    made.users.push(user.id);
    return user;
  };

  it('serves candles covering the whole position', async () => {
    const user = await makeTrader();
    const trade = await trading.placeTrade({
      userId: user.id,
      symbol,
      direction: 'UP',
      stake: 5_000,
      durationSec: 300,
      accountType: 'DEMO',
    });

    const window = snapshot.snapshotWindow(
      trade.openedAt.getTime(),
      trade.expiresAt.getTime(),
      trade.durationSec,
    );
    const candles = await store.history(symbol, window.timeframe, {
      before: window.to + 60,
      limit: window.bars + 10,
    });
    const covering = candles.filter((candle) => candle.time >= window.from && candle.time <= window.to);

    // the window spans the trade with room either side, and the store has it
    expect(window.from).toBeLessThan(Math.floor(trade.openedAt.getTime() / 1000));
    expect(window.to).toBeGreaterThan(Math.floor(trade.expiresAt.getTime() / 1000));
    expect(covering.length).toBeGreaterThan(3);
    for (const candle of covering) {
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
    }
  });

  it('picks a timeframe that suits the position, short or long', async () => {
    const user = await makeTrader();
    const quick = await trading.placeTrade({
      userId: user.id,
      symbol,
      direction: 'UP',
      stake: 1_000,
      durationSec: 30,
      accountType: 'DEMO',
    });
    const slow = await trading.placeTrade({
      userId: user.id,
      symbol,
      direction: 'DOWN',
      stake: 1_000,
      durationSec: 3_600,
      accountType: 'DEMO',
    });

    const quickWindow = snapshot.snapshotWindow(
      quick.openedAt.getTime(),
      quick.expiresAt.getTime(),
      quick.durationSec,
    );
    const slowWindow = snapshot.snapshotWindow(
      slow.openedAt.getTime(),
      slow.expiresAt.getTime(),
      slow.durationSec,
    );

    expect(quickWindow.timeframe).toBe('5s');
    expect(slowWindow.timeframe).toBe('2m');
    // both readable, neither one bar nor hundreds
    for (const each of [quickWindow, slowWindow]) {
      expect(each.bars).toBeGreaterThan(3);
      expect(each.bars).toBeLessThan(120);
    }
  });

  it('can be traded again from its own record, whatever its outcome', async () => {
    const user = await makeTrader();
    const trade = await trading.placeTrade({
      userId: user.id,
      symbol,
      direction: 'UP',
      stake: 2_500,
      durationSec: 60,
      accountType: 'DEMO',
    });

    // settle it, then repeat from the settled row — "trade again" works on a
    // finished trade, which is the whole point of it being on a closed row
    await prisma.trade.update({
      where: { id: trade.id },
      data: { status: 'LOST', exitPrice: 99, profit: -2_500, settledAt: new Date() },
    });

    const again = await trading.repeatTrade(user.id, trade.id);
    expect(again.status).toBe('OPEN');
    expect(again.stake).toBe(2_500);
    expect(again.direction).toBe('UP');
    expect(again.durationSec).toBe(60);
  });
});

/** Sentiment reflects real positions, and only ever reads them. */
suite('trader sentiment', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let trading: typeof import('../../services/trading.js');
  let sentimentService: (typeof import('../../services/sentiment.js'))['sentiment'];
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const symbol = `SENTUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    trading = await import('../../services/trading.js');
    sentimentService = (await import('../../services/sentiment.js')).sentiment;
    settings = (await import('../../services/settings.js')).settings;
    feed = (await import('../../engine/feed.js')).marketFeed;
    await settings.load();

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Sentiment Coin',
        pair: 'SENT/USD',
        assetClass: 'CRYPTO',
        base: 'SENT',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    feed.load([{ symbol, feedSymbol: symbol, basePrice: 100, volatility: 0.001, precision: 2 }]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  const makeTrader = async () => {
    const user = await prisma.user.create({
      data: {
        email: `sent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Sentiment Trader',
        passwordHash: 'x',
        referralCode: `SNT${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        demoBalance: 1_000_000,
        realBalance: 1_000_000,
      },
    });
    made.users.push(user.id);
    return user;
  };

  const open = (userId: string, direction: 'UP' | 'DOWN', stake: number, accountType = 'DEMO') =>
    trading.placeTrade({
      userId,
      symbol,
      direction,
      stake,
      durationSec: 3600,
      accountType: accountType as 'DEMO' | 'REAL',
    });

  it('says nothing until enough positions have been taken', async () => {
    const user = await makeTrader();
    await open(user.id, 'UP', 10_000);
    await sentimentService.refresh();

    const quiet = sentimentService.for(symbol);
    // the default threshold is five; one position is not a trend
    expect(quiet.meaningful).toBe(false);
    expect(quiet.trades).toBe(1);
    expect(quiet.upPct).toBe(50);
  });

  it('is the share of staked money, not of trade count', async () => {
    const whale = await makeTrader();
    const crowd = await makeTrader();
    // one large DOWN against four small UPs is a bearish book
    await open(whale.id, 'DOWN', 70_000);
    for (let index = 0; index < 4; index += 1) await open(crowd.id, 'UP', 5_000);
    await sentimentService.refresh();

    const book = sentimentService.for(symbol);
    expect(book.meaningful).toBe(true);
    expect(book.trades).toBe(6);
    // 10,000 + 20,000 up against 70,000 down
    expect(book.downPct).toBeGreaterThan(book.upPct);
    expect(book.upPct + book.downPct).toBe(100);
    expect(book.stake).toBe(100_000);
  });

  it('counts live and practice positions, never tournament chips', async () => {
    const before = sentimentService.for(symbol);
    const user = await makeTrader();
    await open(user.id, 'UP', 10_000, 'REAL');
    await sentimentService.refresh();

    const after = sentimentService.for(symbol);
    expect(after.trades).toBe(before.trades + 1);
    expect(after.stake).toBe(before.stake + 10_000);
  });

  it('only looks at the recent window', async () => {
    // a position from outside the window does not count
    const user = await makeTrader();
    const old = await open(user.id, 'UP', 500_000);
    await prisma.trade.update({
      where: { id: old.id },
      data: { openedAt: new Date(Date.now() - 24 * 3_600_000) },
    });

    const withOld = sentimentService.for(symbol);
    await sentimentService.refresh();
    const withoutOld = sentimentService.for(symbol);
    expect(withoutOld.trades).toBe(withOld.trades);
    expect(withoutOld.stake).toBe(withOld.stake);
  });

  it('goes quiet when an operator turns it off', async () => {
    await settings.set('trading.sentimentEnabled', false);
    try {
      await sentimentService.refresh();
      expect(sentimentService.for(symbol).trades).toBe(0);
      expect(sentimentService.all()).toEqual({});
    } finally {
      await settings.reset('trading.sentimentEnabled');
      await sentimentService.refresh();
    }
  });
});

suite('top traders today', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let board: (typeof import('../../services/leaderboard.js'))['leaderboard'];
  let settings: (typeof import('../../services/settings.js'))['settings'];

  const symbol = `LBUSD_${Date.now()}`;
  const made = { users: [] as string[], assets: [] as string[] };
  let assetId = '';

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    board = (await import('../../services/leaderboard.js')).leaderboard;
    settings = (await import('../../services/settings.js')).settings;
    await settings.load();

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'Leader Coin',
        pair: 'LEAD/USD',
        assetClass: 'CRYPTO',
        base: 'LEAD',
        quote: 'USD',
        feedSymbol: symbol,
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    assetId = asset.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { symbol } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  const makeTrader = async (name: string, overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `lb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name,
        country: 'PT',
        passwordHash: 'x',
        referralCode: `LBD${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        ...overrides,
      },
    });
    made.users.push(user.id);
    return user;
  };

  /** A settled position, written straight in: the service only ever reads these. */
  const settled = (
    userId: string,
    profit: number,
    options: { accountType?: string; status?: string; settledAt?: Date } = {},
  ) =>
    prisma.trade.create({
      data: {
        userId,
        assetId,
        symbol,
        accountType: options.accountType ?? 'REAL',
        direction: profit >= 0 ? 'UP' : 'DOWN',
        stake: 10_000,
        payoutPct: 80,
        entryPrice: 100,
        exitPrice: 101,
        durationSec: 60,
        expiresAt: new Date(),
        settledAt: options.settledAt ?? new Date(),
        status: options.status ?? (profit > 0 ? 'WON' : 'LOST'),
        profit,
      },
    });

  /**
   * A row carries no user id — that is the point of the board — so a test finds
   * its own traders by the masked name. The figures are deliberately large
   * because the test database is shared: these traders have to sit at the top
   * of the day whatever else another suite settled.
   */
  const rowFor = (initials: string, options: { viewerId?: string } = {}) =>
    board.board({ limit: 100, ...options }).rows.find((row) => row.display === initials);

  it('ranks live profit for the day and masks who made it', async () => {
    const winner = await makeTrader('Ada Lovelace');
    const second = await makeTrader('Grace Hopper');
    await settled(winner.id, 40_000_000);
    await settled(winner.id, 40_000_000);
    await settled(second.id, 70_000_000);
    await board.refresh();

    const rows = board.board({ limit: 100 }).rows;
    const top = rows.findIndex((row) => row.display === 'A•• L.');
    const next = rows.findIndex((row) => row.display === 'G•••• H.');
    expect(top).toBe(0);
    expect(next).toBe(1);

    expect(rows[0].profit).toBe(80_000_000);
    expect(rows[0].trades).toBe(2);
    expect(rows[0].winRate).toBe(100);
    // the board is public, so a real name never reaches it
    expect(JSON.stringify(rows)).not.toContain('Lovelace');
    expect(rows[0].flag).toBe('🇵🇹');
  });

  it('ignores practice and tournament results', async () => {
    const practice = await makeTrader('Demoing Whale');
    await settled(practice.id, 99_000_000, { accountType: 'DEMO' });
    await settled(practice.id, 98_000_000, { accountType: 'TOURNAMENT' });
    await board.refresh();

    // a practice account starts with a million: it would own the board forever
    expect(rowFor('D•••••• W.')).toBeUndefined();
  });

  it('ignores open positions and yesterday, and counts a refund as a flat day', async () => {
    const trader = await makeTrader('Edsger Dijkstra');
    await settled(trader.id, 60_000_000, { settledAt: new Date(Date.now() - 36 * 3_600_000) });
    await prisma.trade.create({
      data: {
        userId: trader.id,
        assetId,
        symbol,
        accountType: 'REAL',
        direction: 'UP',
        stake: 900_000,
        payoutPct: 80,
        entryPrice: 100,
        durationSec: 60,
        expiresAt: new Date(Date.now() + 60_000),
        status: 'OPEN',
      },
    });
    await settled(trader.id, 0, { status: 'REFUNDED' });
    await board.refresh();

    const row = rowFor('E••••• D.');
    // only the refund settled inside today's window, and it moved nothing
    expect(row?.profit).toBe(0);
    expect(row?.trades).toBe(1);
    expect(row?.winRate).toBe(0);
  });

  it('leaves an opted-out trader out of the ranking entirely', async () => {
    const shy = await makeTrader('Barbara Liskov', { leaderboardOptOut: true });
    await settled(shy.id, 99_000_000);
    await board.refresh();

    // not merely hidden from the rows: a hidden row would still take a rank
    expect(rowFor('B•••••• L.')).toBeUndefined();
    const ranks = board.board({ limit: 100 }).rows.map((row) => row.rank);
    expect(ranks).toEqual(ranks.map((_, index) => index + 1));
  });

  it('marks the row belonging to whoever is reading', async () => {
    const reader = await makeTrader('Ken Thompson');
    await settled(reader.id, 50_000_000);
    await board.refresh();

    expect(rowFor('K•• T.', { viewerId: reader.id })?.isYou).toBe(true);
    expect(rowFor('K•• T.')?.isYou).toBe(false);
    // and nobody else is told which row is theirs
    expect(board.board({ viewerId: reader.id, limit: 100 }).rows.filter((row) => row.isYou)).toHaveLength(1);
  });

  it('shows only as many rows as the operator allows', async () => {
    const one = board.board({ limit: 1 });
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0].rank).toBe(1);
    expect(one.traders).toBeGreaterThan(1);
  });

  it('goes quiet when an operator turns it off', async () => {
    await settings.set('trading.leaderboardEnabled', false);
    try {
      await board.refresh();
      expect(board.board().rows).toEqual([]);
      expect(board.board().traders).toBe(0);
    } finally {
      await settings.reset('trading.leaderboardEnabled');
      await board.refresh();
    }
  });
});
