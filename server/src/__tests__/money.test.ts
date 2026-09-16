import { describe, expect, it } from 'vitest';
import { centsToCrypto, cryptoToCents, formatUsd, usdToCents, winProfit } from '../lib/money.js';

describe('money', () => {
  it('converts dollars to cents without float drift', () => {
    expect(usdToCents(10.1)).toBe(1010);
    expect(usdToCents(0.07)).toBe(7);
    expect(usdToCents(1234.565)).toBe(123457);
  });

  it('pays the advertised percentage, rounded down to the cent', () => {
    expect(winProfit(1000, 85)).toBe(850);
    expect(winProfit(333, 87)).toBe(289); // 289.71 -> 289, never over-pays
    expect(winProfit(0, 90)).toBe(0);
  });

  it('truncates crypto amounts to the network precision', () => {
    expect(centsToCrypto(10000, 50000, 8)).toBe('0.00200000');
    expect(centsToCrypto(25000, 1, 6)).toBe('250.000000');
    // truncation, never rounding up beyond what the user is owed
    expect(centsToCrypto(100, 3, 8)).toBe('0.33333333');
  });

  it('round-trips crypto back into cents', () => {
    const cents = 123456;
    const rate = 64250;
    expect(cryptoToCents(centsToCrypto(cents, rate, 8), rate)).toBeCloseTo(cents, 0);
  });

  it('rejects an unusable rate or amount', () => {
    expect(() => centsToCrypto(100, 0)).toThrow();
    expect(() => cryptoToCents('-1', 100)).toThrow();
    expect(() => cryptoToCents('abc', 100)).toThrow();
  });

  it('formats balances for display', () => {
    expect(formatUsd(1000000)).toBe('10000.00');
    expect(formatUsd(-2550)).toBe('-25.50');
  });
});
