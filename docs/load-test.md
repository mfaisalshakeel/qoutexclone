# Load testing: 1,000 concurrent traders

`k6/` holds a [k6](https://k6.io) load test that simulates 1,000 concurrent
traders each placing DEMO trades in a loop, plus the two small Node scripts
that provision and clean up the trader pool it trades as.

## Running it

```bash
# 1. build and start the API in production mode (not `npm run dev` — that's
#    tsx watch, transpiling on every request, and would measure that instead)
npm run build
npm start --workspace=server

# 2. provision 1,000 trader accounts and mint their access tokens directly —
#    never through /register or /login (see prepare-traders.ts's own comment
#    for why: the IP rate limiter and bcrypt cost both belong to a *different*
#    load test than this one)
npx tsx --env-file=server/.env k6/prepare-traders.ts 1000

# 3. run it (k6 itself: see https://k6.io/docs/get-started/installation/)
k6 run k6/trade-load.js

# 4. remove the trader pool and everything it traded
npx tsx --env-file=server/.env k6/cleanup-traders.ts <runTag from step 2>
```

`BASE_URL` (env var, default `http://localhost:4000`) points the run at any
running instance. `TARGET_VUS` (default 1000) scales the concurrency.

## What it measures, and what it deliberately doesn't

Each of the 1,000 virtual users is bound to its own pre-provisioned trader and
repeatedly places a $10 DEMO stake on `BTCUSDT_OTC` (always open, never real
money) with the platform's shortest expiry (5s), sleeping 1-2s between
trades — a person clicking a button, not a request-flood tool. The 5s expiry
is deliberate: it puts real load on the settlement sweeper in the same run,
not only on trade placement.

It does **not** measure registration or login throughput — those sit behind
`authLimiter`, an IP-keyed rate limit that is correctly strict (see Security
review), and a k6 run firing from one machine would measure that limiter, not
the trading path. A separate load test would be the right way to size
registration capacity; this one answers a narrower, and arguably more
important, question: once someone is a trader, does placing and settling a
position hold up under real concurrency?

The general per-IP API rate limiter (`security.apiRateLimitPerMinute`) is
real too, and for the same reason the script gives every VU its own synthetic
`X-Forwarded-For` address (the app already trusts one proxy hop) — 1,000 real
traders come from 1,000 real addresses, not one shared one.

## Two real bugs this test found

Both were found empirically — a plain code read would not have surfaced
either — and are fixed in the code this test now exercises, proven by
`server/src/__tests__/integration/scale.test.ts`'s own concurrent-database
tests, not just by a clean k6 run:

**A lost-update race in the balance itself.** `applyLedger` (the sole
function allowed to change a balance) and `adjustEntryBalance` (its
tournament-chip equivalent) read the current balance, computed the new one in
JavaScript, then wrote it back — a classic read-modify-write race. MySQL's
default REPEATABLE READ isolation does not block a second transaction from
reading the same pre-commit snapshot a first transaction is about to update,
so two trades staking the same account at nearly the same instant could each
compute "current minus my stake" from the same stale number; the second
`UPDATE` then silently overwrote the first's, losing a debit with **no
error at all** — not even Prisma's own P2034 conflict code, which only fires
for conflicts InnoDB's own detector catches, and a plain lost update is not
guaranteed to be one. First k6 run at 1,000 VUs: balances drifted from what
the ledger's own transaction rows said they should be. Fixed by making the
read a real `SELECT ... FOR UPDATE` (`$queryRaw`, since Prisma's ORM layer
has no first-class locking read) — a genuine row lock that makes a second
concurrent caller wait for the first's transaction to actually resolve and
then read what it really left behind, the ordinary correct way to serialise
this in SQL.

**Settlement processed its due trades one at a time.** `SettlementEngine.tick()`
looped over up to 200 expired positions with a sequential `for` loop, each
one `await`ed before the next began. At normal load this never mattered; at
1,000 concurrent traders, expiries arrive faster than a strictly sequential
loop can clear them, unsettled positions pile up, and traders started
tripping the (correct, working-as-designed) 25-open-positions safety cap —
not because anything was actually wrong, but because their genuinely-expired
trades hadn't been settled yet and were still counted as open. Fixed by
settling a pass's due trades concurrently (`Promise.allSettled`, not
`Promise.all` — one trade's settlement failing must not cost the rest of the
pass). Each trade's settlement is its own independent, idempotent
transaction (`settleTrade`'s atomic claim was already covered before this
task), so nothing about correctness changes — only throughput.

