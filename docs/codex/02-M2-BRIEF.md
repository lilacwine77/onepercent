# Codex brief — M2: My cards, the atomic executor, the services core and the stock keeper (The 1% Machine)

Issued 2026-10-14 (D5) by the architect. **The program lane starts only after G1 (M1 merged).** The services lane starts now, against the M1 draft IDL; it merges after G1. Three gates: **G2.1** (on-chain), **G2.2** (services core), **G2.3** (stock keeper, with X2 already merged).

This brief is self-contained for M2. Everything M2 needs from SPEC, `PARAMS.md`, the master brief and `01-M1-BRIEF.md` is restated or referenced by section. If anything is ambiguous, contradictory or impossible, **stop and report with options** (AGENTS.md). Do not guess.

---

## 0. Read this first

### 0.1 Authority

Master §0.1 applies: `MODEL.md` > `PARAMS.md` (issue 2, plus issue 3 when the architect publishes it, §4.3) > `00-MASTER-BRIEF.md` > **this brief** > `00-M0-SCAFFOLD.md` > `AGENTS.md`. `DECISIONS.md` is binding on all of them. `01-M1-BRIEF.md` sets the program conventions (its §2, §5–§8, §12–§13, §16); this brief **extends them and never changes them**. M1's layouts, seeds, sizes, error order and event fields are frozen: M2 appends.

"M1 §x" means `01-M1-BRIEF.md` §x. "Master §x" means `00-MASTER-BRIEF.md` §x. "X2 §x" means `X2-MARKET-BRIEF.md` §x.

### 0.2 Scope versus the master plan

| Master §11.4 item | Here | Notes |
|---|---|---|
| M2.1 on-chain: executor (StockBuy, StockSell, Burn, JackpotBuy), `sell_back`, `feed_back`, `withdraw_owed`, `close_binder` | §5–§9 | Burn and JackpotBuy are implemented and tested now; the `executor` service that runs them is M4.2 |
| M2.2 services core: `packages/db`, intake signer, indexer, keeper v1, `api` public v1, Verify library, `packages/cli` v1 | §11 | Plus the **quote signer** (moved from M2.3, B1) and VRF queue monitoring |
| M2.3 stock: value function (X2, merged), keeper stock policy, MEV rules, `KEEPER_STOCK_LIVE`, `onepct-ops hitlist` | §12 | The quote signer moved to M2.2 |
| Not M2 | — | Spotlight (D1: not in Season 1); `power_on`, The 1%, Jackpot win, creator fees, Final Pull, permissionless Burn after Done (M4.1); the `executor` and HOLD signer (M4.2); the full monitor and status matrix (M6.1); rescue (M6.2); the Verify page (M3) |

### 0.3 Amendments this brief makes (binding for M2)

| # | Amendment | Amends | Why |
|---|---|---|---|
| B1 | The quote signer ships in M2.2 (services lane, gate G2.2), not M2.3 | Master §11.4 | It needs only X2b (merged) and the SB encoder of P0; the web (M3.3) needs it early |
| B2 | Buys (StockBuy, Burn, JackpotBuy) credit `L` lamports from the Machine to the signer's own wSOL ATA, then `sync_native`; Jupiter `/build` runs with `wrapAndUnwrapSol=false` | SPEC §8.5 ("executor's temporary wSOL account") | A precise, checkable source account. The SOL never sits in the hot key's wallet balance |
| B3 | StockSell proceeds land in `sol_dest = ATA(vault_auth, wSOL, SPL Token)`, an account only the program can move. `exec_end` measures it, closes it to the signer, then the signer transfers exactly `received` to the Machine | SPEC §5.6 ("Machine-owned wSOL account; unwrap") | SPL Token has no partial unwrap. The measured account is program-controlled; the keeper gets back only the rent it paid (plus any third-party donation left in that account) |
| B4 | An exec transaction contains **exactly two** `onepercent` instructions: one `exec_begin` and one later `exec_end` of the same kind | Master §7.1 ("no other instruction in between") | Simpler to audit; no exec pair shares a transaction with any other program instruction |
| B5 | `$1PCT` `min_out` (Burn, JackpotBuy) applies the same fee allowance as TRENDING: `L_eff = L × (10_000 − STOCK.trendingPoolFeeAllowanceBps) / 10_000` on the curve and on the pool | PARAMS §8.1, §10, §13.1 (silent on the fee) | Without it every tranche fails: the curve and pool fees (1.25%) exceed the 1% slip. Recorded as [A] in PARAMS issue 3 |
| B6 | New Machine and Bucket fields are carved from `_reserved` (§5.1), as PARAMS §8.1 announced. `ExecRecord._reserved` becomes `aux: u64` | M1 §7.2 (bytes unchanged) | Stock-trade spacing and gross hourly caps [C25] |
| B7 | `sell_back` and `feed_back` fail with `ExecInFlight` while `Machine.exec.kind ≠ 0` | none | No interleaving with an exec pair, even through a CPI from the swap slot |
| B8 | `close_binder`'s "Final Pull claimed" means `season_spend == 0 ∨ (flags & 0b11) == 0b11`. M4 must make both claims callable with a zero share, setting the bits | Master §11.4 M2.1 | One unambiguous on-chain test |
| B9 | One-hop consumption (SPEC S3) is written by the indexer from a landed `feed` joined to the intake signer's append-only `attestation_log` (the provenance it signed). The log is the signer's only write | Master §3.3 | Signing stays side-effect-free; consumption comes only from landed Feeds |
| B10 | `ONCHAIN_KEYS` gains `STOCK.{tradeMinSpacingSeconds, hourlyFloorLamports, hourlyHitOutMultiple}` (if absent), `HIT_LIST.solUsdPythFeedId` (new generator type `hex32` → `[u8; 32]`) and `PROGRAM_IDS.pythReceiver` (value from PARAMS issue 3, spike S4) | M1 §4.3 (append-only by design) | The executor compiles these; nothing is admin-writable |
| B11 | M2.3 adds one optional field, `wrapAndUnwrapSol?: boolean`, to X2's `SwapBuildInput` and passes it through to `/build` | X2 §6.1 | B2 and B3 need `false`. One field, one test; no other X2 edit |

None adds or removes a mechanic or changes a validated number.

### 0.4 Founder decisions M2 relies on

- **D1:** no Spotlight in Season 1. Implement nothing for it: no instruction, no service code, no API field beyond what M1 already decodes.
- **D3:** no RC-slip fallback. M2.1 must pass G2.1 by D11 to be in `rc-1` (D12).
- **D4:** the RC is deployed directly; `S` is written with `SetSeason` after that deploy.
- **D5:** C25 (stock trade limits) and C26 (TRENDING quote TTL 20 s) stand at their defaults.
- **D6:** Onepercent stays on MagicBlock's shared queue `Cuj97…` (≈120 pending items for every app). The occupancy reader and the "Machine busy" guard (§11.7) are launch-critical.
- **D11:** the `/api/rpc` allow-list also carries `getSignaturesForAddress`, `getTransaction` and `getBlockHeight`, read-only (§11.8).

---

## 1. Scope and PR plan

### 1.1 Deliverables by lane

| Lane | Deliverables |
|---|---|
| Program (M2.1) | Layouts (§5), `exec_begin` / `exec_end` (§6), `sell_back`, `feed_back`, `withdraw_owed`, `close_binder` (§7), events and errors (§8), SDK codecs, builders, math mirrors and golden vectors (§10), tests T12–T16, EX-1, SB-1, P1/P2 extensions (§13) |
| Services (M2.2) | `packages/service-kit`, `packages/db`, indexer, intake signer (FEED), quote signer (SB), keeper v1 cranks, VRF monitoring, `api` public v1 with zod schemas, the Verify library, `packages/cli` v1, observability (§11) |
| Stock (M2.3) | The keeper's stock policy and trade builder, Pyth handling, private landing, `KEEPER_STOCK_LIVE` dry run, `onepct-ops hitlist check|add|recheck`, the daily re-check (§12) |

### 1.2 PRs, file ownership, dependencies and merge order

Each PR is one Codex task on its own branch. "Owns" means only that PR edits those paths during M2; shared files are append-only as listed.

| PR | Branch | Lane | Owns | Depends on | Merge |
|---|---|---|---|---|---|
| **P0** interface | `feat/m2.1-iface` | Program | `programs/onepercent/src/{lib.rs, constants.rs, errors.rs, events.rs}` (append), `state/machine.rs` (§5 fields), `instructions/{exec_begin, exec_end, sell_back, feed_back, withdraw_owed, close_binder}.rs` (Accounts structs, args, handlers returning `NotImplemented`), `instructions/stubs.rs` (remove those six), `packages/config` (`ONCHAIN_KEYS` appends, §4.3 block), `scripts/params-rs.ts` (`hex32`), `packages/sdk/src/{layouts.ts, constants.ts, attest.ts (SB), ix/*}`, `fixtures/vectors/{layouts, ix, attest, idl_constants}.json`, `tests/common/inject.rs` (new fields) | G1 | First, D8 morning. **M4.1 appends its errors and events after P0's** |
| **P1** executor | `feat/m2.1a-exec` | Program | `instructions/{exec_begin, exec_end}.rs` (handlers), `checks/{exec_tx, pyth, pumpswap, meteora}.rs`, `math/exec.rs`, `util/token.rs` (append wSOL helpers), tests `t12_exec.rs`, `prop_ex1_exec.rs`, P1/P2 exec ops, `packages/sdk/src/{math/exec.ts, tx/exec.ts}`, `fixtures/vectors/exec.json` | P0 | D10 |
| **P2** My cards | `feat/m2.1b-mycards` | Program | `instructions/{sell_back, feed_back, withdraw_owed, close_binder}.rs` (handlers), `math/sellback.rs`, tests `t13`–`t15`, `prop_sb1_sellback.rs`, P2 ops, `packages/sdk/src/{math/sellback.ts, tx/{sellback, feedback, binder}.ts}`, `fixtures/vectors/sellback.json` | P0 | D10; the second of P1/P2 to merge adds `t16_hygiene_m2.rs` and rebases P2's operation set |
| **S0** core | `feat/m2.2-core` | Services | `packages/service-kit/**`, `packages/db/**` (the **whole** M2 schema and migration `0000`, §11.2), `services/api/src/roles.ts`, `services/worker/src/roles.ts`, entry points, `app/compose.yaml`, `.env.example` lines, CI job `services` | — (M1 draft IDL) | D7 |
| **S1** indexer | `feat/m2.2-indexer` | Services | `services/worker/src/indexer/**`, `packages/sdk/src/events/**` (new dir) | S0; G1 for the final IDL | D12 |
| **S2** signers | `feat/m2.2-signers` | Services | `services/api/src/{intake, quote, internal}/**`, `packages/service-kit/src/intake/**` (the pure provenance rules, new dir), `packages/sdk/src/tx/merge.ts` (new file) | S0, P0 (SB encoder), S1 for the acceptance runs | D12 |
| **S3** keeper v1 and CLI | `feat/m2.2-keeper` | Services | `services/worker/src/keeper/**` (not `keeper/stock/`), `packages/cli/**` (v1 commands) | S0, P0 | D12 |
| **S4** public API | `feat/m2.2-api` | Services | `services/api/src/public/**`, `packages/sdk/src/{api, verify, vrf}/**` (new dirs), subpath exports `./api`, `./verify` in `packages/sdk/package.json` | S0, S1 tables | D12 |
| **K1** stock | `feat/m2.3-stock` | Stock | `services/worker/src/keeper/stock/**`, `packages/cli/src/hitlist/**`, the one-field X2 edit (B11) | P1 SDK exec builders, S3 (keeper loop), X2 | D12 |

- **Gate mapping.** G2.1 = P0 + P1 + P2 (combined runs after the second merges). G2.2 = S0–S4. G2.3 = K1 (+ X2).
- **Append-only for every PR:** `packages/sdk/src/index.ts` and the `exports` of `packages/sdk/package.json`, `.env.example` files, `CU_LIMITS` (P1 and P2 add their own keys), `prop_p1_feed.rs` and `prop_p2_packs.rs` operation sets, `reference.rs`.
- **Rebase rule.** The later PR rebases. It never hand-merges `pnpm-lock.yaml` (run `pnpm install`) or `packages/db/drizzle/meta/*` (re-run `drizzle-kit generate`).
- **Builds against main.** Services PRs before G1 build against the M1 PR's IDL; they pass their gate only on `main` with M1 and P0 merged.

### 1.3 Calendar (master §11.1)

| Day | Program | Services | Stock |
|---|---|---|---|
| D5 Wed 10-14 | — | S0 starts | — |
| D7 Fri 10-16 | G1 | S0 merged; S1–S4 start | — |
| D8 Mon 10-19 | P0 merged by noon; P1, P2 start | — | K1 starts |
| D10 Wed 10-21 | P1, P2 PRs | — | — |
| D11 Thu 10-22 | **G2.1** | — | — |
| D12 Fri 10-23 | RC freeze `rc-1` | S1–S4 PRs | K1 PR |
| D13 Mon 10-26 | — | **G2.2** (Stock-Up: intake live) | **G2.3** |

---

## 2. Rules for this milestone

M1 §2 rules 1–12 apply to every program PR, unchanged. In addition:

1. **Branches** per §1.2. Never push to `main`. Change only `app/**` and `.github/workflows/app.yml`.
2. **Program arithmetic.** `exec_begin`, `exec_end`, `sell_back` and `feed_back` are entry instructions: checked arithmetic, `MathOverflow`. `withdraw_owed` and `close_binder` are exits: saturating, no arithmetic error path, `arithmetic_side_effects` denied.
3. **Exits** now also include `withdraw_owed` and `close_binder`: no pause bit, no Config account, no remaining accounts, any phase.
4. **Pause bits** are read only by `buy_packs`, `feed`, `feed_back`, `sell_back` and `exec_begin` (master §7.1). T16.01 greps it.
5. **Top level.** `exec_begin` and `exec_end` call M1's top-level check (`NotTopLevel`). `sell_back` and `feed_back` stay CPI-callable but read `Machine.exec` (B7).
6. **Services.** TypeScript strict, ESM, Node 22, zod on every boundary, pino JSON logs, `bigint` for lamports and base units (decimal strings on the wire). No network in CI tests. Postgres and Redis run as CI service containers.
7. **Numbers.** Only from `@onepercent/config` (PARAMS issue 2 keys, plus §4.3 until issue 3 lands). A number not found there: stop and ask.
8. **Keys.** Master §6 rules 1–7 are acceptance criteria (§11.1).

---

## 3. Dependencies

Pin exactly, at least 14 days old (master §0.3 C), each with its date in `VERSIONS.md`. Versions already on `main` win (master §4.1).

