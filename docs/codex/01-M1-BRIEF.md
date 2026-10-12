# Codex brief — M1: on-chain program core + `packages/sdk` + exhaustive tests (The 1% Machine)

Issued 2026-10-08 by the architect. **Start only after M0 (`00-M0-SCAFFOLD.md`, as amended by `00-MASTER-BRIEF.md` §0.3) has passed gate G0.**

This brief is self-contained for M1. Every rule M1 needs from the engineering spec (SPEC), `PARAMS.md` and the master brief is restated here. If anything is ambiguous, contradictory or impossible, **stop and report with options** (AGENTS.md). Do not guess.

---

## 0. Read this first

### 0.1 Authority

Master §0.1 applies. Highest first:

| # | Document | What it decides |
|---|---|---|
| 1 | `docs/codex/MODEL.md` | The mechanics, as validated by the founder. Nothing may add, remove or re-theme one |
| 2 | `docs/codex/PARAMS.md` | Every number: program, services, web, bot and copy. `app/packages/config` mirrors it |
| 3 | `docs/codex/00-MASTER-BRIEF.md` | Architecture, stack, environments, keys, conventions, tests, invariants and plan |
| 4 | The milestone brief in force (`NN-Mn-BRIEF.md`): **this brief** for M1 | The exact scope, layouts and acceptance criteria of one milestone |
| 5 | `docs/codex/00-M0-SCAFFOLD.md`, as amended in master §0.3 | Repo layout, tooling and conventions |
| 6 | `AGENTS.md`, then `docs/codex/COPY.md` (issued with M3) | Standing rules. COPY.md holds the only strings that may ship |

- The engineering spec (MODEL-SPEC v2) stays outside the repo. **"SPEC §x" marks provenance only; SPEC is not in the repo; this brief restates everything M1 needs.**
- `docs/project-context.md` describes the landing from before the pivot. For the app, `docs/codex/` supersedes it.
- When two documents disagree, or a spec is ambiguous or impossible: **stop and report with options**. Codex never decides an economic number, a mechanic, a visual or a public claim.
- AGENTS.md's "one milestone at a time" applies **per branch**: a branch carries exactly one milestone gate. Other lanes may run in parallel (master §11.3).

Two exceptions to the order, both granted by the master:
- **The §0.3 amendments are binding for M1**, including where they change `PARAMS.md` or the master. The architect made them deliberately, and master §0.3 D points to them.
- **This brief sets the program conventions and pins** (master §4.1, §7.1). Where the master still uses an older name for the same thing, follow this brief:

  | This brief | Master |
  |---|---|
  | `constants.rs`, `errors.rs`, `math/` | `consts.rs`, `error.rs`, `logic/` |
  | `CallbackSkipped` | `CallbackIgnored` |
  | LiteSVM 0.16.0 and the §3.2 crates | LiteSVM 0.7.1, `solana-sdk` 2.3.1 |
  | Tests T01–T11; suites P1, P2, CR-1, M-REF (mapping in §16.2) | T01–T13; P1–P3 |
  | `pnpm params:rs --check` | `config:check-rust` |
  | Report in §20 | "M1 §21" |
  | The amendment ids A1–A18 | "D1–D12" |

Any other disagreement: stop and report.

### 0.2 Scope versus the master plan

Master §0.4 maps the season's work to milestones. **M1 is one milestone:** the program core (config, vaults, Feed and the Deck, take-back) and the pack engine (packs, VRF, settle, royalties), plus Redeem, `packages/sdk`, the golden vectors and the tests. Everything §1.3 defers goes where master §0.4 assigns it:

| Deferred item | Milestone |
|---|---|
| The atomic executor core for StockBuy, StockSell, Burn and JackpotBuy; `sell_back`; `feed_back`; `withdraw_owed`; `close_binder`; the VRF queue-occupancy reader (API); the first services (intake and quote signers, indexer, keeper, `packages/db`, `packages/cli`) | M2 |
| The Verify page | M3 |
| `power_on` and FeeIn; The 1%; the Jackpot J-B win path; Spotlight; `collect_creator_fees`; the Final Pull; the permissionless burn after Done | M4 |

The end-to-end runs for this scope (master §8.3 E1, E2) are scoped in §16.6.

### 0.3 Amendments this brief makes (binding for M1)

