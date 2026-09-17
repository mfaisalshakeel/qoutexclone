import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { marketFeed } from './engine/feed.js';
import { candleStore } from './services/candles.js';
import { verifyAccessToken } from './lib/jwt.js';
import { tradeEvents } from './services/trading.js';
import { depositEvents } from './services/deposits.js';
import { withdrawalEvents } from './services/withdrawals.js';
import { supportEvents } from './services/support.js';
import { tournamentEvents } from './services/tournaments.js';
import { settingsEvents } from './services/settings.js';
import { payouts } from './services/payouts.js';
import { orderEvents } from './services/orders.js';
import { prisma } from './lib/prisma.js';
import { publicDeposit, publicOrder, publicTrade, publicWithdrawal } from './lib/serialize.js';
import { log } from './lib/logger.js';

interface ClientState {
  userId?: string;
  isAdmin?: boolean;
  symbol?: string;
  timeframe: string;
  alive: boolean;
}

const BROADCAST_MS = 400;
const HEARTBEAT_MS = 30000;
/**
 * Payouts move on the clock and on volatility, not on every tick, so they ride
 * a slower loop and only the markets whose figure actually changed are sent.
 */
const PAYOUT_MS = 10_000;

/**
 * Realtime channel for the terminal: batched quotes + the subscribed candle for
 * everyone, and account events (settled trades, deposit/withdrawal updates)
 * routed to the owning user's sockets only.
 */
