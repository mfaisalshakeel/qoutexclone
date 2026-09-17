# CLAUDE.md — Quantex

Quantex is a binary (fixed-payout) options trading platform modelled on how Quotex works:
UP/DOWN positions on currencies, crypto, commodities, stocks and indices, including
broker-priced OTC markets that trade 24/7, a practice account, tournaments, a crypto
wallet, and an admin back office. The goal is a **production-grade product at Quotex's
level of completeness**, not a demo. The full scope is in [docs/ROADMAP.md](docs/ROADMAP.md).

Read this file and the roadmap before every session. They are the source of truth.

## How you work on this repo

You are expected to work autonomously until the roadmap is finished.

1. Open `docs/ROADMAP.md` and take the first unchecked task, in phase order.
2. Read the code it touches before changing anything. Match the surrounding style.
3. Build it completely, meaning backend, API, UI, loading/empty/error states, mobile
   layout, and tests. No stubs, no `TODO: implement`, no fake data presented as real.
4. Verify it yourself (see "Definition of done"). If something fails, fix it. Do not
   move on and do not tick the box.
5. Tick the box in `docs/ROADMAP.md`, add a line to `docs/PROGRESS.md`
   (date, task, what changed, how it was verified), commit and push.
6. Take the next task. **Do not stop after one task and do not end your turn to ask
   whether to continue. Keep going until every box is ticked or you are truly blocked.**

When a product decision is unclear, pick the option closest to how Quotex behaves,
make it configurable from the admin settings, record the choice under "Decisions" in
`docs/PROGRESS.md`, and continue. Only stop for something that needs the owner, such as
real payment-provider credentials or legal text, and list those in `docs/PROGRESS.md`
under "Blocked on owner".

If the context gets long, summarise progress into `docs/PROGRESS.md`, then continue.

## Definition of done (every task)

- `npm run typecheck` passes for server and web.
- `npm test` passes, and new logic has unit tests. Money paths also need integration tests.
- `npm run build` passes.
- Playwright e2e (added in Phase 0) passes, and new user-facing flows get an e2e spec.
- You ran the app and used the feature in a browser (Playwright or a headless
  browser), at desktop 1440px and phone 390px widths. There are no console errors, no
  horizontal scroll, and no layout breakage.
- There is no regression in flows that already worked: login, place trade, settle,
  deposit, withdraw, tournaments, support, admin.

## Stack and layout

- **Server:** Node 20+, Express, Prisma 5, MySQL 8 / MariaDB 10.4+, `ws` for realtime,
  zod for validation, vitest for tests. ESM (`.js` extensions in imports).
- **Web:** React 18, Vite 5, Tailwind 3, zustand, react-router 6. The design tokens live in
  `web/tailwind.config.js` (`ink-*`, `up`, `down`, `accent`) and `web/src/index.css`.
- npm workspaces: `server/`, `web/`. There's a root script for each common task.

```
server/prisma/schema.prisma     data model; every change ships a migration
server/src/engine/feed.ts       price feed (seeded simulator + Binance stream)
server/src/engine/settlement.ts expiry sweeper
server/src/engine/chain-watcher.ts  deposit confirmations (mock by default)
server/src/services/            trading, wallet ledger, deposits, withdrawals, custody,
                                kyc, promos, referrals, tournaments, support, reset
server/src/routes/              auth, user, market, trades, wallet, tournaments, support, admin
server/src/ws.ts                realtime hub
web/src/pages/                  public pages, terminal, wallet, history, account, admin/*
web/src/components/             chart, ticket, positions, panels, Skeleton kit, admin/ui
web/src/store/                  auth, market, toast, tradingAccount
mockups/                        5 standalone design directions + PHP theme browser
```

## Running it

```bash
npm install
cp server/.env.example server/.env      # set DATABASE_URL and JWT secrets
npm run db:migrate
npx --workspace=server tsx --env-file=.env src/seed.ts   # see gotchas: seed ignores .env
npm run dev          # API :4000, Vite :5173 (proxies /api and /ws)
```

In a fresh cloud container without MySQL: `apt-get install -y mariadb-server`, start
it with `service mariadb start` (or `mysqld_safe &`), create the `quotex` database and
a user, then run the steps above. Use `TEST_DATABASE_URL` for the integration suite.

Seeded logins: `admin@quotexclone.dev` / `Admin123!`, `trader@quotexclone.dev` / `Trader123!`.

Theme mockups: `cd mockups && php -S localhost:8090 index.php`.

## Invariants — never break these

- **Money is integer cents.** No floats ever touch a balance. Crypto amounts are decimal
  strings truncated to network precision.
- **`applyLedger` in `server/src/services/wallet.ts` is the only thing that changes a
  balance.** It writes the transaction row in the same DB transaction and refuses to
  overdraw. New money flows (bonuses, boosters, marketplace, status rewards) go through it.
- **Settlement is idempotent.** A position is priced from the tick at its exact expiry
  instant and can only ever pay once, including under restarts and concurrent sweepers.
  Keep the concurrency integration test green.
- **Market prices never depend on traders' positions.** The OTC engine and any payout
  or risk logic must not read open positions, exposure or a user's history to move a
  price or pick an outcome. Risk controls limit *new* stakes. They never steer the
  quote. This is a hard rule, and it's tested (see Phase 1).
- **Practice, live and tournament balances never mix.**
- Every admin action writes an `AuditLog` row.
- Server input is validated with zod. Every query that takes an id checks ownership (no IDOR).
- Secrets come from env and are never committed. `.env` is git-ignored.

## Known gotchas (already hit on this project)

- `server/src/seed.ts` does not import `dotenv/config`, so `npm run seed` fails with
  "DATABASE_URL not found". Fix that as the first task of Phase 0.
- lightweight-charts asserts markers are in ascending time order. Open trades arrive
  newest first. `PriceChart.tsx` sorts them now, and the crash was a blank terminal on the
  second open trade. The chart is being replaced in Phase 3. Keep the rule in mind for
  any series data.
- There is no React error boundary, so any render error blanks the whole app. Phase 0
  adds one per route.
- Vite on Windows sometimes misses rapid successive writes to the same file and serves a
  stale module. If the browser shows an error the file no longer contains, restart Vite.
- `prisma generate` fails with EPERM on Windows while the API is running, because the
  engine DLL is locked. Stop the API first.
- `migrate deploy` needs no shadow DB (fine for shared hosting). `migrate dev` does.

## Conventions

- Keep the existing patterns. Services hold logic, routes stay thin, and zod schemas
  live at the route.
- The UI must handle every state: skeleton while loading (use `components/Skeleton.tsx`),
  empty, error with retry, and success. Never flash "no data" before data arrives.
- Everything is responsive from 360px up. Tables become cards on phones.
- Accessibility: real buttons and labels, focus states, keyboard support, and
  `prefers-reduced-motion` respected.
- Comments explain *why*, not what. Match the existing comment density.
- Commits are small and focused, one roadmap task per commit or a few, with a clear
  message explaining the change and the reason. Push after each task.

## Brand and legal

The product is **Quantex**. It copies Quotex's *mechanics and feature set*, never its
name, logo, screenshots, copywriting or other assets. Write original copy. Keep the
risk warning on public pages and in the terminal. Real-money launch needs licensing,
KYC/AML and legal pages from the owner. Build the pages and CMS, and put placeholder
legal text clearly marked as such.
