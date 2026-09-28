/**
 * The safety properties "more than one API instance" actually depends on,
 * proved against a real database rather than assumed from reading the code.
 *
 * `settleTrade`'s atomic `updateMany({ where: { status: 'OPEN' } })` claim is
 * a database-level compare-and-swap — it does not care whether the two
 * callers racing for the same trade are two ticks of one process or two
 * separate `SettlementEngine` instances in two separate processes. This test
 * proves the second case directly: two real `SettlementEngine` instances,
 * each running its own interval loop, pointed at the same due trades.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('settlement across multiple instances', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];
  let SettlementEngine: (typeof import('../../engine/settlement.js'))['SettlementEngine'];

  const made = { users: [] as string[], assets: [] as string[] };

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: {
        email: `scale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Scale Test Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 10_000,
      },
    });
    made.users.push(user.id);
    return user;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    feed = (await import('../../engine/feed.js')).marketFeed;
    SettlementEngine = (await import('../../engine/settlement.js')).SettlementEngine;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.transaction.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.trade.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  });

  it('two independent SettlementEngine instances racing the same due trades pay out exactly once each', async () => {
    const asset = await prisma.asset.create({
      data: {
        symbol: 'SCALEUSD',
        name: 'Scale Coin',
        pair: 'SC/USD',
        assetClass: 'CRYPTO',
        base: 'SC',
        quote: 'USD',
        feedSymbol: 'SCALEUSDT',
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    feed.load([
      { symbol: 'SCALEUSD', feedSymbol: 'SCALEUSDT', basePrice: 100, volatility: 0.001, precision: 2 },
    ]);

    // ten already-expired trades, the shape a sweep pass finds on every instance
    const users = await Promise.all(Array.from({ length: 10 }, () => makeUser()));
    const trades = await Promise.all(
      users.map((user) =>
        prisma.trade.create({
          data: {
            userId: user.id,
            assetId: asset.id,
            symbol: 'SCALEUSD',
            accountType: 'REAL',
            direction: 'UP',
            stake: 1000,
            payoutPct: 80,
            entryPrice: 90,
            durationSec: 30,
            expiresAt: new Date(Date.now() - 1000),
            status: 'OPEN',
          },
        }),
      ),
    );

    // two engines, standing in for two API processes pointed at the same
    // database — neither knows the other exists, exactly like production
    const instanceA = new SettlementEngine();
    const instanceB = new SettlementEngine();

    const [settledByA, settledByB] = await Promise.all([instanceA.tick(), instanceB.tick()]);

    // between them, every due trade settled exactly once — not zero, not twice
    expect(settledByA + settledByB).toBe(trades.length);

    for (const trade of trades) {
      const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
      expect(row.status).toBe('WON');
      const payouts = await prisma.transaction.findMany({ where: { refId: trade.id, type: 'TRADE_PAYOUT' } });
      expect(payouts).toHaveLength(1);
    }
  });

  it('a settlement pass beginning on one instance and a second pass beginning on another, overlapping mid-flight, still pays each trade once', async () => {
    const asset = await prisma.asset.findFirstOrThrow({ where: { id: { in: made.assets } } });
    const users = await Promise.all(Array.from({ length: 6 }, () => makeUser()));
    const trades = await Promise.all(
      users.map((user) =>
        prisma.trade.create({
          data: {
            userId: user.id,
            assetId: asset.id,
            symbol: 'SCALEUSD',
            accountType: 'REAL',
            direction: 'UP',
            stake: 500,
            payoutPct: 80,
            entryPrice: 90,
            durationSec: 30,
            expiresAt: new Date(Date.now() - 1000),
            status: 'OPEN',
          },
        }),
      ),
    );

    const instanceA = new SettlementEngine();
    const instanceB = new SettlementEngine();
    const instanceC = new SettlementEngine();

    // three overlapping passes, the way three real instances' independent
    // interval timers would land within milliseconds of each other
    const [a, b, c] = await Promise.all([instanceA.tick(), instanceB.tick(), instanceC.tick()]);
    expect(a + b + c).toBe(trades.length);

    for (const trade of trades) {
      const payouts = await prisma.transaction.findMany({ where: { refId: trade.id, type: 'TRADE_PAYOUT' } });
      expect(payouts).toHaveLength(1);
    }
  });
});

/**
 * A k6 run at 1,000 concurrent traders surfaced a real bug this section
 * proves fixed: many `placeTrade` calls racing for the same account row can
 * lose to MySQL's own deadlock/serialization detection (Prisma reports
 * P2034), and that was surfacing as a raw 500 instead of either succeeding
 * or failing with a real, typed error. `placeTrade`'s transaction now goes
 * through `retryOnConflict` (see lib/retry.ts) — safe because nothing
 * outside the transaction observes it until it resolves — which is enough to
 * absorb ordinary contention. At this suite's deliberately extreme level (30
 * fully simultaneous calls on one row, well beyond anything one trader's own
 * client would ever produce), retries can still be exhausted; the service
 * layer is allowed to throw the raw conflict in that residual case exactly
 * like any other Prisma error, and `middleware/error.ts` is where it — like
 * every other error shape — becomes a clean typed response (409
 * `write_conflict`), which the second test below proves over real HTTP.
 */
