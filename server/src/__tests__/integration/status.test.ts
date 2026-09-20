/**
 * Status level perks, against a real database.
 *
 * Two of the three perks move money, so they belong here rather than in a unit
 * test: a deposit bonus has to reach the balance through the ledger, and a
 * payout bonus has to be written into the position at the instant it opens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('status levels', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let deposits: typeof import('../../services/deposits.js');
  let trading: typeof import('../../services/trading.js');
  let settings: (typeof import('../../services/settings.js'))['settings'];
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const made = { users: [] as string[], assets: [] as string[], tournaments: [] as string[] };

  const makeUser = async (totalDeposited = 0) => {
    const user = await prisma.user.create({
      data: {
        email: `st-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Status Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        totalDeposited,
        realBalance: 1_000_000,
      },
    });
    made.users.push(user.id);
    return user;
  };

  /** An always-open market of its own, so these tests never fight the clock. */
  const makeAsset = async (payoutPct: number) => {
    const symbol = `ST${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100)}`;
    const asset = await prisma.asset.create({
      data: {
        symbol,
        feedSymbol: symbol,
        name: 'Status Test',
        pair: 'ST/US',
        assetClass: 'CRYPTO',
        base: 'ST',
        quote: 'US',
        isOtc: true,
        payoutPct,
        basePrice: 100,
        volatility: 0.5,
        precision: 2,
        minStake: 100,
        maxStake: 1_000_000,
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

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    deposits = await import('../../services/deposits.js');
    trading = await import('../../services/trading.js');
    settings = (await import('../../services/settings.js')).settings;
    feed = (await import('../../engine/feed.js')).marketFeed;
    await settings.load();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.trade.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.tournamentEntry.deleteMany({ where: { tournamentId: { in: made.tournaments } } });
    await prisma.tournament.deleteMany({ where: { id: { in: made.tournaments } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
    await prisma.$disconnect();
  });

  it("writes the trader's own payout bonus into the position, once, at open", async () => {
    const asset = await makeAsset(80);
    const standard = await makeUser(0);
    const vip = await makeUser(5_000_000);

    const plain = await trading.placeTrade({
      userId: standard.id,
      symbol: asset.symbol,
      accountType: 'REAL',
      direction: 'UP',
      stake: 1_000,
      durationSec: 60,
    });
    const boosted = await trading.placeTrade({
      userId: vip.id,
      symbol: asset.symbol,
      accountType: 'REAL',
      direction: 'UP',
      stake: 1_000,
      durationSec: 60,
    });

    expect(plain.payoutPct).toBe(80);
    expect(boosted.payoutPct).toBe(84);

    // and the market itself is untouched: the bonus is on the row, not the quote
    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.payoutPct).toBe(80);
  });

  it('never lifts a payout past the ceiling', async () => {
    const asset = await makeAsset(94);
    const vip = await makeUser(5_000_000);
    const trade = await trading.placeTrade({
      userId: vip.id,
      symbol: asset.symbol,
      accountType: 'REAL',
      direction: 'DOWN',
      stake: 1_000,
      durationSec: 60,
    });
    expect(trade.payoutPct).toBe(settings.get('growth.statusMaxPayoutPct'));
  });

  it('credits the deposit bonus through the ledger, at the level held before it', async () => {
    // one cent below the VIP bar: this deposit earns the level, it is not paid at it
    const threshold = settings.get('growth.statusVipThreshold');
    const user = await makeUser(threshold - 1);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const deposit = await deposits.createDeposit({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 500,
    });
    const credited = await deposits.completeDeposit(deposit.id, { txHash: `st-${deposit.id}` });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // no bonus: they were one cent short when the money arrived
    expect(credited.bonusAmount).toBe(0);
    expect(after.realBalance - before.realBalance).toBe(credited.creditedAmount);

    // the next deposit is paid at VIP
    const second = await deposits.createDeposit({
      userId: user.id,
      currency: 'USDT',
      network: 'TRC20',
      usdAmount: 500,
    });
    const paid = await deposits.completeDeposit(second.id, { txHash: `st-${second.id}` });
    const bonusPct = settings.get('growth.statusVipDepositBonus');
    const expected = Math.floor((paid.creditedAmount * bonusPct) / 100);

    expect(paid.bonusAmount).toBe(expected);
    const finished = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(finished.realBalance - after.realBalance).toBe(paid.creditedAmount + expected);

    // and it went through the ledger like every other movement
    const rows = await prisma.transaction.findMany({
      where: { userId: user.id, type: 'BONUS', refId: second.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(expected);
  });

  it('leaves tournament positions on the same terms for everyone', async () => {
    // a contest where the biggest depositor is paid more is not a contest
    const asset = await makeAsset(80);
    const vip = await makeUser(5_000_000);

    const tournament = await prisma.tournament.create({
      data: {
        name: `Status Cup ${Date.now()}`,
        status: 'RUNNING',
        entryFee: 0,
        prizePool: 0,
        startingBalance: 100_000,
        maxEntries: 10,
        prizeSplit: '100',
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    made.tournaments.push(tournament.id);
    await prisma.tournamentEntry.create({
      data: { tournamentId: tournament.id, userId: vip.id, balance: 100_000, startingBalance: 100_000 },
    });

    const chips = await trading.placeTrade({
      userId: vip.id,
      symbol: asset.symbol,
      accountType: 'TOURNAMENT',
      tournamentId: tournament.id,
      direction: 'UP',
      stake: 1_000,
      durationSec: 60,
    });
    expect(chips.payoutPct).toBe(80);

    // the same trader, same market, on their own money: the bonus is there
    const live = await trading.placeTrade({
      userId: vip.id,
      symbol: asset.symbol,
      accountType: 'REAL',
      direction: 'UP',
      stake: 1_000,
      durationSec: 60,
    });
    expect(live.payoutPct).toBe(84);
  });
});
