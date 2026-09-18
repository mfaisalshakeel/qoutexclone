import { describe, expect, it } from 'vitest';
import { accountOptions, refillState, stillPlayable } from './accounts';
import type { Tournament } from './types';

const now = new Date('2026-09-18T12:00:00.000Z').getTime();

function tournament(over: Partial<Tournament> & { id: string }): Tournament {
  return {
    name: `Cup ${over.id}`,
    description: null,
    status: 'RUNNING',
    entryFee: 0,
    prizePool: 10_000,
    startingBalance: 100_000,
    maxEntries: 100,
    prizeSplit: [50, 30, 20],
    startsAt: '2026-09-18T11:00:00.000Z',
    endsAt: '2026-09-18T13:00:00.000Z',
    entrants: 4,
    joined: true,
    myBalance: 120_000,
    myRank: 2,
    myPrize: 0,
    ...over,
  };
}

describe('the accounts a trader can stake from', () => {
  it('always offers live and practice, in that order', () => {
    const options = accountOptions({ demoBalance: 1_000, realBalance: 2_000, tournaments: [], now });
    expect(options.map((option) => option.kind)).toEqual(['REAL', 'DEMO']);
    expect(options[0].balance).toBe(2_000);
    expect(options[1].balance).toBe(1_000);
    expect(options.every((option) => option.chips)).toBe(false);
  });

  it('adds a set of chips for each tournament joined', () => {
    const options = accountOptions({
      demoBalance: 0,
      realBalance: 0,
      tournaments: [
        tournament({ id: 'a', name: 'Late Cup', startsAt: '2026-09-18T11:30:00.000Z' }),
        tournament({ id: 'b', name: 'Early Cup', startsAt: '2026-09-18T10:00:00.000Z' }),
      ],
      now,
    });
    expect(options.map((option) => option.label)).toEqual([
      'Live account',
      'Practice account',
      'Early Cup',
      'Late Cup',
    ]);
    // chips are chips, never dollars
    expect(options[2].chips).toBe(true);
    expect(options[2].balance).toBe(120_000);
  });

  it('leaves out tournaments the trader never joined, and finished ones', () => {
    const options = accountOptions({
      demoBalance: 0,
      realBalance: 0,
      tournaments: [
        tournament({ id: 'a', joined: false }),
        tournament({ id: 'b', status: 'FINISHED' }),
        tournament({ id: 'c', status: 'CANCELLED' }),
      ],
      now,
    });
    expect(options).toHaveLength(2);
  });

  it('lists a tournament that has not started, but will not stake from it', () => {
    const [, , scheduled] = accountOptions({
      demoBalance: 0,
      realBalance: 0,
      tournaments: [
        tournament({
          id: 'a',
          status: 'SCHEDULED',
          startsAt: '2026-09-18T14:00:00.000Z',
          endsAt: '2026-09-18T16:00:00.000Z',
        }),
      ],
      now,
    });
    expect(scheduled.selectable).toBe(false);
    expect(scheduled.note).toBe('Not started yet');
  });

  it('will not stake from a tournament whose clock has already run out', () => {
    const [, , stale] = accountOptions({
      demoBalance: 0,
      realBalance: 0,
      tournaments: [tournament({ id: 'a', endsAt: '2026-09-18T11:59:00.000Z' })],
      now,
    });
    expect(stale.selectable).toBe(false);
  });

  it('knows when a stored tournament selection is no longer an account', () => {
    const options = accountOptions({
      demoBalance: 0,
      realBalance: 0,
      tournaments: [tournament({ id: 'a' })],
      now,
    });
    expect(stillPlayable(options, 'a')).toBe(true);
    expect(stillPlayable(options, 'gone')).toBe(false);
    // no selection is always fine
    expect(stillPlayable(options, null)).toBe(true);
  });
});

describe('topping up the practice balance', () => {
  it('is always on offer when an operator has set no threshold', () => {
    expect(refillState(9_999_999, { startBalance: 1_000_000, refillBelow: 0 })).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it('waits until the balance has actually run down', () => {
    const config = { startBalance: 1_000_000, refillBelow: 100_000 };
    expect(refillState(99_999, config).allowed).toBe(true);
    expect(refillState(100_000, config).allowed).toBe(false);
    // and says what it is waiting for, in money rather than cents
    expect(refillState(500_000, config).reason).toBe('Available below $1,000.00');
  });
});
