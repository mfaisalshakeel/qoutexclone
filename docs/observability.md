# Observability

Three pieces: an error-tracking hook, a Prometheus metrics endpoint, and the
alerts an operator should actually wire up against them. All three are
optional and off by default — nothing here changes behaviour until you
configure it, the same shape as SMTP (outbox-only until `SMTP_HOST` is set)
or realtime fan-out (in-process until `REDIS_URL` is set).

## Error tracking

Set `SENTRY_DSN` (`server/.env`) to a project DSN from
[sentry.io](https://sentry.io) or a self-hosted GlitchTip/Sentry instance
(both speak the same DSN format — "Sentry-compatible", as the roadmap put
it). Leave it blank and `server/src/lib/error-tracking.ts`'s `captureException`
is a no-op; nothing is sent anywhere, nothing is imported at runtime beyond
the SDK's own harmless `init()` skip.

**What gets reported, and what deliberately doesn't.** Every genuinely
unexpected error passes through exactly one of three places, and all three
call `captureException`:

- `middleware/error.ts`'s generic-500 branch — the same place that already
  writes the request's stack trace to the structured log.
- `index.ts`'s `uncaughtException`/`unhandledRejection` process handlers.
- `index.ts`'s `main().catch(...)` — a boot failure (bad config, an
  unreachable database at startup).

An `AppError` (a validation failure, a refused withdrawal, "not found") is
**never** reported. Those are expected outcomes of normal traffic — a
trader fat-fingering a password, a stake below the minimum — and routing
every one of them to an error tracker would bury the signal a real fault is
meant to be. `middleware/error.ts`'s branching order is what enforces this:
`ZodError`/`AppError`/`MulterError`/a residual write-conflict all return
before the code path that calls `captureException` is ever reached.

Sentry batches events and sends them asynchronously — `flushErrorTracking()`
is awaited during graceful shutdown and right before the process exits after
a boot failure, so the last event of a crash isn't lost to the process
exiting before the network request completes.

## Metrics: `GET /metrics`

Prometheus text-exposition format, powered by `prom-client`
(`server/src/lib/metrics.ts`). Point a Prometheus `scrape_configs` entry at
it:

```yaml
scrape_configs:
  - job_name: quantex-api
    metrics_path: /metrics
    static_configs:
      - targets: ['api-1:4000', 'api-2:4000'] # every instance, in a multi-instance deployment
    # only if METRICS_TOKEN is set (see below)
    authorization:
      credentials: 'your-metrics-token'
```

Set `METRICS_TOKEN` before exposing the port publicly — the route checks
`Authorization: Bearer <token>` and answers 401 without it. Leave it blank
only when Prometheus reaches the instance over a network nothing else can
(a private VPC, a sidecar).

### What each metric means

Every one of these reuses a measurement the platform already takes for
itself — the admin back office's live "system health" panel reads the exact
same `SettlementEngine.health()` and `MarketFeed`/provider calls — rather
than a second, parallel way of watching the same things.

| Metric | Type | Meaning |
| --- | --- | --- |
| `quantex_trades_placed_total{accountType}` | counter | Trades opened, by `DEMO`/`REAL`/`TOURNAMENT`. `rate(...[5m])` is trades/s. |
| `quantex_trades_settled_total{status}` | counter | Trades settled, by `WON`/`LOST`/`REFUNDED`. |
| `quantex_settlement_lag_ms` | gauge | Age of the oldest still-open position past its own expiry. `0` = fully caught up. Rising means the sweeper cannot keep pace with expiries. |
| `quantex_settlement_last_tick_duration_ms` | gauge | How long the sweeper's last pass took. |
| `quantex_settlement_last_tick_age_ms` | gauge | Milliseconds since the sweeper last completed a pass at all. `-1` before the first pass. A healthy instance keeps this under `SETTLEMENT_INTERVAL_MS` (default 200) plus the last pass's own duration; a much larger number means the loop itself has stalled, not just fallen behind. |
| `quantex_ws_connections` | gauge | Open websocket sockets **on this instance**. Per-instance by design (see below) — sum across instances in Prometheus/Grafana, not in the app. |
| `quantex_ws_online_users` | gauge | Distinct signed-in traders with at least one socket open, on this instance. |
| `quantex_feed_staleness_ms` | gauge | Milliseconds since the newest tick across every market. `-1` before the first tick. |
| `quantex_feed_provider_up{provider}` | gauge | `1` if that feed provider (`binance`, `httpquotes`) is connected, `0` otherwise. The `simulated` provider never appears here — it cannot go down. |
| `quantex_process_*` | various | Node process defaults from `prom-client` (CPU, memory, event-loop lag, GC) — the usual "is this process itself healthy" baseline. |

