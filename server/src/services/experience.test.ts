import { describe, expect, it } from 'vitest';
import { dayKey, levelForXp, levelProgress, xpForLevel, xpForTrade, type XpConfig } from './experience.js';

const CONFIG: XpConfig = {
  enabled: true,
  perDollarStaked: 1,
  perWin: 5,
  dailyBonus: 25,
  fromPractice: false,
  levelBase: 100,
  levelCurve: 1.6,
};

describe('xpForLevel', () => {
  it('starts everyone at level 1 with nothing earned', () => {
    expect(xpForLevel(1, CONFIG)).toBe(0);
    expect(xpForLevel(0, CONFIG)).toBe(0);
  });

  it('charges the configured amount for the second level', () => {
    expect(xpForLevel(2, CONFIG)).toBe(100);
  });

  it('makes each level cost more than the last', () => {
    const steps = [2, 3, 4, 5, 6].map((level) => xpForLevel(level, CONFIG) - xpForLevel(level - 1, CONFIG));
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeGreaterThan(steps[index - 1]);
    }
  });

  it('is a flat ladder at a curve of 1', () => {
    const flat = { ...CONFIG, levelCurve: 1 };
    expect(xpForLevel(2, flat)).toBe(100);
    expect(xpForLevel(5, flat)).toBe(400);
  });
});

describe('levelForXp', () => {
  it('never goes below level 1', () => {
    expect(levelForXp(0, CONFIG)).toBe(1);
    expect(levelForXp(99, CONFIG)).toBe(1);
  });

  it('promotes exactly on the threshold', () => {
    expect(levelForXp(100, CONFIG)).toBe(2);
    expect(levelForXp(xpForLevel(7, CONFIG), CONFIG)).toBe(7);
    expect(levelForXp(xpForLevel(7, CONFIG) - 1, CONFIG)).toBe(6);
  });

  it('agrees with the ladder it is derived from, all the way up', () => {
    for (let level = 1; level <= 40; level += 1) {
      expect(levelForXp(xpForLevel(level, CONFIG), CONFIG)).toBe(level);
    }
  });
});

describe('levelProgress', () => {
  it('reads zero the moment a level is reached', () => {
    const fresh = levelProgress(100, CONFIG);
    expect(fresh.level).toBe(2);
    expect(fresh.percent).toBe(0);
    expect(fresh.remaining).toBe(xpForLevel(3, CONFIG) - 100);
  });

  it('measures the way through the current level', () => {
    const floor = xpForLevel(3, CONFIG);
    const ceiling = xpForLevel(4, CONFIG);
    const half = levelProgress(Math.round((floor + ceiling) / 2), CONFIG);
    expect(half.level).toBe(3);
    expect(half.percent).toBeGreaterThanOrEqual(49);
    expect(half.percent).toBeLessThanOrEqual(51);
  });
});

describe('xpForTrade', () => {
  const live = { accountType: 'REAL', stake: 10_000, status: 'LOST' };

  it('pays for the volume staked', () => {
    expect(xpForTrade(live, CONFIG)).toBe(100);
  });

  it('adds a bonus for a win', () => {
    expect(xpForTrade({ ...live, status: 'WON' }, CONFIG)).toBe(105);
  });

  it('adds the daily bonus once', () => {
    expect(xpForTrade(live, CONFIG, { firstToday: true })).toBe(125);
  });

  it('pays nothing for practice unless an operator allows it', () => {
    const practice = { ...live, accountType: 'DEMO' };
    expect(xpForTrade(practice, CONFIG)).toBe(0);
    expect(xpForTrade(practice, { ...CONFIG, fromPractice: true })).toBe(100);
  });

  it('pays for tournament positions, which cost a real entry', () => {
    expect(xpForTrade({ ...live, accountType: 'TOURNAMENT' }, CONFIG)).toBe(100);
  });

  it('pays nothing while the feature is off, or for a position still open', () => {
    expect(xpForTrade(live, { ...CONFIG, enabled: false })).toBe(0);
    expect(xpForTrade({ ...live, status: 'OPEN' }, CONFIG)).toBe(0);
  });

  it('rounds the volume down, so a stake never earns more than it is worth', () => {
    expect(xpForTrade({ ...live, stake: 199 }, CONFIG)).toBe(1);
  });
});

describe('dayKey', () => {
  it('is the UTC calendar day', () => {
    expect(dayKey(Date.UTC(2026, 8, 20, 23, 59))).toBe('2026-09-20');
    expect(dayKey(Date.UTC(2026, 8, 21, 0, 1))).toBe('2026-09-21');
  });
});