| Package | Pin (published) | Used by | Why |
|---|---|---|---|
| `drizzle-orm` | 0.45.3 (2026-09-21) | db, api, worker | Master §4.2 |
| `drizzle-kit` | 0.31.11 (2026-09-21) | db (dev) | Forward-only SQL migrations, committed |
| `pg` | 8.23.0 (2026-08-08) | db | Master §4.2 |
| `ioredis` | 5.11.1 (2026-06-04) | service-kit | Rate limits, SSE stream, caches. 6.0.0 is a new major: not used |
| `prom-client` | 15.1.3 (2024-06-27) | service-kit | `/metrics` text format |
| `@sqds/multisig` | 2.1.4 (2025-06-16) | cli | Squads proposals (master §4.2) |
| `@solana/spl-token` | 0.4.15 (2026-07-09) | sdk, service-kit, cli | ATA, `sync_native`, `close_account` builders |

No Pyth or Jupiter SDK. `@pythnetwork/pyth-solana-receiver` 0.16.0 depends on `@coral-xyz/anchor ^0.29`, which master §0.3 B excludes; K1 uses it only if spike S4 requires keeper-posted prices **and** the architect approves the exception in writing (§12.3). Rust: no new crate; Pyth `PriceUpdateV2` is parsed by hand (§6.4) unless S4 picks `pyth-solana-receiver-sdk` 1.2.0.

---

## 4. Parameters

### 4.1 Values M2 uses (PARAMS issue 2)

| Alias | PARAMS key | Value |
|---|---|---|
| `MAJOR_TRANCHE`, `TREND_TRANCHE` | `STOCK.majorTrancheMaxLamports`, `.trendingTrancheMaxLamports` | 5 SOL, 1.5 SOL |
| `TREND_HOURLY` | `STOCK.trendingHourlyMaxLamports` | 10 SOL per mint per clock hour, buys and sells counted separately |
| `TREND_SHARE` | `STOCK.trendingShareMaxBps` | 1_500 |
| `FEE_ALLOW` | `STOCK.trendingPoolFeeAllowanceBps` | 125 |
| `MAJOR_SLIP`, `TREND_SLIP` | `STOCK.majorMinOutSlipBps`, `.trendingMinOutSlipBps` | 150, 100 |
| `PYTH_AGE`, `PYTH_CONF` | `STOCK.pythMaxAgeSeconds`, `.pythMaxConfBps` | 60 s, 100 |
| `SPACING`, `HOUR_FLOOR`, `HOUR_MULT` | `STOCK.tradeMinSpacingSeconds`, `.hourlyFloorLamports`, `.hourlyHitOutMultiple` | 20 s, 30 SOL, 2 |
| `TARGET_BASE` | `STOCK.targetBaseLamports` | 30 SOL |
| `SB_BPS`, `SB_FLOOR`, `SB_MIN`, `SB_PCT` | `SELL_BACK.{payoutBps, solFloorLamports, hourlyBudgetMinLamports, hourlyBudgetBpsOfStockSol}` | 8_700, 1 SOL, 5 SOL, 2_500 |
| `SB_TTL` | `SELL_BACK.quoteTtlSeconds.{major, trending}` | 60 s, 20 s |
| `BURN_*` | `BURN.{trancheMaxLamports, trancheMaxBpsOfQuoteReserves, minSpacingSeconds, hourlyMaxLamports, minOutSlipBps}` | 1 SOL, 25, 20 s, 10 SOL, 150 |
| `JP_*` | `JACKPOT.{trancheMaxLamports, trancheMaxBpsOfQuoteReserves, trancheMinSpacingSeconds, minOutSlipBps}` | 2 SOL, 100, 20 s, 100 |
| `COVERAGE_BPS`, `DECK_MAX`, `FEED_TTL` | `COVERAGE.perPackValueBps`, `.deckMax`, `ATTESTATIONS.feedTtlSeconds` | 150_000, 120_000, 120 s |
| Keeper policy | `KEEPER_POLICY.*`, `HIT_LIST.*`, `EXECUTOR_POLICY.*` | PARAMS §8.2–§8.3 |
| Intake | `INTAKE.rateLimitPerMinutePerWallet`, `.rateLimitPerMinutePerIp` | 30, 60 |
| VRF client and monitor | `VRF.{busyOccupancyBps, busyOldestItemSeconds}`, `MONITOR.*` | 8_000, 20 s; PARAMS §15, §18 |
| Batches | `TX_LIMITS.{redeemPerTx, settlePacksPerTx, txPerSignAll, feedBagsPerTx…}` | 8, 2, 8, M1's measured values |

### 4.2 `ONCHAIN_KEYS` appends (P0, B10)

| Path | Rust type | Note |
|---|---|---|
| `STOCK.tradeMinSpacingSeconds` | `i64` | append if M1 did not |
| `STOCK.hourlyFloorLamports` | `u64` | idem |
| `STOCK.hourlyHitOutMultiple` | `u32` | idem |
| `HIT_LIST.solUsdPythFeedId` | `[u8; 32]` | new generator type `hex32`: 64 hex chars, decoded. Rust name `HIT_LIST_SOL_USD_PYTH_FEED_ID` |
| `PROGRAM_IDS.pythReceiver` | `Pubkey` | value from PARAMS issue 3 (S4). P0 adds it if issue 3 has landed, otherwise P1 does; still absent when P1 starts: stop and ask |

`constants.rs` gains, as non-PARAMS structural values: `MAX_SELL_BACK_CARDS = 8`, `MAX_FEED_BACK_CARDS = 8` (a parity test asserts both equal `TX_LIMITS.redeemPerTx`), `EXEC_KIND_{NONE 0, STOCK_BUY 1, STOCK_SELL 2, BURN 3, JACKPOT_BUY 4}`, `BUCKET_NONE = 255`, `PYTH_PRICE_UPDATE_V2_DISCRIMINATOR = 22f123639d7ef4cd` (= sha256("account:PriceUpdateV2")[..8]), `POOL_AUTHORITY_SEED = b"pool-authority"`, and the external-account offsets of §6.4.

### 4.3 PARAMS issue 3 (pending): operational keys, `[OFF]` `[A]`

P0 adds this block to `packages/config` verbatim, headed `// PARAMS issue 3 (pending) — 02-M2-BRIEF.md §4.3`. The architect publishes the same values in issue 3. The two `PENDING` values are measured and written by the PR named.

```ts
export const SERVICES = {
  indexer: { pollMs: 2_000, accountReconcileSeconds: 300, deckReconcileSeconds: 600, deckChunkBytes: 262_144,
             fallbackAfterFailures: 5, fallbackRecoverSeconds: 600, maxLagSecondsForIntake: 30, lagAlertSeconds: 60 },
  keeper: { scanSeconds: 10, closeVaultPassSeconds: 3_600, teamWithdrawSeconds: 3_600, sendMaxAttempts: 5, backoffBaseMs: 500,
            backoffMaxMs: 30_000, followerRetrySeconds: 5, leaderFailoverSeconds: 60, settleP95TargetSeconds: 5,
            settleBacklogAlertSeconds: 60 },
  api: { machineMaxAgeMs: 2_000, meCacheMs: 2_000, rpcPerMinutePerIp: 600, rpcMaxDataSliceBytes: 65_536, valuePerMinutePerIp: 60,
         ssePingSeconds: 15, sseReplayEvents: 500 },
  quote: { rateLimitPerMinutePerWallet: 30, rateLimitPerMinutePerIp: 60 },
  signers: { roleRecheckSeconds: 60, evidenceCacheSeconds: 86_400 },
  stock: { hitlistReportMaxAgeSeconds: 86_400, pythSkipAgeSeconds: 45 },
  monitor: { alertDedupeSeconds: 600, vrfExpiryClusterPerWallet24h: 3, stockCapUsageAlertBps: 8_000, stockConditionAlertSeconds: 900 },
  landing: { cuMarginBps: 2_000, tipLamports: null /* PENDING: K1 measures Helius Sender's minimum */,
             maxComputeUnitPriceMicroLamports: null /* PENDING: S3 measures */ },
} as const;
```

`validateParams()` gains: every value positive (the two PENDING may be `null` until written); `quote.rateLimitPerMinutePerIp ≥ quote.rateLimitPerMinutePerWallet`; `indexer.maxLagSecondsForIntake < indexer.lagAlertSeconds`; `stock.pythSkipAgeSeconds < STOCK.pythMaxAgeSeconds`; `keeper.followerRetrySeconds < keeper.leaderFailoverSeconds`. The `[A]` notes of PARAMS issue 3 will also record B5 and B10.

---

## 5. On-chain layouts (P0)

### 5.1 Machine: fields carved from `_reserved` (M1 §7.2; size stays 3,808 B)

| Offset | Field | Type | Written by |
|---|---|---|---|
| 2,496 | `exec: ExecRecord` (80 B, §5.3) | — | `exec_begin` sets, `exec_end` clears |
| 2,576 | `last_stock_trade_ts` | i64 | StockBuy and StockSell (shared, [C25]) |
| 2,584 | `stock_hour_index` (`now / 3600`) | u64 | `rotate_stock_hour` |
| 2,592 | `stock_bought_hour` (Σ L this hour) | u64 | StockBuy |
| 2,600 | `stock_sold_hour` (Σ book this hour) | u64 | StockSell |
| 2,608 | `_reserved` | [u8; 1,200] = 1,024 + 128 + 32 + 16 | — |

M1 fields M2 now writes: `jackpot_tokens`, `jackpot_cost` (JackpotBuy), `burned_total`, `last_burn_ts`, `burn_hour_index`, `burn_paid_hour` (Burn), `last_jackpot_buy_ts` (JackpotBuy), `sb_paid_hour` (`sell_back`), `stock_sol`, `team_sol`, `burn_sol`, `jackpot_sol`.

### 5.2 Bucket (128 B): `_reserved` @120 becomes `trend_sold_hour: u64`

`trend_bought_hour` @96 and `trend_sold_hour` @120 share `trend_hour_index: u32` @104 (`now / 3600`, saturating cast). `oracle` @32 holds the 32-byte **Pyth feed id** for MAJOR and the **canonical PumpSwap pool address** for TRENDING (PARAMS §7.2).

### 5.3 `ExecRecord` (80 B @2,496)

