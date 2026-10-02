/**
 * What a flush does when the database refuses the write.
 *
 * A deadlock here is the database asking for the write again — it used to be
 * treated as a lost batch, and the rows were dropped. On a real database that
 * happened 11 times in two minutes while pruning held the table, and every one
 * of those batches was history the chart never got back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { CandleStore } from './candles.js';

const deadlock = () =>
  Object.assign(
    new Error('Raw query failed. Code: `1213`. Message: `Deadlock found when trying to get lock`'),
    {
      code: 'P2010',
    },
  );

const candle = (time: number) => ({ time, open: 1, high: 2, low: 0.5, close: 1.5 });

describe('candle flush', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries a deadlock and keeps the batch', async () => {
    const store = new CandleStore();
    store.record('BTCUSDT', '1m', candle(1_700_000_000));

    const write = vi
      .spyOn(prisma, '$executeRawUnsafe')
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce(1 as never);

    expect(await store.flush()).toBe(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.pendingCount()).toBe(0);
  });

  it('gives the rows back to the queue when every attempt deadlocks', async () => {
    const store = new CandleStore();
    store.record('BTCUSDT', '1m', candle(1_700_000_060));
    store.record('ETHUSDT', '1m', candle(1_700_000_060));

    vi.spyOn(prisma, '$executeRawUnsafe').mockRejectedValue(deadlock());

    expect(await store.flush()).toBe(0);
    // both rows are waiting for the next flush rather than gone
    expect(store.pendingCount()).toBe(2);
  });

  it('does not retry an error that is not a deadlock', async () => {
    const store = new CandleStore();
    store.record('BTCUSDT', '1m', candle(1_700_000_120));

    const write = vi.spyOn(prisma, '$executeRawUnsafe').mockRejectedValue(new Error('unknown column'));

    expect(await store.flush()).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.pendingCount()).toBe(1);
  });

  it('a newer version of a bucket survives a failed flush of the older one', async () => {
    const store = new CandleStore();
    store.record('BTCUSDT', '1m', candle(1_700_000_180));

    vi.spyOn(prisma, '$executeRawUnsafe').mockImplementation((() => {
      // the bucket ticks again while the write is in flight
      store.record('BTCUSDT', '1m', { time: 1_700_000_180, open: 1, high: 9, low: 0.5, close: 9 });
      return Promise.reject(deadlock());
    }) as typeof prisma.$executeRawUnsafe);

    await store.flush();
    expect(store.pendingCount()).toBe(1);
    // the requeue must not overwrite the fresher candle with the stale one
    const [queued] = store.pendingRows();
    expect(queued.candle.close).toBe(9);
  });
});
