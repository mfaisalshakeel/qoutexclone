import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { marketFeed } from './engine/feed.js';
import { settlementEngine } from './engine/settlement.js';
import { candleStore } from './services/candles.js';
import { verifyAccessToken } from './lib/jwt.js';
import { tradeEvents } from './services/trading.js';
import { depositEvents } from './services/deposits.js';
import { withdrawalEvents } from './services/withdrawals.js';
import { supportEvents } from './services/support.js';
import { tournamentEvents } from './services/tournaments.js';
import { settingsEvents } from './services/settings.js';
import { payouts } from './services/payouts.js';
import { sentiment } from './services/sentiment.js';
import { orderEvents } from './services/orders.js';
import { notificationEvents } from './services/notifications.js';
import { prisma } from './lib/prisma.js';
import {
  publicDeposit,
  publicNotification,
  publicOrder,
  publicTrade,
  publicWithdrawal,
} from './lib/serialize.js';
import { log } from './lib/logger.js';

/** One chart a client is watching. */
interface Channel {
  symbol: string;
  timeframe: string;
}

interface ClientState {
  userId?: string;
  isAdmin?: boolean;
  /**
   * Every chart on screen, keyed `symbol|timeframe`. A terminal can show four
   * at once, so one subscription per client is not enough — the last one would
   * simply win and the other three would sit still.
   */
  channels: Map<string, Channel>;
  alive: boolean;
}

/** At most this many charts per client, so one socket cannot ask for the world. */
const MAX_CHANNELS = 8;

const BROADCAST_MS = 400;
const HEARTBEAT_MS = 30000;
/**
 * Payouts move on the clock and on volatility, not on every tick, so they ride
 * a slower loop and only the markets whose figure actually changed are sent.
 */
