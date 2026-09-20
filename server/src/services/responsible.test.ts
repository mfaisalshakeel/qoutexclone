import { describe, expect, it } from 'vitest';
import { isTightening } from './responsible.js';

describe('isTightening', () => {
  it('treats a smaller number as stricter', () => {
    expect(isTightening('dailyLossCents', 10_000, 5_000)).toBe(true);
    expect(isTightening('dailyLossCents', 5_000, 10_000)).toBe(false);
  });

  it('treats no limit as the loosest setting there is', () => {
    // going from no limit to any limit is a tightening
    expect(isTightening('dailyLossCents', 0, 5_000)).toBe(true);
    // and removing a limit is not
    expect(isTightening('dailyLossCents', 5_000, 0)).toBe(false);
  });

  it('is false for no change', () => {
    expect(isTightening('dailyLossCents', 5_000, 5_000)).toBe(false);
    expect(isTightening('dailyLossCents', 0, 0)).toBe(false);
  });
});
