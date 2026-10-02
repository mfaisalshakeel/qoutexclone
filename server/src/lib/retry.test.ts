/**
 * Which failures count as "the transaction rolled back, ask again".
 *
 * The shapes differ by server and by how the query was issued, and getting one
 * of them wrong is not cosmetic: an unrecognised conflict is never retried and
 * reaches the trader as a raw 500 instead of a clean 409. MariaDB's 1020 was
 * exactly that case — it arrives as an *unknown* request error with no code at
 * all, so only the text identifies it.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { isConflict, retryOnConflict } from './retry.js';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('write failed', { code, clientVersion: '5.22.0', meta });

const unknown = (message: string) =>
  new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: '5.22.0' });

describe('isConflict', () => {
  it('accepts Prisma’s own write conflict', () => {
    expect(isConflict(known('P2034'))).toBe(true);
  });

  it('accepts a raw query that lost a deadlock or a lock wait', () => {
    expect(isConflict(known('P2010', { code: '1213' }))).toBe(true);
    expect(isConflict(known('P2010', { code: '1205' }))).toBe(true);
  });

  it('accepts MariaDB’s 1020, which arrives with no code at all', () => {
    expect(
      isConflict(
        unknown(
          'Error occurred during query execution:\nConnectorError(ConnectorError { kind: QueryError(Server(MysqlError { code: 1020, message: "Record has changed since last read in table \'trade\'", state: "HY000" })) })',
        ),
      ),
    ).toBe(true);
  });

  it('accepts a deadlock reported without a code', () => {
    expect(isConflict(unknown('Deadlock found when trying to get lock; try restarting transaction'))).toBe(
      true,
    );
  });

  it('rejects everything that is not a lost race', () => {
    expect(isConflict(known('P2002'))).toBe(false);
    expect(isConflict(known('P2010', { code: '1062' }))).toBe(false);
    expect(isConflict(unknown('Unknown column `foo` in field list'))).toBe(false);
    expect(isConflict(new Error('socket hang up'))).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
});

describe('retryOnConflict', () => {
  it('asks again after a conflict and returns the later answer', async () => {
    const write = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(known('P2034'))
      .mockResolvedValueOnce('placed');

    await expect(retryOnConflict(write, { waitMs: () => 0 })).resolves.toBe('placed');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('gives up after its attempts and throws the conflict for the caller to shape', async () => {
    const write = vi.fn<[], Promise<string>>().mockRejectedValue(known('P2034'));

    await expect(retryOnConflict(write, { attempts: 3, waitMs: () => 0 })).rejects.toSatisfy(isConflict);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('never retries an error that is not a conflict', async () => {
    const write = vi.fn<[], Promise<string>>().mockRejectedValue(known('P2002'));

    await expect(retryOnConflict(write, { waitMs: () => 0 })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(write).toHaveBeenCalledTimes(1);
  });
});
