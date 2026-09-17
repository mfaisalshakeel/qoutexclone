import { describe, expect, it } from 'vitest';
import { resolveOutcome } from '../services/trading.js';

const base = { stake: 5000, payoutPct: 85 };

describe('binary option settlement', () => {
  it('pays a CALL that finishes above the strike', () => {
    const out = resolveOutcome({ ...base, direction: 'UP', entryPrice: 100, exitPrice: 100.01 });
    expect(out).toEqual({ status: 'WON', profit: 4250, credit: 9250 });
  });

  it('pays a PUT that finishes below the strike', () => {
    const out = resolveOutcome({ ...base, direction: 'DOWN', entryPrice: 100, exitPrice: 99.99 });
    expect(out.status).toBe('WON');
    expect(out.credit).toBe(base.stake + out.profit);
  });

  it('loses the full stake when the direction is wrong', () => {
    expect(resolveOutcome({ ...base, direction: 'UP', entryPrice: 100, exitPrice: 99 })).toEqual({
      status: 'LOST',
      profit: -5000,
      credit: 0,
    });
    expect(resolveOutcome({ ...base, direction: 'DOWN', entryPrice: 100, exitPrice: 101 }).status).toBe(
      'LOST',
    );
  });

  it('refunds the stake when price is unchanged at expiry', () => {
    for (const direction of ['UP', 'DOWN'] as const) {
      expect(resolveOutcome({ ...base, direction, entryPrice: 100, exitPrice: 100 })).toEqual({
        status: 'REFUNDED',
        profit: 0,
        credit: 5000,
      });
    }
  });

  it('never credits more than stake plus the advertised payout', () => {
    const out = resolveOutcome({ stake: 333, payoutPct: 87, direction: 'UP', entryPrice: 1, exitPrice: 2 });
    expect(out.credit).toBeLessThanOrEqual(333 + Math.floor((333 * 87) / 100));
  });
});
