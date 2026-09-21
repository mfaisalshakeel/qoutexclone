# Quantex roadmap — build to Quotex level

This is the complete scope. Work top to bottom. A box is ticked only when the task meets
the "Definition of done" in `CLAUDE.md`. Each task names its **acceptance criteria**, and
they are the minimum, not a ceiling.

**Reference behaviour:** Quotex (qxbroker.com). When you have web access, study its public
help centre, FAQ, and trading-platform walkthroughs to confirm details such as expiry
rules, OTC behaviour, status levels, tournament and marketplace rules, and the admin
concepts a broker needs. Replicate the *behaviour*, but write original copy and assets.
Numbers below are defaults. Every one of them must be admin-configurable.

---

## Phase 0 — Foundations (do first, everything else depends on it)

- [x] **Fix seed env loading.** `server/src/seed.ts` loads `dotenv/config`. `npm run seed` works from root and server.
- [x] **Error boundaries.** A route-level boundary on every page shows a friendly error with a "reload" button and logs the error. The terminal chart gets its own boundary, so a chart failure never blanks the page. Test: throw inside a child and assert the boundary renders.
- [x] **Lint and format.** ESLint (typescript-eslint, react-hooks, jsx-a11y) plus Prettier, with `npm run lint` at the root, zero warnings, run in CI.
- [x] **E2E harness.** Playwright is in the repo with specs for register → login → place a practice trade → settles → appears in history, deposit invoice flow, admin approve withdrawal. Runs in CI against MySQL service. Also `npm run e2e`.
- [x] **Env validation.** The server validates env with zod at boot and fails fast with a clear message.
- [x] **Structured logging.** pino with request ids, logs for HTTP, settlement and ws events, and no secrets in logs.
- [x] **Runtime settings service.** A typed settings registry over the `Setting` table. Each key has a zod schema and a default, reads are cached, and writes invalidate the cache and broadcast over ws. Every "configurable" item in this roadmap reads from here.
- [x] **Health and readiness.** `/api/health` (liveness) and `/api/ready` (DB and feed ok). Graceful shutdown drains HTTP, ws and the settlement loop.
- [x] **React Router future flags** set (`v7_startTransition`, `v7_relativeSplatPath`), with no console warnings.
- [x] **API client.** Typed errors, retry with backoff on network failure for GETs, and auth refresh single-flight (no refresh storms).

## Phase 1 — Markets, asset pairs and the OTC engine

- [x] **Asset model.** Assets have `class` (CURRENCY, CRYPTO, COMMODITY, STOCK, INDEX), `base`, `quote`, display `pair` (e.g. `EUR/USD`, `BTC/USDT`, `XAU/USD`), `isOtc`, `precision`, `pipSize`, `minStake`, `maxStake`, `enabled`, `sortOrder`, `icon`. Migration included, with the existing assets migrated.
- [x] **Market catalogue seed.** At least 20 currency pairs (majors and crosses), 12 crypto pairs vs USDT, gold/silver/oil, 10 large-cap stocks and 5 indices. Every currency pair and a selection of the others also exist as an `(OTC)` variant.
- [x] **Trading sessions.** Non-OTC assets have weekly schedules and holidays (admin-editable). A closed market can't be traded, is shown as closed with its next open time, and the OTC variant is suggested. OTC trades 24/7.
- [x] **OTC price engine.** This is a broker-generated feed per OTC asset, replacing the single random walk:
  - seeded, deterministic per asset and continuous across restarts (persist the last state)
  - realistic microstructure: volatility clustering (GARCH-like), trend and range regimes with random durations, mean reversion to a slowly drifting anchor, occasional spikes within configured bounds, and no impossible gaps
  - per-asset admin config: base volatility, regime mix, spike frequency/size, anchor drift, and tick rate
  - when a real market is open, the OTC anchor can optionally follow the real price. When it's closed, it evolves on its own
  - **must not read positions, exposure or user data.** Add a test that runs the engine with different open-position sets and asserts identical price paths for the same seed
- [x] **Real feeds.** Keep the Binance adapter for crypto. Add a provider interface for forex/stocks/indices, with one free/delayed implementation or a documented stub that falls back to OTC-style simulation, clearly labelled. Auto-fallback and reconnect with backoff.
- [x] **Candle storage.** Ticks go to rolling candles at 5s, 10s, 15s, 30s, 1m, 2m, 3m, 5m, 10m, 15m, 30m, 1h, 4h, 1d, persisted with retention per timeframe. The history endpoint is paginated backwards for infinite scroll. The chart never shows a gap after a restart.
- [x] **Payout engine.** Each asset has a base payout. Adjustments can come from time-of-day, volatility, or schedule (e.g. lower on news hours), each rule configurable. A user status bonus is added (Phase 4). The payout is locked at the moment the trade opens and is shown live on the ticket.
- [x] **Risk limits.** Per asset: max stake per trade, max open stake per user, and max total open exposure per direction. Beyond a limit, *new* trades are rejected with a clear message. Admin sees live exposure. (Never alters price.)

