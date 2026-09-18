import { api, tokens } from './api';
import type {
  AccountType,
  Candle,
  Deposit,
  PendingOrder,
  SupportMessage,
  SupportTicket,
  Trade,
  TraderSentiment,
  Withdrawal,
} from './types';

type Handler = (payload: never) => void;

export interface RealtimeEvents {
  quotes: { prices: Record<string, number>; ts: number };
  /** The whole sentiment book; small enough to send rather than diff. */
  sentiment: { sentiment: Record<string, TraderSentiment> };
  /** Only the markets whose payout actually moved, with what moved it. */
  payouts: {
    payouts: Record<
      string,
      { pct: number; basePct: number; adjustments: { name: string; kind: string; adjustment: number }[] }
    >;
  };
  candle: { symbol: string; timeframe: string; candle: Candle };
  candles: { symbol: string; timeframe: string; candles: Candle[] };
  'trade:opened': { trade: Trade };
  'order:updated': { order: PendingOrder };
  'order:filled': { order: PendingOrder; trade: Trade };
  'order:failed': { order: PendingOrder };
  'trade:settled': { trade: Trade; balance: number; accountType: AccountType };
  'deposit:created': { deposit: Deposit };
  'deposit:updated': { deposit: Deposit };
  'withdrawal:updated': { withdrawal: Withdrawal };
  'support:message': { message: SupportMessage };
  'support:incoming': { message: SupportMessage; userId: string; subject: string };
  'support:ticket': { ticket: SupportTicket };
  'tournament:updated': { tournament: { id: string; name: string; status: string } };
  status: { connected: boolean };
}

/**
 * Thin realtime client: one socket for the whole app, auto-reconnecting with
 * backoff and replaying the current subscription after every reconnect.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  /**
   * Every chart on screen, counted. A terminal can show four at once and each
   * one subscribes for itself, so the socket tracks how many charts want a
   * channel rather than letting the last one to mount replace the rest.
   */
  private channels = new Map<string, { symbol: string; timeframe: string; count: number }>();
  private attempts = 0;
  private closedByUs = false;
  private reconnectTimer: number | null = null;

  connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.closedByUs = false;
    const token = tokens.access;
    const socket = new WebSocket(`${api.wsUrl()}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.emit('status', { connected: true });
      if (this.channels.size > 0) this.sendChannels();
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type) this.emit(payload.type, payload);
      } catch {
        /* ignore malformed frame */
      }
    };
    socket.onclose = () => {
      this.emit('status', { connected: false });
      if (!this.closedByUs) this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.attempts, 15000);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  /** Re-opens the socket so the server picks up the new identity. */
  reauthenticate(): void {
    this.disconnect();
    this.connect();
  }

  send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /**
   * Watches one chart, returning the function that stops watching it. The
   * server is only told when the set actually changes, so four charts sharing a
   * market do not send four messages.
   */
  subscribe(symbol: string, timeframe: string): () => void {
    const key = `${symbol}|${timeframe}`;
    const existing = this.channels.get(key);
    if (existing) existing.count += 1;
    else {
      this.channels.set(key, { symbol, timeframe, count: 1 });
      this.sendChannels();
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = this.channels.get(key);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) {
        this.channels.delete(key);
        this.sendChannels();
      }
    };
  }

  private sendChannels(): void {
    this.send({
      type: 'subscribe',
      channels: [...this.channels.values()].map(({ symbol, timeframe }) => ({ symbol, timeframe })),
    });
  }

  on<K extends keyof RealtimeEvents>(type: K, handler: (payload: RealtimeEvents[K]) => void): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as Handler);
    return () => this.handlers.get(type)?.delete(handler as Handler);
  }

  private emit(type: string, payload: unknown): void {
    // the public `on` signature keeps callers type-safe; the map itself is untyped
    this.handlers.get(type)?.forEach((handler) => (handler as (value: unknown) => void)(payload));
  }
}

export const realtime = new RealtimeClient();
