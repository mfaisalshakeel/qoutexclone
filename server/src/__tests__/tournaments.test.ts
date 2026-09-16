import { describe, expect, it } from 'vitest';
import { parseSplit, prizesFor } from '../services/tournaments.js';

describe('prize splits', () => {
  it('parses a percentage list', () => {
    expect(parseSplit('50,30,20')).toEqual([50, 30, 20]);
    expect(parseSplit(' 60 , 40 ')).toEqual([60, 40]);
  });

  it('falls back to winner-takes-all on nonsense', () => {
    expect(parseSplit('')).toEqual([100]);
    expect(parseSplit('abc')).toEqual([100]);
    expect(parseSplit('0,0')).toEqual([100]);
  });

  it('pays out the pool exactly, remainder to first place', () => {
    const prizes = prizesFor(10000, '50,30,20', 3);
    expect(prizes).toEqual([5000, 3000, 2000]);
    expect(prizes.reduce((a, b) => a + b, 0)).toBe(10000);

    // 10001 cents cannot split evenly; nothing may be lost
    const odd = prizesFor(10001, '50,30,20', 3);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(10001);
    expect(odd[0]).toBeGreaterThan(odd[1]);
  });

  it('never pays more places than there are entrants', () => {
    const prizes = prizesFor(10000, '50,30,20', 2);
    expect(prizes).toHaveLength(2);
    expect(prizes.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('normalises splits that do not add up to 100', () => {
    const prizes = prizesFor(9000, '2,1', 2);
    expect(prizes).toEqual([6000, 3000]);
  });

  it('pays nothing from an empty pool or with no entrants', () => {
    expect(prizesFor(0, '50,50', 5)).toEqual([]);
    expect(prizesFor(5000, '50,50', 0)).toEqual([]);
  });
});
