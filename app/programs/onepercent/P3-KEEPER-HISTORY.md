# P3: keeper history and StockBuy admission

Machine remains 3,808 bytes, Bucket 128 bytes and Pull unchanged. No realloc or
rent payment is needed. Existing meaningful fields and all historical event
payloads keep their offsets. No K1 integration or deployment is included.

## Layout

Offsets include the Machine discriminator. P3 uses 424 bytes of reserved padding.

| Field                       | Offset | Type                            |
| --------------------------- | -----: | ------------------------------- |
| `last_reveal_ts`            |   2656 | i64                             |
| `sb_paid_prev_hour`         |   2664 | u64                             |
| `keeper_history_version`    |   2672 | u64                             |
| `keeper_history_started_ts` |   2680 | i64, retained layout slot, zero |
| `bucket_history`            |   2688 | 16 × 24 bytes                   |
| `unsettled_reveals`         |   3072 | u64                             |
| `_reserved0`                |   3080 | 600 bytes                       |
| `_reserved1`                |   3680 | 128 bytes, unchanged            |

Bucket i's companion starts at `2688 + 24*i`: `listed_ts` at +0,
`sb_inflow_hour` at +8 and `sb_inflow_prev_hour` at +16. Both counters are SOL
book value returned by Sell (`min(stocked_value, quote_lamports)`), not token
units or the payout. They share the existing Machine `hour_index`.

## Initialization and devnet migration

Fresh initialization starts with zero counters and history version 1 (complete
history by construction). Mainnet must start fresh; this work performs no
mainnet operation.

Legacy devnet accounts already have zeroed padding. The existing permissionless
`advance_phase` initializes only `last_reveal_ts` to Clock when both that field
and history version are zero. Other new fields remain zero. Subsequent calls
cannot reset history or counters. The first successful listing, reveal, Sell,
exec or creator-fee collection also initializes this timestamp if necessary.
There is no new authority or migration instruction. `advance_phase` retains its
existing phase transitions and exec lock.

Before upgrade, `devnet-deploy.mjs --upgrade` enforces the existing guardian Rip
pause, waits for finalization and requires zero Pull accounts, including Pending.
The finalized inventory is pinned at or after the paused Config slot and repeated
before every upgrade broadcast/retry. With no Pending Pull and Rip still paused,
no old callback can reveal between inventory and upgrade. After upgrade, the
script repeats the empty inventory before activation and restores Rip only after
verified activation (preserving a preexisting pause). This remains a devnet script
precondition, not an on-chain attestation or a new callback/exit condition.
Read [DEVNET.md](../../DEVNET.md) for the enforced sequence and resume behavior.

Legacy `listed_ts` remains zero as required by the migration decision. It does
not reconstruct the original listing time. Every new listing writes actual Clock.
The legacy devnet listing history is not an independently proved announcement.

History version 0 means legacy current-hour inflow is incomplete. The first
adjacent hour transition changes it to 2 (previous inflow still incomplete); the
next transition changes it to 1 (both hours complete). Skipping two or more hours
clears both inflow windows and immediately establishes version 1. Fresh accounts
stay at version 1. `keeper_history_started_ts` is not used as a migration epoch.

## Execution-time guards

Only StockBuy calls `check_stock_buy`, before `exec_begin` moves any stock SOL.
All prior phase, mint, quote, tranche, spacing, cap and pairing checks remain.
StockSell and all exits retain their admission conditions and economics.

| Error                   | Code | Refusal                                                                                                   |
| ----------------------- | ---: | --------------------------------------------------------------------------------------------------------- |
| `StockBuyPullInFlight`  | 6071 | Unactivated legacy account, `pending_pulls > 0`, or `unsettled_reveals > 0`                               |
| `StockBuyRevealDelay`   | 6072 | `now < last_reveal_ts + POST_REVEAL_BUY_DELAY` (30 s)                                                     |
| `StockBuyListingNotice` | 6073 | TRENDING and `now < listed_ts + HIT_LIST.trendingNoticeSeconds` (86,400 s)                                |
| `StockBuyReserve`       | 6074 | History cannot prove the payout bound, or `stock_sol - amount < SELL_BACK.solFloorLamports + payoutBound` |

A reveal increments `unsettled_reveals` exactly once; only the final pack settlement
of that Pull decrements it. Partial settlement, repeated settlement, duplicate
callbacks, refunds and account closure cannot double-count. Tracking arithmetic
saturates and adds no callback rejection condition. Existing exits never read a
new pause bit, require an attestation or require a live service.

The 30 s minimum is compiled from config. K1 retains its random 30–120 s total
wait. Existing exec locking prevents a draw or reveal from entering the middle
of an admitted exec pair. The SDK's `stockBuyGuard` mirrors the four additional
checks; a passing preflight snapshot never replaces execution-time admission.
Import this guard and the `checkExecBegin` mirror from `@onepercent/sdk/server`.
These operational modules are absent from the shared math exports and the browser
entry, so service parameters remain outside the browser graph (D26).

## Bounds for K1

Read accounts and Clock coherently, preserving existing quote, vault, pending
Pull, unsettled Pull and Binder checks. Closing a Pull never clears `last_reveal_ts`.

