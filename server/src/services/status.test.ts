import { describe, expect, it } from 'vitest';
import { depositBonusFor, levelFor, payoutWithStatus, progressFor, type StatusConfig } from './status.js';

const CONFIG: StatusConfig = {
  enabled: true,
  maxPayoutPct: 95,
  levels: [
    { id: 'STANDARD', name: 'Standard', threshold: 0, payoutBonus: 0, depositBonus: 0, priority: 0 },
    { id: 'PRO', name: 'Pro', threshold: 100_000, payoutBonus: 2, depositBonus: 0, priority: 1 },
    { id: 'VIP', name: 'VIP', threshold: 1_000_000, payoutBonus: 4, depositBonus: 5, priority: 2 },
  ],
};

describe('levelFor', () => {
  it('starts everyone at the bottom', () => {
    expect(levelFor(0, CONFIG).id).toBe('STANDARD');
    expect(levelFor(99_999, CONFIG).id).toBe('STANDARD');
  });

  it('promotes exactly on the threshold, not a cent later', () => {
    expect(levelFor(100_000, CONFIG).id).toBe('PRO');
    expect(levelFor(1_000_000, CONFIG).id).toBe('VIP');
  });

  it('keeps the highest level reached', () => {
    expect(levelFor(5_000_000, CONFIG).id).toBe('VIP');
  });

  it('puts everyone on the first level when the feature is off', () => {
    expect(levelFor(5_000_000, { ...CONFIG, enabled: false }).id).toBe('STANDARD');
  });

  it('survives thresholds an operator set out of order', () => {
    const muddled: StatusConfig = {
      ...CONFIG,
      levels: [
        CONFIG.levels[0],
        { ...CONFIG.levels[1], threshold: 2_000_000 },
        { ...CONFIG.levels[2], threshold: 1_000_000 },
      ],
    };
    // the VIP bar is the lower one here, and meeting it is still VIP
    expect(levelFor(1_500_000, muddled).id).toBe('VIP');
    expect(levelFor(500_000, muddled).id).toBe('STANDARD');
  });
});

describe('progressFor', () => {
  it('measures the way through the current band', () => {
    const half = progressFor(50_000, CONFIG);
    expect(half.level.id).toBe('STANDARD');
    expect(half.next?.id).toBe('PRO');
    expect(half.remaining).toBe(50_000);
    expect(half.percent).toBe(50);
  });

  it('is complete at the top, with nothing left to reach', () => {
    const top = progressFor(2_000_000, CONFIG);
    expect(top.level.id).toBe('VIP');
    expect(top.next).toBeNull();
    expect(top.remaining).toBe(0);
    expect(top.percent).toBe(100);
  });

  it('never reports a negative distance or over 100 per cent', () => {
    const justPromoted = progressFor(100_000, CONFIG);
    expect(justPromoted.level.id).toBe('PRO');
    expect(justPromoted.percent).toBe(0);
    expect(justPromoted.remaining).toBe(900_000);
  });

  it('offers nothing to climb towards while the feature is off', () => {
    expect(progressFor(50_000, { ...CONFIG, enabled: false }).next).toBeNull();
  });
});

describe('payoutWithStatus', () => {
  it('adds the level bonus in percentage points', () => {
    expect(payoutWithStatus(80, CONFIG.levels[1], CONFIG)).toBe(82);
    expect(payoutWithStatus(80, CONFIG.levels[2], CONFIG)).toBe(84);
  });

  it('leaves the bottom level exactly as quoted', () => {
    expect(payoutWithStatus(80, CONFIG.levels[0], CONFIG)).toBe(80);
  });

  it('never lifts a payout past the ceiling', () => {
    expect(payoutWithStatus(93, CONFIG.levels[2], CONFIG)).toBe(95);
    expect(payoutWithStatus(96, CONFIG.levels[2], CONFIG)).toBe(95);
  });

  it('does nothing at all while the feature is off', () => {
    expect(payoutWithStatus(80, CONFIG.levels[2], { ...CONFIG, enabled: false })).toBe(80);
  });
});

describe('depositBonusFor', () => {
  it('is a percentage of the deposit, in whole cents', () => {
    expect(depositBonusFor(25_000, CONFIG.levels[2], CONFIG)).toBe(1_250);
  });

  it('rounds down, so a bonus is never more generous than it says', () => {
    expect(depositBonusFor(101, CONFIG.levels[2], CONFIG)).toBe(5);
  });

  it('is nothing without a bonus, without money, or with the feature off', () => {
    expect(depositBonusFor(25_000, CONFIG.levels[1], CONFIG)).toBe(0);
    expect(depositBonusFor(0, CONFIG.levels[2], CONFIG)).toBe(0);
    expect(depositBonusFor(25_000, CONFIG.levels[2], { ...CONFIG, enabled: false })).toBe(0);
  });
});
