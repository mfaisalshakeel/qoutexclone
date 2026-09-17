import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { marketFeed } from './engine/feed.js';
import { verifyAccessToken } from './lib/jwt.js';
import { tradeEvents } from './services/trading.js';
import { depositEvents } from './services/deposits.js';
import { withdrawalEvents } from './services/withdrawals.js';
import { supportEvents } from './services/support.js';
import { tournamentEvents } from './services/tournaments.js';
import { publicDeposit, publicTrade, publicWithdrawal } from './lib/serialize.js';

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
            send(socket, {
              type: 'candles',
              symbol: state.symbol,
              timeframe: state.timeframe,
              candles: marketFeed.getCandles(state.symbol, state.timeframe, 200),
            });
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

  const heartbeat = setInterval(() => {
    for (const [socket, state] of clients) {
      if (!state.alive) {
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

  tournamentEvents.on('updated', (tournament) => {
    if (tournament) toEveryone({ type: 'tournament:updated', tournament });
  });

  return {
    wss,
    close() {
      clearInterval(broadcast);
      clearInterval(heartbeat);
      wss.close();
    },
  };
}
