import { env } from '../../env.js';
import { log } from '../../lib/logger.js';
import {
  backoffMs,
  type PriceProvider,
  type ProviderHealth,
  type ProviderMarket,
  type ProviderTick,
} from './types.js';

/**
 * Delayed quotes for forex, stocks and indices over HTTP.
 *
 * Written against Twelve Data's `/price` endpoint, which has a free tier, and
 * kept deliberately generic: `MARKET_DATA_URL` can point at any service that
 * answers `?symbol=A,B,C` with `{ "A": { "price": "1.08" }, ... }` or
 * `{ "price": "1.08" }` for a single symbol.
 *
 * With no API key configured the provider reports `unavailable` and every
 * market stays on the broker engine — which is the normal state of a fresh
 * install, and why the terminal labels each market's price source.
 */
export class HttpQuoteProvider implements PriceProvider {
  readonly name = 'httpquotes';

  private status: ProviderHealth['status'] = 'stopped';
  private detail: string | undefined;
  private lastTickAt: number | null = null;
  private markets: ProviderMarket[] = [];
  private onTick: ((tick: ProviderTick) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;

  supports(market: ProviderMarket): boolean {
    return !market.isOtc && ['CURRENCY', 'STOCK', 'INDEX', 'COMMODITY'].includes(market.assetClass);
  }

  async start(markets: ProviderMarket[], onTick: (tick: ProviderTick) => void): Promise<void> {
    this.markets = markets.filter((market) => this.supports(market));
    this.onTick = onTick;
    this.stopped = false;

    if (!env.marketDataKey) {
      this.status = 'unavailable';
      this.detail = 'MARKET_DATA_KEY not configured — these markets use the broker engine';
      log.feed.info({ provider: this.name }, 'no market data key; forex, stocks and indices stay simulated');
      return;
    }
    if (this.markets.length === 0) {
      this.status = 'unavailable';
      this.detail = 'no supported markets enabled';
      return;
    }

    this.status = 'connecting';
    await this.poll();
  }

  /** One polling round; schedules the next itself so a slow response cannot pile up. */
  private async poll(): Promise<void> {
    if (this.stopped) return;

    // the free tiers are rate limited, so symbols go out in one batched request
    const batch = this.markets.map((market) => market.feedSymbol).join(',');
    const url = `${env.marketDataUrl}?symbol=${encodeURIComponent(batch)}&apikey=${encodeURIComponent(env.marketDataKey)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as Record<string, unknown>;

      const now = Date.now();
      let applied = 0;
      for (const market of this.markets) {
        const entry =
          this.markets.length === 1 ? payload : (payload[market.feedSymbol] as Record<string, unknown>);
        const price = Number((entry as { price?: string | number } | undefined)?.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        this.onTick?.({ symbol: market.symbol, price, ts: now });
        applied += 1;
      }

      if (applied === 0) throw new Error('no usable quotes in response');

      this.lastTickAt = now;
      this.status = 'connected';
      this.detail = `${applied} markets quoted`;
      this.attempt = 0;
      this.schedule(env.marketDataPollMs);
    } catch (err) {
      const message = (err as Error).message;
      this.status = 'degraded';
      this.detail = message;
      const wait = backoffMs(this.attempt++, env.marketDataPollMs, 300_000);
      log.feed.warn(
        { provider: this.name, err: message, retryInMs: wait },
        'quote poll failed, using broker engine',
      );
      this.schedule(wait);
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.poll(), ms);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.status = 'stopped';
  }

  health(): ProviderHealth {
    return {
      name: this.name,
      status: this.status,
      symbols: this.markets.length,
      lastTickAt: this.lastTickAt,
      detail: this.detail,
    };
  }
}
