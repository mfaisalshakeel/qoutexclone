/**
 * Market data providers.
 *
 * A provider turns some external source into ticks for the symbols it can
 * price. It never decides anything about trading — it only reports prices, and
 * the feed falls back to the broker engine whenever a provider is unavailable,
 * degraded or simply does not cover a market.
 */

export type ProviderStatus = 'stopped' | 'connecting' | 'connected' | 'degraded' | 'unavailable';

export interface ProviderTick {
  /** The platform symbol, not the provider's own. */
  symbol: string;
  price: number;
  ts: number;
}

export interface ProviderMarket {
  symbol: string;
  feedSymbol: string;
  assetClass: string;
  isOtc: boolean;
  precision: number;
}

export interface ProviderHealth {
  name: string;
  status: ProviderStatus;
  /** Markets this provider is currently pricing. */
  symbols: number;
  lastTickAt: number | null;
  detail?: string;
}

export interface PriceProvider {
  readonly name: string;

  /** Whether this provider can price a given market. */
  supports(market: ProviderMarket): boolean;

  /**
   * Begins streaming. Implementations must reconnect on their own with
   * backoff, and must never throw after `start` resolves — a failure is
   * reported through `health()` so the feed can fall back quietly.
   */
  start(markets: ProviderMarket[], onTick: (tick: ProviderTick) => void): Promise<void>;

  stop(): void;

  health(): ProviderHealth;
}

/** Exponential backoff with jitter, shared by every provider. */
export function backoffMs(attempt: number, baseMs = 1000, capMs = 60_000): number {
  const exponential = Math.min(baseMs * 2 ** Math.min(attempt, 10), capMs);
  // jitter avoids a thundering herd when many symbols reconnect together
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}
