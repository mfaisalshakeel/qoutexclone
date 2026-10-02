# Taking real crypto, self-hosted

A plan for replacing the mock custody provider with one that actually receives
and sends money, on hardware the operator controls.

Written against the code as it stands: `CustodyProvider` in
`server/src/services/custody.ts` is the one interface the platform uses to talk
to a wallet, the `PaymentProvider` framework in `server/src/services/payments.ts`
wraps it per method, and `server/src/engine/chain-watcher.ts` is the loop that
currently fakes confirmations.

Figures are 2026 estimates. Check current prices and chain sizes before buying.

---

## 1. The idea in one line

**Hold your own keys; read the chain through whatever is cheapest.**

Running a node and owning your coins are separate decisions, and conflating
them is what makes people think this needs a $200/month server. Addresses are
derived from a seed that never leaves your VPS. Watching for incoming
transfers, and broadcasting outgoing ones, is read/write traffic that a public
RPC can serve without ever seeing a private key.

Run your own node where it is cheap (Bitcoin, pruned). Use an RPC provider
where a node costs more than the business it serves (Tron, Ethereum). Both
cases are self-custody: the provider can rate-limit you or lie about a balance,
but it cannot move a coin.

---

## 2. What to support, in order

1. **USDT on TRC20 (Tron).** Where the money actually arrives. Transfer fees are
   cents, confirmations are seconds, and it is what traders already use.
2. **BTC.** Second, because some people insist. A pruned Bitcoin Core node plus
   BTCPay Server is genuinely self-hosted and runs on the same VPS.
3. **USDT on ERC20 (Ethereum).** Last, and only because people ask. Gas makes a
   small deposit uneconomic; offer it, expect little.

Nothing stops you shipping only (1) first. It is one network, one watcher, one
sweep job.

---

## 3. Hardware and cost

| Piece | Spec | Monthly |
| --- | --- | --- |
| App + MySQL | 4 vCPU, 8 GB RAM, 160 GB NVMe (Hetzner CPX31, Contabo VPS M) | $15–40 |
| Tron RPC | TronGrid free tier to start; NowNodes/GetBlock when it is not enough | $0–50 |
| Bitcoin, pruned node + BTCPay | ~80 GB and 2 GB RAM on top of the above, or its own small box | $0–20 |
| Ethereum RPC | Alchemy/Infura free tier | $0 |
| **Start** | | **$20–60** |

What a full node costs, for comparison, so the decision is informed:

| Chain | Full node | Monthly |
| --- | --- | --- |
| Tron | ~2.5–3 TB NVMe, 32 GB RAM | $60–120 |
| Ethereum | ~2 TB+ NVMe, 32 GB RAM, execution + consensus client | $60–120 |
| Bitcoin (unpruned) | ~1 TB | $20–40 |

### The Tron fee nobody budgets for

TRC20 has no memo field, so every trader gets their own address, and money has
to be **swept** from those addresses into one hot wallet. Each sweep is a TRC20
transfer that costs energy and bandwidth: roughly $1–2 of TRX at spot, or close
to nothing if you stake TRX for energy. Sweeping also needs the deposit address
to hold a little TRX for bandwidth, so the sweeper funds it first.

Budget for it: stake 3,000–5,000 TRX once (a few hundred dollars, and you keep
the TRX — staking is not spending), or accept a couple of dollars per deposit.
Sweep on a threshold, not on every arrival: leave small amounts to accumulate.

---

## 4. Architecture

```
trader                 platform (your VPS)                 chain
  |                         |                               |
  |-- open a deposit ------>| derive address from xpub      |
  |<-- address + amount ----| (key material never leaves)   |
  |                         |                               |
  |-- sends USDT ---------------------------------------->  |
  |                         |  watcher polls RPC for        |
  |                         |  transfers to that address  <-|
  |                         |  N confirmations -> credit    |
  |                         |                               |
  |                         |  sweeper moves it to the  --> |
  |                         |  hot wallet over a threshold  |
  |                         |                               |
  |-- asks to withdraw ---->| admin approves in the queue   |
  |                         |  hot wallet signs, broadcasts |
  |<-- paid -----------------------------------------------|
```

### Wallet layout

- **Hot wallet** — one per chain, on the VPS, holding only what withdrawals need
  for a day or two. Encrypted at rest, decrypted into memory at boot with a
  passphrase supplied out of band.
- **Cold wallet** — a hardware wallet in your hand, holding the rest. The
  sweeper tops the hot wallet up from cold manually, on your decision. Nothing
  automated ever moves money out of cold storage.
