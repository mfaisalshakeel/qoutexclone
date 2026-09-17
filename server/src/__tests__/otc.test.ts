import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OTC_PARAMS,
  fromRow,
  initialState,
  nextTick,
  resolveParams,
  toRow,
  type OtcParams,
  type OtcState,
} from '../engine/otc.js';

const params = resolveParams({ baseVolatility: 0.0012, tickMs: 250 });

function run(symbol: string, ticks: number, overrides: Partial<OtcParams> = {}, basePrice = 100) {
  const resolved = resolveParams({ ...params, ...overrides });
  let state = initialState(symbol, basePrice, resolved);
  const prices: number[] = [];
  for (let i = 0; i < ticks; i += 1) {
    state = nextTick({ state, params: resolved, precision: 5 });
    prices.push(state.price);
  }
  return { state, prices };
}

describe('otc engine purity', () => {
  it('imports nothing at all, so it cannot read positions or user data', () => {
    // the hard invariant from CLAUDE.md, enforced structurally
    const source = fs.readFileSync(path.join(process.cwd(), 'src/engine/otc.ts'), 'utf8');
    const imports = source.match(/^\s*import\s/gm) ?? [];
    expect(imports).toHaveLength(0);

    // comments discuss positions and traders on purpose, so check the code only
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/prisma|trade|position|exposure|balance|userId/i);
  });

  it('produces an identical path for the same seed', () => {
    expect(run('EURUSD_OTC', 500).prices).toEqual(run('EURUSD_OTC', 500).prices);
  });

  it('produces different paths for different markets', () => {
    expect(run('EURUSD_OTC', 200).prices).not.toEqual(run('GBPUSD_OTC', 200).prices);
  });

  /**
   * The engine takes no trading input, so the only way a position could move a
   * price is if someone added a parameter for it. This asserts the signature
   * stays closed: extra fields on the input are ignored.
   */
  it('ignores anything that looks like trading state', () => {
    const resolved = resolveParams(params);
    let a = initialState('XAUUSD_OTC', 2300, resolved);
    let b = initialState('XAUUSD_OTC', 2300, resolved);

    for (let i = 0; i < 100; i += 1) {
      a = nextTick({ state: a, params: resolved, precision: 2 });
      b = nextTick({
        state: b,
        params: resolved,
        precision: 2,
        // deliberately smuggled in: must have no effect
        ...({ openPositions: 5000, exposureUp: 1_000_000, userId: 'whale' } as unknown as object),
      });
    }
    expect(a.price).toBe(b.price);
    expect(a.rng).toBe(b.rng);
  });
});

