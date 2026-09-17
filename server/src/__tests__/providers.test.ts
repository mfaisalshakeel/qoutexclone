import { describe, expect, it } from 'vitest';
import { ProviderRegistry, backoffMs } from '../engine/providers/index.js';
import type {
  PriceProvider,
  ProviderHealth,
  ProviderMarket,
  ProviderTick,
} from '../engine/providers/types.js';

const market = (symbol: string, assetClass: string, isOtc = false): ProviderMarket => ({
  symbol,
  feedSymbol: symbol,
  assetClass,
  isOtc,
  precision: 5,
});

const MARKETS = [
  market('BTCUSDT', 'CRYPTO'),
  market('BTCUSDT_OTC', 'CRYPTO', true),
  market('EURUSD', 'CURRENCY'),
  market('EURUSD_OTC', 'CURRENCY', true),
  market('AAPL', 'STOCK'),
];

/** A provider under the test's control, so routing and fallback are observable. */
class FakeProvider implements PriceProvider {
  emit: ((tick: ProviderTick) => void) | null = null;
  started: ProviderMarket[] = [];
  private state: ProviderHealth['status'] = 'stopped';
  private lastTickAt: number | null = null;

  constructor(
    readonly name: string,
    private classes: string[],
    private startStatus: ProviderHealth['status'] = 'connected',
  ) {}

  supports(candidate: ProviderMarket): boolean {
    return !candidate.isOtc && this.classes.includes(candidate.assetClass);
  }

  async start(markets: ProviderMarket[], onTick: (tick: ProviderTick) => void): Promise<void> {
    this.started = markets;
    this.state = this.startStatus;
    this.emit = (tick) => {
      this.lastTickAt = tick.ts;
      onTick(tick);
    };
  }

  degrade(): void {
    this.state = 'degraded';
  }

  stop(): void {
    this.state = 'stopped';
  }

  health(): ProviderHealth {
    return { name: this.name, status: this.state, symbols: this.started.length, lastTickAt: this.lastTickAt };
  }
}

describe('provider registry', () => {
  it('reports broker pricing until something is started', () => {
    // the feed decides whether to use live data at all; an unstarted registry
    // must never claim a market
    const registry = new ProviderRegistry([new FakeProvider('fake-crypto', ['CRYPTO'])]);
    expect(registry.sourceFor('BTCUSDT')).toBe('broker');
    expect(registry.isLive('BTCUSDT')).toBe(false);
  });

  it('routes each market to the first provider that supports it', async () => {
    const crypto = new FakeProvider('fake-crypto', ['CRYPTO']);
    const equities = new FakeProvider('fake-equities', ['CURRENCY', 'STOCK']);
    const registry = new ProviderRegistry([crypto, equities]);
    const ticks: ProviderTick[] = [];

    await registry.start(MARKETS, (tick) => ticks.push(tick));

    expect(crypto.started.map((m) => m.symbol)).toEqual(['BTCUSDT']);
    expect(equities.started.map((m) => m.symbol)).toEqual(['EURUSD', 'AAPL']);
    // OTC markets are broker-priced by definition and never claimed
    expect([...crypto.started, ...equities.started].some((m) => m.isOtc)).toBe(false);

    crypto.emit!({ symbol: 'BTCUSDT', price: 64000, ts: Date.now() });
    expect(ticks).toHaveLength(1);
    expect(registry.sourceFor('BTCUSDT')).toBe('fake-crypto');
    expect(registry.sourceFor('EURUSD_OTC')).toBe('broker');
  });

  it('falls back to the broker engine when a provider degrades', async () => {
    const crypto = new FakeProvider('fake-crypto', ['CRYPTO']);
    const registry = new ProviderRegistry([crypto]);
    await registry.start(MARKETS, () => {});

    crypto.emit!({ symbol: 'BTCUSDT', price: 64000, ts: Date.now() });
    expect(registry.isLive('BTCUSDT')).toBe(true);

    crypto.degrade();
    expect(registry.isLive('BTCUSDT')).toBe(false);
    expect(registry.sourceFor('BTCUSDT')).toBe('broker');
  });

  it('treats a silent provider as not live, so the engine resumes', async () => {
    const crypto = new FakeProvider('fake-crypto', ['CRYPTO']);
    const registry = new ProviderRegistry([crypto]);
    await registry.start(MARKETS, () => {});

    crypto.emit!({ symbol: 'BTCUSDT', price: 64000, ts: Date.now() - 60_000 });
    expect(registry.isLive('BTCUSDT', 30_000)).toBe(false);
  });

  it('reports health for every provider', async () => {
    const crypto = new FakeProvider('fake-crypto', ['CRYPTO']);
    const dead = new FakeProvider('fake-dead', ['INDEX'], 'unavailable');
    const registry = new ProviderRegistry([crypto, dead]);
    await registry.start(MARKETS, () => {});

    const health = registry.health();
    expect(health.map((entry) => entry.name).sort()).toEqual(['fake-crypto', 'fake-dead']);
    expect(health.find((entry) => entry.name === 'fake-crypto')?.status).toBe('connected');
  });
});

describe('backoff', () => {
  it('grows exponentially and stays under the cap', () => {
    const waits = [0, 1, 2, 3, 10, 50].map((attempt) => backoffMs(attempt, 1000, 60_000));
    expect(waits[0]).toBeGreaterThanOrEqual(500);
    expect(waits[0]).toBeLessThanOrEqual(1000);
    expect(waits[2]).toBeGreaterThan(waits[0]);
    for (const wait of waits) expect(wait).toBeLessThanOrEqual(60_000);
  });

  it('jitters so reconnects do not synchronise', () => {
    const draws = new Set(Array.from({ length: 20 }, () => backoffMs(5)));
    expect(draws.size).toBeGreaterThan(1);
  });
});