- **Deposit addresses** — derived from an extended public key (xpub). The VPS
  can compute every address and watch it without holding a spending key for it;
  the matching private keys are derived only when the sweeper runs, from the
  seed it unlocks for the job.

The ratio to aim for: if a day's withdrawals are $2,000, hold $3,000–5,000 hot
and everything else cold. A compromise of the VPS then costs you that float,
not the business.

---

## 5. What to build, in the codebase

Four pieces, in this order. Each is independently testable on a testnet.

### A. `HdCustodyProvider` — `server/src/services/custody.ts`

Implements the existing interface against a real wallet:

- `getDepositAddress(userId, currency, network)` — BIP44 derivation from the
  seed, deterministic per user and network, recorded in `DepositAddress` so the
  same trader always sees the same address.
- `sendPayout({ currency, network, address, amount, reference })` — build, sign
  and broadcast from the hot wallet; return the real transaction hash.

Keys come from a seed file or env var that is **not** `JWT_SECRET` (the mock
reuses it, which is fine for a mock and unacceptable for money).

Libraries: `tronweb` for Tron, `bitcoinjs-lib` + the BTCPay Greenfield API for
Bitcoin, `ethers` for Ethereum.

### B. Real confirmation — replace `engine/chain-watcher.ts`

The mock credits on a timer. A real watcher, per network:

1. Poll the RPC for transfers to any address the platform has issued (Tron:
   `/v1/accounts/{address}/transactions/trc20`; Bitcoin: BTCPay webhook or
   Core's `listsinceblock`; Ethereum: `eth_getLogs` on the token contract).
2. First sighting → `markSeen(depositId, txHash)`, which shows the trader that
   the payment has been noticed.
3. At the network's required confirmations → `completeDeposit(depositId)`, which
   credits through the ledger exactly once.

Both functions already exist in `server/src/services/deposits.ts` and are
idempotent; the mock watcher calls them too, so this is a swap, not a rewrite.
Set `MOCK_CHAIN_WATCHER=false` and the mock is out of the way.

**Rules that matter:** credit on the amount that actually arrived, not the
amount invoiced — people send approximately. Handle underpayment (credit what
came, leave the invoice open or refund), overpayment (credit it all), and late
payment after expiry (credit it; the money is yours to return otherwise).

### C. Sweeper — new, scheduled

Moves balances from deposit addresses into the hot wallet once they pass a
threshold. On Tron, funds the address with bandwidth TRX first. Records every
sweep so a reconciliation can prove where each deposit went. This job holds
spending keys, so it should be the only place that unlocks the seed.

### D. Withdrawals

`payout()` in `server/src/services/providers/crypto.ts` already routes to
custody; with (A) in place it sends for real. Add to the admin flow:

- an address allowlist cool-off (a new address cannot be paid for N hours),
- a daily platform-wide payout ceiling, separate from the per-trader one,
- a "mark as sent manually" path with a pasted transaction hash, for the days
  the hot wallet is empty and you pay from cold.

---

## 6. Order of work

| Step | What | Done when |
| --- | --- | --- |
| 1 | HD custody for Tron, testnet (Nile) | A derived address receives test USDT and the sweeper moves it |
| 2 | Tron watcher | A real testnet payment credits the right trader, once, at the right confirmations |
| 3 | Withdrawals on testnet | Admin approves, chain shows the transfer, the ledger matches |
| 4 | Mainnet with a cap | Real money, `maxDailyWithdrawalCents` low, you watching every row |
| 5 | BTCPay + pruned node | Bitcoin deposits and payouts, same shape |
| 6 | Ethereum RPC | ERC20, if anyone asks for it |

Steps 1–4 are the product. Do not start 5 until 4 has run for a week without a
surprise.

---

## 7. Operating it

- **Reconcile daily.** Chain balance versus the sum of the ledger. They must
  agree; a discrepancy is either a missed deposit or a bug, and both need
  finding the same day.
- **Alert on**: watcher not having seen a block in 10 minutes, hot wallet below
  a day's withdrawals, a payout that failed to broadcast, and a deposit credited
  without a matching chain transaction.
- **Back up the seed** the way you would back up the business, because that is
  what it is: offline, in more than one place, tested by restoring it.
- **Keep the mock off.** `MOCK_CHAIN_WATCHER=true` on a server that holds real
  money credits invoices nobody paid.

---

## 8. Before any of this takes a customer's money

Self-hosting solves custody, not legality. Binary options are banned for retail
clients in the EU and the UK and restricted in many other places. Taking
deposits into a personal wallet, without a licensed entity and a KYC/AML
process behind it, is the part that ends with frozen funds and personal
liability — not the plumbing. Get the company, the licence and the policy in
place before the first real deposit, and keep the platform's own KYC gate on.
