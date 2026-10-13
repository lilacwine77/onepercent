# Codex brief — M4: Power-On, The 1%, the Jackpot win, creator fees, the Final Pull and the season services (The 1% Machine)

Issued 2026-10-16 (D7) by the architect. Written on 2026-10-08, the day the pump.fun, Jito and Helius facts below were checked against mainnet and the providers' own documentation (Appendix A). Two gates: **G4.1** (on-chain, M4.1) and **G4.2** (services and launch tooling, M4.2). M4.1 starts on D8, once G1 has passed and M2's interface PR (P0) has merged. M4.2 starts on D9, against the M4.1 draft IDL.

This brief is self-contained for M4. Everything M4 needs from SPEC, `PARAMS.md`, the master brief, `01-M1-BRIEF.md` and `02-M2-BRIEF.md` is restated here or referenced by section. If anything is ambiguous, contradictory or impossible, **stop and report with options** (AGENTS.md). Do not guess.

**D27–D29 amendment (2026-10-09):** `D29-METEORA-LAUNCH.md` wins over this brief. The launch uses Meteora DBC and SPL Token, the season trading-fee split is 50/50 with no burn, and the launch is one atomic transaction (D28). Pump launch checks, launch transactions and the pump fee chain below are superseded by D29 §2–§4. D18 excludes Final Pull claims and Burn-after-Done from this launch PR.

---

## 0. Read this first

### 0.1 Authority

`DECISIONS.md` > `MODEL.md` > `PARAMS.md` (issue 3, plus the issue-4 keys of §4.3 once published) > `00-MASTER-BRIEF.md` > **this brief** > `00-M0-SCAFFOLD.md` > `AGENTS.md`, then `COPY.md`. `01-M1-BRIEF.md` sets the program conventions and `02-M2-BRIEF.md` extends them. This brief extends both and changes them only through the amendments of §0.3. M1's and M2's layouts, seeds, sizes, error order and event fields are frozen: M4 appends.

"M1 §x" means `01-M1-BRIEF.md` §x, "M2 §x" `02-M2-BRIEF.md` §x, "M3 §x" `03-M3-BRIEF.md` §x, "master §x" `00-MASTER-BRIEF.md` §x. "SPEC §x" marks provenance only. Items marked **(decided, D16)** follow the recommendation of the final section "Open questions for the founder" until the founder answers.

### 0.2 Scope versus the master plan

| Master §11.4 M4 item | Here | Notes |
|---|---|---|
| `power_on` and the FeeIn PDA; `mint_is_safe` on `Config.token_mint` | §6.1 | Top-level only; credits the 40M from unclaimed slack only |
| The 1%: release from timestamps, holder ×1.5, `one_pct` cards | §6.2, §7.1 | |
| Jackpot J-B win path | §6.2, §7.1 | The JackpotBuy tranche itself is M2 (M2 §6) |
| `collect_creator_fees`, the splits and fill-first | §6.3, §7.2 | |
| `start_final_pull`, `claim_final_sol`, `claim_final_tokens`; BuysClosed → FinalPull → Done; the claim bits | §6.4–§6.6, §7.3 | Both claims are callable with a zero share and set their bit (M2 B8) |
| Permissionless Burn after Done | §6.7 | M4's only edit to M2's executor files |
| The `executor` role | §11.1 | |
| The keeper's creator-fee chain and the FeeIn alert | §11.2 | |
| The holder attester (HOLD) | §11.4 | |
| `onepct-ops launch` | §12 | |
| The Final Pull keeper | §11.3 | |
| Block-0 board data | §11.5 | |
| **Not M4** | - | Spotlight (D1: nothing at all). The Final Pull screen and its claim buttons (web lane, due before `end_ts` per master §11.1, D37; M4 ships the SDK builders, §10). The monitor's I14 check and the status matrix (M6.1). Rescue (M6.2). Copy (`COPY.md` issue 2) |

### 0.3 Amendments this brief makes (binding for M4)

| # | Amendment | Amends | Why |
|---|---|---|---|
| M4-A1 | Three Machine fields are carved from `_reserved` at 2,608, after M2 B6's carve: `token_mint`, `final_sol_total`, `final_1pct_total` (§5.1). The size stays 3,808 B | M1 §7.2, M2 §5.1 (bytes unchanged) | The callback has four fixed accounts and cannot read `Config`, so the $1PCT mint must sit in the Machine. The claims need frozen pool totals while the remaining pools shrink |
| M4-A2 | Special-segment liveness is evaluated **per pack**, inside the callback, just before that pack's draw. `PackRevealed.live_flags` is exact per pack; `Pull.live_flags` becomes the OR over the Pull's packs (information only) | M1 §7.5, §9.9; M2 §11.9; M3 §14.1 | A win changes liveness for the next pack of the same Rip: after a Jackpot win `jackpot_cost` is 0 (PARAMS §4.1), and a pulled The 1% card can release the next one. Verify must use each pack's own flags |
| M4-A3 | `collect_creator_fees` also empties FeeIn's canonical wSOL ATA, with M2 B3's pattern: close it to the caller, then the caller transfers exactly the measured wSOL amount to the Machine | PARAMS §13.4 ("unwraps any wSOL") made exact | Anyone can call PumpSwap `collect_coin_creator_fee` for our coin with a FeeIn-owned wSOL account as destination. Only FeeIn's seeds can move that account. The caller gets back only the rent it, or a third party, paid |
| M4-A4 | Creator-fee split rounding (D27): team is floored, stock takes the remainder through `credit_stock`; AFTER_END is 100% team with no `credit_stock` call | PARAMS §13.4 (silent) | Same remainder rule as the pack split (PARAMS §16.4); D27 removes creator-fee burn in every phase |
| M4-A5 | In phase Done, Burn (kind 3) skips the executor-role check, the disabled-role check and the BURN pause bit, in both `exec_begin` and `exec_end`. Every other check stays | M2 §6.2 steps 2–3, §6.6 | Master §11.4 "permissionless Burn after Done"; SPEC §7.4: Burn is pausable only before Done. After Done no key, guardian included, has to survive |
| M4-A6 | `start_final_pull` fails with `ExecInFlight` while `Machine.exec.kind ≠ 0` | M1 §1.3 item 8 | A CPI from a StockSell swap slot would take the snapshot before `exec_end` credits `stock_sol`; that SOL would then sit in `stock_sol`, which has no exit after the snapshot |
| M4-A7 | Final cards are `{kind 8, mint, amount, value 0, edition 255, flags 0, seq_lo 0}`. `255` means "no edition" | M1 §7.4 (Card fields), M3 §6.2 (`CardRow.edition`) | A Final card comes from no pack. The web contract needs `edition: null` for kind `final` (Amendments section) |
| M4-A8 | HOLD reads the history of the wallet's canonical Token-2022 $1PCT account over the last 24 h, from standard RPC, instead of a global table of $1PCT transfers **(decided D16, Q3)** | master §3.4 ("$1PCT transfers" row) | That account has ImmutableOwner, so every balance change shows in a transaction that writes it: the history is complete and checkable. A global transfer table can miss plain `Transfer` instructions, which do not name the mint |
| M4-A9 | The shared Sender/Jito landing helper lives in `packages/service-kit/src/landing.ts`, used by K1, the executor and the launch tool | M2 §12.3 (location only) | One landing path, one tip rule (`SERVICES.landing.*`). If K1 already put it under `keeper/stock/`, M4.2 moves it there unchanged and re-points K1's import (§1.2) |
| M4-A10 | The executor has its own Jupiter API key, from the keeper's Jupiter organisation (one key per service) | master §6 provider row | The executor builds Jupiter `/build` swaps (M2 §6.1); the master's key table names no key for it |
| M4-A11 | The creator-fee regime reads the **phase**, not `end_ts`: `afterEnd` applies from BuysClosed on (which anyone can set from `end_ts`, and the keeper sets at `end_ts`) | PARAMS §13.4 (`afterEnd` = "`now ≥ end_ts`") | Master I10 lists `collect_creator_fees` among the exits and master §10 forbids an exit to read `end_ts`. The difference is the few seconds between `end_ts` and the phase change, during which a collection uses the On Air split; PARAMS §13.4 already accepts that anyone chooses when to collect |

None of these adds or removes a mechanic or changes a validated number.

### 0.4 Founder decisions M4 relies on

- **J-B** (master §0.2, PARAMS §10): the pot is pre-bought in $1PCT; a win delivers the whole of `jackpot_tokens` at once; no order queue, no SOL fallback. Unconverted `jackpot_sol` stays for the next pot.
- **C14** release at 0 / 12 / 24 / 36 h (D37), one card live at a time, delivered at once; unpulled cards go to the Final Pull. **C15** holder ×1.5 for ≥ 1M $1PCT held continuously for 24 h, signed attestation. **C17** Final Pull pro rata to season spend; claims never expire. **C18** On Air 15 min after Power-On. **C21** FeeIn PDA is the creator, no fee sharing; D27 makes collections 100% team from BuysClosed while someone runs the chain. **C23** exits never pausable; upgrade key removed at Final Pull + 72 h.
- **D1** no Spotlight: no instruction, no service code, no API field. **D3** no RC-slip fallback: M4.1 must pass G4.1 by D12 to be in `rc-1`. **D4** the RC is the first mainnet deploy. **D5** C25–C28 at their defaults. **D6** shared VRF queue.
- **M2 B8**: both Final Pull claims are callable with a zero share and set their bit.

### 0.5 Decisions taken by the architect (no economic value involved)

1. **Dev buy = pump.fun `buy_v3`** (17 accounts; the protocol and creator fee stay on the curve until collected) with `max_sol_cost` = pump's documented reverse quote from the live `Global` and fee config, no slack. The buy is the first trade of a curve created in the same transaction, so its cost is exact. A mainnet simulation on 2026-10-08 delivered exactly 40,000,000,000,000 base units for 1,176,185,869 lamports (Appendix A, V3), which matches PARAMS' "≈1.176 SOL".
2. **Launch transaction = one v0 transaction with a frozen launch lookup table.** Architect's measurement with an 80-character URI: 838 B (9 static keys, 24 table keys); the legacy form is 1,546 B and cannot be sent. Fallback: a 2-transaction Jito bundle from the same wallet (633 B + 464 B as v0; 1,217 B + 707 B as legacy). Codex re-measures (§12).
3. **Creator-fee chain** (one transaction, every step permissionless): pump `sweep_creator_fee` → PumpSwap `sweep_creator_fee` (once migrated) → PumpSwap `transfer_creator_fees_to_pump` (once migrated) → pump `collect_creator_fee_v2` with wrapped SOL as the quote mint → `onepercent::collect_creator_fees`. Both forms were simulated green on mainnet on 2026-10-08 (Appendix A, V4–V5). These are pump.fun's own instruction names: external identifiers, exempt from AGENTS.md word list 2. Everywhere else, code, comments, logs and copy say "collect".
4. **Specials keep their own liveness rule until the Final Pull snapshot (decided D16, Q1).** A pack bought before `end_ts` and revealed just after it can still pull The 1% or the Jackpot; the callback never reads `end_ts` (M1 §9.0, master §10).
5. **Smallest executor tranche: 0.05 SOL (decided D16, Q2).**
6. **A season with no revealed pack** (`total_spend == 0`): every share is 0 (the division is guarded); nothing moves. There is no opener to pay.
7. **`power_on` requires phase StockUp**, as master §2.3 draws it (SPEC also allowed Setup). The launch tool checks the phase; the runbook runs `advance_phase` first.
8. **`power_on` tops FeeIn up** to `rent_min(0)` if a rent change left it short, so FeeIn can always receive fees. It counts nothing as fees.
9. **The 1% promotion** Locked → Live is written lazily by `buy_packs`, the callback and `advance_phase`. Liveness itself is always computed from timestamps and states (§7.1), never trusted from a stored Live byte.
10. **Executor swap adapters:** Jupiter `/build` on mainnet and the canary (M2 §6.1, B2); master §5.1's "test transfer" on devnet and localnet only, refused on `mainnet-beta`.
11. **No new dependency.** pump.fun instructions are encoded by hand from the IDL at pump-public-docs commit `2293f9a6` (§4.2). `@pump-fun/pump-sdk` 4.0.0 is younger than 14 days and 2.0.0 lacks `buy_v3` and the fee instructions. Jito and Helius Sender are called with zod-typed `fetch`.

---

## 1. Scope and PR plan

### 1.1 Deliverables by lane

| Lane | Deliverables |
|---|---|
| Program (M4.1) | The Machine carve (§5); `power_on`, `collect_creator_fees`, `start_final_pull`, `claim_final_sol`, `claim_final_tokens` (§6); The 1% and the Jackpot in `buy_packs`, the callback and `advance_phase` (§6.2); Burn after Done (§6.7); events and errors (§8); SDK layouts, builders, math mirrors and golden vectors (§10); tests T17–T23, P2 and CR-1 extensions, P4, the T06.16 matrix re-run (§13) |
| Services (M4.2) | The executor role (§11.1); the keeper's creator-fee chain, FeeIn alert, phase and Final Pull jobs (§11.2–§11.3); HOLD in the intake signer (§11.4); Block-0 data (§11.5); API, indexer and DB additions (§11.6–§11.7); the pump.fun SDK module (§10.2) |
| Ops (M4.2) | `onepct-ops launch` with its lookup table, plan, check and send commands (§12); `onepct-ops fees` and `onepct-ops final` (§12.6) |

### 1.2 PRs, file ownership, dependencies and merge order

"Owns" means only that PR edits those paths during M4. Shared files are append-only as listed.

