import { describe, expect, it } from 'vitest';
import { bonusFor, describe as describePromo } from '../services/promos.js';

const pct = (value: number, maxBonus = 0) => ({ kind: 'DEPOSIT_BONUS_PCT', value, maxBonus });
const fixed = (value: number, maxBonus = 0) => ({ kind: 'FIXED_CREDIT', value, maxBonus });

describe('promo bonuses', () => {
  it('pays a percentage of the deposit, rounded down', () => {
    expect(bonusFor(pct(30), 10000)).toBe(3000);
    expect(bonusFor(pct(33), 999)).toBe(329); // 329.67 -> 329
  });

  it('respects the cap', () => {
    expect(bonusFor(pct(50, 5000), 100000)).toBe(5000);
    expect(bonusFor(pct(50, 5000), 4000)).toBe(2000);
  });

  it('pays a flat credit regardless of deposit size', () => {
    expect(bonusFor(fixed(2500), 10000)).toBe(2500);
    expect(bonusFor(fixed(2500), 100000)).toBe(2500);
  });

  it('never returns a negative or fractional bonus', () => {
    expect(bonusFor(pct(0), 10000)).toBe(0);
    expect(Number.isInteger(bonusFor(pct(17), 12345))).toBe(true);
  });

  it('describes itself for the UI', () => {
    expect(describePromo({ kind: 'DEPOSIT_BONUS_PCT', value: 30, minDeposit: 5000, maxBonus: 10000 })).toBe(
      '30% deposit bonus, min deposit $50.00, up to $100.00',
    );
    expect(describePromo({ kind: 'FIXED_CREDIT', value: 1000, minDeposit: 0, maxBonus: 0 })).toBe('$10.00 credit');
  });
});
