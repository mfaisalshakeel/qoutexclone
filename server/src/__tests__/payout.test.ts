import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inMinuteWindow,
  resolvePayout,
  ruleFires,
  scopeMatches,
  type PayoutInput,
  type PayoutRule,
} from '../engine/payout.js';
import { RULE_CONFIG_SCHEMAS, parseRuleConfig } from '../services/payouts.js';

const market = { id: 'a1', assetClass: 'CURRENCY', payoutPct: 85, volatility: 0.0004 };

function rule(over: Partial<PayoutRule> = {}): PayoutRule {
  return {
    id: over.id ?? 'r1',
    name: 'rule',
    kind: 'TIME_OF_DAY',
    assetId: null,
    assetClass: null,
    adjustment: -5,
    config: { fromMinute: 0, toMinute: 1440 },
    priority: 0,
    exclusive: false,
    enabled: true,
    ...over,
  };
}

function input(over: Partial<PayoutInput> = {}): PayoutInput {
  return {
    market,
    rules: [],
    at: new Date('2026-09-17T12:00:00Z'),
    minPct: 20,
    maxPct: 95,
    ...over,
  };
}

describe('payout engine purity', () => {
  it('cannot read a trader, a position or the house exposure', () => {
    // the same hard rule the price engine lives under, enforced structurally
    const source = fs.readFileSync(path.join(process.cwd(), 'src/engine/payout.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bimport\b/);
    for (const forbidden of ['prisma', 'trade', 'position', 'exposure', 'userId', 'balance']) {
      expect(code.toLowerCase(), `mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('ignores anything that looks like trading state', () => {
    const clean = resolvePayout(input({ rules: [rule({ adjustment: -7 })] }));
    const smuggled = resolvePayout({
      ...input({ rules: [rule({ adjustment: -7 })] }),
      // fields the engine has no business reading
      ...({ openPositions: 500, exposure: 9_000_000, userId: 'u1', winRate: 0.9 } as object),
    } as PayoutInput);
    expect(smuggled).toEqual(clean);
  });
});

describe('payout scope', () => {
  it('covers every market when unscoped', () => {
    expect(scopeMatches(rule(), market)).toBe(true);
  });

  it('matches one market by id', () => {
    expect(scopeMatches(rule({ assetId: 'a1' }), market)).toBe(true);
    expect(scopeMatches(rule({ assetId: 'other' }), market)).toBe(false);
  });

  it('matches a whole class, and the market id wins over it', () => {
    expect(scopeMatches(rule({ assetClass: 'CURRENCY' }), market)).toBe(true);
    expect(scopeMatches(rule({ assetClass: 'CRYPTO' }), market)).toBe(false);
    expect(scopeMatches(rule({ assetId: 'a1', assetClass: 'CRYPTO' }), market)).toBe(true);
  });
});

describe('time windows', () => {
  it('treats a window as half-open', () => {
    expect(inMinuteWindow(540, 540, 600)).toBe(true);
    expect(inMinuteWindow(600, 540, 600)).toBe(false);
  });

  it('handles a window that runs past midnight', () => {
    // the Asian session, 22:00 to 06:00 UTC
    expect(inMinuteWindow(23 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(inMinuteWindow(2 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(inMinuteWindow(12 * 60, 22 * 60, 6 * 60)).toBe(false);
  });

  it('fires only on the days it names', () => {
    // 2026-09-17 is a Thursday (day 4)
    const thursday = rule({ config: { days: [4], fromMinute: 600, toMinute: 780 } });
    expect(ruleFires(thursday, input())).toBe(true);
    const friday = rule({ config: { days: [5], fromMinute: 600, toMinute: 780 } });
    expect(ruleFires(friday, input())).toBe(false);
  });

  it('keeps a midnight-wrapping window on the day it started', () => {
    // Thursday 22:00 → Friday 06:00, checked at 02:00 on the Friday
    const overnight = rule({ config: { days: [4], fromMinute: 1320, toMinute: 360 } });
    expect(ruleFires(overnight, input({ at: new Date('2026-09-18T02:00:00Z') }))).toBe(true);
    expect(ruleFires(overnight, input({ at: new Date('2026-09-18T08:00:00Z') }))).toBe(false);
  });
});

describe('volatility rules', () => {
  const above = rule({ kind: 'VOLATILITY', config: { windowMinutes: 15, aboveRatio: 1.5 } });

  it('fires when a market is moving more than its normal', () => {
    expect(ruleFires(above, input({ realisedVolatility: 0.0004 * 2 }))).toBe(true);
    expect(ruleFires(above, input({ realisedVolatility: 0.0004 }))).toBe(false);
  });

  it('fires when a market has gone quiet', () => {
    const below = rule({ kind: 'VOLATILITY', config: { windowMinutes: 15, belowRatio: 0.5 } });
    expect(ruleFires(below, input({ realisedVolatility: 0.0001 }))).toBe(true);
    expect(ruleFires(below, input({ realisedVolatility: 0.0004 }))).toBe(false);
  });

  it('does not fire without a measurement', () => {
    expect(ruleFires(above, input({ realisedVolatility: null }))).toBe(false);
    expect(ruleFires(above, input())).toBe(false);
  });

  it('refuses a rule with no threshold at all', () => {
    expect(() => parseRuleConfig('VOLATILITY', { windowMinutes: 15 })).toThrow();
    const unbounded = rule({ kind: 'VOLATILITY', config: { windowMinutes: 15 } });
    expect(ruleFires(unbounded, input({ realisedVolatility: 0.01 }))).toBe(false);
  });
});

describe('scheduled windows', () => {
  const news = rule({
    kind: 'SCHEDULE',
    config: { from: '2026-09-17T12:25:00Z', to: '2026-09-17T12:40:00Z' },
  });

  it('fires only inside the window', () => {
    expect(ruleFires(news, input({ at: new Date('2026-09-17T12:30:00Z') }))).toBe(true);
    expect(ruleFires(news, input({ at: new Date('2026-09-17T12:41:00Z') }))).toBe(false);
  });

  it('ignores an unparseable window rather than firing', () => {
    const broken = rule({ kind: 'SCHEDULE', config: { from: 'nonsense', to: 'nonsense' } });
    expect(ruleFires(broken, input())).toBe(false);
  });

  it('requires the window to end after it starts', () => {
    expect(() =>
      parseRuleConfig('SCHEDULE', { from: '2026-09-17T12:40:00Z', to: '2026-09-17T12:25:00Z' }),
    ).toThrow();
  });
});

describe('resolution', () => {
  it('returns the base payout when nothing fires', () => {
    const result = resolvePayout(input());
    expect(result.pct).toBe(85);
    expect(result.applied).toEqual([]);
  });

  it('adds every adjustment that fires', () => {
    const result = resolvePayout(
      input({
        rules: [
          rule({ id: 'a', adjustment: -5 }),
          rule({ id: 'b', adjustment: -3, assetClass: 'CURRENCY' }),
          rule({ id: 'c', adjustment: -9, assetClass: 'CRYPTO' }),
        ],
      }),
    );
    expect(result.pct).toBe(77);
    expect(result.applied.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('applies rules in priority order and lets an exclusive one stop the rest', () => {
    const result = resolvePayout(
      input({
        rules: [
          rule({ id: 'late', adjustment: -20, priority: 10 }),
          rule({ id: 'first', adjustment: -4, priority: 1, exclusive: true }),
        ],
      }),
    );
    expect(result.applied.map((entry) => entry.id)).toEqual(['first']);
    expect(result.pct).toBe(81);
  });

  it('skips a disabled rule', () => {
    const result = resolvePayout(input({ rules: [rule({ adjustment: -30, enabled: false })] }));
    expect(result.pct).toBe(85);
  });

  it('adds the status bonus on top', () => {
    const result = resolvePayout(input({ statusBonusPct: 3 }));
    expect(result.pct).toBe(88);
    expect(result.statusBonusPct).toBe(3);
  });

  it('clamps to the configured floor and ceiling', () => {
    const floored = resolvePayout(input({ rules: [rule({ adjustment: -80 })] }));
    expect(floored.pct).toBe(20);
    expect(floored.clamped).toBe(true);

    const capped = resolvePayout(input({ statusBonusPct: 40 }));
    expect(capped.pct).toBe(95);
    expect(capped.clamped).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const shape = input({ rules: [rule({ adjustment: -6 })], statusBonusPct: 2 });
    expect(resolvePayout(shape)).toEqual(resolvePayout(shape));
  });

  it('ignores a rule of an unknown kind', () => {
    const odd = { ...rule({ adjustment: -50 }), kind: 'WHATEVER' } as unknown as PayoutRule;
    expect(resolvePayout(input({ rules: [odd] })).pct).toBe(85);
  });
});

describe('rule configuration', () => {
  it('validates each kind against its own shape', () => {
    expect(Object.keys(RULE_CONFIG_SCHEMAS).sort()).toEqual(['SCHEDULE', 'TIME_OF_DAY', 'VOLATILITY']);
    expect(parseRuleConfig('TIME_OF_DAY', { fromMinute: 0, toMinute: 600 })).toEqual({
      fromMinute: 0,
      toMinute: 600,
    });
    expect(() => parseRuleConfig('TIME_OF_DAY', { fromMinute: -1, toMinute: 600 })).toThrow();
    expect(() => parseRuleConfig('TIME_OF_DAY', { fromMinute: 0, toMinute: 2000 })).toThrow();
  });
});
