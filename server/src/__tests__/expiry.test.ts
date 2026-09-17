import { describe, expect, it } from 'vitest';
import {
  clockSlots,
  nextBoundary,
  onBoundary,
  validateAgainstClose,
  validateClockExpiry,
  validateDuration,
  type ClockConfig,
} from '../engine/expiry.js';

const config = (over: Partial<ClockConfig> = {}): ClockConfig => ({
  steps: [60, 300, 900, 1800, 3600],
  cutoffSec: 30,
  horizonSec: 4 * 3600,
  ...over,
});

/** 2026-09-17T12:03:10Z, deliberately off every boundary. */
const NOW = Date.parse('2026-09-17T12:03:10Z');
const at = (iso: string) => Date.parse(iso);

describe('boundaries', () => {
  it('finds the next one strictly after the instant given', () => {
    expect(nextBoundary(NOW, 60)).toBe(at('2026-09-17T12:04:00Z'));
    expect(nextBoundary(NOW, 300)).toBe(at('2026-09-17T12:05:00Z'));
    expect(nextBoundary(NOW, 3600)).toBe(at('2026-09-17T13:00:00Z'));
  });

  it('moves on when it is already exactly on one', () => {
    const noon = at('2026-09-17T12:00:00Z');
    expect(nextBoundary(noon, 3600)).toBe(at('2026-09-17T13:00:00Z'));
  });

  it('recognises an instant sitting on a boundary', () => {
    expect(onBoundary(at('2026-09-17T12:05:00Z'), 300)).toBe(true);
    expect(onBoundary(at('2026-09-17T12:05:00Z'), 900)).toBe(false);
    expect(onBoundary(at('2026-09-17T12:05:30Z'), 300)).toBe(false);
  });
});

describe('buyable clock slots', () => {
  it('offers the next boundary of every step, soonest first', () => {
    const slots = clockSlots(NOW, config());
    expect(slots.map((slot) => new Date(slot.expiresAt).toISOString())).toEqual([
      '2026-09-17T12:04:00.000Z',
      '2026-09-17T12:05:00.000Z',
      '2026-09-17T12:15:00.000Z',
      '2026-09-17T12:30:00.000Z',
      '2026-09-17T13:00:00.000Z',
    ]);
    for (let index = 1; index < slots.length; index += 1) {
      expect(slots[index].expiresAt).toBeGreaterThan(slots[index - 1].expiresAt);
    }
  });

  it('skips a boundary that is already inside its cut-off', () => {
    // 12:04:45 is fifteen seconds from the 12:05 boundary, under a 30s cut-off
    const slots = clockSlots(at('2026-09-17T12:04:45Z'), config({ steps: [300] }));
    expect(new Date(slots[0].expiresAt).toISOString()).toBe('2026-09-17T12:10:00.000Z');
  });

  it('counts down to the moment a slot stops accepting positions', () => {
    const slots = clockSlots(NOW, config({ steps: [60] }));
    // 12:04:00 closes at 12:03:30, twenty seconds after 12:03:10
    expect(slots[0].secondsToClose).toBe(20);
    expect(new Date(slots[0].closesAt).toISOString()).toBe('2026-09-17T12:03:30.000Z');
    expect(slots[0].durationSec).toBe(50);
  });

  it('collapses one instant shared by several steps, keeping the coarsest', () => {
    // 13:00 is a boundary of 60, 300, 900, 1800 and 3600
    const slots = clockSlots(at('2026-09-17T12:59:00Z'), config({ cutoffSec: 5 }));
    const hour = slots.filter((slot) => slot.expiresAt === at('2026-09-17T13:00:00Z'));
    expect(hour).toHaveLength(1);
    expect(hour[0].stepSec).toBe(3600);
  });

  it('offers nothing past the horizon', () => {
    const slots = clockSlots(NOW, config({ steps: [3600], horizonSec: 60 }));
    expect(slots).toEqual([]);
  });

  it('ignores a nonsense step rather than looping forever', () => {
    const slots = clockSlots(NOW, config({ steps: [0, -60, 300] }));
    expect(slots).toHaveLength(1);
    expect(slots[0].stepSec).toBe(300);
  });

  it('works with no cut-off at all', () => {
    const slots = clockSlots(NOW, config({ steps: [60], cutoffSec: 0 }));
    expect(slots[0].secondsToClose).toBe(50);
    expect(slots[0].closesAt).toBe(slots[0].expiresAt);
  });
});

describe('duration validation', () => {
  it('accepts a duration the market offers and refuses one it does not', () => {
    expect(validateDuration(60, [30, 60, 300])).toBeNull();
    expect(validateDuration(45, [30, 60, 300])?.code).toBe('invalid_duration');
  });
});

describe('clock validation', () => {
  it('accepts a real boundary that is still open', () => {
    expect(validateClockExpiry(NOW, at('2026-09-17T12:05:00Z'), config())).toBeNull();
  });

  it('refuses an instant that is not a boundary', () => {
    expect(validateClockExpiry(NOW, at('2026-09-17T12:04:37Z'), config())?.code).toBe('invalid_expiry');
  });

  it('refuses a boundary inside its cut-off, and says how long the cut-off is', () => {
    const rejection = validateClockExpiry(at('2026-09-17T12:04:45Z'), at('2026-09-17T12:05:00Z'), config());
    expect(rejection?.code).toBe('expiry_closed');
    expect(rejection?.message).toContain('30s');
  });

  it('refuses a boundary in the past', () => {
    expect(validateClockExpiry(NOW, at('2026-09-17T12:00:00Z'), config())?.code).toBe('expiry_closed');
  });

  it('refuses one beyond the horizon', () => {
    const rejection = validateClockExpiry(NOW, at('2026-09-18T12:00:00Z'), config());
    expect(rejection?.code).toBe('invalid_expiry');
    expect(rejection?.message).toContain('further out');
  });

  it('refuses a value that is not a time at all', () => {
    expect(validateClockExpiry(NOW, Number.NaN, config())?.code).toBe('invalid_expiry');
  });

  it('accepts every slot it just offered, which is the contract between the two', () => {
    for (const slot of clockSlots(NOW, config())) {
      expect(validateClockExpiry(NOW, slot.expiresAt, config()), `slot ${slot.expiresAt}`).toBeNull();
    }
  });
});

describe('session close', () => {
  it('refuses an expiry after the market closes', () => {
    const close = at('2026-09-17T21:00:00Z');
    expect(validateAgainstClose(at('2026-09-17T20:59:00Z'), close)).toBeNull();
    expect(validateAgainstClose(at('2026-09-17T21:00:00Z'), close)).toBeNull();
    const rejection = validateAgainstClose(at('2026-09-17T21:00:01Z'), close);
    expect(rejection?.code).toBe('expiry_past_close');
    expect(rejection?.message).toContain('OTC');
  });

  it('allows anything on a market that never closes', () => {
    expect(validateAgainstClose(at('2030-01-01T00:00:00Z'), null)).toBeNull();
  });
});
