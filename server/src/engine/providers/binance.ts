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
 * Live crypto trades from Binance's public stream.
 *
 * Only spot crypto markets are supported: an OTC market is broker-priced by
 * definition, and forex/stocks/indices are not on this venue.
 */
/** How long a socket may stay unopened before the provider counts as degraded. */
const CONNECT_TIMEOUT_MS = 15_000;

export class BinanceProvider implements PriceProvider {
  readonly name = 'binance';

  private socket: import('ws').WebSocket | null = null;
  private status: ProviderHealth['status'] = 'stopped';
  private detail: string | undefined;
  private lastTickAt: number | null = null;
  private markets: ProviderMarket[] = [];
  private onTick: ((tick: ProviderTick) => void) | null = null;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  supports(market: ProviderMarket): boolean {
    return market.assetClass === 'CRYPTO' && !market.isOtc;
  }

  async start(markets: ProviderMarket[], onTick: (tick: ProviderTick) => void): Promise<void> {
    this.markets = markets.filter((market) => this.supports(market));
    this.onTick = onTick;
    this.stopped = false;
    if (this.markets.length === 0) {
      this.status = 'unavailable';
      this.detail = 'no crypto markets enabled';
      return;
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.status = 'connecting';

    try {
      const { WebSocket } = await import('ws');
      const streams = this.markets.map((market) => `${market.feedSymbol.toLowerCase()}@trade`).join('/');
      const socket = new WebSocket(`${env.binanceWsUrl}?streams=${streams}`);
      this.socket = socket;

      const bySymbol = new Map(this.markets.map((market) => [market.feedSymbol.toUpperCase(), market]));

      const degrade = (reason: string) => {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.socket = null;
        if (this.stopped) return;
        this.status = 'degraded';
        this.detail = reason;
        const wait = backoffMs(this.attempt++);
        log.feed.warn(
          { provider: this.name, reason, retryInMs: wait },
          'provider lost, falling back to simulation',
        );
        this.retryTimer = setTimeout(() => void this.connect(), wait);
        this.retryTimer.unref?.();
      };

      // a socket that never opens (blocked egress, black-holed proxy) must not
      // sit in "connecting" forever: operators need to see it as degraded
      this.connectTimer = setTimeout(() => {
        if (this.status === 'connecting') {
          socket.terminate();
          degrade('connect timed out');
        }
      }, CONNECT_TIMEOUT_MS);
      this.connectTimer.unref?.();

      socket.on('open', () => {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.status = 'connected';
        this.detail = undefined;
        this.attempt = 0;
        log.feed.info({ provider: this.name, markets: this.markets.length }, 'provider connected');
      });

      socket.on('message', (raw: Buffer) => {
        try {
          const message = JSON.parse(raw.toString());
          const data = message.data ?? message;
          const market = bySymbol.get(String(data.s ?? '').toUpperCase());
          const price = Number(data.p);
          if (!market || !Number.isFinite(price)) return;
          this.lastTickAt = Date.now();
          this.onTick?.({ symbol: market.symbol, price, ts: data.T ?? this.lastTickAt });
        } catch {
          /* a malformed frame is not worth tearing the socket down */
        }
      });

      socket.on('close', () => degrade('closed'));
      socket.on('error', (err: Error) => degrade(err.message));
    } catch (err) {
      this.status = 'unavailable';
      this.detail = (err as Error).message;
      log.feed.warn({ provider: this.name, err }, 'provider unavailable');
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.retryTimer = null;
    this.connectTimer = null;
    this.socket?.close();
    this.socket = null;
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
