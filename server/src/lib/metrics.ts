import client from 'prom-client';

/**
 * Prometheus metrics for this instance, served from `GET /metrics` (see
 * `app.ts`). Everything here reuses the platform's own existing measurements
 * — `SettlementEngine.health()`, `MarketFeed.lastTickAge()`/`providerHealth()`,
 * `ws.ts`'s connection tracking — rather than a second, parallel one; see
 * `docs/observability.md` for what each metric means and example alert
 * rules.
 *
 * Counters are incremented at the source, where the event actually happens
 * (`placeTrade`/`settleTrade` in `services/trading.ts`), because a counter
 * must be cumulative and event-driven. Gauges are set on scrape, in the
 * `/metrics` handler, because Prometheus wants the freshest value at the
 * moment it asks — not a value from whenever a timer last happened to fire.
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'quantex_' });

export const tradesPlacedTotal = new client.Counter({
  name: 'quantex_trades_placed_total',
  help: 'Trades placed, by account type',
  labelNames: ['accountType'],
  registers: [registry],
});

export const tradesSettledTotal = new client.Counter({
  name: 'quantex_trades_settled_total',
  help: 'Trades settled, by outcome',
  labelNames: ['status'],
  registers: [registry],
});

export const settlementLagMs = new client.Gauge({
  name: 'quantex_settlement_lag_ms',
  help: 'Age in ms of the oldest still-open position past its expiry — 0 means fully caught up',
  registers: [registry],
});

export const settlementLastTickDurationMs = new client.Gauge({
  name: 'quantex_settlement_last_tick_duration_ms',
  help: "How long the settlement sweeper's last pass took",
  registers: [registry],
});

export const settlementLastTickAge = new client.Gauge({
  name: 'quantex_settlement_last_tick_age_ms',
  help: 'Milliseconds since the settlement sweeper last completed a pass',
  registers: [registry],
});

export const wsConnections = new client.Gauge({
  name: 'quantex_ws_connections',
  help: 'Open websocket connections on this instance',
  registers: [registry],
});

export const wsOnlineUsers = new client.Gauge({
  name: 'quantex_ws_online_users',
  help: 'Distinct authenticated users with at least one open socket on this instance',
  registers: [registry],
});

export const feedStalenessMs = new client.Gauge({
  name: 'quantex_feed_staleness_ms',
  help: 'Milliseconds since the newest tick across every market — high means the feed has stalled',
  registers: [registry],
});

export const feedProviderUp = new client.Gauge({
  name: 'quantex_feed_provider_up',
  help: '1 if a feed provider is currently healthy, 0 otherwise',
  labelNames: ['provider'],
  registers: [registry],
});