| PR | Branch | Owns | Depends on | Merge |
|---|---|---|---|---|
| **M4.1** season on-chain | `feat/m4.1-season-onchain` | `programs/onepercent/src/instructions/{power_on, collect_creator_fees, start_final_pull, claim_final_sol, claim_final_tokens}.rs` (new); `math/{specials, creator_fee, final_pull}.rs` (new); `checks/launch.rs` (new); edits to M1's `instructions/{consume_randomness, buy_packs, advance_phase}.rs`; `instructions/stubs.rs` (remove these five stubs only); appends to `lib.rs`, `constants.rs`, `errors.rs`, `events.rs`, `state/machine.rs` (§5.1 carve); tests `t17_power_on.rs` … `t23_hygiene_m4.rs`, `prop_p4_season.rs`; appends to `prop_p2_packs.rs`, `prop_cr1_callback.rs`, `reference.rs`, `common/inject.rs`, `bench_cu_sizes.rs`; `packages/sdk/src/{ix/{powerOn, collectCreatorFees, startFinalPull, claimFinalSol, claimFinalTokens}.ts, math/{specials, creatorFee, finalPull}.ts, tx/finalClaims.ts}` (new) and appends to `layouts.ts`, `constants.ts`, `index.ts`; `fixtures/vectors/{specials, creator_fee, final_pull, launch_curve}.json` (new) and regenerated `layouts.json`, `ix.json`, `idl_constants.json`; the `season` flow appended to M1's `e2e:validator` runner; `CU_LIMITS` keys of §13.7. **Last commit, after M2's P1 merges:** the Burn-after-Done change in M2's `instructions/{exec_begin, exec_end}.rs` and `t22_burn_after_done.rs` | G1; M2 **P0** merged (errors and events append after P0's); M2 **P1** merged before the last commit | D11. If P1 is late, open the PR without the last commit and land it as `feat/m4.1b-burn-after-done` the day P1 merges; G4.1 covers both |
| **M4.2** season services | `feat/m4.2-season-services` | `services/worker/src/executor/**`, `services/worker/src/keeper/{fees, final}/**`, `services/worker/src/indexer/season/**` (new dirs); one registration line each in S1's and S3's job lists, and one call in S3's phase job (§11.3); `services/api/src/intake/hold/**` and one route line in S2's intake router; `services/api/src/public/{hold, block0, creatorFees}.ts` (new) and the replacement of S4's `/api/hold/attest` 404; `packages/service-kit/src/{hold/**, landing.ts}` (new, M4-A9); `packages/sdk/src/{pump/**, tx/{launch, feeChain}.ts, api/{hold, block0, creatorFees}.ts}` (new) and appended optional fields in `packages/sdk/src/api/machine.ts`; a new migration in `packages/db/drizzle/` and appended tables in `packages/db/src/schema.ts`; `packages/cli/src/{launch, fees, final}/**`; `fixtures/pump/**`, `fixtures/mainnet/pump/**`, `fixtures/vectors/pump_ix.json` (new); the `launch` flow appended to M1's `e2e:validator` runner; `.env.example` lines; the keys of §4.3 in `packages/config`; `EXTERNAL_IDENTIFIERS` appended to `packages/config/src/vocabulary.ts` and the matching lines in `scripts/lint-words.mjs` (§2 rule 8) | M4.1 (IDL, SDK builders); M2.2 S0–S4 merged; M2 P1 (`checkExecBegin`, `composeExecTransaction`); K1's landing (moved per M4-A9 if needed); X2 `build` with B11's `wrapAndUnwrapSol` | D14 |

- **Gate mapping.** G4.1 = M4.1 (+ `m4.1b` if split). G4.2 = M4.2.
- **Parallel with M2.1 (master §11.3).** M4.1's instructions live in new files. The shared files `lib.rs`, `errors.rs`, `events.rs`, `constants.rs` and `state/machine.rs` are append-only; `instructions/stubs.rs` loses only each PR's own stubs; `params.rs` changes only through `packages/config`. The later PR rebases. Generated files (`fixtures/vectors/*.json`, `packages/sdk/src/idl/*`, `pnpm-lock.yaml`, `packages/db/drizzle/meta/*`) are never hand-merged: regenerate them (`pnpm golden:update`, `pnpm sdk:idl`, `pnpm install`, `drizzle-kit generate`).
- **Append-only for both PRs:** `packages/sdk/src/index.ts` and the `exports` of `packages/sdk/package.json`, `.env.example` files, `CU_LIMITS`, the P1/P2 operation sets, `reference.rs`, `packages/db/src/schema.ts`.
- **The only cross-lane edits:** the Burn-after-Done change in M2's two executor files (M4-A5); the move of K1's landing helper (M4-A9), if K1 did not already put it in `service-kit`; the registration lines named above; the `EXTERNAL_IDENTIFIERS` exemption in M1's vocabulary file and word-lint script (§2 rule 8). List each in the PR.

### 1.3 Calendar (master §11.1)

| Day | M4.1 (program) | M4.2 (services, ops) |
|---|---|---|
| D8 Mon 10-19 | Interface commit after P0 merges: carve, appends, Accounts structs of the five instructions, SDK layouts and builders; `power_on`; T17 | — |
| D9 Tue 10-20 | Specials: liveness, `buy_packs`, callback, `advance_phase`; T18, T19; CR-1 extension; T06.16 re-run | Migration, SDK pump module, launch lookup table and `plan` (devnet) |
| D10 Wed 10-21 | `collect_creator_fees`, T20; Final Pull instructions, T21; P2 extension, P4 | Executor role and its tests |
| D11 Thu 10-22 | Burn after Done (P1 merged on D10), T22, T23; reports; **PR** | Keeper fee chain and FeeIn alert; HOLD |
| D12 Fri 10-23 | **G4.1**; `rc-1` | Final Pull keeper; Block-0; API routes |
| D13 Mon 10-26 | — | E4a on devnet (founder's go), E4b and `e2e:validator launch` on the validator; canary `launch plan` with the founder |
| D14 Tue 10-27 | — | **PR**, **G4.2** |

---

## 2. Rules for this milestone

M1 §2 rules 1–12 and M2 §2 apply to every PR. In addition:

1. **Branches** per §1.2. Never push to `main`. Change only `app/**` and `.github/workflows/app.yml`.
2. **Arithmetic.** `power_on` is an entry instruction: checked arithmetic, `MathOverflow`. `collect_creator_fees`, `start_final_pull`, `claim_final_sol` and `claim_final_tokens` gate or are exits: saturating arithmetic, no arithmetic error path, `arithmetic_side_effects` denied in their modules. The callback stays saturating.
3. **Exits** now also include `collect_creator_fees`, `claim_final_sol` and `claim_final_tokens` (master I10): no pause bit, no `Config` account, no remaining accounts, no attestation. `start_final_pull` reads no pause bit and no `Config` either.
4. **Pause bits** are still read only by `buy_packs`, `feed`, `feed_back`, `sell_back` and `exec_begin`. T23.01 greps it.
5. **Top level.** `power_on` calls M1's top-level check (`NotTopLevel`), like `feed`, `exec_begin` and `exec_end`.
6. **Numbers** only from `@onepercent/config` (PARAMS issue 3, plus §4.3 until issue 4 lands). External facts (§4.2) live in `constants.rs` or the SDK's `pump/ids.ts`, each with its source comment. A number not found in either: stop and ask.
7. **Keys.** Master §6 rules 1–7 are acceptance criteria (§11, §15). Codex never sends a mainnet transaction; the launch tool's mainnet commands are run by the founder.
8. **Words.** pump.fun's instruction names are external identifiers, exempt from AGENTS.md list 2. M1's `lint:words` treats `_` as a word boundary, so it would flag `sweep_creator_fee` and `sweep_protocol_fee`. M4.2 makes the exemption mechanical: `packages/config/src/vocabulary.ts` gains `EXTERNAL_IDENTIFIERS = ['sweep_creator_fee', 'sweep_protocol_fee']`, and `scripts/lint-words.mjs` blanks exactly those tokens before matching (a test shows the bare word is still caught). Our own code names these steps `curveCollectStepIx` and `poolCollectStepIx` and refers to the discriminators by constant; the bare word never appears in code, comments, logs, metric names or copy.

---

## 3. Dependencies

No new crate and no new npm package. Everything below is already pinned on `main` or by M2.

| Need | Uses |
|---|---|
| pump.fun and PumpSwap instructions, PDAs and layouts | Hand-written encoders in `packages/sdk/src/pump/` (§10.2), checked against `fixtures/pump/idl/{pump, pump_amm}.json`: the upstream IDL files with every `docs` field removed (upstream prose contains a word `lint:words` bans), produced by a committed script; `SOURCE.md` records the upstream commit and both sha256 (upstream and stored) |
| Jupiter `/build` for executor swaps | X2's `build` with B11's `wrapAndUnwrapSol: false` |
| Jito Block Engine, Helius Sender | zod-typed `fetch` in `packages/service-kit/src/landing.ts` |
| Program and account dumps for the launch e2e | `solana program dump` (raw `.so`) and `solana account` data saved as raw `.bin` with a small `.meta.json` (owner, lamports, executable, slot, date), never as base64 text (base64 can form banned words between `+` and `/`, which `lint:words` would flag). Run once at M4 start by Codex against a mainnet RPC URL from the env (reads only); the e2e builds the validator's `--account` files in a temporary directory |

---

## 4. Parameters

### 4.1 Values M4 uses (PARAMS issue 3)

| Alias | PARAMS key | Value |
|---|---|---|
| `DEV_BUY` | `TOKEN_1PCT.devBuyAmount` | 40,000,000,000,000 base units (40M × 10⁶) |
| `CARD_AMOUNT`, `CARD_COUNT` | `TOKEN_1PCT.onePctCardAmount`, `.onePctCardCount` | 10,000,000,000,000; 4 |
| `REL[k]` | `TOKEN_1PCT.onePctReleaseOffsetsSeconds` | 0 / 43,200 / 86,400 / 129,600 s after `on_air_ts` (D37) |
| `DECIMALS_1PCT` | `TOKEN_1PCT.decimals` | 6 |
| `HOLDER_BPS` | `TOKEN_1PCT.holderTier.onePctOddsMultiplierBps` | 15,000 (×1.5 on The 1% segment only) |
| `HOLD_MIN`, `HOLD_SECONDS` | `TOKEN_1PCT.holderTier.minBalance`, `.continuousHoldSeconds` | 1,000,000,000,000 base units; 86,400 s (OFF, attester) |
| `HOLD_TTL` | `ATTESTATIONS.holdTtlSeconds` | 600 s |
| `C_DIV`, `JP_DIV` | `HIT_ODDS.onePctPriceDivisor`, `.jackpotPriceDivisor` | 1,000; 400 |
| `JP_MIN_MULT` | `JACKPOT.minPotPriceMultiple` | 15 |
| `ON_AIR_DELAY`, `DURATION`, `FINAL_DELAY`, `SEAL_DELAY` | `SEASON.onAirDelaySeconds`, `.durationSeconds`, `.finalPullDelaySeconds`, `.sealDelaySeconds` | 900; 172,800; 600; 259,200 s |
| `CF[r].{stock, burn, team}` | `CREATOR_FEE_SPLIT_BPS.{belowFloor, season, afterEnd}` | 10,000/0/0; 5,000/0/5,000; 0/0/10,000 (D27) |
| `CREATOR_FEE_FLOOR` | `STOCK.creatorFeeFloorLamports` | 2,000,000,000 (D27) |
| `TARGET_BASE` | `STOCK.targetBaseLamports` | 30,000,000,000 |
| `BURN_*`, `JP_*` | `BURN.*`, `JACKPOT.*` | M2 §4.1 |
| Executor spacing | `EXECUTOR_POLICY.jackpotTrancheSpacingSecondsMin/Max` | 20 / 60 s |
| Fee-chain cadence | `KEEPER_POLICY.creatorFeeCollectSecondsMin/Max` | 120 / 300 s |
| FeeIn alert | `MONITOR.feeInSilenceAlertSeconds` | 600 s |
| Landing | `SERVICES.landing.{cuMarginBps, tipLamports, maxComputeUnitPriceMicroLamports}` | 2,000; PENDING K1; PENDING S3 |
| Coin name and symbol | `TOKEN_1PCT.name`, `.symbol` | `Onepercent`, `1PCT` |
| Attestation rate limits | `INTAKE.rateLimitPerMinutePerWallet`, `.rateLimitPerMinutePerIp` | 30, 60 (FEED and HOLD) |

Every on-chain key above is already in M1's `ONCHAIN_KEYS` (M1 §4.3). M4 appends none.

Examples in this brief use the PARAMS §14 calendar: Power-On at 1,793,289,600 (Thu 2026-10-29 16:00 UTC), so `on_air_ts` = 1,793,290,500, `end_ts` = 1,793,463,300, The 1% releases at 1,793,290,500 / 1,793,333,700 / 1,793,376,900 / 1,793,420,100, the Final Pull opens at 1,793,463,900 (10-31 16:25) and Done is due 259,200 s after `final_ts` (11-03 16:25 at the earliest, D37).

### 4.2 External facts pinned for M4 (EXT; re-check at M4 start, Appendix A)

| Fact | Value | Where it lives |
|---|---|---|
| pump.fun program | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, last deployed at slot 454,596,459 (2026-10-08 16:20 UTC); upgrade authority `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` (a Squads vault) | `PROGRAM_IDS.pumpFun`; `fixtures/pump/programs.json` |
| PumpSwap, pump fees, Mayhem | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` (slot 454,596,406), `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` (454,596,501), `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` (452,655,053) | `pump/ids.ts`; `programs.json` |
| IDL | pump-public-docs commit `2293f9a6` (2026-10-08 18:32 UTC); sha256 `pump.json` 6a19bad7…a79a6d, `pump_amm.json` b7d8c57a…cab89b | `fixtures/pump/idl/` + `SOURCE.md` |
| `Global` | `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`, 1,088 B: initial virtual token reserves 1,073,000,000,000,000; virtual SOL 30,000,000,000; real token 793,100,000,000,000; supply 10¹⁵; `create_v2_enabled` (byte 450) = 1 (read at slot 454,658,372) | read live |
| Curve fee config | `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt` = PDA `["fee_config", pump id]` under pump fees; curve fee 95 bps protocol + 30 bps creator | read live |
| PumpSwap `global_config` | `ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw` | `pump/ids.ts` |
| `BondingCurve` | discriminator `17b7f83760d8ac60`; 166 B for `create_v2` coins (older layouts 81, 150, 151 B; read missing trailing fields as 0). `virtual_token_reserves` u64 @8, `virtual_quote_reserves` @16, `real_token_reserves` @24, `real_quote_reserves` @32, `token_total_supply` @40, `complete` u8 @48, `creator` @49, `is_mayhem_mode` @81, `is_cashback_coin` @82, `quote_mint` @83 (`Pubkey::default()` for a SOL-paired coin), `creator_fee_bps` u64 @115, `can_edit_creator_fee` @123, `is_holder_reward` @124, `creator_fee` u64 @125 (waiting creator fee), `protocol_fees` u64 @133, `depth` u8 @141 | `constants.rs` (the five `power_on` reads), `pump/layouts.ts` (all) |
| `Pool` (PumpSwap) | discriminator `f19a6d0411b16dbc`; `pool_base_token_account` @139, `pool_quote_token_account` @171, `coin_creator` @211, `is_mayhem_mode` @243, `virtual_quote_reserves` i128 @245, `creator_fee_bps` u64 @261, `is_holder_reward` @270, `protocol_fees` u64 @271, `creator_fees` u64 @279. After migration `coin_creator` = the curve's `creator` (checked on a graduated coin) | `pump/layouts.ts` (confirms M2 Appendix Q3's @139) |
| Creator vaults | pump `["creator-vault", creator]`; PumpSwap `["creator_vault", coin_creator]` with its wSOL ATA. pump keeps the vault at `rent_min(0)` when it pays out | `pump/pdas.ts` |
| Instructions (discriminator, accounts) | `create_v2` `d6904cec5f8b31b4` (16); `buy_v3` `07051dc4f5176550` (17); pump `sweep_creator_fee` `20f6bf3408c949ba` (13); PumpSwap `sweep_creator_fee` `20f6bf3408c949ba` (12); `transfer_creator_fees_to_pump` `8b348655e4e56cf1` (10); `collect_creator_fee_v2` `cf118af204221338` (10); `collect_coin_creator_fee` `a039592ab58b2b42` (8). Account orders in §12.1 and §11.2 | `pump/ix.ts`, golden test against the stored IDL |
| Jito Block Engine | `https://mainnet.block-engine.jito.wtf/api/v1/bundles` (`sendBundle`, `getBundleStatuses`, `getInflightBundleStatuses`), `/api/v1/getTipAccounts`; ≤ 5 transactions per bundle, executed in order and all-or-nothing within one slot; minimum tip 1,000 lamports; 1 request/s per IP per region without a key. Tip accounts read with `getTipAccounts` at send time (8 documented, Appendix A) | `landing.ts` |
| `jitodontfront` | any key starting `jitodontfront`, read-only, need not exist; a bundle is rejected unless the transaction carrying it is first | `landing.ts` |
| Helius Sender | `https://sender.helius-rpc.com/fast` (regional `http://<region>-sender.helius-rpc.com/fast`); every transaction needs a tip **and** a priority fee; minimum tip 1,000,000 lamports (5,000 with `?swqos_only=true`); 10 documented tip accounts; `sendBundle` up to 4 transactions | `landing.ts` |

### 4.3 PARAMS issue 4 (pending): new off-chain keys, `[OFF]`

M4.2 adds these to `packages/config` with this header comment: `// PARAMS issue 4 (pending) — 04-M4-BRIEF.md §4.3`, with zod and `validateParams()` checks. The architect publishes the same values in issue 4.

```ts
// appended to EXECUTOR_POLICY (PARAMS §10)
burnTrancheSpacingSecondsMin: 20,   // [A] master §11.4 M4.2: random 20–60 s spacing for both executor kinds
burnTrancheSpacingSecondsMax: 60,   // [A]
minTrancheLamports: 50_000_000n,    // decided D16 (Q2): the smallest Burn or JackpotBuy tranche the executor sends
// appended to KEEPER_POLICY (PARAMS §8.3)
creatorFeeFinalCollectLeadSeconds: 60, // [A] PARAMS §8.3 "in the last minute before end_ts"
// appended to SERVICES (PARAMS §26.1)
hold: { maxHistoryTx: 1_000 },      // [A] HOLD refuses (history_too_long) above this many transactions in the 24 h window
// new block
export const BLOCK0 = { slots: 20 } as const; // [A] SPEC §6.10: "the buyers of the first 20 slots"
```

`validateParams()` gains: each executor min ≤ its max; `burnTrancheSpacingSecondsMin ≥ BURN.minSpacingSeconds`; `jackpotTrancheSpacingSecondsMin ≥ JACKPOT.trancheMinSpacingSeconds`; `0 < minTrancheLamports ≤ min(BURN.trancheMaxLamports, JACKPOT.trancheMaxLamports)`; `0 < creatorFeeFinalCollectLeadSeconds < KEEPER_POLICY.creatorFeeCollectSecondsMin`; `hold.maxHistoryTx` and `BLOCK0.slots` positive integers.

### 4.4 `constants.rs` additions (structural, not PARAMS)

`ONEPCT_LOCKED 0`, `ONEPCT_LIVE 1`, `ONEPCT_PULLED 2`, `ONEPCT_FINAL 3`; `REGIME_BELOW_FLOOR 0`, `REGIME_SEASON 1`, `REGIME_AFTER_END 2` (D27); `EDITION_NONE 255`; `FINAL_SOL_CLAIMED 0b01`, `FINAL_TOKENS_CLAIMED 0b10`; `CURVE_CREATOR_OFFSET 49`, `CURVE_MAYHEM_OFFSET 81`, `CURVE_CASHBACK_OFFSET 82`, `CURVE_QUOTE_MINT_OFFSET 83`, `CURVE_HOLDER_REWARD_OFFSET 124`, `CURVE_LAUNCH_MIN_LEN 125` (each with the comment "pump IDL `2293f9a6`, BondingCurve"). Compile-time asserts on the generated values: every `CREATOR_FEE_SPLIT_BPS` row sums to `BPS_DENOMINATOR` (PARAMS §22.5 check 8); `CARD_COUNT × CARD_AMOUNT == DEV_BUY` (check 10); `REL` has 4 entries, `REL[0] == 0`, strictly increasing, `REL[3] < DURATION` (check 9).

---

## 5. On-chain layouts (M4.1)

### 5.1 Machine: fields carved from `_reserved` (M4-A1; size stays 3,808 B)

| Offset | Field | Type | Written by |
|---|---|---|---|
| 2,608 | `token_mint` ($1PCT, copied from `Config.token_mint`) | Pubkey | `power_on` |
| 2,640 | `final_sol_total` (SOL pool frozen at the snapshot) | u64 | `start_final_pull` |
| 2,648 | `final_1pct_total` ($1PCT pool frozen at the snapshot) | u64 | `start_final_pull` |
| 2,656 | `_reserved` | [u8; 1,152] = 1,024 + 128 | — |

Size assert, offset test and `layouts.json` as M1 §7 requires.

### 5.2 Existing fields M4 starts writing

| Field (M1 §7.2) | Meaning from M4 |
|---|---|
| `phase` | PoweredOn (`power_on`), FinalPull (`start_final_pull`), Done (`advance_phase`) |
| `power_on_ts`, `on_air_ts`, `end_ts` | Set once by `power_on` |
| `final_ts` | Set once by `start_final_pull` |
| `onepct[4]` `{amount, state}` | Set by `power_on`; Locked → Live (promotion), Live → Pulled (callback), Locked or Live → Final (`start_final_pull`). Never backwards (I9) |
| `jackpot_tokens`, `jackpot_cost` | Reset to 0 by a win (callback) and by the snapshot |
| `final_pool_sol` | Tracked SOL still owed by the Final Pull (I2); set at the snapshot, decreased by each SOL claim |
| `final_pool_1pct` | $1PCT still owed by the Final Pull; set at the snapshot, decreased by each token claim (M1 A18) |
| `Bucket.final_pool` | `A(b)` frozen at the snapshot; each claim's share is computed from it while `A(b)` decreases (M1 A18) |
| `stock_sol`, `jackpot_sol` | Moved into the Final Pull at the snapshot, then 0 for good |

### 5.3 Binder and cards

- `Binder.flags` bit0 = Final SOL claimed, bit1 = Final tokens claimed (M1 §7.4). `close_binder` (M2) needs both bits when `season_spend > 0`.
- `Binder.sol_owed` (M1 §7.4, M2 §7.3) is written by `claim_final_sol` for a payee that cannot be credited; the lamports move into the Binder at the same time, so `withdraw_owed` can pay them.
- Cards M4 writes:

| Card | `mint` | `amount` | `value` | `kind` | `edition` | `seq_lo` |
|---|---|---|---|---|---|---|
| The 1% | `machine.token_mint` | `onepct[k].amount` | 0 | 6 | the Pull's | the Pull's |
| Jackpot | `machine.token_mint` | `jackpot_tokens` | `jackpot_cost` | 5 | the Pull's | the Pull's |
| Final, $1PCT | `machine.token_mint` | share | 0 | 8 | 255 | 0 |
| Final, bucket b | `buckets[b].mint` | share | 0 | 8 | 255 | 0 |

Every one of them redeems through M1's `redeem` (kinds ≤ 8), sells at market, and is refused by `sell_back` (`NotSellBackable`) and `feed_back` (`NotFeedable`) (PARAMS §3.3).

### 5.4 External reads by `power_on` (pump.fun `BondingCurve`, §4.2)

`power_on` reads, after M1's H1 origin check (§8.5): data length ≥ `CURVE_LAUNCH_MIN_LEN` (125); `creator` (32 B @49); `is_mayhem_mode` (@81); `is_cashback_coin` (@82); `quote_mint` (32 B @83); `is_holder_reward` (@124). Nothing else. A mainnet simulation of `create_v2` with a program PDA as `creator` produced a 166-byte curve with `creator` = that PDA, both flags 0, `quote_mint` = `Pubkey::default()` and `is_holder_reward` 0 (Appendix A, V3).

---

## 6. Instructions (M4.1)

### 6.0 Common rules

- `now = Clock::get()?.unix_timestamp`. Stored bumps with `create_program_address` where M1 does so.
- Exits after M4 (master I10): `take_back`, `redeem`, `settle`, `refund_pull`, `consume_randomness`, `team_withdraw`, `close_vault`, `withdraw_owed`, `close_binder`, `collect_creator_fees`, `claim_final_sol`, `claim_final_tokens`. Reading `phase` and `on_air_ts` is allowed (they only move forward); reading a pause bit, a role, an attestation, the VRF queue or `end_ts` is not (master §10). Hence §7.1's liveness and §7.2's regime use the phase, never `end_ts` (M4-A11).
- Every new instruction's `Accounts` struct is listed in §6.1–§6.6; every PDA is checked against its seeds; no remaining accounts.

### 6.1 `power_on()` — the launch wallet, once, top-level

**Accounts:**

| # | Account | Constraint |
|---|---|---|
| 1 | `launch_wallet` | Signer, mut; `== config.launch_wallet ≠ 0` (`Unauthorized`) |
| 2 | `config` | `["config"]` |
| 3 | `machine` | mut, `["machine"]` |
| 4 | `mint` | `== config.token_mint ≠ 0` (`AccountMismatch`) |
| 5 | `bonding_curve` | `UncheckedAccount`; H1 origin for `mint` (`NotPumpFun`); launch fields (§5.4; `NotLaunchCurve`) |
| 6 | `fee_in` | mut; `== PDA(["fee_in"])` with `machine.fee_in_bump`; owner System; data length 0 (`AccountMismatch`) |
| 7 | `ledger` | mut; `["ledger", mint]`; created if empty (M1 §8.9, payer and `payer` field = `launch_wallet`), else validated (`LedgerMismatch`) |
| 8 | `vault` | canonical ATA(`vault_auth`, `mint`, `mint.owner`), token account with `mint == mint` and `owner == vault_auth` (`VaultMismatch`) |
| 9 | `vault_auth` | `["vault_auth"]` |
| 10 | `token_program` | `== mint.owner` |
| 11 | `system_program` | — |

**Checks, in order:**
1. Top level (`NotTopLevel`).
2. Signer is `config.launch_wallet` (`Unauthorized`).
3. `phase == StockUp` and `power_on_ts == 0` (`WrongPhase`).
4. `mint == config.token_mint` (`AccountMismatch`).
5. `mint_is_safe(mint)` (M1 §8.4) and `decimals == DECIMALS_1PCT` (`MintNotSafe`). This is the master's acceptance-1 guard: a `create_v2` template that adds TransferHook, PermanentDelegate, Pausable, DefaultAccountState or any other extension, or keeps an authority, aborts the whole launch transaction.
6. `bonding_curve`: H1 (`NotPumpFun`); then length ≥ 125, `creator == fee_in.key`, `is_mayhem_mode == 0`, `is_cashback_coin == 0`, `quote_mint == Pubkey::default()` (SOL quote), `is_holder_reward == 0`; any failure gives `NotLaunchCurve`.
7. `fee_in`, `ledger`, `vault` as in the table.
8. **Unclaimed slack** (master §7.1): `vault.amount.saturating_sub(ledger.accounted) ≥ DEV_BUY` (`SlackShort`). Never `==`.

**Effects:**
- `ledger.accounted += DEV_BUY` (checked).
- FeeIn top-up: `system_program::transfer(launch_wallet → fee_in, rent_min(0).saturating_sub(fee_in.lamports))` when positive (§0.5 item 8).
- `machine.token_mint = mint`; `onepct[k] = {amount: CARD_AMOUNT, state: Locked}` for k in 0..4.
- `power_on_ts = now`; `on_air_ts = now + ON_AIR_DELAY`; `end_ts = on_air_ts + DURATION` (checked); `phase = PoweredOn`.
- Event `PoweredOn`.

A 1-base-unit donation to the vault before `power_on` leaves `accounted` at exactly 40M and the unit unaccounted (DG-2). Lamports donated to the ledger PDA or a vault pre-created by a third party change nothing (DG-7).

### 6.2 The 1% and the Jackpot: `buy_packs`, the callback, `advance_phase`

**Liveness** is §7.1's pure function `live_flags(machine, price, now) → (flags, onepct_index)`. `LIVE_SPOTLIGHT` (bit 1) is never set by any code path (D1).

**Promotion** `promote_onepct(machine, now)`: if `onepct_live_index(machine, now) == Some(k)` and `onepct[k].state == Locked`, write `Live` and emit `OnePctLive`. It never writes any other transition.

**`buy_packs` (M1 §9.8), step 4 becomes:** `promote_onepct(machine, now)`; `live_now = live_flags(machine, P, now).flags`; require `min_live_flags & !live_now == 0` (`LiveFlagsChanged`). Nothing else changes.

**`consume_randomness` (M1 §9.9):**
- Step 2: `live` is no longer constant. Keep `holder = pull.holder`; `rotate_hour(now)` as before.
- Step 3, for each pack i, before 3c: `promote_onepct(m, now)`; `(live_i, k) = live_flags(m, P, now)`; draw with `live_i` and `holder` (M1's `draw` already applies `HOLDER_BPS` to The 1% width). Then 3d gains two branches:
  - **kind 6 (The 1%)**: requires `k == Some(idx)` and `m.token_mint ≠ 0`. Hit card `{m.token_mint, onepct[idx].amount, 0, kind 6, E, seq_lo}`; `onepct[idx].state = Pulled`; emit `OnePctPulled`. No token moves; the ledger is unchanged.
  - **kind 5 (Jackpot)**: requires `m.jackpot_tokens > 0` and `m.token_mint ≠ 0`. Hit card `{m.token_mint, jackpot_tokens, jackpot_cost, kind 5, E, seq_lo}`; then `jackpot_tokens = 0`, `jackpot_cost = 0`; emit `JackpotWon`. `jackpot_sol` is untouched (it starts the next pot). No token moves; the ledger is unchanged.
  - If a requirement fails (unreachable on valid states), no card is written, the slot is released and `HitSkipped` is emitted, as M1 does for kinds 5–7. Kind 7 stays unreachable (width 0).
  - `PackRevealed` for a special: `live_flags = live_i`, `tier` = the kind, `hit_bucket = 255`, `hit_mint = m.token_mint`, `hit_amount` = the card amount, `hit_value` = the card value. `hit_out_this_hour`, `hit_value_out` and `PullRevealed.hit_value_total` count stock tiers only, as in M1.
- Step 6: `pull.live_flags` = OR of every `live_i` (M4-A2).
- The callback still touches its four accounts only, makes no CPI, creates no account, and returns `Ok` after the identity check in every state (I11). It reads the specials from the Machine only.

**`advance_phase` (M1 §9.5) gains:** `promote_onepct(machine, now)` on every call, and the transition FinalPull → Done when `final_ts ≠ 0 ∧ now ≥ final_ts + SEAL_DELAY`. Still at most one phase transition per call; a call with nothing due is a no-op `Ok`.

### 6.3 `collect_creator_fees()` — anyone; an exit

**Accounts:**

| # | Account | Constraint |
|---|---|---|
| 1 | `payer` | Signer, mut (any caller) |
| 2 | `machine` | mut, `["machine"]` |
| 3 | `fee_in` | mut; `== PDA(["fee_in"])` with `machine.fee_in_bump`; owner System; data length 0 (`AccountMismatch`) |
| 4 | `fee_in_wsol` | mut, `UncheckedAccount`; `== ATA(fee_in, wSOL, SPL Token)` (`AccountMismatch`). May not exist |
| 5 | `spl_token_program` | SPL Token |
| 6 | `system_program` | — |

**Checks:** `phase ≥ PoweredOn` (`WrongPhase`). Nothing else can fail after the account checks except a CPI given wrong accounts.

**Steps:**
1. `rotate_hour(now)` (M1 §11.8); snapshot the phase, book and regime once, before collection proceeds are credited (D27). The target remains diagnostic only.
2. **wSOL leg (M4-A3).** If `fee_in_wsol` is owned by SPL Token with 165 bytes: decode it; require `mint == wSOL`, `owner == fee_in`, native (`AccountMismatch`). Let `w = amount`. If `w > 0`: SPL Token `close_account(fee_in_wsol → payer, authority fee_in)` signed with `["fee_in", bump]`, then `system_program::transfer(payer → machine, w)`. Otherwise `w = 0`. An absent account is skipped.
3. **FeeIn leg.** `f = fee_in.lamports.saturating_sub(rent_min(0))`. If `f > 0`: `system_program::transfer(fee_in → machine, f)` signed with `["fee_in", bump]`.
4. `amount = f + w`. If 0: return `Ok`, no event.
5. Split the whole amount under the snapshotted §7.2 regime; `team_sol += team`. Call `credit_stock(stock)` only before AFTER_END. `burn_sol` is unchanged (D27).
6. Event `CreatorFeesCollected`.

Lamports donated to FeeIn are indistinguishable from fees: they are split like fees and never credited to a user (DG for FeeIn, T23.06). A rent rise that leaves FeeIn below `rent_min(0)` makes `f = 0`; nothing fails, and anyone can top FeeIn up (the keeper does, §11.2).

### 6.4 `start_final_pull()` — anyone

**Accounts:** `machine` (mut, `["machine"]`). Nothing else.

**Checks, in order:** `phase == BuysClosed` (`WrongPhase`); `now ≥ end_ts + FINAL_DELAY` (`FinalPullNotDue`); `pending_pulls == 0` (`PullPending`); `exec.kind == 0` (`ExecInFlight`, M4-A6).

**Effects** (saturating):
- `pool_sol = stock_sol + jackpot_sol`; `final_pool_sol += pool_sol`; `final_sol_total = pool_sol`; `stock_sol = 0`; `jackpot_sol = 0`.
- For every bucket with `class ≠ 0`: `final_pool = A(b)` (enabled or not).
- `pool_1pct = Σ onepct[k].amount over slots in Locked or Live + jackpot_tokens`; those slots become Final; `final_pool_1pct = pool_1pct`; `final_1pct_total = pool_1pct`; `jackpot_tokens = 0`; `jackpot_cost = 0`.
- `final_ts = now`; `phase = FinalPull`.
- Event `FinalPullStarted`.

`burn_sol`, `team_sol`, Deck entries, cards and every exit are untouched. From here on `credit_stock` routes to `burn_sol` (M1 A18), so nothing can reach `stock_sol` again: the creator-fee regime is `afterEnd` (stock 0, all to team without `credit_stock` (D27)), Sell back and StockSell are closed, and late `settle` redirects go to `burn_sol`.

### 6.5 `claim_final_sol()` — anyone; an exit; pushed by the keeper

**Accounts:** `machine` (mut, `["machine"]`); `binder` (mut, `["binder", owner]`, header `owner` field == `owner`; `AccountMismatch`); `owner` (`UncheckedAccount`, **no Anchor `mut`**: a payee, M1 A14). No signer besides the fee payer.

**Steps:**
1. `phase ∈ {FinalPull, Done}` (`WrongPhase`).
2. If `binder.flags & FINAL_SOL_CLAIMED ≠ 0`: return `Ok`, no event (idempotent).
3. `share = final_share(final_sol_total, binder.season_spend, total_spend)` (§7.3); `pay = min(share, final_pool_sol)`.
4. If `pay > 0`: `payee_check(owner)` (M1 §8.1; a live wallet passed read-only → `AccountMismatch`). If `creditable(owner, pay)`: move `pay` Machine → owner. Otherwise move `pay` Machine → Binder and `binder.sol_owed += pay` (SPEC §7.3; `withdraw_owed` pays it later). `final_pool_sol −= pay`.
5. `binder.flags |= FINAL_SOL_CLAIMED`, also when `pay == 0` (M2 B8). Event `FinalSolClaimed`.

Claims never expire, read no pause bit, and work in Done after the upgrade authority is gone.

### 6.6 `claim_final_tokens()` — the owner; an exit

**Accounts:** `owner` (Signer, mut; pays the card slots); `machine` (mut); `binder` (mut, `["binder", owner]`); `system_program`.

**Steps:**
1. `phase ∈ {FinalPull, Done}` (`WrongPhase`).
2. If `binder.flags & FINAL_TOKENS_CLAIMED ≠ 0`: return `Ok`, no event.
3. Shares (§7.3), each capped by what remains: `s_1pct = min(final_share(final_1pct_total, spend, total_spend), final_pool_1pct)`; for every bucket with `class ≠ 0`: `s_b = min(final_share(final_pool(b), spend, total_spend), A(b))`.
4. `n` = number of non-zero shares. If `n > 0`: M1's Binder `grow_for(n, payer = owner)` (`BinderFull` possible), then append the cards of §5.3 in this order: $1PCT first, then buckets by ascending index; each write `len += 1`, `reserved −= 1`. Decrease `final_pool_1pct` by `s_1pct` and each `A(b)` by `s_b`. No token moves; every ledger is unchanged (the tokens move from the pool's claim to the card's claim).
5. `binder.flags |= FINAL_TOKENS_CLAIMED`, also when `n == 0` (M2 B8). Event `FinalTokensClaimed`.

The only ways this fails after the checks are `BinderFull` (65,535 cards) and an owner without the lamports for the slots; the owner fixes either.

### 6.7 Permissionless Burn after Done (M4-A5; the last M4.1 commit)

In M2's `exec_begin` and `exec_end`, for **kind 3 (Burn) with `machine.phase == Done` only**: skip "signer == `config.executor`" (`Unauthorized`), the disabled-role check (`RoleDisabled`) and the BURN pause bit (`Paused`). Everything else is unchanged: top level, the two-instruction pairing (B4), `exec.kind == 0` at begin, `src == ATA(signer, wSOL, SPL Token)`, the binding to `config.token_mint`, oracle reads and `min_out` with the 125 bps allowance (B5), `L ≤ min(BURN.trancheMaxLamports, burn_sol, floor(quote_eff × BURN.trancheMaxBpsOfQuoteReserves / 10_000))`, `last_burn_ts + BURN.minSpacingSeconds ≤ now`, `burn_paid_hour + L ≤ BURN.hourlyMaxLamports`, the slack rule, `burn_checked(Δ)`.

JackpotBuy never becomes permissionless; it stays OnAir-only. Before Done nothing changes.

**What anyone can cost after Done (the only claim allowed):** a caller may supply its own $1PCT as the "swap" and receive `L` lamports for at least `min_out` tokens, which are burned. Because `min_out` reads reserves the caller can move inside its own transaction, only the tranche, the spacing and the hourly cap bound the loss: at most 1 SOL per 20 s and 10 SOL per hour of `burn_sol`, and every accepted tranche still burns at least `min_out`. Never claim more.

### 6.8 Spotlight

Nothing. If M1 merged its two Spotlight stubs, they keep returning `NotImplemented` and M4 never touches them; if it merged without them (the M1 branch read on 2026-10-08 has none), M4 adds none. Either way no code path ORs `LIVE_SPOTLIGHT` into a live mask and nothing writes `Machine.spotlight` (T23.05).

---

## 7. Exact math (integer only; pure functions in `math/`, mirrored in the SDK)

### 7.1 Liveness (`math/specials.rs`)

```
onepct_live_index(m, now):
  if m.on_air_ts == 0: None
  for k in 0..4:
    match m.onepct[k].state:
      PULLED          → continue
      LOCKED | LIVE   → return (now ≥ m.on_air_ts.saturating_add(REL[k])) ? Some(k) : None
      _               → return None            // FINAL (after the snapshot), or any other byte (CR-1)
  None
jackpot_live(m, P)    = m.jackpot_tokens > 0 ∧ u128(m.jackpot_cost) ≥ u128(JP_MIN_MULT) × u128(P)
live_flags(m, P, now) → (flags, onepct_index):
  onepct_index = onepct_live_index(m, now)
  flags        = (onepct_index.is_some() ? LIVE_ONE_PCT : 0) | (jackpot_live(m, P) ? LIVE_JACKPOT : 0)
```

No `end_ts` term (Q1, decided D16): `buy_packs` already closes at `end_ts`, every pending Pull resolves within 300 s, and the snapshot then turns the unpulled slots Final and empties the pot, which ends both segments. On every reachable state `jackpot_cost > 0` implies `jackpot_tokens > 0` (JackpotBuy credits both; a win and the snapshot clear both), so the `jackpot_tokens > 0` guard equals PARAMS' rule; it only stops a zero-amount card on a corrupt state. Widths stay M1's: The 1% `P / C_DIV` (×`HOLDER_BPS` / 10,000 for a holder), Jackpot `P / JP_DIV`. Card k is live iff cards 0..k−1 are Pulled and `now ≥ on_air_ts + REL[k]`, so at most one card is live at a time (acceptance 3).

**Check values** (`on_air_ts` = 1,793,290,500, `end_ts` = 1,793,463,300, OG `P` = 100,000,000):

| State | `now` | Result |
|---|---|---|
| all Locked | 1,793,290,499 | none |
| all Locked | 1,793,290,500 | card 0; widths C = 100,000 (holder 150,000) |
| card 0 Pulled | 1,793,333,699 | none |
| card 0 Pulled | 1,793,333,700 | card 1 |
| card 0 Locked | 1,793,333,701 | card 0 only (card 1 waits for card 0) |
| all Pulled | any | none |
| slot 0 state byte 7 | any | none |
| card 0 Locked | 1,793,463,305 (`end_ts` + 5, a Pull bought before `end_ts`) | card 0 (decided D16, Q1) |
| after `start_final_pull` (unpulled slots Final) | any | none |
| `jackpot_cost` 1,499,999,999, tokens > 0 | any | Jackpot not live |
| `jackpot_cost` 1,500,000,000, tokens > 0 | any | Jackpot live; width 250,000 |

### 7.2 Creator-fee regime and split (`math/creator_fee.rs`)

D27 (founder, 2026-10-09) replaces the previous target-based split.

```
regime(m):                           // read once at collection start, before crediting proceeds
  if m.phase ≥ BuysClosed:            AFTER_END
  else:                               (book < CREATOR_FEE_FLOOR) ? BELOW_FLOOR : SEASON
  book = stock_sol + Σ_all C(b)        // u128, saturating to u64
  CREATOR_FEE_FLOOR = STOCK.creatorFeeFloorLamports = 2_000_000_000
split(amount, r):
  burn = 0
  team = ⌊amount × CF[r].team / 10_000⌋
  stock = amount − team
credit:
  team_sol += team
  if r != AFTER_END: credit_stock(stock)
```

Only PoweredOn and OnAir reach the floor test; Setup and StockUp fail `WrongPhase`. The phase selects AFTER_END, never `end_ts` (M4-A11). `rotate_hour` still runs for shared accounting, but neither its counters nor the Sell back target selects this regime. The `CreatorFeesCollected.target` field remains the Sell back target as a diagnostic only; `book` is the value read before collection. Structural regime bytes are BELOW_FLOOR 0, SEASON 1, AFTER_END 2.

The split follows the regime in force when collection starts, whenever the fees accrued. A collection crossing the floor uses its initial regime for the whole amount. SEASON has no stock cap: the stock keeps 50% even above the 30 SOL target. AFTER_END sends all proceeds to team, with no `credit_stock` call. No creator fees fund burn. The 5% pack burn is unchanged.

| `amount` | Regime | stock / burn / team |
|---|---|---|
| 1,000,000,007 | BELOW_FLOOR | 1,000,000,007 / 0 / 0 |
| 1,000,000,007 | SEASON | 500,000,004 / 0 / 500,000,003 |
| 1,000,000,007 | AFTER_END | 0 / 0 / 1,000,000,007 |
| 9 | SEASON | 5 / 0 / 4 |
| 9 | AFTER_END | 0 / 0 / 9 |
| 650,240 | AFTER_END | 0 / 0 / 650,240 |

Exact floor boundary, in either PoweredOn or OnAir: `stock_sol` 1,000,000,000 + `Σ C` 999,999,999 gives book 1,999,999,999, so BELOW_FLOOR. One more lamport gives book 2,000,000,000, so SEASON. Changing `hit_out_last_hour` does not change either result. A book of 30,000,000,000 or more still uses SEASON. Every phase from BuysClosed uses AFTER_END regardless of book.

Direct SOL transfers to FeeIn are the documented stock-seeding path: collection treats them exactly like fees under the initial regime. They create no user claim. T20 covers the transfer, collection and floor crossing.

### 7.3 Final Pull shares (`math/final_pull.rs`)

```
final_share(pool, spend, total) = total == 0 ? 0 : ⌊u128(pool) × u128(spend) / u128(total)⌋      // toward the machine (PARAMS §16.4)
```

Σ shares ≤ pool for any set of Binders whose spends sum to `total_spend`, so no pool underflows. Remainders stay in `final_pool_sol`, `final_pool_1pct` and `A(b)` and are disclosed. **Check values:** pool 1,000,000,000,000 (1,000 SOL), spend 4,200,000,000, total 4,980,000,000,000 → 843,373,493; the same spend against a $1PCT pool of 43,000,000,000,000 → 36,265,060,240; spend 0 → 0; spend = total → pool; total 0 → 0.

---

## 8. Events and errors (append-only)

**Errors**, appended after M2's last (`FinalNotClaimed`), in this order: `NotLaunchCurve`, `FinalPullNotDue`. Everything else reuses existing codes (`Unauthorized`, `WrongPhase`, `AccountMismatch`, `MintNotSafe`, `NotPumpFun`, `LedgerMismatch`, `VaultMismatch`, `SlackShort`, `PullPending`, `ExecInFlight`, `BinderFull`, `MathOverflow`, `NotTopLevel`). SDK error map (M1 §15.5): both new errors → `generic`.

**Events**, appended after M2's:

| Event | Fields |
|---|---|
| `PoweredOn` | mint, bonding_curve, fee_in, launch_wallet, dev_buy u64, vault_amount u64, accounted u64, fee_in_topup u64, power_on_ts i64, on_air_ts i64, end_ts i64 |
| `OnePctLive` | index u8, release_ts i64, ts i64 |
| `OnePctPulled` | seq u64, pack u8, index u8, buyer, amount u64, holder bool |
| `JackpotWon` | seq u64, pack u8, buyer, edition u8, tokens u64, cost u64, jackpot_sol_left u64 |
| `CreatorFeesCollected` | regime u8, amount u64, from_fee_in u64, from_wsol u64, to_stock u64, to_burn u64, to_team u64, book u64, target u64, ts i64 |
| `FinalPullStarted` | final_ts i64, pool_sol u64, pool_1pct u64, jackpot_tokens u64, onepct_final_mask u8, total_spend u64, bucket_pools [u64; 16] |
| `FinalSolClaimed` | owner, share u64, paid u64, to_owed bool, remaining u64 |
| `FinalTokensClaimed` | owner, onepct u64, buckets [u64; 16], cards u8, slot_rent u64 |

`PhaseAdvanced` (M1) records FinalPull → Done. The callback's log budget (M1 §12, CR-5) is re-measured with specials live (§13.3).

---

## 9. Invariants M4 touches (master §9.1)

| # | Form M4 asserts | Asserted by |
|---|---|---|
| I1 | For $1PCT: `vault.amount ≥ accounted`, credited only from slack (`power_on`); claims and wins move claims, never tokens | `SlackShort`; T17.06, P2, P4 |
| I2 | `Machine.lamports ≥ rent + stock_sol + jackpot_sol + burn_sol + team_sol + final_pool_sol`; the snapshot moves SOL between tracked buckets; `claim_final_sol` lowers `final_pool_sol` by exactly what leaves | P2, P4 |
| I9 | Phase forward only; each The 1% slot Locked → Live → Pulled, or Locked/Live → Final; nothing ever returns | P2 per step |
| I10 | The three new exits read no pause bit, no attestation, no `Config` | T23.01–T23.02 |
| I11 | The callback is total with every special live | CR-1 to CR-6 |
| I13 | `exec` empty at the end of every transaction; `start_final_pull` refuses an in-flight exec | T21.01, EX-1 |
| **I14 (exact)** | `ledger($1PCT).accounted == Σ amount(slots Locked or Live) + jackpot_tokens + final_pool_1pct + Σ $1PCT card amounts in every Binder`. Before the snapshot `final_pool_1pct = 0`; after it, no slot is Locked or Live and `jackpot_tokens = 0`. The master's "≥" follows | P2, P4 per step |
| F1 | `final_pool_sol + Σ paid SOL shares == final_sol_total` after the snapshot | P4 |
| F2 | For each bucket: `A(b) + Σ claimed s_b == final_pool(b)`; for $1PCT: `final_pool_1pct + Σ claimed s_1pct == final_1pct_total` | P4 |
| F3 | Each Binder's claimed shares equal `final_share(...)` of its spend; each bit is set once | P4 |
| CF1 | Every collection: `to_stock + to_burn + to_team == amount`; the regime matches §7.2; I2 grows by `amount` | P2, T20 |
| L1 | At most one slot is Live; a Live slot `k` has every slot before it Pulled | P2 per step |

---

## 10. SDK additions (`packages/sdk`)

### 10.1 M4.1

| Module | Content |
|---|---|
| `layouts.ts` | the §5.1 fields; `layouts.json` offsets |
| `ix/*` | `powerOnIx`, `collectCreatorFeesIx({payer})`, `startFinalPullIx`, `claimFinalSolIx({owner, ownerWritable})`, `claimFinalTokensIx({owner})`; the payee override of M1 §15.4 applies to `claim_final_sol`'s `owner` (writable unless reserved or executable) |
| `math/specials.ts` | `onePctLiveIndex`, `jackpotLive`, `liveFlags(machine, edition, nowTs)` (the web's `min_live_flags` and odds rows), `releaseTimes(machine)` |
| `math/creatorFee.ts` | `creatorFeeRegime(machine, nowTs)` (applies `rotateHour` first), `splitCreatorFees(amount, regime)` |
| `math/finalPull.ts` | `finalShare`, `finalShares(machine, binder)` → `{sol, onePct, buckets[16]}` |
| `tx/finalClaims.ts` | `buildFinalClaimsTransaction({owner, …})`: `claim_final_sol` and `claim_final_tokens` in one transaction, owner-signed, with `CU_LIMITS`; for the web lane's Final Pull screen and the rescue CLI |

### 10.2 M4.2: the pump.fun module (`packages/sdk/src/pump/`)

| File | Content |
|---|---|
| `ids.ts` | the §4.2 program ids and fixed accounts, each with its source |
| `pdas.ts` | `global`, `mintAuthority`, `bondingCurve`, `associatedBondingCurve`, `creatorVault(creator)` (pump), `ammCreatorVaultAuthority(coinCreator)`, `eventAuthority` (pump, PumpSwap), `userVolumeAccumulator`, Mayhem `globalParams`, `solVault`, `mayhemState`, `mayhemTokenVault`, `poolAuthority`, `canonicalPool` |
| `layouts.ts` | `decodeBondingCurve` (all §4.2 fields, trailing fields optional), `decodePool` (to `creator_fees` @279), `decodeGlobal` (1,088 B; the fields the launch reads), `decodeFeeConfig` (borsh: `bump`, `admin`, `flat_fees`, `fee_tiers: Vec<{u128 threshold, {lp, protocol, creator} u64}>`, …) |
| `ix.ts` | `createV2Ix`, `buyV3Ix`, `curveCollectStepIx` (pump `sweep_creator_fee`), `collectCreatorFeeV2Ix` (wSOL as quote), `poolCollectStepIx` (PumpSwap `sweep_creator_fee`), `transferCreatorFeesToPumpIx`, `collectCoinCreatorFeeIx`. Account orders exactly as the stored IDL |
| `quote.ts` | `devBuyQuote(global, feeConfig, tokens)` = pump's reverse quote: `net = ⌈tokens × virtual_quote / (virtual_token − tokens)⌉ + 1`, `cost = ⌈net × (10,000 + protocol_bps + creator_bps) / 10,000⌉`. Check value: 40,000,000,000,000 tokens at the §4.2 `Global` and 95 + 30 bps → net 1,161,665,055, cost 1,176,185,869 |
| `pump.test.ts` | discriminators and account orders equal `fixtures/pump/idl/*.json`; layouts decode `fixtures/mainnet/pump/*` |

`create_v2` data: discriminator, `name`, `symbol`, `uri` (borsh strings: u32 length + bytes), `creator` (32 B), `is_mayhem_mode` (1 B), then the three trailing arguments written explicitly as zeros: `is_cashback_enabled` (1 B), `creator_fee_bps` (8 B), `is_holder_reward` (1 B), as live mainnet `create_v2` calls send them. `buy_v3` data: discriminator, `amount` u64, `max_sol_cost` u64; `partial_fill` omitted.

### 10.3 M4.2: transactions and API schemas

- `tx/launch.ts`: `buildLaunchTransaction(...)` (§12.1) → v0 with the launch table; `buildLaunchBundle(...)` → the two transactions of §12.2.
- `tx/feeChain.ts`: `buildFeeChainTransaction({payer, mint, curve, pool | null, feeIn, withAdvancePhase})` (§11.2).
- `api/hold.ts`, `api/block0.ts`, `api/creatorFees.ts` (§11.6); appended optional fields in `api/machine.ts`.

---

## 11. Services (M4.2)

### 11.1 The executor (`ROLE=executor`, `services/worker/src/executor/`)

**Keys.** `EXECUTOR_KEYPAIR` only; boot refusal for any other key (M2 §11.1). `RoleKey` + `RoleGuard`: the key must equal `Config.executor` and its disabled bit must be clear, or the service stops sending and `/health` returns 503. Its wallet holds fee money only (fees, tips, its wSOL ATA rent). It never receives machine SOL outside an exec pair; after each landed trade its wSOL ATA must be empty, else alert `executor_residue`.

**Loop** (one instance; `leader.ts` with lock key `onepct:executor` in case two replicas run). Two independent timers, one per kind. Each fires after a random delay drawn from `EXECUTOR_POLICY.{jackpot,burn}TrancheSpacingSeconds{Min,Max}`; on firing:
1. Read `Machine` and `Config` at `confirmed`; `now = chainNow()`; apply the SDK's `rotateHour` and the burn-hour rotation.
2. Eligibility. JackpotBuy: `phase == OnAir ∧ now < end_ts ∧ ¬paused(BURN)`, `last_jackpot_buy_ts + JACKPOT.trancheMinSpacingSeconds ≤ now`. Burn: `phase ≥ PoweredOn`, `¬paused(BURN)` (ignored in Done), `last_burn_ts + BURN.minSpacingSeconds ≤ now`.
3. Read the $1PCT curve, or once `complete` the canonical pool and its vaults (M2 §6.3–§6.4). Size: JackpotBuy `L = min(JACKPOT.trancheMaxLamports, jackpot_sol, ⌊quote_eff × JACKPOT.trancheMaxBpsOfQuoteReserves / 10,000⌋)`; Burn `L = min(BURN.trancheMaxLamports, burn_sol, ⌊quote_eff × BURN.trancheMaxBpsOfQuoteReserves / 10,000⌋, BURN.hourlyMaxLamports − burn_paid_hour)`. Skip if `L < EXECUTOR_POLICY.minTrancheLamports` **(decided D16, Q2)**.
4. `checkExecBegin` (M2 P1 mirror) → `min_out`; skip and log on any refusal.
5. Swap leg, chosen by `EXECUTOR_SWAP=jupiter|stub`. **Jupiter** (mainnet, canary): X2 `build` exact-in `L`, `inputMint` wSOL, `outputMint` `config.token_mint`, `taker` = executor, `slippageBps` = `JACKPOT.minOutSlipBps` or `BURN.minOutSlipBps`, `wrapAndUnwrapSol: false`, `destinationTokenAccount` = the $1PCT vault; skip if Jupiter's `minOut` < the on-chain `min_out`. **Test transfer** (devnet and localnet only, master §5.1; refused at boot on `mainnet-beta`): the executor's own $1PCT ATA transfers the SDK's `expected` (≥ `min_out`) into the vault; its tokens come from devnet curve buys made by the E4 script.
6. Compose with `composeExecTransaction` (M2 §6.1, exactly two `onepercent` instructions), `[create_idempotent wSOL ATA]` first, the `jitodontfront` read-only key, the Sender tip; CU limit = simulated × `(10,000 + SERVICES.landing.cuMarginBps) / 10,000`. Simulate; send through `landing.ts` (Helius Sender with tip `SERVICES.landing.tipLamports`; fallback plain RPC send of the same transaction); confirm through `TxSender`. Never re-send a landed blockhash.
7. Record the attempt in `executor_trades` (§11.7).

**Bounds (the only claims allowed, M2 §6.7):** JackpotBuy ≤ 2 SOL per 20 s within `jackpot_sol`; Burn ≤ 1 SOL per 20 s and ≤ 10 SOL per hour; `min_out` reads reserves a stolen key can move, so only the tranche and caps bound the loss, until a guardian runs `DisableRole(4)`.

**Dry run.** `pnpm --filter worker executor:dry-run --cluster mainnet` plans, builds and simulates one tranche of each kind against live state, sends nothing, prints both.

### 11.2 Keeper: the creator-fee chain and the FeeIn alert (`services/worker/src/keeper/fees/`)

**The transaction** (`buildFeeChainTransaction`, v0 with the frozen protocol lookup table), every step permissionless, payer = the keeper:

| # | Instruction | When | Accounts (in order) |
|---|---|---|---|
| 1 | `ComputeBudget` limit and price | always | — |
| 2 | pump `sweep_creator_fee` | always | payer, `global`, `$1PCT mint`, wSOL, SPL Token, ATA program, System, `bonding_curve` (w), its wSOL ATA (w, unused), `creatorVault(FeeIn)` (w), its wSOL ATA (w, unused), pump `event_authority`, pump |
| 3 | PumpSwap `sweep_creator_fee` | once the canonical pool exists | payer, `global_config`, `pool` (w), wSOL, SPL Token, pool quote vault (w), `ammCreatorVaultAuthority(FeeIn)`, its wSOL ATA (w), System, ATA program, PumpSwap `event_authority`, PumpSwap |
| 4 | PumpSwap `transfer_creator_fees_to_pump` | same | wSOL, SPL Token, System, ATA program, FeeIn, `ammCreatorVaultAuthority(FeeIn)` (w), its wSOL ATA (w), `creatorVault(FeeIn)` (w), PumpSwap `event_authority`, PumpSwap |
| 5 | pump `collect_creator_fee_v2` | always | FeeIn (w), ATA(FeeIn, wSOL) (w, unused), `creatorVault(FeeIn)` (w), its wSOL ATA (w, unused), wSOL, SPL Token, ATA program, System, pump `event_authority`, pump |
| 6 | `onepercent::collect_creator_fees` | always | §6.3 |
| 7 | `onepercent::advance_phase` | only for the PoweredOn → OnAir collection | M1 §9.5 |

Simulated on mainnet on 2026-10-08: steps 2–5 on a graduated single-creator coin, 895 B legacy, 128,363 CU; steps 2 and 5 on a fresh coin, 627 B, 39,219 CU, which left the creator vault at exactly `rent_min(0)` (Appendix A, V4–V5).

**Schedule** (leader only; deadlines on `chainNow()`):
- From PoweredOn, every U(`KEEPER_POLICY.creatorFeeCollectSecondsMin`, `Max`) s. Skip the send when nothing waits: the curve's `creator_fee` (@125), the pump creator vault above `rent_min(0)`, the pool's `creator_fees` (@279) and its creator vault ATA, FeeIn above `rent_min(0)` and FeeIn's wSOL ATA all read 0.
- **On Air:** when `now ≥ on_air_ts` and phase is PoweredOn, one transaction with steps 1–7, so the collection runs under the initial D27 floor regime and the phase moves in the same transaction (PARAMS §8.3). This replaces S3's plain `advance_phase` for that transition (the one call M4.2 adds to S3's phase job).
- **Last minute:** once in `[end_ts − KEEPER_POLICY.creatorFeeFinalCollectLeadSeconds, end_ts)`.
- **Buys closed:** S3's phase job sends `advance_phase` (OnAir → BuysClosed) at `end_ts`; the next collection runs right after it, under `afterEnd` (M4-A11). Then forever while the keeper runs.
- If FeeIn is below `rent_min(0)` after a rent change, prepend a top-up transfer from the keeper of exactly the shortfall.

**Alerts** (M2 `alert()`):
- `fee_in_creator_changed` (critical): the curve's `creator` ≠ FeeIn, the pool's `coin_creator` ≠ FeeIn, `is_holder_reward` set on either, or a pump fees `sharing-config` PDA exists for the mint. pump.fun's admin can reassign a coin's creator (`admin_cto`); nothing on-chain can stop it, so detection is the defence (SPEC §6.9).
- `fee_in_silent` (warning, critical after twice the window): no `CreatorFeesCollected` with `amount > 0` landed for `MONITOR.feeInSilenceAlertSeconds` while $1PCT traded in that window (the curve's reserves, or the pool's vault balances, changed between reads).

### 11.3 Keeper: phases, the Final Pull and claim pushes (`services/worker/src/keeper/final/`)

| Job | Trigger | Action |
|---|---|---|
| Final Pull start | `phase ∈ {OnAir, BuysClosed}`, `now ≥ end_ts + FINAL_DELAY`, `pending_pulls == 0` | `[advance_phase if still OnAir][start_final_pull]`; `ExecInFlight` or `PullPending` → retry next scan |
| SOL claim pushes | phase FinalPull or Done | `getProgramAccounts` on the Binder discriminator with `dataSlice` of the 112-byte header; every Binder with `season_spend > 0` and bit0 clear gets `claim_final_sol`, packed greedily per transaction under 1,232 B with `CU_LIMITS.claimFinalSol`, owners writable per M1 A14's override; keyed `final_sol:<binder>` in `keeper_jobs` |
| Done | `now ≥ final_ts + SEAL_DELAY` | `advance_phase`; then M2's close-vault pass runs once (M2 §11.6) |

Token claims are the owner's (`claim_final_tokens`, owner-signed, from the web lane or the rescue CLI). The keeper never signs for a user.

### 11.4 Holder attester (HOLD) in the intake signer (`services/api/src/intake/hold/`, rule in `packages/service-kit/src/hold/`)

**Routes.** `POST /internal/hold/attest` on `ROLE=intake-signer`, reached through `POST /api/hold/attest` (replacing M2's 404). The public route answers 404 `{reason: "disabled"}` when `FLAG_HOLDER_BOOST=off`. Rate limits `INTAKE.rateLimitPerMinutePerIp` (public API) and `INTAKE.rateLimitPerMinutePerWallet` (both).

```ts
HoldAttestRequest = z.object({ wallet: PublicKeyString }).strict()
HoldAttestResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), wallet: PublicKeyString, signer: PublicKeyString, expiry: z.number(),
             message: Base64, signature: Base64, windowStartTs: z.number(), minBalance: U64String }),
  z.object({ ok: z.literal(false), reason: z.enum(["not_powered_on", "no_account", "below_min", "not_held_24h",
             "history_too_long", "evidence_unavailable"]) }),
])
```

**Rule** (pure, `packages/service-kit/src/hold/`; **decided D16, Q3**):
```
ata    = ATA(wallet, config.token_mint, Token-2022)                       // the canonical $1PCT account (M4-A8)
t1     = blockTime(latest confirmed slot);  t0 = t1 − HOLD_SECONDS
now_b  = the account's amount at confirmed (0 if absent; never cached)
sigs   = getSignaturesForAddress(ata, confirmed), newest first, paged until a blockTime < t0 or the end;
         more than SERVICES.hold.maxHistoryTx inside the window → refuse history_too_long
for each sig with blockTime ≥ t0 and err == null: getTransaction → pre and post amounts of `ata` (absent = 0)
start_b = no transaction in the window ? now_b : pre amount of the oldest one
eligible ⇔ min(start_b, now_b, every pre and post amount in the window) ≥ HOLD_MIN
```
A dip below 1M in any transaction, an account created or closed inside the window, or a missing `blockTime` means no attestation. Holdings in other token accounts do not count. Nobody can qualify before T0 + 24 h.

**Signing.** `expiry = attestationExpiry(blockTime, HOLD_TTL)` (M1 §8.6: block time + 600 − 10). Message `"1PCT-HOLD-v1" ‖ program_id ‖ wallet ‖ expiry i64 LE` (84 B, M1 §8.6), signed with the intake key. Insert one `hold_log` row **before** responding (insert failure → 503, nothing signed). Signing records nothing else (master §3.3). Parsed transactions at or before the latest finalized slot may be cached for `SERVICES.signers.evidenceCacheSeconds`; the balance and the signature list are read live. 503 `role_mismatch` / `role_disabled` as in M2 §11.1.

### 11.5 Block-0 board data (`services/worker/src/indexer/season/block0.ts`)

On the indexer's `PoweredOn` event at slot `s0`, once the confirmed slot passes `s0 + BLOCK0.slots + 32`:
1. `getSignaturesForAddress(bonding_curve, {until: launch signature})`, paged, plus the launch transaction itself; keep slots in `[s0, s0 + BLOCK0.slots)`.
2. `getTransaction` each; per transaction, every owner whose $1PCT balance rose (from `pre`/`postTokenBalances`, excluding the curve's own account) gives a row `{slot, signature, owner, tokens, lamportsSpent}`; `lamportsSpent` is the owner's lamport decrease when the owner is the fee payer, else null.
3. Label owners found in `Config` (`launch_wallet`, `keeper`, `executor`, `intake_signer`, `quote_signer`, `team_wallet`, `team_wallets`, guardians, `admin`) as `team: true` with the role; the vault's 40M row is labelled as the disclosed dev buy.
4. Upsert `block0_buys`; publish SSE `block0`. `onepct-ops final block0 --rebuild` re-runs it.

### 11.6 API additions (`ROLE=public`; schemas in `@onepercent/sdk/api`)

| Route | Response |
|---|---|
| `POST /api/hold/attest` | §11.4 |
| `GET /api/block0` | `{status: "pending", asOfSlot}` before Power-On; else `{status: "ready", asOfSlot, launch: {signature, slot, mint, bondingCurve, devBuyTokens}, slots, buys: [{slot, signature, owner, tokens, lamportsSpent \| null, team, role \| null}]}` |
| `GET /api/creator-fees?limit=` | `{asOfSlot, items: [{signature, ts, regime: "belowFloor" \| "season" \| "afterEnd", amount, toStock, toBurn, toTeam}]}`, newest first, `limit` ≤ 100 (the stats page's "each collection's regime", PARAMS §13.4) |
| `GET /api/machine` (appended, optional) | `tokenMint \| null`; `onePct[].releaseTs`; `onePctLiveIndex \| null`; `burn {burnSol, burnedTotal, lastBurnTs, burnPaidHour}`; `finalPull \| null {finalTs, solTotal, solRemaining, onePctTotal, onePctRemaining, buckets [{index, mint, pool, remaining}], totalSpend}` |
| `GET /api/verify/:seq` (appended) | `packs[].liveFlags` (M4-A2) |
| `GET /api/stream` (appended event names) | `powerOn`, `onePct`, `jackpotWon`, `jackpotBuy`, `burn`, `creatorFees`, `finalPull`, `block0` |

### 11.7 Indexer and database

One forward migration (the next free number at rebase time):

| Table | Key | Columns | Writer |
|---|---|---|---|
| `hold_log` | `id` uuid; unique `message_sha256` | wallet, ata, expiry, window_start_ts, window_end_ts, min_balance, tx_count, signer, ip_hash, created_at | intake signer only, insert-only |
| `block0_buys` | (`signature`, `owner`) | slot, tokens, lamports_spent, team, role | indexer |
| `creator_fee_collections` | (`signature`, `event_index`) | order key, regime, amount, from_fee_in, from_wsol, to_stock, to_burn, to_team, book, target, ts | indexer |
| `final_claims` | `owner` | sol_share, sol_paid, sol_to_owed, sol_sig, onepct_share, bucket_shares numeric(20,0)[16], tokens_sig | indexer |
| `executor_trades` | `id` uuid; unique `signature` | kind, amount, min_out, jupiter_out, delta, slippage_bps, status (`planned`, `simulated`, `sent`, `confirmed`, `failed`, `skipped`), last_error, created_at, confirmed_at | executor |
| `packs` (altered) | — | new column `live_flags` integer, from `PackRevealed.live_flags` | indexer |

The indexer maps the §8 events into these mirrors with handlers in `services/worker/src/indexer/season/` (registered append-only). Replaying twice still yields identical rows.

### 11.8 Observability

Metrics: `onepct_executor_trades_total{kind,result}`, `onepct_executor_slippage_bps{kind}`, `onepct_creator_fees_lamports_total{regime}`, `onepct_fee_chain_runs_total{result}`, `onepct_final_claims_total{kind}`, `onepct_hold_requests_total{result}`. Alerts: `executor_residue`, `executor_failures` (5 in a row), `fee_in_creator_changed`, `fee_in_silent`, `final_pull_not_started` (FinalPull not reached 30 min after it is due), and any `VaultShortfall`.

---

## 12. Launch tooling: `onepct-ops launch` (`packages/cli/src/launch/`)

The founder runs it on the operator machine with the key files (master §6 rule 2). Codex runs it only on localnet and devnet.

### 12.1 The launch transaction (one v0 transaction; signers: the launch wallet, which pays, and the vanity mint)

| # | Instruction | Notes |
|---|---|---|
| 1 | `ComputeBudget` `SetComputeUnitLimit` | simulated CU × `(10,000 + cuMarginBps) / 10,000` |
| 2 | `ComputeBudget` `SetComputeUnitPrice` | `TxSender`'s rule, capped by `SERVICES.landing.maxComputeUnitPriceMicroLamports` |
| 3 | pump `create_v2(name, symbol, uri, creator = FeeIn, is_mayhem_mode = false, 0, 0, 0)` | accounts: mint (s, w), `mint_authority`, `bonding_curve` (w), its $1PCT ATA (w), `global`, launch wallet (s, w), System, Token-2022, ATA program, Mayhem program (w), Mayhem `global_params`, `sol_vault` (w), `mayhem_state` (w), `mayhem_token_vault` (w), pump `event_authority`, pump. No quote accounts (SOL) |
| 4 | ATA `create_idempotent` (launch wallet's $1PCT account, Token-2022) | `buy_v3` does not create it |
| 5 | pump `buy_v3(amount = DEV_BUY, max_sol_cost = devBuyQuote(...))` | accounts: `global`, mint, wSOL, Token-2022, SPL Token, `bonding_curve` (w), its $1PCT ATA (w), its wSOL ATA (w, unused), launch wallet (s, w), its $1PCT ATA (w), its wSOL ATA (w, unused), `user_volume_accumulator` (w), curve fee config, one buyback fee recipient read from `Global` (w), System, pump `event_authority`, pump |
| 6 | ATA `create_idempotent` (the $1PCT vault: owner `vault_auth`, Token-2022) | |
| 7 | Token-2022 `transfer_checked(launch ATA → vault, DEV_BUY, 6)` | |
| 8 | `onepercent::power_on` | §6.1 |
| 9 | Token-2022 `close_account(launch ATA → launch wallet)` | the launch wallet ends with 0 $1PCT (acceptance 2) |
| 10 | System transfer to a Helius Sender tip account (static key, never in a lookup table) | `SERVICES.landing.tipLamports` |

**Launch lookup table.** Every account that is neither a signer nor a top-level program id nor the tip account: all are derivable from the vanity mint's public key, already public in `Config.token_mint`. `onepct-ops launch lut` creates it, extends it, waits one slot, then removes its authority (frozen), and records its address. The architect's measurement with an 80-character URI: 838 B with 9 static keys and 24 table keys (legacy 1,546 B). The command refuses a transaction above 1,232 B.

**Quote.** `max_sol_cost = devBuyQuote(Global, curve fee config, DEV_BUY)` (§10.2), read at build time; the simulation must pass with exactly that value. The dev buy's creator fee stays on the curve and reaches the stock through the fee chain (D27 floor regime).

### 12.2 The fallback: a 2-transaction Jito bundle from the same wallet

Used only when the single transaction cannot be built within 1,232 B (for example a longer URI): tx 1 = steps 1–5 (signers: wallet, mint); tx 2 = steps 1–2 and 6–9, then a Jito tip transfer to an account from `getTipAccounts`. Sent through the Block Engine `sendBundle`; the bundle runs in order and lands whole or not at all, and `power_on`'s `≥` slack check makes the split safe. The report states which form landed; the runbook discloses it (master §1: no hidden bundles).

### 12.3 Go/no-go checks (`onepct-ops launch check`)

Each prints GO, WARN or NO-GO with the value read. WARN lines go to the founder, who decides:
1. The four pump program deploy slots equal `fixtures/pump/programs.json`, the set the last rehearsal ran against. A change is WARN: the launch is one atomic transaction and `power_on` re-checks the mint and the curve, so a changed pump.fun can make the launch fail but cannot make it land unsafe. Re-run check 6, record the new slots; the founder decides whether to re-run the canary rehearsal.
2. `Global.create_v2_enabled == 1` (else NO-GO). `Global` initial reserves and the curve fee tier equal the recorded values, which set the dev-buy cost; a change is WARN and prints the new quote.
3. `Config.token_mint` = the mint key file's public key; the mint account does not exist yet; `Config.launch_wallet` = the wallet key file's public key.
4. `Machine.phase == StockUp`; FeeIn holds ≥ `rent_min(0)`.
5. The launch lookup table is active, frozen and holds exactly the expected addresses.
6. A mainnet simulation (`sigVerify: false`, `replaceRecentBlockhash: true`, post-state of the mint and the curve requested) succeeds; the simulated mint passes the TypeScript mirror of `mint_is_safe` (Token-2022, no authority, decimals 6, extensions exactly {18, 19}); the simulated curve has `creator` = FeeIn, both flags 0, `quote_mint` default, `is_holder_reward` 0; the simulated vault holds exactly `DEV_BUY` and the launch wallet's $1PCT account is closed.
7. The launch wallet holds at least the simulated spend plus fees and tip.
8. The rehearsal coin's extension set (from the canary rehearsal report) equals {MetadataPointer, TokenMetadata}.

MagicBlock queue health and Solana feature activations stay runbook checks (M6.6).

### 12.4 Commands

| Command | Does |
|---|---|
| `onepct-ops launch lut --cluster <c> --mint <pubkey> --wallet <keypair>` | §12.1 lookup table |
| `onepct-ops launch plan --cluster <c> --mint-keypair <f> --wallet <keypair> --uri <https URI> [--name --symbol]` | Builds both forms, prints instructions, accounts, sizes, the quote and the simulation; sends nothing |
| `onepct-ops launch check …` | §12.3 |
| `onepct-ops launch send … --confirm <first 8 chars of the mint> [--at <unix ts>]` | Re-quotes, rebuilds with a fresh blockhash, signs, simulates, sends (Sender, or the Jito bundle), confirms. `--at` waits for the chain clock. Before every resend it reads the mint account: if it exists and the phase is PoweredOn, it stops with success; if it exists and the phase is not PoweredOn, it stops and alerts. A second landing is impossible (`create_v2` fails on an existing mint) |
| `onepct-ops launch report` | Post-checks: phase PoweredOn, `accounted` = 40M, vault ≥ 40M, four slots Locked, `on_air_ts`/`end_ts`, the launch wallet's $1PCT = 0; writes `reports/launch/<cluster>-<UTC timestamp>.json` with every address to publish (master §6 rule 6) |

**Names.** On the mainnet program id, `--name`/`--symbol` must equal `TOKEN_1PCT.name`/`.symbol`. On any other cluster or program id (devnet, the canary), a name or symbol containing "onepercent" or "1pct" (case-insensitive) is refused (master §10: rehearsal coins never use Onepercent's name). The URI must be `https` and ≤ 200 characters; name ≤ 32 and symbol ≤ 13 characters (pump.fun's limits).

### 12.5 Rehearsals

- **Localnet**: `pnpm e2e:validator launch` (§13.6).
- **Devnet** (E4a, founder's go): `onepct-ops launch send --cluster devnet` with a neutral devnet coin, if V6 finds pump.fun on devnet; otherwise the localnet run stands for it.
- **Canary** (M6.5, T−1, founder-run): the same commands against the canary program with a throwaway coin. Its report feeds check 8.

### 12.6 Other ops commands

`onepct-ops fees collect [--cluster]` (one fee-chain transaction), `onepct-ops final start`, `onepct-ops final push [--limit]`, `onepct-ops final block0 --rebuild`. Devnet signs with `--keypair`; on mainnet these are permissionless, so any funded operator key may sign them.

---

## 13. Tests

### 13.1 Program named tests (LiteSVM harness, M1 §16.1; mainnet feature set where noted)

Fixtures: `inject.rs` gains `inject_power_on(token_mint, on_air_ts, end_ts)`, `inject_onepct(states)`, `inject_jackpot(tokens, cost)`, `fake_launch_curve(mint, creator, flags, quote, len)` and a Token-2022 mint builder with chosen extensions and authorities. Forced outcomes use randomness found by searching `reference::draw`.

**t17_power_on.rs**

| ID | Name | Then |
|---|---|---|
| T17.01 | `power_on_happy` | StockUp; Token-2022 mint {18, 19}, no authority, decimals 6; 166-byte curve, creator FeeIn; 40M moved by a top-level `transfer_checked` → `accounted` 40M; four slots `{10M, Locked}`; `token_mint` copied; timestamps; phase PoweredOn; `PoweredOn` |
| T17.02 | `only_launch_wallet_once` | other signer → `Unauthorized`; second call → `WrongPhase`; Setup, PoweredOn and OnAir → `WrongPhase` |
| T17.03 | `power_on_via_cpi_rejected` | through the mock VRF's `cpi_passthrough` → `NotTopLevel`; nothing written |
| T17.04 | `mint_safety` [acceptance 1] | mint ≠ `token_mint` → `AccountMismatch`; each of TransferHook, PermanentDelegate, Pausable, DefaultAccountState, TransferFeeConfig, NonTransferable, MintCloseAuthority, InterestBearing, ScaledUiAmount, PermissionedBurn, GroupPointer, an unknown type → `MintNotSafe`; mint authority set, freeze authority set, decimals 9 → `MintNotSafe` |
| T17.05 | `curve_checks` | wrong PDA, owner or discriminator → `NotPumpFun`; creator ≠ FeeIn, mayhem 1, cashback 1, quote USDC, quote wSOL, holder reward 1, length 81 or 124 → `NotLaunchCurve`; length 150 and 166 accepted |
| T17.06 | `slack_rule` [DG-2] | vault pre-funded by 1 unit → ok, `accounted` grows by exactly 40M; vault 40M − 1 → `SlackShort`; ledger injected with `accounted` 5 and vault 40M + 4 → `SlackShort` |
| T17.07 | `fee_in_topup` | rent switched to 6,960 → FeeIn topped up to `rent_min(0)` by the launch wallet; at 5,080 → no transfer |
| T17.08 | `prefunded_ledger_precreated_vault` [DG-7] | lamports donated to the ledger PDA; vault ATA created by a third party → ok |
| T17.09 | `season_timeline` | `on_air_ts` = `power_on_ts` + 900, `end_ts` = `on_air_ts` + 172,800; `advance_phase` at `on_air_ts` − 1 no-op, at `on_air_ts` → OnAir |

**t18_one_pct.rs** (acceptance 3)

| ID | Name | Then |
|---|---|---|
| T18.01 | `release_schedule` | every row of §7.1's table through `buy_packs` (`min_live_flags`) and the callback |
| T18.02 | `pull_one_pct` | forced `t < width`: card `{$1PCT, 10M, 0, kind 6}`; slot Pulled; ledger unchanged; `OnePctPulled`; `widths[0] = P / 1,000`; I14 |
| T18.03 | `holder_width` | `t` in `[P/1,000, 1.5·P/1,000)` wins for a holder Pull only |
| T18.04 | `two_cards_one_rip` (M4-A2) | card 1 released, card 0 pulled at pack 2 of an OG ×10 → a later pack of the same Pull can pull card 1; `Pull.live_flags` = OR |
| T18.05 | `live_until_snapshot` (Q1, decided D16) | Pull bought at `end_ts` − 5, revealed at `end_ts` + 5 (phase OnAir or BuysClosed) → card 0 still live, width `P / 1,000`; after `start_final_pull` no slot is live and the Jackpot width is 0. A source grep shows the callback and `math/specials.rs` never read `end_ts` |
| T18.06 | `promotion` | `advance_phase`, `buy_packs` and the callback promote Locked → Live once at the release time; never demote |
| T18.07 | `final_at_snapshot` | unpulled slots become Final; their amounts enter `pool_1pct` |
| T18.08 | `min_live_flags` | OnePct while live → ok; once pulled → `LiveFlagsChanged`; bit 2 (Spotlight) → `LiveFlagsChanged` always |

**t19_jackpot.rs** (acceptance 4)

| ID | Name | Then |
|---|---|---|
| T19.01 | `threshold_per_edition` | `jackpot_cost` = 15·P − 1 not live, = 15·P live, for each edition |
| T19.02 | `win_moves_whole_pot` | card `{$1PCT, jackpot_tokens, jackpot_cost, kind 5}`; both fields 0; `jackpot_sol` unchanged; ledger unchanged; I14 |
| T19.03 | `no_second_win_same_rip` | win at pack 3 of ×10 → packs 4–9 have `widths[2] = 0` |
| T19.04 | `jackpotbuy_then_win` | M2 JackpotBuy pairs (stub swap) raise the cost to ≥ 15·P → live → win → the leftover `jackpot_sol` converts into the next pot |
| T19.05 | `prize_cards_exits` | Jackpot and The 1% cards redeem; `sell_back` → `NotSellBackable`; `feed_back` → `NotFeedable` |

**t20_creator_fees.rs** (acceptance 6)

| ID | Name | Then |
|---|---|---|
| T20.01 | `regimes` | direct SOL transfer to FeeIn, collected in PoweredOn and OnAir: below 2 SOL book, 100% stock; at or above floor, 50/0/50, even above the stock target. BuysClosed, FinalPull and Done: 0/0/100, no stock or burn credit. OnAir at `end_ts` + 5 still uses the floor regime; collection never reads `end_ts` |
| T20.02 | `floor_boundary` | §7.2 exact boundary; counters and target do not select the regime; a floor-crossing collection uses its initial regime for the whole amount |
| T20.03 | `fee_in_keeps_rent` | FeeIn ends at `rent_min(0)`; after a rent rise FeeIn below it → `f = 0`, no failure |
| T20.04 | `wsol_unwrap` (M4-A3) | FeeIn's wSOL ATA holding 5,000,000: closed to the payer; exactly 5,000,000 reaches the Machine and is split; the payer nets the account's rent; an absent ATA, or lamports donated to its address before it exists (system-owned, no data), is skipped; any other account passed there → `AccountMismatch` |
| T20.05 | `before_power_on` | Setup, StockUp → `WrongPhase` |
| T20.06 | `exit_properties` | all five pause bits and every disabled role set → still works; through `cpi_passthrough` → works |
| T20.07 | `split_vectors` | §7.2 table byte-exact with the SDK |

**t21_final_pull.rs** (acceptance 7)

| ID | Name | Then |
|---|---|---|
| T21.01 | `start_rules` | before `end_ts` + 600 → `FinalPullNotDue`; a Pending Pull → `PullPending`; CPI from a StockSell swap slot → `ExecInFlight`; phase OnAir → `WrongPhase` |
| T21.02 | `snapshot` | `pool_sol = stock_sol + jackpot_sol`; both 0 after; `final_pool(b) = A(b)`; `pool_1pct` = unpulled + `jackpot_tokens`; slots Final; `jackpot_*` 0; `final_ts`; phase; event |
| T21.03 | `sol_shares` | ≥ 12 vectors, §7.3's included; Σ paid ≤ pool; remainder stays in `final_pool_sol` |
| T21.04 | `sol_payees` | live wallet read-only → `AccountMismatch`; program-owned or executable owner → lamports into the Binder and `sol_owed`, then `withdraw_owed` pays it; 0-lamport owner with a share below rent → `sol_owed` |
| T21.05 | `zero_share_sets_bits` (B8) | a Binder with `season_spend` 0 calls both claims → both bits set → `close_binder` ok |
| T21.06 | `token_cards` | cards for $1PCT and every non-empty bucket, in order; owner pays the slots; pools and `A(b)` decrease; each card redeems |
| T21.07 | `idempotent` | second call of each → no-op; two `claim_final_sol` for one Binder in one transaction |
| T21.08 | `claims_forever` | Done, a year later, all pause bits set → both claims work |
| T21.09 | `done_transition` | FinalPull → Done at `final_ts` + 259,200, not one second before |
| T21.10 | `late_redirect_after_snapshot` | a `settle` redirect after FinalPull credits `burn_sol` (A18) |

**t22_burn_after_done.rs**

| ID | Name | Then |
|---|---|---|
| T22.01 | `anyone_burns_in_done` | a random signer's Burn pair (stub swap) in Done burns Δ; tranche, spacing and hourly cap enforced |
| T22.02 | `done_ignores_pause_and_role` | BURN paused by admin and guardian, executor disabled → still ok in Done |
| T22.03 | `before_done_unchanged` | FinalPull, random signer → `Unauthorized`; BURN paused → `Paused` |
| T22.04 | `jackpotbuy_stays_closed` | JackpotBuy in Done → `WrongPhase` |

**t23_hygiene_m4.rs**

| ID | Name | Then |
|---|---|---|
| T23.01 | `pause_bits_grep` | readers unchanged (§2 rule 4) |
| T23.02 | `exit_structure` | the three new exits: no `Config`, no remaining accounts; `claim_final_sol`'s `owner` carries no `mut` |
| T23.03 | `top_level_grep` | `power_on`, `feed`, `exec_begin`, `exec_end` call the top-level check |
| T23.04 | `error_codes` | M1 and M2 codes unchanged (golden); `NotLaunchCurve`, `FinalPullNotDue` last |
| T23.05 | `no_spotlight` [acceptance 9] | no code path sets `LIVE_SPOTLIGHT`; `Machine.spotlight` bytes stay zero across P2; any Spotlight stub M1 shipped returns `NotImplemented` |
| T23.06 | `donations_m4` [DG-1] | lamports and tokens donated to FeeIn, FeeIn's wSOL ATA, the $1PCT ledger and vault before every M4 instruction → nothing fails; FeeIn donations are split as fees, never credited to a user |

### 13.2 Property suites (1,000 cases × 200 steps in CI; 10,000 at G4.1 and nightly)

| Suite | Content |
|---|---|
| **P2** (extended) | new operations: `power_on` (once, in setup), JackpotBuy and Burn pairs (stub swaps around `min_out`), warps across the release times, FeeIn donations + `collect_creator_fees`, forced special outcomes, `start_final_pull`, both claims, `advance_phase` to Done, Burn after Done. After every step: M1 §14, M2 §9 and §9 here (I14 exact, L1, CF1, I9) |
| **P4** `prop_p4_season.rs` | master §8.2: a whole season under warp. Setup → StockUp (feeds) → `power_on` → OnAir (random Rips, forced The 1% and Jackpot wins, executor pairs, fee collections, Sell backs, take-backs) → `end_ts` (BuysClosed, StockSells) → `start_final_pull` → every SOL and token claim → redeem and take back everything → Done → Burn after Done until `burn_sol` is too small for a tranche with `min_out > 0` → `team_withdraw`. Then: lamports conserved (C1), tokens conserved per mint except burns (C2), F1–F3 hold, every Binder can close, and the only SOL left in the Machine is rent, the untracked buffer, that last `burn_sol`, the disclosed rounding remainders and donations |
| **CR-1** (extended) | random bytes in `onepct[*]`, `jackpot_*`, `token_mint`, `on_air_ts`, `end_ts`, `final_*` with specials live; `Ok`, no panic |
| **M-REF** | `reference.rs` gains independent `live_flags`, `regime`, `split`, `final_share`; compared on random inputs including u64 extremes |

### 13.3 Callback matrix, logs and donations

- **T06.16 re-run (CR-4), mainnet feature set:** M1's matrix with The 1% and the Jackpot live, holder and non-holder, plus a forced special win in OG ×10 and AH ×5, at `DECK_MAX` and a 65,535-slot Binder. Callback ≤ 200,000 CU; fulfilment ≤ 270,000 CU; allocations ≤ 24 KiB.
- **T06.17 re-run (CR-5):** OG ×10 with a special win and its events ≤ 9,000 log bytes, no truncation.
- **CR-2, CR-3, CR-6** unchanged and re-run.
- **DG-2** is T17.06; DG-1 and DG-7 are T23.06 and T17.08.

### 13.4 Golden vectors (`app/fixtures/vectors/`)

`layouts.json` (carve), `ix.json` (five instructions; `claim_final_sol`'s `owner` read-only in the metas, the SDK override on top), `idl_constants.json`, `specials.json` (§7.1 table + ≥ 100 random cases), `creator_fee.json` (§7.2 + ≥ 100 random), `final_pull.json` (§7.3 + ≥ 100 random), `launch_curve.json` (curve byte strings accepted and rejected by §5.4). M4.2 adds `pump_ix.json` (each pump encoder's bytes and metas for fixed keys).

### 13.5 Services tests (Vitest; recorded fixtures; Postgres and Redis containers)

| Area | Tests |
|---|---|
| executor | table-driven plans (OnAir, after `end_ts`, hourly cap, spacing, `minTrancheLamports`, Done); every planned trade passes `checkExecBegin`; Jupiter `minOut` below the on-chain `min_out` → skipped; the transaction holds exactly two `onepercent` instructions, the `jitodontfront` key and the tip; `EXECUTOR_SWAP=stub` with `CLUSTER=mainnet-beta` → exit 1; foreign key → exit 1; role mismatch → no send |
| fee chain | composition per state (fresh curve, complete not migrated, migrated); the On Air transaction carries `collect_creator_fees` before `advance_phase`; the last-minute run happens once; nothing waiting → no send; FeeIn top-up when short; both alerts fire on fixtures |
| final keeper | start when due (with `advance_phase` when still OnAir); pushes are batched, keyed and idempotent; Done |
| HOLD | held ≥ 1M for 24 h → ok; a one-transaction dip → `not_held_24h`; account created inside the window → `not_held_24h`; tokens in a non-canonical account only → `below_min`; above `maxHistoryTx` → `history_too_long`; RPC failure → `evidence_unavailable`; refusals sign nothing; the log row precedes the response; expiry from block time with the local clock 30 s ahead; the 31st and 61st requests are limited; the message equals the Rust golden vector |
| Block-0 | fixture transactions → rows; team labels; idempotent rebuild |
| API | every new route parses with its schema; `/api/hold/attest` 404 with the flag off |
| launch CLI | `plan` output (instruction order, accounts, sizes ≤ 1,232 B, the quote vector of §10.2); the naming guard; `check` against fixtures; `send` refuses without `--confirm` |
| pump module | discriminators and account orders equal the stored IDL; layouts decode the mainnet fixtures |

### 13.6 End to end

| Run | What | Gate |
|---|---|---|
| `pnpm test:e2e` (npm litesvm) | adds: `power_on` on an injected StockUp state with a fake curve; a forced Jackpot win; `collect_creator_fees`; `start_final_pull` and both claims | every program PR |
| `pnpm e2e:validator launch` (M4.2) | `solana-test-validator` 4.3.0 with mainnet's active feature set (every feature not active in `fixtures/mainnet/features.json` deactivated, so pump.fun's mainnet binaries run as they do on mainnet), our v3 program in StockUp (exported state), and pump.fun loaded from `fixtures/mainnet/pump/`: the pump, PumpSwap, pump fees and Mayhem programs (`--bpf-program`), `Global`, the two fee configs, Mayhem `global_params` and `sol_vault`, PumpSwap `global_config`, a buyback recipient. Runs `onepct-ops launch lut`, `plan`, `send` and `report` against it; then a test wallet's `buy_v3`; then `onepct-ops fees collect` twice: the dev buy's and the test buy's creator fees reach `stock_sol`. If the validator cannot execute the dumped programs, stop and report | G4.2 |
| `pnpm e2e:validator season` (**E4b**) | exported OnAir state, mock VRF: forced The 1% pull and Jackpot win, Burn and JackpotBuy pairs, `end_ts` → BuysClosed → `start_final_pull` → claims → exported Done state → Burn after Done. M4.1 writes it with SDK-built stub swaps (M2 §13.1); M4.2 re-runs it with the executor service and its test-transfer adapter | G4.1, G4.2 |
| **E4a** devnet (founder's go) | `onepct-ops launch` with a neutral devnet coin, the keeper's fee chain, On Air at +900 s, Rips with real MagicBlock VRF, executor JackpotBuy and Burn tranches with the test-transfer adapter. If V6 finds no pump.fun on devnet, E4a runs on the validator of `e2e:validator launch` with the mock VRF, and real VRF stays covered by S2 and the canary (master §8.3) | G4.2 |

Master E4 = E4a + E4b: real VRF cannot be made to produce a Jackpot win or The 1% on demand, so those two outcomes are forced on the validator.

### 13.7 Reports (in each PR)

CU and size table: `power_on` alone and the whole launch transaction; the fallback pair; `collect_creator_fees` alone and the whole fee-chain transaction (each form of §11.2); `start_final_pull`; `claim_final_sol` ×1 and the largest batch that fits; `claim_final_tokens` with 17 cards; the T06.16 matrix with specials. `CU_LIMITS` gains `powerOn`, `launchTx`, `collectCreatorFees`, `feeChainTx`, `startFinalPull`, `claimFinalSol: {x1, xMax}`, `claimFinalTokens` (M1 §16.3 rule). `.so` size and flags.

---

## 14. Commands and CI

New scripts: `pnpm e2e:validator {launch, season}`, `pnpm --filter worker executor:dry-run`, `onepct-ops {launch, fees, final}`. CI job `program` adds the two validator flows; job `services` runs the new tests. No CI job reaches mainnet: the pump fixtures are files.

**The architect will run, from `app/`:**

```
pnpm install --frozen-lockfile && pnpm params:rs --check && pnpm lint:words
pnpm program:build && pnpm program:clippy && pnpm program:test && pnpm test:e2e
pnpm e2e:validator rip && pnpm e2e:validator feed && pnpm e2e:validator launch && pnpm e2e:validator season
PROPTEST_CASES=10000 pnpm program:test
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
docker compose up -d && pnpm --filter @onepercent/db migrate && pnpm --filter "./services/*" test
pnpm program:report && git diff --exit-code packages/sdk/src/idl fixtures/vectors packages/db/drizzle
```

---

## 15. Acceptance criteria (master §11.4 M4, numbered as there)

| # | Criterion | Evidence |
|---|---|---|
| 1 | `power_on`: launch wallet only, once, top-level; `mint == Config.token_mint`; curve origin with `creator == FeeIn`, no Mayhem, SOL quote; `mint_is_safe` (each forbidden extension and an authority → `MintNotSafe`); DG-2 | T17.01–T17.06 (T17.04 for the extensions, T17.06 for DG-2) |
| 2 | `onepct-ops launch`: the single v0 transaction (`create_v2`, the 40M buy, the vault ATA, the transfer, `power_on`); simulation against mainnet and the size check; the 2-transaction bundle fallback from the same wallet; the launch wallet ends with 0 $1PCT | §12; `e2e:validator launch`; `launch check` and `plan` on mainnet with the founder (G4.2); E4a |
| 3 | The 1%: card k live iff 0..k−1 Pulled and `now ≥ on_air_ts + REL[k]`; one live at a time; I14; unpulled cards Final at the snapshot | T18.01–T18.07; L1 and I14 in P2/P4 |
| 4 | JackpotBuy OnAir only, tranche ≤ min(`jackpot_sol`, 2 SOL, 1% of reserves), ≥ 20 s apart, `min_out` reserves − 100 bps; a win moves the whole pot and resets the cost; unconverted SOL stays | M2 T12.04, T12.10, T12.12 (regression); T19.01–T19.04; executor tests |
| 5 | Burn ≤ min(1 SOL, `burn_sol`, 0.25% of reserves), ≥ 20 s apart, ≤ 10 SOL per hour, then `burn_checked` | M2 T12.04, T12.10 (regression); T22.01; executor tests |
| 6 | FeeIn receives the creator fees; `collect_creator_fees` splits per PARAMS §13.4 | T20.01–T20.07; `e2e:validator launch` (fees reach `stock_sol`); Appendix A V4–V5 |
| 7 | Final Pull: `pool_sol = stock_sol + jackpot_sol`; $1PCT pool = unpulled cards + `jackpot_tokens`; floor shares that never expire; a zero share calls both claims and sets each bit; P4 | T21.01–T21.10; P4 at 10,000 cases |
| 8 | HOLD only for ≥ 1,000,000 $1PCT held continuously for 24 h; TTL ≤ 600 s | §13.5 HOLD tests; T05.11 (M1) for the on-chain TTL |
| 9 | No Spotlight; no state can make the segment live (CR-1) | T23.05; CR-1 |
| 10 | CR-1 to CR-6 with every segment live | §13.3 |
| 11 | E4 | E4a + E4b (§13.6) |

**Definition of done** (every PR): master §12; CI green; IDL, SDK, golden vectors and `drizzle/` regenerated and committed; `VERSIONS.md`, `README.md` and `.env.example` updated; no `TODO` without a milestone tag; `pnpm lint:words` clean.

---

## 16. Audit-gate checklist (the architect)

**G4.1 (M4.1, + `m4.1b`):**
- [ ] M1 and M2 layouts, sizes, seeds, error order and event fields unchanged; the carve exactly §5.1; size asserts; offsets in the vectors.
- [ ] `power_on`: top level, launch wallet, phase, mint, `mint_is_safe` + decimals, curve origin and the five launch fields, slack `≥`, exactly 40M credited, four slots, timestamps, FeeIn top-up, donation-safe ledger.
- [ ] Callback line by line again: per-pack liveness and promotion, holder width, The 1% pull, Jackpot win (whole pot, cost reset, `jackpot_sol` untouched), `HitSkipped` paths, totality, four accounts, no CPI; CR-1 to CR-6; CU and logs with specials.
- [ ] `buy_packs` `min_live_flags`; no Spotlight anywhere.
- [ ] `collect_creator_fees`: exit structure, regime by phase and never by `end_ts` (M4-A11), rounding, FeeIn kept rent-exempt, the wSOL leg measured and B3-style.
- [ ] The callback and `math/specials.rs` never read `end_ts`, a pause bit or `Config`.
- [ ] Final Pull: preconditions with `ExecInFlight`; snapshot; claims (floor, caps, idempotence, zero-share bits, payee rules, `sol_owed` backed by lamports); claims after Done; FinalPull → Done; `credit_stock` after the snapshot.
- [ ] Burn after Done: only kind 3 in Done skips role and pause; every bound intact.
- [ ] I1, I2, I9, I13, I14 (exact), F1–F3, CF1, L1 at 10,000 cases; P4.
- [ ] Reports, `CU_LIMITS`, the v3 artifact.

**G4.2 (M4.2):**
- [ ] Key isolation: executor, intake signer (HOLD), keeper each boot only with their own key; role guards stop sending on mismatch.
- [ ] Executor: `checkExecBegin` gate; Jupiter `minOut` ≥ on-chain `min_out`; two-instruction exec transactions; Sender tip and `jitodontfront`; random spacing; minimum tranche; no residue; the test-transfer adapter impossible on mainnet.
- [ ] Fee chain: exact instruction order and accounts; the On Air transaction; the last-minute run; both alerts.
- [ ] HOLD: rule vectors, insert-only log, nothing else written, rate limits, chain-clock expiry, refusal on any doubt.
- [ ] Final Pull keeper, Block-0, API schemas, SSE names, migration forward-only.
- [ ] Launch tool review with the founder: the instruction list, the lookup table, the size, the simulation, the go/no-go output, the naming guard, the fallback, the report.

---

## 17. Do NOT

**Scope and process**
- Implement anything for Spotlight (D1).
- Push to `main`; edit `docs/codex/*`, `AGENTS.md`, `apps/web/src/experience/`, the landing, or a path another PR owns (§1.2).
- Send a mainnet transaction from Codex's environment, or let CI reach the network or hold a mainnet key. The launch tool's mainnet commands are the founder's.
- Add `@pump-fun/pump-sdk`, a Jito or Helius SDK, or any package not already pinned.

**On-chain**
- Change an M1 or M2 layout, size, seed, discriminator, error code or event field; renumber anything.
- Let `power_on` run under CPI, credit more than the unclaimed slack, skip `mint_is_safe`, or accept a curve whose creator is not FeeIn, with Mayhem, cashback or holder rewards on, or a non-SOL quote.
- Give the callback a fifth account, a CPI, a token move or an `Err` after the identity check; read `Config` there.
- Make JackpotBuy permissionless, or skip any Burn bound after Done other than the role and the pause bit.
- Let anything credit `stock_sol` after the snapshot; let a claim pay more than its floor share or more than what remains.
- Read a pause bit, a role or an attestation in `collect_creator_fees` or the claims; give them `Config` or remaining accounts.
- Assert exact balances, pay out `lamports − rent`, or hard-code rent.

**Off-chain**
- Let the executor hold machine SOL outside an exec pair, trade outside `checkExecBegin`, or run the test-transfer adapter on mainnet.
- Sign a HOLD from a raw balance, from a client-supplied number, or without the 24 h history; record anything but the log row.
- Treat a pump.fun `creator` change as normal: it pages.
- Name a rehearsal coin after Onepercent; launch the mainnet coin under any other name or symbol.
- Value $1PCT anywhere as price × amount; label anything but an executable quote "if sold now".

**Words never shipped** (code, comments, strings, docs and tests under `app/`; the lists are in `app/packages/config/src/vocabulary.ts`): AGENTS.md lists 1–3 apply unchanged; the only exemption is the two pump.fun instruction names in `EXTERNAL_IDENTIFIERS` (§2 rule 8). No "ZK" anywhere.

---

## 18. Report back (in each PR)

1. Commands and results (§14), the base commit, new `VERSIONS.md` rows (none expected), the pump fixture slots and dates.
2. M4.1: the reports of §13.7, the measured `CU_LIMITS`, the 10,000-case runs, whether M1 shipped Spotlight stubs.
3. M4.2: the launch `plan` output for devnet and for mainnet (simulation only), measured sizes and CU; the E4a signatures; the fee-chain run; executor dry runs; HOLD vectors.
4. The result of every Appendix A "verify at M4 start" item, with the commands run.
5. Deviations, every place you stopped to decide, and the cross-lane edits of §1.2.

---

## Appendix A. Sources and verification

### A.1 Facts checked on 2026-10-08 (the architect)

- **pump.fun IDL and docs:** `github.com/pump-fun/pump-public-docs`, commit `2293f9a6` ("docs: SDKs to pump-sdk 4.0.0 and pump-rust-client 0.4.0", 2026-10-08 18:32 UTC) and `8cda1fa3` ("v3 / v2 trades, multi-hop swap, pump coins as quote mints, fee sweeps, synthetic migration", 2026-10-07): `idl/pump.json`, `idl/pump_amm.json`, `idl/pump_fees.json`; `docs/instructions/COIN_CREATION.md` (`create_v2` accounts and arguments; a SOL coin stores `quote_mint = Pubkey::default()`; name ≤ 32, symbol ≤ 13, URI ≤ 200), `TRADE_V3.md` (`buy_v3`, 17 accounts, fees kept on the curve), `SWEEP_FEES.md` (which instruction pays out the waiting creator fee, to where, and in which order), `COLLECT_CREATOR_FEE.md` (`collect_creator_fee_v2` and `collect_coin_creator_fee` are permissionless; the creator must not be executable or owned by pump fees), `CREATOR_FEE_SHARING.md`, `SYNTHETIC_MIGRATION.md`, `VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md`, `FEE_RECIPIENTS.md`, `BREAKING_FEE_RECIPIENT.md`.
- **Mainnet reads** (`api.mainnet-beta.solana.com`): program deploy slots and upgrade authorities of §4.2 (pump, PumpSwap and pump fees redeployed 2026-10-08 16:20 UTC); `Global` at slot 454,658,372; two fresh `create_v2` curves (166 B, `quote_mint` default, creator at @49); a graduated coin (mint `ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump`, curve 151 B, pool `7mQDGteiaD4Tkupg9hStyPQNeSTNTRaUEhh1zJ1awp8x`, 301 B) whose pool `coin_creator` equals its curve `creator`.
- **Read-only simulations** (`simulateTransaction`, `sigVerify: false`, `replaceRecentBlockhash: true`; nothing was sent):
  - **V3** `create_v2` with `creator` = the FeeIn PDA of the M1 program id, + ATA + `buy_v3(40,000,000,000,000, 1,176,185,869)`: success, 172,678 CU, 1,150 B legacy. Post-state: Token-2022 mint, 358 B, no mint or freeze authority, supply 10¹⁵, decimals 6, extensions exactly MetadataPointer (18) and TokenMetadata (19); curve 166 B, `creator` = FeeIn, Mayhem 0, cashback 0, quote default, holder reward 0, waiting creator fee 3,484,996, virtual quote 31,161,665,054; buyer account 40,000,000,000,000.
  - **V4** `[pump sweep_creator_fee][PumpSwap sweep_creator_fee][PumpSwap transfer_creator_fees_to_pump][pump collect_creator_fee_v2 (wSOL)]` on the graduated coin above (creator a plain wallet, no sharing config): success, 128,363 CU, 895 B legacy. `transfer_creator_fees_to_pump` alone also succeeded for that creator.
  - **V5** `[pump sweep_creator_fee][pump collect_creator_fee_v2]` on a fresh coin: success, 39,219 CU, 627 B; the creator vault ended at 650,240 lamports (`rent_min(0)`) and the creator received the rest.
- **Sizes** (Python serializer, same instruction sets): the single launch transaction 1,546 B legacy, 838 B v0 with one table (9 static, 24 table keys, 80-character URI); split 1,217 + 707 B legacy, 633 + 464 B v0.
- **Jito:** `docs.jito.wtf/lowlatencytxnsend/` (Block Engine URLs and paths, `getTipAccounts` and its 8 accounts `96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5`, `HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe`, `Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY`, `ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49`, `DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh`, `ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt`, `DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL`, `3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT`; ≤ 5 transactions, in order, all-or-nothing; minimum tip 1,000 lamports; `jitodontfront`; 1 request/s per IP per region).
- **Helius Sender:** `helius.dev/docs/sending-transactions/sender` (endpoints; tip and priority fee required; minimum tip 0.001 SOL, 0.000005 SOL with `swqos_only=true`; tip accounts `4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE`, `D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ`, `9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta`, `5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn`, `2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD`, `2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ`, `wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF`, `3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT`, `4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey`, `4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or`; `sendBundle` up to 4).
- **Project research:** `research/launchpads.md` (pump.fun ids, curve fields, fees, BOOST, admin powers), `research/token-flywheel.md` (creator-fee mechanics and pump.fun's admin powers), MODEL-SPEC §6.3–§6.10, §7.3–§7.4, §8.3, §8.5.

### A.2 Verify at M4 start (Codex; reads and simulations only)

| # | Check | Command | Expected; otherwise |
|---|---|---|---|
| V1 | IDL drift | fetch `idl/pump.json` and `idl/pump_amm.json` at pump-public-docs `main`; `sha256sum` | equal to §4.2; otherwise diff the seven instructions and two layouts M4 uses; any change → stop and report |
| V2 | Program versions | `solana program show <id> --url <mainnet RPC>` for the four programs | deploy slots of §4.2; otherwise record the new ones in `fixtures/pump/programs.json`, re-run V3–V5, report |
| V3 | Launch shape | `onepct-ops launch plan --cluster mainnet --simulate` with a random mint public key, a non-Onepercent name and the canary program's FeeIn | the A.1 V3 result |
| V4 | Fee chain, graduated | the §11.2 transaction (steps 2–5) for mint `ADPN2aq…` in simulation | success |
| V5 | Fee chain, fresh coin | steps 2 and 5 for any fresh SOL coin in simulation | success; the creator vault ends at `rent_min(0)` |
| V6 | pump.fun on devnet | `solana account 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf --url devnet` and `solana program show 6EF8… --url devnet` | present → E4a on devnet; absent → E4a on the validator (§13.6) |
| V7 | Landing | `getTipAccounts` on the Block Engine; the Sender page's minimums | equal to A.1; otherwise update `landing.ts` and report |
| V8 | FeeIn as a real creator | the canary rehearsal (M6.5): the first `collect_creator_fees` after its launch | `CreatorFeesCollected.amount > 0`; otherwise NO-GO for Power-On |
| V9 | Fixture dumps | `solana program dump <id> <file>.so` for the four programs and `solana account <address> --output-file <name>.bin` for the accounts of §13.6, each with a `.meta.json` (owner, lamports, executable) and the slot and date in `fixtures/mainnet/pump/SOURCE.md`; no base64 text (§3) | committed before `e2e:validator launch` |

---

## Amendments proposed to other docs

1. **Master §9.1 I14:** replace with the exact form of §9 (adds `final_pool_1pct`; "Final" slots live in that pool after the snapshot).
2. **Master §11.4 M4 acceptance 9:** "…`spotlight_deposit` and `spotlight_take_back` return `NotImplemented` if present; the M1 branch has none" (§6.8).
3. **Master §8.3 E4:** split into E4a (devnet, real VRF: Power-On, fee chain, On Air, Rips, executor tranches, burns) and E4b (validator, mock VRF: forced The 1% pull and Jackpot win, season end, Burn after Done).
4. **Master §3.4:** "$1PCT transfers, for the holder attestation and the Block-0 board" → "HOLD evidence log and Block-0 rows" (M4-A8). **Master §6:** the executor holds its own Jupiter key from the keeper's organisation (M4-A10); its wallet holds fee money only.
5. **`01-M1-BRIEF.md` §7.5, §9.9:** `Pull.live_flags` is the OR of per-pack flags (M4-A2). **`02-M2-BRIEF.md` §11.9** and **`03-M3-BRIEF.md` §14.1:** Verify recomputes each pack's widths from that pack's `PackRevealed.live_flags`; `/api/verify` and the `packs` table carry it (§11.6–§11.7).
6. **`02-M2-BRIEF.md` §12.3:** the landing helper is `packages/service-kit/src/landing.ts`, shared by K1, the executor and the launch tool (M4-A9). **§11.8:** `/api/hold/attest` is live from M4.2; the appended `MachineResponse` fields and SSE names of §11.6.
7. **`03-M3-BRIEF.md` §6.2 (`experience/contracts.ts`, the architect's):** `CardRow.edition` becomes `EditionId | null`, null for kind `final` (M4-A7). **§13.1:** Final cards carry no edition and value 0. **Web lane, due before `end_ts` (D37):** the Final Pull screen's claim buttons use `buildFinalClaimsTransaction` (§10.1).
8. **`PARAMS.md` issue 4:** the keys of §4.3 (with Q2's value once decided), the M4 `CU_LIMITS` keys; §13.4's chain row gets the exact sequence of §11.2 and `transfer_creator_fees_to_pump`, and its `afterEnd` row reads "from BuysClosed (set at `end_ts`)" (M4-A11); §11.2's "Unpulled at `end_ts`" reads "Unpulled when the Final Pull starts" (Q1's recommendation); §21 gains the pump layout facts of §4.2 (curve 166 B, offsets) and the Mayhem program id.
9. **`COPY.md` issue 2:** the holder line, if Q3's recommendation stands: "Held 1M+ $1PCT in your wallet's main $1PCT account for 24 h"; the creator-fee disclosure already covers the regime rule.
10. **`RUNBOOK.md` (M6.6):** T−1 `launch lut` (frozen) and `launch check`; T−10 min `launch check`; T0 `launch send --at`; `launch report` → publish every address; disclose the 2-transaction form if it was used; a `fee_in_creator_changed` page is a P0 incident.

---

## Open questions for the founder

Each has a recommended answer. The brief already builds the recommendation, marked **(decided, D16)**; changing it later is a one-line change before the RC freeze (D12).

**Q1. Can a pack bought just before buys close still win the Jackpot or The 1%?**
A Rip bought one second before `end_ts` is revealed a second or two later, after `end_ts`. PARAMS §11.2 says The 1% cards "unpulled at `end_ts`" go to the Final Pull; the master's acceptance says they become Final "at the snapshot" (the Final Pull start, at least 10 minutes later, once every pending pack is drawn).
- **(A) Recommended: yes.** Every pack bought during the season keeps the normal odds, specials included, until its draw lands (at most 5 minutes). Whatever is still unpulled when the Final Pull starts goes to the Final Pull. No new rule; the draw stays independent of the clock.
- (B) No: stop both specials at `end_ts`. The exit rules forbid the draw from reading `end_ts`, so this would have to follow the phase change, which someone triggers a few seconds after `end_ts`: two packs revealed in the same second could get different odds.
The difference is at most the packs revealed in the ~5 minutes after `end_ts`.

**Q2. What is the smallest tranche the executor sends?**
Every executor trade pays a landing tip of at least 0.001 SOL (Helius Sender) from the team's fee wallet. Tiny tranches waste tips; the leftover simply waits for the next pack sales. Conversions stop at `end_ts`, and unconverted Jackpot SOL joins the Final Pull's SOL pool at the snapshot (PARAMS §10, §6.4), and `burn_sol` keeps burning after the season.
- **(A) Recommended: 0.05 SOL** (the tip stays ≤ 2% of a tranche; the Jackpot still goes live at 1.5 SOL of conversions for The Original).
- (B) No minimum: convert every lamport, at a tip cost of up to ≈0.18 SOL per hour per kind.

**Q3. Which $1PCT counts for the holder ×1.5?**
"≥ 1M $1PCT held for 24 h" must be checked from history, never from a balance a wallet can rent for one transaction.
- **(A) Recommended: only the wallet's main $1PCT account** (the standard one every wallet and pump.fun use). Its history is complete and cheap to check, so the rule is exact. The copy says "in your wallet's main $1PCT account".
- (B) Every $1PCT account the wallet owns: harder to make complete (non-standard accounts can change owner without a transfer), so it needs a slower, provider-specific history search.
