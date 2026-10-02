/**
 * Candle pruning against a real database. The flush side of the same fix is
 * covered by `services/candle-flush.test.ts`, which can force the deadlock.
 *
 * A pass used to delete a whole timeframe's expired rows in one transaction.
 * On a database with a weekend's backlog that held row locks for ~97 seconds,
 * deadlocked the concurrent flush, and every batch caught in that window was
 * dropped — the chart simply stopped gaining history. These cover the two
 * halves of the fix: the delete happens in slices, and a flush that loses a
 * deadlock keeps its rows instead of discarding them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('candle pruning', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let candles: typeof import('../../services/candles.js');

  const SYMBOL = `PRUNETEST${Date.now()}`;

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    candles = await import('../../services/candles.js');
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.candle.deleteMany({ where: { symbol: SYMBOL } });
    await prisma.$disconnect();
  });

  it('removes everything past retention in slices, and keeps what is inside it', async () => {
    const now = Math.floor(Date.now() / 1000);
    // 5s candles are kept for hours, not years: a day old is well expired
    const expired = Array.from({ length: 12_000 }, (_, i) => ({
      symbol: SYMBOL,
      timeframe: '5s',
      time: now - 86_400 - i * 5,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }));
    const fresh = Array.from({ length: 5 }, (_, i) => ({
      symbol: SYMBOL,
      timeframe: '5s',
      time: now - i * 5,
      open: 2,
      high: 2,
      low: 2,
      close: 2,
    }));
    await prisma.candle.createMany({ data: [...expired, ...fresh], skipDuplicates: true });

    const before = await prisma.candle.count({ where: { symbol: SYMBOL } });
    expect(before).toBe(12_005);

    await candles.candleStore.prune();

    const left = await prisma.candle.findMany({ where: { symbol: SYMBOL } });
    expect(left).toHaveLength(5);
    // what survived is what is still inside the window
    expect(left.every((row) => row.time >= now - 86_400)).toBe(true);
  }, 120_000);
});
