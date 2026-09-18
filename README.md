# Quantex — crypto binary options platform

A working clone of the Quotex trading model: fixed-payout binary options on crypto
markets, with crypto deposits and withdrawals, a live chart terminal, an account
ledger and an admin back office. Node + Express + Prisma + **MySQL** on the server,
React + Vite + Tailwind on the client.

This is a functional clone, not a pixel copy — the flows, engine and money handling
are the point.

![Trading terminal](docs/screenshots/terminal.png)

<p align="center">
  <img src="docs/screenshots/wallet-deposit.png" width="54%" alt="Crypto deposit invoice" />
  <img src="docs/screenshots/mobile-terminal.png" width="22%" alt="Terminal on a phone" />
</p>

![Back office](docs/screenshots/admin-dashboard.png)

<p align="center">
  <img src="docs/screenshots/admin-support.png" width="49%" alt="Support desk" />
  <img src="docs/screenshots/tournaments.png" width="49%" alt="Tournaments" />
</p>

<p align="center">
  <img src="docs/screenshots/account-kyc-referrals.png" width="78%" alt="Identity verification and partner programme" />
</p>

## What it does

**Trading**
- Fixed-payout UP/DOWN options on 10 crypto markets, payouts 78–87%
- Expiries from 30 seconds to 1 hour
- Candlestick or line chart with SMA, EMA and Bollinger band studies
- Settlement is priced from the tick at the exact expiry instant and is idempotent —
  a restart mid-flight can never pay a position twice
- A tie (exit exactly at the strike) refunds the stake
- Practice account with $10,000, resettable, on the same engine and prices as live

**Crypto wallet**
- Deposits in BTC, ETH, USDT (ERC-20) and USDT (TRC-20)
- Per-user deposit addresses, invoice with a locked rate and the exact amount to send,
  confirmation tracking, credit on confirmation
- Withdrawals with per-network address validation, a live fee quote, funds held while
  pending, and admin approve/reject with automatic refund
- Every balance change writes a ledger row — balances are always reconstructable

**Tournaments**
- Chip-based contests: every entrant gets the same stack, trades it on live
  prices, and the final leaderboard splits the prize pool in real money
- Entry fees feed the pot, positions still open at the bell are refunded in
  chips, and payouts are ranked and credited in one transaction
- Chips never touch a cash balance — the ledger refuses to move them

**Support desk**
- In-app chat widget on every page, threaded per question, with unread badges
- Back-office desk: conversation list, trader context, replies delivered over
  the socket with no refresh

**Growth and compliance**
- Promo codes: percentage deposit bonuses or flat credits, with minimums, caps,
  redemption limits and expiry — credited atomically with the deposit
- Partner programme: invite links, and a configurable share of every referred
  deposit paid to the referrer automatically
- Identity verification (KYC): submit, admin review, and an optional gate that
  blocks withdrawals above a threshold until the trader is verified

**Back office**
- Dedicated admin shell with a grouped sidebar (Money, Traders, Platform),
  live queue badges, and a slide-over drawer on phones
- Dashboard with deposit/withdrawal volume, net flow, house P&L and the
  queues that need attention
- Sections: withdrawals, deposits, users, verification, support, tournaments,
  promo codes, markets, and a full audit log of every administrative action
- WebSocket push for quotes, candles, settlements and wallet events
- JWT auth with rotating refresh tokens, single-use password reset, rate
  limiting, Helmet, CSP

## Install

Requires **Node 20+** and **MySQL 8** (or MariaDB 10.4+). For a hosted test
deployment — Railway, a VPS or shared hosting — see [DEPLOY.md](DEPLOY.md).

### Option 1 — Docker (nothing else to install)

```bash
cp .env.example .env        # edit the passwords and secrets
docker compose up -d --build
```

Open <http://localhost:4000>. MySQL, migrations and seeding are handled for you.

### Option 2 — installer script

```bash
./install.sh                # asks for your MySQL details, does everything else
npm start --workspace=server
```

The script writes `server/.env` with freshly generated secrets, applies migrations,
seeds the markets and admin user, and builds both the API and the web client.

Non-interactive (provisioning, CI):

```bash
DATABASE_URL="mysql://user:pass@host:3306/quotex" ./install.sh
```

### Option 3 — manual

```bash
npm install
cp server/.env.example server/.env     # set DATABASE_URL and the JWT secrets
npm run db:migrate                     # or: npm run db:push
npm run seed
npm run build
npm start                              # serves the API and the web client on one port
```

### Creating the database

```sql
CREATE DATABASE quotex CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'quotex'@'%' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON quotex.* TO 'quotex'@'%';
FLUSH PRIVILEGES;
```

On shared hosting (cPanel) where the database user cannot create databases, use
`npm run db:migrate` — `migrate deploy` needs no shadow database. `prisma migrate dev`
does, so only run it locally.

### Seeded logins

| Role   | Email                     | Password    |
| ------ | ------------------------- | ----------- |
| Admin  | `admin@quotexclone.dev`   | `Admin123!` |
| Trader | `trader@quotexclone.dev`  | `Trader123!`|

Change them immediately (`ADMIN_EMAIL` / `ADMIN_PASSWORD` before seeding).

## Development

```bash
npm run dev        # API on :4000 with reload, Vite on :5173 proxying /api and /ws
npm test           # engine, fee, payout and address unit tests
npm run typecheck
```

In production `npm start` serves the built client from the API process, so the whole
platform is one Node process plus MySQL, behind one domain and one port.

## Configuration

