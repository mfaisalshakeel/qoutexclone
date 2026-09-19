import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { isConflict, retryOnConflict } from '../lib/retry.js';

const conflict = () =>
  new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });

describe('retrying a write that lost its race', () => {
  it('returns the first success without waiting', async () => {
    let calls = 0;
    const result = await retryOnConflict(async () => {
      calls += 1;
      return 'done';
    });
    expect(result).toBe('done');
    expect(calls).toBe(1);
  });

  it('asks again after a write conflict, and succeeds', async () => {
    let calls = 0;
    const result = await retryOnConflict(
      async () => {
        calls += 1;
        if (calls < 3) throw conflict();
        return calls;
      },
      { waitMs: () => 0 },
    );
    expect(result).toBe(3);
  });

  it('gives up rather than retrying for ever', async () => {
    let calls = 0;
    await expect(
      retryOnConflict(
        async () => {
          calls += 1;
          throw conflict();
        },
        { attempts: 3, waitMs: () => 0 },
      ),
    ).rejects.toThrow(/write conflict/);
    expect(calls).toBe(3);
  });

  it('never retries a failure that is not a race', async () => {
    let calls = 0;
    await expect(
      retryOnConflict(
        async () => {
          calls += 1;
          throw new Error('not enough balance');
        },
        { waitMs: () => 0 },
      ),
    ).rejects.toThrow('not enough balance');
    // a refusal is a refusal: asking again would be asking for a double spend
    expect(calls).toBe(1);
  });

  it('recognises only Prisma’s write-conflict code', () => {
    expect(isConflict(conflict())).toBe(true);
    expect(
      isConflict(new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'test' })),
    ).toBe(false);
    expect(isConflict(new Error('boom'))).toBe(false);
  });
});
