# Quantex — operator manual

For whoever runs the platform day to day: installing it, reading the back
office, and every setting that changes how it behaves. No code in here.

Two logins exist from the start: your **admin** account (you chose it in the
installer) and a **trader** account for testing. The admin account can trade
too — it has its own practice balance — so you can see what a trader sees
without a second browser.

---

## 1. Start here

### Installing

Open the site with no `server/.env` in place and it serves a setup wizard
instead of the app: database connection, admin account, Install. It writes the
configuration, creates the tables, loads the 89 markets, and exits so your
process manager starts it configured. Full detail, including shared hosting, is
in [DEPLOY.md](../DEPLOY.md).

Afterwards the app and the API are one process on one port. Open it, sign in as
the admin, and the back office is the **Admin** link in the header.

### Before you take real money

Work through this list. Each item is explained in its own section below.

| Check | Where | Why |
| --- | --- | --- |
| Deposits are **not** auto-credited | `MOCK_CHAIN_WATCHER=false` in `server/.env` | On, invoices are marked paid by a timer with an invented transaction hash. It is a demo of the flow, not a payment. |
| Real custody is wired | `server/src/services/custody.ts` | Out of the box, deposit addresses are generated, not owned by you. Nothing arrives in them. |
| Admin two-factor is on | Settings → Security | The back office moves money. |
| SMTP is configured | Settings → Email | Otherwise nothing is delivered — mail is only recorded. |
| Password reset tokens are not returned by the API | `EXPOSE_RESET_TOKEN=false` in `server/.env` | A development convenience while there was no mailer. |
| Legal pages say something true | Content → Legal pages | They ship as clearly-marked placeholders. |
| Site address and SEO basics are yours | Settings → General, Settings → SEO | Email links and crawlers use them. |

---

## 2. The back office at a glance

The sidebar groups the work:

- **Overview — Dashboard.** KPIs for a period you choose, the queues waiting on
  you, charts, and a live feed of what is happening right now.
- **Money.** Withdrawals, Deposits, Payment methods, Ledger, Referrals.
- **Traders.** Users, Verification (KYC), Trades, Support.
- **Platform.** Tournaments, Content, Promo codes, Bonus offers, Marketplace,
  Markets, Sessions, Price engine, Payouts, Risk, Email, Admin users, Settings,
  Audit log.

Every list works the same way: a search box, filters, sortable columns, a column
chooser, CSV export of everything the filters match, and paging. The state lives
in the address bar, so a filtered list can be sent to someone else as a link.

Every action an administrator takes is written to the **Audit log** with who,
what and when.

---

## 3. Deposits

This is the part most operators ask about, so it is the longest section.

### How a crypto deposit works here

1. The trader picks a method (coin + network) and an amount.
2. The platform shows an address, the exact crypto amount to send, and a rate
   that is locked for the life of the invoice.
3. The trader sends the coins. The platform watches for the transaction.
4. After the method's required confirmations, the balance is credited and a
   ledger row is written. The trader sees it immediately.

An invoice that is not paid inside its window expires. Nothing is credited.

### The setting that bites people

`MOCK_CHAIN_WATCHER` in `server/.env`:

- `false` — deposits wait for a real confirmation. **This is what you want.**
- `true` — any pending invoice is marked paid roughly twenty seconds later, with
  a made-up transaction hash, and the money lands in the live balance. It exists
  so the flow can be demonstrated end to end without a chain. It is not a
  payment, and the balance it creates is not real money.

Changing it needs a restart. Installs made before October 2026 wrote `true`;
check yours.

### Receiving real coins

Deposit addresses come from `server/src/services/custody.ts`, which ships as a
mock: it derives plausible addresses that nobody owns. Until a developer
implements that interface against your own node, exchange sub-account or
custody provider (Fireblocks, BitGo, Tatum and so on), **coins sent to those
addresses are gone.** Nothing else in the platform talks to a wallet, so this is
the only piece to replace.

### Per-method settings — Money → Payment methods

Each row is one way to pay. Add, edit, enable or disable without touching code.

| Field | What it does |
| --- | --- |
| Label | What the trader sees. |
| Currency / network | e.g. USDT on TRC20. The network decides the address format and the confirmations. |
| Enabled | Off hides it from the trader immediately; existing invoices are unaffected. |
| Fee % and flat fee | Charged on withdrawals through this method. Shown in the quote before the trader confirms. |
| Min / max deposit | Per method. `0` on a maximum means no cap. The platform-wide minimum still applies. |
| Min / max withdrawal | Same, for money going out. |
| Countries | Empty means everywhere. Otherwise only those countries see it. |
| Sort order | The order they are listed in. |

