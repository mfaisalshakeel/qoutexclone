import { describe, expect, it } from 'vitest';
import { quoteOffer } from './bonuses.js';

const OFFER = { percent: 30, maxBonusCents: 30_000, minDepositCents: 5_000 };

describe('quoteOffer', () => {
  it('is a percentage of the deposit', () => {
    expect(quoteOffer(OFFER, 10_000)).toEqual({ bonus: 3_000, eligible: true });
  });

  it('rounds down, so a bonus is never more generous than it says', () => {
    expect(quoteOffer({ ...OFFER, percent: 33 }, 10_001).bonus).toBe(3_300);
  });

  it('stops at the cap', () => {
    expect(quoteOffer(OFFER, 1_000_000).bonus).toBe(30_000);
  });

  it('refuses a deposit below the minimum, and says what the minimum is', () => {
    const small = quoteOffer(OFFER, 1_000);
    expect(small.eligible).toBe(false);
    expect(small.bonus).toBe(0);
    expect(small.reason).toContain('$50.00');
  });

  it('applies exactly on the minimum', () => {
    expect(quoteOffer(OFFER, 5_000).eligible).toBe(true);
  });

  it('is not eligible when the percentage rounds to nothing', () => {
    expect(quoteOffer({ percent: 1, maxBonusCents: 100_000, minDepositCents: 0 }, 50).eligible).toBe(false);
  });
});