export function attachWebsocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Map<WebSocket, ClientState>();
  const byUser = new Map<string, Set<WebSocket>>();

  const send = (socket: WebSocket, payload: unknown) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };

  const toUser = (userId: string, payload: unknown) => {
    const sockets = byUser.get(userId);
    if (!sockets) return;
    for (const socket of sockets) send(socket, payload);
  };

  const bindUser = (socket: WebSocket, state: ClientState, userId: string, role?: string) => {
    if (state.userId && state.userId !== userId) byUser.get(state.userId)?.delete(socket);
    state.userId = userId;
    state.isAdmin = role === 'ADMIN';
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId)!.add(socket);
  };

  /** Support desk fan-out: every signed-in administrator's sockets. */
  const toAdmins = (payload: unknown) => {
    for (const [socket, state] of clients) if (state.isAdmin) send(socket, payload);
  };

  const toEveryone = (payload: unknown) => {
    for (const socket of clients.keys()) send(socket, payload);
  };

  wss.on('connection', (socket, req) => {
    const state: ClientState = { timeframe: '1m', alive: true };
    clients.set(socket, state);
    log.ws.debug({ clients: clients.size }, 'client connected');

    // Token may ride on the query string or arrive in an auth frame.
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      try {
        const payload = verifyAccessToken(queryToken);
        bindUser(socket, state, payload.sub, payload.role);
      } catch {
        /* stay anonymous */
      }
    }

    send(socket, {
      type: 'welcome',
      provider: marketFeed.provider,
      prices: marketFeed.getPrices(),
      ts: Date.now(),
    });

    socket.on('pong', () => {
      state.alive = true;
    });

    socket.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case 'auth': {
          try {
            const payload = verifyAccessToken(String(msg.token));
            bindUser(socket, state, payload.sub, payload.role);
            send(socket, { type: 'auth', ok: true });
          } catch {
            send(socket, { type: 'auth', ok: false });
          }
          break;
        }
        case 'subscribe': {
          if (typeof msg.symbol === 'string') state.symbol = msg.symbol.toUpperCase();
          if (typeof msg.timeframe === 'string') state.timeframe = msg.timeframe;
          if (state.symbol) {
            // durable history, not just the in-memory tail
            void candleStore
              .history(state.symbol, state.timeframe, { limit: 200 })
              .then((candles) =>
                send(socket, {
                  type: 'candles',
                  symbol: state.symbol,
                  timeframe: state.timeframe,
                  candles,
                }),
              )
              .catch(() => undefined);
          }
          break;
        }
        case 'ping':
          send(socket, { type: 'pong', ts: Date.now() });
          break;
        default:
          break;
      }
    });

    socket.on('close', () => {
      const current = clients.get(socket);
      if (current?.userId) {
        const set = byUser.get(current.userId);
        set?.delete(socket);
        if (set && set.size === 0) byUser.delete(current.userId);
      }
      clients.delete(socket);
      log.ws.debug({ clients: clients.size }, 'client disconnected');
    });
  });

  const broadcast = setInterval(() => {
    if (clients.size === 0) return;
    const prices = marketFeed.getPrices();
    const ts = Date.now();
    for (const [socket, state] of clients) {
      send(socket, { type: 'quotes', prices, ts });
      if (state.symbol) {
        const [candle] = marketFeed.getCandles(state.symbol, state.timeframe, 1);
        if (candle)
          send(socket, { type: 'candle', symbol: state.symbol, timeframe: state.timeframe, candle });
      }
    }
  }, BROADCAST_MS);
  broadcast.unref?.();

  /**
   * The catalogue the payout loop resolves against. Markets change only when an
   * operator edits one, so the list is refreshed on the same slow loop rather
   * than read from the database on every pass.
   */
  let catalogue: {
    id: string;
    symbol: string;
    assetClass: string;
    payoutPct: number;
    volatility: number;
  }[] = [];

  const payoutLoop = setInterval(() => {
    void (async () => {
      try {
        catalogue = await prisma.asset.findMany({
          where: { enabled: true },
          select: { id: true, symbol: true, assetClass: true, payoutPct: true, volatility: true },
        });
        const changed = payouts.changedPayouts(catalogue);
        if (clients.size > 0 && Object.keys(changed).length > 0) {
          toEveryone({ type: 'payouts', payouts: changed });
        }
      } catch (err) {
        log.ws.error({ err }, 'payout broadcast failed');
      }
    })();
  }, PAYOUT_MS);
  payoutLoop.unref?.();

  const heartbeat = setInterval(() => {
    for (const [socket, state] of clients) {
      if (!state.alive) {
        log.ws.debug('terminating unresponsive client');
        socket.terminate();
        continue;
      }
      state.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  tradeEvents.on('settled', ({ trade, balance }) => {
    toUser(trade.userId, {
      type: 'trade:settled',
      trade: publicTrade(trade),
      balance,
      accountType: trade.accountType,
    });
  });
  tradeEvents.on('opened', (trade) => {
    toUser(trade.userId, { type: 'trade:opened', trade: publicTrade(trade) });
  });

  // a pending order changes state without the trader doing anything, so every
  // transition is pushed rather than waiting for a refresh
  orderEvents.on('created', (order) => {
    toUser(order.userId, { type: 'order:updated', order: publicOrder(order) });
  });
  orderEvents.on('cancelled', (order) => {
    toUser(order.userId, { type: 'order:updated', order: publicOrder(order) });
  });
  orderEvents.on('expired', (order) => {
    toUser(order.userId, { type: 'order:updated', order: publicOrder(order) });
  });
  orderEvents.on('triggered', ({ order, trade }) => {
    toUser(order.userId, {
      type: 'order:filled',
      order: publicOrder(order),
      trade: publicTrade(trade),
    });
  });
  orderEvents.on('failed', (order) => {
    toUser(order.userId, { type: 'order:failed', order: publicOrder(order) });
  });
  depositEvents.on('updated', (deposit) => {
    if (deposit) toUser(deposit.userId, { type: 'deposit:updated', deposit: publicDeposit(deposit) });
  });
  depositEvents.on('created', (deposit) => {
    if (deposit) toUser(deposit.userId, { type: 'deposit:created', deposit: publicDeposit(deposit) });
  });
  withdrawalEvents.on('updated', (withdrawal) => {
    if (withdrawal)
      toUser(withdrawal.userId, { type: 'withdrawal:updated', withdrawal: publicWithdrawal(withdrawal) });
  });

  supportEvents.on('message', ({ message, userId, subject }) => {
    // the trader sees replies instantly; the desk sees every incoming message
    toUser(userId, { type: 'support:message', message });
    if (!message.fromSupport) toAdmins({ type: 'support:incoming', message, userId, subject });
  });
  supportEvents.on('ticket', (ticket) => {
    toAdmins({ type: 'support:ticket', ticket });
  });

  // a public setting change reaches every open client immediately
  settingsEvents.on('changed', ({ key, value, isPublic }) => {
    if (isPublic) toEveryone({ type: 'settings:changed', key, value });
  });

  tournamentEvents.on('updated', (tournament) => {
    if (tournament) toEveryone({ type: 'tournament:updated', tournament });
  });

  return {
    wss,
    close() {
      clearInterval(broadcast);
      clearInterval(payoutLoop);
      clearInterval(heartbeat);
      wss.close();
    },
  };
}
