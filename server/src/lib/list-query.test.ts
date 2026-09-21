import { describe, expect, it } from 'vitest';
import {
  buildFilterWhere,
  buildOrderBy,
  buildSearchWhere,
  combineWhere,
  listQuerySchema,
} from './list-query.js';

describe('listQuerySchema', () => {
  it('defaults page, pageSize and leaves sort/search unset', () => {
    const parsed = listQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, pageSize: 25 });
  });

  it('coerces string query values to numbers', () => {
    const parsed = listQuerySchema.parse({ page: '3', pageSize: '10' });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(10);
  });

  it('caps pageSize at 200', () => {
    expect(() => listQuerySchema.parse({ pageSize: '500' })).toThrow();
  });

  it('refuses a page below 1', () => {
    expect(() => listQuerySchema.parse({ page: '0' })).toThrow();
  });
});

describe('buildOrderBy', () => {
  it('falls back to the caller-provided default when sort is missing', () => {
    expect(buildOrderBy(undefined, ['email'], { createdAt: 'desc' })).toEqual([{ createdAt: 'desc' }]);
  });

  it('parses a leading "-" as descending', () => {
    expect(buildOrderBy('-createdAt', ['createdAt'], { createdAt: 'desc' })).toEqual([{ createdAt: 'desc' }]);
    expect(buildOrderBy('createdAt', ['createdAt'], { createdAt: 'desc' })).toEqual([{ createdAt: 'asc' }]);
  });

  it('applies multiple comma-separated columns in order', () => {
    expect(buildOrderBy('-totalDeposited,email', ['totalDeposited', 'email'], { createdAt: 'desc' })).toEqual([
      { totalDeposited: 'desc' },
      { email: 'asc' },
    ]);
  });

  it('refuses a column that was not offered', () => {
    expect(() => buildOrderBy('password', ['email'], { createdAt: 'desc' })).toThrow(/Cannot sort/);
  });
});

describe('buildSearchWhere', () => {
  it('returns undefined when there is nothing to search', () => {
    expect(buildSearchWhere(undefined, ['email'])).toBeUndefined();
    expect(buildSearchWhere('', ['email'])).toBeUndefined();
    expect(buildSearchWhere('term', [])).toBeUndefined();
  });

  it('ORs the term across every configured field', () => {
    expect(buildSearchWhere('alice', ['email', 'name'])).toEqual({
      OR: [{ email: { contains: 'alice' } }, { name: { contains: 'alice' } }],
    });
  });
});

describe('buildFilterWhere', () => {
  const specs = {
    status: { type: 'enum', values: ['ACTIVE', 'SUSPENDED'] },
    createdAt: { type: 'dateRange' },
    stake: { type: 'numberRange' },
    verified: { type: 'boolean' },
  } as const;

  it('ignores a filter that was not passed', () => {
    expect(buildFilterWhere(specs, {})).toEqual({});
  });

  it('builds an exact match for a single enum value', () => {
    expect(buildFilterWhere(specs, { status: 'ACTIVE' })).toEqual({ status: 'ACTIVE' });
  });

  it('builds an "in" clause for multiple comma-separated enum values', () => {
    expect(buildFilterWhere(specs, { status: 'ACTIVE,SUSPENDED' })).toEqual({
      status: { in: ['ACTIVE', 'SUSPENDED'] },
    });
  });

  it('refuses a value the enum does not list', () => {
    expect(() => buildFilterWhere(specs, { status: 'DELETED' })).toThrow(/Invalid value/);
  });

  it('parses a date range with both ends', () => {
    const result = buildFilterWhere(specs, { createdAt: '2026-01-01..2026-02-01' });
    expect(result.createdAt).toEqual({ gte: new Date('2026-01-01'), lte: new Date('2026-02-01') });
  });

  it('accepts a date range with only one end', () => {
    expect(buildFilterWhere(specs, { createdAt: '2026-01-01..' })).toEqual({
      createdAt: { gte: new Date('2026-01-01') },
    });
    expect(buildFilterWhere(specs, { createdAt: '..2026-02-01' })).toEqual({
      createdAt: { lte: new Date('2026-02-01') },
    });
  });

  it('refuses an unparsable date', () => {
    expect(() => buildFilterWhere(specs, { createdAt: 'not-a-date..' })).toThrow(/Invalid value/);
  });

  it('parses a number range', () => {
    expect(buildFilterWhere(specs, { stake: '100..500' })).toEqual({ stake: { gte: 100, lte: 500 } });
  });

  it('parses a boolean filter and refuses a non-boolean value', () => {
    expect(buildFilterWhere(specs, { verified: 'true' })).toEqual({ verified: true });
    expect(buildFilterWhere(specs, { verified: 'false' })).toEqual({ verified: false });
    expect(() => buildFilterWhere(specs, { verified: 'yes' })).toThrow(/must be true or false/);
  });

  it('combines several filters at once', () => {
    expect(buildFilterWhere(specs, { status: 'ACTIVE', verified: 'true' })).toEqual({
      status: 'ACTIVE',
      verified: true,
    });
  });
});

describe('combineWhere', () => {
  it('returns an empty object when nothing is given', () => {
    expect(combineWhere(undefined, {})).toEqual({});
  });

  it('returns the single clause unwrapped rather than a redundant AND', () => {
    expect(combineWhere({ status: 'ACTIVE' }, undefined, {})).toEqual({ status: 'ACTIVE' });
  });

  it('ANDs multiple non-empty clauses', () => {
    expect(combineWhere({ status: 'ACTIVE' }, { OR: [{ email: { contains: 'a' } }] })).toEqual({
      AND: [{ status: 'ACTIVE' }, { OR: [{ email: { contains: 'a' } }] }],
    });
  });
});