### Platform-wide deposit settings — Settings → Payments

| Setting | What it does |
| --- | --- |
| Minimum deposit (USD) | The floor under every method. A method may be stricter, never looser. |
| Deposit invoice validity (minutes) | How long a quoted rate and address stay good. |
| Deposit bonuses | Master switch for bonus offers (below). |
| Default turnover multiplier | How much volume a bonus must be traded through before it can be withdrawn. |

### Watching deposits — Money → Deposits

Every invoice with its status: awaiting payment, confirming, completed,
expired. Open a row for the address, the amount, the transaction hash and which
trader it belongs to. Nothing needs approving — a confirmed deposit credits
itself — but this is where you look when a trader says money is missing.

### Giving a bonus on a deposit

- **Bonus offers** (Platform → Bonus offers) are standing offers: a percentage,
  a minimum deposit, a cap, and a turnover requirement. The trader chooses one
  while depositing.
- **Promo codes** (Platform → Promo codes) are typed in: a percentage or a flat
  credit, with minimums, caps, redemption limits and an expiry.

Both are credited in the same database transaction as the deposit itself, so a
bonus can never be paid twice or paid for a deposit that failed. Bonus money is
locked until the turnover requirement is met; the trader sees the progress.

---

## 4. Withdrawals

Money going out is the one flow that waits for a human, unless you say otherwise.

**Money → Withdrawals** is the queue. Each request shows the trader, the amount,
the destination, the fee quote and the KYC state. Approve pays it out; reject
asks for a note — the trader sees it — and refunds the held amount in full.

Funds are **held** the moment a request is made, so the trader cannot spend the
same balance twice while it waits.

Settings → Payments:

| Setting | What it does |
| --- | --- |
| Minimum withdrawal (USD) | The floor under every method. |
| Withdrawal fee (%) and flat fee (USD) | Your fee, on top of any network fee. Quoted before the trader confirms. |
| Auto-approve withdrawals | Skips the queue entirely. Only turn this on if something else is checking payouts. |
| Max withdrawals in progress per trader | Stops a queue being flooded by one account. |
| Maximum withdrawn per trader per day (cents) | A daily ceiling. `0` means uncapped. |

Settings → Compliance:

| Setting | What it does |
| --- | --- |
| Require verified identity to withdraw | Blocks withdrawals until KYC is approved. |
| Verification threshold (USD) | Only require it above this amount. `0` means always. |

---

## 5. Traders

**Traders → Users** lists every account: balances, lifetime deposits and
withdrawals, verification and status. Open one for a full profile — trades,
deposits, withdrawals, ledger, bonuses, referrals, tickets, devices and notes.

Row actions: **adjust balance** (asks for an amount and a reason, writes a ledger
row and an audit entry — it is never silent) and **suspend / activate**.

**Traders → Verification** is the KYC queue. A submission carries the declared
details and a document reference; approve or reject with a note. Identity
documents are not stored in the trading database.

**Traders → Trades** is every position taken, filterable by market, trader,
account type and result. **Traders → Support** is the inbox for the chat widget;
replies reach the trader without a refresh.

---

## 6. Markets and prices

**Platform → Markets** lists all 89: currencies, crypto, commodities, stocks and
indices, each with an OTC twin where one exists. Per market you set the payout,
the minimum and maximum stake, decimals, whether it is enabled, and its order in
the list.

**Platform → Sessions** holds the trading calendars — weekly hours and holidays,
shared by venue, so one edit moves every market on it. A closed market cannot be
traded; the terminal says when it reopens and offers the OTC twin. Crypto and OTC
markets have no calendar: they are always open.

**Platform → Price engine** configures the broker-priced feed per market:
volatility, how much of the time it trends, how long a trend or a range lasts,
how fast it returns to its anchor, and how large a sudden move may be. There is a
preview chart before you save, and changes apply to the running feed without a
restart.

One rule is built in and tested: **prices never depend on anybody's positions.**
The engine cannot see open trades, exposure or who is winning. Risk is managed by
limiting what may be staked, never by moving a quote.

**Platform → Payouts** sets the base payout per market and the rules that adjust
it — by time of day, by volatility, or on a schedule. The payout is locked when a
position opens, so a later change never affects a trade already placed.

**Platform → Risk** shows live exposure per market and direction, and the limits:
maximum stake per trade, maximum open stake per trader, and maximum exposure per
direction. Past a limit, **new** trades are refused with a clear message.

---

## 7. Growth

**Settings → Growth** carries the programmes:

