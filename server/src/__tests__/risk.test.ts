import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowance, checkRisk, type RiskLimits, type RiskState } from '../engine/risk.js';

const limits = (over: Partial<RiskLimits> = {}): RiskLimits => ({
  minStake: 100,
  maxStake: 500_000,
  maxOpenStakePerUser: 0,
  maxExposurePerDirection: 0,
  ...over,
});

const state = (over: Partial<RiskState> = {}): RiskState => ({
  userOpenStake: 0,
  directionExposure: 0,
  ...over,
});

describe('risk limits never touch the market', () => {
  it('cannot read or write a price, a payout or an outcome', () => {
    // the hard rule from CLAUDE.md: risk controls limit new stakes, never the
    // quote — enforced structurally so it cannot drift
    const source = fs.readFileSync(path.join(process.cwd(), 'src/engine/risk.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bimport\b/);
    for (const forbidden of ['price', 'payout', 'feed', 'tick', 'outcome', 'settle']) {
      expect(code.toLowerCase(), `mentions ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('stake bounds', () => {
  it('rejects a stake below the minimum', () => {
    const rejection = checkRisk({ stake: 50, limits: limits(), state: state() });
    expect(rejection?.code).toBe('stake_too_low');
    expect(rejection?.message).toContain('$1.00');
  });

  it('rejects a stake above the maximum and names it', () => {
    const rejection = checkRisk({ stake: 600_000, limits: limits(), state: state() });
    expect(rejection?.code).toBe('stake_too_high');
    expect(rejection?.message).toContain('$5,000.00');
    expect(rejection?.remaining).toBe(500_000);
  });

  it('allows a stake inside the bounds', () => {
    expect(checkRisk({ stake: 10_000, limits: limits(), state: state() })).toBeNull();
  });

  it('reports the stake bound first when several limits bite', () => {
    const rejection = checkRisk({
      stake: 900_000,
      limits: limits({ maxOpenStakePerUser: 50_000 }),
      state: state({ userOpenStake: 50_000 }),
    });
    // "the maximum is $5,000" is more useful than "you hold too much already"
    expect(rejection?.code).toBe('stake_too_high');
  });
});

describe('per-trader limit', () => {
  it('counts what the trader already holds on this market', () => {
    const shape = {
      limits: limits({ maxOpenStakePerUser: 100_000 }),
      state: state({ userOpenStake: 70_000 }),
    };
    expect(checkRisk({ stake: 30_000, ...shape })).toBeNull();
    const rejection = checkRisk({ stake: 30_001, ...shape });
    expect(rejection?.code).toBe('user_exposure_limit');
    expect(rejection?.remaining).toBe(30_000);
    expect(rejection?.message).toContain('$300.00 left');
  });

  it('says so plainly when nothing is left', () => {
    const rejection = checkRisk({
      stake: 100,
      limits: limits({ maxOpenStakePerUser: 100_000 }),
      state: state({ userOpenStake: 100_000 }),
    });
    expect(rejection?.remaining).toBe(0);
    expect(rejection?.message).toContain('already hold the maximum');
  });

  it('is unlimited at zero, so an unconfigured market is unrestricted', () => {
    expect(
      checkRisk({ stake: 400_000, limits: limits(), state: state({ userOpenStake: 9_000_000 }) }),
    ).toBeNull();
  });
});

describe('house limit per direction', () => {
  it('refuses a stake that would take the side past its cap', () => {
    const shape = {
      limits: limits({ maxExposurePerDirection: 1_000_000 }),
      state: state({ directionExposure: 950_000 }),
    };
    expect(checkRisk({ stake: 50_000, ...shape })).toBeNull();
    const rejection = checkRisk({ stake: 50_001, ...shape });
    expect(rejection?.code).toBe('market_exposure_limit');
    expect(rejection?.message).toContain('$500.00 can still be staked');
  });

  it('points the trader elsewhere when the side is full', () => {
    const rejection = checkRisk({
      stake: 1_000,
      limits: limits({ maxExposurePerDirection: 1_000_000 }),
      state: state({ directionExposure: 1_000_000 }),
    });
    expect(rejection?.message).toContain('other direction');
    expect(rejection?.remaining).toBe(0);
  });

  it('caps each side on its own, so a full side never blocks the other', () => {
    // the caller supplies the exposure for the side being traded, so a full
    // UP book leaves DOWN untouched
    const full = checkRisk({
      stake: 10_000,
      limits: limits({ maxExposurePerDirection: 100_000 }),
      state: state({ directionExposure: 100_000 }),
    });
    const other = checkRisk({
      stake: 10_000,
      limits: limits({ maxExposurePerDirection: 100_000 }),
      state: state({ directionExposure: 0 }),
    });
    expect(full).not.toBeNull();
    expect(other).toBeNull();
  });
});

describe('allowance', () => {
  it('is the tightest of every limit', () => {
    expect(
      allowance(limits({ maxOpenStakePerUser: 60_000, maxExposurePerDirection: 200_000 }), state()),
    ).toBe(60_000);
    expect(
      allowance(
        limits({ maxOpenStakePerUser: 600_000, maxExposurePerDirection: 200_000 }),
        state({ directionExposure: 150_000 }),
      ),
    ).toBe(50_000);
  });

  it('is the per-trade maximum when nothing else is capped', () => {
    expect(allowance(limits(), state())).toBe(500_000);
  });

  it('never goes negative when a limit has been lowered under what is open', () => {
    expect(allowance(limits({ maxOpenStakePerUser: 10_000 }), state({ userOpenStake: 90_000 }))).toBe(0);
  });

  it('is unbounded when no limit applies at all', () => {
    expect(allowance(limits({ maxStake: 0 }), state())).toBe(Number.POSITIVE_INFINITY);
  });
});
