# Quantex — crypto binary options platform

A working clone of the Quotex trading model: fixed-payout binary options on crypto
markets, with crypto deposits and withdrawals, a live chart terminal, an account
ledger and an admin back office. Node + Express + Prisma + **MySQL** on the server,
React + Vite + Tailwind on the client.

This is a functional clone, not a pixel copy — the flows, engine and money handling
are the point.

## What it does

**Trading**
- Fixed-payout UP/DOWN options on 10 crypto markets, payouts 78–87%
- Expiries from 30 seconds to 1 hour
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

**Operations**
- Admin console: approvals, users, suspensions, balance adjustments, payout percentages
- WebSocket push for quotes, candles, settlements and wallet events
- JWT auth with rotating refresh tokens, rate limiting, Helmet, CSP

## Install

Requires **Node 20+** and **MySQL 8** (or MariaDB 10.4+).

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

### Market data

`FEED_PROVIDER=simulated` (default) runs a seeded random-walk engine — realistic
candles with no external dependency, so the platform works on an isolated network.
Per-asset `volatility` in the database is a per-minute standard deviation of returns.

`FEED_PROVIDER=binance` streams live trades instead and **falls back to the simulator
automatically** if the socket cannot be reached, so the terminal never goes dark.

### Going live with real crypto

Two things stand between this and real funds, and both are deliberately isolated:

1. **`MOCK_CHAIN_WATCHER=true`** auto-confirms pending deposits on a timer so the flow
   can be demonstrated end to end. Set it to `false`. Then drive
   `markSeen(depositId, txHash)` and `completeDeposit(depositId)` in
   `server/src/services/deposits.ts` from your provider's webhook or your own node —
   that is exactly what the mock watcher does, just against a real chain.
2. **`MockCustodyProvider`** in `server/src/services/custody.ts` derives deterministic
   addresses and fake transaction hashes. Implement the `CustodyProvider` interface
   against your custody service (node, exchange sub-account, Fireblocks/BitGo/Tatum…)
   and export it as `custody`. Nothing else in the codebase talks to a wallet.

## Layout

```
server/
  prisma/schema.prisma      data model and migrations
  src/engine/feed.ts        market data (simulated | exchange stream)
  src/engine/settlement.ts  expiry sweeper
  src/engine/chain-watcher.ts  deposit confirmation loop (mock by default)
  src/services/             trading, wallet ledger, deposits, withdrawals, custody
  src/routes/               auth, account, market, trades, wallet, admin
  src/ws.ts                 realtime hub
web/
  src/pages/                landing, auth, terminal, wallet, history, account, admin
  src/components/           chart, ticket, positions, deposit/withdraw panels
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
npm test
```

Covers payout math and rounding, fee quoting per network, address validation and
derivation for every supported chain, the settlement rule (including ties), and the
price model's behaviour over long runs.

## Risk and legal notice

Binary options are high-risk instruments and are restricted or banned for retail
clients in many jurisdictions. This repository is a reference implementation for
education and development. Before accepting real customer money you are responsible
for licensing, KYC/AML, segregation of client funds, and everything else your
regulator requires.