## Phase 2 — Trading terminal parity

- [x] **Expiry modes.** (a) *Duration*: 5s, 10s, 15s, 30s, 1m, 2m, 3m, 5m, 10m, 15m, 30m, 1h, 4h (configurable per asset). (b) *Clock time*: expiry at the next valid candle boundaries (e.g. 12:05, 12:10), with a configurable purchase cut-off before expiry and a live "time to purchase" countdown. Server validates both.
- [x] **Pending trades.** Open when the price reaches a level, or at a set time. They're cancellable and listed separately. The server executes them from the feed with the same idempotency guarantees.
- [x] **Ticket UX.** Amount with presets, ± steps, balance-percentage shortcuts, per-asset min/max enforced, live payout % and profit, and "double up" (repeat the same trade) from an open position if allowed by settings.
- [x] **Hotkeys.** Configurable shortcuts for up, down, amount ±, expiry ±, and next/previous asset, with a help overlay (`?`). Can be turned off in settings.
- [x] **Asset picker.** Tabs by class, favourites (persisted), search, sort by payout/name/change, OTC badge, open/closed state, and payout shown per asset. Recent assets appear as tabs above the chart, as in Quotex.
- [x] **Multi-chart layouts.** 1, 2 (horizontal/vertical) or 4 charts, each with its own asset/timeframe, and trade from the focused one. Layout is persisted per user.
- [x] **Positions panel.** Open trades show a live countdown and progress, a winning/losing tint, and potential result. Closed trades show the result, and a detail modal shows the entry/exit chart snippet. There's also a "Trade again" action.
- [x] **Trader sentiment.** Per asset, the % of stake on UP vs DOWN over the last N minutes, from real platform data.
- [x] **Top traders today.** A leaderboard by daily profit, with anonymised names, country flag, and an opt-out in settings.
- [x] **Signals / notifications.** In-app notification centre (trade results, deposits, tournament starts, support replies), sound effects with a mute toggle, and browser notifications with permission.
- [x] **Account switcher.** Live, practice and each joined tournament. Practice refill is available when the balance is below a configured amount.
- [x] **Mobile terminal.** Full-bleed chart, bottom sheet ticket, swipeable positions, safe areas, and no layout shift. It must feel like a native app at 390px.

## Phase 3 — Own charting engine (remove TradingView / lightweight-charts)

- [x] **Renderer.** A canvas chart in `web/src/chart/` with no third-party charting library, and `lightweight-charts` removed from dependencies. There's a layered render loop (grid, series, overlays, crosshair) on `requestAnimationFrame` with dirty flags, and HiDPI support.
- [x] **Series types.** Area/line, candles, bars and Heikin-Ashi, switchable without refetch.
- [x] **Interaction.** Pan (drag, wheel, touch), zoom (wheel, pinch, buttons), autoscale, crosshair with OHLC tooltip, price and time axis labels in the user's timezone, "scroll to live" button, and kinetic scrolling on touch.
- [x] **Trading overlays.** Strike lines per open trade with stake and live P/L tags, an expiry vertical line with countdown, the purchase cut-off zone for clock-time mode, and a current price line with a pulsing last-tick dot.
- [x] **Indicators.** SMA, EMA, WMA, Bollinger Bands, RSI, MACD, Stochastic, ATR, ADX, Parabolic SAR, Ichimoku, Alligator, Awesome Oscillator, CCI, Williams %R, Momentum, Donchian, Keltner, SuperTrend, ZigZag, Fractals. Sub-panes for oscillators. A settings modal per indicator (periods, colours), persisted per user. Pure functions have unit tests.
- [x] **Drawing tools.** Trend line, horizontal line/ray, vertical line, rectangle, Fibonacci retracement, text note. Select, drag, delete, lock, and persisted per user per asset.
- [x] **Performance.** 60fps pan/zoom with 5,000 candles on a mid-range phone profile. Measure with a Playwright performance trace and record the numbers in PROGRESS.
- [x] **Visual tests.** Playwright screenshot tests for each series type, overlays and indicators.

## Phase 4 — Accounts, status and engagement