const PAYOUT_MS = 10_000;
/** How often the back office's live system-health panel refreshes. */
const ADMIN_HEALTH_MS = 5_000;

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

  /** Skips the enrichment lookups below when no back-office tab is even open. */
  const hasAdmins = () => {
    for (const state of clients.values()) if (state.isAdmin) return true;
    return false;
  };

  /**
   * The trader identity the live admin panels show next to an event.
   * `totalDeposited` rides along even for trade/deposit events, unused
   * there, so the withdrawal panel's row shape matches the same one the
   * paginated `/admin/withdrawals` list already sends.
   */
  const traderIdentity = (userId: string) =>
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, totalDeposited: true } });

  wss.on('connection', (socket, req) => {
    const state: ClientState = { channels: new Map(), alive: true };
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
          // a list replaces the whole set; a single pair is still accepted so an
          // older client keeps working
          const requested: Channel[] = Array.isArray(msg.channels)
            ? (msg.channels as unknown[])
                .filter(
                  (each): each is Channel =>
                    !!each &&
                    typeof (each as Channel).symbol === 'string' &&
                    typeof (each as Channel).timeframe === 'string',
                )
                .map((each) => ({ symbol: each.symbol.toUpperCase(), timeframe: each.timeframe }))
            : typeof msg.symbol === 'string'
              ? [{ symbol: msg.symbol.toUpperCase(), timeframe: String(msg.timeframe ?? '1m') }]
              : [];

          const next = new Map<string, Channel>();
          for (const channel of requested.slice(0, MAX_CHANNELS)) {
            next.set(`${channel.symbol}|${channel.timeframe}`, channel);
          }

          // only a chart that is new to this client needs its history sent
          const fresh = [...next.entries()].filter(([key]) => !state.channels.has(key));
          state.channels = next;

          for (const [, channel] of fresh) {
            // durable history, not just the in-memory tail
            void candleStore
              .history(channel.symbol, channel.timeframe, { limit: 200 })
              .then((candles) =>
                send(socket, {
                  type: 'candles',
                  symbol: channel.symbol,
                  timeframe: channel.timeframe,
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
      for (const channel of state.channels.values()) {
        const [candle] = marketFeed.getCandles(channel.symbol, channel.timeframe, 1);
        if (candle) {
          send(socket, { type: 'candle', symbol: channel.symbol, timeframe: channel.timeframe, candle });
        }
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

        // sentiment moves on the same slow clock, and the whole snapshot is
        // small enough to send rather than diff
        if (clients.size > 0) {
          const book = sentiment.all();
          if (Object.keys(book).length > 0) toEveryone({ type: 'sentiment', sentiment: book });
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

  // the back office's "system health" panel: feed status per provider,
  // settlement lag, and connection counts. Gated on hasAdmins() the same way
  // the payout loop gates its own work — nobody pays for this when no
  // back-office tab is open.
  const adminHealthLoop = setInterval(() => {
    if (!hasAdmins()) return;
    void settlementEngine
      .health()
      .then((settlement) => {
        toAdmins({
          type: 'admin:health',
          feedProvider: marketFeed.provider,
          providers: marketFeed.providerHealth(),
          settlement,
          ws: { connections: clients.size, onlineUsers: byUser.size },
          ts: Date.now(),
        });
      })
      .catch((err) => log.ws.error({ err }, 'admin health broadcast failed'));
  }, ADMIN_HEALTH_MS);
  adminHealthLoop.unref?.();

  tradeEvents.on('settled', ({ trade, balance }) => {
    toUser(trade.userId, {
      type: 'trade:settled',
      trade: publicTrade(trade),
      balance,
      accountType: trade.accountType,
    });
    if (hasAdmins()) {
      void traderIdentity(trade.userId).then((user) => {
        toAdmins({ type: 'admin:trade', event: 'settled', trade: publicTrade(trade), user });
      });
    }
  });
  tradeEvents.on('opened', (trade) => {
    toUser(trade.userId, { type: 'trade:opened', trade: publicTrade(trade) });
    if (hasAdmins()) {
      void traderIdentity(trade.userId).then((user) => {
        toAdmins({ type: 'admin:trade', event: 'opened', trade: publicTrade(trade), user });
      });
    }
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
    if (!deposit) return;
    toUser(deposit.userId, { type: 'deposit:updated', deposit: publicDeposit(deposit) });
    if (hasAdmins()) {
      void traderIdentity(deposit.userId).then((user) => {
        toAdmins({ type: 'admin:deposit', event: 'updated', deposit: publicDeposit(deposit), user });
      });
    }
  });
  depositEvents.on('created', (deposit) => {
    if (!deposit) return;
    toUser(deposit.userId, { type: 'deposit:created', deposit: publicDeposit(deposit) });
    if (hasAdmins()) {
      void traderIdentity(deposit.userId).then((user) => {
        toAdmins({ type: 'admin:deposit', event: 'created', deposit: publicDeposit(deposit), user });
      });
    }
  });
  withdrawalEvents.on('created', (withdrawal) => {
    if (!withdrawal || !hasAdmins()) return;
    void traderIdentity(withdrawal.userId).then((user) => {
      toAdmins({
        type: 'admin:withdrawal',
        event: 'created',
        withdrawal: publicWithdrawal(withdrawal),
        user,
      });
    });
  });
  withdrawalEvents.on('updated', (withdrawal) => {
    if (!withdrawal) return;
    toUser(withdrawal.userId, { type: 'withdrawal:updated', withdrawal: publicWithdrawal(withdrawal) });
    if (hasAdmins()) {
      void traderIdentity(withdrawal.userId).then((user) => {
        toAdmins({
          type: 'admin:withdrawal',
          event: 'updated',
          withdrawal: publicWithdrawal(withdrawal),
          user,
        });
      });
    }
  });

  // the centre updates itself: a notification written server-side arrives at
  // whichever tabs the trader has open, unread count and all
  notificationEvents.on('created', (notification) => {
    toUser(notification.userId, {
      type: 'notification',
      notification: publicNotification(notification),
    });
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
      clearInterval(adminHealthLoop);
      wss.close();
    },
  };
}