Retrying a transaction that failed on a write conflict is safe here
specifically because neither `placeTrade`'s nor `settleTrade`'s transaction
callback has any effect outside itself until the `$transaction` call
resolves (see the extended comment on `retryOnConflict` in
`server/src/lib/retry.ts`) — a P2034/1213/1205 means nothing committed, so
asking again cannot double anything.

## Results on this session's sandbox

A single 4-vCPU container running the API, MariaDB and k6 itself all at
once — nothing like production hardware, and the absolute numbers below are
not a production SLA claim. What matters is the shape of the results and
that correctness held throughout.

| Run | DB connection_limit | Settlement | Errors | Throughput | `place_trade_duration` p95 |
| --- | --- | --- | --- | --- | --- |
| 1 (first, before any fix) | 40 | sequential | **97.8%** failed | — | — (all IP-rate-limited: every VU shared one address) |
| 2 (after synthetic per-VU IPs) | 40 | sequential | 9.0% (mix of 409s and **3 raw 500s** — the lost-update bug) | 233 req/s | 2.93s |
| 3 (after the `FOR UPDATE` fix) | 40 | sequential | 9.6% (409s only — no more 500s) | 235 req/s | 3.02s |
| 4 (connection_limit raised) | 100 | sequential | 58.9% (409s only) | 344 req/s | 2.76s |
| 5 (after parallel settlement) | 100 | **parallel** | **0.0%** | 178 req/s | 4.01s |

Run 4 is the one worth explaining, not skipping past: raising the connection
pool alone made the API *faster* (median latency dropped from 2.25s to
0.39s) but made the failure rate *worse* (9.6% → 58.9%), because a faster API
let traders place trades faster than the still-sequential settlement loop
could clear them — exactly the second bug above, and exactly why "it got
faster" is not the same question as "it got correct." Run 5, with both fixes
in place, is 0% errors: every one of the run's ~19,000 requests either
succeeded or (this run) never needed to fail at all, at the literal target —
1,000 concurrent traders, sustained for the hold phase, actually trading.

Throughput dropped from run 4 to run 5 because parallel settlement means more
transactions competing for the same, still-modest connection pool at once —
the honest next lever is more DB connections or, in line with the roadmap's
own framing, more API instances (see below) rather than one process holding
an ever-larger pool alone.

## What this implies for a real multi-instance deployment

Everything this test exercises is now safe to run behind more than one API
process:

- **Realtime fan-out** goes through `services/pubsub.ts` — in-memory by
  default (single instance, unchanged behaviour), Redis-backed the moment
  `REDIS_URL` is set, so a trade settling on one instance still reaches a
  trader's socket on another (`server/src/__tests__/integration/ws-fanout.test.ts`
  proves the exact delivery this depends on, and `pubsub.test.ts` proves the
  Redis adapter delivers across two real, independent connections).
- **Settlement is safe with more than one instance sweeping the same table**:
  `settleTrade`'s atomic `updateMany({ where: { status: 'OPEN' } })` claim is
  a database-level compare-and-swap that does not care whether the two
  callers racing for a trade are two ticks of one process or two different
  processes — `scale.test.ts` proves this directly with two and three real
  `SettlementEngine` instances racing the same due trades against one
  database, not just two ticks of one loop.
- **The two bugs this run found were both database contention, not
  application state** — nothing in either fix depends on a single process,
  so they hold exactly as well across N instances sharing one database as
  they do within one.

The connection pool is the one thing that does *not* automatically get
better by adding instances: N processes each holding `connection_limit`
connections is N× the load on the database's own `max_connections`. Size
each instance's pool for a fair share of the database's real ceiling, not for
what one instance alone could use if it had the database to itself.