- [x] **Registration and security.** Email verification, password strength meter, 2FA (TOTP with backup codes), session/device list with "log out other devices", login history with IP/device, and new-device email alerts.
- [x] **Email.** A nodemailer SMTP transport configured from admin settings, with templated HTML emails (verify, reset, deposit credited, withdrawal status, KYC result, tournament result) and a preview in admin. Ends `EXPOSE_RESET_TOKEN`.
- [x] **Status levels.** Standard, Pro and VIP (names, thresholds and perks configurable). They're reached by lifetime deposits, and perks include a payout bonus (default +2% / +4%), withdrawal priority, and deposit bonus %. Status is shown in the header, and there's a progress page.
- [x] **Experience and achievements.** XP from trading volume and activity, levels, and achievement badges with progress. Configurable, and can be turned off.
- [x] **Marketplace.** Items bought with points or balance: payout boosters (+X% for N minutes), risk-free trades (stake refunded on loss, capped), deposit bonus coupons, and practice refills. There's an inventory, activation and expiry. Every effect goes through the ledger and is audited.
- [x] **Bonuses.** A deposit bonus choice at deposit time, and a turnover requirement before a bonus becomes withdrawable (shown as a progress bar). Admin controls rules.
- [x] **Responsible trading.** Daily loss limit, deposit limit, session reminder and self-exclusion period, enforced server-side.
- [x] **Profile.** Avatar, country, timezone, language, currency display, and notification preferences.

## Phase 5 — Payments

- [x] **Provider framework.** A `PaymentProvider` interface (create deposit, webhook verify, payout) with registry and admin enable/disable, fees, limits per method, and countries.
- [ ] **Methods.** Crypto (existing flow kept) plus a sandbox card gateway and an e-wallet provider behind the interface, with signed webhooks and idempotent crediting. Real credentials are listed as "Blocked on owner".
- [ ] **Withdrawals.** Method-specific fields and validation, KYC gate, bonus turnover gate, daily limits, and an admin review queue with notes. The trader sees the status timeline.
- [ ] **Wallet UI.** Method grid with logos, limits and fees shown up front, transaction timeline, and downloadable statements (CSV/PDF).

## Phase 6 — Admin back office (must be excellent)

### Dashboard
- [ ] **Period selector** (today, yesterday, 7d, 30d, this month, custom range) and comparison vs the previous period with ▲▼ deltas on every KPI.
- [ ] **KPIs:** registrations, first-time depositors, deposit volume, withdrawal volume, net deposits, house P&L (live accounts), trading volume, active traders, average stake, win rate (platform), pending queues (withdrawals, KYC, tickets), bonus cost.
- [ ] **Charts:** deposits vs withdrawals over time, house P&L over time, registrations and FTD funnel, volume by asset class and top 10 assets, live exposure per asset/direction, hourly activity heatmap. Built with a real chart library for admin, or the Phase 3 engine, and they must be fully responsive.
- [ ] **Live panels:** latest trades stream (ws), latest deposits/withdrawals, online users count, and system health (feed status per provider, settlement lag, ws connections).

### Data tables — one reusable, server-driven `DataTable`
- [ ] **Server:** a generic list endpoint helper with pagination (page + pageSize + total, and cursor for huge tables), multi-column sort, text search across configured fields, typed filters (enum multi-select, date range, number range, boolean), and CSV export of the full filtered result (streamed). Indexed queries only. Add the DB indexes needed.
- [ ] **Client:** search box with debounce, filter bar with chips, column show/hide, sortable headers, page size selector, page numbers, sticky header, row selection with bulk actions, and a row click that opens a detail drawer. State is synced to the URL (shareable, back button works), with skeleton rows while loading, and empty and error states. Cards on phones.
- [ ] **Applied to every admin list:** users, trades, deposits, withdrawals, ledger transactions, KYC submissions, support tickets, tournaments and entries, promo codes and redemptions, referrals/commissions, marketplace orders, assets, and the audit log.

### Management
- [ ] **User 360 page.** Profile, balances per account, status, KYC, devices/sessions, trades, deposits, withdrawals, ledger, bonuses, referrals, tickets, notes, and audit trail. Actions: suspend, force logout, reset 2FA, adjust balance (with reason, audited), change status level, and send email.
- [ ] **Roles and permissions (RBAC).** Super admin, finance, risk, support and content roles, with permission checks on every admin route and hidden UI for disallowed actions. Admin users are managed with 2FA required.
- [ ] **Assets and risk.** Edit assets, sessions, payout rules, OTC engine parameters (with a live preview chart of the generated feed), and risk limits.
- [ ] **Tournaments.** Create/edit with rules (entry fee, rebuys, prize distribution table, starting balance, allowed assets), monitor the leaderboard live, and cancel with refunds.
- [ ] **Content CMS.** Homepage sections, FAQ, legal pages, announcements banner, and email templates. There's a markdown/rich editor with preview and publish/draft.