`kind u8 @0` (§4.2 codes), `bucket u8 @1` (0–15, or 255 for `$1PCT` kinds), `_pad [u8; 6]`, `amount u64 @8` (L lamports for buys; tokens for StockSell), `v0 u64 @16` (measured account's token amount at begin), `min_out u64 @24`, `slot u64 @32` (`Clock.slot` at begin), `target Pubkey @40` (the measured account), `aux u64 @72` (StockSell: the book value removed; 0 otherwise).

### 5.4 Binder fields M2 uses (M1 §7.4)

`sb_nonce` @92 (Sell back, single-use), `sol_owed` @80 (`withdraw_owed`; written by M4), `flags` @111 bit0 Final SOL claimed / bit1 Final tokens claimed (`close_binder`), `reserved` @108, `fresh_in_deck` @102, `season_spend` @72. Deck entry flags bit1 REFED (`feed_back`).

---

## 6. The atomic executor (P1)

### 6.1 Transaction shape (built by the SDK, run by the keeper in K1 and the executor in M4.2)

```
[ComputeBudget limit + price] [Jito tip, K1] [create_idempotent signer wSOL ATA]           (buys)
[create_idempotent signer token ATA; create_idempotent sol_dest]                            (StockSell)
exec_begin(kind, bucket, amount)
<Jupiter /build setup, swap, cleanup: taker = signer, wrapAndUnwrapSol = false,
 destinationTokenAccount = vault (buys) or sol_dest (StockSell)>
exec_end(kind)
```

v0 with the frozen protocol lookup table plus Jupiter's tables, ≤ 1,232 B. **Exactly two `onepercent` instructions** (B4).

### 6.2 `exec_begin(kind: u8, bucket: u8, amount: u64)`

**Accounts** (fixed order; `UncheckedAccount` where the meaning depends on `kind`, each fully validated):

| # | Account | Constraint |
|---|---|---|
| 1 | `signer` | Signer, mut |
| 2 | `config` | `["config"]` |
| 3 | `machine` | mut, `["machine"]` |
| 4 | `mint` | the bucket's mint (kinds 1–2) or `config.token_mint` (kinds 3–4); owner SPL Token or Token-2022 |
| 5 | `ledger` | mut, `["ledger", mint]`, owner and discriminator checked |
| 6 | `vault` | mut, `== ATA(vault_auth, mint, mint.owner)`, a token account with `owner == vault_auth` |
| 7 | `vault_auth` | `["vault_auth"]` |
| 8 | `src` | mut. Buys: `== ATA(signer, wSOL, SPL Token)`, native, `owner == signer`. StockSell: `== ATA(signer, mint, mint.owner)`, `owner == signer` |
| 9 | `sol_dest` | mut. StockSell: `== ATA(vault_auth, wSOL, SPL Token)`, existing, native. Other kinds: the System program id |
| 10–13 | `oracle_0..oracle_3` | per §6.3; an unused slot is the System program id |
| 14 | `token_program` | `== mint.owner` |
| 15 | `spl_token_program` | SPL Token (wSOL) |
| 16 | `instructions` | sysvar |

**Checks, in order:**
1. Top level (`NotTopLevel`). `kind ∈ 1..=4` (`InvalidArgument`).
2. Role: `signer == config.keeper` for kinds 1–2, `config.executor` for 3–4 (`Unauthorized`); that role's `disabled_roles` bit clear (`RoleDisabled`).
3. Pause: STOCKBUY for kinds 1–2, BURN for 3–4 (`Paused`).
4. Phase and time per §6.3 (`WrongPhase`, `SeasonOver`).
5. **Pairing** through the instructions sysvar (`ExecPairing`): let `c` be the current index. Among all other instructions of the transaction, exactly one has `program_id == crate::ID`; its index is `> c`, its data starts with the `exec_end` discriminator and its byte 8 equals `kind`.
6. `machine.exec.kind == 0` (`ExecInFlight`).
7. Binding: kinds 1–2: `bucket < 16`, `class ≠ 0`, `buckets[bucket].mint == mint` (`BucketInvalid`). Kinds 3–4: `bucket == 255` and `mint == config.token_mint ≠ 0` (`AccountMismatch`). Vault, ledger, `src`, `sol_dest`, program ids per the table (`VaultMismatch`, `LedgerMismatch`, `AccountMismatch`).
8. StockBuy only: `enabled == 1` (`BucketDisabled`); `mint_is_safe(mint)` (`MintNotSafe`).
9. `rotate_hour(now)` (M1 §11.8), then `rotate_stock_hour`, `rotate_trend_hour(b)` or the burn hour (§6.5).
10. Spacing, tranche, caps per §6.5.
11. Oracle reads and `min_out` per §6.4; `min_out > 0` (`OracleInvalid`).

**Effects:**
- **Buys (1, 3, 4).** Tracked bucket `−= L` (`stock_sol`, `burn_sol` or `jackpot_sol`); move `L` lamports Machine → `src` (direct debit; require `machine.lamports − L ≥ rent_min(3,808)`, else `TrancheTooLarge`, unreachable while I2 holds); CPI `sync_native(src)`. `v0 = vault.amount`, `target = vault`.
- **StockSell (2).** `book = (amount == A) ? C : floor(amount × C / A)` (u128). `A −= amount`, `C −= book`, `ledger.accounted −= amount`; `vault_transfer(amount → src)` (M1 §8.10). `v0 = sol_dest.amount`, `target = sol_dest`, `aux = book`.
- Counters and timestamps per §6.5. `exec = {kind, bucket, amount, v0, min_out, slot: Clock.slot, target, aux}`.
- Event `ExecBegun`.

**P1 independent-audit amendment (B4/B7).** Every implemented entry that reads or changes Machine, a ledger or stock rejects `machine.exec.kind != EXEC_KIND_NONE` with `ExecInFlight` before effects, except the paired `exec_end`. Redeem and Take back append a readonly canonical Machine account to enforce this rule. Buy packs also checks before Anchor creates its Pull. The callback checks the lock on a valid canonical Machine before any reveal, while malformed callbacks retain their existing acknowledgement behavior outside a pair. The Sell and Feed back stubs enforce the same lock before `NotImplemented`. Existing exits remain available outside the atomic pair. Burn in Done is refused in this P1 delivery; permissionless Burn is deferred to the planned upgrade under D18.

### 6.3 Per kind

| Kind | Signer | Pause | Phases (and time) | `oracle_0..3` | Tranche | Spacing | Hourly caps |
|---|---|---|---|---|---|---|---|
| 1 StockBuy, MAJOR | keeper | STOCKBUY | PoweredOn, OnAir; `end_ts == 0 ∨ now < end_ts` | token `PriceUpdateV2`, SOL/USD `PriceUpdateV2`, —, — | `0 < L ≤ MAJOR_TRANCHE`, `L ≤ stock_sol` | `last_stock_trade_ts + SPACING ≤ now` | gross StockBuy cap |
| 1 StockBuy, TRENDING | keeper | STOCKBUY | same | pool (`== bucket.oracle`, canonical), pool base vault, pool quote vault, — | `0 < L ≤ TREND_TRANCHE`, `L ≤ stock_sol` | same | gross cap; `TREND_HOURLY` per mint; TRENDING share |
| 2 StockSell, MAJOR | keeper | STOCKBUY | OnAir, BuysClosed | as MAJOR buy | `book ≤ MAJOR_TRANCHE` | same | gross StockSell cap, **skipped in BuysClosed** |
| 2 StockSell, TRENDING | keeper | STOCKBUY | OnAir, BuysClosed | as TRENDING buy | `book ≤ TREND_TRANCHE` | same | gross cap and `TREND_HOURLY` per mint, every phase |
| 3 Burn | executor | BURN | PoweredOn through FinalPull; Done deferred by D18 | canonical DBC VirtualPool, canonical DAMM v2 pool if migrated (else System), active base vault, active quote vault | `0 < L ≤ min(BURN.trancheMaxLamports, burn_sol, floor(quote_eff × BURN.trancheMaxBpsOfQuoteReserves / 10_000))` | `last_burn_ts + BURN.minSpacingSeconds ≤ now` | `burn_paid_hour + L ≤ BURN.hourlyMaxLamports` |
| 4 JackpotBuy | executor | BURN | OnAir; `now < end_ts` | as Burn | `0 < L ≤ min(JACKPOT.trancheMaxLamports, jackpot_sol, floor(quote_eff × JACKPOT.trancheMaxBpsOfQuoteReserves / 10_000))` | `last_jackpot_buy_ts + JACKPOT.trancheMinSpacingSeconds ≤ now` | none; bounded by `jackpot_sol` |

Bucket class decides the MAJOR or TRENDING row. StockSell works on enabled **and** disabled buckets (sell-down).

### 6.4 Oracle reads and `min_out` (integer only, u128/i128 intermediates, every division floors)

**Pyth `PriceUpdateV2`** (hand parser; confirm the offsets against S4's fixtures, else stop): owner `== PROGRAM_IDS_PYTH_RECEIVER`; length ≥ 133; discriminator `22f123639d7ef4cd`; `verification_level` tag @40 must be `1` (Full; `0` Partial is rejected); then `feed_id [32] @41`, `price i64 @73`, `conf u64 @81`, `exponent i32 @89`, `publish_time i64 @93`. Require `feed_id` = `bucket.oracle` (token) or `HIT_LIST_SOL_USD_PYTH_FEED_ID` (SOL), `price > 0`, `−18 ≤ exponent ≤ 0` (`OracleInvalid`); `now.saturating_sub(publish_time) ≤ PYTH_AGE` (`OracleStale`); `conf × 10_000 ≤ PYTH_CONF × price` (`OracleWide`).

**PumpSwap pool** (X2 §3 offsets): owner PumpSwap; discriminator `f19a6d0411b16dbc`; `index u16 @9 == 0`; `base_mint @43 == mint`; `quote_mint @75 == wSOL`; `pool_base_token_account @139`, `pool_quote_token_account @171` equal `oracle_1`, `oracle_2` ; `is_mayhem_mode @243 == 0`; `virtual_quote_reserves i128 LE @245`; key `== find_program_address(["pool", 0u16 LE, pool_authority, mint, wSOL], PumpSwap)` with `pool_authority = PDA(["pool-authority", mint], pump.fun)`; TRENDING also `== bucket.oracle`. Vault amounts are read from the two token accounts (owner and `mint` field checked). `quote_eff = quote_vault.amount + virtual_quote_reserves` must be `> 0` (`OracleInvalid`).

**Meteora $1PCT [D29 §3b, replaces the earlier curve reference].** Parse the pinned DBC and DAMM v2 IDLs. `oracle_0` is always the canonical DBC VirtualPool derived from the compiled cluster config, $1PCT and wSOL. Its `is_migrated == 0` selects DBC `sqrt_price`; `is_migrated == 1` selects the canonical DAMM v2 migration pool in `oracle_1`. Before migration `oracle_1` is System. `oracle_2..3` are the selected pool's base and quote vaults. Check owners, discriminators, canonical PDA, config, mints, vault addresses and authorities; another pool fails `AccountMismatch`. Use `METEORA.feeAllowBps = 300` for spot-price math below. The tranche reserve `quote_eff` is DBC `quote_reserve u64 @240` or DAMM v2 `token_b_amount u64 @688`, excluding fees and donations, as approved by the architect after M4.1. The quote vault balance is not the tranche reserve. With 30 SOL recorded, the reserve bounds are 75,000,000 lamports for Burn and 300,000,000 for JackpotBuy. Arithmetic uses checked u128/U256 intermediates.

```
MAJOR buy:   e = sol.expo − tok.expo + decimals − 9
             num = L × sol.price; den = tok.price; if e ≥ 0 { num ×= 10^e } else { den ×= 10^(−e) }
             expected = num / den;   min_out = expected × (10_000 − MAJOR_SLIP) / 10_000
MAJOR sell:  e = tok.expo − sol.expo + 9 − decimals;  num = a × tok.price; den = sol.price; same scaling
             expected = num / den;   min_out = expected × (10_000 − MAJOR_SLIP) / 10_000
Pool buy:    L_eff = L × (10_000 − FEE_ALLOW) / 10_000
             expected = base_vault × L_eff / (quote_eff + L_eff)
Pool sell:   gross = quote_eff × a / (base_vault + a)
             expected = min(gross × (10_000 − FEE_ALLOW) / 10_000, quote_vault.amount)
Meteora buy: L_eff = L × (10_000 − METEORA.feeAllowBps) / 10_000
             expected = L_eff × 2^128 / sqrt_price²
min_out (pool, Meteora) = expected × (10_000 − slip) / 10_000, slip = TREND_SLIP (TRENDING), BURN.minOutSlipBps (Burn),
                        JACKPOT.minOutSlipBps (JackpotBuy)
```

Any overflow → `MathOverflow`. **Check values** (both Rust and SDK unit tests):

| Case | Inputs | Result |
|---|---|---|
| MAJOR buy | L 5,000,000,000; SOL price 10,901,000,000 e−8; WIF price 85,000,000 e−8; 6 decimals | e = −3; expected 641,235,294; `min_out` 631,616,764 |
| MAJOR sell | a 641,235,294, same prices | e = 3; expected 4,999,999,999; `min_out` 4,924,999,999 |
| Pool buy, negative virtual reserves | base 500,000,000,000,000; quote vault 400,000,000,000; virtual −2,000,000,000; L 1,500,000,000 | `L_eff` 1,481,250,000; `quote_eff` 398,000,000,000; expected 1,853,966,863,275; `min_out` 1,835,427,194,642 |
| Pool sell | same pool, a 1,000,000,000,000 | gross 794,411,177; expected 784,481,037; `min_out` 776,636,226 |
| DBC or DAMM v2 spot buy, JackpotBuy | sqrt price 2^64; recorded quote 30,000,000,000; L 300,000,000 | `L_eff` and expected 291,000,000; `min_out` 288,090,000; 1% tranche cap 300,000,000 |

### 6.5 Spacing and caps (checked in `exec_begin`, PARAMS §8.1)

```
rotate_stock_hour(now):  h = max(now,0)/3600; if h ≠ stock_hour_index { stock_bought_hour = 0; stock_sold_hour = 0; stock_hour_index = h }
rotate_trend_hour(b,now): h = min(max(now,0)/3600, u32::MAX); if h ≠ trend_hour_index(b) { trend_bought_hour(b) = 0; trend_sold_hour(b) = 0; trend_hour_index(b) = h }
rotate_burn_hour(now):   h = max(now,0)/3600; if h ≠ burn_hour_index { burn_paid_hour = 0; burn_hour_index = h }
h_out = max(hit_out_last_hour, hit_out_this_hour)            // after rotate_hour(now)
cap   = max(HOUR_FLOOR, HOUR_MULT × h_out)                     // saturating
StockBuy:   last_stock_trade_ts + SPACING ≤ now                                      TooSoon
            C(b) + L ≤ cap(b)                                                        BucketCapExceeded
            stock_bought_hour + L ≤ cap                                              HourlyCapReached
            TRENDING: trend_bought_hour(b) + L ≤ TREND_HOURLY                        HourlyCapReached
            TRENDING: (Σ_{class 2} C + L) × 10_000 ≤ TREND_SHARE × (stock_sol + Σ_all C)   TrendingShareExceeded
            then stock_bought_hour += L; trend_bought_hour(b) += L (TRENDING); last_stock_trade_ts = now
StockSell:  last_stock_trade_ts + SPACING ≤ now                                      TooSoon
            0 < amount ≤ A(b)                                                        InvalidArgument
            C(b) − book ≥ reserved(b)                                                ReservedCapacity
            unless (MAJOR ∧ phase == BuysClosed): stock_sold_hour + book ≤ cap      HourlyCapReached
            TRENDING: trend_sold_hour(b) + book ≤ TREND_HOURLY                       HourlyCapReached
            then counters += book (as applicable); last_stock_trade_ts = now
Burn:       last_burn_ts + BURN.minSpacingSeconds ≤ now; burn_paid_hour + L ≤ BURN.hourlyMaxLamports
            then burn_paid_hour += L; last_burn_ts = now
JackpotBuy: last_jackpot_buy_ts + JACKPOT.trancheMinSpacingSeconds ≤ now; then last_jackpot_buy_ts = now
```

Check values: with `hit_out_last_hour = hit_out_this_hour = 0`, `cap = 30,000,000,000`; with last 10 SOL and this 22 SOL, `cap = 44,000,000,000`.

### 6.6 `exec_end(kind: u8)`

**Accounts:** `signer` (Signer, mut), `config`, `machine` (mut), `mint` (mut: Burn lowers supply), `ledger` (mut), `vault` (mut), `vault_auth`, `sol_dest` (mut; System program id unless StockSell), `token_program`, `spl_token_program`, `system_program`.

**Checks, in order:** top level (`NotTopLevel`); `exec.kind == kind ≠ 0` and `exec.slot == Clock.slot` (`ExecPairing`); the role of §6.2 step 2 (`Unauthorized`, `RoleDisabled`); `mint`, `vault`, `ledger` bind to the record as in begin, and the measured account (`vault` for buys, `sol_dest` for StockSell) `== exec.target` (`AccountMismatch`). Reload the measured account: `Δ = amount_now.saturating_sub(v0)`; `Δ ≥ min_out` (`SlippageExceeded`). Kinds 1, 3, 4: **unclaimed slack** `vault.amount.saturating_sub(ledger.accounted) ≥ Δ` (`SlackShort`).

**Effects:**

| Kind | Effect |
|---|---|
| StockBuy | `A(b) += Δ`; `C(b) += L`; `ledger.accounted += Δ` |
| JackpotBuy | `jackpot_tokens += Δ`; `jackpot_cost += L`; `ledger.accounted += Δ` |
| Burn | `vault_burn(Δ)` (`burn_checked`, signed by `vault_auth`); `burned_total += Δ` |
| StockSell | `close_account(sol_dest → signer)` signed by `vault_auth`; `system_program::transfer(signer → machine, Δ)`; `stock_sol += Δ` |

Then, kinds 1, 3, 4: reload the vault and require `vault.amount ≥ ledger.accounted` (`VaultInvariant`). Clear `exec` (80 zero bytes). Event `ExecEnded`.

### 6.7 What a stolen hot key can cost (the only claim allowed)

- A trade cannot take funds out: if the swap slot does not deliver `min_out` to a program-controlled account, the transaction reverts and nothing moved.
- **MAJOR:** `min_out` is `MAJOR_SLIP` below a Pyth price up to 60 s old with confidence ≤ 1%: about 1.5–3% per trade. With the 20 s spacing and the gross caps, about 3% of the caps per clock hour: ≈1.8 SOL at the 30 SOL floor, twice that across an hour boundary (PARAMS §8.1, §24 A1).
- **TRENDING and `$1PCT`:** `min_out` reads reserves the same key can move inside its own bundle, so only the tranche and the caps bound the loss: ≤ 1.5 SOL per TRENDING trade, ≤ 10 SOL per mint per hour each way, TRENDING ≤ 15% of book; Burn ≤ 1 SOL per 20 s and ≤ 10 SOL per hour; JackpotBuy ≤ 2 SOL per 20 s, within `jackpot_sol`.
- Either way, until a guardian disables the role (`DisableRole`), which takes effect at the next `exec_begin`. Never claim more than this.
- **Why each rule.** Top level: without it a key CPIs `feed` from the swap slot and one deposit counts twice (master §7.1). Slack: `exec_end` can never credit tokens that already belong to someone. Two-instruction rule (B4): nothing else of ours runs inside a pair. `ExecInFlight` (B7): no `sell_back` or `feed_back` inside a pair. Spacing and caps: one trade's `min_out` cannot bound a loop.

---

## 7. My cards (P2)

### 7.1 `sell_back(cards: Vec<SellBackCard { index: u16, amount: u64 }>, quote_lamports: u64, expiry: i64, nonce: u32, att_ix: u8)`

**Accounts:** `owner` (Signer, mut), `config`, `machine` (mut), `binder` (mut, `["binder", owner]`), `mint`, `ledger` (`["ledger", mint]`, read-only), `vault` (canonical, read-only), `instructions` (sysvar). No remaining accounts; no token moves.

**Message** (PARAMS §6.3), built byte for byte on-chain from the arguments, in argument order:
```
"1PCT-SB-v1" ‖ program_id ‖ owner ‖ mint ‖ n u8 ‖ (index u16 LE ‖ amount u64 LE) × n ‖ total_amount u64 LE
‖ quote_lamports u64 LE ‖ expiry i64 LE ‖ nonce u32 LE                         length = 135 + 10n (n = 8: 215 B)
```
Check values: program id 32 × 0x00, owner 32 × 0x01, mint 32 × 0x02, one card (index 3, amount 1,000), total 1,000, quote 5,000,000, expiry 1,800,000,000, nonce 0 → 145 B, sha256 `edf53101d7a0071b005cdae28d29e6ddbe17c9e9ab59d57efa7df9455d8b501c`. Eight cards (index 7 − k, amount 1,000 + k), total 8,028, nonce 7 → 215 B, sha256 `53fec985a265aeaa8eeeecc3d254da20f4d224c6c9cb3d63c87c4ca439676c76`.

**Checks, in order:**
1. Not `paused(SELLBACK)` (`Paused`); `phase == OnAir` (`WrongPhase`); `now < end_ts` (`SeasonOver`); quote role (6) not disabled (`RoleDisabled`); `machine.exec.kind == 0` (`ExecInFlight`).
2. `1 ≤ n ≤ MAX_SELL_BACK_CARDS`; indices strictly descending; `quote_lamports > 0` (`InvalidArgument`).
3. Each card: `index < binder.len`, `card.mint == mint`, `card.amount == amount` (`CardMoved`); `card.kind ∈ 1..=4` and `HIT_TIERS_SELL_BACK[kind − 1]` (`NotSellBackable`).
4. Bucket `b`: the bucket with `mint == mint` and `class ≠ 0` (`BucketInvalid`); `enabled == 1` (`BucketDisabled`). `mint_is_safe(mint)` (`MintNotSafe`). Vault and ledger canonical; `vault.amount ≥ ledger.accounted` (`VaultInvariant`).
5. `verify_ed25519(att_ix, config.quote_signer, message)` (M1 §8.6; `AttestationInvalid`). `ttl = SB_TTL[class]`; `now ≤ expiry ≤ now + ttl` (`AttestationExpired`). `nonce == binder.sb_nonce` (`AttestationReplay`); `sb_nonce += 1`.
6. `rotate_hour(now)`. In u128, checked to u64: `S = Σ card.value`, `T = Σ amount`.

```
v       = min(S, quote_lamports)
payout  = v × SB_BPS / 10_000              // floor; require payout > 0 (InvalidArgument)
margin  = v − payout
below   = stock_sol + Σ_all C(b) < TARGET_BASE + hit_out_last_hour
to_team = below ? 0 : margin
require stock_sol ≥ payout + to_team + SB_FLOOR                                     SellBackFloor
require sb_paid_hour + payout ≤ max(SB_MIN, sol_at_hour_start × SB_PCT / 10_000)    SellBackBudget
require C(b) + v ≤ cap(b)                                                           BucketCapExceeded
```

**Effects:** `stock_sol −= payout + to_team`; `team_sol += to_team`; `sb_paid_hour += payout`; move `payout` lamports Machine → owner; `A(b) += T`; `C(b) += v`; for each card in argument order: `swap_remove(index)` then `shrink_to_fit(owner)` (M1 §8.3). The ledger and the vault are unchanged: the tokens move from cards to the bucket inside the vault. Event `SoldBack`.

Payout check values: (S 50,000,000, q 49,999,999) → 43,499,999; (50,000,000, 60,000,000) → 43,500,000; (1,500,000,000, 1,400,000,001) → 1,218,000,000; (15,000,000,000, 15,000,000,000) → 13,050,000,000; (1, 1) → 0, rejected.

### 7.2 `feed_back(card_indices: Vec<u16>)`

**Accounts:** `owner` (Signer, mut), `config`, `machine`, `deck` (mut), `binder` (mut, `["binder", owner]`), `system_program`.

**Checks:** not `paused(FEED)`; phase ∈ {StockUp, PoweredOn, OnAir} and `end_ts == 0 ∨ now < end_ts` (`WrongPhase`, `SeasonOver`); `machine.exec.kind == 0` (`ExecInFlight`); `owner.owner == System` (`NotWallet`); `!team(owner)` (`TeamWallet`); `1 ≤ n ≤ MAX_FEED_BACK_CARDS`, strictly descending (`InvalidArgument`); each `index < len` (`CardMoved`); each `kind ∈ 0..=4` (`NotFeedable`: Jackpot, The 1%, Spotlight and Final are refused); `deck.len + n ≤ DECK_MAX` (`DeckFull`). No attestation, no snapshot, no fresh cap, no 1-per-mint rule.

**Effects:** for each index: `swap_remove` the card, `shrink_to_fit(owner)`. Then Deck `append` (M1 §8.2) of the n entries `{depositor = owner, mint, amount, deposit = entry_deposit, flags = REFED}`, charged to the owner; `total_fed += n`. `fresh_in_deck`, the ledger and the vault are unchanged. One `CardFedBack` per card.

### 7.3 `withdraw_owed()` — exit

**Accounts:** `owner` (Signer, mut), `binder` (mut, `["binder", owner]`). If `sol_owed == 0`: `Ok`, no event. Else `pay = min(sol_owed, binder.lamports.saturating_sub(rent_min(binder.data_len())))`; `sol_owed −= pay`; move `pay` to the owner. Event `OwedWithdrawn`. No error path after the account checks. M4 writes `sol_owed`; M2 tests inject it.

### 7.4 `close_binder()` — exit

**Accounts:** `owner` (Signer, mut), `binder` (mut, `["binder", owner]`).

**Checks:** `len == 0 ∧ fresh_in_deck == 0 ∧ sol_owed == 0` (`BinderNotEmpty`); **`reserved == 0`** (`PullPending`); `season_spend == 0 ∨ (flags & 0b11) == 0b11` (`FinalNotClaimed`, B8).

**Effects:** `close_to(binder → owner)`: every lamport, donations included. Event `BinderClosed`.

**Why `reserved == 0`:** without it, `[buy_packs AH ×5][close_binder]` makes the callback skip and the Pull refund at 300 s: 75 SOL of MAJOR coverage locked for 0.0005 SOL, and a free reroll for a leader who sees the draw first (master §11.4).

**Accepted residue:** a closed and re-created Binder restarts its FEED window at 0, so a FEED attestation still inside its 120 s TTL could land again. It covers exactly the bags it attested (whole bags the signer checked), so it gains nothing. T15.04 records it.

---

## 8. Events and errors (P0; append-only)

**Errors**, appended after `NotTopLevel`, in this order: `ExecPairing`, `ExecInFlight`, `TooSoon`, `TrancheTooLarge`, `HourlyCapReached`, `TrendingShareExceeded`, `BucketCapExceeded`, `ReservedCapacity`, `BucketDisabled`, `OracleInvalid`, `OracleStale`, `OracleWide`, `SlippageExceeded`, `SlackShort`, `NotSellBackable`, `SellBackFloor`, `SellBackBudget`, `NotFeedable`, `BinderNotEmpty`, `PullPending`, `FinalNotClaimed`. `TrancheTooLarge` also covers `L` above the tracked SOL or the reserve bound.

**Events**, appended:

| Event | Fields |
|---|---|
| `ExecBegun` | kind u8, bucket u8, mint, signer, amount u64, min_out u64, v0 u64, book u64, expected u64, ts i64 |
| `ExecEnded` | kind u8, bucket u8, mint, amount u64, min_out u64, delta u64, book u64, tracked_after u64 (the bucket of SOL the kind touched), ts i64 |
| `SoldBack` | owner, mint, bucket u8, n u8, total_amount u64, stocked_value u64, quote_lamports u64, value u64, payout u64, to_team u64, nonce u32, sb_paid_hour u64, slot_refund u64 |
| `CardFedBack` | owner, mint, amount u64, kind u8, card_index u16, moved_from u16, deck_index u32, deposit u64, slot_refund u64 |
| `OwedWithdrawn` | owner, amount u64, remaining u64 |
| `BinderClosed` | owner, lamports u64 |

**SDK error map additions** (M1 §15.5; strings in COPY.md, M3): `SellBackFloor`, `SellBackBudget`, `BucketCapExceeded`, `BucketDisabled` and `AttestationExpired` inside `sell_back` → `sellBackFallback` (the UI offers Sell at market); `NotFeedable` → `notFeedable`; `PullPending` → `pullPending`; `BinderNotEmpty`, `FinalNotClaimed` → `myCardsNotEmpty`; every other new error → `generic`.

---

## 9. Invariants M2 touches (master §9.1)

| # | How M2 keeps it | Asserted by |
|---|---|---|
| I1 | `exec_end` credits or burns only `Δ ≤ vault − accounted`; StockSell lowers `accounted` by exactly the tokens it moves; `sell_back` and `feed_back` move no token | `SlackShort`, `VaultInvariant`; EX-1, P2 |
| I2 | Buys debit tracked SOL before moving lamports; StockSell credits exactly the measured `received`; Sell back pays from `stock_sol` | P2, EX-1 |
| I3 | StockSell keeps `free(b) ≥ 0`; nothing else touches `reserved` | `ReservedCapacity`; P2 |
| I8 | `C(b)` changes only by carve, StockBuy (`+L`), `sell_back` (`+v`), StockSell (`−book`) | P2 with a per-op `C` ledger |
| I10 | `withdraw_owed`, `close_binder` join the exits | T16.01 |
| I12 | `payout ≤ 0.87 × S`, within the hourly budget, `stock_sol ≥ SB_FLOOR` after | SB-1 |
| I13 | `exec` is zero at the end of every transaction; `exec_begin`, `exec_end`, `feed` top-level only | T12.06, EX-1 |

---

## 10. SDK additions (`packages/sdk`)

| Module | Content | PR |
|---|---|---|
| `layouts.ts` | new Machine, Bucket and ExecRecord fields; offsets in `layouts.json` | P0 |
| `attest.ts` | `sellBackMessage({programId, owner, mint, cards, totalAmount, quoteLamports, expiry, nonce})`; sorts nothing (the caller passes descending indices; it throws otherwise) | P0 |
| `ix/*` | `execBeginIx`, `execEndIx`, `sellBackIx`, `feedBackIx`, `withdrawOwedIx`, `closeBinderIx` | P0 |
| `math/exec.ts` | `minOutMajor`, `minOutPoolBuy`, `minOutPoolSell`, `minOutMeteoraBuy`, `bookOf`, `stockCap`, `rotateStockHour`, and `checkExecBegin(state, args, readings, now)` with `state.deployment: ClusterDeployment`, the full §6.2–§6.5 mirror returning `{ok, minOut}` or the program error name | P1 |
| `tx/exec.ts` | `composeExecTransaction({deployment, payer, beginIx, swap: {setup, swap, cleanup, lookupTables}, endIx, computeBudget, extraIxs, protocolLut, blockhash})` → v0, with `serializedSize` | P1 |
| `math/sellback.ts` | `sellBackPayout`, `sellBackChecks(machine, bucket, cards, quote, now)` mirroring §7.1 | P2 |
| `tx/sellback.ts`, `tx/feedback.ts`, `tx/binder.ts` | `buildSellBackTransaction` (`[ed25519 SB] sell_back`, ≤ 1,232 B, with `CU_LIMITS.sellBack`), `buildFeedBackTransactions`, `buildCloseBinderTransaction`, `buildWithdrawOwedTransaction` | P2 |
| `events/*` | IDL event decoder and the stack-aware log parser (§11.3) | S1 |
| `tx/merge.ts` | `buildMergeTransactions(wallet, mint, sources, canonicalAta)`: `transfer_checked` every other account into the canonical ATA, then `close_account` each | S2 |
| `api/*` | zod schemas of §11.8 (`@onepercent/sdk/api`) | S4 |
| `verify/*` | `verifyPull` (§11.9; `@onepercent/sdk/verify`) | S4 |
| `vrf/*` | `decodeVrfQueue(data)` (§11.7) | S4 |

`CU_LIMITS` gains `execBegin`, `execEnd`, `sellBack: {x1, x8}`, `feedBack: {x1, x8}`, `closeBinder`, `withdrawOwed` (M1 §16.3 rule: worst measured × 1.25, rounded up to 1,000).

---

## 11. Services core (M2.2)

### 11.1 Runtime and key isolation (`packages/service-kit`, S0)

| Module | Rule |
|---|---|
| `env.ts` | `loadRoleEnv(role, schema)`. Roles: `public`, `intake-signer`, `quote-signer` (api); `indexer`, `keeper`, `executor`, `monitor` (worker; `executor` and `monitor` boot to a health-only stub in M2). **Refuses to boot** (exit 1, logging the variable name only) if the environment holds any variable matching `/_KEYPAIR$/`, `/PRIVATE_KEY/`, `/SECRET_KEY/`, `/MNEMONIC/` or `/SEED_PHRASE/` other than the role's own: `INTAKE_SIGNER_KEYPAIR`, `QUOTE_SIGNER_KEYPAIR`, `KEEPER_KEYPAIR`, `EXECUTOR_KEYPAIR`. `public`, `indexer` and `monitor` own none |
| `keys.ts` | Parses the own key (base58 64 B or JSON array), derives the public key, deletes the env variable, never logs or serializes it. At boot and every `SERVICES.signers.roleRecheckSeconds` it reads `Config`: the role field must equal the public key and the `disabled_roles` bit must be clear; otherwise the service stops signing or sending and `/health` returns 503 with `{reason: "role_mismatch" | "role_disabled"}` |
| `log.ts` | pino with fixed base fields `{service, role, cluster, version, commit}`; redaction of `*.secretKey`, `authorization`, `x-api-key`, any `api-key=` query; RPC URLs logged by host only; client IPs as `sha256(LOG_IP_SALT ‖ ip)` |
| `metrics.ts`, `health.ts` | `/metrics` (prom-client) and `/health` (liveness) plus `/ready` (DB, Redis, RPC, key check) on the private port |
| `redis.ts` | ioredis; sliding-window limiter (`limit(key, max, windowS)` → `{ok, retryAfterS}`, one Lua call); Redis Stream helpers for SSE |
| `leader.ts` | `pg_try_advisory_lock(hashtext('onepct:keeper'))` on a dedicated session; on session loss the leader stops every job within one tick; followers retry every `SERVICES.keeper.followerRetrySeconds`, so failover ≤ `SERVICES.keeper.leaderFailoverSeconds` |
| `tx.ts` | `TxSender`: v0 build, simulate, send, poll `getSignatureStatuses`, rebuild on blockhash expiry, jittered backoff (`backoffBaseMs` … `backoffMaxMs`, ≤ `sendMaxAttempts`), priority price = p75 of `getRecentPrioritizationFees` over the writable accounts, capped at `SERVICES.landing.maxComputeUnitPriceMicroLamports` |
| `rpc.ts` | zod JSON-RPC client; `chainNow()` reads the Clock sysvar at `confirmed` (never the host clock for on-chain deadlines); `blockTimeNow()` for attestation expiries |
| `alert.ts` | `alert(key, severity, payload)`: deduplicated per key for `SERVICES.monitor.alertDedupeSeconds`, written to `alerts` and posted to `ALERT_WEBHOOK_URL` if set. M6.1 adds paging |

Internal calls `api(public) → intake-signer | quote-signer` go over Railway's private network with a bearer `INTERNAL_TOKEN` distinct per signer. The signer re-validates every field; it trusts nothing from the caller except the hashed client IP header for its log.

### 11.2 `packages/db` (S0): Postgres 17, drizzle

- **Tool:** `drizzle-orm` 0.45.3 schema in TS; `drizzle-kit` 0.31.11 `generate` writes SQL to `packages/db/drizzle/` (committed). `pnpm --filter @onepercent/db migrate` applies them with drizzle's node-postgres migrator, as the Railway pre-deploy command of every service. **Forward-only:** a merged migration is never edited; no down migrations; a destructive change takes two releases. CI fails if `drizzle-kit generate` produces a diff.
- **S0 defines every M2 table** in migration `0000`, so the other PRs add none (a later need: a new migration, regenerated after rebase).
- All amounts `numeric(20,0)` (u64), mapped to `bigint` in TS; pubkeys `text`; times `timestamptz`; `order_key` = `(slot, tx_index, ix_index, event_index)` as four `bigint`s with a composite index.

| Table | Key | Main columns | Writer |
|---|---|---|---|
| `chain_txs` | `signature` | slot, block_time, tx_index, commitment (`confirmed`/`finalized`), err, truncated | indexer |
| `chain_events` | (`signature`, `ix_index`, `event_index`) | order_key, name, data jsonb (bigints as strings) | indexer |
| `cursors` | `name` | last_signature, last_slot | indexer |
| `pulls` | `seq` | address, buyer, buyer_nonce, edition, qty, price, referrer, holder, status (`pending`, `revealed`, `closed`, `refunded`), created_ts, opened_sig, revealed_sig, revealed_slot, reveal_order, live_flags, randomness, settled_mask | indexer |
| `packs` | (`seq`, `pack`) | t, widths int[6], tier, hit_bucket, hit_mint, hit_amount, hit_value, house_mask, fresh_mask | indexer |
| `dust_picks` | (`seq`, `pack`, `k`) | deck_len_before, deck_index, moved_from, mint, amount, depositor, royalty, refund, paid, redirected, settle_sig | indexer |
| `deck_entries` | `deck_index` | depositor, mint, amount, deposit, flags, order_key | indexer |
| `feeds` | (`signature`, `event_index`) | depositor, mint, amount, deck_index, deposit, fresh_in_deck, attestation_sha256 | indexer |
| `mint_ledgers` | `mint` | ledger, payer, accounted, vault, token_program, vault_exists, closed_at | indexer |
| `buckets` | `index` | mint, class, enabled, amount, cost, reserved, cap, listed_slot, failing | indexer, keeper (`failing`) |
| `machine_state` | `id = 1` | slot, machine jsonb, config jsonb, deck_len | indexer |
| `intake_consumption` | (`holder`, `mint`) | used_by, path (`self`, `hop`, `unknown`), first_feed_sig, slot | **indexer only** |
| `attestation_log` | `id` uuid; unique `message_sha256` | kind (`FEED`), wallet, nonce, expiry, bags jsonb `[{mint, amount, path, via}]`, signer, ip_hash, created_at | **intake signer only, insert-only** |
| `quote_log` | `id`; unique `message_sha256` | owner, mint, card_indices, amounts, total_amount, quote_lamports, value_lamports, payout_lamports, expiry, nonce, router, request_id, signer, ip_hash | **quote signer only, insert-only** |
| `sell_backs`, `exec_trades`, `royalties` | `signature` / `signature` / (`seq`, `pack`, `k`) | event fields | indexer |
| `keeper_jobs` | `id` text (`settle:<seq>:<packs>`, `refund:<seq>`, …) | kind, payload, status (`pending`, `sent`, `confirmed`, `failed`, `skipped`), attempts, next_attempt_at, last_error, signature | keeper |
| `stock_plans`, `stock_trades`, `hitlist_reports` | `id` | §12 | keeper (K1), cli |
| `alerts` | `key` | severity, first_at, last_at, count, payload | every service |

Every mirror table can be rebuilt from `chain_events` or from the chain (master §3.4). The signer logs are logs; nothing reads them to decide eligibility except the indexer's provenance join (B9).

### 11.3 Indexer (S1, `ROLE=indexer`)

**Transport: standard Solana JSON-RPC, HTTP plus WebSocket, on Helius; Triton as the automatic fallback.**
- **Durable path:** a signature cursor. Every `SERVICES.indexer.pollMs`, `getSignaturesForAddress(PROGRAM_ID, {until: cursor, limit: 1000, commitment: "confirmed"})`, paged until the cursor, then `getTransaction(sig, {commitment: "confirmed", maxSupportedTransactionVersion: 0})`. The program id appears in every transaction that invokes it, the VRF callback and CPIs included.
- **Fast path:** `logsSubscribe({mentions: [PROGRAM_ID]}, "confirmed")` only triggers an immediate poll. WebSocket data is never stored.
- **Why not Helius webhooks:** they need a public inbound endpoint into a private service, deliver at least once and out of order, and tie the indexer to one vendor. **Why not LaserStream:** a plan dependency and vendor gRPC for a volume (tens of transactions per second at peak) that polling serves within the 2 s budget. **Fallback:** after `SERVICES.indexer.fallbackAfterFailures` consecutive RPC failures, switch to `INDEXER_RPC_URL_FALLBACK` (Triton) and alert; switch back after `fallbackRecoverSeconds` of health. A LaserStream source may later replace the transport behind the same `TxSource` interface without touching the parser.
- **Order within a slot:** `getBlock(slot, {transactionDetails: "signatures", rewards: false, maxSupportedTransactionVersion: 0})` once per slot that holds our transactions (cached) gives `tx_index`. Everything is applied in `order_key` order.
- **Parsing:** decode only `Program data:` lines emitted while the innermost frame is `onepercent`, tracked with an invoke-depth stack over `Program <id> invoke [n]` / `success` / `failed` lines (a foreign program cannot forge our events). Skip failed transactions. `ix_index` is the top-level instruction that contains the frame; `event_index` the ordinal in the transaction. A `Log truncated` line sets `truncated` and triggers an account reconcile of every account the transaction touched.
- **Finality:** rows are written at `confirmed`. A finalizer marks `finalized` once `slot ≤ getSlot("finalized")`; a confirmed transaction missing at finalized time is deleted with its rows, the mirrors it touched are rebuilt from accounts, and `fork_rollback` is alerted.
- **Mirrors:** `pulls`, `packs`, `dust_picks`, `royalties`, `feeds`, `sell_backs`, `exec_trades`, `mint_ledgers`, `buckets`, `machine_state` and the **Deck mirror**: apply `BagFed` (set at `deck_index`), `BagTakenBack` and each `DustPick` (`moved_from ≠ u32::MAX` moves that entry into `deck_index`, then the last slot is dropped), `CardFedBack` (set at `deck_index`). Every `deckReconcileSeconds` and at boot, read the Deck header, then the entries in `dataSlice` chunks of `deckChunkBytes`, and rewrite any differing row (`deck_drift` metric; alert when non-zero twice in a row). Machine, Config, ledgers and open Pulls are re-read every `accountReconcileSeconds`.
- **Consumption (B9):** for each landed `BagFed`, find the transaction's Ed25519 instruction, hash its message, and join `attestation_log` on `message_sha256`. For that bag: `holder = via ?? depositor`; `INSERT INTO intake_consumption (holder, mint, used_by, path, …) ON CONFLICT DO NOTHING` (the first landed Feed wins; two attestations for one provenance within one TTL can both land: master §3.3 accepts one extra card). No log row: recompute provenance with the same pure rules as the signer (§11.4; they live in `packages/service-kit/src/intake/`, owned by S2 and imported by both); if evidence is unavailable, write `path = 'unknown'`, `holder = depositor`, and alert `intake_log_missing`.
- **SSE publish:** after committing a transaction's rows, `XADD onepct:events MAXLEN ~ sseReplayEvents` one compact event per program event, id = `slot-tx_index-event_index`. Nothing is published before the transaction is confirmed, so no reveal outcome reaches a client before `PackRevealed` is on chain.
- **Idempotency:** every write is an upsert on its natural key; mirrors derive only from ordered events and account reads. `pnpm --filter worker indexer:replay --from-slot <s>` truncates the mirrors and rebuilds them.
- **Lag:** `indexer_lag_slots = confirmed slot − last applied slot`, published in Redis for the intake signer (§11.4) and `/api/status`.

### 11.4 Intake signer (S2, `ROLE=intake-signer`, FEED only; HOLD is M4.2)

**Route** `POST /internal/feed/attest`, reached through `POST /api/feed/attest`.

```ts
FeedAttestRequest = z.object({
  wallet: PublicKeyString,
  chunks: z.array(z.array(z.object({ mint: PublicKeyString, amount: U64String.optional() }).strict())
            .min(1).max(TX_LIMITS.feedBagsPerTxWithLookupTable)).min(1).max(TX_LIMITS.txPerSignAll),
}).strict()   // mints distinct across the whole request
FeedAttestResponse = z.object({
  wallet: PublicKeyString, signer: PublicKeyString, snapshotSlot: z.number(),
  attestations: z.array(z.object({ chunk: z.number(), nonce: U32, expiry: z.number(), bagsHash: Hex32, message: Base64, signature: Base64,
    bags: z.array(z.object({ mint: PublicKeyString, amount: U64String, decimals: z.number(), tokenProgram: PublicKeyString,
                             source: PublicKeyString, mergeFrom: z.array(PublicKeyString) })) })),
  refused: z.array(z.object({ mint: PublicKeyString, reason: FeedRefusal, date: z.string().nullable() })),
})
```

**Whole bags.** For each mint the signer reads, at `confirmed`, every token account of the wallet for that mint and attests `amount = Σ balances`. If the request carries an `amount` that differs, the bag is refused with `not_whole_bag`. If the balance sits in several accounts, `source` is the canonical ATA and `mergeFrom` lists the others: the client merges them first (`buildMergeTransactions`) within the TTL. The signer never signs a number the client supplied.

**Hard-check mirror** (saves a failed transaction; the program enforces H1–H8 anyway): pump.fun origin and `mint_is_safe` through `packages/market` (`deriveBondingCurve`, `hasDiscriminator`, `createMintSafetyClient`); mint ≠ `Config.token_mint`, ≠ wSOL; Feed open (phase, `end_ts`, FEED pause bit) else `feed_closed`; remaining fresh cap `FRESH_CAP − binder.fresh_in_deck` ≥ bags requested, excess refused `fresh_cap`.

**Soft rules** (SPEC S1–S5, as decided here). Evidence comes from Helius `getTransactionsForAddress` (filters `tokenTransfer: {mint}`, slot bounds, `transactionDetails: "full"`), as X1 uses it. Definitions per wallet `W` and mint `M`:
- `inflow(tx)`: W's total M balance (Σ over W-owned accounts in pre/postTokenBalances) rises.
- `swapInflow(tx)`: an inflow where W signed, and W spent value in the same transaction: some other token balance of W fell, or W's lamports fell by more than the fee W paid plus the rent of accounts created for W.
- `transferInflow(tx)`: any other inflow. Its sender is the owner of the token account whose M balance fell the most (ties: lowest account index); no falling balance → `airdrop`.
- `balanceAtS(X)`: X's M balance after its last M transaction at or before `S` (0 if none). `first(X)`: X's earliest M inflow.
- `usedByOther(X, W)`: a row `intake_consumption(holder X, mint M)` exists with `used_by ≠ W`.

| `first(W)` | Eligible iff | Provenance | Refusal reason |
|---|---|---|---|
| a `swapInflow` | `first(W).slot ≤ S` ∧ `balanceAtS(W) > 0` ∧ `¬usedByOther(W, W)` | `self` | `snapshot_not_held`, `passed_on` |
| a `transferInflow` from X | `X ≠ W` ∧ `¬team(X)` ∧ `balanceAtS(X) > 0` ∧ `first(X)` is a `swapInflow` with slot ≤ S ∧ `¬usedByOther(X, W)` | `hop`, `via = X` | `hop_sender_ineligible`, `hop_used` |
| `airdrop` or none | never | — | `not_bought` |

Always also: `balanceNow(W) > 0` (`zero_balance`); no live FRESH Deck entry for (W, M) in the indexer's Deck mirror (S4, `live_card`); W not a team wallet (S5, `team_wallet`). One hop only: X must qualify by the first row itself. **A holder's eligibility for a mint serves exactly one wallet**, which may re-feed it after a take-back. Refusals carry the date of `S` or of the deciding transaction (`date`), for the per-bag reason line. Disagreement with S6's 20 wallets: stop and report.

**Side-effect free.** The signer reads chain, Redis and the indexer tables and signs. Its only write is one `attestation_log` row per attestation, inserted **before** the response (insert failure → 503, nothing signed). It never writes `intake_consumption`, the Deck mirror or any cache that changes a verdict. Evidence about history at or before `S` is immutable and may be cached for `SERVICES.signers.evidenceCacheSeconds`; live facts (`balanceNow`, consumption, live cards) are never cached.

**Nonces and expiry.** Nonces = `feedNonces(base, bits, chunks.length)` (M1 SDK) from the Binder at `confirmed` (base 0, bits 0 if it does not exist). `expiry = attestationExpiry(blockTime(latest confirmed slot), FEED_TTL)` (M1 §8.6). Two concurrent requests may get the same nonces; at most one lands per nonce.

**Guards.** 503 `indexer_lag` when the indexer lags more than `SERVICES.indexer.maxLagSecondsForIntake`; 503 `role_mismatch`/`role_disabled` (§11.1); 503 `evidence_unavailable` when Helius fails (never sign blind). **Rate limits:** the public API applies `INTAKE.rateLimitPerMinutePerIp` (60) and `INTAKE.rateLimitPerMinutePerWallet` (30, keyed by the requested wallet) before forwarding; the signer re-applies the per-wallet limit. 429 carries `Retry-After`. The Feed Blink (M5) uses this same path.

### 11.5 Quote signer (S2, `ROLE=quote-signer`)

**Route** `POST /internal/sellback/quote`, reached through `POST /api/sellback/quote`.

```ts
SellBackQuoteRequest = z.object({ owner: PublicKeyString, cardIndices: z.array(U16).min(1).max(MAX_SELL_BACK_CARDS) }).strict() // distinct
SellBackQuoteResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), quote: z.object({ owner, mint, cards: z.array(z.object({ index: U16, amount: U64String })),
    totalAmount: U64String, quoteLamports: U64String, stockedValueLamports: U64String, valueLamports: U64String,
    payoutLamports: U64String, expiry: z.number(), nonce: U32, bucketClass: z.enum(["MAJOR", "TRENDING"]),
    message: Base64, signature: Base64, signer: PublicKeyString, router: z.string(), requestId: z.string() }) }),
  z.object({ ok: z.literal(false), reason: SellBackRefusalReason }),
])   // owner and mint are PublicKeyString; SellBackRefusalReason is X2's union
```

**Steps:** read the Binder and the Machine at `confirmed`; take the cards at `cardIndices` (amount, value, kind, mint all from chain); `blockTime` = latest confirmed block time; apply the SDK `rotateHour(machine, blockTime)`; build X2's `MachineSnapshot` (`sbHourIndex = hour_index` after rotation); call X2 `quoteSellBackBatch({owner, cards, nonce: binder.sb_nonce, nowTs: blockTime}, snapshot, valueNow)` with the signer's own Jupiter key (one `/order` for the batch total). On refusal return it unchanged. On success: sort cards by descending index, `expiry = attestationExpiry(blockTime, SB_TTL[class])` (X2's `expiresAt` is not used), encode with the SDK `sellBackMessage`, sign, insert the `quote_log` row, respond. Rate limits: `SERVICES.quote.rateLimitPerMinutePerWallet` / `PerIp`. The worst a leaked quote key can do is bounded on-chain (I12).

### 11.6 Keeper v1 (S3, `ROLE=keeper`, leader only)

Every job reads the chain before acting, is keyed in `keeper_jobs`, is deduplicated by signature, and relies on the program's own no-ops. Deadlines use `chainNow()`.

| Job | Trigger | Action |
|---|---|---|
| Settle | its own `logsSubscribe` seeing `PullRevealed` (parsed with `@onepercent/sdk/events`), plus a scan every `SERVICES.keeper.scanSeconds`: `getProgramAccounts` with the Pull discriminator memcmp @0 and `status == 2` memcmp @144 (no `dataSize`: a Pull's size depends on `qty`) | `buildSettleTransaction` (M1 SDK): ≤ `TX_LIMITS.settlePacksPerTx` packs, memo `1pct:roy:<seq>`, payee writability from fetched `executable` flags (M1 A14) |
| Refund | the same scan, `status == 1` and `created_ts + VRF.timeoutSeconds ≤ chainNow()` | `refund_pull` |
| Advance phase | each scan: Setup→StockUp at `stock_up_ts` (`season_set`), PoweredOn→OnAir at `on_air_ts`, OnAir→BuysClosed at `end_ts` | `advance_phase` (a no-op if early) |
| **Close-vault pass** | every `closeVaultPassSeconds` (≤ 1 h), and once on the transition to Done | `getProgramAccounts` on MintLedger (`dataSize 80`, discriminator, `accounted` memcmp @72 = eight zero bytes); skip mints held by any bucket with `class ≠ 0`; skip if the vault ATA is absent; send `close_vault` with `payer = ledger.payer`. A payer that cannot be written (program or reserved key) is recorded `skipped` and alerted once; nothing else changes |
| Team withdraw | every `teamWithdrawSeconds` when `team_sol > 0` | `team_withdraw` |

Settle latency (reveal slot time → settle confirmation) feeds `onepct_settle_latency_seconds`; the target is p95 ≤ `SERVICES.keeper.settleP95TargetSeconds`. Two replicas (`keeper-a`, `keeper-b`) with the leader lock (§11.1). The creator-fee chain and Final Pull pushes are M4.2.

### 11.7 VRF monitoring

- **Occupancy reader** (`packages/sdk/src/vrf`, S4): `decodeVrfQueue(data)` → `{capacityBytes, usedBytes, items, oldestItemTs}` per the MagicBlock queue layout of `ephemeral-vrf-sdk` 0.17.3's source, checked against a recorded fixture of `Cuj97…` (mainnet) and the devnet test queue. `occupancyBps = usedBytes × 10_000 / capacityBytes`. If the layout cannot be verified on the fixture, stop and report.
- **API:** `/api/machine.vrf` = `{queue, occupancyBps, oldestItemAgeSeconds, busy}` for the active queue, at most `machineMaxAgeMs` old. `busy = occupancyBps > VRF.busyOccupancyBps ∨ oldestItemAgeSeconds > VRF.busyOldestItemSeconds`. If the queue cannot be read, the fields are `null` and `busy` is `false` (the program fails cleanly anyway; SDK copy `busy`), and an alert fires.
- **Metrics from the indexer:** `onepct_vrf_latency_seconds` (PullOpened block time → PullRevealed block time), `onepct_vrf_expiries_total` (PullRefunded), expiries per 1,000 Rips, per-wallet expiries over 24 h.
- **Alerts:** occupancy > `MONITOR.vrfQueueOccupancyAlertBps`; expiries > `MONITOR.vrfExpiriesPerThousandRipsAlert` per 1,000 Rips; ≥ `SERVICES.monitor.vrfExpiryClusterPerWallet24h` expiries for one buyer in 24 h. The guardian decides about pausing RIP. **Nothing pauses automatically.**

### 11.8 `api` public v1 (S4, `ROLE=public`, no key)

All schemas live in `packages/sdk/src/api/` (`@onepercent/sdk/api`), shared by the web (M3), the bot (M5) and the tests. Wire rules: u64 as `U64String` (`/^\d{1,20}$/` → `bigint`), pubkeys base58-validated, every response carries `asOfSlot`. CORS: `WEB_ORIGIN`, `GET`/`POST`.

| Route | Response (zod name: main fields) | Source |
|---|---|---|
| `GET /health` | `{ok, version, commit}` | — |
| `GET /api/config` | `ConfigResponse`: `cluster`, `programId`, `flags` (master §11.5), `paramsHash`, `phase`, `roles {keeper, executor, intakeSigner, quoteSigner, teamWallet, teamWallets}`, `vrf {queues, activeIndex}`, `season {snapshotSlot, snapshotTs, stockUpTs, powerOnTs, onAirTs, endTs, finalTs}`, `paused` bits | Config, Machine (chain) |
| `GET /api/machine` | `MachineResponse`: `phase`, `stock {stockSol, book, target, belowTarget, buckets[{index, mint, class, enabled, amount, cost, reserved, free, cap}]}`, `coverage {maxQty per edition}` (SDK `maxQty`), `deck {len, reservedDust, free}`, `jackpot {tokens, cost, sol}`, `onePct[{state, amount}]`, `sellBack {budget, paidHour, floor}` (after `rotateHour`), `pendingPulls`, `vrf` (§11.7). At most `machineMaxAgeMs` old | chain at `confirmed`, Redis-cached |
| `GET /api/me/:wallet` | `MeResponse`: `binder` (null or header + `cards[{index, mint, amount, value, kind, edition, seqLo}]`, `closable`), `deck[{deckIndex, mint, amount, fresh, refed, deposit}]` (mirror, with `asOfSlot`), `pulls {pending[], settleable[{seq, pull, packs[]}]}` (as buyer or depositor, for the client-prepended settle), `vaultDeposits[{mint, payerIsWallet, accounted, vaultExists, state}]`, `royalties {count24h, lamports24h, total}`. Cached `meCacheMs` | Binder from chain; the rest from the indexer |
| `GET /api/verify/:seq` | `VerifyResponse`: Pull header fields, `randomness`, `revealedSlot`, `revealOrder`, `liveFlags`, `holder`, `packs[{pack, t, widths[6], tier, hitBucket, hitMint, hitAmount, hitValue, houseMask, dust[DustPick]}]`, `check` = `verifyPull(...)` | indexer, chain if open |
| `GET /api/stream` | SSE. `event:` ∈ `feed`, `takeBack`, `pullOpened`, `reveal`, `settle`, `refund`, `sellBack`, `stock`, `phase`, `ping` (every `ssePingSeconds`); `id` = `slot-txIndex-eventIndex`; `Last-Event-ID` replays from the Redis Stream | indexer |
| `POST /api/feed/attest` | §11.4 | intake signer |
| `POST /api/sellback/quote` | §11.5 | quote signer |
| `GET /api/value?mint=&amount=` | `ValueResponse`: `{status: "ok", lamports, capped, label: "if_sold_now"}` or `{status: "unavailable", reason}` (X2 `valueNow`); `valuePerMinutePerIp` | X2 |
| `POST /api/rpc` | JSON-RPC pass-through. Allow-list: `getAccountInfo` (a `dataSlice` ≤ `rpcMaxDataSliceBytes` is required for the Deck), `getMultipleAccounts` (≤ 100), `getLatestBlockhash`, `getBalance`, `getTokenAccountsByOwner`, `getTokenAccountBalance`, `getSignatureStatuses`, `simulateTransaction`, `getMinimumBalanceForRentExemption`, `getSlot`, `getBlockTime`, `getFeeForMessage`, `getRecentPrioritizationFees`, and, for M3's Verify and expiry checks (D11), `getSignaturesForAddress` (`limit` ≤ 10, commitment `confirmed`), `getTransaction` (commitment `confirmed`, `maxSupportedTransactionVersion: 0`) and `getBlockHeight`. Everything else → 403. `rpcPerMinutePerIp` | Helius (the API's own key) |
| `GET /api/status` | `StatusResponse`: indexer lag, keeper leader and last settle age, signer readiness, VRF block. The degraded-modes matrix is M6.1 | Redis, DB |
| `POST /api/hold/attest` | 404 until M4.2 | — |

The API refuses to boot with any key (§11.1). No route hides an exit; rate limits never apply to anything a client needs to build an exit (master §9.2 S3).

### 11.9 Verify library (S4, `@onepercent/sdk/verify`)

`verifyPull({pull, packs, programId})` recomputes, for every pack, with M1's math mirrors: `t` from `(randomness, seq, pack)`; the widths from `(edition, liveFlags, holder)`; the tier from `t` and the widths; each dust index from `(randomness, seq, pack, k, deck_len_before)`. It returns per-pack booleans and the recomputed values. The bucket pick depends on every bucket's free capacity at that moment, which no event records: Verify shows the recorded `hit_bucket` and says so. Golden tests: 100 recorded pulls from the validator e2e match.

### 11.10 `packages/cli` v1 (S3): `onepct-ops`

`init <params.json>`, `set-season --slot --ts --stock-up-ts`, `role set <role> <pubkey>`, `guardian <action>` (signed with a guardian keypair file the guardian supplies), `lut create|extend|freeze`. `--cluster devnet` signs with `--keypair <path>` and sends. `--cluster mainnet` never signs: it builds a Squads v4 vault transaction and proposal (`@sqds/multisig`), prints the proposal and its simulation, and exits. CI never holds a mainnet key (master §6).

### 11.11 Observability

- **Logs:** one JSON line per decision: `{msg, sig?, seq?, wallet?, mint?, job?, reason?, durationMs}`. Never a key, a request body of a signer (only `message_sha256`), an API key or a full RPC URL.
- **Metrics** (prom-client names): `onepct_indexer_lag_slots`, `onepct_indexer_txs_total`, `onepct_indexer_deck_drift`, `onepct_keeper_is_leader`, `onepct_keeper_jobs_total{kind,status}`, `onepct_settle_latency_seconds`, `onepct_vrf_latency_seconds`, `onepct_vrf_expiries_total`, `onepct_vrf_queue_occupancy_bps`, `onepct_vrf_queue_oldest_item_seconds`, `onepct_signer_requests_total{role,result}`, `onepct_signer_refusals_total{role,reason}`, `onepct_rate_limited_total{route}`, `onepct_stock_trades_total{kind,class,result}`, `onepct_stock_slippage_bps{kind}` (K1), `onepct_stock_hourly_usage_bps{side}` (K1).
- **Alerts** (§11.1 `alert`): indexer lag > `lagAlertSeconds`; Deck drift twice; no keeper leader > `leaderFailoverSeconds`; oldest unsettled revealed Pull > `settleBacklogAlertSeconds`; role mismatch or disabled; `intake_log_missing`; any `VaultShortfall` event; `fork_rollback`; the VRF alerts of §11.7; K1's stock alerts (§12.5).

---

## 12. Stock keeper (M2.3, K1; `services/worker/src/keeper/stock/`)

### 12.1 Hit list (`onepct-ops hitlist`)

- `check <mint> --class major|trending`: X2 evidence and evaluators; writes the report to `hitlist_reports` and to `reports/hitlist/<UTC date>/<mint>.json`.
- `add <mint> --class …`: requires a passing report younger than `SERVICES.stock.hitlistReportMaxAgeSeconds` and the mint not in `HIT_LIST.neverListed`; `cap = report.info.capLamports` (≤ `HIT_LIST.capMaxPriceImpactBps` impact); `oracle` = the Pyth feed id (MAJOR) or the canonical pool (TRENDING); builds `create_idempotent(vault ATA)` + `admin_list_mint` (devnet: signed; mainnet: a Squads proposal, 12 h timelock). TRENDING prints the announcement reminder: ≥ `HIT_LIST.trendingNoticeSeconds` before the first buy.
- **Daily re-check** at `HIT_LIST.dailyRecheckUtc` (12:00 UTC), run by the keeper leader for every listed bucket. A failure sets `buckets.failing = true` (the keeper stops buying it at once and starts selling it down within the caps), alerts, and attaches a ready `guardian DisableBucket` command. Only a guardian disables on-chain. Existing cards keep Redeem and Sell at market.
- TRENDING buys start only `trendingNoticeSeconds` after the listing slot's block time (from the `ConfigChanged` ListMint event).

### 12.2 Policy (pure: `planStock(state, quotes, now) → Trade[]`)

Inputs: the rotated Machine, Config, buckets with `failing` and listing time, recent indexer stats (hit value carved per hour, Sell back payouts over the last `KEEPER_POLICY.solReserveExtraMinutes` and `inventoryTargetMinutes`, last reveal time), X2 quotes and ladders, flags, `chainNow()`. Let `need(E) = COVERAGE_BPS × price(E) / 10_000`.

| Rule | Plan |
|---|---|
| Anchor | `E*` = the largest edition with `need(E*) ≤ stock_sol + Σ_MAJOR free(b)`. Target: the largest-free MAJOR bucket holds `free ≥ KEEPER_POLICY.anchorMultipleOfTopBlack × need(E*)` (30 SOL once After Hours can open). Buy into that bucket first |
| Inventory | Beyond the anchor, hold ≈ `KEEPER_POLICY.inventoryTargetMinutes` of net hit need: `hit_out_last_hour × inventoryTargetMinutes / 60` minus the Sell back inflow over the same number of minutes, spread equally across enabled, non-failing MAJOR buckets; TRENDING buckets past their notice get at most `TREND_SHARE` of book in total |
| SOL reserve | Keep `stock_sol ≥ SB_FLOOR + (Sell back payouts of the last solReserveExtraMinutes)`; below it, plan a StockSell of free book (MAJOR first, never below `reserved`) |
| Failing or disabled | Sell down within the caps, `free(b) ≥ 0` |
| Last Call (`now ≥ end_ts − SEASON.lastCallSeconds`) | Buy only for the anchor and inventory; sell the surplus within the hourly cap |
| BuysClosed | Sell every bucket to SOL: MAJOR at `SPACING` without the gross cap, TRENDING within its caps. Stop at FinalPull |
| Sizing | Each buy `L ≤ min(tranche, target gap, stock_sol − SOL reserve, remaining caps)`, cut to the largest X2 ladder rung with quoted impact ≤ `KEEPER_POLICY.maxQuotedImpactBps` (0.5%) |
| Timing | Cycle every U(`cycleSecondsMin`, `cycleSecondsMax`) s; no buy before U(`revealDelaySecondsMin`, `revealDelaySecondsMax`) s after the last reveal; trades in a cycle sent one at a time, ≥ `SPACING` apart, re-planned after each landing |

Every planned trade must pass `checkExecBegin` (P1's mirror) against the current state; a trade that would fail is dropped and logged, never sent.

### 12.3 Trade construction and landing

- Jupiter `/build` (X2 `build`, B11): buys `{inputMint: wSOL, outputMint: mint, amount: L, taker: keeper, slippageBps: MAJOR_SLIP | TREND_SLIP, wrapAndUnwrapSol: false, destinationTokenAccount: vault, maxAccounts: MARKET.jupiter.buildMaxAccounts}`; sells `{inputMint: mint, outputMint: wSOL, amount: a, taker: keeper, …, destinationTokenAccount: sol_dest}`. Skip the trade if Jupiter's `minOut` is below the on-chain `min_out` the SDK computes.
- Composition with `composeExecTransaction` (§10), the frozen protocol LUT plus Jupiter's tables, ≤ 1,232 B; CU limit = simulated CU × `(10_000 + SERVICES.landing.cuMarginBps) / 10_000`.
- **Pyth (S4 decides):** if the sponsored `PriceUpdateV2` accounts of all five majors and SOL/USD are Full-verified and normally fresher than `SERVICES.stock.pythSkipAgeSeconds`, pass them and skip a MAJOR trade when older. If S4 requires keeper-posted updates: stop and report (`@pythnetwork/pyth-solana-receiver` needs the architect's written exception, §3).
- **Landing:** Helius Sender with a Jito tip of `SERVICES.landing.tipLamports` (K1 measures Sender's minimum and writes it) and a read-only `jitodontfront…` account key; confirm through `TxSender`. Fallback: plain RPC send of the same transaction with smaller tranches. A failed trade backs off and re-plans; it never retries the same blockhash.
- Records: `stock_plans` (every plan, live or dry) and `stock_trades` (signature, `min_out`, Jupiter `outAmount`, measured `delta` from `ExecEnded`, slippage bps vs the quote).

### 12.4 `KEEPER_STOCK_LIVE`

Off (`FLAG_KEEPER_STOCK_LIVE=off`, the default until Power-On): plan, build, `simulateTransaction`, record `stock_plans.live = false`, send nothing. On: send. `pnpm --filter worker stock:dry-run --cluster mainnet` runs one read-only planning cycle against live quotes (founder-provided keys from the env; no transaction is sent) and prints the plan; its output goes in the PR.

### 12.5 Stock alerts

`onepct_stock_hourly_usage_bps` above `SERVICES.monitor.stockCapUsageAlertBps` of a cap; a landed trade with slippage vs quote above `MAJOR_SLIP` (MAJOR) or `TREND_SLIP` (TRENDING); a bucket failing its daily re-check; `stock_sol` below the SOL reserve, or the anchor below target while an edition is closed for coverage, for longer than `SERVICES.monitor.stockConditionAlertSeconds`.

---

## 13. Tests

### 13.1 Program named tests (LiteSVM harness, M1 §16.1; mainnet feature set where noted)

The swap slot in tests is a **stub swap**: top-level transfers signed by a test "market" wallet (wSOL out of `src`, tokens into the vault or wSOL into `sol_dest`) delivering a chosen Δ. Adversarial calls go through the mock VRF's `cpi_passthrough` (0xF3). Pyth accounts are injected under `PROGRAM_IDS_PYTH_RECEIVER` from S4 fixtures with edited fields; pools and curves from `fixtures/mainnet` with edited reserves.

**t12_exec.rs**

| ID | Name | Then |
|---|---|---|
| T12.01 | `stockbuy_major_happy` | Δ ≥ `min_out` lands: `A += Δ`, `C += L`, `accounted += Δ`, `stock_sol −= L`, counters, `exec` zero, `ExecBegun`/`ExecEnded` |
| T12.02 | `stockbuy_trending_pool` | §6.4 pool vectors, including negative virtual reserves; non-canonical pool, wrong base or quote mint, Mayhem flag, vault mismatch, `quote_eff ≤ 0` → `OracleInvalid` |
| T12.03 | `stocksell_major_and_trending` | `book` exact (and `== C` when selling all of A); `free(b)` kept; `received` measured on `sol_dest`; `sol_dest` closed; signer net +rent only; `stock_sol += received` |
| T12.04 | `burn_and_jackpot_dbc_and_damm` | injected `$1PCT` ledger and vault: Burn burns Δ (supply drops), `burned_total += Δ`; JackpotBuy `jackpot_tokens += Δ`, `jackpot_cost += L`; canonical DBC before migration, canonical DAMM v2 after migration; a DAMM pool passed while DBC is not migrated → `AccountMismatch` |
| T12.05 | `pairing_rejections` | no `exec_end`; two `exec_end`; `exec_end` of another kind; `ping`, `settle` or `redeem` anywhere in the transaction; two `exec_begin` → `ExecPairing`; `exec_end` alone → `ExecPairing` |
| T12.06 | `not_top_level_and_double_credit` | `exec_begin`/`exec_end` through `cpi_passthrough` → `NotTopLevel`. The double-credit transaction (top-level transfer to the vault, then a CPI `feed` from the swap slot, inside a StockBuy pair) fails; nothing credited |
| T12.07 | `slack_rule` | a pre-existing donation is never credited (only Δ); injected `accounted > vault.amount` → `SlackShort` for StockBuy, JackpotBuy and Burn |
| T12.08 | `min_out_boundary` | Δ = `min_out` ok; `min_out − 1` → `SlippageExceeded` |
| T12.09 | `pyth_rejections` | 61 s old → `OracleStale`; conf 101 bps → `OracleWide`; wrong owner, discriminator, feed id, Partial verification, price ≤ 0, exponent −19 → `OracleInvalid` |
| T12.10 | `spacing_tranche_caps` | 19 s after the last trade → `TooSoon`; tranche + 1 → `TrancheTooLarge`; gross cap at the floor and at `2 × h_out` (both hours); reset next hour; `TREND_HOURLY` for buys and sells separately; TRENDING share boundary; bucket cap boundary; MAJOR sells in BuysClosed skip the gross cap and keep spacing; TRENDING sells keep every cap |
| T12.11 | `never_sells_reserved` | `C − book == reserved` ok; one lamport less → `ReservedCapacity` |
| T12.12 | `roles_pauses_phases` | wrong signer → `Unauthorized`; disabled keeper/executor → `RoleDisabled`; STOCKBUY pauses buys and sells, BURN pauses Burn and JackpotBuy; each phase row of §6.3; StockBuy and JackpotBuy at `now ≥ end_ts` → `SeasonOver` |
| T12.13 | `bucket_states` | disabled bucket: StockBuy → `BucketDisabled`, StockSell works |
| T12.14 | `src_and_sol_dest_checks` | wrong ATA, non-native `src`, foreign owner → `AccountMismatch`; `sol_dest` pre-created by a third party with donated wSOL: `received` excludes it |
| T12.15 | `machine_donation_not_stock` [DG-8] | lamports donated to the Machine never become `stock_sol` through any exec kind |
| T12.16 | `exec_report` | CU of each kind with its oracle accounts; size of the exec transaction without the swap (protocol LUT included) and the bytes left for Jupiter |

**t13_sell_back.rs:** T13.01 `payout_exact` (≥ 12 vectors including §7.1's; `A`, `C`, cards, slot refund, `sb_nonce`, owner paid); T13.02 `quote_vs_value` (quote below and above the stocked value); T13.03 `eight_descending` (ok; any other order or 9 cards → `InvalidArgument`); T13.04 `kinds_and_mints` (kinds 0, 5–8 → `NotSellBackable`; another mint → `CardMoved`); T13.05 `attestation` (wrong key, each message field altered, `AttestationExpired` at `now + 61` MAJOR and `now + 21` TRENDING, boundary `+60`/`+20` ok, replay and future nonce → `AttestationReplay`); T13.06 `limits_boundaries` (floor equal ok, +1 lamport → `SellBackFloor`; both budget branches and the hour rollover → `SellBackBudget`; cap → `BucketCapExceeded`); T13.07 `fill_first` (below target: `to_team = 0`; at target: margin to `team_sol`; boundary at `book == target`); T13.08 `gates` (not OnAir, `now ≥ end_ts`, SELLBACK paused, quote role disabled, bucket disabled, `ExecInFlight` via a CPI from a swap slot); T13.09 `i1_check` (`VaultInvariant`); T13.10 `i12` (payout ≤ 0.87 S, budget, floor hold after every success).

**t14_feed_back.rs:** T14.01 dust and each foil tier → REFED entry, slot refund, entry deposit charged, ledger/vault/`fresh_in_deck` unchanged; T14.02 kinds 5–8 → `NotFeedable`; T14.03 owner at 25 fresh cards still feeds back; T14.04 8 descending ok, other orders rejected; T14.05 FEED paused, BuysClosed, `now ≥ end_ts`; T14.06 the REFED entry taken back after `close_binder` (Binder absent); T14.07 the REFED entry pulled: royalty to the owner, not counted in `fresh_in_deck`; T14.08 `DeckFull` and `DeckUnderfunded` after a rent rise.

**t15_binder.rs:** T15.01 `close_happy` (all lamports, donations included, to the owner); T15.02 `pending_pull` (`[buy_packs AH ×5][close_binder]` → `PullPending`, atomically); T15.03 each refusal (`BinderNotEmpty` ×3, `FinalNotClaimed`; both flag bits injected → ok); T15.04 `recreate_and_replay` (re-created by a Feed; an earlier FEED attestation inside its TTL re-feeds only its own bags); T15.05 `withdraw_owed` (injected owed paid; 0 → no-op; partial under a rent rise); T15.06 both exits in every phase with all five bits set.

**t16_hygiene_m2.rs:** T16.01 pause-bit grep (§2 rule 4) and exit structure (no Config, no remaining accounts); T16.02 `exec_begin`, `exec_end`, `feed` call the top-level check; T16.03 M1 error codes unchanged (golden); T16.04 [DG-1] donations to `sol_dest`, signer ATAs, Binder, Deck before every M2 instruction. T11.01 and T11.02 (M1) are extended to the M2 instructions.

### 13.2 Property suites (1,000 cases × 200 steps in CI; 10,000 at G2.1 and nightly)

| Suite | Content |
|---|---|
| **P1** (extended) | new operation: "a CPI `feed` inside an exec pair" — always `NotTopLevel`, state unchanged |
| **P2** (extended) | operations `sell_back` (random quotes and card sets), `feed_back`, exec pairs of all four kinds (stub swaps delivering random Δ around `min_out`, random donations), `withdraw_owed` (injected owed), `close_binder`. After every step: M1 §14 plus I8 per op, I12, I13. Final drain adds: inject BuysClosed, StockSell every bucket, `exec` zero |
| **EX-1** `prop_ex1_exec.rs` | random exec transactions whose swap slot does any of: deliver Δ, donate, CPI `feed`/`redeem`/`take_back`/`sell_back`/`feed_back`/`buy_packs`/`exec_*`, add a second `onepercent` instruction, drop or duplicate `exec_end`. Accepted transactions only if Δ ≥ `min_out` and Δ ≤ slack; I1, I2, I3, I8, I13; gross and per-mint hourly usage ≤ caps; stock trades ≥ 20 s apart; for MAJOR, machine value given up per accepted trade ≤ `L − min_out` at the oracle price |
| **SB-1** `prop_sb1_sellback.rs` | random states and quotes: payout formula exact, payout ≤ 0.87 S, floor, budget, cap, nonce strictly increasing, any refusal leaves state untouched |
| **M-REF** | `reference.rs` gains independent `min_out`, `book`, caps and payout implementations, compared on random inputs including u64 and i128 extremes |

### 13.3 Donation griefing for M2

DG-1 (T16.04, P2); DG-3: pre-existing vault slack never credited by `exec_end` (T12.07); DG-5: a donation to a Binder goes to the owner at `close_binder` (T15.01) and never raises `withdraw_owed`'s payout above `sol_owed`; DG-7: `sol_dest` pre-created (T12.14); DG-8 (T12.15).

### 13.4 Golden vectors (`app/fixtures/vectors/`)

`layouts.json` (new offsets), `ix.json` (six instructions), `attest.json` (+ ≥ 20 SB messages, the two §7.1 check values), `sellback.json` (payouts and refusals), `exec.json` (§6.4 vectors, ≥ 50 random cases per formula, caps), `idl_constants.json`. The SDK passes them byte for byte.

### 13.5 Services tests (Vitest; recorded fixtures; Postgres and Redis containers)

| Area | Tests |
|---|---|
| service-kit | foreign `*_KEYPAIR` (and each pattern of §11.1) → exit 1 naming only the variable; own key ≠ Config role → 503 and no signing; role disabled → 503; logs never contain a key, `api-key=` or a full RPC URL (captured logger) |
| db | migrations apply on an empty database; `drizzle-kit generate` yields no diff |
| indexer | parser: our events only inside our frames (a forged `Program data:` from another program is ignored); truncated logs trigger a reconcile; ordering within a slot; **replay twice → identical rows** (hash of every mirror table); Deck mirror equals the chain after 1,000 random feeds, take-backs and picks on the validator; fork rollback; consumption join, and the fallback when the log row is missing |
| intake | S6's 20 wallets reproduce their verdicts, reasons and dates; a partial `amount` → `not_whole_bag`; split accounts → total plus `mergeFrom`; **repeated requests for a wallet that never feeds change nothing** (consumption, mirror, a later verdict); hop rules (used by another wallet, re-feed by the same wallet, sender itself a hop); rate limits per wallet and per IP (the 31st and 61st); `indexer_lag` 503; expiry with the local clock 30 s ahead |
| quote | one `/order` call for the batch total; message bytes equal the Rust golden vector; expiry from block time; every X2 refusal passes through; never signs on refusal |
| keeper v1 | settle, refund, advance, close-vault pass and team withdraw each idempotent (run twice, one transaction); the leader lock hands over within `leaderFailoverSeconds`; a non-writable `ledger.payer` is skipped and alerted once |
| api | every route's response parses with its `@onepercent/sdk/api` schema; RPC allow-list (a Deck read without `dataSlice` → 403); `/api/machine` age ≤ 2 s; SSE resume with `Last-Event-ID`; no route returns an outcome the indexer has not confirmed |
| verify | 100 recorded pulls verify; a flipped byte of randomness fails |
| stock (K1) | table-driven plans (cold start, launch hour, steady state, Sell back drain, failing bucket, Last Call, BuysClosed, hour boundary, TRENDING notice); fast-check: every planned trade passes `checkExecBegin`; the built transaction ≤ 1,232 B with `wrapAndUnwrapSol=false` and the right destination; nothing sent with `KEEPER_STOCK_LIVE` off |

### 13.6 End to end

| Run | What | Gate |
|---|---|---|
| `pnpm test:e2e` (npm litesvm) | adds: Sell back with a local test quote key; Feed back; `close_binder` | every program PR |
| `pnpm e2e:validator sellback` | master E3: OnAir state exported by the harness; Redeem every kind; Sell back; Feed back. P2 signs quotes with a local test key set as `quote_signer` (G2.1); S2 re-runs it through the **real quote signer**, X2 on recorded fixtures (G2.2) | G2.1, G2.2 |
| `pnpm e2e:validator exec` | StockBuy and StockSell with the stub swap in place of Jupiter (master §5.1): P1 builds with `composeExecTransaction` (G2.1); K1 re-runs it through its own planner and builder (G2.3) | G2.1, G2.3 |
| `pnpm e2e:validator keeper` | master E2 with keeper v1 on: 100 reveals, settle p95 ≤ 5 s; then keeper stopped: the client-prepended settle lands every royalty; guardian `DisableBucket` end to end (keeper stops buying and sells down, `sell_back` → `BucketDisabled` → Sell at market, Redeem works) | G2.2 |
| `pnpm e2e:devnet feed` | master E1: Feed 16 bags through the real intake signer and indexer, take back 3; on the validator with cloned pump.fun accounts if S1 found none on devnet | G2.2, with the founder's go |
| Close-vault drill | devnet: every vault with `accounted == 0` and no listed bucket closed within the hour, rent at `ledger.payer` | G2.2 |

### 13.7 Reports (in each program PR)

CU and size tables (§13.1 T12.16, `sell_back` ×1/×8 with Ed25519, `feed_back` ×1/×8, `close_binder`, `withdraw_owed`), the new `CU_LIMITS`, `.so` size and flags.

---

## 14. Commands and CI

New scripts: `pnpm --filter @onepercent/db {migrate, generate}`, `pnpm --filter worker {indexer:replay, stock:dry-run}`, `pnpm e2e:validator {sellback, exec, keeper}`. CI: job `program` adds the new e2e flows; new job **`services`** with `postgres:17` and `redis:7` service containers runs `pnpm --filter @onepercent/db migrate`, the `drizzle-kit generate` diff check, and the services tests.

**The architect will run, from `app/`:**

```
pnpm install --frozen-lockfile && pnpm params:rs --check && pnpm lint:words
pnpm program:build && pnpm program:clippy && pnpm program:test && pnpm test:e2e
pnpm e2e:validator rip && pnpm e2e:validator feed && pnpm e2e:validator sellback && pnpm e2e:validator exec && pnpm e2e:validator keeper
PROPTEST_CASES=10000 pnpm program:test
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
docker compose up -d && pnpm --filter @onepercent/db migrate && pnpm --filter "./services/*" test
pnpm program:report && git diff --exit-code packages/sdk/src/idl fixtures/vectors packages/db/drizzle
```

---

## 15. Acceptance criteria (master §11.4 M2, numbered as there)

1. **Executor:** T12.01–T12.15 pass; EX-1 passes at 10,000 cases; the double-credit transaction fails (T12.06); `exec_end` rejects Δ above slack for StockBuy, JackpotBuy and Burn (T12.07); no reserved capacity is ever sold (T12.11); PumpSwap `min_out` matches the vectors with negative virtual reserves (T12.02).
2. **`sell_back`:** exactly `floor(min(S, quote) × 8,700 / 10,000)`; Silver to Black of one mint; single-use quotes with 60 s / 20 s TTLs; hourly budget, 1 SOL floor and cap; margin to the team only at or above target (T13, SB-1).
3. **`feed_back`:** Dust and Silver to Black; slot deposit refunded, entry deposit charged; no attestation; Jackpot, The 1%, Spotlight and Final refused (T14).
4. **Properties:** P1, P2, EX-1, SB-1, CR-1, M-REF at 1,000 cases in CI and 10,000 at G2.1; I8, I12, I13 hold.
5. **Exits:** every exit, `withdraw_owed` and `close_binder` included, passes with all five pause bits set, in every phase.
6. **Intake signer:** S6's 20 wallets reproduced; whole balance only, partial refused; signing records nothing (test); refuses to boot with a foreign key.
7. **Quote signer:** its own `/order` for the batch total; SB bytes equal the Rust golden vectors.
8. **Value function:** X2's acceptance stands; `/api/value` labels only executable quotes `if_sold_now`; a static test proves no services or API path computes price × amount.
9. **E2E:** E1 on devnet (or the validator per S1); E2 and E3 on the validator (§13.6).
10. **Keeper v1:** settle p95 ≤ 5 s on the validator run; with the keeper stopped, the client-prepended settle lands royalties.
11. **Indexer:** replaying twice yields identical rows.
12. **Stock policy:** the mainnet dry run produces a plan in which every trade passes `checkExecBegin`, the anchor bucket is served first and TRENDING stays ≤ 15%.
13. **Guardian:** the bucket-disable path end to end (§13.6 `keeper`).
14. **`close_binder`:** rejected with a Pending Pull, with cards, with `fresh_in_deck > 0` or `sol_owed > 0`; closes an empty Binder and refunds the owner.
15. **Close-vault pass:** the devnet drill closes every eligible vault within the hour, rent to `ledger.payer`.
16. **API contract:** every route of §11.8 validates against `@onepercent/sdk/api`; `/api/machine` is ≤ 2 s old and carries VRF occupancy.
17. **Key isolation:** each service boots only with its own key; `api(public)` and `indexer` boot with none (§13.5).

**Definition of done** (every PR): master §12; CI green; IDL, SDK, golden vectors and `drizzle/` regenerated and committed; `VERSIONS.md`, `README.md` and `.env.example` updated; no `TODO` without a milestone tag; `pnpm lint:words` clean.

---

## 16. Audit-gate checklist (the architect)

**G2.1 (P0, P1, P2):**
- [ ] M1 layouts, sizes, seeds, error order and event fields unchanged; the carve of §5 exactly as specified; size asserts and offset tests.
- [ ] `exec_begin` and `exec_end` top-level; the two-instruction pairing rule; `ExecInFlight` in `sell_back` and `feed_back`.
- [ ] Every credit or burn of a measured Δ passes the slack check first; StockSell lowers `accounted` by exactly the tokens moved.
- [ ] `min_out` formulas, rounding toward the machine, oracle owner, discriminator, feed id, Full verification, staleness and confidence; canonical pool derivation; negative virtual reserves.
- [ ] Spacing, tranches, gross and per-mint hourly caps, TRENDING share, bucket cap, reserved capacity, the BuysClosed exception.
- [ ] Pause bits only where §2 rule 4 says; `withdraw_owed`, `close_binder` are exits by structure.
- [ ] `sell_back` message bytes, TTL per class, nonce, floor, budget, cap, fill-first, I12; `close_binder`'s `reserved == 0`.
- [ ] Reports, `CU_LIMITS`, properties at 10,000 cases, the v3 artifact.

**G2.2 (S0–S4):**
- [ ] One key per service; refusal on foreign keys; signers check their on-chain role; no key in logs, URLs, the bundle or another service.
- [ ] Signers compute everything they sign; no client number signed; whole bags only; nonces and expiries from chain.
- [ ] Attestations side-effect-free: the only signer writes are the insert-only logs; consumption from landed `BagFed` only.
- [ ] Rate limits per wallet and per IP on both signers; none on exit building.
- [ ] Indexer: our-frame-only parsing, ordering, finality handling, Deck reconcile, replay determinism, no outcome before confirmation.
- [ ] Keeper cranks idempotent, keyed, chain-clocked; leader lock; close-vault pass.
- [ ] API schemas, RPC allow-list, VRF occupancy, no exit behind a flag or a limit.
- [ ] Migrations forward-only and generated.

**G2.3 (K1):**
- [ ] Plans never exceed on-chain bounds (`checkExecBegin` gate); `wrapAndUnwrapSol=false`; destinations are program accounts; Jupiter `minOut` ≥ on-chain `min_out`.
- [ ] MEV rules: random delays, ≤ 0.5% quoted impact, private landing; dry run with the flag off sends nothing.
- [ ] Hit-list reports, the daily re-check, the TRENDING notice, the guardian path.

---

## 17. Do NOT

**Scope and process**
- Implement anything for Spotlight (D1): no `spotlight_deposit`, `spotlight_take_back`, admin slot, callback segment, service code or API field. Its odds segment stays absent.
- Implement `power_on`, The 1%, the Jackpot win, creator fees, the Final Pull, permissionless Burn after Done, the `executor` service or the HOLD signer (M4).
- Push to `main`; edit `docs/codex/*`, `AGENTS.md`, `apps/web/src/experience/`, the landing, or a path another PR owns (§1.2).
- Send a mainnet transaction from Codex's environment, or let CI touch the network or hold a mainnet key.

**Money and keys**
- Put an economic literal anywhere but `packages/config` and the generated `params.rs`; invent a number (stop and ask).
- Custody user funds outside the program's vaults: no service holds, routes or swaps a user's tokens or SOL; Sell at market is the user's own signed swap; the keeper and the executor touch machine funds only inside an exec pair.
- Let a signer sign a client-supplied number, attest anything but the whole balance, or record eligibility when it signs.
- Ask for, accept, store, derive or log a private key or a seed phrase; put a key in another role's environment.
- Add `@coral-xyz/anchor`, a second `@solana/web3.js`, a Jupiter or Pyth SDK, or `@solana/kit`, except the Pyth receiver exception the architect approves in writing (§3).

**On-chain**
- Change an M1 layout, size, seed, discriminator, error code or event field; renumber anything.
- Run `exec_begin`, `exec_end` or `feed` under CPI; put any other `onepercent` instruction in an exec transaction; credit or burn beyond the unclaimed slack.
- CPI into a DEX or swap vault tokens along a route a user supplies; mark anything to market on-chain.
- Read a pause bit, a role, an attestation or `end_ts` in `withdraw_owed` or `close_binder`; give them Config or remaining accounts.
- Assert exact balances, pay out `lamports − rent`, or hard-code rent.

**Off-chain**
- Value a token as price × amount or with Jupiter's "liquidity"; label anything but an executable quote "if sold now".
- Publish a reveal before the indexer saw the transaction confirmed; hide or rate-limit an exit.
- Auto-pause anything on VRF expiries.

**Words never shipped** (code, comments, strings, docs and tests under `app/`; `app/packages/config/src/vocabulary.ts` holds the lists): grave, graveyard, tomb, tombstone, bury, burial, cremate, cremation, coffin, casket, skull, skeleton, bones, ghost, haunt, haunted, ghoul, lich, zombie, undead, soul, souls, reaper, cemetery, funeral, mourn, mourner, undertaker, wake, epitaph, obituary, revival, resurrection, afterlife, "dead bags"; sweep, sweeper, casino, gamble, bet. In user-facing copy: guaranteed, risk-free, free money, profit, yield, APY, passive income, earn, "verify your wallet". No "ZK" anywhere.

---

## 18. Report back (in each PR)

1. Commands and results (§14), the base commit, new `VERSIONS.md` rows.
2. Program PRs: reports (§13.7), the measured `CU_LIMITS`, the 10,000-case run, and whether the S4 Pyth layout matched §6.4.
3. Services PRs: the table hashes of the replay test, the settle p95, the intake results on S6's wallets, the measured `maxComputeUnitPriceMicroLamports`.
4. K1: the mainnet dry-run plan, the measured Sender tip, and the S4 Pyth path used.
5. Deviations, and every place you stopped to decide.

---

## Appendix. Open questions for the founder and the architect

1. **Pyth receiver and posting (S4).** `PROGRAM_IDS.pythReceiver` must be in PARAMS issue 3 before P1. If sponsored feeds are too stale for the 60 s bound, K1 needs keeper-posted updates, which means either the `@pythnetwork/pyth-solana-receiver` exception (it brings `@coral-xyz/anchor ^0.29` into the worker) or a hand-built poster. The architect decides after S4.
2. **B5, the `$1PCT` fee allowance.** Recorded as [A]; it changes no validated number but closes a gap in PARAMS §10 and §13.1.
3. **PumpSwap base-vault offset @139** and the MagicBlock queue layout are inferred from neighbouring verified fields and the SDK source; S4 and S2 fixtures confirm them.
4. **Helius `getTransactionsForAddress`** must be on the intake signer's plan (S6). Without it the signer refuses with `evidence_unavailable`, and Feed is closed in practice.
5. **B1 and B8** need the master updated when it is next re-issued (quote signer in M2.2; M4's Final Pull claims must set both bits even for a zero share).