All server settings live in `server/.env` (see `server/.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — | `mysql://user:pass@host:3306/db` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | dev values | **Change these.** `openssl rand -hex 32` |
| `PORT` | `4000` | HTTP port |
| `CORS_ORIGINS` | localhost dev ports | Comma separated, or `*` for single-port hosting |
| `FEED_PROVIDER` | `simulated` | `simulated` or `binance` |
| `MOCK_CHAIN_WATCHER` | `true` | **Set to `false` in production** — see below |
| `AUTO_APPROVE_WITHDRAWALS` | `false` | Skip manual payout review |
| `WITHDRAW_FEE_PCT` / `WITHDRAW_FLAT_FEE_USD` | `1` / `1` | Fee model on top of the network fee |
| `MIN_DEPOSIT_USD` / `MIN_WITHDRAW_USD` | `10` / `20` | Global floors; each network can be stricter |
| `REQUIRE_KYC_FOR_WITHDRAWAL` | `false` | Gate withdrawals behind identity verification |
| `KYC_WITHDRAWAL_THRESHOLD_USD` | `0` | Verify only above this amount (`0` = always) |
| `REFERRAL_COMMISSION_PCT` | `5` | Share of a referred trader's deposits paid to the referrer |
| `MAX_OPEN_TRADES` | `25` | Open positions allowed per trader |
| `EXPOSE_RESET_TOKEN` | `true` | Returns reset tokens in the API response until a mailer is wired up |

### Market data

`FEED_PROVIDER=simulated` (default) runs a seeded random-walk engine — realistic
candles with no external dependency, so the platform works on an isolated network.
Per-asset `volatility` in the database is a per-minute standard deviation of returns.

`FEED_PROVIDER=binance` streams live trades instead and **falls back to the simulator
automatically** if the socket cannot be reached, so the terminal never goes dark.

### Going live with real crypto

Three things stand between this and real funds, and each is deliberately isolated:

1. **`MOCK_CHAIN_WATCHER=true`** auto-confirms pending deposits on a timer so the flow
   can be demonstrated end to end. Set it to `false`. Then drive
   `markSeen(depositId, txHash)` and `completeDeposit(depositId)` in
   `server/src/services/deposits.ts` from your provider's webhook or your own node —
   that is exactly what the mock watcher does, just against a real chain.
2. **`MockCustodyProvider`** in `server/src/services/custody.ts` derives deterministic
   addresses and fake transaction hashes. Implement the `CustodyProvider` interface
   against your custody service (node, exchange sub-account, Fireblocks/BitGo/Tatum…)
   and export it as `custody`. Nothing else in the codebase talks to a wallet.
3. **`EXPOSE_RESET_TOKEN=true`** hands password reset tokens back through the API
   because no mailer is configured. Set it to `false` and send the link from
   `requestReset()` in `server/src/services/password-reset.ts`.

Identity documents are never stored in this database: a KYC submission keeps the
declared details plus a `documentRef` pointing at whatever document store you use.

## Layout

```
server/
  prisma/schema.prisma      data model and migrations
  src/engine/feed.ts        market data (simulated | exchange stream)
  src/engine/settlement.ts  expiry sweeper
  src/engine/chain-watcher.ts  deposit confirmation loop (mock by default)
  src/services/             trading, wallet ledger, deposits, withdrawals, custody,
                            kyc, promos, referrals, tournaments, support, reset
  src/routes/               auth, account, market, trades, wallet, tournaments,
                            support, admin
  src/__tests__/            unit tests + integration suite (real MySQL)
  src/ws.ts                 realtime hub
web/
  src/pages/                landing, auth, terminal, tournaments, wallet,
                            history, account
  src/pages/admin/          dashboard, money, traders, support, platform
  src/components/           chart, ticket, positions, deposit/withdraw, kyc,
                            referrals, support chat
  src/components/admin/     back-office shell and table primitives
  src/store/                auth, market, toasts
```

## Money handling

Fiat balances are integer cents everywhere — no floats touch a balance. Crypto amounts
are decimal strings truncated to each network's precision, so a conversion never pays
out more than it should. `applyLedger` is the only function that changes a balance: it
refuses to overdraw and writes the matching transaction row inside the same database
transaction.

## Testing

```bash
npm test          # unit tests, server and web

# also run the integration suite against a real database
mysql -e "CREATE DATABASE quotex_test"
DATABASE_URL="mysql://user:pass@127.0.0.1:3306/quotex_test" npx prisma migrate deploy --schema server/prisma/schema.prisma
TEST_DATABASE_URL="mysql://user:pass@127.0.0.1:3306/quotex_test" npm test
```

Unit tests cover payout math and rounding, fee quoting per network, promo bonus
caps, tournament prize splits (including the rounding remainder), the KYC gate,
address validation and derivation for every supported chain, the settlement rule
(including ties), the indicator math, and the price model over long runs.

The integration suite runs the money paths against MySQL: a confirmed deposit
credits exactly once under retries, a promo code pays one bonus per trader, a
referred deposit pays its commission once, withdrawal holds block spending and
refund on rejection, and two concurrent settlements of the same position pay only
once. GitHub Actions (`.github/workflows/ci.yml`) runs all of it plus the Docker
build on every push.

## Risk and legal notice

Binary options are high-risk instruments and are restricted or banned for retail
clients in many jurisdictions. This repository is a reference implementation for
education and development. Before accepting real customer money you are responsible
for licensing, KYC/AML, segregation of client funds, and everything else your
regulator requires.
