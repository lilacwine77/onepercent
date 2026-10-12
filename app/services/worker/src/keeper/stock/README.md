# K1 stock keeper

The keeper leader starts the stock extension separately from settlement. Every
cycle reads Machine, Config and the chain Clock in one RPC account snapshot,
then reads Pulls, Binders and token vaults. Spending never depends on indexed
events or signature pagination. One candidate is selected, built through X2 and
the P1 SDK, simulated, and optionally sent through TxSender. The next trade
starts from fresh chain state. FinalPull ends stock trading.

## Operation

**Fresh database required (base fraîche requise).** K1 has never run in
production. Existing development journals must not be reused; there is no
legacy-journal migration or recovery procedure. Missing charge metadata keeps
its conservative refusal.

Set `STOCK_PROTOCOL_LUT` to the active frozen protocol table. Set the keeper's
own `JUPITER_API_KEY`, `PYTH_HERMES_API_KEY` and `HELIUS_SENDER_URL` (Sender Max).
`FLAG_KEEPER_STOCK_LIVE=off` is the default. The dry path has no signing or send
call. Live sending also requires S3's measured priority-fee cap; if that value
is still null, TxSender refuses to sign with `fee_cap_pending`.

From `app/`, after building:

```sh
pnpm --filter worker stock:dry-run --cluster mainnet
node services/worker/dist/keeper/stock/tip-measurement.js /tmp/k1-tip.jsonl --write-config packages/config/src/services.ts
```

The dry-run command requires `RPC_URL`, `PROGRAM_ID`, `DATABASE_URL` and
`STOCK_PROTOCOL_LUT`. It verifies mainnet genesis, makes public chain reads and
unsigned simulations, writes plan records, and prints amounts, refusal reasons,
size and compute consumption. It never loads a signing key.

The tip collector samples Jito every minute for at least 24 hours. It stores all
five landed-tip percentiles, refuses stale, duplicate or discontinuous windows,
and uses the window median of the reported p50 values. It rounds upward to
10,000 lamports and never below the provisional Sender Max floor. The optional
write updates only the provisional config field after successful validation;
its JSON report contains the window and sample count. Run config tests after
adopting the measurement. No transaction is needed for the measurement.

## Decisions taken

- One actionable trade per plan; stable bucket-index tie breaks. Reserve recovery
  and failing/disabled sell-down precede buys. The largest-free eligible MAJOR
  receives its anchor first. Remaining inventory uses equal MAJOR weights and
  up to the configured TRENDING share, with unallocated capacity kept as SOL.
- Exact-in X2 quote rungs descend geometrically from the bounded candidate.
  Both the quoted price impact and P1's min-out must pass; no interpolated quote
  is executable. Build output must be at least the quote output, otherwise the
  trade is replanned. Every division involving balances uses bigint.
- Preserve D12 on buys as well as sells. A buy uses its on-chain minimum delivery
  to check the post-buy granularity of already reserved buckets.
- Sponsored Pyth only, as approved by the architect. The existing 45-second
  keeper admission margin remains below the 60-second program limit. Older,
  partial, wrong-feed, wide or unavailable prices stop MAJOR trading until fresh
  evidence arrives. The encoded-VAA poster in PARAMS §21.1 is deferred.
- A persistently unusable feed alerts after the existing
  `SERVICES.monitor.stockConditionAlertSeconds`, currently 900 seconds. Every
  listed MAJOR is observed even if no stock trade is needed. Missing observations
  never establish recovery.
- Tip is provisionally 1,000,000 lamports, PENDING the 24-hour measurement.
- A definitive failure or finalized expiry closes that plan through TxSender's
  rebuild callback. The next cycle fetches fresh evidence and smaller rungs.
  P3 StockBuy refusals instead wait and replan without reducing the tranche.
  A stored last-build blockhash prevents rebuilding against that same hash.
  Ambiguous sends retain their exact persisted signed bytes across restarts.
  Sender fallback broadcasts those same bytes; smaller sizing applies only to
  the next safely replanned transaction. Confirmations remain pending until
  finalized before another trade is started.
