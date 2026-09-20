import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, evaluate, unlockedKeys, type AchievementStats } from './achievements.js';

const NOTHING: AchievementStats = {
  trades: 0,
  wins: 0,
  volume: 0,
  bestStreak: 0,
  netProfit: 0,
  totalDeposited: 0,
  tournaments: 0,
  markets: 0,
  emailVerified: false,
  twoFactor: false,
};

describe('the registry', () => {
  it('has a unique key for every badge', () => {
    const keys = ACHIEVEMENTS.map((achievement) => achievement.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never sets a target of zero, which would unlock on sight', () => {
    for (const achievement of ACHIEVEMENTS) expect(achievement.target).toBeGreaterThan(0);
  });
});

describe('evaluate', () => {
  it('unlocks nothing for a brand new account', () => {
    expect(evaluate(NOTHING).some((achievement) => achievement.unlocked)).toBe(false);
  });

  it('unlocks exactly on the target', () => {
    const one = evaluate({ ...NOTHING, trades: 1 }).find((a) => a.key === 'first-trade')!;
    expect(one.unlocked).toBe(true);
    expect(one.percent).toBe(100);
  });

  it('reports progress towards one that is not reached', () => {
    const halfway = evaluate({ ...NOTHING, trades: 25 }).find((a) => a.key === 'trades-50')!;
    expect(halfway.unlocked).toBe(false);
    expect(halfway.progress).toBe(25);
    expect(halfway.percent).toBe(50);
  });

  it('never reports more than the target, or over 100 per cent', () => {
    const over = evaluate({ ...NOTHING, trades: 5_000 }).find((a) => a.key === 'trades-50')!;
    expect(over.progress).toBe(50);
    expect(over.percent).toBe(100);
  });

  it('treats a loss as no progress towards a profit badge, not negative', () => {
    const losing = evaluate({ ...NOTHING, netProfit: -50_000 }).find((a) => a.key === 'profit-100')!;
    expect(losing.progress).toBe(0);
    expect(losing.percent).toBe(0);
  });

  it('reads the yes-or-no badges', () => {
    const secured = evaluate({ ...NOTHING, emailVerified: true, twoFactor: true });
    expect(secured.find((a) => a.key === 'email-verified')!.unlocked).toBe(true);
    expect(secured.find((a) => a.key === 'two-factor')!.unlocked).toBe(true);
  });

  it('counts money badges in cents', () => {
    const staked = evaluate({ ...NOTHING, volume: 100_000 }).find((a) => a.key === 'volume-1k')!;
    expect(staked.unlocked).toBe(true);
  });
});

describe('unlockedKeys', () => {
  it('lists only what has been earned', () => {
    expect(unlockedKeys(NOTHING)).toEqual([]);
    expect(unlockedKeys({ ...NOTHING, trades: 1, totalDeposited: 5_000 })).toEqual([
      'first-trade',
      'deposit-first',
    ]);
  });
});
