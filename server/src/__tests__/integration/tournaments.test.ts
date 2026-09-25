/**
 * Tournament rebuys, market scoping, editing and cancellation, against a
 * real database. These are the money paths this session's roadmap task
 * added: everything that moves cash (entry fees, rebuys, refunds) or that a
 * trader's stake depends on (which markets a tournament's chips can trade).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('tournaments: rebuys, scoping, edit and cancel', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let tournaments: typeof import('../../services/tournaments.js');
  let trading: typeof import('../../services/trading.js');
  let feed: (typeof import('../../engine/feed.js'))['marketFeed'];

  const made = { users: [] as string[], assets: [] as string[], tournaments: [] as string[] };

  const makeUser = (realBalance = 1_000_000) =>
    prisma.user
      .create({
        data: {
          email: `tourn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
          name: 'Tournament Trader',
          passwordHash: 'x',
          referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
          realBalance,
        },
      })
      .then((user) => {
        made.users.push(user.id);
        return user;
      });

  const makeAsset = async () => {
    const symbol = `TN${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
    const asset = await prisma.asset.create({
      data: {
        symbol,
        feedSymbol: symbol,
        name: 'Tournament Test',
        pair: 'TN/US',
        assetClass: 'CRYPTO',
        base: 'TN',
        quote: 'US',
        isOtc: true,
        payoutPct: 80,
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

  const makeTournament = async (overrides: Record<string, unknown> = {}) => {
    const tournament = await prisma.tournament.create({
      data: {
        name: `Rebuy Cup ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'RUNNING',
        entryFee: 500,
        prizePool: 0,
        startingBalance: 100_000,
        maxEntries: 10,
        prizeSplit: '100',
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
        ...overrides,
      },
    });
    made.tournaments.push(tournament.id);
    return tournament;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    tournaments = await import('../../services/tournaments.js');
    trading = await import('../../services/trading.js');
    feed = (await import('../../engine/feed.js')).marketFeed;
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

  describe('rebuys', () => {
    it('refuses a rebuy while chips remain, and pays the fee once busted', async () => {
      const tournament = await makeTournament({ rebuyEnabled: true, rebuyFee: 300, rebuyLimit: 0 });
      const user = await makeUser();
      await tournaments.joinTournament(user.id, tournament.id);

      await expect(tournaments.rebuyEntry(user.id, tournament.id)).rejects.toThrow();

      await prisma.tournamentEntry.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: user.id } },
        data: { balance: 0 },
      });

      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const entry = await tournaments.rebuyEntry(user.id, tournament.id);
      expect(entry.balance).toBe(tournament.startingBalance);
      expect(entry.rebuys).toBe(1);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(before.realBalance - after.realBalance).toBe(300);

      const pool = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      // the entry fee (500) plus this rebuy (300)
      expect(pool.prizePool).toBe(800);
    });

    it('stops at the rebuy limit', async () => {
      const tournament = await makeTournament({ rebuyEnabled: true, rebuyFee: 100, rebuyLimit: 1 });
      const user = await makeUser();
      await tournaments.joinTournament(user.id, tournament.id);
      await prisma.tournamentEntry.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: user.id } },
        data: { balance: 0 },
      });

      await tournaments.rebuyEntry(user.id, tournament.id);
      await prisma.tournamentEntry.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: user.id } },
        data: { balance: 0 },
      });

      await expect(tournaments.rebuyEntry(user.id, tournament.id)).rejects.toThrow();
    });

    it('refuses a rebuy when the tournament does not offer one', async () => {
      const tournament = await makeTournament({ rebuyEnabled: false });
      const user = await makeUser();
      await tournaments.joinTournament(user.id, tournament.id);
      await prisma.tournamentEntry.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: user.id } },
        data: { balance: 0 },
      });
      await expect(tournaments.rebuyEntry(user.id, tournament.id)).rejects.toThrow();
    });
  });

  describe('market scoping', () => {
    it('refuses a stake on a market outside the tournament\'s own list', async () => {
      const allowed = await makeAsset();
      const disallowed = await makeAsset();
      const tournament = await makeTournament({ allowedAssetIds: [allowed.id] });
      const user = await makeUser();
      await prisma.tournamentEntry.create({
        data: { tournamentId: tournament.id, userId: user.id, balance: 100_000, startingBalance: 100_000 },
      });

      await expect(
        trading.placeTrade({
          userId: user.id,
          symbol: disallowed.symbol,
          accountType: 'TOURNAMENT',
          tournamentId: tournament.id,
          direction: 'UP',
          stake: 1_000,
          durationSec: 60,
        }),
      ).rejects.toThrow();

      const trade = await trading.placeTrade({
        userId: user.id,
        symbol: allowed.symbol,
        accountType: 'TOURNAMENT',
        tournamentId: tournament.id,
        direction: 'UP',
        stake: 1_000,
        durationSec: 60,
      });
      expect(trade.symbol).toBe(allowed.symbol);
    });

    it('offers every market when the tournament sets no list at all', async () => {
      const asset = await makeAsset();
      const tournament = await makeTournament({ allowedAssetIds: undefined });
      const user = await makeUser();
      await prisma.tournamentEntry.create({
        data: { tournamentId: tournament.id, userId: user.id, balance: 100_000, startingBalance: 100_000 },
      });
      const trade = await trading.placeTrade({
        userId: user.id,
        symbol: asset.symbol,
        accountType: 'TOURNAMENT',
        tournamentId: tournament.id,
        direction: 'UP',
        stake: 1_000,
        durationSec: 60,
      });
      expect(trade.symbol).toBe(asset.symbol);
    });
  });

  describe('cancellation and refunds', () => {
    it('refunds the entry fee and every rebuy, exactly, to each entrant', async () => {
      const tournament = await makeTournament({ entryFee: 500, rebuyEnabled: true, rebuyFee: 200 });
      const userA = await makeUser();
      const userB = await makeUser();
      await tournaments.joinTournament(userA.id, tournament.id);
      await tournaments.joinTournament(userB.id, tournament.id);

      // userA busts and rebuys once, so they are owed entry + rebuy
      await prisma.tournamentEntry.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: userA.id } },
        data: { balance: 0 },
      });
      await tournaments.rebuyEntry(userA.id, tournament.id);

      const beforeA = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
      const beforeB = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });

      const cancelled = await tournaments.cancelTournament(tournament.id);
      expect(cancelled.status).toBe('CANCELLED');

      const afterA = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
      const afterB = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
      expect(afterA.realBalance - beforeA.realBalance).toBe(700); // 500 entry + 200 rebuy
      expect(afterB.realBalance - beforeB.realBalance).toBe(500); // entry only

      // idempotent: cancelling again refunds nothing a second time
      const again = await tournaments.cancelTournament(tournament.id);
      expect(again.status).toBe('CANCELLED');
      const stillA = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
      expect(stillA.realBalance).toBe(afterA.realBalance);
    });

    it('refuses to cancel a tournament that has already finished', async () => {
      const tournament = await makeTournament({ status: 'FINISHED', finishedAt: new Date() });
      await expect(tournaments.cancelTournament(tournament.id)).rejects.toThrow();
    });
  });
});