- Stock journals live inside K1's `stock_plans.state`, with leader-term compare
  and swap fencing, avoiding S3's crank queue. Measured trade results use finalized
  program-framed `ExecEnded` events, never inferred balance changes.
- Daily checks run at 12:00 UTC, with catch-up after restart. Failed checks stop
  buys and attach a guardian command; K1 never disables a bucket itself.

## Bounds and evidence

Machine funds move only inside the atomic exec pair into program-controlled
accounts. MAJOR minimums use Pyth; TRENDING minimums use the canonical PumpSwap
pool. A hostile hot key can manipulate TRENDING reserves, so only tranches,
spacing, hourly caps and its book share bound that exposure. No stronger
protection is claimed. D29's Meteora reads belong to Burn and JackpotBuy and are
unchanged by K1.

Provider references checked 2026-10-10:

- [Helius Sender](https://www.helius.dev/docs/sending-transactions/sender):
  Sender Max floor and the Sender tip recipient.
- [Jito transaction sending](https://docs.jito.wtf/lowlatencytxnsend/): readonly
  `jitodontfront` marker and landed-tip percentile endpoint. This marker is not
  a universal protection against every ordering strategy or every send path.

## Audit corrections

A Sender timeout never establishes rejection. If the secondary RPC rejects the
same bytes, K1 reports an ambiguous submission to TxSender and retains the signed
journal until signature/history/finalized-expiry reconciliation permits progress.

K1 no longer reads or modifies indexer tables. No history marker, pagination,
repair queue or event-completeness check participates in a spending decision.
A missing indexed payout cannot hide a reduction of current Machine stock SOL.

### Current account bounds

- `Machine.stock_sol` caps spendable SOL. Machine lamports must cover dynamic
  rent plus `stock_sol + jackpot_sol + burn_sol + team_sol + final_pool_sol`.
  Donations above these pots do not increase the budget.
- Bucket `amount`, `cost`, `reserved`, `cap`, `enabled`, `class`, `mint` and
  `oracle` remain the P1 inputs. Canonical token vault owner, mint, state and
  amount must be readable and cover tracked tokens. Reserved book is never sold.
- `Machine.pending_pulls` and `Machine.unsettled_reveals` must both be zero.
  Filtered Pull account reads also block buys while a draw is pending or
  `status=revealed` has an unfinished `settled_mask`.
- `Machine.last_reveal_ts` persists after settlement and Pull closure. K1 waits
  its configured random total delay of 30 to 120 seconds after each revelation;
  P3 enforces the 30-second minimum again at execution. A settled revelation no
  longer disables purchases for the season. If a readable Pull has a later
  `revealed_ts`, K1 uses that later timestamp.
- `Machine.bucket_history[i].listed_ts` must be positive for a TRENDING buy,
  and the chain Clock must reach that timestamp plus the configured 86,400-second
  notice. Public hit-list checks remain bound to the bucket's mint and class.
  Operators must still publish the listing announcement: the account timestamp
  does not prove that publication occurred. A legacy zero timestamp cannot
  authorize TRENDING purchases.
- `Binder.sol_owed` is backed by the Binder's own lamports above dynamic rent.
  These escrow funds are never counted as Machine stock. Unreadable or
  underfunded obligations refuse buys.

### Payout and inventory windows

P3 retains `Machine.sb_paid_hour` and `sb_paid_prev_hour` for payouts, plus
`bucket_history[i].sb_inflow_hour` and `sb_inflow_prev_hour` for each bucket's
returned Sell book value. Inflow is `min(stocked_value, quote_lamports)`, not
token units or the SOL payout. These windows share `Machine.hour_index`.

For a configured window `0 < W <= 3600`, let `H = floor(now / 3600)`. Rotate each
retained pair `(current, previous)` from its stored hour to `H`: retain both in
the same hour, use `(0, current)` in the adjacent hour, or `(0, 0)` after a larger
gap. A future stored hour refuses the evidence. The bound is
`B(W) = current + (now - W < H * 3600 ? previous : 0)` after rotation. Counting
complete intersecting hours can overestimate, but cannot omit a payout or inflow
within the configured window. All sums use bigint.

- SOL reserve is `SELL_BACK.solFloorLamports + payoutBound`, using the configured
  15-minute payout window. Unknown payout evidence refuses all buys.
- Additional inventory is
  `max(0, hit_out_last_hour * inventoryTargetMinutes / 60 - sum(inflowBound[i]))`,
  using the configured 30-minute inflow window. Anchor, allocation, reservation,
  caps, tranches and minimum-output rules are unchanged.
- Fresh history version 1 proves both windows. Legacy version 0 does not prove
  the previous payout hour when it intersects the window; its existing current
  payout hour is complete. A lazy adjacent rotation can use that known current
  hour as the previous one. PoweredOn has no Sell payouts yet.
- Legacy inflow version 0 becomes 2 after one adjacent hour, then 1 after the
  next. A gap of two or more hours clears both windows and establishes version
  1. Inflows are unknown until version 1. An intersecting `u64::MAX` inflow is
     also unknown, because it is a saturation sentinel. Unknown inflows suppress
     all additional inventory buys; the MAJOR anchor remains possible if payout,
     reveal and other account evidence allow it. Invalid versions refuse buys.

The layout, initialization and exact SDK/program formulas are documented in
[P3 keeper history](../../../../../programs/onepercent/P3-KEEPER-HISTORY.md).
K1 adds no schema migration or program change. Current state is read again
before building. Account-bound and journal integration tests cover these
windows and the post-settlement restock. The validator exercises the planner and
builder for both stock directions, the P3 execution guards, and a successful
restock after settlement and the reveal delay.

### Own journal and recovery

K1's own signed journal charges exact buy input and the Sell tranche ceiling
(Sell book can change before landing). Signed pending plans never age out;
terminal plans stay charged for a full hour after reconciliation. Failed signed
plans are charged too. Repeated writes charge a plan once. P1's own hourly
counters remain an additional lower bound on observed usage. Legacy signed rows
without charge metadata refuse further planning. P3 account counters do not
replace the journal: a previously signed pending transaction can still land.

Recovery reads the signed journal first and closes an unsigned plan immediately.
Signed plans persist their LUT addresses with their bytes. Older signed journals
recover referenced LUT positions from the stored instructions and signed message.
TxSender still verifies the signature and reconstructed message before replay or
confirmation; no current LUT account is required for recovery or expiry.

## Fourth audit corrections

- `evidence()` decodes the newly read Machine and Config and compares all fields
  with the planning snapshot, at a slot no earlier than that snapshot. Any
  divergence, including reveals, pending draws and pots, requires a new plan.
  P3's StockBuy guards remain the final barrier between this read and execution.
- Cached reports are selected by mint and class, checked against the complete
  report schema and bucket identity, and bounded by the daily recheck horizon.
  Future timestamps are refused against the local clock used by the report
  producer. Incompatible reports trigger a check of the bucket's actual class.
- A finalized successful transaction is bound to the journal signature, exact
  message and expected program's exec pair, independently of its logs. Missing
  or incomplete ExecEnded logs close the plan atomically with a separate
  `state.receipt` diagnostic and nullable trade delta/slippage, then emit an
  alert. The full conservative charge remains for an hour after reconciliation;
  later cycles may resume sell-down. No balance-derived measurement is used.

## P3 refusals

The planner mirrors all four StockBuy guards. A structured simulation refusal or
a finalized failed receipt with code 6071 (`StockBuyPullInFlight`), 6072
(`StockBuyRevealDelay`), 6073 (`StockBuyListingNotice`) or 6074 (`StockBuyReserve`)
closes the refused plan, records its wait reason, and waits for fresh state
before replanning. It does not reduce the tranche or label this known refusal
an ambiguous send. A new transaction always uses a new blockhash.

A real timeout after sending is still governed by D23: identical persisted
signed bytes remain pending until signature, finalization or expiry proves the
outcome. A guard-shaped message or a secondary rejection cannot establish that
those bytes failed elsewhere. StockSell and all exits retain their conditions.