| # | Amendment | Amends | Why |
|---|---|---|---|
| A1 | The Pull PDA is `["pull", buyer, pull_nonce u32 LE]`. A global `seq` is still assigned, stored in the Pull, used in the VRF seed and the draws, and used by the Verify URL | SPEC §8.2; PARAMS §16.1 (`["pull", seq u64]`) | With `seq` in the seeds, the client must predict `Machine.next_seq` at signing time. Any other buyer's Rip that lands first makes the transaction fail, so at launch concurrent Rips would fail at random. v1 already used `["receipt", payer, nonce]` |
| A2 | The FEED attestation signs `n ‖ bags_hash` (32 B) instead of the inline `(mint ‖ amount)×n` list | SPEC §8.6; PARAMS §6.3 | It saves 40 B per bag in the byte-tightest transaction we have. With the inline list, 2 bags do not fit the 15% headroom even with the lookup table (§15.4). Same security: the program recomputes the hash |
| A3 | The FEED nonce is a 16-slot sliding window in the Binder, not a strict counter | SPEC §3.2 H5; PARAMS §6.1 H5 | One approval sends up to 8 Feed transactions and wallets may land them in any order; with a strict counter every transaction after an out-of-order one fails. Replay stays impossible |
| A4 | H4 also requires the user's own top-level `TransferChecked`, earlier in the same transaction, and at most one `feed` per transaction | SPEC §3.2 H4 | With the slack check alone, a depositor holding an attestation could skip the transfer and claim donated tokens. "A donation never counts as a deposit" becomes literally true |
| A5 | Tests use a **mock VRF program loaded at the VRF program id**. There is no `test-vrf` cargo feature | none: master §5.1 says the same | The production binary is the one tested, with no feature at all, and the tests run the real request CPI and the real callback signer path |
| A6 | `ephemeral-vrf-sdk` 0.17.3 alone, with feature **`anchor-compat`**, not `anchor`. No `ephemeral-rollups-sdk` | M0 §3 (`ephemeral-rollups-sdk` with `anchor-compat` + `vrf`) | The VRF crate alone provides what M1 needs (§3.1). Verified on crates.io on 2026-10-08: in 0.17.3, `anchor` selects `anchor-lang ^1.0`; `anchor-compat` selects `>=0.28, <1.0`. Master §4.2 pins it this way |
| A7 | Feed packs as many bags as fit the byte budget, expected 1–2 per transaction without the lookup table and 2–3 with it, measured in M1 | SPEC §8.8; PARAMS `TX_LIMITS.feedBagsPerTx` 4 / ≈6 | Each bag needs 5 unique accounts (160 B) plus three per-bag instructions; arithmetic in §15.4. PARAMS and the UI copy take the measured figures (master §7.5 already defers to M1's measure) |
| A8 | Rent robustness: shrink-when-possible (Deck, Binder), `debit_open` caps, and an untracked Machine rent buffer passed to `initialize` (ops value 0.05 SOL) | fills a gap; SPEC §8.9 asks for 6,960-rate tests | A rent increase (SIMD-0438) must never make an exit or the callback revert |
| A9 | Card-slot refunds are the Binder's excess over its rent-exempt minimum; there is no per-slot stored deposit | SPEC §8.2 ("every account stores the deposit it was funded with") | A Binder has one payer, its owner, so its excess lamports can only be the owner's |
| A10 | MintLedger (80 B) stores no `version`/`bump`; Binder (112 B) stores no `version` | none in force (an earlier master draft asked every account for both fields; SPEC §8.2 lists neither) | PARAMS §16.1 fixes both sizes. The bumps are derived or stored elsewhere |
| A11 | The later creator-fee instruction is named `collect_creator_fees` | SPEC §8.3 and PARAMS §13.4 (`sweep_fees`) | "sweep" is a DA §3.4 trust-damaging word, and the CI vocabulary scan covers `app/**` |
| A12 | There are no build profiles. One `params.rs` serves every cluster; only `declare_id!` differs per cluster. The generator takes no profile argument | none: master §5.1 ("same source and same constants everywhere") | Odds, splits and prices must be the same on devnet, the canary and mainnet, so that what is tested is what ships |
| A13 | `params.rs` covers exactly the keys of the §4.3 table (`ONCHAIN_KEYS`), with the Rust types given there: every bps and ppb is `u32`. `constants.rs` only aliases `params.rs` values | PARAMS §0.3–§0.4 (keys chosen by their tag comments; "`u16` or `u32` as given") | Tags written as comments, with block inheritance, cannot be read by code, and some disagree with PARAMS' own tables. One type per kind of value avoids casts |
| A14 | `settle` and `refund_pull` take every payee (`buyer`, `referrer`, `wallet_0..3`), and `settle` its `binder_k`, as an `UncheckedAccount` **without** Anchor `mut`. The handler checks writability (`payee_check`, `creditable`, §8.1) | fills a gap (master DG-6) | The runtime silently makes a reserved key (a sysvar or builtin id) read-only, and may refuse a write lock on an executable account. A referrer bound to such a key from a crafted `?ref=` link, or a payee that later turns its address into a program, would make Anchor's `mut` check reject every `settle` of those packs: four depositors' royalties and refunds and the buyer's Pull rent would be stranded |
| A15 | `feed` must be a top-level instruction (`NotTopLevel`) | SPEC §3.2 H4 (completes A4) | A wrapper program could call `feed` twice by CPI inside one top-level instruction, so one `TransferChecked` would pass H4 twice and a donation could be credited |
| A16 | One `rotate_hour(now)` helper starts each new clock hour: it rolls the hit counters, sets `sb_paid_hour = 0` and `sol_at_hour_start = stock_sol` (§11.8) | X2 §6.5 (`sbHourIndex`, a field the layout does not have) | The hit counters and the Sell back fields share one `hour_index`. If the callback rotated it without resetting the Sell back fields, `sell_back` (M2) would never see a new hour, and the hourly budget would stay spent for the rest of the season |
| A17 | `take_back` and `redeem` emit `VaultShortfall` instead of reverting when `vault.amount < accounted` after their transfer | SPEC §8.3 ("assert `vault.amount ≥ accounted`" in both) | That check covers every user's claims on the mint, not the caller's own. One accounting bug would freeze every exit of that mint until a 12 h upgrade, and forever after sealing. The transfer itself still fails if the vault holds less than the amount |
| A18 | Final Pull tokens: one `claim_final_tokens` call (M4) writes the caller's card for every pool at once, from per-bucket pools frozen in `Bucket.final_pool` (§7.2), so the single "Final tokens claimed" bit suffices. From phase FinalPull on, an exit that would credit `stock_sol` credits `burn_sol` instead (`credit_stock`, §8.1) | SPEC §7.3 (`claim_final_tokens(owner, pool)`, one call per pool) | The final layout has one claimed bit for up to 17 pools (16 buckets and $1PCT): per-pool claims would strand every pool after the first. After the snapshot `stock_sol` has no exit, so a late `settle` redirect would be stranded |

A14, A15, A17 and A18 are guard rails the architect added after the M1 review. None adds or removes a mechanic or changes a validated number, and each is listed for the founder. Build them as written.

Clarifications (no document conflict):
- Buyers and depositors must be system-owned accounts (wallets) when they Rip or Feed, so that every payee starts creditable. A payee that stops being creditable later is handled by A14.
- `feed` also rejects team wallets on-chain (SPEC S5 enforces that off-chain only).
- A pack's backing bucket stays a valid carve source if the guardian disables it after purchase, so every drawn stock tier stays payable (§11.7).
- `settle` and `refund_pull` return `Ok` on closed Pulls and already-settled packs, so a client-prepended settle never fails a user's transaction.
- `take_back` and `redeem` take no mint argument; the mint account is matched against the record instead.

### 0.4 Founder decisions M1 relies on

All of SPEC §13 (C1–C23) was approved on 2026-10-08, with the Jackpot as **option J-B** (continuous pre-buy in $1PCT; PARAMS §10, §23). M1 implements C1, C8–C11, C13 (the widths only), C16, C19, C22 and C23. M1 never makes the Jackpot, The 1% or Spotlight live (§1.1).

---

## 1. Scope

### 1.1 In M1

**Program `onepercent`** (SPEC calls it `onepct`; same program):

| Group | Instructions |
|---|---|
| Setup and governance | `initialize`, `admin_config`, `admin_list_mint`, `guardian`, `advance_phase` (Setup→StockUp, PoweredOn→OnAir, OnAir→BuysClosed) |
| Depositors | `feed` (fresh bags from a wallet, with the intake attestation), `take_back` |
| Packs | `buy_packs` (escrow, dust and coverage reservation, MagicBlock VRF request), `consume_randomness` (VRF callback: split, tier draw, carve, 4 dust picks, card records), `settle` (royalties, referral, Pull close), `refund_pull` (300 s timeout) |
| My cards | `redeem` (every card kind) |
| Housekeeping | `team_withdraw`, `close_vault` |
| Kept from M0 | `ping` |

Also in M1:
- the generated on-chain parameter file (§4);
- a test-only mock VRF program (§10.6);
- the full Rust test suite, including the property suites (P1, P2, CR-1, M-REF: master §8.2's P1–P3), CR-1 to CR-6 and the DG suite (§16);
- `packages/sdk` (§15), with golden-vector conformance and a small TypeScript end-to-end suite.

In M1, **no special segment is ever live**. The 1%, Spotlight and Jackpot segments are structurally present (the draw takes live flags), but the live flags are always 0. The 5% Jackpot share still accumulates in `jackpot_sol` (tracked SOL). Nothing in M1 can reach `OnAir` on a real cluster, because `power_on` is M4; tests reach it by state injection (§16.1).

### 1.2 Declared now, implemented later (interface-first, master §11.3)

- **Account layouts are final.** Every field of SPEC §8.2 that later milestones need has its place now (§7): The 1% slots, Spotlight slot, executor record, J-B Jackpot fields, burn counters, the Final Pull pools (A18).
- **Stub instructions.** These are declared with a minimal `Accounts` struct (one `Signer`), and their handler returns `NotImplemented`: `power_on`, `feed_back`, `sell_back`, `exec_begin`, `exec_end`, `collect_creator_fees`, `start_final_pull`, `claim_final_sol`, `claim_final_tokens`, `spotlight_deposit`, `spotlight_take_back`, `withdraw_owed`, `close_binder`. Their accounts and arguments change when their milestone lands. `jp_deliver` no longer exists under J-B.

### 1.3 Deferred work

Each item goes to the milestone master §0.4 assigns (§0.2).

1. **M4.** `power_on`:
   - checks on the pump.fun BondingCurve creator, Mayhem flag and quote mint;
   - the 40M $1PCT ledger;
   - The 1% slots;
   - `power_on_ts`, `on_air_ts` and `end_ts`.
2. **M4.** The 1% segment:
   - release at 0 / 42 / 84 / 126 h;
   - `one_pct` cards;
   - the holder ×1.5 effect (M1 already verifies and stores the holder flag).
3. The Jackpot under J-B:
   - **M2:** the JackpotBuy executor kind;
   - **M4:** liveness `jackpot_cost ≥ 15 × price` and `jackpot` cards (the win path).
4. **M4.** Spotlight.
5. **M2.** The atomic executor (StockBuy, StockSell, Burn, JackpotBuy) with Pyth and PumpSwap `min_out`. In M1, bucket stock enters only through test state injection.
6. **M2.** `sell_back`, `feed_back`.
7. **M4.** `collect_creator_fees` and the creator-fee routing.
8. **M4.** The Final Pull (A18), the BuysClosed→FinalPull→Done transitions, and the permissionless burn after Done.
9. **M2.** `withdraw_owed`, `close_binder`. `close_binder` must also require `reserved == 0` (no Pending Pull). Otherwise a buyer could close the Binder under a Pending Pull: the callback would skip (reason 8) and the Rip would become a refund. That is a free reroll, and it locks 15 × price of coverage per pack for 300 s.
10. **M2.** Off-chain services (intake and quote signers, keeper, indexer), and the VRF queue-occupancy reader.

### 1.4 Work order (about 4 days)

| Day | Deliverables |
|---|---|
| 1 | §4.1 applied (PARAMS §22, config exports, `ONCHAIN_KEYS`, web3.js 1.99.0); `pnpm params:rs`; §7 layouts with compile-time size asserts and the stub instructions (the interface-first commit); §8 helpers; `initialize`, `admin_config`, `admin_list_mint`, `guardian`, `advance_phase`, `feed`, `take_back`, `close_vault`; Rust harness; T01–T04 |
| 2 | Mock VRF program (§10.6); `buy_packs`; `consume_randomness` with the pure `math/` functions and an independent reference implementation in tests; T05–T06 |
| 3 | `settle`, `refund_pull`, `redeem`, `team_withdraw`; T07–T11; property suites; CU, size and log reports; `CU_LIMITS` |
| 4 | `packages/sdk`; golden vectors; TypeScript unit and e2e tests; validator and devnet scripts (§16.6); CI; README / VERSIONS; PR report |

---

## 2. Rules for this milestone

1. Branch `feat/m1-program-core` from `main`. Open a PR. **Never push to `main`.**
2. Change only `app/**` and `.github/workflows/app.yml`. The landing stays byte-identical (M0 §1 rule 2).
3. Keep every version M0 pinned (as amended by master §0.3). Add only the dependencies in §3, at exact versions, respecting the 14-day release-age rule (master §0.3 C). Record each one in `app/VERSIONS.md` with its publish date and source.
4. No secrets, keypairs or private keys in git. Tests generate keypairs at runtime.
5. Program code:
   - no `unwrap()`, `expect()`, `panic!`, unchecked indexing, or `as` truncation that can fail at runtime;
   - crate-level clippy denies: `unwrap_used`, `expect_used`, `panic`, `indexing_slicing`. They take effect only when clippy runs: `pnpm program:clippy` (§17) runs in CI and is part of the DoD. Only `#[cfg(test)]` modules may `#[allow]` them;
   - additionally, `arithmetic_side_effects` is denied in the callback module and in every exit (master §7.1, Arithmetic);
   - entry instructions (`feed`, `buy_packs`, admin) use checked arithmetic and return `MathOverflow`;
   - **exits and the callback use saturating arithmetic and have no arithmetic error path**;
   - the release profile keeps `overflow-checks = true`.
6. No floating point on-chain. Time is `Clock::unix_timestamp` in seconds; never count slots for a duration.
7. Every value `PARAMS.md` lists (economics, sizes, tags, domains, external ids) comes from `app/packages/config` through the generated `params.rs` (§4.3). `constants.rs` holds only what PARAMS does not list (PDA seeds, enum codes, `MAX_FEED_BAGS`, a few ids) and aliases of `params.rs` values, never a second literal for the same value (A13).
8. No test-only code, cargo feature or mock inside the program crate (A5).
9. **Exits take no remaining accounts** (master §7.1). Elsewhere, every remaining account is fully validated: owner, seeds or address, discriminator.
10. Only `feed` and `buy_packs` read pause bits in M1. A grep test enforces it (§16.2 T11.04).
11. Every state change emits an event (§12).
12. Names per AGENTS.md and DA (X-ray, Feed, Rip, Pull, Redeem, Sell back, Keep, My cards, Dust Card, Silver / Blue / Holo / Black Foil, Jackpot, The 1%, House Card, 1% TV). Forbidden words: §19.

---

## 3. Toolchain and dependencies

### 3.1 Program toolchain and crate (`app/programs/onepercent/Cargo.toml`)

- **Solana CLI (Agave) 4.3.0 and Anchor 0.32.2, sBPFv3 output** (master §0.3 A). Solana's sBPFv3 page lists Anchor 0.32.2 as building v3 with a plain `anchor build`. If yours does not, use `anchor build -- --arch v3` (the arguments after `--` go to `cargo build-sbf`), and record the exact command in `VERSIONS.md`.
- **Flag check.** `node scripts/check-sbf-flags.mjs <file.so>…` checks each file's ELF64 header (magic `7f 45 4c 46`, class 2, little-endian) and requires its `e_flags` field (bytes 48–51, u32 LE) to equal 3. Otherwise it exits non-zero and names the file. It replaces master §0.3 A's `readelf -h`, which needs binutils (macOS has none). `program:build` and CI run it on `onepercent.so` and `mock_vrf.so`.
- **Verified builds.** `solana-verify` 0.5.2, with `[workspace.metadata.cli] solana = "4.3.0"` in `app/Cargo.toml`: `solana-verify build --cargo-build-sbf-args="--arch v3"`.

| Crate | Version / features | Why |
|---|---|---|
| `anchor-lang` | `=0.32.2` | master §0.3 A. Its `solana-*` dependencies are the 2.x crates |
| `anchor-spl` | `=0.32.2`; features `token`, `token_2022`, `associated_token`; pass `idl-build` through | `transfer_checked`, `burn_checked`, `close_account`, `TokenAccount` / `Mint` interfaces, `spl_token_2022` v8 types |
| `ephemeral-vrf-sdk` | `=0.17.3`, `default-features = false`, `features = ["anchor-compat"]` (A6) | MagicBlock VRF. Do not add `ephemeral-rollups-sdk`: the VRF crate alone provides what M1 needs |

`ephemeral-vrf-sdk` 0.17.3 (crates.io, 2026-09-24; newest on 2026-10-08) provides:
- `ephemeral_vrf_sdk::anchor::{vrf, vrf_callback, VrfProgram}`;
- `ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams}`;
- `ephemeral_vrf_sdk::types::SerializableAccountMeta`;
- `ephemeral_vrf_sdk::consts::{VRF_PROGRAM_ID, DEFAULT_QUEUE, DEFAULT_TEST_QUEUE, scoped_vrf_identity}`.

With `anchor-compat` it also pulls `solana-program 3.0.0` (MSRV 1.81, edition 2021) next to Anchor's 2.x crates; that is expected. If the build fails, **stop and report the exact compiler error**. Do not change Anchor's version yourself.

Cargo features of the program: exactly the M0 set, which Anchor's macros reference: `default`, `cpi`, `no-entrypoint`, `no-idl`, `no-log-ix-name`, `idl-build`, `anchor-debug`, `custom-heap`, `custom-panic`. Only `idl-build` changes: `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]`. Add no other feature (A5).

### 3.2 Rust test dependencies (dev-dependencies of the program crate)

| Crate | Version | Note |
|---|---|---|
| `litesvm` | `=0.16.0`, feature `precompiles` | 2026-08-24. Supersedes master §4.2's 0.7.1 (master §4.1 lets this brief pin more precisely): 0.16.0 runs the Agave 4.2 runtime, so it executes sBPFv3. `precompiles` is required for the Ed25519 checks. 0.17.0 is allowed from 2026-10-12 (age rule) |
| `proptest` | `=1.11.0` | Property and state-machine tests |
| `solana-keypair`, `solana-signer`, `solana-transaction`, `solana-message`, `solana-instruction`, `solana-address` | exactly the versions `litesvm 0.16.0` resolves in `Cargo.lock` | litesvm uses the solana 3.x / 4.x types |
| `serde`, `serde_json` | any 1.x already in the lockfile | Golden vectors and fixtures |

**Type bridge.** Anchor 0.32.2 uses `solana-pubkey` / `solana-instruction` 2.x; litesvm 0.16.0 uses `solana-address` 2.6 / `solana-instruction` 3.4. Write `tests/common/conv.rs`:
- `addr(&Pubkey) -> Address` through `to_bytes()`;
- `ix(anchor Instruction) -> solana_instruction::Instruction`, mapping the program id, the metas and the data.

Build every test transaction with the litesvm-side crates. The Ed25519 instruction is built by hand from its byte layout (§8.6), exactly as the SDK does.

### 3.3 Mock VRF program (`app/test-programs/mock-vrf`, its own cargo workspace)

- A native program on `solana-program = "=2.3.0"` (sBPFv3-capable per Solana's upgrade page), with `borsh = "0.10"`.
- Built with the same CLI: `cargo build-sbf --arch v3` (§17 `mockvrf:build`).
- Never deployed; absent from `Anchor.toml` `[programs.*]`.

### 3.4 TypeScript (`packages/sdk`)

| Concept | Pin (master §0.3 B, §4.2) |
|---|---|
| Client | `@solana/web3.js` 1.99.0 with `@anchor-lang/core` 0.32.2 (`BorshCoder` from the IDL). `@solana/kit` is not used in Season 1. M0 shipped `@solana/web3.js` 1.98.4 and `@coral-xyz/anchor` 0.32.1: M1 moves the whole workspace (§4.1 item 5) |
| SPL helpers | `@solana/spl-token` 0.4.15 |
| TS LiteSVM for e2e | `litesvm` 0.8.0 (npm; depends on `@solana/web3.js ^1.98.4`). If it cannot execute the sBPFv3 build, use the fallback of §16.5 |
| Tests | Vitest (as M0 chose); `fast-check` 4.10.2 where a property test helps |

Dynamic account tails (Deck entries, Binder cards, Pull packs) are decoded by hand-written codecs (§15.3).

---

## 4. Parameters

### 4.1 First commit of M1

1. **Parameters.** Apply `PARAMS.md` §22 to `app/packages/config`: the values that change, the fields and blocks added, the target content of §22.4, and the `validateParams()` additions of §22.5. PARAMS §22.4 "replaces the M0 §6 constants": replace **only those blocks**.
2. **Other lanes' sections.** Parallel lanes may already have added marked sections to `packages/config/src/index.ts`. Keep each one **byte-identical**, wherever it sits in the file:
   - X2: from `// ===== BEGIN X2 MARKET SECTION` to its END marker (X2 §4);
   - X4: the re-export line between `// --- X4 crosschain: begin ---` and `// --- X4 crosschain: end ---` (X4 §1 rule 2).

   If X2 merged first, its section holds `X2_PENDING_M1`, a temporary copy of some PARAMS values. Delete `X2_PENDING_M1`, re-point `packages/market/src/params.ts` to the M1 exports (X2 §4: "a one-file change"), and list both changes in the PR. These are the only edits M1 makes in another lane's files.
3. **Config exports.** Make `@onepercent/config`'s `package.json` exports match `@onepercent/sdk`'s: `"types": "./src/index.ts"`, `"development": "./src/index.ts"`, `"import": "./dist/index.js"`. On a clean checkout, `pnpm typecheck` and `pnpm params:rs --check` then work before any build.
4. **Generator.** Add `ONCHAIN_KEYS` to `packages/config`, then `pnpm params:rs` and `pnpm params:rs --check` (§4.3).
5. **Solana TS client.** Move the whole workspace (root `package.json`, `packages/sdk`, `tests/`) to `@solana/web3.js` 1.99.0, and replace `@coral-xyz/anchor` 0.32.1 with `@anchor-lang/core` 0.32.2 (master §0.3 B), which pins web3.js 1.99.0 exactly. `pnpm-lock.yaml` then holds one version of each. The X lanes pin "the version `main` pins", so after M1 merges they rebase and regenerate `pnpm-lock.yaml` with `pnpm install`.

`CU_LIMITS` is added on day 3, once measured (§16.3).

### 4.2 Values M1 uses (all from PARAMS; aliases used in this brief)

| Alias in this brief | PARAMS key | Value |
|---|---|---|
| `PRICE[E]` | `PACK_EDITIONS[].priceLamports` | 100_000_000 / 250_000_000 / 500_000_000 / 1_000_000_000 lamports (OG, BS, SG, AH) |
| `MAX_QTY[E]` | `PACK_EDITIONS[].maxPerRip` | 10 / 10 / 10 / 5 |
| `MAX_LIST` | `MAX_LIST_PER_RIP_LAMPORTS` | 5_000_000_000 |
| `ROYALTY_BPS`, `JACKPOT_BPS`, `BURN_BPS`, `REFERRAL_BPS`, `TEAM_BPS` | `PACK_SPLIT_BPS.{royaltyPerDustCard, jackpot, burn1pct, referral, team}` | 200 (×4), 500, 500, 200, 800. The stock gets the remainder (7_200) |
| `VALUE_BPS[k]` (k = card kind 1–4 → `HIT_TIERS[k − 1]`) | `HIT_TIERS[].valueBps` | Silver 5_000 · Blue 15_000 · Holo 40_000 · Black 150_000 (0.5× / 1.5× / 4× / 15×) |
| `MAJOR_ONLY[k]` (same indexing) | `HIT_TIERS[].majorOnly` | Silver false · Blue false · Holo true · Black true |
| `BLACK_PPB`, `HOLO_PPB` | `HIT_ODDS.blackPpb`, `.holoPpb` | 2_500_000, 20_000_000 |
| `BLUE_PPB[E]` | `HIT_ODDS.bluePpb.{edition}` | 113_925_000 / 114_187_500 / 114_625_000 / 115_500_000 |
| `JP_DIV`, `C_DIV`, `S_DIV` | `HIT_ODDS.jackpotPriceDivisor`, `.onePctPriceDivisor`, `.spotlightPriceDivisor` | 400, 1_000, 500 (widths computed in M1; live from M4) |
| `HOLDER_BPS` | `TOKEN_1PCT.holderTier.onePctOddsMultiplierBps` | 15_000 (effect from M4) |
| `JP_MIN_MULT` | `JACKPOT.minPotPriceMultiple` | 15 (M4) |
| `COVERAGE_BPS` | `COVERAGE.perPackValueBps` | 150_000 (= 15 × price) |
| `DUST_BUFFER` | `COVERAGE.dustBuffer` | 50 |
| `DECK_MAX` | `COVERAGE.deckMax` | 120_000 |
| `FRESH_CAP` | `FEED_RULES.freshCapPerWallet` | 25 |
| `MAX_DECIMALS` | `FEED_RULES.maxMintDecimals` | 9 |
| `FEED_TTL`, `HOLD_TTL` | `ATTESTATIONS.feedTtlSeconds`, `.holdTtlSeconds` | 120, 600 s |
| `VRF_TIMEOUT` | `VRF.timeoutSeconds` | 300 s |
| `MAX_QUEUES` | `VRF.maxQueues` | 4 |
| `MAX_BUCKETS`, `TREND_MAX` | `STOCK.maxBuckets`, `.trendingMaxCount` | 16, 4 |
| `MAX_TEAM_WALLETS` | `GOVERNANCE.maxTeamWallets` | 8 |
| `PAUSE_*` | `PAUSE_BITS` | rip 1 · feed 2 · sellBack 4 · stockBuy 8 · burn 16 |
| sizes | `ACCOUNT_SIZES.*` | deckHeader 64, deckEntry 80, binderHeader 112, cardSlot 56, pullHeader 176, pullPerPack 200, mintLedger 80 |
| tags | `DRAW_TAGS.*`, `ATTESTATIONS.*Domain` | `1pct:tier:v1`, `1pct:dust:v1`, `1pct:bucket:v1`, `1pct:vrf:v1`, `1pct:roy:`, `1PCT-FEED-v1`, `1PCT-HOLD-v1` |
| `MAX_FEED_BAGS` | **[A] new constant, see below** | 6 |

`MAX_FEED_BAGS` (6) is the program's hard bound on bags per `feed` instruction. It is not an economic value; put it in `constants.rs`, not in `packages/config`.

Odds in M1: with no special segment live, Silver = 10⁹ − Black − Holo − Blue, and the stock EV is 72% + 0.5 × (pJ + pC) (PARAMS §4.4: 72.0175% for OG … 72.1750% for AH).

### 4.3 Generated Rust and parity (A13)

**Generator.** `pnpm params:rs` runs `tsx scripts/params-rs.ts`. It imports `packages/config/src/index.ts` directly, so no build step comes first, and writes `app/programs/onepercent/src/params.rs` (header `// GENERATED from packages/config — do not edit`, committed). `pnpm params:rs --check` regenerates in memory and fails on any difference. There is no profile argument (A12).

**Which keys: `ONCHAIN_KEYS`.** `packages/config` exports `ONCHAIN_KEYS`, a list of `{ path, type }` entries whose content is exactly the table below. The generator emits those keys and nothing else. It never parses tag comments, so a key outside the list is never emitted, whatever its tag says. The list covers every compiled key, including those the program first uses in M2 or M4, so later milestones only append rows. Three `CONFIG`-tagged keys are included because they fix array lengths in the account layouts: `VRF.maxQueues`, `GOVERNANCE.maxTeamWallets` and `GOVERNANCE.guardianCount`.

**Rust types:**
- `bigint` (lamports, token base units) → `u64`;
- bps, ppb, divisors and multiples → `u32` (also where PARAMS writes `u16`);
- seconds → `i64`;
- counts, sizes and decimals → `u32`;
- booleans → `bool`;
- `PAUSE_BITS` → `u8`;
- per-edition values (`PACK_EDITIONS[].x`, `bluePpb.{edition}`) → `[T; 4]` indexed by `PACK_EDITIONS[].index`;
- per-tier values (`HIT_TIERS[].x`) → `[T; 4]` indexed by the `HIT_TIERS` position (card kind − 1);
- other fixed lists of numbers → `[T; N]` in list order;
- tags, domains and seeds → `&[u8]` byte strings (`b"1pct:tier:v1"`);
- `…Hex` strings → `[u8; N]` of the decoded bytes;
- base58 ids → `Pubkey`, through `pubkey!`.

The generator fails when a value does not fit its type.

**Rust names.** The key path in SCREAMING_SNAKE case: `.` becomes `_`, a word break goes before each capital letter, `[]` and `.{edition}` are dropped, and a trailing `Hex` is dropped. Examples: `HIT_ODDS.blackPpb` → `HIT_ODDS_BLACK_PPB`; `PACK_EDITIONS[].priceLamports` → `PACK_EDITIONS_PRICE_LAMPORTS`; `HIT_ODDS.bluePpb.{edition}` → `HIT_ODDS_BLUE_PPB`; `PACK_SPLIT_BPS.burn1pct` → `PACK_SPLIT_BPS_BURN1PCT`; `PUMP_LAYOUTS.bondingCurveDiscriminatorHex` → `PUMP_LAYOUTS_BONDING_CURVE_DISCRIMINATOR`.

| `ONCHAIN_KEYS` path | Rust type |
|---|---|
| `LAMPORTS_PER_SOL` | `u64` |
| `BPS_DENOMINATOR`, `PPB_DENOMINATOR` | `u32` |
| `PACK_EDITIONS[].priceLamports` | `[u64; 4]` |
| `PACK_EDITIONS[].maxPerRip` | `[u32; 4]` |
| `MAX_LIST_PER_RIP_LAMPORTS` | `u64` |
| `CARDS_PER_PACK.{dust, hit}` | `u32` |
| `PACK_SPLIT_BPS.{stock, royaltyPerDustCard, jackpot, burn1pct, referral, team}` | `u32` |
| `HIT_TIERS[].valueBps` | `[u32; 4]` |
| `HIT_TIERS[].{majorOnly, sellBack}` | `[bool; 4]` |
| `HIT_ODDS.{blackPpb, holoPpb, jackpotPriceDivisor, onePctPriceDivisor, spotlightPriceDivisor, calibratedStockEvBps}` | `u32` |
| `HIT_ODDS.bluePpb.{edition}` | `[u32; 4]` |
| `DRAW_TAGS.{tier, dust, bucket, vrfSeed, royaltyMemoPrefix}` | `&[u8]` |
| `COVERAGE.{perPackValueBps, dustBuffer, deckMax}` | `u32` |
| `FEED_RULES.{freshCapPerWallet, maxMintDecimals}` | `u32` |
| `ATTESTATIONS.{feedTtlSeconds, holdTtlSeconds}` | `i64` |
| `ATTESTATIONS.{feedDomain, holdDomain, sellBackDomain}` | `&[u8]` |
| `STOCK.{maxBuckets, trendingMaxCount, majorMinOutSlipBps, trendingShareMaxBps, trendingPoolFeeAllowanceBps, trendingMinOutSlipBps, pythMaxConfBps}` | `u32` |
| `STOCK.{targetBaseLamports, majorTrancheMaxLamports, trendingTrancheMaxLamports, trendingHourlyMaxLamports}` | `u64` |
| `STOCK.pythMaxAgeSeconds` | `i64` |
| `SELL_BACK.{payoutBps, hourlyBudgetBpsOfStockSol}` | `u32` |
| `SELL_BACK.{solFloorLamports, hourlyBudgetMinLamports}` | `u64` |
| `SELL_BACK.quoteTtlSeconds.{major, trending}` | `i64` |
| `JACKPOT.{minPotPriceMultiple, trancheMaxBpsOfQuoteReserves, minOutSlipBps}` | `u32` |
| `JACKPOT.trancheMaxLamports` | `u64` |
| `JACKPOT.trancheMinSpacingSeconds` | `i64` |
| `TOKEN_1PCT.{decimals, onePctCardCount}`, `TOKEN_1PCT.holderTier.onePctOddsMultiplierBps` | `u32` |
| `TOKEN_1PCT.{devBuyAmount, onePctCardAmount}` | `u64` |
| `TOKEN_1PCT.onePctReleaseOffsetsSeconds` | `[i64; 4]` |
| `SPOTLIGHT.windowSeconds` | `i64` |
| `SPOTLIGHT.minDepositBpsOfSupply` | `u32` |
| `BURN.{trancheMaxBpsOfQuoteReserves, minOutSlipBps}` | `u32` |
| `BURN.{trancheMaxLamports, hourlyMaxLamports}` | `u64` |
| `BURN.minSpacingSeconds` | `i64` |
| `CREATOR_FEE_SPLIT_BPS.{belowFloor, season, afterEnd}.{stock, burn, team}` (9 constants; D27 supersedes the original M1 table) | `u32` |
| `STOCK.creatorFeeFloorLamports` (D27) | `u64` |
| `SEASON.{durationSeconds, onAirDelaySeconds, finalPullDelaySeconds, sealDelaySeconds}` | `i64` |
| `VRF.timeoutSeconds` | `i64` |
| `VRF.maxQueues` | `u32` |
| `ACCOUNT_SIZES.{deckHeader, deckEntry, binderHeader, cardSlot, pullHeader, pullPerPack, mintLedger}` | `u32` |
| `PAUSE_BITS.{rip, feed, sellBack, stockBuy, burn}` | `u8` |
| `GOVERNANCE.{maxTeamWallets, guardianCount}` | `u32` |
| `PROGRAM_IDS.*` (all ten), `WSOL_MINT` | `Pubkey` |
| `PUMP_LAYOUTS.{bondingCurveSeed, poolSeed}` | `&[u8]` |
| `PUMP_LAYOUTS.{bondingCurveDiscriminatorHex, poolDiscriminatorHex}` | `[u8; 8]` |

**Never emitted.** These are off-chain only, or the program encodes them structurally:
- `RENT_*`; `PACK_EDITIONS[].{index, id, code, name}` (`index` is the array position); `HIT_TIERS[].{id, label}`;
- `CARD_KINDS`, `HIT_ODDS.walkOrder` and `SELL_BACK.eligibleKinds`: the program encodes them as the §6.3 codes, the §11.3 walk and `HIT_TIERS_SELL_BACK`, checked by the golden vectors and T06.22 (`onchain-keys.test.ts` also checks that `eligibleKinds` lists exactly the tiers with `sellBack`);
- `FEED_RULES.{launchpads, holdRule, oneCardPerWalletPerMint, allowedToken2022Extensions, sellDefaultAboveLamports, confirmAboveLamports}`. H1 uses `PROGRAM_IDS.pumpFun` and `PUMP_LAYOUTS`; the extension allow-list is the codes 18 and 19 (T02.10);
- `TOKEN_1PCT.{name, symbol, tokenProgram, totalSupply, devBuyBps, teamAllocation, holderTier.minBalance, holderTier.continuousHoldSeconds}`; `SPOTLIGHT.{enabledAtLaunch, lineupNoticeSeconds}`; `SEASON.{durationDays, lastCallSeconds}`; `VRF.{feeLamports, busyOccupancyBps, busyOldestItemSeconds}`; `ACCOUNT_SIZES.{accountOverhead, vaultSpl, vaultToken2022}`; `GOVERNANCE.{multisigThreshold, multisigMembers, timelockSeconds}`;
- `VRF_QUEUES` (the program reads its queues from `Config`); `KEEPER_POLICY`, `EXECUTOR_POLICY`, `TX_LIMITS`, `HIT_LIST`, `XRAY`, `BOT`, `BLINKS`, `UI`, `MONITOR`, `CU_LIMITS`; every key of another lane's section.

**`constants.rs` never retypes a PARAMS literal.** It holds what PARAMS does not list: PDA seeds, enum codes, `MAX_FEED_BAGS`, the Token-2022 native mint and the legacy VRF identity (§6.1), and the Config and Machine sizes. Everything else it needs is an alias of a `params.rs` value, for example `pub const DECK_ENTRY: usize = params::ACCOUNT_SIZES_DECK_ENTRY as usize;`. Where a dependency also exports an id (`ephemeral_vrf_sdk::consts::VRF_PROGRAM_ID`, the SPL Token, Token-2022, ATA and Ed25519 ids), a host test asserts that it equals the `params.rs` value.

**IDL and parity.** Each generated constant carries Anchor's `#[constant]`, so the IDL exports it. `params-parity.test.ts` decodes each IDL constant's `value` string by its IDL type (integers in decimal, `true`/`false`, arrays and byte strings as `[a, b, …]`, `Pubkey` in base58). It then checks every `ONCHAIN_KEYS` entry against `packages/config` (master §9.2 S5). If Anchor 0.32.2 emits a form the test cannot decode unambiguously, stop and report.

**Compile-time asserts** in `constants.rs` (`const _: () = assert!(...)`):
- PARAMS §22.5 items 1–5 and 12, on the generated values: split exact for every price, Blue formula, EV identity, Silver > 0 with everything live, `maxPerRip × price ≤ MAX_LIST`, size limits;
- the lengths the layouts fix: `CARDS_PER_PACK_DUST == 4`, `CARDS_PER_PACK_HIT == 1`, `STOCK_MAX_BUCKETS == 16`, `TOKEN_1PCT_ONE_PCT_CARD_COUNT == 4`, `VRF_MAX_QUEUES == 4`, `GOVERNANCE_MAX_TEAM_WALLETS == 8`, `GOVERNANCE_GUARDIAN_COUNT == 2`, and `FEED_RULES_FRESH_CAP_PER_WALLET ≤ u16::MAX` (`fresh_in_deck` is a `u16`).

---

## 5. Program layout (names per §0.1; master §7.1 uses older ones)

```
app/programs/onepercent/src/
  lib.rs              dispatch only (declare_id!, #[program] calling instructions::*)
  params.rs           GENERATED (§4.3): every PARAMS value the program compiles, ids, tags and sizes included
  constants.rs        aliases of params.rs values, PDA seeds, enum codes, ids PARAMS does not list, MAX_FEED_BAGS, static asserts
  errors.rs           §13 (stable codes, never renumbered)
  events.rs           §12
  state/              config.rs machine.rs (credit_stock) deck.rs binder.rs pull.rs ledger.rs (§7) + views.rs (raw tail access)
  math/               split.rs draw.rs dust.rs coverage.rs carve.rs hour.rs (rotate_hour) — pure, no Anchor types
  checks/             mint.rs (mint_is_safe) pump.rs (origin) ed25519.rs feed_tx.rs (H4, single feed, top level)
                      nonce.rs payee.rs (creditable, payee_check)
  util/               rent.rs (rent_min, debit_open, close_to) pda.rs (donation-safe create) token.rs (vault CPIs)
  instructions/       one file per instruction: Accounts struct + handler; stubs in stubs.rs
app/programs/onepercent/tests/
  common/             env.rs conv.rs inject.rs mints.rs attest.rs vrf.rs invariants.rs reference.rs fixtures.rs report.rs
  t01_init_admin.rs … t11_hygiene_donations_rent.rs, prop_p1_feed.rs, prop_p2_packs.rs, prop_cr1_callback.rs,
  bench_cu_sizes.rs, golden.rs
app/test-programs/mock-vrf/   Cargo.toml ([workspace] of its own) + src/lib.rs (§10.6)
app/fixtures/vectors/         golden vectors (Rust writes, TS reads; master §8.1)
app/fixtures/mainnet/         features.json: the mainnet feature set, with slot and date (from spike S0, §16.1)
app/scripts/                  params-rs.ts (§4.3), check-sbf-flags.mjs (§3.1), lint-words.mjs, e2e runners (§16.5, §16.6)
```

Root `app/Cargo.toml`: add `exclude = ["test-programs/mock-vrf"]`.

---

## 6. Constants and encodings

### 6.1 External program IDs (PARAMS §21)

| Name | Value |
|---|---|
| MagicBlock VRF program | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` (`params::PROGRAM_IDS_MAGICBLOCK_VRF`; the `#[vrf]` macros use `ephemeral_vrf_sdk::consts::VRF_PROGRAM_ID`, and a host test asserts the two are equal) |
| VRF queues | mainnet shared `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh`; devnet test `GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb` |
| Legacy global VRF identity (**must be rejected** by the callback) | `9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw` |
| pump.fun program; BondingCurve seed and discriminator | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; `bonding-curve`; `17 b7 f8 37 60 d8 ac 60` (= sha256("account:BondingCurve")[..8]) |
| SPL Token / Token-2022 / ATA | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` / `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` / `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| wSOL / Token-2022 native mint | `So11111111111111111111111111111111111111112` / `9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP` |
| Ed25519 precompile / Instructions sysvar / Memo / Compute Budget | `Ed25519SigVerify111111111111111111111111111` / `Sysvar1nstructions1111111111111111111111111` / `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` / `ComputeBudget111111111111111111111111111111` |

Pin only the VRF program id and the queue allow-list. Never pin MagicBlock's ProgramData address or deploy slot (MagicBlock redeployed on 2026-09-19).

Where each id lives (A13): the ones PARAMS lists (`PROGRAM_IDS.*`, `WSOL_MINT`, `PUMP_LAYOUTS`) come from `params.rs`. The Token-2022 native mint and the legacy VRF identity are `constants.rs` literals. The Instructions sysvar id comes from Anchor. The queues come from `Config` only.

### 6.2 PDAs

| Account | Seeds | Program | Bump stored in |
|---|---|---|---|
| Config | `["config"]` | onepercent | Config.bump |
| Machine | `["machine"]` | onepercent | Machine.bump |
| Deck | `["deck"]` | onepercent | Deck.bump (also Machine.deck_bump) |
| vault_auth | `["vault_auth"]` | onepercent | Machine.vault_auth_bump |
| FeeIn (system-owned, 0 B) | `["fee_in"]` | onepercent | Machine.fee_in_bump |
| Binder | `["binder", owner]` | onepercent | Binder.bump |
| Pull | `["pull", buyer, pull_nonce u32 LE]` (A1) | onepercent | Pull.bump |
| MintLedger | `["ledger", mint]` | onepercent | — (derived) |
| Vault | ATA(owner = vault_auth, mint, token program of the mint) | ATA program | — |
| program_identity (VRF request signer) | `["identity"]` | onepercent | — |
| scoped VRF identity (callback signer) | `["identity", onepercent program id]` | VRF program | — (`scoped_vrf_identity(&crate::ID)`) |
| pump.fun BondingCurve | `["bonding-curve", mint]` | pump.fun | — |

### 6.3 Encodings (PARAMS §3.2, §17, §24 A3)

| Enum | Codes |
|---|---|
| Phase | 0 Setup · 1 StockUp · 2 PoweredOn · 3 OnAir · 4 BuysClosed · 5 FinalPull · 6 Done |
| Edition | 0 OG (The Original) · 1 BS (Blue Shift) · 2 SG (Signature) · 3 AH (After Hours) |
| Card kind (`CARD_KINDS` index) | 0 dust · 1 silver · 2 blue · 3 holo · 4 black · 5 jackpot · 6 one_pct · 7 spotlight · 8 final |
| Stock tier → `HIT_TIERS` index | silver 0 · blue 1 · holo 2 · black 3 (card kind = tier index + 1) |
| `PackRecord.tier` | the hit's card kind (1–7), or 255 = not drawn |
| Bucket class | 0 Empty · 1 Major · 2 Trending |
| Token program code | 0 SPL Token · 1 Token-2022 |
| Pull status | 1 Pending · 2 Revealed (0 is invalid; a refunded or fully settled Pull is closed) |
| Deck entry flags | bit0 FRESH · bit1 REFED (M2) |
| Live flags | bit0 OnePct · bit1 Spotlight · bit2 Jackpot (always 0 in M1) |
| Pause bits | 1 RIP · 2 FEED · 4 SELLBACK · 8 STOCKBUY · 16 BURN (mask 0x1F) |
| Roles | 0 Admin · 1 Guardian0 · 2 Guardian1 · 3 Keeper · 4 Executor · 5 IntakeSigner · 6 QuoteSigner · 7 LaunchWallet. The `disabled_roles` bit `1 << role` exists only for roles 3–6 |

### 6.4 Hashing

- `H(...)` is SHA-256 over the plain concatenation, through the `sol_sha256` syscall (`hashv`).
- `u64le(h)` is the first 8 bytes of `h`, read little-endian.
- Tags are ASCII with no terminator.

### 6.5 Sizes (account data, discriminator included) and rent at 5,080 lamports/byte

Rent is always read from the sysvar: `rent_min(n) = Rent::get()?.minimum_balance(n)`. On 2026-10-08 that is `(128 + n) × 5,080`. The figures below are informative.

| Account | Size | Rent-exempt minimum at 5,080 | Paid by |
|---|---|---|---|
| Config | 872 | 5,080,000 | deployer |
| Machine | 3,808 | 19,994,880, plus the untracked buffer passed to `initialize` | deployer |
| FeeIn | 0 (system-owned) | 650,240 | deployer |
| Deck | 64 + 80 × cap | header 975,360; **406,400 per entry** | deployer (header), depositors (entries) |
| Binder | 112 + 56 × cap | header 1,219,200; **284,480 per card slot** | owner |
| Pull | 176 + 200 × qty | 2,560,320 for ×1; 11,704,320 for ×10 | buyer; refunded at the last settle or at refund |
| MintLedger | 80 | 1,056,640 | first depositor of the mint, or the admin when listing |
| Vault ATA | 165 (SPL) / 170 (Token-2022) | 1,488,440 / 1,513,840 | whoever runs `create_idempotent` (normally the first depositor) |

---

## 7. Accounts (exact layouts; final, master §11.3)

Rules for every program account:

- **Struct form.** `#[account(zero_copy)]` structs with `#[repr(C)]`, and `#[zero_copy]` for nested structs. They derive bytemuck `Pod`, so there is **no implicit padding**: add explicit `_pad` fields.
- **Offsets** below are from the start of the account data; bytes 0–7 are the Anchor discriminator.
- **Size checks.** `const _: () = assert!(8 + size_of::<T>() == SIZE)` for each fixed part. A host test checks every field offset with `std::mem::offset_of!`, and the offsets are exported to the golden vectors.
- **No `Option<Pubkey>` in accounts.** An all-zero `Pubkey` means "none".
- **Dynamic tails** (Deck entries, Binder cards, Pull packs) are accessed through `state/views.rs` helpers that `bytemuck::cast_slice(_mut)` the bytes after the fixed part, with the length checks shown.
- **IDL listing.** Each account type appears at least once as `AccountLoader<'info, T>` in some `Accounts` struct, so the IDL lists it. Never hold a `load_mut` guard and a raw data borrow at the same time.
- **Array lengths.** If bytemuck rejects an array length (only 0–32, 48, 64, 96, 128, 256, 512, 1024, 2048 and 4096 are implemented without `min_const_generics`), split the array into supported sizes (e.g. 1,232 = 1,024 + 128 + 64 + 16). The byte layout must not change.

### 7.1 `Config` — `["config"]`, 872 B

| Offset | Field | Type |
|---|---|---|
| 0 | discriminator | [u8; 8] |
| 8 | admin (Squads v4 vault PDA on mainnet) | Pubkey |
| 40 | guardians | [Pubkey; 2] |
| 104 | keeper | Pubkey |
| 136 | executor | Pubkey |
| 168 | intake_signer | Pubkey |
| 200 | quote_signer | Pubkey |
| 232 | launch_wallet | Pubkey |
| 264 | team_wallet (payout address, Squads vault) | Pubkey |
| 296 | team_wallets (published; never Feed or Rip) | [Pubkey; 8] |
| 552 | token_mint ($1PCT, pinned vanity mint) | Pubkey |
| 584 | vrf_queues (allow-list) | [Pubkey; 4] |
| 712 | snapshot_slot `S` | u64 |
| 720 | snapshot_ts | i64 |
| 728 | stock_up_ts | i64 |
| 736 | version (= 1) | u8 |
| 737 | bump | u8 |
| 738 | active_queue (index into vrf_queues) | u8 |
| 739 | season_set (0/1) | u8 |
| 740 | admin_paused (bits) | u8 |
| 741 | guardian_paused (bits) | u8 |
| 742 | disabled_roles (bits) | u8 |
| 743 | _pad | u8 |
| 744 | vrf_program (= VRF program id, set at init, never changed; PARAMS §7.1 [A]) | Pubkey |
| 776 | _reserved | [u8; 96] |

The effective pause bits are `admin_paused | guardian_paused`. Two fields implement "a guardian cannot clear a bit the admin set" (PARAMS §7.1).

### 7.2 `Machine` — `["machine"]`, 3,808 B

| Offset | Field | Type | Written in |
|---|---|---|---|
| 0 | discriminator | [u8; 8] | |
| 8 | version (= 1) | u8 | M1 |
| 9 | bump | u8 | M1 |
| 10 | phase | u8 | M1 |
| 11 | vault_auth_bump | u8 | M1 |
| 12 | deck_bump | u8 | M1 |
| 13 | config_bump | u8 | M1 |
| 14 | fee_in_bump | u8 | M1 |
| 15 | _pad0 | u8 | |
| 16 | next_seq (starts at 1) | u64 | M1 |
| 24 | pending_pulls | u64 | M1 |
| 32 | reserved_dust | u64 | M1 |
| 40 | power_on_ts | i64 | M4 (tests inject) |
| 48 | on_air_ts | i64 | M4 (tests inject) |
| 56 | end_ts | i64 | M4 (read in M1) |
| 64 | final_ts | i64 | M4 |
| 72 | stock_sol | u64 | M1 |
| 80 | jackpot_sol (unconverted Jackpot SOL, J-B) | u64 | M1 (accumulates) |
| 88 | burn_sol | u64 | M1 (accumulates; `credit_stock` from FinalPull on, A18) |
| 96 | team_sol | u64 | M1 |
| 104 | final_pool_sol | u64 | M4 |
| 112 | total_spend | u64 | M1 |
| 120 | hour_index (`now / 3600`; the one hour index of the four fields below, A16) | u64 | M1 |
| 128 | hit_out_this_hour | u64 | M1 |
| 136 | hit_out_last_hour | u64 | M1 |
| 144 | sb_paid_hour | u64 | M1 (reset by `rotate_hour`); M2 (`sell_back` adds) |
| 152 | sol_at_hour_start (`stock_sol` when the hour started) | u64 | M1 (`rotate_hour`) |
| 160 | packs_revealed per edition | [u64; 4] | M1 |
| 192 | hit_value_out per edition | [u64; 4] | M1 |
| 224 | buckets | [Bucket; 16] (2,048 B) | M1 |
| 2,272 | jackpot_tokens ($1PCT pot, J-B) | u64 | M2 (JackpotBuy); M4 (win) |
| 2,280 | jackpot_cost (SOL converted into the pot, J-B) | u64 | M2 (JackpotBuy); M4 (win) |
| 2,288 | burned_total | u64 | M2 |
| 2,296 | last_burn_ts | i64 | M2 |
| 2,304 | burn_hour_index | u64 | M2 |
| 2,312 | burn_paid_hour | u64 | M2 |
| 2,320 | last_jackpot_buy_ts | i64 | M2 |
| 2,328 | final_pool_1pct (the $1PCT Final Pull pool: frozen at `start_final_pull`, then decremented by each claim, A18) | u64 | M4 |
| 2,336 | onepct: [OnePctSlot; 4] (4 × 16 B) | — | M4 |
| 2,400 | spotlight: SpotlightSlot (96 B) | — | M4 |
| 2,496 | exec: ExecRecord (80 B) | — | M2 |
| 2,576 | _reserved | [u8; 1,232] | — |

Nested structs:
- **`Bucket` (128 B):**
  - `mint: Pubkey @0`, `oracle: Pubkey @32` (Pyth price account or pool; stored at listing, used in M2);
  - `amount A: u64 @64` (token base units held for the stock), `cost C: u64 @72` (book cost, lamports), `reserved: u64 @80` (coverage, lamports), `cap: u64 @88` (max book value);
  - `trend_bought_hour: u64 @96` (M2), `trend_hour_index: u32 @104` (M2);
  - `decimals: u8 @108`, `class: u8 @109`, `enabled: u8 @110`, `token_program: u8 @111`;
  - `final_pool: u64 @112` (M4, A18: `A(b)` frozen at `start_final_pull`; each claim's share is computed from it while `A(b)` decreases);
  - `_reserved: [u8; 8] @120`.
- **`OnePctSlot` (16 B):** `amount: u64 @0`, `state: u8 @8` (0 Locked, 1 Live, 2 Pulled, 3 Final), `_pad: [u8; 7]`.
- **`SpotlightSlot` (96 B):** `mint @0`, `sponsor @32`, `window_start: i64 @64`, `amount: u64 @72`, `state: u8 @80`, `_pad: [u8; 15]`.
- **`ExecRecord` (80 B):** `kind: u8 @0` (0 = none), `bucket: u8 @1`, `_pad: [u8; 6]`, `amount: u64 @8`, `v0: u64 @16`, `min_out: u64 @24`, `slot: u64 @32`, `target: Pubkey @40`, `_reserved: [u8; 8] @72`.

Fields marked only M2 or M4 are zero in M1; their semantics come with that milestone's brief.
- `free(b) = C(b) − reserved(b)` (saturating).
- The stock's book value is `stock_sol + Σ C(b)`. Nothing is marked to market on-chain.

### 7.3 `Deck` — `["deck"]`, 64 B header + 80 B × `cap`

| Offset | Field | Type |
|---|---|---|
| 0 | discriminator | [u8; 8] |
| 8 | len (live entries) | u32 |
| 12 | cap (allocated entry slots; `len ≤ cap`) | u32 |
| 16 | header_rent (lamports paid at initialize, informative) | u64 |
| 24 | total_fed | u64 |
| 32 | total_pulled | u64 |
| 40 | total_taken_back | u64 |
| 48 | bump | u8 |
| 49 | version (= 1) | u8 |
| 50 | _pad | [u8; 6] |
| 56 | _reserved | [u8; 8] |
| 64 | entries[cap] | [DeckEntry] |

- **`DeckEntry` (80 B):** `depositor: Pubkey @0`, `mint: Pubkey @32`, `amount: u64 @64`, `deposit: u32 @72` (lamports this entry paid, saturating at `u32::MAX`), `flags: u8 @76`, `_pad: [u8; 3] @77`.
- The data length is always `64 + 80 × cap`. `cap == len` except after a removal under a rent increase (§8.2).

### 7.4 `Binder` — `["binder", owner]`, 112 B header + 56 B × `cap`

| Offset | Field | Type |
|---|---|---|
| 0 | discriminator | [u8; 8] |
| 8 | owner | Pubkey |
| 40 | referrer (zero = none; immutable once set) | Pubkey |
| 72 | season_spend (lamports of revealed packs) | u64 |
| 80 | sol_owed (M2–M4; 0 in M1) | u64 |
| 88 | feed_nonce_base (A3) | u32 |
| 92 | sb_nonce (M2) | u32 |
| 96 | pull_nonce (next Pull nonce, A1) | u32 |
| 100 | feed_nonce_bits (16-slot window, A3) | u16 |
| 102 | fresh_in_deck | u16 |
| 104 | len (cards) | u16 |
| 106 | cap (allocated card slots) | u16 |
| 108 | reserved (slots reserved for pending Pulls) | u16 |
| 110 | bump | u8 |
| 111 | flags (bit0 Final SOL claimed; bit1 Final tokens claimed, set once by the single claim that covers every pool, A18; M4) | u8 |
| 112 | cards[cap] | [Card] |

- **`Card` (56 B):** `mint: Pubkey @0`, `amount: u64 @32`, `value: u64 @40` (stocked value in lamports; 0 for Dust), `kind: u8 @48`, `edition: u8 @49`, `flags: u8 @50` (0 in M1), `_pad: u8 @51`, `seq_lo: u32 @52` (low 32 bits of the Pull's `seq`).
- Invariant: `len + reserved ≤ cap`. At most 65,535 cards per Binder (PARAMS §24 A6).

### 7.5 `Pull` — `["pull", buyer, pull_nonce u32 LE]`, 176 B header + 200 B × `qty`

| Offset | Field | Type |
|---|---|---|
| 0 | discriminator | [u8; 8] |
| 8 | seq (global) | u64 |
| 16 | buyer | Pubkey |
| 48 | referrer (copied from the Binder at purchase; zero = none) | Pubkey |
| 80 | randomness (zero until revealed) | [u8; 32] |
| 112 | created_ts | i64 |
| 120 | revealed_ts | i64 |
| 128 | price (lamports per pack) | u64 |
| 136 | buyer_nonce | u32 |
| 140 | settled_mask (bit i = pack i settled) | u16 |
| 142 | edition | u8 |
| 143 | qty | u8 |
| 144 | status (1 Pending, 2 Revealed) | u8 |
| 145 | holder (0/1, verified HOLD attestation) | u8 |
| 146 | bump | u8 |
| 147 | version (= 1) | u8 |
| 148 | live_flags (evaluated in the callback; 0 in M1) | u8 |
| 149 | _pad | [u8; 3] |
| 152 | _reserved | [u8; 24] |
| 176 | packs[qty] | [PackRecord] |

- **`PackRecord` (200 B):**
  - `royalties: [Royalty; 4] @0` (4 × 48);
  - `backing: u8 @192` (bucket index reserved at purchase; 255 = none);
  - `tier: u8 @193` (§6.3; 255 = not drawn);
  - `carved_bucket: u8 @194` (255 = none);
  - `house_mask: u8 @195` (bit k = slot k was a House Card);
  - `fresh_mask: u8 @196` (bit k = slot k's entry was FRESH);
  - `_pad: [u8; 3] @197`.
- **`Royalty` (48 B):** `depositor: Pubkey @0`, `lamports: u64 @32` (the 2% royalty), `refund: u64 @40` (the Deck entry deposit moved into the Pull).

### 7.6 `MintLedger` — `["ledger", mint]`, 80 B (A10)

`mint: Pubkey @8`, `payer: Pubkey @40` (receives the vault and ledger rent at `close_vault`), `accounted: u64 @72`.

`accounted` counts every claim on the vault: Deck entries, cards and bucket stock; later The 1%, Jackpot and Spotlight tokens.

### 7.7 Vaults, `vault_auth`, FeeIn

- **Vaults.** One vault per mint: the canonical ATA of `vault_auth` for (mint, token program of the mint), created with `create_idempotent` by whoever needs it first.
- **`vault_auth`** is a 0-byte PDA used only as a signer. FeeIn is a system-owned 0-byte PDA, pre-funded at `initialize` (it becomes the pump.fun creator in M4). Lamports donated to either are harmless.
- **I1:** `vault.amount ≥ ledger.accounted` at all times. Tokens above `accounted` are donations and are never credited to anyone. Entries never break I1 (they revert). `take_back` and `redeem` report a breach with `VaultShortfall` instead of reverting (A17).

---

## 8. Shared helpers (`util/`, `checks/`; each unit-tested)

### 8.1 Rent and lamports

```
rent_min(n)                 = Rent::get()?.minimum_balance(n)                     // never hard-code
debit_open(from, to, want)  // `from` is program-owned and stays open
    floor = rent_min(from.data_len()); avail = from.lamports().saturating_sub(floor)
    x = min(want, avail); from.lamports -= x; to.lamports += x; return x
close_to(acc, to)           // acc program-owned: move ALL lamports to `to`, assign to System, resize(0)
creditable(acc, amount)     = acc.is_writable && acc.owner == System && !acc.executable
                              && acc.lamports() + amount ≥ rent_min(acc.data_len())
payee_check(acc)            // settle and refund_pull, for each payee actually paid (A14)
    if !acc.is_writable && acc.owner == System && !acc.executable && acc.lamports() > 0: AccountMismatch
credit_stock(machine, x)    // every redirect to the stock in an exit (A18); saturating
    if machine.phase ≥ FinalPull: burn_sol += x  else: stock_sol += x
```

- Program-owned → any account: direct lamport arithmetic. User → program account: a `system_program::transfer` CPI.
- **Never pay with `lamports − rent`.** Payouts use tracked amounts (Machine SOL buckets, Pull records). The cap in `debit_open` only matters after the Rent sysvar changed.
- **Why.** The runtime rejects a transaction that leaves a writable account below its rent-exempt minimum, unless the account was already below, keeps the same size and receives no lamports. A rent **increase** must never make an exit or the callback fail. Hence the shrink-when-possible rules below, `debit_open`, and the Machine rent buffer (A8).
- **Payees that may be read-only (A14).** In `settle` and `refund_pull`, the payee accounts are `UncheckedAccount`s **without** Anchor `mut`. Anchor's `mut` check would reject the whole instruction before the handler runs if a payee arrived read-only, and that happens without anyone asking:
  - the runtime silently demotes a reserved key (any sysvar or builtin program id, e.g. `SysvarRent111…`, `ComputeBudget111…`) to read-only;
  - it may refuse a write lock on an executable account, and a wallet can turn its own address into a program.

  Clients mark payees writable, except reserved or executable ones (§15.4). Then, for each payee that is actually paid:
  - its key must match the record (unchanged);
  - `payee_check`: a live wallet (System-owned, not executable, holding lamports) that arrives read-only is a client error or an attempt to divert its payment, so it fails with `AccountMismatch`;
  - pay only if `creditable`, which includes `is_writable`;
  - otherwise redirect: a royalty and its refund to `credit_stock`, a referral to `team_sol`, a Pull remainder to `credit_stock`, with the events of §9.10–§9.11.

  A read-only System account holding 0 lamports is redirected, not rejected. That keeps an absent reserved key from blocking a pack forever. The cost: a wallet drained to 0 lamports can lose that payment to the stock if a third party passes it read-only.

### 8.2 Deck operations (`state/views.rs` + `util`)

**append(n, entries, depositor):**
1. `entry_deposit = rent_min(80) − rent_min(0)` (= 406,400 at 5,080).
2. `system_program::transfer(depositor → deck, n × entry_deposit)`.
3. If `len + n > cap`: `resize(64 + 80 × (len + n))`; `cap = len + n`.
4. Require `deck.lamports ≥ rent_min(64 + 80 × cap)`, else `DeckUnderfunded`. That is only possible after a rent increase; Feed waits until rent falls or someone tops the Deck up, and exits are unaffected.
5. Write the entries at `len..len+n` with `deposit = entry_deposit`; `len += n`.

**swap_remove(idx) → (entry, moved_from):**
- `e = entries[idx]; entries[idx] = entries[len−1]; zero entries[len−1]; len −= 1`.
- `moved_from = old len − 1`, or `u32::MAX` if `idx` was the last.

**release(deposits in removal order) → refunds**, after all removals of the instruction:

```
new_size = 64 + 80 × len
if len < cap and deck.lamports ≥ rent_min(new_size): resize(new_size); cap = len
avail = deck.lamports.saturating_sub(rent_min(64 + 80 × cap))
refund_j = min(deposit_j, avail_remaining)   in removal order
```

The caller then moves `Σ refund_j` out of the Deck: to the depositor in `take_back`, to the Pull in the callback. Under a large rent increase this refunds less (possibly 0) and keeps `cap > len`. It never fails.

### 8.3 Binder operations

**ensure(owner, payer):**
- If the account at `["binder", owner]` is empty (owner = System), create it (donation-safe, §8.9) with 112 B; write the discriminator, `owner` and `bump`; everything else is zero.
- Otherwise check the owner program, the discriminator and the `owner` field.

**grow_for(slots, payer):**
```
free = cap − len − reserved
if free < slots: new_cap = cap + (slots − free)  (> u16::MAX → BinderFull)
    top_up = (rent_min(112 + 56·new_cap) + sol_owed).saturating_sub(binder.lamports)
    system transfer payer → binder (top_up); resize; cap = new_cap
reserved += slots
```

**append_card(card):** requires `len < cap`; writes at `len`; `len += 1`.

**swap_remove(idx) → (card, moved_from):** the same pattern as the Deck; `moved_from` is a u16.

**shrink_to_fit(owner_acc):**
```
target = len + reserved
if target < cap:
    floor = rent_min(112 + 56·target) + sol_owed
    if binder.lamports ≥ floor: resize; cap = target
        refund = binder.lamports − floor; if creditable(owner_acc, refund): move refund → owner_acc
    else: no resize, no refund        (rent increase)
```

A Binder has a single payer, its owner. Excess lamports (freed slots, a rent decrease, donations) go back to the owner (A9).

### 8.4 `mint_is_safe(mint_acc) -> Result<(decimals, token_program_code)>`

Used by `feed` and `admin_list_mint` only. **Never** by `take_back`, `redeem`, `settle`, `refund_pull` or the callback.

1. The owner is SPL Token or Token-2022, else `MintNotSafe`. SPL Token: data length exactly 82. Token-2022: length 82, or ≥ 166.
2. Unpack the base mint from `data[0..82]`. Require `is_initialized`, `mint_authority == None`, `freeze_authority == None` and `decimals ≤ MAX_DECIMALS`; else `MintNotSafe`.
3. Token-2022 with length ≥ 166:
   - require `data[165] == 1` (AccountType::Mint);
   - walk the TLV list from byte 166 (`type u16 LE, len u16 LE, value[len]`), bounds-checking every step;
   - stop at a `(type 0, len 0)` header;
   - every other type must be `MetadataPointer (18)` or `TokenMetadata (19)`. Anything else, including a type this crate version does not know, gives `MintNotSafe`;
   - take the two codes from `spl_token_2022::extension::ExtensionType::{MetadataPointer, TokenMetadata} as u16`, and unit-test that they equal 18 and 19.
4. Lengths 83–165 give `MintNotSafe`.

With null authorities a mint's extension set can never change, so a mint that passes once stays safe. Never read a Token-2022 mint with the SPL layout.

### 8.5 pump.fun origin (H1)

- `bonding_curve.key == find_program_address(["bonding-curve", mint], PUMP)`;
- `bonding_curve.owner == PUMP`;
- `data_len ≥ 8` and `data[0..8] == 17b7f83760d8ac60`.

Read nothing else; live accounts are 81, 150 or 166 bytes. Never trust the mint address suffix ("…pump").

### 8.6 Ed25519 attestations

**Messages** (built byte-for-byte on-chain and compared):

- FEED, 121 B (A2):
  ```
  "1PCT-FEED-v1" ‖ program_id(32) ‖ wallet(32) ‖ nonce u32 LE ‖ expiry i64 LE ‖ n u8 ‖ bags_hash(32)
  bags_hash = sha256( mint_0 ‖ amount_0 u64 LE ‖ … ‖ mint_{n−1} ‖ amount_{n−1} u64 LE )   (in the instruction's bag order)
  ```
  Signed by `config.intake_signer`.
- HOLD, 84 B: `"1PCT-HOLD-v1" ‖ program_id(32) ‖ wallet(32) ‖ expiry i64 LE`. Signed by `config.intake_signer`.

**Ed25519 instruction layout** (verify by reading, never by assuming):
- `data[0]` = number of signatures, `data[1]` = padding;
- `data[2..16]` = `signature_offset, signature_instruction_index, public_key_offset, public_key_instruction_index, message_data_offset, message_data_size, message_instruction_index` (each u16 LE).

The standard builder puts the pubkey at 16, the signature at 48 and the message at 112. The SDK and the Rust tests build it that way.

**`verify_ed25519(ix_sysvar, att_ix, expected_pubkey, expected_msg)`.** These rules block the classic introspection bug:
1. `load_instruction_at_checked(att_ix)`; its `program_id` must be the Ed25519 precompile.
2. `data[0] == 1`.
3. All three `*_instruction_index` equal `u16::MAX` (the data lives in this same instruction).
4. Bounds-check `offset + len ≤ data.len()` for the signature (64), the public key (32) and the message.
5. The public key bytes equal `expected_pubkey`, and the message bytes equal `expected_msg` (length and content).
6. The runtime has already verified the signature; the precompile fails the transaction otherwise.

Any failure gives `AttestationInvalid`. The expiry check is separate: `now ≤ expiry ≤ now + TTL`, else `AttestationExpired`.

**Signers use cluster time.** `now` is `Clock::unix_timestamp`, which can run behind wall time. A signer that set `expiry = wall_now + TTL` would be rejected whenever the cluster clock lags by more than the user's signing and landing delay: intermittent Feed, holder-boost and (with the 20 s TRENDING TTL) Sell back failures. Every signer (intake and quote signers, M2) therefore sets `expiry = blockTime(latest confirmed slot) + TTL − 10 s`, never a value from its own clock. The SDK exports this rule as `attestationExpiry(blockTime, ttlSeconds)` (§15.1), which the tests and the later signers use. Its unit test runs with the local clock 30 s ahead of the chain and shows the result does not change.

### 8.7 Feed transfer introspection (H4, A4) and single-feed rule

For each bag `j` (mint `M_j`, vault `V_j`, amount `a_j`), some **top-level** instruction at an index **lower** than the current `feed` instruction must satisfy all of:
- `program_id == M_j.owner` (SPL Token or Token-2022);
- `data == [12] ‖ a_j u64 LE ‖ [decimals_j]` (`TransferChecked`, exactly 10 bytes);
- `accounts[1] == M_j`, `accounts[2] == V_j`, `accounts[3] == depositor` (the authority; a delegate or multisig authority does not match).

Otherwise `TokensNotReceived`. Then also require `vault.amount − ledger.accounted ≥ a_j` (≥, never ==) before `ledger.accounted += a_j`.

**Single feed per transaction:** if any other instruction in the transaction has `program_id == crate::ID` and data starting with the `feed` discriminator, fail with `MultipleFeeds`.

**Top level only (A15):** `feed` itself must run at the transaction level: `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT`, else `NotTopLevel`. The two rules above scan top-level instructions only. Without this one, a wrapper program could call `feed` twice by CPI inside one top-level instruction, and one `TransferChecked` would pass H4 twice.

CPI Guard users are fine, because the transfer is the user's own top-level instruction.

### 8.8 FEED nonce window (per Binder, A3)

```
accept(n):
  if n < base: AttestationReplay
  if n ≥ base + 16: shift = n − base − 15; bits = (shift ≥ 16) ? 0 : bits >> shift; base += shift
  bit = 1 << (n − base); if bits & bit != 0: AttestationReplay
  bits |= bit
  while bits & 1 == 1: bits >>= 1; base += 1          // base = lowest unused nonce
```

The intake signer (services lane) and the SDK pick the lowest unused nonces in `[base, base + 16)`. A replay is impossible: a used nonce is either below `base` or has its bit set.

### 8.9 Donation-safe PDA creation

`create_pda(payer, target, space, seeds)`:
- if `target.lamports == 0`: `system_program::create_account`;
- otherwise transfer the shortfall up to `rent_min(space)`, then `allocate` and `assign` (both `invoke_signed`).

Anchor's `init` already behaves like this. The helper is for accounts created from `remaining_accounts` (MintLedger in `feed`) or by hand (Binder).

### 8.10 Token CPI helpers

`vault_transfer(mint, vault, dest, amount)`, `vault_burn(mint, vault, amount)` and `vault_close(vault, dest)`:
- sign with `["vault_auth", bump]`;
- go through `anchor_spl::token_interface` (`transfer_checked`, `burn_checked`, `close_account`);
- the token program must equal `mint.owner`;
- `reload()` the vault after the CPI before reading it again.

---

## 9. Instructions

### 9.0 Common rules

- `now = Clock::get()?.unix_timestamp`.
- `paused(bit) = ((config.admin_paused | config.guardian_paused) & bit) != 0`.
- **Exits** are `take_back`, `redeem`, `settle`, `refund_pull`, `consume_randomness`, `team_withdraw` and `close_vault`. They:
  - never read a pause bit, a disabled role, an attestation, the VRF queue or `end_ts`;
  - work in every phase;
  - take no remaining accounts.

  Structurally, their `Accounts` structs do not contain `Config`; the one exception is `team_withdraw`, which reads `Config.team_wallet`.

| Instruction | Phases | Time | Pause bit |
|---|---|---|---|
| `feed` | StockUp, PoweredOn, OnAir | `end_ts == 0 ∨ now < end_ts` | FEED |
| `buy_packs` | OnAir | `now < end_ts` | RIP |
| every exit, `advance_phase` | any | — | never |

- Every PDA a client passes is checked against its seeds (Anchor `seeds`/`bump`, or by hand), exits included. A mismatch is an error, except where a no-op is specified (`settle`, `refund_pull`, the callback).
- `team(pk) = pk == config.team_wallet ∨ pk ∈ config.team_wallets` (zero entries ignored).

### 9.1 `initialize(params: InitParams)`

```
InitParams { admin, guardians: [Pubkey; 2], keeper, executor, intake_signer, quote_signer, launch_wallet,
             team_wallet, team_wallets: [Pubkey; 8], token_mint, vrf_queue, rent_buffer_lamports: u64 }
```

**Accounts:**
- `authority` (signer, mut, payer);
- `program` (`Program<Onepercent>`);
- `program_data` (`Account<ProgramData>`, `program.programdata_address() == Some(program_data.key())`);
- `config` (init, 872 B, `["config"]`), `machine` (init, 3,808 B, `["machine"]`), `deck` (init, 64 B, `["deck"]`);
- `fee_in` (mut, `["fee_in"]`, system-owned or empty);
- `vrf_queue` (owner == VRF program);
- `system_program`.

**Checks, in order:**
1. `program_data.upgrade_authority_address == Some(authority)`, else `Unauthorized`.
2. `admin`, both guardians, `intake_signer`, `team_wallet` and `token_mint` are non-zero, else `InvalidArgument`.
3. `vrf_queue.key == params.vrf_queue`, and it is owned by the VRF program, else `QueueNotAllowed`.

**Effects:**
- **Config:** every role field from `params`; `vrf_queues[0] = vrf_queue`; `active_queue = 0`; `vrf_program = VRF_PROGRAM_ID`; `version = 1`; bump.
- **Machine:** `version = 1`; `phase = Setup`; `next_seq = 1`; all bumps (`find_program_address` once, here); every counter 0. Then transfer `params.rent_buffer_lamports` from `authority` into the Machine. This buffer is untracked; the ops value is 50,000,000 (A8).
- **Deck:** `len = cap = 0`; `header_rent = rent_min(64)`; bump; `version = 1`.
- **FeeIn:** transfer `rent_min(0).saturating_sub(fee_in.lamports)` from `authority` (pre-funding, SPEC §6.9).

**Event:** `Initialized`.

### 9.2 `admin_config(action: AdminAction)` — signer must be `config.admin`

**Accounts:** `admin` (signer); `config` (mut); `machine` (mut); `remaining_accounts[0]` = the queue account for `AddVrfQueue` (owner-checked).

| Variant | Rules | Effect |
|---|---|---|
| `SetRole { role, key }` | `role ≤ 7`, `key ≠ 0` | Set the role; clear its `disabled_roles` bit |
| `SetTeam { team_wallet, team_wallets: [Pubkey; 8] }` | `team_wallet ≠ 0` | Set both |
| `SetSeason { snapshot_slot, snapshot_ts, stock_up_ts }` | `season_set == 0` (else `SeasonAlreadySet`); `phase == Setup` (else `WrongPhase`); `snapshot_slot ≤ Clock.slot` and `snapshot_ts ≤ now` (`S` is a published past slot); `stock_up_ts > snapshot_ts` | Set them; `season_set = 1` |
| `SetTokenMint { mint }` | `phase == Setup`; `mint ≠ 0` | `token_mint = mint` |
| `AddVrfQueue { queue }` | `remaining_accounts[0].key == queue` and it is owned by the VRF program (else `QueueNotAllowed`); not already listed; a zero slot exists (else `InvalidArgument`) | Write it into the first zero slot |
| `UpdateBucket { index, enabled, cap }` | `index < 16`; `class ≠ 0` (else `BucketInvalid`); enabling a TRENDING bucket keeps ≤ `TREND_MAX` enabled TRENDING buckets (else `TrendingLimit`) | Set `enabled` and `cap` (any value) |
| `SetPause { bits, paused }` | `bits & !0x1F == 0` (else `InvalidArgument`) | Set or clear `admin_paused`. Clearing also clears the same bits in `guardian_paused` |

**Event:** `ConfigChanged { action, actor, key, a, b }` (codes in §12).

### 9.3 `admin_list_mint(class: u8, cap: u64, oracle: Pubkey)` — the hit list

**Accounts:**
- `admin` (signer, mut, payer); `config`; `machine` (mut); `mint`;
- `ledger` (mut, `["ledger", mint]`, created if empty);
- `vault`: must already exist as the canonical ATA of `vault_auth`, created by a preceding `create_idempotent` in the same transaction;
- `vault_auth`; `token_program` (== `mint.owner`); `system_program`.

**Checks:**
1. The signer is the admin.
2. `class ∈ {1, 2}`.
3. `mint_is_safe(mint)`.
4. `mint ∉ {token_mint, wSOL, Token-2022 native mint}`, else `MintForbidden`.
5. No bucket already has this mint, else `BucketExists`.
6. A bucket with `class == 0` exists, else `BucketsFull`.
7. If `class == 2`: fewer than `TREND_MAX` enabled TRENDING buckets, else `TrendingLimit`.
8. The vault is canonical (a token account with `mint == mint` and `owner == vault_auth`), else `VaultMismatch`.

**Effects:**
- The first empty bucket gets `{mint, oracle, A 0, C 0, reserved 0, cap, decimals, class, enabled 1, token_program}`.
- If the ledger is empty, create it with `payer = admin` and `accounted = 0`; if it exists, validate it (a dust mint may already have one).

**Event:** `ConfigChanged` (ListMint).

### 9.4 `guardian(action: GuardianAction)` — signer ∈ {guardian0, guardian1, admin}

**Accounts:** `signer`; `config` (mut); `machine` (mut).

| Variant | Rules | Effect |
|---|---|---|
| `SetPause { bits, paused }` | `bits ⊆ 0x1F` (else `InvalidArgument`) | Set or clear **`guardian_paused` only**; never `admin_paused` |
| `DisableBucket { index }` | `index < 16`, `class ≠ 0` (else `BucketInvalid`) | `enabled = 0`. Cards of that mint stay redeemable |
| `LowerCap { index, cap }` | `index < 16`, `class ≠ 0`, `cap ≤ current cap` (else `InvalidArgument`) | Set the cap |
| `DisableRole { role }` | `role ∈ 3..=6` (else `InvalidRole`) | Set the disabled bit |
| `SelectVrfQueue { index }` | `index < 4` and `vrf_queues[index] ≠ 0` (else `QueueNotAllowed`) | `active_queue = index` |

The guardian can never touch an exit, grant a role, raise a cap, enable a bucket or clear an admin pause.

**Event:** `ConfigChanged`.

### 9.5 `advance_phase()` — anyone

**Accounts:** `config`; `machine` (mut). At most one transition per call; otherwise it is a no-op that returns `Ok`.

- Setup → StockUp: `season_set == 1 ∧ now ≥ stock_up_ts`.
- PoweredOn → OnAir: `on_air_ts ≠ 0 ∧ now ≥ on_air_ts`.
- OnAir → BuysClosed: `end_ts ≠ 0 ∧ now ≥ end_ts`.

Phases never move backwards.

**Event:** `PhaseAdvanced { from, to, ts }`.

### 9.6 `feed(amounts: Vec<u64>, expiry: i64, nonce: u32, att_ix: u8)` — a fresh bag from a wallet becomes a Dust Card in the Deck

**Accounts:**
- `depositor` (signer, mut); `config`; `machine` (read-only); `deck` (mut);
- `binder` (mut, `["binder", depositor]`, created if empty);
- `instructions` (sysvar); `system_program`;
- `remaining_accounts`: 4 per bag, in bag order: `[mint, vault, ledger (mut), bonding_curve]`.

**Expected transaction** (the SDK builds it):
```
[compute budget] [ed25519 FEED attestation]
([create_idempotent vault ATA if missing] transfer_checked user→vault) × n
feed
(close_account emptied user account → user) × n
```

**Checks and effects, in order:**
1. Top-level instruction (`NotTopLevel`, §8.7); not `paused(FEED)` (`Paused`); phase ∈ {StockUp, PoweredOn, OnAir} (`WrongPhase`); `end_ts == 0 ∨ now < end_ts` (`SeasonOver`).
2. `n = amounts.len()` with `1 ≤ n ≤ MAX_FEED_BAGS`; `remaining_accounts.len() == 4n`; every amount > 0. Otherwise `InvalidArgument`.
3. `depositor.owner == System` (`NotWallet`); `!team(depositor)` (`TeamWallet`).
4. The intake role is not disabled (`RoleDisabled`).
5. Single feed per transaction (§8.7, `MultipleFeeds`). The bag mints are pairwise distinct (`DuplicateMint`).
6. `binder.ensure(depositor, payer = depositor)`.
7. **H5 attestation:**
   - build the FEED message, with `bags_hash` over (remaining-account mints, amounts);
   - verify it at `att_ix` against `config.intake_signer` (§8.6);
   - require `now ≤ expiry ≤ now + FEED_TTL`;
   - then `accept(nonce)` in the Binder window (§8.8).
8. For each bag j:
   1. **H2** `mint_is_safe(mint_j)`.
   2. **H3** `mint_j ∉ {config.token_mint, wSOL, Token-2022 native mint}` (`MintForbidden`).
   3. **H1** origin (§8.5, `NotPumpFun`).
   4. **Vault:** `vault_j.key == ATA(vault_auth, mint_j, mint_j.owner)`, owned by `mint_j.owner`, with `mint == mint_j` and `owner == vault_auth`; else `VaultMismatch`.
   5. **Ledger:** `ledger_j.key == PDA(["ledger", mint_j])` (`LedgerMismatch`). If it is empty, create it (§8.9; payer = depositor, `payer` field = depositor). Otherwise validate its owner, discriminator and `mint`.
   6. **H4** (§8.7): the matching top-level `TransferChecked` exists and `vault.amount − accounted ≥ a_j`; then `accounted += a_j`.
   7. If any check of bag j fails, `msg!("feed: bag {j}")` before returning the error, so the logs name the bag.
9. **H6** `fresh_in_deck + n ≤ FRESH_CAP` (`FreshCapReached`); then `fresh_in_deck += n`.
10. **H7** `deck.len + n ≤ DECK_MAX` (`DeckFull`). **H8:** Deck `append` (§8.2) with flags FRESH, `depositor`, `mint_j`, `a_j`; `total_fed += n`.
11. **Events:** `BagFed` per bag.

The intake signer (services lane) also enforces the soft rules before signing: snapshot slot `S`, bought by swap, one-hop provenance, one live fresh card per (wallet, mint), and not a team wallet.

**Signing has no side effects** (services lane, M2):
- a consumed (sender, mint) pair and the live-fresh-card state are recorded only from landed `BagFed` events, read by the indexer (`BagFed` carries `depositor` and `mint`);
- attestation requests are rate-limited per wallet and per IP.

Otherwise anyone could request attestations for a victim's wallet and use up its one-hop eligibility before the victim feeds.

### 9.7 `take_back(deck_index: u32, amount: u64)` — exit; never paused, any phase

**Accounts:**
- `depositor` (signer, mut); `deck` (mut);
- `binder` (mut, `UncheckedAccount`; only the address check `== PDA(["binder", depositor])` in the struct). The account may not exist: its data is loaded only when the entry is FRESH (effect 3);
- `mint`; `ledger` (mut, `["ledger", mint]`); `vault` (mut, canonical); `vault_auth`;
- `destination` (mut, `== ATA(depositor, mint, token_program)`; the SDK adds `create_idempotent` before);
- `token_program` (== `mint.owner`).

Why `binder` is unchecked: a REFED entry (`feed_back`, M2) does not count in `fresh_in_deck`, and after the season its owner may close the Binder (M2 `close_binder`), which nothing can recreate once Feed and Rip are closed. An `AccountLoader<Binder>` would then block that take-back forever.

**Checks:** `deck_index < len` and `entries[deck_index] == {depositor, mint.key, amount}`; otherwise `CardMoved` (the client re-reads the Deck and retries).

**Effects:**
1. `swap_remove(deck_index)`.
2. `release([entry.deposit])`; move the refund Deck → depositor.
3. If the entry is FRESH: load the Binder and validate its owner program, discriminator and `owner` field (`AccountMismatch`), then `binder.fresh_in_deck −= 1` (saturating). A FRESH entry implies `fresh_in_deck ≥ 1`, so that Binder cannot have been closed.
4. `vault_transfer(amount → destination)`; `ledger.accounted = accounted.saturating_sub(amount)`.
5. Reload the vault. If `vault.amount < accounted`, emit `VaultShortfall` and still succeed (A17; unreachable while I1 holds). The transfer in effect 4 already fails if the vault holds less than `amount`.
6. `total_taken_back += 1`.

**Event:** `BagTakenBack { depositor, mint, amount, deck_index, moved_from, refund }`.

### 9.8 `buy_packs(edition: u8, qty: u8, pull_nonce: u32, min_live_flags: u8, referrer: Option<Pubkey>, hold: Option<HoldProof>)` — Rip

`HoldProof { expiry: i64, att_ix: u8 }`.

**Accounts** (`#[vrf]` on the struct):

| Account | Constraint |
|---|---|
| `buyer` | signer, mut |
| `config` | `["config"]` |
| `machine` | mut, `["machine"]` |
| `deck` | `["deck"]`, read-only |
| `binder` | mut, `["binder", buyer]`, created if empty |
| `pull` | mut, `["pull", buyer, pull_nonce.to_le_bytes()]`, created here (Anchor `init` with `space = 176 + 200·qty`, or §8.9) |
| `oracle_queue` | mut, owner == VRF program |
| `instructions` | sysvar |
| `system_program` | — |
| Added by `#[vrf]` | `program_identity` (`["identity"]` under this program), `vrf_program`, `slot_hashes` |

**Checks, in order:**
1. Not `paused(RIP)` (`Paused`); `phase == OnAir` (`WrongPhase`); `now < end_ts` (`SeasonOver`).
2. `edition < 4` (`InvalidEdition`); `1 ≤ qty ≤ MAX_QTY[edition]` and `qty × PRICE[edition] ≤ MAX_LIST` (`InvalidQuantity`). Let `P = PRICE[edition]`.
3. `buyer.owner == System` (`NotWallet`); `!team(buyer)` (`TeamWallet`).
4. `live_now = 0` in M1. Require `min_live_flags & !live_now == 0` (`LiveFlagsChanged`).
5. `oracle_queue.key == config.vrf_queues[config.active_queue]`, which is non-zero (`QueueNotAllowed`).
6. `binder.ensure(buyer, payer = buyer)`; `pull_nonce == binder.pull_nonce` (`InvalidArgument`).
7. If `hold` is `Some`: the intake role is not disabled (`RoleDisabled`); verify HOLD for `buyer` at `hold.att_ix` (§8.6); require `now ≤ expiry ≤ now + HOLD_TTL`; then `holder = 1`.
8. **Dust reservation:** `deck.len ≥ machine.reserved_dust + 4·qty + DUST_BUFFER` (`MachineHungry`).
9. **Coverage reservation** (§11.6): every pack is placed, else `Refilling`.

**Effects:**
10. **Referral binding:** if `binder.referrer == 0`, `binder.season_spend == 0`, and `referrer == Some(r)` with `r ≠ 0` and `r ≠ buyer`, then `binder.referrer = r`. Otherwise the argument is silently ignored; an existing binding is never overwritten. Any key can be bound, because a link can carry any `?ref=`; `settle` copes with a reserved, executable, program-owned or closed referrer (A14, T07.11).
11. `binder.grow_for(5·qty, payer = buyer)` (reserves the slots).
12. Pull header: `seq = machine.next_seq`, `buyer`, `referrer = binder.referrer`, `created_ts = now`, `price = P`, `buyer_nonce`, `edition`, `qty`, `status = Pending`, `holder`, `bump`, `version = 1`. Packs: `backing` from step 9, `tier = 255`, `carved_bucket = 255`, royalties zero.
13. Escrow: `system_program::transfer(buyer → pull, qty·P)`.
14. `machine.next_seq += 1`; `reserved_dust += 4·qty`; `pending_pulls += 1`; `binder.pull_nonce += 1`.
15. **VRF request** (§10.2). The buyer pays MagicBlock's 500,000-lamport fee inside the CPI.
16. **Event:** `PullOpened`.

### 9.9 `consume_randomness(randomness: [u8; 32], seq: u64)` — the VRF callback, total

**Accounts:** `#[vrf_callback]` inserts `vrf_program_identity: Signer` at index 0, with `address = scoped_vrf_identity(&crate::ID)`. Then `pull`, `machine`, `deck`, `binder`, **all `UncheckedAccount` with no Anchor constraints** (no `mut`, no `seeds`, no `owner`).

**The identity check is the only error path.** After it, the handler returns `Ok(())` in every state:
- it makes no CPI and creates no account;
- it reads no user-controlled account and touches only these four;
- on invalid input it emits `CallbackSkipped { pull, seq, reason }` and returns `Ok(())`.

```
1  validate (skip on failure, with reason):
     all four accounts writable                                                          (9 NotWritable)
     pull: owner == crate::ID, data length ≥ 176, discriminator == Pull                   (1 PullInvalid)
     create_program_address(["pull", buyer, buyer_nonce LE, [bump]]) == pull.key          (2 PullAddress)
     pull.seq == seq                                                                      (3 SeqMismatch)
     pull.status == Pending                                                               (4 NotPending)
     1 ≤ qty ≤ 10, edition < 4, price == PRICE[edition], data length == 176 + 200·qty     (1)
     now ≤ created_ts + VRF_TIMEOUT                                                       (5 Late)
     machine: owner, discriminator, data length == 3808, address via stored bump          (6 MachineInvalid)
     deck: owner, discriminator, data length == 64 + 80·cap, header len ≤ cap,
           address via stored bump                                                        (7 DeckInvalid)
     binder: owner, discriminator, data length == 112 + 56·cap, address == PDA(["binder", buyer])
             via stored bump, header `owner` field == pull.buyer                          (8 BinderInvalid)
2  P = price; E = edition; live = 0 (M1); holder = pull.holder; rotate_hour(now) (§11.8)
3  for i in 0..qty:                                       (packs in order)
     a. release coverage: b = packs[i].backing; if b < 16: buckets[b].reserved −= P·COVERAGE_BPS/10_000 (sat)
     b. split (§11.1): stock_inc += stock; jackpot_inc += jackpot; burn_inc += burn;
        team_inc += team + (no referrer ? referral : 0)
     c. (t, tier, widths) = draw(randomness, seq, i, E, live, holder)                         (§11.4)
     d. stock tier (1–4) → V = P·VALUE_BPS[tier]/10_000; pick a bucket and carve (§11.7)
          → hit card {bucket.mint, x, V, kind = tier, E, seq_lo}; hit_out_this_hour += V; hit_value_out[E] += V
        no source (unreachable) → no hit card; emit HitSkipped
        special kind 5–7 (M1: unreachable while live = 0) → no hit card; emit HitSkipped (its slot is released in f)
     e. dust: for k in 0..4:
          if deck.len == 0 → House Card: house_mask |= 1<<k; stock_inc += royalty; continue
          idx = dust_index(randomness, seq, i, k, deck.len)                                 (§11.5)
          (entry, moved_from) = swap_remove(idx); record (i, k, entry.deposit) for the refund step
          royalties[k] = {entry.depositor, royalty, 0}; FRESH → fresh_mask |= 1<<k
          dust card {entry.mint, entry.amount, 0, kind = dust, E, seq_lo}
     f. Binder: append the hit card (if any), then the non-House Dust Cards. Each written card:
        len += 1, reserved −= 1. Each slot not written (House Card or skipped hit): reserved −= 1.
        If len == cap before a write (unreachable while I7 holds): drop the card, reserved −= 1, emit CardDropped.
     g. packs[i].tier = tier; carved_bucket; house_mask; fresh_mask
4  Deck release (§8.2) over every removed deposit, in removal order; move Σrefund Deck → Pull;
   fill royalties[k].refund
5  to_machine = stock_inc + jackpot_inc + burn_inc + team_inc
                (= Σ stock + jackpot + burn + team + unreferred referral + House royalties)
   moved = debit_open(pull → machine, to_machine)
   shortfall = to_machine − moved      (0 unless the rent rose since purchase)
   absorb the shortfall from stock_inc, then team_inc, then jackpot_inc, then burn_inc (each saturating)
   machine.stock_sol += stock_inc; team_sol += team_inc; jackpot_sol += jackpot_inc; burn_sol += burn_inc
   (so the tracked increments == moved, always; P2 asserts it)
6  binder.season_spend += qty·P; machine.total_spend += qty·P; packs_revealed[E] += qty
   machine.reserved_dust −= 4·qty (sat); pending_pulls −= 1 (sat); deck.total_pulled += picks
   pull.status = Revealed; pull.randomness = randomness; pull.revealed_ts = now; pull.live_flags = live
7  emit PackRevealed per pack (after step 4, so refunds are known), then PullRevealed
```

- Use `Vec` (heap) for the per-pick and per-event scratch data; the SBF stack frame is 4 KB.
- **Heap.** The oracle runs the default 32 KiB heap (§10.1), and our budget is 24 KiB. Size every allocation from `qty` alone, never from an account's size, and never copy account data to the heap: read the Deck, the Binder and the Pull through raw borrows (§7). T06.16 reports the total.
- In the handler body, use stored bumps with `create_program_address`, never `find_program_address`. The identity constraint generated by `#[vrf_callback]` is the one accepted exception.
- Compute `V`, the split and every sum in `u128`, and saturate back to `u64`; `free(b)` sums follow §11.7. Validation step 1 guarantees every index used afterwards. `backing < 16` is re-checked; `edition < 4`; `tier ∈ 1..=4` for stock tiers; Deck and Binder indices stay within `len` / `cap`.
- Never use MagicBlock's `rnd::*` helpers (`random_u64` and the others); §11 defines every derivation.

### 9.10 `settle(seq: u64, pack: u8)` — exit; permissionless, idempotent

**Accounts** (no remaining accounts):
- `pull` (mut, `UncheckedAccount`), `machine` (mut);
- `buyer` (`UncheckedAccount`, **no Anchor `mut`**, A14);
- `referrer` (`UncheckedAccount`, no `mut`): must equal `pull.referrer` when that is non-zero; otherwise pass `buyer` as a placeholder;
- `wallet_0..wallet_3` (`UncheckedAccount`, no `mut`): for a House slot pass `buyer` as a placeholder;
- `binder_0..binder_3` (`UncheckedAccount`, no `mut`): read only when `fresh_mask` bit k is set; the SDK always passes `PDA(["binder", depositor_k])`, or `buyer` for a House slot. They carry no `mut` because a placeholder repeats `buyer`, which may be read-only.
- **Why no `mut` (A14).** A payee may arrive read-only: the runtime demotes reserved keys, the SDK passes reserved and executable payees read-only (§15.4), and every placeholder shares its account's flags. Anchor's `mut` check would then reject the instruction before the handler runs, for every `settle` of that pack. The handler checks writability itself (§8.1).
- **Duplicates are normal here.** The same depositor can own two slots, and the placeholders repeat `buyer`. These are `UncheckedAccount`s, so Anchor accepts duplicates (Anchor's duplicate-mutable-account check, introduced in 1.0, covers only types that serialize on exit). Never hold two lamport or data borrows of the same account at once; apply each payment or decrement as its own short borrow.

**Steps:**
1. If `pull` is not a live Pull account (owner ≠ program, too short, wrong discriminator: it was closed or never existed), return `Ok(())` with no event.
2. `pull.seq == seq` (`PullMismatch`); address check with the stored bump (`AccountMismatch`).
3. `status == Revealed` (`PullNotRevealed`); `pack < qty` (`InvalidArgument`).
4. If `settled_mask` bit `pack` is already set, return `Ok(())` (no-op).
5. `buyer.key == pull.buyer`, and `referrer.key == pull.referrer` when that is non-zero; else `AccountMismatch`.
6. `is_last = (settled_mask | 1<<pack) == (1<<qty) − 1`. Define `pay(to, x) = is_last ? move min(x, pull.lamports) : debit_open(pull → to, x)`.
7. For each k in 0..4 whose House bit is clear:
   - `wallet_k.key == royalties[k].depositor` (`AccountMismatch`);
   - `amount = lamports + refund`;
   - `payee_check(wallet_k)` (§8.1);
   - if `creditable(wallet_k, amount)`: `pay(wallet_k, amount)`. Otherwise `moved = pay(machine, amount)`, `credit_stock(moved)`, and emit `RoyaltyRedirected`;
   - if `fresh_mask` bit k is set: `binder_k` must be `["binder", depositor]` with a valid owner and discriminator, and writable (`AccountMismatch`); `fresh_in_deck −= 1` (saturating).
8. If `pull.referrer ≠ 0`: `ref = P·REFERRAL_BPS/10_000`; `payee_check(referrer)`. If `creditable(referrer, ref)`: `pay(referrer, ref)`. Otherwise `moved = pay(machine, ref)` and `team_sol += moved`.
9. `settled_mask |= 1<<pack`. Emit `PackSettled`.
10. If every pack is now settled: `payee_check(buyer)`; `close_to(pull → buyer)` if `creditable(buyer, pull.lamports)`, else `close_to(pull → machine)` with `credit_stock(lamports)`. Emit `PullClosed`.

An executable, program-owned, reserved, read-only or rent-unsafe payee must never make `settle` revert. Its share goes to the stock (royalty, Pull remainder) or to the team (referral), and an event says so (master DG-6). A payee can make `settle` fail only through a wrong key or `payee_check` (a live wallet passed read-only), both of which the caller controls.

### 9.11 `refund_pull(seq: u64)` — exit; permissionless

**Accounts:** `pull` (mut, `UncheckedAccount`); `machine` (mut); `binder` (mut; must equal `PDA(["binder", pull.buyer])`, checked in the handler); `buyer` (`UncheckedAccount`, **no Anchor `mut`**, A14).

**Steps:**
1. If the Pull is closed or missing, return `Ok(())`.
2. `pull.seq == seq` (`PullMismatch`); address check (`AccountMismatch`).
3. If `status ≠ Pending`, return `Ok(())`.
4. `now ≥ created_ts + VRF_TIMEOUT` (`TooEarlyToRefund`).
5. `buyer.key == pull.buyer`, and the Binder matches (`AccountMismatch`); `payee_check(buyer)` (§8.1).
6. Release:
   - for each pack, `buckets[backing].reserved −= P·COVERAGE_BPS/10_000` (saturating; skip if `backing ≥ 16`);
   - `reserved_dust −= 4·qty`; `pending_pulls −= 1`;
   - `binder.reserved −= 5·qty`; `binder.shrink_to_fit(buyer)`. A read-only buyer is not `creditable`, so its slot refund stays in the Binder, still the owner's.
7. `close_to(pull → buyer)`, which returns the full escrow plus the Pull rent, if `creditable(buyer, …)`; otherwise close to the Machine with `credit_stock(lamports)`.
8. Emit `PullRefunded`.

So a buyer whose address became a program can never leave a Pull stuck Pending. That matters beyond the buyer: `start_final_pull` (M4) needs `pending_pulls == 0`.

The 0.0005 SOL VRF fee is not refunded: MagicBlock keeps it, and this is disclosed. **There is never a second VRF request for the same Pull, and an expiry never pauses anything** (§10.4).

### 9.12 `redeem(card_index: u16, amount: u64)` — exit; never paused, any phase

**Accounts:**
- `owner` (signer, mut); `binder` (mut, `["binder", owner]`); `mint`;
- `ledger` (mut, `["ledger", mint]`); `vault` (mut, canonical); `vault_auth`;
- `destination` (mut, `== ATA(owner, mint, token_program)`); `token_program` (== `mint.owner`).

**Checks:**
- `card_index < len`, `cards[card_index].mint == mint.key` and `amount == card.amount`; otherwise `CardMoved`.
- `card.kind ≤ 8`, else `CardNotRedeemable`. Every card kind is redeemable (PARAMS §3.3); under J-B no Jackpot card is ever "still buying".

**Effects:**
1. `swap_remove(card_index)`; `shrink_to_fit(owner)`.
2. `vault_transfer(amount → destination)`; `accounted −= amount` (saturating).
3. Reload the vault. If `vault.amount < accounted`, emit `VaultShortfall` and still succeed (A17; unreachable while I1 holds). The transfer in effect 2 already fails if the vault holds less than `amount`.

**Event:** `CardRedeemed { owner, mint, amount, kind, card_index, moved_from, refund }`.

**Batch rule for clients:** at most 8 redeems per transaction, with indices in **descending** order (§15.4).

### 9.13 `team_withdraw()` — anyone

**Accounts:** `machine` (mut); `config`; `team_wallet` (mut, `== config.team_wallet`, else `AccountMismatch`).

**Steps:**
1. `other = stock_sol + jackpot_sol + burn_sol + final_pool_sol`.
2. `pay = min(team_sol, machine.lamports − rent_min(3808) − other)` (saturating).
3. If `pay == 0`, return `Ok(())`.
4. Require `creditable(team_wallet, pay)` (`AccountMismatch`).
5. Move `pay`; `team_sol −= pay`.

**Event:** `TeamWithdrawn`.

### 9.14 `close_vault()` — anyone

**Accounts:** `machine` (read-only); `mint` (**mut**: `burn_checked` lowers its supply); `ledger` (mut); `vault` (mut, canonical); `vault_auth`; `payer` (mut, `== ledger.payer`); `token_program` (== `mint.owner`).

**Steps:**
1. `ledger.accounted == 0` (`VaultNotEmpty`).
2. No bucket with `class ≠ 0` holds this mint (`MintListed`).
3. If `vault.amount > 0`, `vault_burn(vault.amount)`. Only donations can be left, since `accounted == 0` (master DG-4).
4. `vault_close(vault → payer)`; `close_to(ledger → payer)`.

**Event:** `VaultClosed { mint, payer, burned, lamports }`. A later Feed of the same mint recreates both accounts.

### 9.15 Stubs and `ping`

- The §1.2 stubs return `NotImplemented`.
- `ping` is unchanged from M0.

---

## 10. VRF integration (MagicBlock; the only provider in Season 1)

### 10.1 Facts (verified on 2026-10-08 against `ephemeral-vrf-sdk` 0.17.3 and MagicBlock's `solana-vrf` source)

- **Scoped mode.** `create_request_randomness_ix` builds a scoped, regular-priority request (instruction byte 10). `invoke_signed_vrf` rewrites that byte to 10 or 11 and signs with our `program_identity` PDA `["identity"]`. The VRF program requires `program_identity == PDA(["identity"], callback_program_id)` as a signer. So **only this program can create requests that call back into it**.
- **Request accounts:** `[payer (signer, w), program_identity (signer), oracle_queue (w, owned by the VRF program), system_program, slot_hashes]`.
- **Fee:** 500,000 lamports move from the payer to the queue at request time. They are not refunded on expiry.
- **Callback instruction:**
  - `data = callback_discriminator ‖ sha256(VRF output) (32 B) ‖ callback_args`;
  - `accounts = [scoped identity (signer, read-only)] ++ stored metas`, where the scoped identity is `PDA(["identity", our program id], VRF program)`;
  - the queue item is removed before the CPI. If the callback fails, the whole fulfilment fails and the oracle retries until the 120 s TTL; then the request is purged and the fee is kept.
- **Oracle transaction:** legacy; a compute limit of 300,000 for the whole transaction (400,000 at high priority); the default 32 KiB heap (no heap-frame request); no loaded-data-size limit. MagicBlock's proof check and queue handling cost about 25–45k CU, so **our callback must stay at or below 200,000 CU, and the whole fulfilment at or below 270,000 CU** (master CR-4).
- **The buyer controls one cost input.** The size of their own Binder sets how much account data the fulfilment loads (up to 65,535 slots, about 3.67 MB, adjustable 56 B at a time), and the cost also varies with the outcome. If a buyer could push the fulfilment close enough to the CU or heap limit that only some outcomes exceed it, those draws would revert, MagicBlock would purge them after its TTL, and the buyer would be refunded at 300 s: a free reroll. T06.16 measures that margin; never rely on the oracle's limit.
- **No executable-account filter in scoped mode.** That is one more reason the callback validates every account itself.
- **Deprecated, never use:** the legacy global identity `9irBy75…`, `create_request_legacy_*` and `create_request_regular_randomness_ix`.

### 10.2 Request (in `buy_packs`)

```rust
let caller_seed = hashv(&[b"1pct:vrf:v1", crate::ID.as_ref(), &seq.to_le_bytes(), buyer.key().as_ref()]).to_bytes();
let ix = create_request_randomness_ix(RequestRandomnessParams {
    payer: buyer.key(),
    oracle_queue: oracle_queue.key(),
    callback_program_id: crate::ID,
    callback_discriminator: crate::instruction::ConsumeRandomness::DISCRIMINATOR.to_vec(),
    caller_seed,
    accounts_metas: Some(vec![   // fixed order, all writable; never a user-supplied or outcome-dependent account
        SerializableAccountMeta { pubkey: pull.key(),    is_signer: false, is_writable: true },
        SerializableAccountMeta { pubkey: machine.key(), is_signer: false, is_writable: true },
        SerializableAccountMeta { pubkey: deck.key(),    is_signer: false, is_writable: true },
        SerializableAccountMeta { pubkey: binder.key(),  is_signer: false, is_writable: true },
    ]),
    callback_args: Some(seq.to_le_bytes().to_vec()),
});
ctx.accounts.invoke_signed_vrf(&ctx.accounts.buyer.to_account_info(), &ix)?;
```

- If `compat::Pubkey` differs from `anchor_lang::prelude::Pubkey` in your build, convert through `to_bytes()`.
- The handler signature `consume_randomness(ctx, randomness: [u8; 32], seq: u64)` matches the callback data order (`disc ‖ randomness ‖ seq LE`).

### 10.3 Callback identity and totality

Keep `#[vrf_callback]` exactly as generated (scoped identity). The callback is total (§9.9). Nothing the buyer controls between purchase and callback can make it fail:
- dust is picked against the live Deck, and House Cards absorb a short Deck;
- each pack's coverage is reserved at purchase, and its backing bucket stays a valid source even if disabled later (§11.7);
- rent changes are absorbed (§8.1–§8.3);
- arithmetic is saturating;
- there is no token CPI and no account creation;
- compute and heap stay within the oracle's limits for every Binder size and every outcome (§10.1, T06.16).

### 10.4 Expiry: no reroll, no global outage

- After `VRF_TIMEOUT` (300 s; MagicBlock's own TTL is 120 s), `refund_pull` returns the full price to the buyer. Anyone can call it; the keeper does.
- The same Pull is never drawn again: there is no re-request, and the account is closed.
- A late callback is skipped (reason 5).
- **There is no automatic breaker.** Expiries never pause anything. The monitor (ops lane) alerts the guardian, who decides whether to pause RIP. Other buyers are unaffected.
- If MagicBlock's queue rejects a request (full or paused), `buy_packs` fails cleanly; the SDK maps any error raised by the VRF program to copy key `busy` (§15.5). Exits are unaffected.

### 10.5 Queue allow-list and switching

- The admin adds up to `MAX_QUEUES` queues (`AddVrfQueue`); each must be owned by the VRF program.
- The guardian switches `active_queue` among the listed ones (`SelectVrfQueue`).
- `buy_packs` accepts only the active queue.

### 10.6 Mock VRF program (tests only, A5)

`app/test-programs/mock-vrf` is a native program loaded in LiteSVM **at the real VRF program id** `Vrf1RN…`, so the production program runs its real CPI unchanged. It is never deployed.

| Byte 0 | Instruction | Behaviour |
|---|---|---|
| 10 or 11 | request. Same accounts and data as MagicBlock: an 8-byte prefix, then borsh `{caller_seed [u8;32], callback_program_id Pubkey, callback_discriminator Vec<u8>, callback_accounts_metas Vec<{pubkey, is_signer bool, is_writable bool}>, callback_args Vec<u8>}` | Require `program_identity == PDA(["identity"], callback_program_id)` and that it signed; require the queue to be owned by self. System-transfer 500,000 lamports payer → queue. Append the raw request to the queue account's data (`[count u32][len u32, bytes]…`) so tests can read it |
| 0xF0 | `fulfill(index u32, randomness [u8;32])`; accounts `[queue (w), scoped_identity, callback_program, …callback metas]` | Load stored request `index` (fail if already consumed) and mark it consumed. CPI to `callback_program` with `data = disc ‖ randomness ‖ args` and `accounts = [scoped identity (signer)] ++ stored metas`, signed with `["identity", callback_program_id, bump]`. Propagate errors |
| 0xF1 | `fulfill_raw(disc_len u8, disc, randomness, args_len u16, args)`; accounts `[scoped_identity, callback_program, …any accounts]` | The same CPI with caller-chosen accounts and args, for adversarial tests (wrong accounts, duplicate or stale callbacks) |
| 0xF2 | `fulfill_raw_global(…)` | As 0xF1, but signed as the legacy global identity `PDA(["identity"], VRF program)`. The callback must reject it |
| 0xF3 | `cpi_passthrough(data)`; accounts `[target_program, …any accounts]` | Invoke `target_program` with the given accounts (signer and writable flags as passed; the outer transaction's signers carry through) and `data`. Used by T03.21 to call `feed` by CPI |

A host test builds a request with the real `ephemeral_vrf_sdk::instructions::create_request_randomness_ix` and checks that the mock decodes it byte-for-byte (except byte 0).

### 10.7 What `/fairness` will say (later milestone; keep it true)

SPEC §8.4 said MagicBlock "can order fulfilments, but it cannot change an outcome". That is not literally true, so it is replaced:
- **Order changes outcomes.** Liveness is evaluated when a draw lands. So the delivery order decides which of two pending Pulls gets the single live The 1% card or the Jackpot pot. If a special segment turns on or off between two fulfilments, every lower range (Black, Holo, Blue, Silver) shifts. The executor's JackpotBuy timing can switch the Jackpot live in between. Dust picks, the bucket pick and the carved token amount depend on the Deck and the stock when the draw lands.
- **The proof checker is upgradeable.** It is MagicBlock's program, which MagicBlock can upgrade; we pin only its id (§6.1).

The page will say (COPY.md, M3, takes the final wording):

> Your draw is a MagicBlock VRF output, checked on-chain by MagicBlock's program (which MagicBlock can upgrade). MagicBlock runs one oracle: it can delay or withhold a draw (you can take your price back after 5 minutes), and it decides when your draw lands, including the order in which draws land. That timing matters only through the machine's state when your draw lands: whether The 1%, a Spotlight or the Jackpot is live (which also moves where the other tiers' ranges start), which Dust Cards are in the machine, and which coin and how many tokens the stock gives for your hit. The operator could withhold its own losing draws.

- Every Pull stores its randomness and `seq`, and the derivations in §11 are public.
- The Verify page (M3) shows each pack's widths (`PackRevealed.widths`) and the Pull's landing position: its slot and its order among the reveals, from the indexer.

---

## 11. Exact math (integer only; `math/`, pure functions, mirrored in the SDK)

### 11.1 Split of each pack price P (u128 intermediates, floor)

```
royalty  = P·ROYALTY_BPS/10_000     (×4 Dust Cards; a House Card's royalty goes to the stock)
jackpot  = P·JACKPOT_BPS/10_000     → jackpot_sol
burn     = P·BURN_BPS/10_000        → burn_sol
referral = P·REFERRAL_BPS/10_000    → the Pull (paid at settle) if the Pull has a referrer, else team_sol
team     = P·TEAM_BPS/10_000        → team_sol
stock    = P − 4·royalty − jackpot − burn − referral − team     → stock_sol   (remainder: exactly 7_200 bps)
```

Worked example, OG (P = 100,000,000): royalty 2,000,000; jackpot 5,000,000; burn 5,000,000; referral 2,000,000; team 8,000,000; stock 72,000,000.

### 11.2 Tier values

`V = P·VALUE_BPS[tier]/10_000`: Silver `P/2`, Blue `3P/2`, Holo `4P`, Black `15P`. This is exact for all four prices. OG: 50,000,000 / 150,000,000 / 400,000,000 / 1,500,000,000 lamports.

### 11.3 Segments (ppb), walked in this order

| # | Segment | Result (card kind) | Width | Live when |
|---|---|---|---|---|
| 1 | The 1% | 6 one_pct | `P/C_DIV`, or `(P/C_DIV)·HOLDER_BPS/10_000` for a holder | M4 (never in M1) |
| 2 | Spotlight | 7 spotlight | `P/S_DIV` | M4 (never in M1) |
| 3 | Jackpot | 5 jackpot | `P/JP_DIV` | M4: `jackpot_cost ≥ JP_MIN_MULT·P` (J-B; never in M1) |
| 4 | Black Foil | 4 black | `BLACK_PPB` | always |
| 5 | Holo Foil | 3 holo | `HOLO_PPB` | always |
| 6 | Blue Foil | 2 blue | `BLUE_PPB[E]` | always |
| — | Silver Foil | 1 silver | the rest of 10⁹ | always |

`draw` returns the card kind in the "Result" column; `tier` in §9.9 and §11.7 means that code. In M1, kinds 5–7 are unreachable because their widths are 0. If one is ever returned, the callback writes no hit card, releases its slot and emits `HitSkipped` (§9.9 step 3d), and P2 asserts that never happens.

### 11.4 Tier draw

```
h = H("1pct:tier:v1" ‖ randomness[32] ‖ seq u64 LE ‖ pack u8)             // 53 bytes in
t = ((u64le(h) as u128 · 1_000_000_000) >> 64) as u32                    // t ∈ [0, 10⁹)
widths = [C?, S?, J?, BLACK_PPB, HOLO_PPB, BLUE_PPB[E]]   (0 for a segment that is not live)
acc = 0; for each segment in §11.3 order: acc += width; if t < acc → that segment's tier
otherwise Silver
```

### 11.5 Dust pick

```
h   = H("1pct:dust:v1" ‖ randomness ‖ seq u64 LE ‖ pack u8 ‖ k u8)        // 54 bytes in
idx = ((u64le(h) as u128 · len as u128) >> 64) as u32                    // len = current deck.len (it shrinks after every pick)
```

The bias is at most len / 2⁶⁴. The four picks of a pack are distinct because of the swap-remove.

### 11.6 Coverage reservation (purchase) and `max_qty`

```
need = P·COVERAGE_BPS/10_000                                                     (15·P)
for each pack i in 0..qty:
  b = argmax over buckets with class == Major ∧ enabled == 1 of free(b)    (ties: lowest index)
  require free(b) ≥ need            else Refilling (the whole instruction fails)
  reserved(b) += need; packs[i].backing = b
```

- `max_qty(E)` (the SDK and `math/coverage.rs`) is the largest `q ≤ MAX_QTY[E]` such that `deck.len ≥ reserved_dust + 4q + DUST_BUFFER` and the greedy loop places `q` packs.
- TRENDING and disabled buckets never back coverage.

### 11.7 Bucket pick and carve (callback, stock tiers only)

```
eligible(b) = class(b) ≠ 0 ∧ enabled(b) ∧ (¬MAJOR_ONLY[tier] ∨ class(b) == Major)
              ∧ free(b) ≥ V ∧ V·A(b) ≥ C(b)                                    (u128)
cands = eligible buckets in ascending index
total = min(Σ free(b) over cands, u64::MAX)        (u128 saturating sum, then capped, so the product below fits in u128)
if cands non-empty:
    y = (u64le(H("1pct:bucket:v1" ‖ randomness ‖ seq u64 LE ‖ pack u8)) as u128 · total) >> 64
    walk cands accumulating free(b) (u128, saturating); pick the first with y < acc
else (only possible if the guardian disabled the pack's backing bucket after purchase):
    b = packs[i].backing (enabled or not) if b < 16 ∧ free(b) ≥ V
    otherwise no source → HitSkipped (unreachable while I3 holds)
x = (V == C(b)) ? A(b) : floor(V·A(b)/C(b))          (u128; rounds toward the machine)
if x == 0 → HitSkipped (unreachable for real tokens)
A(b) −= x; C(b) −= V                                   (no token moves; the ledger is unchanged)
```

**Why the backing bucket is always a valid fallback:** the purchase reserved `15·P ≥ V` in it, the release in step 3a frees exactly that, and nothing else may consume reserved capacity. So every drawn stock tier is payable. There is no void path and no downgrade.

### 11.8 Hour counters: `rotate_hour(now)` (A16)

One `hour_index` serves four Machine fields: the two hit counters and the two Sell back fields. (The burn cap and each bucket's trending cap keep their own indexes, `burn_hour_index` and `trend_hour_index`, M2.) One helper, `math/hour.rs::rotate_hour`, starts each new UTC clock hour for those four fields (PARAMS §0.6):

```
rotate_hour(now):
  h = max(now, 0) / 3600
  if h ≠ hour_index:
      hit_out_last_hour = (h == hour_index + 1) ? hit_out_this_hour : 0     (saturating +1)
      hit_out_this_hour = 0
      sb_paid_hour      = 0              // Sell back paid this hour (M2 adds to it)
      sol_at_hour_start = stock_sol      // base of the hourly Sell back budget (PARAMS §9.2)
      hour_index        = h
```

- It saturates and has no error path.
- Every instruction that reads or writes one of these fields calls it first: the callback in M1 (§9.9 step 2, before the pack splits, so `sol_at_hour_start` is the stock before this reveal); `sell_back`, `exec_*` and `collect_creator_fees` later.
- Off-chain mirrors (the SDK's `rotateHour`, X2's Sell back pre-check) read `hour_index`. If `floor(now / 3600) ≠ hour_index`, they apply the same rotation before using the fields.

Each carved hit adds `V` to `hit_out_this_hour`.

### 11.9 Rounding directions (PARAMS §16.4)

| Quantity | Rule | Direction |
|---|---|---|
| Split | bps of price; the stock takes the remainder | exact for all prices |
| Tier, dust index, bucket pick | `(u64 · n) >> 64` | bias ≤ n / 2⁶⁴ |
| Carved tokens | `floor(V·A/C)` | toward the machine (< 1 base unit) |
| Deck entry, Binder slot and Pull refunds | `min(stored or excess, what keeps the account rent-exempt)` | never below rent-exempt; never reverts |
| Donated tokens and lamports | never credited to anyone. Tokens are burned at `close_vault`; lamports leave with the account's rent to its payer; Pull donations go to the buyer at close | — |

### 11.10 Check values (encoding sanity; put them in unit tests on both sides)

| Input | Output |
|---|---|
| tier: randomness = 32 × 0x00, seq = 1, pack = 0 | `u64le(h)` = 14,507,760,809,896,608,530 → t = **786,467,289** (Silver) |
| tier: same, pack = 1 | t = **67,122,303** (Blue in every edition when no special segment is live) |
| tier: randomness = 32 × 0xFF, seq = 7, pack = 3 | t = **535,533,360** |
| dust: randomness = 32 × 0x00, seq = 1, pack = 0, len = 1,000, k = 0 / 1 / 2 / 3 (each computed with len 1,000) | idx = **223 / 200 / 475 / 529** |
| bucket: randomness = 32 × 0x00, seq = 1, pack = 0, total = 10¹⁰ | y = **6,889,519,747** |
| caller_seed: program id = 32 × 0x00, seq = 1, buyer = 32 × 0x01 | `293bd9158352a1106604a846a4b37cea22303eb6c4b1bcdab7b287d7500dcd1a` |
| FEED bags_hash: one bag, mint = 32 × 0x02, amount = 1,000 | `7a380214e4ff5226d75c80fd9125c5cc6906632a09683438e381e6b1af096af7` |

---

## 12. Events (`#[event]`, emitted with `emit!`)

| Event | Fields |
|---|---|
| `Initialized` | version u16, admin |
| `ConfigChanged` | action u8, actor, key Pubkey, a u64, b u64. Action codes: 1 SetRole · 2 SetTeam · 3 SetSeason · 4 SetTokenMint · 5 AddVrfQueue · 6 UpdateBucket · 7 AdminPause · 8 GuardianPause · 9 DisableBucket · 10 LowerCap · 11 DisableRole · 12 SelectVrfQueue · 13 ListMint |
| `PhaseAdvanced` | from u8, to u8, ts i64 |
| `BagFed` | depositor, mint, amount, deck_index u32, deposit u64, fresh_in_deck u16 |
| `BagTakenBack` | depositor, mint, amount, deck_index u32, moved_from u32, refund u64 |
| `PullOpened` | pull, seq, buyer, edition, qty, price, referrer, holder bool, queue, created_ts, backing [u8; 10] (255 = unused) |
| `PackRevealed` | seq, pack u8, edition, live_flags u8, holder bool, t u32, widths [u32; 6] (C, S, J, Black, Holo, Blue as used), tier u8, hit_bucket u8, house_mask u8, hit_mint, hit_amount u64, hit_value u64, dust [DustPick; 4] |
| `DustPick` (type) | deck_len_before u32, index u32, moved_from u32, mint, amount u64, depositor, refund u64 |
| `PullRevealed` | pull, seq, buyer, randomness [u8; 32], qty, hit_value_total u64, to_stock u64, to_jackpot u64, to_burn u64, to_team u64, shortfall u64 |
| `CallbackSkipped` | pull, seq, reason u8 (1 PullInvalid · 2 PullAddress · 3 SeqMismatch · 4 NotPending · 5 Late · 6 MachineInvalid · 7 DeckInvalid · 8 BinderInvalid · 9 NotWritable) |
| `HitSkipped`, `CardDropped` | seq, pack, tier, value. Both are unreachable in M1 (`HitSkipped` covers no source, `x == 0` and the special kinds 5–7); the property suites assert they never fire on valid states |
| `PackSettled` | pull, seq, pack, paid [u64; 4], redirected_mask u8, referral_paid u64, referral_to_team u64 |
| `RoyaltyRedirected` | seq, pack, slot u8, depositor, amount |
| `PullClosed` | pull, seq, to, lamports, to_stock bool |
| `PullRefunded` | pull, seq, buyer, amount |
| `CardRedeemed` | owner, mint, amount, kind u8, card_index u16, moved_from u16, refund u64 |
| `TeamWithdrawn` | to, amount |
| `VaultClosed` | mint, payer, burned u64, lamports u64 |
| `VaultShortfall` | mint, vault_amount u64 (after the transfer), accounted u64. Emitted by `take_back` and `redeem` instead of reverting (A17), for the monitor. Unreachable while I1 holds; P1, P2 and T11.06 assert it never fires on valid states |

**Log budget:** an OG ×10 callback must log at most 9,000 bytes in total, with no "Log truncated" line (T06.17, reported per §16.3). If it does not fit, report it with numbers; do not silently drop fields. The indexer also reconciles from account state (master §7.1).

---

## 13. Errors (`#[error_code]`, in this order from 6000; stable, never renumbered)

`Unauthorized`, `RoleDisabled`, `Paused`, `WrongPhase`, `SeasonOver`, `InvalidArgument`, `InvalidEdition`, `InvalidQuantity`, `TeamWallet`, `NotWallet`, `MintNotSafe`, `MintForbidden`, `NotPumpFun`, `DuplicateMint`, `TokensNotReceived`, `AttestationInvalid`, `AttestationExpired`, `AttestationReplay`, `FreshCapReached`, `DeckFull`, `DeckUnderfunded`, `VaultMismatch`, `LedgerMismatch`, `AccountMismatch`, `CardMoved`, `CardNotRedeemable`, `Refilling`, `MachineHungry`, `LiveFlagsChanged`, `QueueNotAllowed`, `BinderFull`, `PullNotRevealed`, `PullMismatch`, `TooEarlyToRefund`, `BucketsFull`, `BucketExists`, `BucketInvalid`, `TrendingLimit`, `VaultNotEmpty`, `MintListed`, `SeasonAlreadySet`, `InvalidRole`, `MathOverflow`, `VaultInvariant`, `MultipleFeeds`, `NotImplemented`, `NotTopLevel`.

`VaultInvariant` stays for the entries that must revert on `vault.amount < accounted` (`exec_end`, `power_on`, `sell_back`, `spotlight_deposit` later). In M1, `feed` keeps I1 through H4 (`TokensNotReceived`) and `close_vault` through `VaultNotEmpty`.

`#[msg]` strings are short and neutral, and contain no forbidden word.

---

## 14. Invariants (M1 subset of master §9.1)

| # | Invariant | Asserted in code | Checked by tests |
|---|---|---|---|
| I1 | For every mint: `vault.amount ≥ ledger.accounted`, and `accounted == Σ Deck entries + Σ cards + bucket A` of that mint | entries refuse to break it (`TokensNotReceived`, `VaultNotEmpty`); `take_back` and `redeem` emit `VaultShortfall` instead of reverting (A17) | every step |
| I2 | `Machine.lamports ≥ rent_min(3808) + stock_sol + jackpot_sol + burn_sol + team_sol + final_pool_sol` | `team_withdraw` caps its payout | every step |
| I3 | For every bucket, `reserved ≤ C`; and `Σ reserved == 15 × Σ price` over the packs of Pending Pulls | — | every step |
| I4 | Over Pending Pulls: `reserved_dust == 4 × Σ qty`, `pending_pulls == #Pending`, and `Σ binder.reserved == 5 × Σ qty` | — | every step |
| I5 | A Pending Pull holds `lamports ≥ rent + qty·P`. A Revealed one holds `lamports ≥ rent + Σ unsettled (royalty + refund) + unsettled referral`, up to the rent-increase shortfall, which then goes to the buyer | — | every step |
| I6 | Deck: `len ≤ cap ≤ DECK_MAX`; data length `64 + 80·cap`; rent-exempt unless the rent rose | — | every step |
| I7 | Binder: `len + reserved ≤ cap`; `fresh_in_deck == #FRESH Deck entries of that depositor + #FRESH picks not yet settled`; `fresh_in_deck ≤ FRESH_CAP` | — | every step |
| I8 | Every stock-hit card has `value == P·VALUE_BPS/10_000` for its tier and price. In M1, `C(b)` changes only by carving (−V) | — | every step |
| I9 | Transitions are monotonic: a Pull goes Pending → Revealed → closed, or Pending → closed; the phase only moves forward | — | property suites |
| I10 | No exit reads a pause bit, needs an attestation, or reads Config (except `team_wallet`) | by construction (§9.0) | T04.04, T07.09, T08.04, T09.04, T11.04 |
| I11 | `consume_randomness` returns `Ok` in every state after the identity check; it makes no inner instruction and touches only its 4 accounts | — | T06.*, CR-1 to CR-6 |
| C1 | Lamport conservation: Σ lamports over all accounts before == after + transaction fees (the VRF fee stays in the queue account) | — | every step |
| C2 | Token conservation per mint: Σ balances constant, except `close_vault` burns, which equal the donated amount | — | every step |

---

## 15. `packages/sdk`

### 15.1 Modules

```
src/index.ts         re-exports
src/constants.ts     PROGRAM_ID (from the IDL, M0), external IDs (§6.1), seeds, tags, sizes, encodings; economics from packages/config;
                     RESERVED_KEYS (every sysvar and builtin program id the runtime demotes to read-only; §15.4)
src/pda.ts           configPda, machinePda, deckPda, vaultAuthPda, feeInPda, programIdentityPda, binderPda(owner),
                     pullPda(buyer, nonce), ledgerPda(mint), vaultAta(mint, tokenProgram), userAta(owner, mint, tokenProgram),
                     bondingCurvePda(mint), scopedVrfIdentity()
src/layouts.ts       decode/encode for Config, Machine (+ Bucket and the M2 and M4 structs), Deck (header + entries, optional range),
                     Binder (+ cards), Pull (+ packs), MintLedger — explicit offsets from §7; bigint for u64/i64
src/math/*.ts        splitPack, tierValue, segments, drawTier, dustIndex, bucketPick, carve, maxQty, deposits(rentPerByte),
                     feedNonces(base, bits, count), rotateHour(machine, now) — the Verify library's core
src/attest.ts        feedMessage, holdMessage, bagsHash, ed25519Instruction({publicKey, signature, message}),
                     attestationExpiry(blockTime, ttlSeconds) = blockTime + ttlSeconds − 10 (§8.6)
src/ix/*.ts          one builder per instruction (args object → TransactionInstruction), with explicit account ordering
src/tx/*.ts          planFeedTransactions, buildTakeBackTransactions, buildRedeemTransactions, buildSettleTransaction,
                     buildRefundTransaction, buildBuyPacksTransaction, serializedSize
src/fetch.ts         thin RPC readers (account existence, decimals, Binder nonces, Deck ranges, payee `executable` flags) with web3.js
src/errors.ts        program error → { name, copyKey } (strings come from COPY.md, master §7.6)
```

### 15.2 Rules

- Builders are pure: explicit inputs, no RPC.
- `u64` values are `bigint`.
- Economic numbers are imported from `packages/config`; there are no literals.
- The Ed25519 instruction is built byte-for-byte (§8.6).

### 15.3 Codecs

- The fixed parts may use `@anchor-lang/core`'s `BorshCoder`. Zero-copy structs with explicit padding have the same bytes as their Borsh layout.
- The tails (Deck entries, Binder cards, Pull packs) are hand-written.
- `layouts.test.ts` checks every size and offset against `fixtures/vectors/layouts.json`.

### 15.4 Transaction builders and the byte budget (A7)

**Feed** (`planFeedTransactions({wallet, bags, lut?, attest})`):
- one `feed` per transaction;
- bags are packed greedily while `serializedSize(tx with dummy signatures) ≤ 1,047` bytes (85% of 1,232, master §7.5);
- per bag: `create_idempotent(vault ATA)` only if `vaultExists == false`; `transfer_checked(source → vault, amount, decimals, authority = wallet)`; and, after `feed`, `close_account(source → wallet)` if `closeSource`;
- instructions in the order of §9.6;
- nonces from `feedNonces(base, bits, k)`;
- `attest(chunk)` returns `{expiry, signature}` (from the intake signer later; from a local test key in tests), with `expiry` from `attestationExpiry` (§8.6);
- with a lookup table (address + addresses), the builder emits v0 transactions.

**Architect's estimate, for orientation** (Codex measures the real figures):

| Shape | Size (with A2's 121-byte attestation message) |
|---|---|
| 1 bag, legacy | ≈ 964 B (12 fixed + 5 per-bag keys = 17 keys × 32 B; ed25519 ≈ 237 B; feed ≈ 47 B; transfer 17 B; close 7 B; create 10 B) |
| 2 bags, legacy | ≈ 1,170 B: within 1,232, above the 1,047 budget |
| 2 bags, v0 with a lookup table of Config, Machine, Deck, `vault_auth`, System and the instructions sysvar | ≈ 1,020 B |
| 3 bags, v0 with that lookup table | ≈ 1,226 B |

These figures leave out compute-budget instructions: add about 45–60 B for `SetComputeUnitLimit` plus a priority-fee price, which can push 2 bags with the lookup table over 1,047 B. A bag whose vault already exists saves the 10-byte `create_idempotent`. With SPEC's inline attestation, add 40 B per bag. So "4 bags (≈ 6 with the lookup table)" cannot hold. Report the measured table (§16.3); PARAMS `TX_LIMITS` and the copy take it.

**Take-back / Redeem:**
- at most 8 instructions per transaction, within 1,232 B;
- one `create_idempotent(userAta)` per mint (payer = wallet);
- indices sorted **descending** within a transaction, so earlier removals never move later targets.

**Settle:** at most 2 packs per transaction, with the named accounts of §9.10, plus a Memo `1pct:roy:<seq>` (master §7.5).

**Payee writability (A14), in the `settle` and `refund_pull` instruction builders (and so in `buildSettleTransaction` and `buildRefundTransaction`).** The IDL lists the payees (`buyer`, `referrer`, `wallet_k`) and `settle`'s `binder_k` as read-only, because the program declares them without `mut`. The builders override that: each of them is writable, except a payee that is in `RESERVED_KEYS` or whose fetched account is executable, which is passed read-only. A placeholder shares its account's flag. Each payee's `executable` flag is an input (read by `fetch.ts`), so the builders stay pure.

**BuyPacks:** `[SetComputeUnitLimit] [ed25519 HOLD?] buy_packs`.

Compute-unit limits come from `CU_LIMITS` in `packages/config` (§16.3).

### 15.5 Error → copy key (strings live in COPY.md, M3)

| Program error | copyKey | Reference copy (SPEC §2.6 / §2.3) |
|---|---|---|
| `LiveFlagsChanged` | `machineChanged` | "The machine changed while you were signing. Nothing was charged." |
| `Refilling` | `refilling` | "{Edition} opens when one major holds {15 × price} SOL free ✳ now {x}" |
| `MachineHungry` | `hungry` | "Machine hungry ✳ Feed bags or feed back your dust" |
| `AttestationExpired`, blockhash expired | `tooLong` | "Took too long. Tap again." |
| `FreshCapReached` | `freshCap` | "25 fresh cards already in the machine; more when some are pulled" |
| `NotPumpFun`, `MintNotSafe`, `MintForbidden` | `notInSet` | "Not from pump.fun" / "Not supported (token extensions)" |
| `SeasonOver`, `WrongPhase` (Rip) | `seasonOver` | "Season over ✳ Redeem and take-back stay open forever" |
| `QueueNotAllowed`; any error raised by the VRF program `Vrf1RN…` inside a `buy_packs` transaction | `busy` | "Machine busy ✳ try again in a few seconds." |
| `BinderFull` | `myCardsFull` | "My cards is full ✳ Redeem, sell or feed some cards" (PARAMS §24 A6) |
| `CardMoved` | `cardMoved` | silent re-read and retry; shown only if the retry fails |
| wallet rejection (client side) | `walletNo` | "Wallet said no. Nothing was sent." |
| every other program error | `generic` | (COPY.md) |

- **VRF errors are matched by the failing program id, never by error code.** MagicBlock's codes are not ours to pin. The failing program is the one named in the last `Program <id> failed` log line, or the program of the failing inner instruction.
- `errors.test.ts`: every IDL error maps to one entry (the named ones above, `generic` otherwise); a recorded VRF failure inside `buy_packs` maps to `busy`.

---

## 16. Tests

### 16.1 Rust harness (`tests/common/`)

**`Env::new()`:**
- LiteSVM 0.16.0 with the `precompiles` feature, signature verification **on** (so the Ed25519 precompile really verifies), and the default SPL programs.
- `onepercent.so` installed through the **upgradeable loader layout**: `set_account` the ProgramData first (upgrade authority = the test deployer), then the Program account.
- `mock_vrf.so` installed at `Vrf1RN…`, and a 64 KiB queue account owned by the VRF program.
- **Rent set so that `minimum_balance(n) == (128 + n) × 5,080`**, using whatever fields `solana-rent` 4.x exposes. Clock and slot set.
- Runs `initialize` (rent buffer 50,000,000), `SetSeason`, a warp past `stock_up_ts`, and `advance_phase` → StockUp.

**Required helpers:**
- `warp(secs)`; `set_rent(per_byte)` with the PARAMS test rates 5,080 / 2,575 / 1,322 / 696 / 6,960;
- `inject_phase(phase, on_air_ts, end_ts)`;
- `seed_bucket(idx, mint, class, A, C)`: lists the mint if needed, mints `A` into the vault, sets A and C, and adds `A` to `ledger.accounted`;
- `inject_deck(n_entries)`: up to `DECK_MAX` entries, written directly, with the lamports funded;
- `new_pump_mint(Spl | Token2022Metadata | Forbidden(ext))`: a real mint plus a fake BondingCurve account (pump owner, discriminator, length 81 / 150 / 166). The Token-2022 metadata mint must be valid for Token-2022's own `transfer_checked`; build it with Token-2022 instructions, or as raw TLV bytes if that is simpler;
- `user_with_bag(mint, amount)`;
- `feed`, `take_back`, `buy`, `fulfill(pull, randomness)`, `fulfill_raw`, `settle`, `refund`, `redeem`;
- `donate_lamports(acct, x)`, `donate_tokens(vault, x)`;
- `snapshot()` (decodes every program account) and `check_invariants()` (§14), run after every step of every test;
- `export_fixtures(dir, now)`: writes every account as `solana account --output json`-style files, for the validator runs (§16.5, §16.6). Timestamps are rebased on `now` (the current wall clock at export time), so an injected OnAir state stays valid on a live validator;
- `make_program(addr)`: turns an existing wallet address into an upgradeable-loader program (Program account at `addr`, executable, plus its ProgramData), as a user could do with their own keypair;
- `cu_of(tx_meta, program)`: parses "Program … consumed N of M compute units";
- `reference.rs`: an **independent** naive implementation of §11, written separately from `math/`.

Randomness for targeted tier tests is found by searching `reference::draw` for a value that produces the wanted tier.

**Rent-state enforcement.** If LiteSVM 0.16.0 does not enforce the runtime's rent-state transition rule, add an explicit post-transaction rent-state assertion for every writable program account, and say so in the PR.

**Mainnet feature set.** LiteSVM enables every feature by default, which is what most tests use. T06.16, T07.11 and T08.06 also run on the mainnet feature set: `fixtures/mainnet/features.json`, the active feature ids with their slot and date, recorded by spike S0 and loaded through LiteSVM's `with_feature_set`. If that file is missing when you reach these tests, stop and ask. If LiteSVM does not demote reserved keys to read-only, or does not apply the mainnet write-lock rules for executable accounts, run T07.11 and T08.06 in the validator e2e as well (§16.6), and say so in the PR.

### 16.2 Named tests (given / when / then; master suite ids in brackets)

**t01_init_admin.rs**

| ID | Name | Given | When | Then |
|---|---|---|---|---|
| T01.01 | `init_by_upgrade_authority` | upgradeable deploy, authority A | A initializes with rent buffer 50,000,000 | Config = params, `vrf_program` set; Machine phase Setup, next_seq 1, lamports = rent_min(3808) + 50,000,000; Deck 64 B, len = cap = 0; FeeIn holds rent_min(0); `Initialized` |
| T01.02 | `init_rejects_other_signer` | — | B ≠ A initializes | `Unauthorized` |
| T01.03 | `init_twice_fails` | initialized | initialize again | fails (account in use) |
| T01.04 | `set_role_rotates_and_reenables` | guardian disabled intake | admin `SetRole(5, K2)` | intake = K2; bit cleared; a feed signed by K2 works |
| T01.05 | `admin_actions_reject_non_admin` | — | a guardian or a random signer runs each `AdminAction` | `Unauthorized` for all |
| T01.06 | `set_season_rules` | Setup | `SetSeason` twice; in StockUp; with a future slot | 2nd → `SeasonAlreadySet`; StockUp → `WrongPhase`; future slot → `InvalidArgument` |
| T01.07 | `set_token_mint_only_in_setup` | StockUp | `SetTokenMint` | `WrongPhase` |
| T01.08 | `add_vrf_queue_rules` | — | wrong owner; duplicate; a 5th queue | `QueueNotAllowed` / `InvalidArgument` / `InvalidArgument` |
| T01.09 | `list_mint_happy` | safe SPL mint, vault exists | `admin_list_mint(Major, cap)` | bucket 0 filled (decimals, token_program); ledger created, payer = admin |
| T01.10 | `list_mint_rejections` | — | unsafe / $1PCT / wSOL / duplicate / 17th / 5th enabled TRENDING / missing vault | `MintNotSafe` / `MintForbidden` ×2 / `BucketExists` / `BucketsFull` / `TrendingLimit` / `VaultMismatch` |
| T01.11 | `guardian_powers_bounded` | guardian | each `GuardianAction`; raise a cap; disable the admin role; select an unlisted queue; random signer | allowed ones succeed; `InvalidArgument` / `InvalidRole` / `QueueNotAllowed` / `Unauthorized` |
| T01.12 | `guardian_cannot_clear_admin_pause` | admin paused FEED | guardian clears FEED | feed still `Paused`; after the admin clears it, feed works |
| T01.13 | `pause_mask_enforced` | — | bits 0x20 (admin and guardian) | `InvalidArgument` |
| T01.14 | `advance_phase_rules` | — | before / after `stock_up_ts`; PoweredOn at `on_air_ts`; OnAir at `end_ts`; nothing due | each transition happens exactly once; otherwise a no-op `Ok`; never backwards |
| T01.15 | `stubs_return_not_implemented` | — | each §1.2 stub | `NotImplemented` |

**t02_mint_safety.rs** (unit tests on raw data, plus integration through `feed`)

| ID | Name | Then |
|---|---|---|
| T02.01 | `spl_null_authorities_safe` | `Ok(decimals, SPL)` |
| T02.02 | `authorities_or_decimals_rejected` | mint authority set / freeze authority set / decimals 10 → `MintNotSafe` |
| T02.03 | `t22_metadata_pointer_and_metadata_safe` | `Ok(_, Token2022)`; feed works end-to-end |
| T02.04 | `t22_each_other_extension_rejected` | table over every type 1–27 except 18 and 19, plus 28 and an unknown 0x7FFF → `MintNotSafe` |
| T02.05 | `t22_malformed_rejected` | account-type byte ≠ 1; length 100; TLV length past the end → `MintNotSafe` |
| T02.06 | `wrong_owner_rejected` | mint owned by System or another program → `MintNotSafe` |
| T02.07 | `bonding_curve_lengths_accepted` | 81 / 150 / 166 B → ok |
| T02.08 | `bonding_curve_rejections` | missing / wrong owner / wrong discriminator / another mint's PDA / 7 bytes → `NotPumpFun` |
| T02.09 | `forbidden_mints` | `token_mint`, wSOL, Token-2022 native mint → `MintForbidden` |
| T02.10 | `extension_codes` | `MetadataPointer as u16 == 18`, `TokenMetadata as u16 == 19` |

**t03_feed.rs**

| ID | Name | Given | When | Then |
|---|---|---|---|---|
| T03.01 | `feed_one_spl_bag` | StockUp; user holds 1,000 of pump coin X (SPL); nonce 0 | SDK-shaped tx: ed25519, create vault, transfer, feed, close | Deck len 1 `{user, X, 1000, deposit 406,400, FRESH}`; ledger created, payer user, accounted 1000; vault 1000; fresh_in_deck 1; window base 1; user paid 406,400 (entry) + 1,056,640 (ledger) + 1,488,440 (vault ATA) + 1,219,200 (Binder header) and got the emptied account's rent back; `BagFed(deck_index 0)` |
| T03.02 | `feed_one_t22_bag` | Token-2022 metadata coin | same | same effects; vault 170 B |
| T03.03 | `feed_six_bags_and_seven_rejected` | 6 distinct coins | feed 6; then feed 7 | 6 entries; 7 → `InvalidArgument` |
| T03.04 | `no_transfer_with_slack_rejected` [DG-3] | 5,000 X donated to the vault | feed X 1,000 without a transfer | `TokensNotReceived`; accounted unchanged |
| T03.05 | `transfer_shapes_rejected` | — | partial amount / other destination / transfer after feed / delegate authority / plain `Transfer` (3) | `TokensNotReceived` each |
| T03.06 | `two_feeds_one_tx_rejected` | — | two feed instructions | `MultipleFeeds` |
| T03.07 | `attestation_rejections` [S3] | — | wrong signer key; offsets pointing to another instruction; 2 signatures; out-of-bounds offsets; message differs in nonce / expiry / program id / bag order; expired; expiry > now + 120; `att_ix` not ed25519; out of range | `AttestationInvalid` (structure, signer, message) / `AttestationExpired` (time) |
| T03.08 | `nonce_window` | base 0 | land nonces 2, 0, 1 in that order; replay 1; nonce 40 | all three ok, base 3; replay → `AttestationReplay`; 40 → ok, and the base slides to 25 |
| T03.09 | `phase_rules` | Setup / StockUp / PoweredOn / OnAir / BuysClosed / OnAir with now ≥ end | feed | `WrongPhase` / ok / ok / ok / `WrongPhase` / `SeasonOver` |
| T03.10 | `pause_and_role` | FEED paused by the guardian; by the admin; intake disabled | feed | `Paused` / `Paused` / `RoleDisabled` |
| T03.11 | `team_and_non_wallet_rejected` | team wallet; depositor account assigned to another program | feed | `TeamWallet` / `NotWallet` |
| T03.12 | `fresh_cap` | 25 fresh cards | 26th; take one back; feed again | `FreshCapReached`; then ok |
| T03.13 | `bad_inputs` | — | duplicate mint; amount 0; remaining count ≠ 4n | `DuplicateMint` / `InvalidArgument` ×2 |
| T03.14 | `prefunded_pdas` [DG-5] | lamports donated to `ledger(X)` and `binder(user)` | feed | ok, accounts created correctly |
| T03.15 | `vault_and_ledger_mismatch` | ATA of another owner; wrong ledger PDA | feed | `VaultMismatch` / `LedgerMismatch` |
| T03.16 | `deck_full` | Deck injected at `DECK_MAX − 1` | feed 2 | `DeckFull` |
| T03.17 | `deck_underfunded_after_rent_increase` | 10,000 entries at 5,080; rent set to 6,960 | feed; then take_back | feed → `DeckUnderfunded`; take_back succeeds |
| T03.18 | `second_depositor_same_mint` | ledger X exists | user 2 feeds X | ledger payer unchanged; accounted sums |
| T03.19 | `vault_precreated_by_attacker` [DG-7] | a third party ran `create_idempotent` for X's vault | feed X | ok; the vault's rent goes to `ledger.payer` at `close_vault` |
| T03.20 | `depositor_cannot_pay` (H8) | depositor without enough SOL for the deposits | feed | fails (system transfer), nothing written |
| T03.21 | `feed_via_cpi_rejected` (A15) | a valid Feed transaction shape | `feed` called through the mock VRF's `cpi_passthrough` (0xF3), the depositor signing the outer transaction | `NotTopLevel`; nothing written |

**t04_take_back.rs**

| ID | Name | Then |
|---|---|---|
| T04.01 | `take_back_spl_and_t22` | tokens back; entry removed; 406,400 refunded; fresh −1; accounted −; vault ≥ accounted; `BagTakenBack` |
| T04.02 | `take_back_middle_moves_last` | entry 2 of 5 taken: entry 4 is now at index 2; `moved_from == 4` |
| T04.03 | `stale_or_foreign_rejected` | index ≥ len; mint or amount mismatch; another user's entry → `CardMoved` |
| T04.04 | `every_phase_everything_paused` | phases StockUp…Done (injected), after `end_ts`, all pause bits set by admin and guardian, intake disabled, active VRF queue switched → succeeds in each |
| T04.05 | `after_pick_fails` | entry picked into a pack → `CardMoved`; the depositor is paid at settle |
| T04.06 | `with_donations` [DG-1] | lamports donated to Deck, Binder and ledger, tokens to the vault → succeeds; the donation stays unaccounted |
| T04.07 | `rent_changes` | rent 2,575 → full stored deposit refunded; rent 6,960 on a large Deck → succeeds, refund may be 0, no failure, `cap > len` allowed |
| T04.08 | `destination_with_cpi_guard` | Token-2022 destination with CPI Guard enabled → succeeds |
| T04.09 | `refed_entry_without_binder` | an injected REFED entry whose depositor's Binder account does not exist → take_back succeeds, tokens and deposit back. Negative cases: a `binder` at the wrong address → Anchor's seeds error; a FRESH entry whose Binder is missing (an injected, impossible state) → `AccountMismatch` |

**t05_buy_packs.rs**

| ID | Name | Given | When | Then |
|---|---|---|---|---|
| T05.01 | `buy_og_x1` | OnAir, Deck 100, WIF bucket Major with A = 10¹² and C = 30 SOL | buy OG ×1 | escrow 0.1 SOL in the Pull; Pull header and packs; Binder cap 5, reserved 5, pull_nonce 1; bucket reserved 1.5 SOL; reserved_dust 4; pending 1; next_seq 2; the mock queue holds a request with callback = program, disc = `ConsumeRandomness`, metas `[pull, machine, deck, binder]` all writable, args = seq LE, caller_seed per §10.2; queue +500,000 lamports; `PullOpened` |
| T05.02 | `qty_limits` | — | each edition at its max; 0; max + 1 | ok / `InvalidQuantity` ×2 |
| T05.03 | `coverage_greedy` | (a) Major buckets free 15 SOL and 15 SOL; (b) free 15 and 14.9 SOL; in both, a Trending bucket free 100 SOL and a disabled Major free 100 SOL | AH ×2 | (a) backing 0 and 1; (b) `Refilling`; the Trending and disabled buckets are never used |
| T05.04 | `coverage_held_by_pending` | free 30 SOL | AH ×2 pending; then AH ×1 | `Refilling` until a reveal or refund |
| T05.05 | `machine_hungry` | deck.len = reserved_dust + 4·qty + 49 | buy | `MachineHungry` |
| T05.06 | `phase_pause_time` | not OnAir; now ≥ end; RIP paused | buy | `WrongPhase` / `SeasonOver` / `Paused` |
| T05.07 | `team_and_non_wallet` | — | team buyer; program-owned buyer | `TeamWallet` / `NotWallet` |
| T05.08 | `queue_rules` | — | unlisted; listed but not active; after `SelectVrfQueue` | `QueueNotAllowed` ×2; the new active queue works |
| T05.09 | `live_flags_m1` | — | `min_live_flags = 4` | `LiveFlagsChanged` |
| T05.10 | `referral_binding` | new buyer | buy with r1; buy with r2; buy with self; buy after a revealed Pull | r1 bound and copied into the Pull; r2 ignored; self ignored; no rebinding |
| T05.11 | `holder_attestation` | — | valid HOLD; bad signature or message; expired; intake disabled + HOLD; no HOLD | holder 1 / `AttestationInvalid` / `AttestationExpired` / `RoleDisabled` / holder 0 |
| T05.12 | `pull_nonce_and_prefunded_pull` [DG-5] | lamports donated to the next Pull PDA | buy; then buy reusing the previous nonce | ok / fails (`InvalidArgument`, or "account already in use" if that Pull is still open) |
| T05.13 | `binder_reuse` | (a) a Binder injected with cap 5, len 0, reserved 0; (b) the Binder T06.09 leaves (cap 5, len 3, reserved 0; House Cards leave free slots) | buy ×1 | (a) no slot rent charged; (b) only the 3 missing slots charged. (A refunded Pull cannot leave free slots: `refund_pull` shrinks the Binder, T08.02) |
| T05.14 | `binder_full` | Binder injected with len = cap = 65,533, reserved 0 | buy ×1 (needs 5 slots) | `BinderFull` |
| T05.15 | `concurrent_buyers_no_race` | 20 buyers with fresh Binders | 20 buy_packs in one block, in any order | all succeed (A1); seqs are distinct and consecutive |

**t06_callback.rs**

| ID | Name | Then |
|---|---|---|
| T06.01 | `reveal_og_x1_each_tier` (4 cases, with randomness forcing Silver / Blue / Holo / Black) | card `value == V`; `C −= V`, `A −= floor(V·A/C)`; 4 Dust Cards with the picked mints and amounts; royalty records `{depositor, 2,000,000, refund 406,400}`; tracked Machine SOL +92,000,000 (stock 72M + jackpot 5M + burn 5M + team 10M, no referrer) and the same lamports moved; coverage released; reserved_dust −4; pending −1; season_spend +P; status Revealed; randomness stored |
| T06.02 | `reveal_og_x10_matches_reference` | every tier, dust index, bucket pick, carve and card equals `reference.rs` |
| T06.03 | `reveal_ah_x5` | the same checks for AH |
| T06.04 | `identity_enforced` [CR-3] | a direct call without the identity → Err; `fulfill_raw_global` (legacy identity) → Err; nothing else returns Err |
| T06.05 | `closed_or_unknown_pull_skipped` [CR-2] | `CallbackSkipped(1)`, no state change |
| T06.06 | `wrong_accounts_skipped` [CR-1] | swapped Machine / Deck; another user's Binder; seq arg ≠ pull.seq; a read-only account → `CallbackSkipped` with reasons 6 / 7 / 8 / 3 / 9; no state change |
| T06.07 | `duplicate_callback_skipped` [CR-2] | a second fulfil → `CallbackSkipped(4)` |
| T06.08 | `late_callback_skipped_then_refund` [CR-2] | warp 301 s → `CallbackSkipped(5)`; `refund_pull` works |
| T06.09 | `short_deck_house_cards` | 2 entries left at the reveal of OG ×1 → 2 Dust + 2 House Cards; +2 × 2,000,000 to stock_sol; the Binder gets 3 cards and reserved returns to 0 |
| T06.10 | `deck_exactly_4qty` | Deck of 90 at purchase (40 + `DUST_BUFFER`), OG ×10, then 50 entries taken back before the reveal → 40 distinct Dust Cards; Deck empty and shrunk to 64 B |
| T06.11 | `bucket_disabled_mid_pull` | (a) another enabled Major has free ≥ V → paid from it; (b) none → paid from the disabled backing bucket |
| T06.12 | `cap_lowered_mid_pull` | no effect on the reveal |
| T06.13 | `trending_only_silver_blue` | forced Holo / Black never carve from Trending; Silver / Blue may |
| T06.14 | `rent_increase_before_callback` | 6,960 → Ok; refunds saturate; all-House + no-referrer case: `shortfall > 0`, the stock absorbs it, I2 holds |
| T06.15 | `donations_before_callback` [DG-5, DG-8] | lamports donated to Pull, Machine, Deck and Binder → Ok; the Pull donation reaches the buyer at close; the Machine donation never becomes tracked SOL |
| T06.16 | `cu_og_x10_deck_max` [CR-4] | **Matrix, on the mainnet feature set (§16.1).** Deck at `DECK_MAX` (120,000 injected entries), 16 Major buckets. Shapes OG ×1, OG ×10 and AH ×5. Buyer Binder small, and at 65,535 slots (injected with `len = 65,535 − 5·qty`, so the Rip's slots are free). Outcomes: each tier at ×1; all-Silver; the heaviest Holo/Black mix a search of 10⁶ randomness values finds (all-Black is out of reach at ×10: (1/400)¹⁰); House Cards (Deck injected with 2 entries before the reveal). **Every case:** our callback ≤ 200,000 CU; the mock fulfil transaction's total + 45,000 (MagicBlock's proof check and queue handling, §10.1) ≤ 270,000 CU; the callback's total allocation ≤ 24 KiB, computed from its `qty`-sized buffers (the bump allocator never frees). The report gives every case and, per shape, the max − min CU spread across outcomes. If a bound fails, stop and report the numbers. The fallbacks are a cap on Binder slots (for example 4,096 cards, a number change for the founder) or master Appendix A's options. M4 re-runs the matrix with every special segment live |
| T06.17 | `logs_og_x10_fit` | total log bytes ≤ 9,000; no truncation; 10 `PackRevealed` + 1 `PullRevealed` decode |
| T06.18 | `hour_rotation` (A16) | V accumulates; the next hour moves it to last; a skipped hour → last = 0. With `sb_paid_hour` injected non-zero in hour h, a reveal in hour h+1 sets `sb_paid_hour = 0` and `sol_at_hour_start` = `stock_sol` as it was before that reveal's own increments; a second reveal in the same hour changes neither |
| T06.19 | `draw_distribution` (unit) | 10⁶ draws per edition: each tier's frequency within 4σ of its ppb |
| T06.20 | `dust_uniform` (unit) | 10⁶ picks over len 97: each index within 4σ |
| T06.21 | `no_inner_instructions` [CR-6] | the callback's inner-instruction list is empty; only its 4 accounts change |
| T06.22 | `widths_match_params` | for every combination of live flags × holder (computed by `math::segments`), the widths equal PARAMS §4.3 and `Σ VALUE_BPS·width = 7_200 × 10⁹` in the calibration state |

**t07_settle.rs**

| ID | Name | Then |
|---|---|---|
| T07.01 | `settle_x1_pays_and_closes` | each depositor +2,406,400; referrer +2,000,000; FRESH depositors' fresh_in_deck −1; Pull closed, the buyer gets its rent back; events |
| T07.02 | `idempotent_and_closed_noop` | second settle → `Ok`, no change; settle after close → `Ok` |
| T07.03 | `pending_rejected` | `PullNotRevealed` |
| T07.04 | `wrong_accounts` | wrong depositor / binder / buyer / referrer → `AccountMismatch`; a live depositor, referrer or buyer wallet passed read-only → `AccountMismatch` (`payee_check`) |
| T07.05 | `non_creditable_payees` [DG-6] | depositor executable or program-owned → royalty + refund to the stock, `RoyaltyRedirected`; referrer not creditable → team_sol; a 0-lamport depositor is paid and is now rent-exempt |
| T07.06 | `x10_two_packs_per_tx` | packs settled out of order, 2 per tx; size ≤ 1,232 B; the last one closes the Pull |
| T07.07 | `house_slots_skipped` | nothing paid for House slots; the rest balances |
| T07.08 | `rent_increase_before_settle` | every settle succeeds; any shortfall ≤ Δrent(Pull) ends with the buyer; C1 holds |
| T07.09 | `any_phase_all_paused` | succeeds |
| T07.10 | `settle_frees_cap_room` | depositor at 25 fresh, one pulled: feed → `FreshCapReached` before the settle, ok after |
| T07.11 | `reserved_and_program_payees` (A14; mainnet feature set, §16.1) | (a) referrer = `SysvarRent111…`, bound through `buy_packs`: every `settle` of that buyer's packs lands, and each referral goes to `team_sol`. (b) A depositor and the buyer turned into upgradeable-loader programs (`make_program`) after feeding and buying, passed read-only as the SDK does: `settle` lands; their royalty, refund and Pull remainder go to `credit_stock`, with the events. (c) A 0-lamport referrer passed read-only → redirected to the team, not rejected. (d) Record in the PR whether passing an executable payee writable fails the transaction on the mainnet feature set; the SDK passes it read-only either way. (e) After an injected phase FinalPull, a redirect credits `burn_sol`, not `stock_sol` (A18) |

**t08_refund.rs**

| ID | Name | Then |
|---|---|---|
| T08.01 | `too_early` | at created + 299 → `TooEarlyToRefund` |
| T08.02 | `full_refund_after_timeout` | the buyer gets qty·P + Pull rent; the VRF fee stays in the queue; bucket reserved, reserved_dust, pending and binder.reserved released; the Binder shrinks and its slot rent is refunded |
| T08.03 | `noop_cases` | after a reveal; twice; a callback after the refund → no-ops |
| T08.04 | `any_phase_all_paused` | succeeds |
| T08.05 | `expiries_never_pause` | 10 expired Pulls refunded → buys stay open; other buyers Rip normally |
| T08.06 | `refund_program_buyer` (A14; mainnet feature set, §16.1) | the buyer turned into an upgradeable-loader program after buying, passed read-only: `refund_pull` lands; escrow and Pull rent go to `credit_stock`; the Binder's freed slot rent stays in the Binder; `pending_pulls` returns to 0. A live buyer wallet passed read-only → `AccountMismatch` |

**t09_redeem.rs**

| ID | Name | Then |
|---|---|---|
| T09.01 | `redeem_dust_and_hit` (SPL and Token-2022) | tokens to the owner's ATA; card removed; slot rent refunded; accounted −; vault ≥ accounted |
| T09.02 | `eight_in_one_tx_descending` | the SDK batch builder lands 8 redeems in one tx |
| T09.03 | `stale_or_foreign` | `CardMoved`; another owner's Binder → seeds error |
| T09.04 | `any_phase_all_paused` | Setup…Done (injected), all bits set → succeeds |
| T09.05 | `rent_increase_no_shrink` | 6,960 → succeeds without a resize |
| T09.06 | `redeem_all_leaves_binder_tight` | cap == reserved; lamports == rent_min(size) |
| T09.07 | `non_canonical_destination` | rejected by the address constraint |
| T09.08 | `every_kind_redeemable` | injected cards of kinds 5–8 redeem like the others; kind 9 → `CardNotRedeemable` |

**t10_team_vault.rs**

| ID | Name | Then |
|---|---|---|
| T10.01 | `team_withdraw` | pays team_sol to `team_wallet`; wrong wallet → `AccountMismatch`; the payout never dips into other tracked SOL |
| T10.02 | `close_vault_after_exit` [DG-4] | donated tokens burned, and the mint's supply decreases by the burned amount; vault and ledger closed; rent to the ledger payer |
| T10.03 | `close_vault_rejections` | accounted > 0 → `VaultNotEmpty`; listed mint → `MintListed` |
| T10.04 | `refeed_after_close` | feed recreates the vault and the ledger |

**t11_hygiene_donations_rent.rs**

| ID | Name | Then |
|---|---|---|
| T11.01 | `donate_everywhere_then_all_exits` [DG-1] | lamports donated to every program account and predictable PDA, and tokens to every vault → every exit succeeds; nothing is credited to the wrong party |
| T11.02 | `rent_switch_matrix` | for each instruction, rent switched just before it to each PARAMS test rate → exits never fail; only `feed` / `buy_packs` may fail (`DeckUnderfunded` or the payer's insufficient funds) |
| T11.03 | `token_donations_never_deposits` [DG-3] | slack never becomes a Deck entry or a card |
| T11.04 | `pause_bits_grep` | source scan: only `feed` and `buy_packs` reference the pause helpers; no exit's Accounts struct contains Config (except `team_withdraw`); exits take no remaining accounts; the payees of `settle` and `refund_pull`, and `settle`'s `binder_k`, carry no `mut` attribute (A14) |
| T11.05 | `release_has_no_test_code` | the `.so` built for the PR contains no mock or test symbol; the IDL lists no test-only instruction |
| T11.06 | `exit_vault_shortfall_emits` (A17) | a mint injected with `accounted` above `vault.amount`, the vault still holding the card's and the entry's amounts: `take_back` and `redeem` succeed and emit `VaultShortfall`; `feed` of that mint fails (`TokensNotReceived`). On valid states (every other test, P1, P2) `VaultShortfall` never fires |

**Property suites** (proptest; `PROPTEST_CASES` = 1,000 in CI, 200 steps per case. That is deeper than master §8.1's 64 per PR, because this PR is the G1 gate; the nightly 100,000-case run belongs to the master plan). Master §8.2 names: its P1 is P1 + P2 here, its P2 is CR-1 here, its P3 is M-REF here.

| Suite | Property |
|---|---|
| **P1** `prop_p1_feed.rs` | Random feed, take_back, lamport and token donations (DG-1), rent changes over the PARAMS test rates, time jumps and guardian pauses. After every step §14 holds, `VaultShortfall` never fires, and every live Deck entry can be taken back |
| **P2** `prop_p2_packs.rs` | Interleaved buy / fulfil (random randomness, random order across 3 or more concurrent Pulls) / warp + refund / settle (random packs) / redeem / feed / take_back / donations / rent switch / guardian bucket disable. After every step §14 holds; `HitSkipped`, `CardDropped` and `VaultShortfall` never fire; every `PullRevealed` has `to_stock + to_jackpot + to_burn + to_team` == the lamports moved, and the Machine's tracked SOL grows by exactly that (§9.9 step 5). M2 adds `close_binder` to the operation set. **Final drain:** warp past every timeout; refund all pending; settle all; redeem all; take back all; close every unlisted vault; team_withdraw. All of it succeeds, and afterwards: the Deck is empty, every Binder has `len == reserved == 0`, every Pull is closed, for every mint `vault.amount == bucket A + donated tokens` (unlisted mints: vault closed), every token that left a user's wallet is back in some user's wallet except bucket stock, and program SOL == rent + tracked SOL + Machine buffer + donations |
| **CR-1** `prop_cr1_callback.rs` | Random bytes in every non-identity field of Pull / Machine / Deck / Binder: wrong owners or discriminators, wrong seq, uninitialized accounts, status ≠ Pending, expired `created_ts`, deck len 0..10⁴, buckets with A = 0, C = 0 or reserved > C, a Binder without reserved slots, qty 1..10, random rent. The callback returns `Ok` and never panics |
| **M-REF** (in `golden.rs` or unit) | `math::{split, draw, dust_index, bucket_pick, carve, coverage, max_qty}` equal `reference.rs` on random inputs, including u64 extremes |

`golden.rs` writes `app/fixtures/vectors/*.json` when `UPDATE_GOLDEN=1`; otherwise it compares and fails on drift.

### 16.3 Reports (`bench_cu_sizes.rs`, printed by `pnpm program:report`, pasted into the PR)

- **CU table** (whole SDK-shaped transaction, every instruction included; worst case over the variants listed): `feed` with n = 1, 2, 3, 4, 5, 6 bags (first-of-mint vaults); `take_back`; `buy_packs` ×1 and at the maximum (OG ×10, AH ×5), with HOLD, at Deck 100 and at `DECK_MAX`; the callback matrix of T06.16; `settle` with 1 and 2 packs; `refund_pull`; `redeem` ×1 / ×8.
- **`CU_LIMITS`.** Add this block to `packages/config`, tagged `[OFF]` (it is not in PARAMS yet; the architect mirrors it into PARAMS §16):

  ```ts
  // [OFF] Measured in M1 (01-M1-BRIEF.md §16.3): worst whole-transaction CU × 1.25, rounded up to the next 1,000.
  export const CU_LIMITS = {
    feed: [n1, n2, n3, n4, n5, n6], // index = bags in the transaction − 1
    takeBack: n,                    // per take_back; a batch of k uses k × takeBack
    buyPacks: { x1: n, x10: n },    // x10 covers every qty ≥ 2 (measured at OG ×10 and AH ×5)
    settle: [p1, p2],               // 1 or 2 packs
    refundPull: n,
    redeem: { x1: n, x8: n },       // a batch of 2–8 uses x8
  } as const;
  ```

  Every value is `ceil(measured × 1.25 / 1,000) × 1,000`. `validateParams()` checks that each one is a positive multiple of 1,000 and at most 1,400,000. The builders read these keys and nothing else.
- **Transaction size table** (A7): Feed bags per tx (legacy vs v0 with a lookup table; vault present vs first-of-mint; with and without compute-budget instructions); take-back and redeem per tx; settle with 2 packs; buy_packs with and without HOLD.
- **Log size** of the OG ×10 callback.
- **Program `.so` size and sBPF flags** (`check-sbf-flags.mjs`).
- **Feature sets.** LiteSVM enables every feature by default; T06.16 also runs on the mainnet set (§16.1). Spike S2 measures the real fulfilment cost on devnet.

### 16.4 Golden vectors (Rust → SDK, `app/fixtures/vectors/`)

| File | Content |
|---|---|
| `pdas.json` | fixed sample keys |
| `layouts.json` | size and every field offset of every struct in §7, from `offset_of!` |
| `split.json` | split results |
| `draw.json` | at least 200 cases, including §11.10 |
| `dust.json`, `bucket.json`, `carve.json`, `maxqty.json` | pick, carve and coverage results |
| `attest.json` | at least 20 FEED and HOLD messages, with their bags hashes |
| `ix.json` | for every instruction: the Anchor-encoded data bytes and the ordered account metas built with `ToAccountMetas`, for fixed sample keys. For `settle` and `refund_pull` these metas show the payees read-only (A14); `ix.test.ts` checks the SDK's writable override (§15.4) on top of them |
| `idl_constants.json` | the IDL `#[constant]` values, for the parity test |

### 16.5 TypeScript tests (Vitest)

**Unit** (`pnpm test`):
- `pda.test.ts`, `layouts.test.ts` (offsets, plus an encode/decode round trip), `math.test.ts` (with `rotateHour`), `attest.test.ts` (with `attestationExpiry` under a local clock 30 s ahead of the chain), `ix.test.ts` (with the §15.4 payee override): byte-exact against the vectors;
- `params-parity.test.ts`: every `ONCHAIN_KEYS` entry's IDL `#[constant]` value == `packages/config` (§4.3);
- in `packages/config`: `onchain-keys.test.ts` (every path resolves, every value fits its type) and the `CU_LIMITS` checks of §16.3;
- `tx-size.test.ts`: the builders never exceed 1,232 B, and Feed never exceeds its 1,047 B budget; prints the packing table;
- `errors.test.ts`: §15.5.

**E2E** (`pnpm test:e2e`, run in the CI `program` job after the build):
- **E1:** feed 1 bag, then take it back, through the SDK builders.
- **E2:** OnAir injected → buy OG ×1 → mock fulfil → settle → redeem all 5 cards (descending batch).
- **E3:** buy → warp 300 s → refund.

**Runtime for the e2e:**
- **Preferred:** `litesvm` npm 0.8.0, with the state injection done by the SDK encoders.
- **Fallback, if it cannot execute the sBPFv3 build:** the validator setup of §16.6, for E1–E3 (E3 then waits the real 300 s).

Say in the PR which path you used.

### 16.6 Validator and devnet runs

Nothing in M1 can reach `OnAir` on a real cluster: OnAir needs `power_on` (M4), and the program has no test path (A5). So the Rip flow runs on a local validator, and only the Feed flow runs on devnet.

**`pnpm e2e:validator <feed|rip|payees>`** (written and run in M1; CI `program` job). This is master §8.1's "v3 artifact e2e": the deployable sBPFv3 binary runs on `solana-test-validator` 4.3.0 with:
- `--upgradeable-program` for `onepercent` (the v3 artifact);
- `--bpf-program Vrf1RN… mock_vrf.so`;
- `--account` fixtures that the Rust harness exports at run time (`export_fixtures(dir, now)`, §16.1).

The flows:
- **`rip`** (E2 shape). Config and Machine preloaded in OnAir (`on_air_ts = now − 60 s`, `end_ts = now + 7 d`), a Deck of 100 entries with their vaults and ledgers, one seeded Major bucket, and the mock queue. Then buy OG ×1 → mock fulfil → settle → redeem all 5 cards (descending batch).
- **`feed`** (E1 shape). Preloaded in StockUp with a fake BondingCurve. Feed 1 bag, then take it back.
- **`payees`**. Only if §16.1 requires it: T07.11 (a, b) and T08.06 from exported states.

**`pnpm e2e:devnet feed`** (master §8.3 E1; written in M1, run at the gate). On a fresh devnet deployment: `initialize`, `SetSeason` with `stock_up_ts` a few seconds ahead, `advance_phase` → StockUp, then feed and take back. It reads a devnet keypair path and an RPC URL from the env, never from git, and uses spike S1's pump.fun strategy. If S1 finds no pump.fun on devnet, this flow runs as `e2e:validator feed` with pump.fun accounts cloned from mainnet (master §8.3). Codex does not run it against devnet without the founder's go.

There is no `e2e:devnet rip` in M1. The real-VRF devnet Rip waits for `power_on` (M4). Master §8.3's E2 at the M2 gate runs on `solana-test-validator` (the architect updates the master).

---

## 17. Commands and CI

New `app/package.json` scripts (the M0 scripts stay):

| Script | Does |
|---|---|
| `pnpm params:rs` / `pnpm params:rs --check` | `tsx scripts/params-rs.ts [--check]` (§4.3) |
| `pnpm mockvrf:build` | `cargo build-sbf --manifest-path test-programs/mock-vrf/Cargo.toml --sbf-out-dir target/deploy --arch v3` |
| `pnpm program:build` | `pnpm anchor:build` (M0's wrapper for `anchor build`; append ` -- --arch v3` only if §3.1 requires it) `&& pnpm mockvrf:build && pnpm sdk:idl && node scripts/check-sbf-flags.mjs target/deploy/onepercent.so target/deploy/mock_vrf.so` |
| `pnpm program:clippy` | `cargo clippy --manifest-path programs/onepercent/Cargo.toml --lib -- -D warnings` (§2 rule 5) |
| `pnpm program:test` | `PROPTEST_CASES=1000 cargo test --manifest-path programs/onepercent/Cargo.toml` (needs the built `.so`) |
| `pnpm program:report` | runs `bench_cu_sizes` with `--nocapture` (§16.3) |
| `pnpm golden:update` | `UPDATE_GOLDEN=1 cargo test --test golden` |
| `pnpm test:e2e` | Vitest e2e project (§16.5) |
| `pnpm e2e:validator <flow>` | §16.6 (`solana-test-validator` 4.3.0, local) |
| `pnpm e2e:devnet feed` | §16.6 (devnet, at the gate, with the founder's go) |
| `pnpm lint:words` | scans tracked files under `app/` (excluding lockfiles, `target/` and the scanner itself) for the forbidden words of §19, whole-word and case-insensitive (master `hygiene` job) |

**CI** (`.github/workflows/app.yml`, per master §8.5):
- job `ts`: add `params:rs --check` (master §8.5 calls this step `config:check-rust`) and `lint:words`. Config's exports point at `src` (§4.1), so `typecheck` and `params:rs --check` need no prior build;
- job `program`:
  - `pnpm program:build`, which includes the sBPFv3 flag check;
  - `pnpm program:clippy`;
  - `pnpm program:test`;
  - `pnpm test:e2e`;
  - `pnpm e2e:validator rip` and `pnpm e2e:validator feed` (master §8.1's v3 artifact e2e);
  - `git diff --exit-code app/packages/sdk/src/idl app/fixtures/vectors`;
  - M0's `anchor test` smoke on `solana-test-validator` 4.3.0;
  - `solana-verify build --cargo-build-sbf-args="--arch v3"` reproducibility, if the runner supports it; otherwise state why.

**The architect will run, from `app/`:**

```
pnpm install --frozen-lockfile
pnpm params:rs --check && pnpm lint:words
pnpm program:build && pnpm program:clippy && pnpm program:test && pnpm test:e2e
pnpm e2e:validator rip && pnpm e2e:validator feed
PROPTEST_CASES=10000 pnpm program:test
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm program:report
git diff --exit-code packages/sdk/src/idl fixtures/vectors
```

---

## 18. Definition of done

1. Every command in §17 passes locally and in CI. `git diff main --stat` shows changes only under `app/` and `.github/workflows/app.yml`. Root `npm ci && npm test && npm run build` behave exactly as on `main`.
2. `node scripts/check-sbf-flags.mjs` passes for `onepercent.so` and `mock_vrf.so` (`e_flags == 3`). The release build has no feature, no mock and no test code (T11.05). If `solana-verify` runs in CI, two clean builds give the same hash.
3. Every instruction in §1.1 is implemented exactly as §9 specifies, with the §7 layouts (compile-time size asserts plus offset tests), the §12 events and the §13 errors. Every §1.2 stub returns `NotImplemented`.
4. Every named test in §16.2 exists under its ID and name and passes. P1, P2 and CR-1 pass with 1,000 cases in CI, and the architect's 10,000-case run passes. `HitSkipped`, `CardDropped` and `VaultShortfall` never fire on valid states.
5. The T06.16 matrix holds in every case: callback ≤ 200,000 CU, fulfilment ≤ 270,000 CU, allocations ≤ 24 KiB, with the CU spread reported. Logs are within budget.
6. The §16.3 reports are in the PR, and `CU_LIMITS` is filled in `packages/config` with the §16.3 shape and rounding.
7. `params.rs` is generated from `ONCHAIN_KEYS` and drift-checked. No PARAMS value appears as a literal in `programs/onepercent/src` outside `params.rs`, except inside the compile-time asserts of `constants.rs` (`rg` for 100_000_000, 113_925_000, `1pct:tier:v1`, `6EF8rr` etc. proves it). The IDL constants equal `packages/config` (parity test).
8. The IDL and types are regenerated into `packages/sdk/src/idl/`. Golden vectors are committed, and the SDK passes them byte for byte.
9. `app/README.md` documents the new commands and the harness. `app/VERSIONS.md` lists every new dependency with its publish date and source, and the exact build command (§3.1).
10. `pnpm lint:words` is clean.
11. `pnpm program:clippy` passes with `-D warnings`.
12. The other lanes' config sections are byte-identical (§4.1). If X2 merged first, `X2_PENDING_M1` is gone and `packages/market/src/params.ts` imports the M1 exports. The workspace has one `@solana/web3.js` (1.99.0) and no `@coral-xyz/anchor`.

---

## 19. Do NOT

**Scope and process**
- Implement anything in §1.3, or give a §1.2 stub behaviour.
- Edit anything under `docs/codex/` (this brief, `MODEL.md`, `PARAMS.md`, the master and the other briefs), `AGENTS.md`, `apps/web/src/experience/` or the landing. Report what needs changing instead.
- Edit another lane's files, except the two §4.1 edits (`X2_PENDING_M1` and `packages/market/src/params.ts`).
- Run anything against devnet or mainnet. Add RPC keys, or put any keypair in git.

**Exits and balances**
- Read a pause bit, a disabled role, an attestation, the VRF queue or `end_ts` in any exit. Add a pause bit for exits. Give an exit remaining accounts.
- Put Anchor `mut` on a payee of `settle` or `refund_pull`, or on `settle`'s `binder_k` (A14). Give `take_back`'s `binder` a typed account (§9.7).
- Assert an exact balance in program code (`==` on lamports or token amounts); use `≥` and tracked amounts. Tests may assert exact expected values under controlled rent and donations. Pay out `lamports − rent`. Hard-code rent.

**The callback**
- Make a token CPI, create an account or call `find_program_address` in the `consume_randomness` handler body (the `#[vrf_callback]` identity constraint is the only exception).
- Read any account there other than its four, or return `Err` after the identity check.
- Put a user-supplied or outcome-dependent account into the callback metas.

**VRF**
- Use MagicBlock's legacy global identity, `create_request_legacy_*`, `create_request_regular_randomness_ix`, or any `rnd::*` helper.
- Pin MagicBlock's ProgramData or deploy slot.
- Re-request VRF for a Pull, or add an automatic breaker on expiries.

**Code**
- Use floating point, `unwrap`, `expect` or `panic!` in program code (only `#[cfg(test)]` modules may), or unchecked arithmetic in the callback or the exits.
- Hard-code an economic number (always `params.rs`), or write a second literal for any value `params.rs` holds (A13).
- Add test-only code, features or flags to the program crate.
- Change an account layout, size, seed, discriminator or instruction signature from this brief without reporting it in the PR first.
- Run `anchor keys sync` in a way that changes the M0 program id, or give the mock VRF its own `declare_id!` (it is native and loaded at the VRF id).

**Words never shipped** (code, comments, strings, docs and tests under `app/`)
- Every word on AGENTS.md's "Never use" list (app section). `lint:words` copies that list verbatim into its own source, which it excludes from the scan; M0 §11 has the same list.
- From DA §3.4: coffin, casket, skull, skeleton, bones, zombie, undead, reaper, cemetery, mourn, epitaph, obituary, revival, resurrection, afterlife, "dead bags", "sweep" / "sweeper", casino, gamble, bet.
- In user-facing copy: guaranteed, risk-free, free money, profit, yield, APY, passive income, earn, "verify your wallet".

---

## 20. Report back (in the PR)

1. The version table (new rows of `VERSIONS.md`), and the result of every §17 command.
2. The §16.3 reports (CU, sizes, logs, `.so` size and flags), including the T06.16 matrix with its spreads, the measured `CU_LIMITS`, and the 10,000-case property run if you ran it.
3. Every deviation from this brief, with its reason. There should be none beyond what this brief already states. Also every place you had to stop and decide.
4. The cross-lane edits of §4.1, if any (`X2_PENDING_M1` removed, `packages/market/src/params.ts` re-pointed), and the web3.js / Anchor client move.
5. Open questions, especially:
   - whether `ephemeral-vrf-sdk` with `anchor-compat` built cleanly against Anchor 0.32.2 under sBPFv3, and whether a plain `anchor build` emitted v3;
   - whether LiteSVM 0.16.0 enforces rent-state transitions, demotes reserved keys, and applies the mainnet write-lock rules for executable accounts (§16.1);
   - whether passing an executable payee writable fails a transaction on the mainnet feature set (T07.11 d);
   - which TS e2e path you used;
   - the measured Feed bags per transaction (A7);
   - the form of Anchor's IDL constant values, if the parity test needed anything beyond §4.3.