### Settings (all persisted through the Phase 0 settings service, each page validated)
- [ ] **General:** site name, logo (light/dark), favicon, support email, default currency, timezone, default language, maintenance mode (with allowlist IPs and message).
- [ ] **Trading:** expiry lists, purchase cut-off, min/max stake, practice balance and refill rules, hotkeys on/off, and top-traders opt-out default.
- [ ] **Payments:** methods, fees, limits, KYC thresholds, and auto-approve rules.
- [ ] **Growth:** referral %, status levels, bonuses, marketplace items, and XP rules.
- [ ] **Email/SMTP** with a "send test email" button.
- [ ] **SEO:** default title template, meta description, keywords, OG image, Twitter card, canonical base URL, robots rules, sitemap on/off, Google Analytics / GTM ids, Search Console verification, and custom `<head>` snippet (sanitised).
- [ ] **Security:** password policy, 2FA enforcement for admins, session lifetime, rate limits, and allowed CORS origins.
- [ ] **Localisation:** enabled languages and translation overrides.

## Phase 7 — Public website, homepage and SEO

- [ ] **Homepage** (the first impression, must be outstanding and original). Sections:
  1. hero with headline, sub-copy, primary CTA "Start trading" and secondary "Try practice account", and a *live* animated chart/terminal preview using the real feed
  2. live markets strip/table with payouts
  3. how it works in 3 steps
  4. platform showcase on desktop and mobile devices
  5. features grid (fast deposits, OTC 24/7, 20+ indicators, tournaments, practice account, mobile)
  6. account status levels comparison
  7. tournaments teaser
  8. payment methods logos
  9. security and risk-disclosure block
  10. testimonials (CMS)
  11. FAQ accordion (CMS)
  12. final CTA
  13. footer with legal links, risk warning and language switch

  Fully responsive, animated with restraint, respects reduced motion, and all text comes from the CMS.
- [ ] **Public pages:** Markets, Tournaments, Status levels, Affiliate programme, Help centre/FAQ with search, Contact (form into support tickets), About, and the legal set (Terms, Privacy, Risk disclosure, AML/KYC policy, Cookie policy) with a cookie consent banner. Plus 404 and 500 pages.
- [ ] **Rendering for SEO.** Public routes are server-rendered or prerendered at build (e.g. vite SSR/prerender) so crawlers get full HTML. The app shell stays a SPA.
- [ ] **Meta.** Per-route title, description, canonical, Open Graph and Twitter tags, generated from CMS/settings. JSON-LD for Organization, WebSite (with SearchAction) and FAQPage.
- [ ] **`/sitemap.xml` and `/robots.txt`** are generated from routes and settings. Clean URLs, correct status codes, and `hreflang` when multiple languages are enabled.
- [ ] **Internationalisation.** i18n framework across app and site, with English complete and at least one more language wired end to end (RTL-safe layout).
- [ ] **Performance and quality.** Lighthouse mobile on the homepage scores ≥ 90 for Performance, Accessibility, Best Practices and SEO (record the scores in PROGRESS). Images are optimised (AVIF/WebP, sizes), fonts preloaded, code split per route, and there's no CLS from late-loading content.

## Phase 8 — Hardening and release

- [ ] **Security review.** Authz tests for every route (user vs admin vs other user), rate limits per sensitive route, CSP without `unsafe-inline` scripts, secure cookies if cookies are used, dependency audit clean, file upload validation (KYC documents to object storage interface), and brute-force lockout.
- [ ] **Data.** Indexes reviewed with `EXPLAIN` on the heavy queries, DB backups documented, soft-delete/retention policy, and GDPR-style data export/delete for a user.
- [ ] **Scale.** Realtime fan-out through a pub/sub interface (in-memory by default, Redis adapter), settlement safe with multiple API instances, and a load test (k6) of 1,000 concurrent traders placing trades with results recorded.
- [ ] **Observability.** Error tracking hook (Sentry-compatible), metrics endpoint (Prometheus format: trades/s, settlement lag, ws clients, feed staleness), and alerts documented.
- [ ] **Deployment.** Production Docker compose with nginx (TLS, gzip/brotli, caching headers, ws upgrade), migrations on deploy, and a zero-downtime restart procedure. The README is updated and a cPanel/VPS guide is kept.
- [ ] **Final pass.** Every page at 360/390/768/1024/1440 widths, light and dark themes, keyboard-only navigation, and the full e2e suite green. Update screenshots in `docs/screenshots`.

## Design direction

`mockups/` holds five approved directions (Aurora Glass, Swiss Editorial, Pro Terminal,
Soft Pastel App, Neo Brutalist). Build the UI on **design tokens** (CSS variables mapped
into Tailwind) so a theme preset can be switched from admin settings. Ship the current
dark theme and a light theme first. Implement additional presets based on the mockups once
the owner names a favourite (check `docs/PROGRESS.md` → Decisions).