describe('otc engine behaviour', () => {
  it('resumes exactly where a persisted state left off', () => {
    const first = run('BTCUSDT_OTC', 300, {}, 64000);
    const round = fromRow(toRow(first.state));
    expect(round).toEqual(first.state);

    const resolved = resolveParams(params);
    let resumed = round;
    const after: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      resumed = nextTick({ state: resumed, params: resolved, precision: 5 });
      after.push(resumed.price);
    }

    // the same 350 ticks in one go must match 300 + resume 50
    const straight = run('BTCUSDT_OTC', 350, {}, 64000).prices.slice(300);
    expect(after).toEqual(straight);
  });

  it('never gaps more than the configured cap', () => {
    const { prices } = run('SPIKEY', 4000, {
      spikeProbability: 0.05,
      spikeSigmaMultiple: 10,
      maxTickMove: 0.002,
    });
    for (let i = 1; i < prices.length; i += 1) {
      const move = Math.abs(prices[i] - prices[i - 1]) / prices[i - 1];
      expect(move).toBeLessThanOrEqual(0.002 + 1e-9);
    }
  });

  it('stays in the neighbourhood of its anchor over a long run', () => {
    const { prices, state } = run('ANCHORED', 20_000);
    const drift = Math.abs(state.price - 100) / 100;
    expect(drift).toBeLessThan(0.5);
    expect(Math.min(...prices)).toBeGreaterThan(0);
  });

  it('clusters volatility instead of moving uniformly', () => {
    const { prices } = run('CLUSTER', 6000, { garchAlpha: 0.12, garchBeta: 0.86 });
    const returns = prices.slice(1).map((price, index) => Math.abs(price / prices[index] - 1));

    // squared-return autocorrelation at lag 1 is the signature of clustering
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    let covariance = 0;
    let variance = 0;
    for (let i = 1; i < returns.length; i += 1) {
      covariance += (returns[i] - mean) * (returns[i - 1] - mean);
      variance += (returns[i] - mean) ** 2;
    }
    expect(covariance / variance).toBeGreaterThan(0.05);
  });

  it('switches between trending and ranging regimes', () => {
    const resolved = resolveParams({
      ...params,
      regimeMinMinutes: 0.5,
      regimeMaxMinutes: 2,
      trendShare: 0.5,
    });
    let state = initialState('REGIMES', 100, resolved);
    const seen = new Set<OtcState['regime']>();
    for (let i = 0; i < 6000; i += 1) {
      state = nextTick({ state, params: resolved, precision: 5 });
      seen.add(state.regime);
    }
    expect([...seen].sort()).toEqual(['RANGE', 'TREND']);
  });

  it('moves roughly as much per minute as its volatility says', () => {
    const resolved = resolveParams({ baseVolatility: 0.001, tickMs: 250, spikeProbability: 0 });
    let state = initialState('SCALED', 100, resolved);
    const perMinute: number[] = [];
    for (let minute = 0; minute < 400; minute += 1) {
      const open = state.price;
      for (let tick = 0; tick < 240; tick += 1) {
        state = nextTick({ state, params: resolved, precision: 6 });
      }
      perMinute.push(Math.abs(state.price / open - 1));
    }
    const mean = perMinute.reduce((sum, value) => sum + value, 0) / perMinute.length;
    // mean absolute move of a normal walk is ~0.8 sigma; allow a wide band
    expect(mean).toBeGreaterThan(0.0002);
    expect(mean).toBeLessThan(0.004);
  });

  it('eases the anchor toward spot when following a real market', () => {
    const resolved = resolveParams({ ...params, followSpot: true, baseVolatility: 0.0001 });
    let state = initialState('EURUSD_OTC', 1.08, resolved);
    for (let i = 0; i < 2000; i += 1) {
      state = nextTick({ state, params: resolved, precision: 5, spotPrice: 1.12 });
    }
    expect(state.anchor).toBeGreaterThan(1.1);
    expect(state.price).toBeGreaterThan(1.09);
  });
});

describe('otc parameters', () => {
  it('keeps the GARCH process stationary', () => {
    const resolved = resolveParams({ garchAlpha: 0.7, garchBeta: 0.7 });
    expect(resolved.garchAlpha + resolved.garchBeta).toBeLessThan(1);
  });

  it('clamps nonsense into a usable range', () => {
    const resolved = resolveParams({
      baseVolatility: 99,
      trendShare: 5,
      spikeProbability: 1,
      maxTickMove: 10,
      tickMs: 1,
    });
    expect(resolved.baseVolatility).toBeLessThanOrEqual(0.05);
    expect(resolved.trendShare).toBe(1);
    expect(resolved.spikeProbability).toBeLessThanOrEqual(0.05);
    expect(resolved.maxTickMove).toBeLessThanOrEqual(0.05);
    expect(resolved.tickMs).toBeGreaterThanOrEqual(50);
  });

  it('falls back to defaults for missing fields', () => {
    expect(resolveParams(null)).toEqual(DEFAULT_OTC_PARAMS);
    expect(resolveParams({ baseVolatility: 0.002 }).garchBeta).toBe(DEFAULT_OTC_PARAMS.garchBeta);
  });
});