suite('trade placement under write contention', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];
  let trading: typeof import('../../services/trading.js');
  let AppError: (typeof import('../../lib/errors.js'))['AppError'];
  let isConflict: (typeof import('../../lib/retry.js'))['isConflict'];

  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    feed = (await import('../../engine/feed.js')).marketFeed;
    trading = await import('../../services/trading.js');
    AppError = (await import('../../lib/errors.js')).AppError;
    isConflict = (await import('../../lib/retry.js')).isConflict;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.transaction.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.trade.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  });

  it('many concurrent placeTrade calls on the same account either succeed cleanly or fail with a real error — never a raw 500 — and debit exactly once per success', async () => {
    const asset = await prisma.asset.create({
      data: {
        symbol: 'CONTENDUSD',
        name: 'Contention Coin',
        pair: 'CT/USD',
        assetClass: 'CRYPTO',
        base: 'CT',
        quote: 'USD',
        feedSymbol: 'CONTENDUSDT',
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    feed.load([
      { symbol: 'CONTENDUSD', feedSymbol: 'CONTENDUSDT', basePrice: 100, volatility: 0.001, precision: 2 },
    ]);

    const user = await prisma.user.create({
      data: {
        email: `contend-${Date.now()}@test.dev`,
        name: 'Contention Test Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 1_000_000,
      },
    });
    made.users.push(user.id);

    // thirty of the same account's own trades, fired in the same instant —
    // exactly the shape that produced P2034 under the k6 run
    const attempts = 30;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        trading.placeTrade({
          userId: user.id,
          symbol: 'CONTENDUSD',
          direction: 'UP',
          stake: 1000,
          expiryMode: 'DURATION',
          durationSec: 30,
          accountType: 'REAL',
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // every failure is either a real, typed AppError (risk/validation) or a
    // residual write conflict that survived retryOnConflict's attempts — the
    // service layer may still throw that one raw, same as any other Prisma
    // error; it is middleware/error.ts's job to turn it into a clean 409, not
    // this function's (see the HTTP-level test below)
    for (const r of failed) {
      if (r.status !== 'rejected') continue;
      expect(r.reason instanceof AppError || isConflict(r.reason)).toBe(true);
    }

    // and every stake that succeeded was debited exactly once — no double
    // charge from a retried transaction, no silent loss either
    const stakeTxns = await prisma.transaction.findMany({
      where: { userId: user.id, type: 'TRADE_STAKE' },
    });
    expect(stakeTxns).toHaveLength(succeeded.length);

    const user2 = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(user2.realBalance).toBe(1_000_000 - succeeded.length * 1000);
  });
});

suite('POST /api/trades under write contention, over real HTTP', () => {
  let app: import('express').Express;
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];
  let signAccessToken: (typeof import('../../lib/jwt.js'))['signAccessToken'];

  const made = { users: [] as string[], assets: [] as string[] };

  beforeAll(async () => {
    app = (await import('../../app.js')).createApp();
    prisma = (await import('../../lib/prisma.js')).prisma;
    feed = (await import('../../engine/feed.js')).marketFeed;
    signAccessToken = (await import('../../lib/jwt.js')).signAccessToken;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.transaction.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.trade.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  });

  it('never answers with a raw 500 — every response is 201 or a clean, typed error', async () => {
    const request = (await import('supertest')).default;
    const asset = await prisma.asset.create({
      data: {
        symbol: 'CONTENDHTTP',
        name: 'Contention HTTP Coin',
        pair: 'CH/USD',
        assetClass: 'CRYPTO',
        base: 'CH',
        quote: 'USD',
        feedSymbol: 'CONTENDHTTPUSDT',
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
        pipSize: 0.01,
        payoutPct: 80,
      },
    });
    made.assets.push(asset.id);
    feed.load([
      {
        symbol: 'CONTENDHTTP',
        feedSymbol: 'CONTENDHTTPUSDT',
        basePrice: 100,
        volatility: 0.001,
        precision: 2,
      },
    ]);

    const user = await prisma.user.create({
      data: {
        email: `contend-http-${Date.now()}@test.dev`,
        name: 'Contention HTTP Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        realBalance: 1_000_000,
      },
    });
    made.users.push(user.id);
    const token = signAccessToken({ sub: user.id, role: 'TRADER', email: user.email });

    const responses = await Promise.all(
      Array.from({ length: 30 }, () =>
        request(app).post('/api/trades').set('authorization', `Bearer ${token}`).send({
          symbol: 'CONTENDHTTP',
          direction: 'UP',
          amount: 10,
          expiryMode: 'DURATION',
          durationSec: 30,
          accountType: 'REAL',
        }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s < 500)).toBe(true);
    // and the one write-conflict shape this suite exists to prove: a clean
    // typed body, never Prisma's own error shape
    for (const res of responses) {
      if (res.status === 409 && res.body.error?.code === 'write_conflict') {
        expect(res.body.error.message).toBeTruthy();
        expect(res.body).not.toHaveProperty('clientVersion');
      }
    }
  });
});
