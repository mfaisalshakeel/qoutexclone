import { afterEach, describe, expect, it, vi } from 'vitest';
import { limitsFor } from './risk.js';
import { settings } from './settings.js';

describe('limitsFor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('leaves a market inside the platform-wide bounds untouched', () => {
    const limits = limitsFor({
      minStake: 200,
      maxStake: 100_000,
      maxOpenStakePerUser: 0,
      maxExposurePerDirection: 0,
    });
    expect(limits.minStake).toBe(200);
    expect(limits.maxStake).toBe(100_000);
  });

  it("clamps a market's own maximum down to the platform ceiling", () => {
    vi.spyOn(settings, 'get').mockImplementation(((key: string) =>
      key === 'trading.maxStakeCents' ? 50_000 : 0) as never);
    const limits = limitsFor({
      minStake: 100,
      maxStake: 1_000_000, // this market's own row still says $10,000
      maxOpenStakePerUser: 0,
      maxExposurePerDirection: 0,
    });
    expect(limits.maxStake).toBe(50_000);
  });

  it("raises a market's own minimum up to the platform floor", () => {
    vi.spyOn(settings, 'get').mockImplementation(((key: string) =>
      key === 'trading.minStakeCents' ? 500 : 0) as never);
    const limits = limitsFor({
      minStake: 100, // this market's own row still says $1
      maxStake: 500_000,
      maxOpenStakePerUser: 0,
      maxExposurePerDirection: 0,
    });
    expect(limits.minStake).toBe(500);
  });

  it('falls back to the runtime defaults for a market with no risk limits of its own', () => {
    vi.spyOn(settings, 'get').mockImplementation(((key: string) => {
      if (key === 'risk.maxOpenStakePerUser') return 20_000;
      if (key === 'risk.maxExposurePerDirection') return 40_000;
      return 0;
    }) as never);
    const limits = limitsFor({
      minStake: 100,
      maxStake: 500_000,
      maxOpenStakePerUser: 0,
      maxExposurePerDirection: 0,
    });
    expect(limits.maxOpenStakePerUser).toBe(20_000);
    expect(limits.maxExposurePerDirection).toBe(40_000);
  });

  it("keeps a market's own risk limits over the runtime default", () => {
    const limits = limitsFor({
      minStake: 100,
      maxStake: 500_000,
      maxOpenStakePerUser: 75_000,
      maxExposurePerDirection: 150_000,
    });
    expect(limits.maxOpenStakePerUser).toBe(75_000);
    expect(limits.maxExposurePerDirection).toBe(150_000);
  });
});