- **Referrals.** A percentage of every deposit made by an invited trader, paid to
  the referrer automatically.
- **Status levels.** Three tiers by lifetime deposits, each with its own name,
  threshold, payout bonus (in percentage points, up to a ceiling) and deposit
  bonus.
- **Experience and achievements.** XP per dollar staked, per win and for the
  first position of the day, with a level curve. Can be switched off.
- **Marketplace.** Items traders buy with loyalty points: payout boosters,
  risk-free trades, deposit coupons, practice refills. Stock them in
  Platform → Marketplace items.

**Platform → Tournaments.** Create a contest with an entry fee, a starting chip
stack, a prize table and a window. Entrants trade chips on live prices; the
leaderboard pays out real money at the end. Chips never touch a cash balance.
Positions still open at the bell are refunded in chips, and an entry fee is
refunded if you cancel.

---

## 8. The public site

**Platform → Content** is the CMS: homepage sections, FAQ entries, testimonials,
legal pages and the announcement banner. Everything has a draft and a published
state, with a preview.

**Settings → SEO** controls what crawlers and link previews see: the title
template, meta description, Open Graph image, canonical base URL, whether the
site may be indexed at all, the sitemap, and your analytics and verification
codes. There is also a custom `<head>` snippet for anything else.

**Settings → Localisation** lists the languages traders may choose.

---

## 9. Security

**Settings → Security:**

| Setting | What it does |
| --- | --- |
| Admin accounts must use two-factor | On by default, and it should stay on. See the note below. |
| Email verification | Off, optional, or required before money moves. |
| Email on a sign-in from a new device | Tells the trader. |
| Password rules | Minimum length, mixed case, a number, a symbol. |
| Session lifetime (days) | How long a signed-in device stays signed in. |
| Sign-in attempts per 15 minutes, lockout attempts and window | Brute-force limits. |
| Deposit/withdrawal requests per hour, password/2FA changes per hour | Abuse limits. |
| API requests per minute, per IP | The general rate limit. |
| Allowed CORS origins | Which sites may call your API. |

**If two-factor locks you out of your own back office** — no authenticator to
hand — the switch lives behind the gate it controls, so turn it off from a shell
on the server:

```bash
npm run admin:2fa -- off     # requirement off
npm run admin:2fa -- on      # back on
npm run admin:2fa            # what it is now
```

Turn it back on once you can enrol.

**Platform → Admin users** manages staff and their roles: super admin, finance,
risk, support, content. A role only sees the sections its permissions cover.

---

## 10. Everyday operation

A reasonable daily pass:

1. **Dashboard** — net deposits, house P&L, and whether anything sits in the
   three queues.
2. **Withdrawals** — clear the queue.
3. **Verification** — clear the KYC queue.
4. **Support** — answer what is waiting.
5. **Risk** — glance at live exposure if volumes are growing.

**Maintenance mode** (Settings → General) blocks trading and payments for
everyone except administrators and the IPs you allowlist, and shows the message
you set. Use it for database work or a release.

---

## 11. When something looks wrong

| Symptom | Likely cause |
| --- | --- |
| A deposit was credited that nobody paid | `MOCK_CHAIN_WATCHER=true`. Set it to `false` and restart. |
| Real coins were sent and nothing arrived | The mock custody provider is still in place; the addresses belong to nobody. |
| No email ever arrives | No SMTP configured. Settings → Email, then send a test. |
| Admin panel refuses an admin | Two-factor is required and not enrolled. Account → Security, or the shell command above. |
| A market shows "closed" | Its trading calendar. Platform → Sessions, or trade the OTC twin. |
| Prices are marked "broker price" on a real market | No market-data key configured, so the platform prices it itself. |
| A page of the site looks stale after a deploy | The browser cached the old build. A hard refresh (Ctrl+Shift+R) proves it. |

Anything that touches money leaves a trail: the **Ledger** has every balance
change with the balance after it, and the **Audit log** has every administrative
action. Between them, any figure on the platform can be explained.

---

## 12. Words used here

- **Payout** — the percentage profit a winning position returns. 87% on $100
  returns $87 profit plus the $100 stake.
- **OTC market** — priced by the platform rather than an exchange, so it trades
  24/7. Marked as OTC everywhere a trader sees it.
- **Practice account** — play money, same engine and same prices. It can be
  refilled and never touches real balances.
- **Tournament chips** — the stack inside a contest. Not money; prizes are.
- **Turnover requirement** — how much volume bonus money must be traded through
  before it can be withdrawn.
- **Hold** — money reserved for a withdrawal in progress, so it cannot be spent
  twice.
