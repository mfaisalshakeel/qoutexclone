import { BinanceProvider } from './binance.js';
import { HttpQuoteProvider } from './twelvedata.js';
import type { PriceProvider, ProviderHealth, ProviderMarket, ProviderTick } from './types.js';

export type { PriceProvider, ProviderHealth, ProviderMarket, ProviderTick } from './types.js';
export { backoffMs } from './types.js';

/**
 * Routes each market to the first provider that can price it, and reports which
 * source every market is actually on so the UI can label it honestly.
 *
 * A market with no live provider — or whose provider is degraded — is priced by
 * the broker engine. That fallback is silent and automatic by design: traders
 * see a continuous tape, and the label tells them where it comes from.
 */
export class ProviderRegistry {
  private providers: PriceProvider[] = [];
  /** symbol -> provider name, for markets a provider claimed. */
  private claims = new Map<string, string>();
  private lastTickBySymbol = new Map<string, number>();

  constructor(providers?: PriceProvider[]) {
    this.providers = providers ?? [new BinanceProvider(), new HttpQuoteProvider()];
  }

  /**
   * Starts every provider that can price something. Whether live data is used
   * at all is the feed's decision (see `env.feedProvider`); the registry only
   * deals with providers, which keeps it free of configuration policy.
   */
  async start(markets: ProviderMarket[], onTick: (tick: ProviderTick) => void): Promise<void> {
    const unclaimed = [...markets];
    for (const provider of this.providers) {
      const mine = unclaimed.filter((market) => provider.supports(market));
      if (mine.length === 0) continue;
      for (const market of mine) this.claims.set(market.symbol, provider.name);

      await provider.start(mine, (tick) => {
        this.lastTickBySymbol.set(tick.symbol, tick.ts);
        onTick(tick);
      });
    }
  }

  stop(): void {
    for (const provider of this.providers) provider.stop();
    this.claims.clear();
    this.lastTickBySymbol.clear();
  }

  /**
   * Whether a market is currently being priced by a provider. A claimed market
   * whose provider went quiet counts as *not* live, so the engine takes over
   * within one staleness window rather than freezing the tape.
   */
  isLive(symbol: string, staleAfterMs = 30_000): boolean {
    const provider = this.providerFor(symbol);
    if (!provider || provider.health().status !== 'connected') return false;
    const last = this.lastTickBySymbol.get(symbol);
    return last !== undefined && Date.now() - last < staleAfterMs;
  }

  /** The label shown next to a price: `binance`, `httpquotes` or `broker`. */
  sourceFor(symbol: string): string {
    return this.isLive(symbol) ? (this.claims.get(symbol) ?? 'broker') : 'broker';
  }

  private providerFor(symbol: string): PriceProvider | undefined {
    const name = this.claims.get(symbol);
    return name ? this.providers.find((provider) => provider.name === name) : undefined;
  }

  health(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }
}

export const providerRegistry = new ProviderRegistry();
