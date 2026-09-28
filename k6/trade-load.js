/**
 * "Scale" roadmap task: 1,000 concurrent traders placing trades.
 *
 * Each VU is bound to one pre-provisioned trader (see prepare-traders.ts —
 * run that first) and repeatedly places a small, fast-expiring DEMO trade on
 * the always-open BTCUSDT_OTC market, in a loop, for the run's duration.
 * DEMO, never REAL: this measures the trading path's throughput, not the
 * ledger's, and never risks a real balance.
 *
 * Usage:
 *   npx tsx --env-file=server/.env k6/prepare-traders.ts 1000
 *   k6 run k6/trade-load.js
 *   npx tsx --env-file=server/.env k6/cleanup-traders.ts <runTag>
 *
 * BASE_URL defaults to http://localhost:4000 (env var to point elsewhere).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const SYMBOL = 'BTCUSDT_OTC';
const TARGET_VUS = Number(__ENV.TARGET_VUS || 1000);

const traders = new SharedArray('traders', function () {
  return JSON.parse(open('./traders.json'));
});

const tradesPlaced = new Counter('trades_placed');
const tradesFailed = new Counter('trades_failed');
const placeTradeDuration = new Trend('place_trade_duration', true);

export const options = {
  scenarios: {
    traders: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: TARGET_VUS }, // ramp up
        { duration: '60s', target: TARGET_VUS }, // hold at full concurrency
        { duration: '15s', target: 0 }, // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // correctness is the one threshold that belongs in the script: a rate
    // limit misconfiguration, a validation bug or the lost-update race this
    // load test originally found all show up here, on any hardware.
    http_req_failed: ['rate<0.01'],
    // Latency is not: it is a function of the database, the connection pool
    // and the number of API instances behind BASE_URL, none of which this
    // script controls. There is no threshold on place_trade_duration here on
    // purpose — read it from the summary and judge it against your own
    // deployment's target, not a number baked in for every environment (see
    // docs/load-test.md for what this actually measured on a shared 4-vCPU
    // sandbox: 0% errors, ~180-340 req/s depending on connection_limit).
  },
};

export default function () {
  const trader = traders[(__VU - 1) % traders.length];
  // the general API rate limiter is correctly per-IP (see Security review) —
  // real traders come from real, distinct addresses, so each VU gets its
  // own synthetic one via the X-Forwarded-For the app already trusts one hop
  // of (`trust proxy`, 1). Without this every VU shares this container's one
  // outbound IP and the load test would measure the abuse limiter, not the
  // trading path.
  const vu = __VU % 65000;
  const syntheticIp = `10.${Math.floor(vu / 256) % 256}.${vu % 256}.${(__VU % 250) + 1}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${trader.accessToken}`,
    'X-Forwarded-For': syntheticIp,
  };

  const body = JSON.stringify({
    symbol: SYMBOL,
    direction: Math.random() < 0.5 ? 'UP' : 'DOWN',
    amount: 10, // $10 demo stake
    expiryMode: 'DURATION',
    durationSec: 5, // the platform's shortest expiry — trades cycle fast, so
    // this doubles as load on the settlement sweeper, not only on placement
    accountType: 'DEMO',
  });

  const res = http.post(`${BASE_URL}/api/trades`, body, { headers, tags: { name: 'PlaceTrade' } });
  placeTradeDuration.add(res.timings.duration);

  const ok = check(res, {
    'trade placed (201)': (r) => r.status === 201,
  });
  if (ok) tradesPlaced.add(1);
  else tradesFailed.add(1);

  sleep(1 + Math.random()); // 1-2s between trades per trader — a person, not a bot storm
}