- Reveal delay: `now >= last_reveal_ts + configuredDelay`.
- New TRENDING listing: `now >= listed_ts + configuredNotice`. Retain the public
  hit-list and announcement checks; a timestamp does not prove publication.
- Payout/inflow window W: require `0 < W <= 3600`; rotate the retained pair from
  stored hour h to `H = floor(now/3600)`: same hour retains both, adjacent hour
  becomes `(0, current)`, a larger gap becomes `(0, 0)`. Refuse future stored hours.
- Bound: `current + (now-W < H*3600 ? previous : 0)`. Complete intersecting hours
  overestimate, never omit an event in the configured trailing window.
- Legacy payouts: existing `sb_paid_hour` already covers the complete stored
  hour. With history version 0, the previous payout hour is unknown; refuse a
  window intersecting it. A lazy adjacent transition uses the known old current
  hour. PoweredOn has no Sell payouts.
- Legacy inflows: `keeperWindowBounds` refuses evidence until a lazy or persisted
  rotation reaches history version 1. A `u64::MAX` inflow is an unknown saturation
  sentinel, not a finite upper bound. Use bigint for all off-chain sums.

Reserve: `SELL_BACK.solFloorLamports + payoutBound`, W = 15 min.
Inventory: `max(0, hit_out_last_hour * inventoryTargetMinutes / 60 -
sum(inflowBound[i]))`, W = 30 min, retaining existing anchor/allocation rules.
The signed-plan journal remains required: these fields do not prove that a
previously signed pending transaction cannot land.

## ABI and verification

Four additive events remain `KeeperHistoryStarted`, `RevealTimestamped`,
`BucketListed`, `SellHistoryUpdated`. Old payloads/discriminators are unchanged.
IDL, raw SDK layouts, event decoding and strict API payload schemas are updated.
New diagnostic events have no public stream category; accounts remain authoritative.

Tests cover migration bytes/idempotence, off-chain inventory refusal followed by
settlement, legacy pending callbacks, exact delay/notice/reserve boundaries,
partial and repeated settlements, stale prepared purchases, unchanged StockSell
and exit behavior, SDK parity, and random histories against exact trailing sums.
The validator exec suite includes executed refusals for all four guards followed
by a successful StockBuy after all conditions clear.

Required validation uses `CARGO_BUILD_JOBS=3`, `VITEST_MAX_WORKERS=2`, default
1,000 property cases, Postgres 17, Redis, `SERVICES_INTEGRATION=1` and all validator
flows. CU snapshots are remeasured; economic parameters are not changed.
The two-pack settlement maximum is 65,638 CU; the standard 25% margin rounded
up to 1,000 CU updates `CU_LIMITS.settle[1]` from 82,000 to 83,000. The one-pack
limit remains 50,000. This is a transaction compute budget, not an economic rule.

Validation on 2026-10-11:

Revalidated after session recovery with a dedicated database
`onepercent_p3_resume_20261011` on Postgres 17 at `127.0.0.1:55432` and Redis
at `127.0.0.1:56379/13`. Keep CLI validators after workspace tests: Launch
regenerates the Meteora fixture report that SDK tests also read. An initial
parallel Launch returned `pending_reconciliation`; restoring its incomplete
report and running validation serially required no production-code change.

- `pnpm program:build`, `pnpm program:clippy`, `pnpm program:test`: passed,
  365 Rust tests, including the migration and callback cases; no ignored tests.
- `pnpm build:libs`, `pnpm lint`, `pnpm lint:words`, `pnpm format:check`,
  `pnpm typecheck`: passed.
- `SERVICES_INTEGRATION=1 pnpm test`: passed with local Postgres 17 and Redis;
  47 script tests and 3,601 Vitest tests passed, two existing API skips.
- `pnpm e2e:validator <flow>`: all flows passed: `launch`, `feed`, `rip`,
  `refund`, `settle-closed`, `sellback`, `exec`, `power-on`, `season` (including
  `meteora-season` and `season-closed`). The exec command also runs the new guards.
- `pnpm test:e2e`: 11 passed when run serially after the CLI validators. The
  guard scenario also passed without `FIXTURE_EXPORT_BINARY`, exercising the
  default fixture build path.

Changes span program state/math/instructions/events and generated parameters,
config and measured CU limits, SDK layouts/IDL/event decoders/math mirrors, their
tests and generated fixtures, the devnet preflight/drill and validator runner,
and this document plus PARAMS.md, DEVNET.md and the app README. K1 and `declare_id!`
are unchanged. No commit or deployment was made.

The first-pass supplemental Chromium run exposed an existing W3.02 Refund UI
failure before transaction submission: the pending-card button emits `action`
without the `preview` approval required by `card-actions.execute`. Both paths
remain untouched; CLI validator Refund is separately exercised.

Read-only devnet check (2026-10-10, finalized slot 509664955): Machine
`3Hstj284yCh3y6s8KRk29p96d3WsH54EdfQwgjQ5yrSG`, owned by
`DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr`, was 3,808 bytes with zeroed
reserved extension. No upgrade was sent.