**Why `quantex_ws_connections` is per-instance, not cluster-wide**: a scrape
hits one instance and can only honestly answer for that instance's own open
sockets — exactly the shape Prometheus expects (`sum(quantex_ws_connections)`
across the `quantex-api` job gives the cluster total; the per-instance number
alone tells you about a load-balancer imbalance a cluster-wide sum would
hide). This is the same reasoning the just-finished Scale task used for the
admin back office's own live health panel: correct locally, aggregated
externally, never faked in-process.

## Alerts

Prometheus Alertmanager rule syntax — adapt the exact thresholds to your own
traffic and infrastructure; the reasoning behind each one is what should
survive a port to a different alerting tool, not the literal numbers.

```yaml
groups:
  - name: quantex-api
    rules:
      - alert: SettlementFallingBehind
        expr: quantex_settlement_lag_ms > 5000
        for: 2m
        labels: { severity: critical }
        annotations:
          summary: 'Settlement lag over 5s for 2 minutes'
          description: 'Positions are expiring faster than the sweeper can pay them. Traders are owed money they have not received yet. Check settlement_last_tick_duration_ms for whether individual passes have slowed, and the database for lock contention.'

      - alert: SettlementLoopStalled
        expr: quantex_settlement_last_tick_age_ms > 10000
        for: 1m
        labels: { severity: critical }
        annotations:
          summary: 'The settlement sweeper has not completed a pass in over 10s'
          description: 'The loop itself may have crashed or hung — this is worse than merely falling behind. Check the process logs for an uncaught error inside SettlementEngine.tick().'

      - alert: FeedStale
        expr: quantex_feed_staleness_ms > 10000
        for: 1m
        labels: { severity: warning }
        annotations:
          summary: 'No market tick in over 10s'
          description: 'Matches the /api/ready threshold (FEED_STALE_MS). New trades are being priced from a stale market; existing positions cannot settle accurately either. Check quantex_feed_provider_up for which provider dropped.'

      - alert: FeedProviderDown
        expr: quantex_feed_provider_up == 0
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: 'A configured feed provider has been down for 5 minutes'
          description: 'The feed likely fell back to the simulator for markets this provider was pricing — trades on those markets are being taken on synthetic, not real, prices.'

      - alert: NoTradingActivity
        expr: rate(quantex_trades_placed_total[15m]) == 0
        for: 15m
        labels: { severity: warning }
        annotations:
          summary: 'No trades placed in 15 minutes'
          description: 'Could be genuinely quiet traffic, or the trading path silently broken (auth, a bad deploy, a market catalogue gone empty). Cross-check against http_req rate/error rate if a request-level metric is also scraped (e.g. from a reverse proxy).'

```

**There is deliberately no "elevated 500 rate" PromQL rule above.** This
task did not add a request-count/error-count HTTP metric (there is no
`http_requests_total` in `quantex_*`) — the reverse proxy every deployment
already needs in front of this API (see `DEPLOY.md`'s nginx block) is the
conventional place that lives, and duplicating it inside the app would be
the second measurement path this whole task tried to avoid elsewhere. If
your reverse proxy or ingress (nginx, Envoy, an API gateway) already exports
request metrics, alert on its error rate rather than inventing one here.
**For server-error rate specifically, configure Sentry's own alerting**
(issue frequency, a new issue type appearing) — that is what `SENTRY_DSN`
is for, and it already has the full stack trace attached.

## What this does not cover

- **Frontend error tracking.** `SENTRY_DSN` here is the server's own. A
  browser-side Sentry (or similar) SDK in `web/` is a separate, unstarted
  piece of work — flagged here rather than silently left implicit.
- **Distributed tracing.** `tracesSampleRate: 0` in the Sentry init is
  deliberate: this platform already has structured, per-request pino
  logging (`x-request-id` propagation, component-tagged child loggers).
  Adding APM-style tracing on top would be a second observability system
  answering a question the logs mostly already answer.
- **Log aggregation.** Pino writes structured JSON to stdout in production;
  shipping it somewhere (Loki, CloudWatch, an ELK stack) is an
  infrastructure choice for the deployment, not something this app needs to
  know about.
