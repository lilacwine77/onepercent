# Codex brief — M6: monitor and status, rescue, hardening and RC, dress rehearsal, mainnet canary, runbook tooling (The 1% Machine)

Issued 2026-10-20 (D9) by the architect, with `RUNBOOK.md`. M6 runs from D9 through the season. It ships as **nine PRs** in five tracks, each with its own gate: **G6.1** monitor and status, **G6.2** rescue, **G6.3** hardening and the release candidate `rc-1`, **G6.4** dress rehearsal (soak), **G6.5** ops tooling and the canary checklist. The master's **Gate G6** (the RC audit of the full program and every service, plus the soak, then the founder's go / no-go) uses their evidence. The launch itself is executed by the founder and the architect from `RUNBOOK.md`; Codex never sends a mainnet transaction.

This brief is self-contained for M6. Everything M6 needs from SPEC, `PARAMS.md`, the master brief and the M1–M3 briefs is restated or referenced by section. External facts were checked on 2026-10-08 and 2026-10-09 (Appendix C); the ones marked **verify at M6 start** are re-checked on D9 before the PR that depends on them starts. If anything is ambiguous, contradictory or impossible, **stop and report with options** (AGENTS.md). Do not guess.

---

## 0. Read this first

### 0.1 Authority

Master §0.1 applies: `DECISIONS.md` (binding) > `MODEL.md` > `PARAMS.md` (issue 3; the operational keys of §4.2 are pending issue 4) > `00-MASTER-BRIEF.md` > **this brief** > `00-M0-SCAFFOLD.md` as migrated by M0.1 > `AGENTS.md` > `COPY.md`.

- `01-M1-BRIEF.md` sets the program conventions; `02-M2-BRIEF.md` owns the services core (service kit, database, indexer, keeper, signers, `api` public v1, `onepct-ops` v1); `03-M3-BRIEF.md` owns the web plumbing; `04-M4-BRIEF.md` owns `power_on`, The 1%, `collect_creator_fees`, `start_final_pull`, `claim_final_sol`, `claim_final_tokens`, the executor, the fee chain and its alerts, the Final Pull keeper, HOLD and `onepct-ops launch`; `05-M5-BRIEF.md` owns the bot and the Blinks. **M6 extends them and never changes them.** It changes no instruction, account layout, seed, error, event or economic value.
- "M1 §x", "M2 §x", "M3 §x" and "M4" mean those briefs; "master §x" means `00-MASTER-BRIEF.md`; "RUNBOOK step n" means `RUNBOOK.md`.
- `RUNBOOK.md` is an operational document for the founder and the architect. Codex builds the commands it uses (§10) and never edits it.
- The M4 instructions used here (`power_on`, `collect_creator_fees`, `start_final_pull`, `claim_final_sol`, `claim_final_tokens`, permissionless Burn after Done) are specified in M4 §6. Their accounts come from M4's SDK builders (M4 §10.1: `startFinalPullIx`, `claimFinalSolIx`, `claimFinalTokensIx`, `buildFinalClaimsTransaction`, `collectCreatorFeesIx`). **Never encode a program instruction by hand**: a builder M6 needs and does not find is a stop-and-report.

### 0.2 Scope versus the master plan

| Master §11.4 item | Here | PRs (§1.2) |
|---|---|---|
| M6.1 Monitor and status: the invariant checks of PARAMS §18, the public status page with the degraded-modes matrix, the upgrade watcher posting every queued Squads proposal to a public channel, guardian paging. Acceptance: every check fires in a drill | §5 | MON, STATUS |
| M6.2 Rescue: `onepct-rescue` and `apps/rescue` build `take_back`, `redeem`, `settle`, `refund_pull`, `withdraw_owed`, `claim_final_*`, `close_vault`, `close_binder` from chain data and a user-supplied RPC URL; the page pinned on two IPFS services. Acceptance: every exit executed with the API, indexer and keeper stopped; take-back and redeem ready by D12 | §6 | RESCUE-A, RESCUE-B, RESCUE-PAGE |
| M6.3 Hardening and RC: deep property runs; CU, size and log benches; clippy clean; IDL frozen; verified sBPFv3 hash published; tag `rc-1` | §7 | RC |
| M6.4 Devnet dress rehearsal: the soak of master §8.3. Acceptance: zero invariant violations, zero stuck Pulls, keeper failover ≤ 60 s. Gates G6 and Power-On, not Stock-Up | §8 | SOAK |
| M6.5 Mainnet canary: the checks of master §8.4; the canary keeps its upgrade authority | §9 | OPS (tooling); the checks are run by the founder and the architect |
| M6.6 Runbook and switch-over | §10 (the commands); `RUNBOOK.md` (the procedure) | OPS |

**Not M6.**
- Program instructions and their tests (M1, M2.1, M4.1). The RC freezes them; after Stock-Up the program changes only through the 12 h timelock (master §9.2 S8).
- `onepct-ops launch`, the executor, the creator-fee chain, the Final Pull keeper and the HOLD signer (M4.2); the keeper's stock policy (M2.3).
- The items X3 calls "M6" or "M6.2" (`/machine`, `/go/<session>`, Backpack links, Dialect, Blink images): they are M5 (master §0.4).
- Spotlight (D1), cross-chain (M7a), the ZK redeem (M7b).

### 0.3 Amendments this brief makes (binding for M6)

| # | Amendment | Amends | Why |
|---|---|---|---|
| M6-A1 | The soak of master §8.3 runs in two parts: **Soak-V**, the full 20,000-pack load with every chaos item, on a soak validator (`solana-test-validator` 4.3.0, the deployable sBPFv3 binary, the full services stack, a mock oracle); and **Soak-D**, the dress rehearsal on devnet with the real MagicBlock queue, at the volume devnet SOL allows (§8) | master §8.3 (soak on devnet) | Prices and the coverage rule are compiled (M1 A12): 20,000 packs need thousands of SOL of escrow and creator-fee-funded coverage, which devnet faucets cannot supply. Withheld, late and duplicate callbacks cannot be forced on MagicBlock's oracle; master §8.3 already allows a local runtime for them |
| M6-A2 | A monitor check "fires in a drill" on devnet when its trigger exists there; a check that guards a program-enforced invariant fires on the soak validator from an injected account state (§5.9) | master §11.4 M6.1 ("devnet drill") | A correct program cannot be made to break its invariants on devnet |
| M6-A3 | `onepct-ops` on mainnet: an instruction whose signer is `Config.admin` (the Squads vault) is only ever built as a Squads vault transaction, as M2 §11.10 says. An operation whose signer is a person's key (`init` by the deployer, `lut` by its payer, `guardian`, the canary's admin, upgrade-authority moves before Squads) signs locally with the `--keypair` file that person passes, after the typed confirmation of §10.1 | M2 §11.10 ("`--cluster mainnet` never signs") | `initialize` must be signed by the program's upgrade authority before it moves to Squads (M1 §9.1). M2 already lets a guardian sign with its own key file |
| M6-A4 | One source tree, three binaries: the mainnet, canary and devnet builds come from tags `rc-N-<cluster>` that differ from `rc-N` only in `declare_id!`, `Anchor.toml` `[programs.<cluster>]` and the regenerated IDL address (CI checks the diff, §7.5). Every SDK builder and PDA helper takes the program id at run time; outside tests nothing reads the IDL's address | master §5.1 ("only `declare_id!` differs per cluster"), M1 A12 | No mechanism was named, and a cargo feature is forbidden (M1 A5). One services build serves devnet, the canary and mainnet |
| M6-A5 | Operational keys for the monitor and the rescue tools (§4.2) are added to `packages/config` now, in a marked section, `[OFF] [A]`; PARAMS issue 4 records them with D14's `SERVICES.transport` | PARAMS §0 | The checks need thresholds; none is economic |
| M6-A6 | The status page, the rescue page and the public watch-channel posts use the keys of `COPY.md` issue 3, listed in §5.7, §6.6 and §5.4. Until issue 3 lands, the keys render placeholders and G6.1 / G6.2 wait for it. Guardian pages and CLI output are operator text, not copy; they still pass `pnpm lint:words` | `COPY.md` §0.1 | User-facing strings only from `COPY.md` |
| M6-A7 | `VITE_RESCUE_URL` joins the public `VITE_` variables of M3 §15.3; `common.rescueLink` points to it | M3 §15.3 | The web must show the rescue link even when the API is down |
| M6-A8 | Alerts keep being written with S0's `alert()` (M2 §11.1) by every service. The monitor is the only router and pager: it reads new notification claims from the `alerts` table (§5.3). In production `ALERT_WEBHOOK_URL` stays unset | M2 §11.1 | One place decides who is paged; no service needs a paging credential |

None adds or removes a mechanic or changes a validated number.

### 0.4 Founder decisions and audit inputs M6 relies on

- **D1:** no Spotlight. The monitor never reads the Spotlight slot; the rescue tools have no `spotlight_take_back`.
- **D3:** no RC-slip fallback. `rc-1` is tagged on D12. Fixes found by the RC audit produce `rc-2`, `rc-3`… before the mainnet deploy; the deployed build is the last `rc-N` with an audit PASS.
- **D4:** the RC is the first mainnet deploy; `S` and `stock_up_ts` are written with `SetSeason` after it (RUNBOOK step 5).
- **D6:** the shared MagicBlock queue `Cuj97…` only. The occupancy alert and the "Machine busy" guard are launch-critical (§5.2 OPS-01).
- **D12:** a bucket backs coverage only if it can deliver one base unit of the smallest hit it covers; the monitor re-checks it (§5.2 INV-04b).
- **D13:** no environment variable may end in `SECRET_KEY` or `PRIVATE_KEY`, except a role's own `*_KEYPAIR`. No variable this brief adds does; its credentials end in `_TOKEN`, `_SECRET` or `_API_KEY`.
- **D14:** `SERVICES.transport` (`rpcTimeoutMs` 10,000; `dbStatementTimeoutMs` 5,000; `redisCommandTimeoutMs` 2,000; `webhookTimeoutMs` 5,000; `breakerFailureThreshold` 5; `breakerOpenSeconds` 30) governs every network call M6 makes (§4.3).
- **D15:** `sell_backs` is keyed by `(signature, event_index)` (KEY-02 joins on it); `SERVICES.transport.shutdownDrainMs` 10,000 bounds a graceful shutdown (§4.3; RUNBOOK step 0.3 sets Railway's draining time above it); M6's keys go into the one `SERVICES` object S0 created, never a second one (§4.2).
- **D16:** a pack bought during the season keeps The 1% and the Jackpot live until its draw lands, and whatever is unpulled when the Final Pull starts goes to the Final Pull (INV-10 and INV-14 follow M4 §7.1 and §9); the executor's smallest tranche is 0.05 SOL (`EXECUTOR_POLICY.minTrancheLamports`); HOLD counts only the wallet's canonical $1PCT account (KEY-04 reads M4's `hold_log`).
- **S0 audit (PR #10):**
  - every service binds its private listener with `PRIVATE_HOST=::` on Railway (S0's default `127.0.0.1` is unreachable over the private network);
  - every role exposes `/health`, `/ready` and `/metrics` (the 16 metrics of M2 §11.11) on `PRIVATE_PORT`;
  - the leader lock's worst-case failover is about 55 s (`idle_session_timeout` 45 s), inside the 60 s soak criterion;
  - the Railway pre-deploy command of `api` and `worker` services is `node node_modules/@onepercent/db/dist/migrate-cli.js` (forward-only migrations).

---

## 1. Scope and PR plan

### 1.1 Deliverables by sub-milestone

| Sub-milestone | Deliverables | Gate |
|---|---|---|
| M6.1 Monitor and status | The `monitor` worker role: invariant, operational, key-misuse and governance checks (§5.2); alert routing and guardian paging (§5.3); the upgrade watcher and the public watch channel (§5.4); the status model and the degraded-modes matrix (§5.5); the `/api/status` extension (§5.6); the `/status` page (§5.7); the drill (§5.9) | G6.1 |
| M6.2 Rescue | `@onepercent/sdk/rescue` (discovery and plans from chain data); the `onepct-rescue` CLI; the static `apps/rescue` page; its IPFS release on two pinning services; the stopped-services drill (§6) | G6.2 |
| M6.3 Hardening and RC | Deep property runs; CU, size and log benches against budgets; clippy clean; IDL and layout freeze; the three cluster builds and the verified sBPFv3 hashes; `rc-1` (§7) | G6.3 |
| M6.4 Dress rehearsal | The soak stack, driver, mock oracle, chaos scheduler and report; Soak-V and Soak-D; `soak_check` (§8) | G6.4 |
| M6.5 Mainnet canary | Tooling for the canary checklist; the checks themselves are run by the founder and the architect (§9) | G6.5 (tooling) |
| M6.6 Runbook and switch-over | First, the web image's landing-proxy mode and `sw check` (SW, §10.3); then the `onepct-ops` commands `RUNBOOK.md` uses: `program`, `squads`, `admin`, `addresses`, `gonogo`, `canary` (§10) | G6.5 |

### 1.2 PRs, file ownership, dependencies and merge order

Each PR is one Codex task on its own branch. "Owns" means only that PR edits those paths during M6. Shared files are append-only as listed under the table.

| PR | Branch | Owns | Depends on | Due |
|---|---|---|---|---|
| **MON** | `feat/m6.1-monitor` | `services/worker/src/monitor/**`; `packages/sdk/src/governance/{loader,squads,describe,release}.ts` (new dir, subpath export `./governance`); the §5.8 tables in `packages/db/src/schema.ts` and their generated migration; the monitor keys of §4.2 in `packages/config`; the `StatusResponse` extension in `packages/sdk/src/api/` and its route in `services/api/src/public/` (append-only, §5.6) | G2.2 (S0–S4 merged); M4.2's `executor_trades`, `hold_log`, `creator_fee_collections` and `final_claims` tables (M4 §11.7), read-only: until M4.2's migration is in a database, the checks that need one report `not_deployed` | PR D11; in production before RUNBOOK step 3 (the RC deploy) |
| **STATUS** | `feat/m6.1-status` | `apps/web/src/routes/pages/Status.tsx`, `apps/web/src/adapters/status.ts`, `apps/web/src/data/status.ts`; one line of `routes/table.ts` (turn `/status` on); the status link in the footer and in `OfflineBanner`; the `VITE_RESCUE_URL` wiring of `common.rescueLink` (M6-A7) | MON's schema; G3.1 | PR D12 |
| **RESCUE-A** | `feat/m6.2-rescue-a` | `packages/sdk/src/rescue/{discover,clock,plan-deck,plan-cards,compose}.ts` (new dir, subpath export `./rescue`); `packages/cli/src/rescue/**`; the `onepct-rescue` bin entry in `packages/cli/package.json`; the `RESCUE` block of §4.2 | G1, G2.1 (SDK builders) | PR D11, **merged by D12** (take-back and Redeem) |
| **RESCUE-B** | `feat/m6.2-rescue-b` | `packages/sdk/src/rescue/{plan-pulls,plan-final,plan-close,plan-crank,plan-all}.ts` and the matching CLI commands | RESCUE-A; G4.1 (M4's claim and `start_final_pull` builders) | PR D13 |
| **RESCUE-PAGE** | `feat/m6.2-rescue-page` | `apps/rescue/**` (new app, including `scripts/{car,pin,verify}.mjs`); the CI job `rescue` | RESCUE-A, then RESCUE-B | First pin (take-back, Redeem) before `stock_up_ts` on D13; full pin D14 |
| **RC** | `feat/m6.3-rc` | `programs/onepercent/tests/bench_rc.rs`; lint-only fixes under `programs/onepercent/src/**` (§2 rule 2); `scripts/{set-program-id.mjs, rc-freeze.mjs, rc-report.mjs}`; `fixtures/rc/**`; the refreshed `fixtures/mainnet/features.json`; the `ONEPERCENT_PROGRAM_IDS` block of §4.2; CI jobs `rc`, `ids-diff`, `verifiable-build` | G2.1 merged; G4.1 merged before `rc-1` is tagged | PR D11, rebased on G4.1's merge on D12; `rc-1` tagged D12 |
| **SOAK** | `feat/m6.4-soak` | `app/soak/**`; `programs/onepercent/tests/soak_check.rs`; the append-only capacity mode of `test-programs/mock-vrf` (§8.2) | the M2.2, M2.3 and M4.2 service images (their PR heads until G2.2 and G2.3 pass on D13 and G4.2 on D14); `rc-N` for the final run | Phase 1 from D11 on `main`; final run on `rc-N` from D12; re-runs on the merged images on D14 (§8.7) |
| **SW** | `feat/m6.6-switchover` | the landing-proxy mode and the header of §10.3 (`apps/web/Caddyfile.landing-proxy`, one header line in `apps/web/Caddyfile`, the config choice in the web image's start command); `packages/cli/src/ops/sw/**` and its registration in `onepct-ops` | M3's web image (M3 §15.4) | PR D9, merged D10 (RUNBOOK step 2.1) |
| **OPS** | `feat/m6.6-ops` | `packages/cli/src/ops/{program,squads,admin,addresses,gonogo,canary}/**` and their registrations in `onepct-ops`; `packages/sdk/src/governance/{propose,message}.ts` (appended to MON's directory) | MON's governance decoders; M2's S3 (`onepct-ops` v1); M4.2's `onepct-ops launch` | `program`, `squads`, `addresses` D12; `gonogo` D14 |

- **Gate mapping.** G6.1 = MON + STATUS. G6.2 = RESCUE-A + RESCUE-B + RESCUE-PAGE. G6.3 = RC. G6.4 = SOAK (with its run reports). G6.5 = SW + OPS (with the canary evidence the founder and the architect produce).
- **`packages/cli`.** The package and the `onepct-ops` entry point come from M2's S3 (M2 §11.10). If S3 has not merged when RESCUE-A or SW must merge, that PR creates the minimal package (`package.json` with its own `bin` entry, `tsconfig.json`, the entry file with its own registration), and S3 rebases onto it and appends its own entries.
- **Append-only for every PR:** `packages/sdk/src/index.ts` and the `exports` of `packages/sdk/package.json`; `packages/cli/package.json` (`bin`, scripts); `.env.example` files; `.github/workflows/app.yml` (new jobs only); `app/VERSIONS.md`, `app/README.md`; `apps/web` shell files (one link each).
- **Rebase rule** (as M2 §1.2): the later PR rebases; never hand-merge `pnpm-lock.yaml` (run `pnpm install`) or `packages/db/drizzle/meta/*` (re-run `drizzle-kit generate`).
- **Merge order.** SW first (D10, for RUNBOOK step 2). RC next: it is the only M6 PR that touches program files. MON before STATUS and OPS. RESCUE-A, then RESCUE-B and RESCUE-PAGE. SOAK at any time; its final run uses `rc-N`.

### 1.3 Calendar (master §11.1; T0 = Thu 2026-10-29 16:00 UTC)

| Day | Monitor and status | Rescue | RC | Soak | Canary and ops |
|---|---|---|---|---|---|
| D9 Tue 10-20 | MON starts | RESCUE-A starts | RC starts (benches on `main`) | SOAK starts (stack, genesis) | SW PR; OPS starts |
| D10 Wed 10-21 | — | — | — | — | SW merged; `web` in landing-proxy mode; switch-over rehearsal (RUNBOOK step 2.1) |
| D11 Thu 10-22 | MON PR | RESCUE-A PR | RC PR | Soak-V phase 1 on `main` | 06:00 the hostname moves to `web` (step 2.2); 16:00 SW-1, X-ray Week (step 2.3) |
| D12 Fri 10-23 | STATUS PR; MON on `staging` | RESCUE-A merged; RESCUE-B, RESCUE-PAGE PRs | `rc-1` tagged; RC audit starts | Soak-V final run on `rc-1` starts | Canary deployed; OPS `program`, `squads`, `addresses` merged |
| Sat–Sun 10-24/25 | MON in production from the RC deploy | — | RC deploy (RUNBOOK steps 3–5) | Soak-V continues | — |
| D13 Mon 10-26 | Monitor live at Stock-Up | First pin before `stock_up_ts` | — | Soak-D on devnet | Canary checks; VRF burst (pending founder, Appendix A Q1) |
| D14 Tue 10-27 | — | Full pin | — | Re-runs on the merged images; reports | `gonogo` merged |
| D15 Wed 10-28 | — | — | — | G6 evidence | T−1 canary launch rehearsal (§9.2 C7, before 12:00); T−24 h go / no-go (G6) |

---

## 2. Rules for this milestone

M1 §2 and M2 §2 apply. In addition:

1. **Branches** per §1.2. Never push to `main`. Change only `app/**` and `.github/workflows/app.yml`.
2. **No program behaviour change.** RC's edits under `programs/onepercent/src/**` fix lint findings only. The PR lists each hunk with the clippy lint it fixes; the full program, property and e2e suites re-run on the result. A fix that would change what an instruction does is a stop-and-report, not a commit.
3. **The monitor reads and reports. It never acts.** It holds no key, sends no transaction, and never pauses, disables or upgrades anything. Each page names the guardian command that applies; only a guardian runs it (M2 §11.7: nothing pauses automatically).
4. **Rescue reads only the chain.** `@onepercent/sdk/rescue`, `onepct-rescue` and `apps/rescue` talk to the RPC URL the user supplies and to the user's wallet, nothing else: no Onepercent API, indexer, keeper, Redis or Postgres. They work in every phase, Done included. No flag, rate limit or service gates an exit (master §9.2 S2, S3).
5. **Keys** (master §6 rules 1–7). The monitor and `api` refuse to boot with any `*_KEYPAIR`. `onepct-rescue` and `onepct-ops` read a key only from a file path given on the command line (`--keypair`, `--fee-payer`), keep it in memory for the transactions the operator confirmed, and never write, log, print, transmit or cache it. They never read a key from an environment variable or standard input, and never ask for or accept a seed phrase. The rescue page never touches a key: the wallet signs.
6. **Names.** D13: no new variable ends in `SECRET_KEY` or `PRIVATE_KEY`. Every Railway service with a private listener (all but `web`) sets `PRIVATE_HOST=::`; each `.env.example` says so.
7. **Numbers** only from `@onepercent/config` (§4). **Strings** only from `@onepercent/copy` (M6-A6). Forbidden words per M2 §17; no "ZK" anywhere.
8. **Tests run offline.** Recorded fixtures; Postgres and Redis as CI service containers; the soak validator and localnet are local. Mainnet reads (the feature snapshot, bench fixtures) only with read keys the founder provides; never a transaction (PARAMS §26.3).
9. **Clusters.** Codex runs nothing against devnet, the canary or mainnet without the founder's go. The soak validator is free to use.
10. **Network calls** follow D14 (§4.3): every call has a timeout and sits behind a per-provider circuit breaker, except the rescue tools, which retry only when the user asks.

---

## 3. Dependencies

Pin exactly, at least 14 days old (master §0.3 C), each with its date in `VERSIONS.md`. Versions already on `main` win (master §4.1).

| Package | Pin | Used by | Why |
|---|---|---|---|
| `@sqds/multisig` | 2.1.4 (2025-06-16), already in the lockfile as the root dev dependency of M0.1's drill | `packages/sdk` (`./governance` only), `packages/cli` | Squads v4 account decoders and instruction builders (master §4.2). The web never imports `./governance` (static test) |
| `@wallet-standard/app`, `@wallet-standard/base`, `@wallet-standard/features` 1.1.1; `@solana/wallet-standard-features` 1.5.0 | X3's pins | `apps/rescue` | The web's wallet stack (D10) |
| `@solana/web3.js` 1.99.0, `@anchor-lang/core` 0.32.2, `@solana/spl-token` 0.4.15, Vite 8.3.1 | the workspace's single versions | rescue, cli, monitor | One version each in the lockfile |
| `ipfs-car` | 3.1.0 (2025-10-08), the latest release | `apps/rescue/scripts` (dev dependency) | Packs `dist/` into a CAR file with a deterministic CIDv1 (§6.7) |
| Kubo | Docker image `ipfs/kubo:v0.43.1` (2026-09-15), CI only | the CI job `rescue` | The CID cross-check with the IPIP-0499 profile `unixfs-v1-2025` (§6.7); not an npm dependency |
| `solana-verify` | 0.5.2 (already pinned, `VERSIONS.md`) and its Docker base image for Solana 4.3.0 | RC, RUNBOOK | Verified sBPFv3 builds (§7.5) |

No Telegram SDK, Prometheus client parser or pinning-service SDK: zod-typed `fetch`, as M2 does for Jupiter and Helius. No new Rust crate.

---

## 4. Parameters

### 4.1 Values M6 uses

| Use | PARAMS key | Value |
|---|---|---|
| VRF queue alert, busy guard, timeout | `MONITOR.vrfQueueOccupancyAlertBps`; `VRF.busyOccupancyBps`, `.busyOldestItemSeconds`, `.timeoutSeconds` | 5,000; 8,000; 20 s; 300 s |
| VRF expiries | `MONITOR.vrfExpiriesPerThousandRipsAlert`; `SERVICES.monitor.vrfExpiryClusterPerWallet24h` | 1 per 1,000 Rips; 3 per buyer per 24 h |
| FeeIn silence | `MONITOR.feeInSilenceAlertSeconds` | 600 s |
| Alerts | `SERVICES.monitor.alertDedupeSeconds`, `.stockCapUsageAlertBps`, `.stockConditionAlertSeconds` | 600 s; 8,000; 900 s |
| Indexer | `SERVICES.indexer.maxLagSecondsForIntake`, `.lagAlertSeconds`, `.deckChunkBytes`, `.pollMs` | 30 s; 60 s; 262,144 B; 2,000 ms |
| Keeper | `SERVICES.keeper.leaderFailoverSeconds`, `.settleP95TargetSeconds`, `.settleBacklogAlertSeconds`, `.scanSeconds`, `.closeVaultPassSeconds` | 60 s; 5 s; 60 s; 10 s; 3,600 s |
| Coverage and Deck | `COVERAGE.perPackValueBps`, `.dustBuffer`, `.deckMax`; `FEED_RULES.freshCapPerWallet` | 150,000; 50; 120,000; 25 |
| Hourly caps | `STOCK.hourlyFloorLamports`, `.hourlyHitOutMultiple`, `.trendingHourlyMaxLamports`, `.pythMaxAgeSeconds`; `BURN.hourlyMaxLamports` | 30 SOL; 2; 10 SOL; 60 s; 10 SOL |
| Slip | `STOCK.majorMinOutSlipBps`, `.trendingMinOutSlipBps`; `BURN.minOutSlipBps`; `JACKPOT.minOutSlipBps` | 150; 100; 150; 100 |
| Sell back | `SELL_BACK.payoutBps`, `.solFloorLamports`, `.hourlyBudgetMinLamports`, `.hourlyBudgetBpsOfStockSol` | 8,700; 1 SOL; 5 SOL; 2,500 |
| Hit values | `HIT_TIERS[].valueBps`; `PACK_EDITIONS[].priceLamports`, `.maxPerRip` | PARAMS §2–§3 |
| Season | `SEASON.onAirDelaySeconds`, `.durationSeconds`, `.lastCallSeconds`, `.finalPullDelaySeconds`, `.sealDelaySeconds` | 900; 604,800; 86,400; 600; 259,200 |
| Governance | `GOVERNANCE.multisigThreshold`, `.multisigMembers`, `.timelockSeconds`, `.guardianCount`; `PAUSE_BITS` | 2; 3; 43,200; 2; rip 1, feed 2, sellBack 4, stockBuy 8, burn 16 |
| $1PCT | `TOKEN_1PCT.devBuyAmount`, `.onePctCardAmount`, `.onePctCardCount` | 40M; 10M; 4 (base units × 10⁶) |
| Batching | `TX_LIMITS.redeemPerTx`, `.takeBackPerTx`, `.settlePacksPerTx`, `.txPerSignAll`, `.maxTxBytes`; `CU_LIMITS` | 8; 8; 2; 8; 1,232; M1's measured block |
| Sizes | `ACCOUNT_SIZES.*` | PARAMS §16.1 |
| Web polling | `WEB.machinePollMs`, `.machinePollHiddenMs`, `.confirmPollMs` | 5,000; 30,000; 800 ms |
| Bot rate | `BOT.maxMessagesPerSecond` | 25 |
| Ids | `PROGRAM_IDS.*`, `VRF_QUEUES.mainnetShared`, `WSOL_MINT`, `HIT_LIST.launchMajors` | PARAMS §21 |

### 4.2 Operational keys added by M6 (PARAMS issue 4 pending, `[OFF]` `[A]`)

Three PRs add these lines to `packages/config`, each between its own markers: MON the monitor keys, RESCUE-A the `RESCUE` block, RC the `ONEPERCENT_PROGRAM_IDS` block (with the founder's public keys). The monitor keys go into the one `SERVICES` object S0 created (D15 c). The architect publishes the same values in PARAMS issue 4 with D14's and D15's `SERVICES.transport`. None is economic.

```ts
// Inside SERVICES.monitor, after M2's four keys:
  // ===== BEGIN M6 MONITOR KEYS — 06-M6-BRIEF.md §4.2 [OFF] [A]
  chainCheckSeconds: 60,            // Config, Machine, Deck header, open Pulls, touched ledgers and vaults
  fullPassSeconds: 3_600,           // every MintLedger, vault and Binder; exact per-mint accounting
  snapshotRetries: 3,               // re-reads before a multi-account check is "inconclusive" (§5.1)
  probeIntervalSeconds: 30,         // /ready, /metrics, providers, external programs
  probeFailuresBeforeDown: 3,       // consecutive failed probes before a dependency is "down"
  governancePollSeconds: 30,        // ProgramData, Squads multisig, transactions, proposals, Config
  escalateAfterSeconds: 900,        // a warning held this long is re-raised as a page
  pageRepeatSeconds: 300,           // an unacknowledged page repeats
  phaseOverdueSeconds: 120,         // a due phase transition still not done
  deckLowAlertEntries: 5_000,       // PARAMS §14 Stock-Up alarm ("alarm below 5k")
  vrfLatencyWindowSeconds: 900,     // rolling window of the reveal latency p50 / p95
  vrfLatencyP95AlertSeconds: 20,    // = VRF.busyOldestItemSeconds
  execSlipUsageAlertBps: 8_000,     // (expected − delta) / (expected − min_out) of a landed exec trade
  feePayerLowLamports: 500_000_000n, // keeper or executor fee payer below 0.5 SOL (PARAMS §17 funds 1–2 SOL)
  heartbeatStaleSeconds: 180,       // /api/status reports the monitor stale after this
  statusMaxAgeSeconds: 30,          // TTL of the status snapshot in Redis
  // ===== END M6 MONITOR KEYS

// New top-level blocks, after SERVICES:
// ===== BEGIN M6 RESCUE BLOCK (RESCUE-A) — 06-M6-BRIEF.md §4.2 [OFF] [A]
export const RESCUE = {
  cardMovedRetries: 3,              // re-read and rebuild after CardMoved before reporting
  scanConcurrency: 4,               // parallel RPC reads per scan
} as const;
// ===== END M6 RESCUE BLOCK
// ===== BEGIN M6 CLUSTER BLOCK (RC) — 06-M6-BRIEF.md §4.2 [OFF]
// Public program ids of our own deployments, from the founder's F8 public keys (never a key file).
export const ONEPERCENT_PROGRAM_IDS = { mainnet: null, canary: null, devnet: null } as {
  mainnet: string | null; canary: string | null; devnet: string | null;
};
// ===== END M6 CLUSTER BLOCK
```

`validateParams()` check 23: every monitor and rescue value is a positive integer (`feePayerLowLamports` a positive bigint); `probeFailuresBeforeDown ≥ 2`; `pageRepeatSeconds ≥ 60`; `escalateAfterSeconds ≥ alertDedupeSeconds`; `deckLowAlertEntries > COVERAGE.dustBuffer`; `vrfLatencyP95AlertSeconds < VRF.timeoutSeconds`; `execSlipUsageAlertBps ≤ 10_000`; `heartbeatStaleSeconds ≥ 2 × chainCheckSeconds`; `statusMaxAgeSeconds < heartbeatStaleSeconds`; `fullPassSeconds ≥ chainCheckSeconds`; each non-null `ONEPERCENT_PROGRAM_IDS` entry decodes to 32 bytes and the three differ.

### 4.3 Transport (D14)

Every RPC, HTTP, Telegram, pager and pinning call made by the monitor, the API status route and the CLIs uses `SERVICES.transport.rpcTimeoutMs` (RPC) or `.webhookTimeoutMs` (Telegram, pager, pinning). The monitor wraps each provider (each RPC endpoint, Jupiter, Telegram, the pager) in a circuit breaker that opens after `breakerFailureThreshold` consecutive failures for `breakerOpenSeconds`; an open breaker counts as a failed probe. Postgres statements use `dbStatementTimeoutMs`; Redis commands `redisCommandTimeoutMs`. On SIGTERM the monitor stops its loops, writes open pages back and releases its leader lock within `shutdownDrainMs` (D15). The rescue tools use `rpcTimeoutMs` per call and no breaker: the user retries.

---

## 5. M6.1 Monitor and status (MON, STATUS)

### 5.1 Shape of the `monitor` role

- **Runtime.** `services/worker` with `ROLE=monitor` on S0's runtime (M2 §11.1). No key (it refuses to boot with any `*_KEYPAIR`). Its own Helius key in `RPC_URL` and `MONITOR_RPC_URL_FALLBACK` (Triton), Postgres (a role with `SELECT` on M2 and M4 tables, write on the §5.8 tables, `alerts` and `cursors`), Redis, and the private network (`PRIVATE_HOST=::`).
- **One active instance.** S0's leader module with the lock name `onepct:monitor` (the module takes the name as a parameter; M2's keeper keeps `onepct:keeper`). A second replica is an optional hot standby.
- **Loops.** Each has its own cadence; every on-chain deadline uses `chainNow()` (the Clock sysvar), never the host clock.

| Loop | Cadence | Reads | Checks (§5.2) |
|---|---|---|---|
| chain | `SERVICES.monitor.chainCheckSeconds` | Config, Machine, Deck header, open Pulls (`getProgramAccounts`: Pull discriminator @0, status @144), the MintLedgers and vaults the event tail touched, FeeIn lamports, the hot keys' balances | INV-01, -03 to -07, -10, -13 to -15; OPS-04, -12, -14, -15, -17; KEY-05 |
| events | continuous, cursor `monitor:events` in M2's `cursors` | `chain_events` in `order_key` order; `exec_trades`, `sell_backs`, `quote_log`, `pulls`; M4.2's `executor_trades`, `hold_log`, `creator_fee_collections` and `final_claims` | INV-01 (`VaultShortfall`), -09, -11, -12, -16; OPS-02, -03, -13, -18; KEY-01 to -04 |
| full pass | `SERVICES.monitor.fullPassSeconds` | every MintLedger and vault, every Binder (`getProgramAccounts` with the Binder discriminator), the whole Deck in `SERVICES.indexer.deckChunkBytes` slices | INV-02, -08, -14 (with cards), -17; OPS-16 |
| probes | `SERVICES.monitor.probeIntervalSeconds` | each service's private `/ready` and `/metrics` (§5.2 OPS-07), the RPC providers, Jupiter, the VRF queue, Pyth's SOL/USD account, external programs' ProgramData, pump.fun's Global, the $1PCT curve and canonical pool | OPS-01, -05 to -11; GOV-05, -06 |
| governance | `SERVICES.monitor.governancePollSeconds` | our ProgramData, the Squads multisig, every transaction and proposal from the last index seen, buffers named by upgrade proposals | GOV-01 to -04 |
| router | `SERVICES.indexer.pollMs` | new notification claims in `alerts` | routing (§5.3) |
| ops bot | Telegram long polling | Ack callbacks | paging (§5.3) |

- **Consistent snapshot rule.** A check that combines several accounts records the context slot of every read. It is evaluated only if no transaction of our program landed between the lowest and the highest of those slots (the indexer's `chain_txs`; a `getSignaturesForAddress` read on the program when the indexer lags). Otherwise it re-reads, up to `SERVICES.monitor.snapshotRetries` times, then records `inconclusive`, which is never a violation. Three inconclusive passes in a row raise the warning MON-02.
- **Before the program exists** (mainnet before RUNBOOK step 3, while the services already run for X-ray Week): the checks that read our program's accounts report `not_deployed` (info) instead of failing; the governance loop already watches the multisig.
- **Outputs.** One row per check and subject in `monitor_checks`; every state change in `monitor_events`; the status snapshot in Redis `onepct:status` (TTL `statusMaxAgeSeconds`); a heartbeat in `monitor_runs`; alerts through S0's `alert(key, severity, payload)`; pages and public posts (§5.3, §5.4).
- **Metrics scraping.** Each service exposes `/health`, `/ready` and `/metrics` on its private port (the 16 metrics of M2 §11.11). The monitor reads `http://<service>.railway.internal:<PRIVATE_PORT>/{ready,metrics}` for the services listed in `SCRAPE_TARGETS_JSON` (`[{name, url}]`, private URLs only) and parses the Prometheus text format for those 16 names, plus M4 §11.8's six, with a small zod-checked parser.

### 5.2 Check catalog

Severity: **critical** pages the guardians (§5.3); **warning** goes to the guardian group and becomes a page after `escalateAfterSeconds`; **info** goes to the digest and, where §5.4 says so, to the public channel. "Drill" says where M6-A2's drill triggers the check: **devnet** (Railway `dev` against the devnet deployment), **validator** (the soak stack with an injected account state), **synthetic** (a crafted row in the drill database of the validator stack, for checks fed by events a correct program cannot emit).

**On-chain invariants** (master §9.1; PARAMS §18 "Invariant monitor")

| Id | Check | Source | Threshold | Severity | Drill |
|---|---|---|---|---|---|
| INV-01 | Per mint, `vault.amount ≥ ledger.accounted` (I1); any `VaultShortfall` event | MintLedger and vault ATA; event tail | strict | critical | validator: `accounted = vault.amount + 1` |
| INV-02 | Per mint other than $1PCT, `accounted == Σ Deck entries + Σ cards + bucket A` (M1 §14 I1). For $1PCT, M4's exact I14: `accounted == Σ onepct[k].amount over the slots Locked or Live + jackpot_tokens + final_pool_1pct + Σ $1PCT card amounts in every Binder` (M4 §9) | full pass, consistent snapshot | exact | critical | validator: an extra card |
| INV-03 | `Machine.lamports ≥ rent_min(3,808) + stock_sol + jackpot_sol + burn_sol + team_sol + final_pool_sol` (I2); rent from `getMinimumBalanceForRentExemption` | Machine | strict | critical | validator |
| INV-04 | Every bucket `reserved ≤ C`; `Σ reserved == Σ price × COVERAGE.perPackValueBps / 10,000` over the packs of Pending Pulls (I3) | Machine, Pending Pulls; consistent | exact | critical | validator |
| INV-04b | D12: each bucket with `reserved > 0` can still deliver one base unit of the smallest hit it covers: `floor(V × A / C) ≥ 1` with `V = price(E) × HIT_TIERS.silver.valueBps / 10,000` for the smallest edition E among the Pending packs it backs (M1's carve rounding) | Machine, Pending Pulls' `backing` | — | critical | validator: tiny `A` |
| INV-05 | `reserved_dust == 4 × Σ qty`, `pending_pulls == #Pending`, `Σ binder.reserved == 5 × Σ qty` over Pending Pulls (I4) | Machine and Pending Pulls; the pending buyers' Binders each minute, every Binder in the full pass; consistent | exact | critical | validator |
| INV-06 | Pending Pull lamports ≥ rent + `qty × price`; Revealed ≥ rent + unsettled royalties, refunds and referral (I5) | open Pulls | — | critical | validator |
| INV-07 | Deck `len ≤ cap ≤ COVERAGE.deckMax`; data length `64 + 80 × cap`; lamports ≥ rent of its size (I6) | Deck header and account info | — | critical (rent shortfall only after a rent rise: warning) | validator |
| INV-08 | Binder `len + reserved ≤ cap`; `fresh_in_deck ≤ FEED_RULES.freshCapPerWallet`; `fresh_in_deck ==` its FRESH Deck entries + its FRESH picks not yet settled (I7) | full pass | exact | critical | validator |
| INV-09 | Each stock-tier `PackRevealed` has `hit_value == price × HIT_TIERS[tier].valueBps / 10,000` (I8) | event tail | exact | critical | synthetic |
| INV-10 | Phase never decreases; each `onepct[k].state` only moves Locked → Live → Pulled, or Locked or Live → Final; no Pull returns to Pending (I9); at most one slot is Live, and a Live slot `k` has every slot before it Pulled (M4 L1) | chain loop, against the last values seen | — | critical | validator: a lower phase; two Live slots |
| INV-11 | `HitSkipped` or `CardDropped` → critical; `CallbackSkipped` with a reason other than 4 (NotPending) or 5 (Late) → warning (I11) | event tail | count > 0 | critical / warning | validator: mock `fulfill_raw` with a wrong Pull (warning); synthetic (critical) |
| INV-12 | Each `SoldBack`: `payout ≤ floor(min(stocked_value, quote) × SELL_BACK.payoutBps / 10,000)`; `sb_paid_hour ≤ max(SELL_BACK.hourlyBudgetMinLamports, sol_at_hour_start × SELL_BACK.hourlyBudgetBpsOfStockSol / 10,000)`; `stock_sol ≥ SELL_BACK.solFloorLamports` afterwards (I12) | event tail, Machine | — | critical | synthetic |
| INV-13 | `Machine.exec.kind == 0` in every Machine read (I13) | chain loop | — | critical | validator: `exec.kind = 1` |
| INV-14 | Every minute: `ledger($1PCT).accounted ≥ Σ onepct[k].amount over the slots Locked or Live + jackpot_tokens + final_pool_1pct` (the cards term needs the full pass, where INV-02 checks the exact I14). Before the snapshot `final_pool_1pct` is 0; after it no slot is Locked or Live and `jackpot_tokens` is 0 (M4 §9) | Machine, ledger | — | critical | validator |
| INV-15 | Hourly caps after the SDK's hour rotations: `stock_bought_hour` and `stock_sold_hour` vs `max(STOCK.hourlyFloorLamports, STOCK.hourlyHitOutMultiple × h_out)` (MAJOR sells in BuysClosed exempt); each `trend_*_hour(b)` vs `STOCK.trendingHourlyMaxLamports`; `burn_paid_hour` vs `BURN.hourlyMaxLamports`; `sb_paid_hour` vs the Sell back budget | Machine | above `SERVICES.monitor.stockCapUsageAlertBps` of a cap: warning; above the cap: critical | warning / critical | validator: counters; Soak-V launch hour (warning) |
| INV-16 | Each `CreatorFeesCollected`: `to_stock + to_burn + to_team == amount`; `to_burn` and `to_team` equal `splitCreatorFees(amount, regime)`; the regime is AFTER_END from BuysClosed on, BEFORE_ON_AIR in PoweredOn, and in OnAir agrees with the event's own `book < target` (M4 §7.2, CF1) | event tail, `creator_fee_collections` | exact | critical | synthetic |
| INV-17 | After `FinalPullStarted`: `final_pool_sol + Σ paid SOL shares == final_sol_total` (F1); per bucket `A(b) + Σ claimed s_b == final_pool(b)`, and `final_pool_1pct + Σ claimed s_1pct == final_1pct_total` (F2); every claim equals `finalShares(machine, binder)` for its Binder's `season_spend`, each claimed bit set once (F3) (M4 §9) | full pass, `final_claims`, Machine, Binders; consistent snapshot | exact | critical | synthetic; validator (`--sealing` genesis) |

**Operations**

| Id | Check | Source | Threshold | Severity | Drill |
|---|---|---|---|---|---|
| OPS-01 | VRF queue occupancy above `MONITOR.vrfQueueOccupancyAlertBps` → warning; above `VRF.busyOccupancyBps`, or oldest item older than `VRF.busyOldestItemSeconds` → status "Machine busy"; queue unreadable → warning | `decodeVrfQueue` (M2 §11.7) on `Config.vrf_queues[active_queue]` | 5,000 bps; 8,000 bps; 20 s | warning | validator: queue fill (§8.5 C7); devnet: read only |
| OPS-02 | VRF expiries: `PullRefunded` per 1,000 `PullOpened` (the last 1,000 Rips) above `MONITOR.vrfExpiriesPerThousandRipsAlert`, or at least `SERVICES.monitor.vrfExpiryClusterPerWallet24h` refunds for one buyer in 24 h | event tail | 1 per 1,000; 3 per 24 h | critical: a guardian decides whether to pause RIP | validator: mock oracle withholds |
| OPS-03 | Reveal latency (`PullOpened` → `PullRevealed` block times) p50 and p95 over `vrfLatencyWindowSeconds`; p95 above `vrfLatencyP95AlertSeconds` | `pulls` | 20 s | warning | validator: mock latency |
| OPS-04 | Settle backlog: the oldest revealed, unsettled pack older than `SERVICES.keeper.settleBacklogAlertSeconds` | open Pulls | 60 s | warning | devnet: keepers stopped after a Rip (validator if devnet cannot Rip) |
| OPS-05 | No keeper replica reports `onepct_keeper_is_leader 1` for longer than `SERVICES.keeper.leaderFailoverSeconds` | keepers' `/metrics` | 60 s | critical | devnet: stop both keepers |
| OPS-06 | Indexer lag above `SERVICES.indexer.lagAlertSeconds` | Redis lag (M2 §11.3), indexer `/metrics` | 60 s | warning | devnet: stop the indexer |
| OPS-07 | A service's `/ready` fails `probeFailuresBeforeDown` consecutive probes | private network | 3 probes | critical for `api`, `indexer` and both keepers together; warning for one keeper replica, the signers, `executor`, `bot` | devnet: stop each service |
| OPS-08 | From PoweredOn on: no `CreatorFeesCollected` with `amount > 0` for `MONITOR.feeInSilenceAlertSeconds` while $1PCT traded in that window (the curve's reserves, or the canonical pool's vault balances, changed between reads): M4.2's `fee_in_silent` rule, re-read by the monitor; the alert itself is routed here too | event tail, curve and pool reads | 600 s | warning; critical after twice the window (M4 §11.2) | canary (M4 V8 needs a collection there); validator: buys of the soak coin with the fee chain stopped |
| OPS-09 | Pyth: the SOL/USD sponsored account (PARAMS §21.1) older than `STOCK.pythMaxAgeSeconds` at `probeFailuresBeforeDown` consecutive probes, or the keeper's MAJOR trades failing on stale prices for `SERVICES.monitor.stockConditionAlertSeconds` | chain, `stock_trades` | 60 s | warning | canary read; synthetic |
| OPS-10 | Jupiter: a keyless quote probe failing `probeFailuresBeforeDown` times, or every quote-signer request refused as unavailable for 5 min | probe, `onepct_signer_refusals_total` | 3 probes | warning | devnet: drill mode probes a dead host |
| OPS-11 | An RPC provider failing `getSlot` `probeFailuresBeforeDown` times, or behind the other provider by more than `SERVICES.indexer.lagAlertSeconds` of slots | probes | — | warning | drill: a bad URL |
| OPS-12 | A due phase transition not done after `phaseOverdueSeconds`: Setup→StockUp at `stock_up_ts` (season set); PoweredOn→OnAir at `on_air_ts`; OnAir→BuysClosed at `end_ts`; BuysClosed→FinalPull at `end_ts + SEASON.finalPullDelaySeconds` with `pending_pulls == 0`; FinalPull→Done at `final_ts + SEASON.sealDelaySeconds` | Machine, chain clock | 120 s | critical; the page carries `onepct-rescue crank …` | devnet: `SetSeason` with keepers stopped |
| OPS-13 | A landed exec trade with `(expected − delta) × 10,000 / (expected − min_out)` above `execSlipUsageAlertBps` → warning; three in a row for one signer → critical | `exec_trades` | 8,000 bps | warning / critical | validator: the stub market pays `min_out` |
| OPS-14 | Deck: in StockUp and PoweredOn, `deck.len < deckLowAlertEntries` → warning (PARAMS §14); in OnAir, `deck.len − reserved_dust < 4 + COVERAGE.dustBuffer` → status "hungry" | Deck header, Machine | 5,000 | warning / info | devnet |
| OPS-15 | An edition with SDK `maxQty(E) == 0` → status "Refilling" for it (K1's anchor alert, M2 §12.5, covers the cause) | Machine, Deck | — | info | devnet |
| OPS-16 | A MintLedger with `accounted == 0`, no listed bucket and a vault present for longer than `2 × SERVICES.keeper.closeVaultPassSeconds` | full pass | 7,200 s | warning | devnet: keepers stopped |
| OPS-17 | Keeper or executor fee payer below `feePayerLowLamports` | `getBalance` | 0.5 SOL | warning | devnet |
| OPS-18 | Any `ConfigChanged` (pause bits, role disabled, bucket disabled or enabled, cap, queue switch, `SetSeason`, `ListMint`, role set) | event tail, Config | — | info, public post (§5.4) | devnet: guardian pause and unpause |
| OPS-19 | K1's stock conditions (M2 §12.5), routed | `alerts` | `SERVICES.monitor.stockConditionAlertSeconds` | warning | from K1 |

**Key misuse**

| Id | Check | Source | Severity and page command | Drill |
|---|---|---|---|---|
| KEY-01 | An exec pair signed by `Config.keeper` (kinds 1–2) with no `stock_trades` row, or by `Config.executor` (kinds 3–4) with no `executor_trades` row (M4 §11.7). Kind 3 by any other signer is legal only in Done (M4-A5) | event tail, journals | critical; `onepct-ops guardian disable-role keeper` or `… executor` | validator: a soak tool sends a pair outside the keeper |
| KEY-02 | A `SoldBack` (a `sell_backs` row, keyed `(signature, event_index)`, D15) with no `quote_log` row for its `(owner, nonce)` | `sell_backs`, `quote_log` | critical; `disable-role quote-signer` | validator |
| KEY-03 | A `BagFed` whose attestation has no `attestation_log` row (M2's `intake_log_missing`) | `alerts` | critical; `disable-role intake-signer` | validator |
| KEY-04 | A `PullOpened` with `holder` set and no `hold_log` row (M4 §11.7) for its buyer whose `expiry` covers the Pull's block time (`expiry − ATTESTATIONS.holdTtlSeconds ≤ block time ≤ expiry`) | event tail, `hold_log` | critical; `disable-role intake-signer` | validator |
| KEY-05 | A Config role, `admin`, `team_wallet`, `team_wallets`, `token_mint` or the queue list differs from `EXPECTED_ADDRESSES_JSON` (the published set) | Config | critical | devnet: set a role |

**Governance**

| Id | Check | Source | Severity | Drill |
|---|---|---|---|---|
| GOV-01 | Our upgrade authority is the Squads vault of RUNBOOK step 4 until Sealed, and `None` after | ProgramData | critical | devnet: drill program |
| GOV-02 | ProgramData's deploy slot changed, or its executable hash differs from the published verified hash (§7.5), without a matching executed upgrade proposal | ProgramData | critical (an info post when it matches) | devnet: direct upgrade of the drill program |
| GOV-03 | Squads multisig: `threshold == GOVERNANCE.multisigThreshold`; members equal the published three with their permissions; `timeLock == GOVERNANCE.timelockSeconds`; config authority is the default key (autonomous) | multisig account | critical | devnet: drill multisig |
| GOV-04 | Every new transaction index of the multisig is decoded and followed through its lifecycle (§5.4); one touching our program (a loader Upgrade or SetAuthority of our ProgramData, any `onepercent` instruction) also pages the guardians, who confirm it is expected | multisig, transactions, proposals | critical page + public post | devnet: drill multisig with a 60 s time lock (as G0.1) |
| GOV-05 | ProgramData slot of pump.fun, PumpSwap, pump fees, Mayhem, MagicBlock VRF, the Pyth receiver and Squads; pump.fun Global `create_v2_enabled` | probes | warning; critical for pump.fun and `create_v2_enabled` before Power-On | read only; drill: a stale baseline |
| GOV-06 | From PoweredOn on, FeeIn stays $1PCT's creator: the conditions of M4.2's `fee_in_creator_changed` (M4 §11.2), re-read with M4's SDK pump module: the curve's `creator` and, once migrated, the canonical pool's `coin_creator` equal FeeIn; `is_holder_reward` is 0 on both; no pump fees sharing-config account exists for the mint. The keeper's alert routes here too | probes | critical: a P0 incident (RUNBOOK playbook P14) | validator: an injected curve with another creator |

**Monitor**

| Id | Check | Severity |
|---|---|---|
| MON-01 | Heartbeat: a `monitor_runs` row per chain loop; `/api/status` reports `monitor.fresh = false` after `heartbeatStaleSeconds`; the external watchdog pages (§5.10) | critical (from outside) |
| MON-02 | A check throws `probeFailuresBeforeDown` times in a row, or is inconclusive three passes in a row | warning |

### 5.3 Alert routing and guardian paging

- **Sources.** The monitor's checks, and every service's own alerts (M2 §11.11: indexer lag, Deck drift, no leader, settle backlog, role mismatch or disabled, `intake_log_missing`, `VaultShortfall`, `fork_rollback`, the VRF alerts, K1's stock alerts; M4 §11.8: `executor_residue` and `executor_failures` (warning), `fee_in_creator_changed` (GOV-06), `fee_in_silent` (OPS-08), `final_pull_not_started` (OPS-12)). A table in code maps each alert key to a check id; an unknown key routes as a warning.
- **Router (M6-A8).** The monitor polls `alerts` for rows whose `notified_at` advanced since its cursor; each claim is one notification. Services keep calling `alert()`; `ALERT_WEBHOOK_URL` stays unset in production.
- **Channels:**

| Severity | Both guardians (DM) | Guardian group | Pager (`PAGER_WEBHOOK_URL`) | Public watch channel | Repeats |
|---|---|---|---|---|---|
| critical | yes | yes | yes | only the public facts of §5.4 | every `pageRepeatSeconds` until a guardian acks or the check passes |
| warning | no | yes | no | no | none (dedupe `alertDedupeSeconds`); held `escalateAfterSeconds` → re-raised as critical |
| info | no | hourly digest | no | the events of §5.4 | none |

- **Telegram.** A bot of its own, distinct from X3's public bot: `TELEGRAM_OPS_BOT_TOKEN`, `OPS_GUARDIAN_CHAT_IDS_JSON` (the two DM chats), `OPS_GUARDIAN_USER_IDS_JSON` (who may ack), `OPS_GROUP_CHAT_ID`, `WATCH_CHANNEL_ID`. Bot API calls (`sendMessage`, `answerCallbackQuery`, `getUpdates`) through zod-typed `fetch`, at most `BOT.maxMessagesPerSecond` overall.
- **Page text** (operator text, English, at most 6 lines): `CRITICAL <check id> <title>`; observed value against the threshold, with the PARAMS key name; slot and UTC time; the guardian command when one applies (e.g. `onepct-ops guardian pause --bits RIP --cluster mainnet --keypair <guardian file>`); links to Solscan and `/status`. One inline button: **Ack**.
- **Ack.** A callback from a user in `OPS_GUARDIAN_USER_IDS_JSON` stops that page's repeats and posts "acked by <label>" to the group. Acks live in `monitor_pages`. When the check passes again, a "resolved" line goes to the group.
- **Pager webhook (optional, founder's choice, RUNBOOK step 0).** `POST {key, severity, title, text}` with `PAGER_WEBHOOK_TOKEN` in a header when the provider needs one; never a credential in the URL.
- **Outages.** Paging works with Postgres or Redis down: open pages are kept in memory and written back when the database returns.
- **Never in a page:** a user's address (only program, role and protocol accounts), a secret, a full RPC URL (S0's log sanitizer applies).

### 5.4 Upgrade watcher and the public watch channel

- **Decoders** (`@onepercent/sdk/governance`, pure, MON):
  - `loader.ts`: `programDataAddress`, `decodeProgramAccount`, `decodeProgramData` → `{slot, authority | null, bytes}`, `decodeBuffer` → `{authority | null, bytes}`, `executableHash(bytes)` (SHA-256 of the executable bytes with the trailing zero padding removed: the value `solana-verify get-program-hash` and `get-buffer-hash` report, §7.5), `upgradeIx` (loader tag 3) and `setAuthorityIx` (tag 4, no new authority = None), byte-identical to the instructions in `scripts/devnet-upgrade-drill.mjs` (golden test).
  - `squads.ts` (`@sqds/multisig` 2.1.4): the multisig, vault and config transactions and proposals, and their PDAs.
  - `describe.ts`: `describeTransaction` → a typed list: `LoaderUpgrade {program, buffer, bufferHash}`, `LoaderSetAuthority {target, newAuthority | null}`, `OnepercentIx {name, args}` (decoded with the IDL, e.g. `admin_config SetSeason {…}`), `SquadsConfig {SetTimeLock | AddMember | RemoveMember | ChangeThreshold | SetRentCollector | AddSpendingLimit | RemoveSpendingLimit}`, `SystemTransfer`, `TokenTransfer`, `Unknown {programId, dataSha256}`.
  - `release.ts`: `releaseAt = approval timestamp + timeLock`, the multisig's time lock being read at execution time (Squads v4 source; the rule the G0.1 drill exercised, Appendix C).
- **Lifecycle** per transaction index, stored in `governance_txs`: created → active → approved (with `releaseAt`) → executed | rejected | cancelled | stale (at or below the multisig's stale index without execution).
- **Public posts** (`WATCH_CHANNEL_ID`, keys `watch.*` of COPY issue 3; one post per lifecycle step, idempotent through `watch_posts`):
  - every proposal step; for an upgrade: the buffer's executable hash, the approval time, the release time (12 h after approval), and the line that exits stay open so anyone can take back or redeem first; for the seal: the release time; for executed: the new hash, or "Sealed.";
  - pause bit changes, role disabled or re-enabled, bucket disabled or enabled, cap changes, queue switch, `SetSeason`, `ListMint`;
  - phase changes: Stock-Up, Power-On, On Air, Buys closed, The Final Pull, Done;
  - the program's upgrade authority changing (to the vault at RUNBOOK step 4; to None at the seal), with the authority read from ProgramData.
  - Never posted: alerts, internal health, anything about a user.
- **Hash chain.** At creation, the watcher hashes the upgrade buffer; at execution, GOV-02 compares ProgramData's new hash with it and with the hash published for that release (§7.5). Any mismatch is critical.
- **On `/status`.** Each queued proposal with its kind, state, release time and buffer hash.

### 5.5 Status model and the degraded-modes matrix

MODEL-SPEC §9.4, as it stands for Season 1 (Jackpot J-B: no Jackpot orders; no Spotlight). Each dependency has a state: `operational`, `degraded`, `down` or `unknown` (no fresh data).

| Id | Dependency | Detected by | What stops | What keeps working | Recovery |
|---|---|---|---|---|---|
| `vrf` | MagicBlock VRF | OPS-01–03, GOV-05 | New reveals; pending Pulls refund after 300 s; "Machine busy" while the queue is above 80% or its oldest item is older than 20 s | Feed, take-back, Redeem, Sell back, settle | Automatic. A guardian may pause RIP to stop new escrows |
| `jupiter` | Jupiter | OPS-10 | Stock buys (editions close as coverage drains), Sell back quotes, Sell at market, X-ray values | Rip while covered, Feed, Redeem, take-back | Automatic |
| `pyth` | Pyth prices | OPS-09 | MAJOR stock buys and sells | Everything else | Automatic; the keeper posts its own updates when sponsored feeds are stale |
| `pumpfun` | pump.fun or PumpSwap change, or FeeIn no longer the creator | GOV-05, GOV-06, OPS-08 | Creator-fee collection; burn and Jackpot buys (the pot stops growing) | Packs run on the existing stock | Patch the keeper and the executor; a program upgrade only if on-chain parsing changed (12 h timelock) |
| `keeper` | Keeper | OPS-04, -05, -07, -12 | Fast settles (the app prepends them), stock refills, automatic refunds and phase advances (anyone can call them) | Every user action | The second keeper takes over through the leader lock |
| `executor` | Executor | OPS-07; M4's `executor_failures`, `executor_residue` | Burn and Jackpot buys | Everything else | Restart |
| `intake` | Intake signer | OPS-07 | Fresh Feed, the holder boost | Take-back, Feed back, Rip without the boost, Redeem | Restart |
| `quote` | Quote signer | OPS-07 | Sell back | Sell at market, Redeem | Restart |
| `api` | API | OPS-07, the external watchdog | App data: X-ray, 1% TV, estimates, `/api/rpc` | The rescue page and CLI build every exit from chain | Restart or Railway rollback |
| `indexer` | Indexer | OPS-06, -07 | 1% TV, history, fresh Feed (the intake signer answers `indexer_lag`) | Cards and exits from chain; the rescue tools | Restart; replay |
| `rpc` | RPC provider | OPS-11 | Nothing while the fallback answers | — | Automatic fallback (Triton) |
| `program` | Program bug | INV-* | What the guardians pause (at most RIP, FEED, SELLBACK, STOCKBUY, BURN) | Every exit | 12 h timelocked fix |
| `team` | Team gone | — | Nothing that matters | Exits forever; permissionless burn after Done | — |

The machine section adds: phase and season clocks (`stock_up_ts`, `power_on_ts`, `on_air_ts`, `end_ts`, `final_ts`, and the seal time `final_ts + SEASON.sealDelaySeconds`); each pause bit by name; disabled roles; disabled buckets; each edition's state (`open`, `refilling`, `hungry`, `busy`, `paused`, `closed`); VRF occupancy and latency p50 / p95; last settle age; indexer lag; pending Pulls. The governance section: the upgrade authority as the chain shows it (the Squads vault with its threshold and time lock, or Sealed), the deployed hash against the verified hash, queued proposals. The rescue section: the CID and its gateway URLs.

### 5.6 `/api/status` (MON; append-only extension of M2's `StatusResponse`)

```ts
StatusResponse = M2StatusResponse.extend({
  generatedAt: z.number(),                                   // unix seconds, chain clock
  monitor: z.object({ lastRunAt: z.number().nullable(), fresh: z.boolean() }),
  machine: z.object({
    phase: Phase,
    clocks: z.object({ stockUpTs, powerOnTs, onAirTs, endTs, finalTs, sealAt }),     // numbers or null
    paused: z.object({ rip: z.boolean(), feed: z.boolean(), sellBack: z.boolean(), stockBuy: z.boolean(), burn: z.boolean() }),
    disabledRoles: z.object({ keeper: z.boolean(), executor: z.boolean(), intakeSigner: z.boolean(), quoteSigner: z.boolean() }),
    editions: z.array(z.object({ id: EditionId, state: z.enum(['open','refilling','hungry','busy','paused','closed']), maxQty: z.number() })),
    vrf: z.object({ occupancyBps: z.number().nullable(), oldestItemAgeSeconds: z.number().nullable(),
                    p50Seconds: z.number().nullable(), p95Seconds: z.number().nullable() }),
    pendingPulls: z.number(), lastSettleAgeSeconds: z.number().nullable(), indexerLagSeconds: z.number().nullable(),
  }).nullable(),
  dependencies: z.array(z.object({ id: DependencyId, state: z.enum(['operational','degraded','down','unknown']), since: z.number().nullable() })),
  governance: z.object({
    authority: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('squads'), multisig: PublicKeyString, vault: PublicKeyString, threshold: z.number(), members: z.number(), timeLockSeconds: z.number() }),
      z.object({ kind: z.literal('sealed') }),
      z.object({ kind: z.literal('other'), address: PublicKeyString }),
    ]),
    deployedHash: Hex32.nullable(), verifiedHash: Hex32.nullable(),
    proposals: z.array(z.object({ index: z.number(), kind: z.enum(['upgrade','seal','config','admin','transfer','other']),
                                  state: z.enum(['active','approved','executed','rejected','cancelled','stale']),
                                  releaseAt: z.number().nullable(), bufferHash: Hex32.nullable() })),
  }).nullable(),
  rescue: z.object({ cid: z.string().nullable(), urls: z.array(z.string()) }),
  checks: z.object({ critical: z.number(), warning: z.number() }),   // counts only
})
```

- The route serves the Redis snapshot. If it is missing or older than `statusMaxAgeSeconds`, it serves M2's own fields with `monitor.fresh = false` and the other sections `null` or `unknown`. It never computes a missing section itself.
- The JSON carries the exact substring `"fresh":true` when fresh (the watchdog's keyword, §5.10); a test pins it.
- `rescue.cid` and `urls` come from the API's env (`RESCUE_CID`, `RESCUE_URLS_JSON`), set at each rescue release.
- No new rate limit beyond M2's route; Cloudflare may cache it for 5 s.

### 5.7 The `/status` page (STATUS)

- Route `/status` (reserved by M3 §7.1), its own chunk, never behind a flag, no wallet, no `@solana/web3.js` in the chunk.
- Data: `/api/status` every `WEB.machinePollMs` (`machinePollHiddenMs` when hidden). When the API fails: the static matrix of §5.5 from copy, the copy line that status data is offline, the rescue link (`VITE_RESCUE_URL`) and the program id. Nothing is computed or guessed.
- Layout: semantic HTML (headings, tables, description lists) in the shell's existing styles. It is plumbing, not an experience component; `adapters/status.ts` exposes a `StatusProps` shape so the architect can replace the renderer later.
- Trust lines follow M3 §14.3: the timelock line only when the chain shows the Squads vault with threshold 2 and time lock 43,200; "Sealed." when the authority is None; nothing otherwise.
- Links: "Status" in the footer and in `OfflineBanner` (append-only, M3's files).
- Accessibility: axe zero serious or critical; "updated" in a polite `role="status"` region.
- **Copy keys (COPY.md issue 3, §5 Status):** `title.status`, `nav.status`, `status.heading`, `status.updated` ({time}), `status.stale`, `status.offline`, `status.phase.<phase>`, `status.clock.<stockUp|powerOn|onAir|end|final|seal>` ({date}, {time}), `status.paused.<rip|feed|sellBack|stockBuy|burn>`, `status.role.<keeper|executor|intakeSigner|quoteSigner>.disabled`, `status.edition.<open|refilling|hungry|busy|paused|closed>` ({edition}), `status.vrf.occupancy` ({pct}), `status.vrf.latency` ({s}), `status.settleAge` ({s}), `status.indexerLag` ({s}), `status.dep.<id>.<name|stops|keeps|recovery>` for the thirteen ids of §5.5, `status.state.<operational|degraded|down|unknown>`, `status.gov.<squads|sealed|other>`, `status.gov.hash.<match|mismatch>` ({hash}), `status.proposal.<kind>` ({time}, {hash}), `status.rescue.heading`, `status.rescue.cid` ({cid}).

### 5.8 Database (MON; one generated, forward-only migration)

| Table | Key | Main columns | Writer |
|---|---|---|---|
| `monitor_checks` | `id` (check id and subject, e.g. `INV-01:<mint>`) | check, subject, state (`ok`, `warning`, `critical`, `inconclusive`, `error`, `not_deployed`), observed jsonb, threshold jsonb, slot, observed_at, first_failed_at, last_ok_at | monitor |
| `monitor_events` | `id` uuid | check, from_state, to_state, slot, at, payload jsonb | monitor, insert-only |
| `monitor_runs` | `loop` | last_started_at, last_finished_at, last_error | monitor |
| `monitor_pages` | `id` uuid | alert_key, check, severity, first_sent_at, last_sent_at, repeats, acked_by, acked_at, resolved_at, deliveries jsonb | monitor |
| `governance_txs` | (`multisig`, `index`) | kind (`vault`, `config`), creator, decoded jsonb, status, approved_at, release_at, executed_at, stale | monitor |
| `watch_posts` | `event_key` (unique) | channel, message_id, posted_at | monitor (idempotent posts) |

### 5.9 The drill (`pnpm --filter worker monitor:drill`)

- `monitor:drill --env devnet|validator [--check <id> | --all]` triggers each check by the method in its Drill column, waits for the expected state, route and post, then restores the state. It writes `reports/monitor-drill/<UTC date>.json`: per check, trigger time, detection time, routes, ack.
- **Devnet:** the Railway `dev` stack against the devnet deployment; a drill multisig (Squads v4, 2-of-3 with drill keys and a 60 s time lock, as G0.1) and a drill program for GOV-01–04; test Telegram chats. **Validator:** the soak stack (§8.2) with `export_fixtures` states and the synthetic rows of §5.2.
- **Pass:** every check id of §5.2 reaches its state and routes as specified; detection within one cadence of the trigger (plus `probeFailuresBeforeDown` probes where it applies); both guardians receive a test page on their phones and ack it.

### 5.10 External watchdog

The founder sets an external keyword monitor (UptimeRobot's free plan: keyword monitors at 5-minute intervals; its commercial-use terms: verify at M6 start, Appendix C) on `https://www.onepercent.fun/api/status` (the hostname attached to `web`), expecting the keyword `"fresh":true`, alerting both guardians through its own app and e-mail. It catches the monitor, the API or the domain being down. It is active from SW-1: before it, the landing-proxy mode sends every path to the landing (RUNBOOK steps 0.2.4 and 2).

---

## 6. M6.2 Rescue (RESCUE-A, RESCUE-B, RESCUE-PAGE)

### 6.1 Rules

- **Scope.** Every exit of master §9.1 I10 that returns a user's value: `take_back`, `redeem`, `settle`, `refund_pull`, `withdraw_owed`, `claim_final_sol`, `claim_final_tokens`, `close_vault`, `close_binder`; and the two permissionless cranks without which the Final Pull never opens when the keeper is down: `advance_phase` and `start_final_pull`.
- **Inputs.** The chain, through an RPC URL the user supplies, and the user's wallet (page) or key file (CLI). Nothing else (§2 rule 4).
- **One library, two clients.** `@onepercent/sdk/rescue` holds the discovery decoders, the plans and the transaction composition, built only on the existing SDK builders (M1 §15, M2 §10, M4). The CLI and the page add only I/O. A builder the library needs and does not find in the SDK is a stop-and-report.
- **Program id.** Chosen among `ONEPERCENT_PROGRAM_IDS` (mainnet by default; canary and devnet under "advanced"). A custom id is accepted only under "advanced", with a warning; the tool checks that the account is an upgradeable program and that its Config PDA decodes.
- **Clock.** The Clock sysvar (`unix_timestamp`, i64 at offset 32) at `confirmed`, never the device clock (M3 §7.2).
- **Before every prompt or send:** simulate with `sigVerify: false` and `replaceRecentBlockhash: true`, and show the result; build with a blockhash fetched at `confirmed`; rebuild on expiry; reconcile partial landings from chain.
- **Fresh indices.** Every Deck index and card index is re-read just before building. On `CardMoved`, re-read and rebuild, at most `RESCUE.cardMovedRetries` times, then report.
- **Any phase, forever.** Nothing reads the phase to refuse an exit; the phase only decides whether the Final Pull steps and the cranks apply.

### 6.2 Discovery (`@onepercent/sdk/rescue/discover.ts`)

Each function returns decoded rows with the context slot of its reads. Account layouts: M1 §7, M2 §5, M4.

| Function | Reads | Returns |
|---|---|---|
| `readCore(rpc, programId)` | Config and Machine (PDAs), the Clock sysvar, ProgramData | phase, season clocks, pause bits (display only), buckets, `token_mint`, the upgrade authority |
| `findDeckEntries(rpc, programId, wallet)` | Deck header, then the entries in `SERVICES.indexer.deckChunkBytes` slices (`getAccountInfo` with `dataSlice`), at most `RESCUE.scanConcurrency` in parallel | `{deckIndex, mint, amount, deposit, flags}` where `depositor == wallet` |
| `readBinder(rpc, programId, wallet)` | the Binder PDA | header (`sol_owed`, `season_spend`, `flags`, `reserved`, `fresh_in_deck`, `pull_nonce`, `len`, `cap`) and cards |
| `findOwnPulls(rpc, programId, wallet, pullNonce)` | the Pull PDAs `["pull", wallet, n]` for `n < pull_nonce` (`getMultipleAccounts`, ≤ 100 per call) | the wallet's open Pulls |
| `findOpenPulls(rpc, programId, status)` | `getProgramAccounts`: Pull discriminator at 0, `status` at 144 (1 Pending, 2 Revealed); no `dataSize` (a Pull's size depends on `qty`) | every open Pull of that status |
| `findPullsPaying(rpc, programId, wallet)` | `findOpenPulls(2)`, then `royalties[k].depositor == wallet` or `referrer == wallet` on unsettled packs | the Pulls whose settle pays the wallet |
| `findClosableVaults(rpc, programId)` | `getProgramAccounts` on MintLedger: discriminator, `dataSize` 80, `accounted` at 72 equal to eight zero bytes; the vault ATAs (`getMultipleAccounts`); Machine buckets | closable mints with their `payer` |
| `findMyVaultDeposits(rpc, programId, wallet)` | MintLedgers with `payer == wallet` (closable or not) | the wallet's first-of-coin deposits and their state |
| `readPayees(rpc, keys)` | `getMultipleAccounts` | owner, `executable`, lamports, for M1 A14's writability |
| `readMints(rpc, mints)` | `getMultipleAccounts` | token program (the owner) and decimals |

A `getProgramAccounts` call refused by the user's RPC returns `rpc_scan_refused`. The flows that need only `getAccountInfo` and `getMultipleAccounts` (take-back, Redeem, the wallet's own Pulls, owed SOL, the Final Pull claims, Close My cards) never depend on it.

### 6.3 Builders, exit by exit

Every account below is derived from chain data or from a PDA rule; nothing comes from an Onepercent server. PDAs per M1 §6.2: `deck = ["deck"]`, `binder(o) = ["binder", o]`, `ledger(m) = ["ledger", m]`, `vault_auth = ["vault_auth"]`, `vault(m) = ATA(vault_auth, m, tokenProgram(m))`, `pull(b, n) = ["pull", b, n u32 LE]`.

| Exit | Signer (fee payer) | Preconditions, read from chain | Instructions, in order | Accounts | Batch |
|---|---|---|---|---|---|
| **Take back** `take_back(deck_index u32, amount u64)` | the depositor | the entry at `deck_index` is `{wallet, mint, amount}` (fresh read) | `SetComputeUnitLimit(CU_LIMITS.takeBack × k)`; one `create_idempotent(ATA(wallet, mint))` per distinct mint (payer: wallet); `take_back` × k with `deck_index` strictly descending | `depositor` = wallet; `deck`; `binder(wallet)` (may not exist; M1 §9.7); `mint`; `ledger(mint)`; `vault(mint)`; `vault_auth`; `destination` = ATA(wallet, mint, tokenProgram); `token_program` = the mint's owner | ≤ `TX_LIMITS.takeBackPerTx` per transaction, ≤ 1,232 B; the transaction with the highest indices first. SDK `buildTakeBackTransactions` |
| **Redeem** `redeem(card_index u16, amount u64)` | the owner | the card at `card_index` is `{mint, amount}`; any kind | `SetComputeUnitLimit(CU_LIMITS.redeem.x1 or .x8)`; one `create_idempotent(ATA(owner, mint))` per distinct mint; `redeem` × k, indices strictly descending across the whole batch | `owner`; `binder(owner)`; `mint`; `ledger(mint)`; `vault(mint)`; `vault_auth`; `destination` = ATA(owner, mint, tokenProgram); `token_program` | ≤ `TX_LIMITS.redeemPerTx`. SDK `buildRedeemTransactions` |
| **Settle** `settle(seq u64, pack u8)` | anyone | Pull status 2; the pack's bit clear in `settled_mask` | `SetComputeUnitLimit(CU_LIMITS.settle[n − 1])`; `settle` × n for one Pull; memo `1pct:roy:<seq>` | `pull` (from the scan); `machine`; `buyer` = `pull.buyer`; `referrer` = `pull.referrer`, or `buyer` as placeholder; `wallet_k` = `royalties[k].depositor` (`buyer` for a House slot); `binder_k` = `binder(depositor_k)` if `fresh_mask` bit k, else `buyer`; writability per M1 A14 from `readPayees` and `RESERVED_KEYS` | ≤ `TX_LIMITS.settlePacksPerTx` packs. SDK `buildSettleTransaction` |
| **Refund** `refund_pull(seq u64)` | anyone | Pull status 1 and `created_ts + VRF.timeoutSeconds ≤` chain clock | `refund_pull` | `pull`; `machine`; `binder(pull.buyer)`; `buyer` (A14 writability) | one Pull per transaction. SDK `buildRefundTransaction` |
| **Withdraw owed** `withdraw_owed()` | the owner | `binder.sol_owed > 0` | `withdraw_owed` | `owner`, `binder(owner)` | 1. SDK `buildWithdrawOwedTransaction` |
| **Final Pull SOL** `claim_final_sol` | anyone (normally the keeper) | phase FinalPull or Done; Binder `flags` bit 0 clear | `claimFinalSolIx({owner, ownerWritable})` (M4 §10.1), `owner` writable per M1 A14 from `readPayees` | `machine`, `binder(owner)`, `owner` (M4 §6.5) | the page: the wallet's own Binder; the CLI's `--all`: every Binder with bit 0 clear. Then `withdraw_owed` if the payment went to `sol_owed` |
| **Final Pull tokens** `claim_final_tokens` | the owner (pays the card slots) | phase FinalPull or Done; `flags` bit 1 clear | `buildFinalClaimsTransaction({owner, …})` (M4 §10.1): `claim_final_sol` then `claim_final_tokens`, owner-signed, in one transaction | `owner`, `machine`, `binder(owner)`, `system_program` (M4 §6.6) | 1; then Redeem of the new Final cards |
| **Close vault** `close_vault()` | anyone | `ledger.accounted == 0`; no bucket with `class ≠ 0` holds the mint; the vault exists; `ledger.payer` is creditable (System-owned, not executable, not in `RESERVED_KEYS`) | `close_vault` | `machine` (read-only); `mint` (writable: any donation is burned); `ledger(mint)`; `vault(mint)`; `vault_auth`; `payer` = `ledger.payer`; `token_program` | as many as fit 1,232 B. The rent goes to `ledger.payer`, never to the caller |
| **Close My cards** `close_binder()` | the owner | `len == 0`, `reserved == 0`, `fresh_in_deck == 0`, `sol_owed == 0`, and `season_spend == 0` or `flags & 0b11 == 0b11` (M2 B8) | `close_binder` | `owner`, `binder(owner)` | 1. SDK `buildCloseBinderTransaction` |
| **Crank: phase** `advance_phase()` | anyone | a transition is due (OPS-12's list) | `advance_phase` | `config`, `machine` | 1 |
| **Crank: Final Pull** `start_final_pull` | anyone | phase OnAir or BuysClosed, `now ≥ end_ts + SEASON.finalPullDelaySeconds`, `pending_pulls == 0` (refund the due ones first), `exec.kind == 0` (otherwise `ExecInFlight`: retry later) | `advance_phase` if the phase is still OnAir, then `startFinalPullIx` (M4 §10.1), as M4 §11.3's keeper job | `machine` (M4 §6.4), plus `advance_phase`'s | 1 |

**"Get everything back"** (the page's main action; the CLI's `all`), per wallet, in this order, each step simulated first and grouped at most `TX_LIMITS.txPerSignAll` transactions per approval:
1. refund the wallet's Pending Pulls older than `VRF.timeoutSeconds`;
2. settle the wallet's revealed Pulls (its cards are already in its Binder; settling returns the Pull rent and pays its depositors), and the open Pulls that pay the wallet (`findPullsPaying`, when the RPC allows scans): a FRESH card picked in an unsettled Pull still counts in `fresh_in_deck` (M1 I7), which blocks Close My cards;
3. if the Final Pull is open and `season_spend > 0`: claim tokens, then SOL;
4. Redeem every card, highest index first;
5. take back every Deck entry;
6. withdraw owed SOL;
7. Close My cards when it would succeed;
8. list the wallet's vault deposits: closable now (close them), or "comes back when that coin's vault is empty".

### 6.4 The CLI: `onepct-rescue` (`packages/cli`)

```
onepct-rescue [--cluster mainnet|canary|devnet | --program <ID>] --rpc <URL> [--json] <command>

Read-only
  status                       phase, clocks, pause bits, VRF queue, upgrade authority, from chain only
  find <WALLET>                Deck entries, cards, own Pulls, owed SOL, Final Pull claims, vault deposits,
                               and the open Pulls whose settle pays the wallet

Owner-signed: --keypair <FILE> (the owner's Solana keypair file)
  take-back [--entry <deckIndex>… | --all]
  redeem    [--card <index>… | --all]
  withdraw-owed
  claim-final [--sol] [--tokens] [--redeem]
  close-my-cards
  all                          the "everything back" plan of §6.3

Permissionless: --fee-payer <FILE>
  settle       [--pull <seq|address>… | --paying <WALLET> | --all-open]
  refund       [--pull <seq|address>… | --all-due]
  close-vaults [--mint <MINT>… | --all]
  claim-final-sol [--owner <WALLET>… | --all]
  crank advance-phase | start-final-pull

Common flags
  --dry-run    simulate only; send nothing
  --unsigned   print each unsigned transaction (base64) with its simulation; send nothing
  --yes        skip the interactive confirmation (default: print the plan, wait for "yes")
  --max <n>    cap the number of transactions
```

- `--rpc` is required and has no default; the CLI prints only its host.
- Signing: the key file is read once; the CLI prints its public key and the plan, waits for "yes" (unless `--yes`), signs in memory, sends to `--rpc`, confirms at `confirmed`, prints the signatures. §2 rule 5 applies.
- Exit codes: 0 done; 2 partial (what is left is listed); 3 the RPC refused a scan; 4 preconditions not met (for example, the Final Pull is not open); 1 error. `--json` prints one object per transaction.

### 6.5 The rescue page: `apps/rescue` (RESCUE-PAGE)

- **Static.** TypeScript and the DOM, no framework, built with Vite (`base: './'`, hash routes `#/…`), one output directory, every asset bundled (fonts included), no analytics, no service worker, no request at load.
- **Network.** Only the RPC URL the user types (`https:` required) and the wallet. A `<meta http-equiv="Content-Security-Policy">`: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https:; base-uri 'none'; form-action 'none'`. Confirmations poll `getSignatureStatuses`: no WebSocket, so `connect-src` needs no `wss:`. The RPC must accept cross-origin requests (`rescue.rpc.unreachable` otherwise). A local or `http://` RPC is refused (Chrome's Local Network Access would prompt for one anyway): such users run `onepct-rescue`.
- **Wallet.** Wallet Standard discovery (Phantom, Solflare, Backpack). Sign with `solana:signTransaction` and send through the user's RPC; use `solana:signAndSendTransaction` only when the wallet offers nothing else. Without a wallet, the page shows the equivalent `onepct-rescue` command line.
- **Flow.** (1) Cluster (mainnet by default; canary, devnet and a custom program id under "advanced"); (2) the RPC URL, with a note that scans need `getProgramAccounts`; (3) connect a wallet, or paste an address for a read-only view; (4) "Find my things" (§6.2); (5) an action per row, and "Get everything back".
- **It shows** the program id, its upgrade authority from chain (Squads 2-of-3 with the time lock, or Sealed), the phase, and its own build (commit and build date). It states that it needs no Onepercent server.
- **Budget.** At most 350 KB gzip in total (checked in CI).
- **Strings.** COPY.md issue 3 §6 (§6.6). The M3 lint rule against raw JSX text applies in spirit: a static test rejects string literals in DOM text and `aria-*`, `title`, `alt` and `placeholder` attributes outside the copy module.

### 6.6 Copy keys (COPY.md issue 3)

- **§6 Rescue:** `rescue.title`, `rescue.intro`, `rescue.cluster.{label, mainnet, canary, devnet, custom, customWarning}`, `rescue.rpc.{label, help, invalid, unreachable, refusedScan}`, `rescue.wallet.{connect, readOnly, noWallet, cliHint}`, `rescue.find`, `rescue.section.{deck, cards, pulls, owed, final, vaults, paying}`, `rescue.action.{takeBack, redeem, settle, refund, withdrawOwed, claimFinalSol, claimFinalTokens, closeVault, closeMyCards, all, advancePhase, startFinalPull}`, `rescue.state.{simulating, signing, sent, confirmed, partial, failed, cardMoved, notYet}`, `rescue.authority.{squads, sealed, other}`, `rescue.build` ({commit}, {date}), `rescue.footer`.
- **§7 Watch channel:** `watch.proposal.{created, approved, executed, cancelled, rejected, stale}`, `watch.upgrade.{queued, done}`, `watch.seal.{queued, done}`, `watch.config.<action>` (the `ConfigChanged` action codes of M1 §12), `watch.phase.<phase>`.
- §5 Status: the keys of §5.7.

### 6.7 IPFS release (RESCUE-PAGE)

Read on 2026-10-08 and 2026-10-09 (Appendix C): Storacha stopped taking uploads in May 2026 and Fleek's hosting ended on 2026-01-31; `ipfs.io` and `dweb.link` stopped serving on 2026-09-21 and send browsers to the service-worker gateway `inbrowser.link`. The release therefore pins on two independent companies and is served through gateways that still answer a browser.

| Role | Service | Free tier (no card) | Method |
|---|---|---|---|
| Pin 1 and the main HTML URL | Filebase | 5 GB, 500 pins, 1 dedicated gateway, 10 GB of IPFS egress a month (another Filebase page says 5 GB: V7) | CAR import |
| Pin 2 | Pinata | 1 GB, 500 files, 60 API requests a minute; CAR uploads need a paid plan; HTML only through a paid custom domain | pin by CID |
| Pin 2 fallback | Lighthouse | 5 GB | CAR import |

Both Filebase and Pinata announce browser-reachable providers (HTTPS trustless gateways and secure WebSockets) through delegated routing, which is how `inbrowser.link` finds the content.

`pnpm --filter rescue {build, car, pin, verify}` (the last three are `apps/rescue/scripts/{car,pin,verify}.mjs`), in this order:

1. **Build.** `SOURCE_DATE_EPOCH` is the commit's time (the page's build date comes from it). `dist/` holds no dotfile, empty directory or symlink, fewer than 1,000 entries per directory, `.js` files (never `.mjs`) and no service worker. CI builds twice from clean checkouts and compares `dist/` byte for byte.
2. **Pack** with `ipfs-car` 3.1.0 (raw leaves, 1 MiB chunks, 1,024 links per node, CIDv1): `ipfs-car pack dist --output rescue.car`, then `ipfs-car roots rescue.car` gives the root CID `R` in base32. Never pack to standard output: the CAR header then has no root. Cross-check, in the `car` script and in CI with the `ipfs/kubo:v0.43.1` image: in a temporary repository, `ipfs init --profile unixfs-v1-2025`, then `ipfs add -r -Q --only-hash dist` must print `R` (IPIP-0499; equal on paper for such a tree, verify at M6 start, V7). A mismatch is a stop-and-report.
3. **Pin 1, Filebase.** `POST https://rpc.filebase.io/api/v0/dag/import`, the CAR as form field `file`, header `Authorization: Bearer $FILEBASE_TOKEN` (a token scoped to the release bucket). The root in the response (Kubo's shape, `Root.Cid["/"]`) must equal `R`. If the free plan refuses the RPC (V7), the S3 import with the AWS CLI and a named profile, run by hand: `aws --profile filebase --endpoint-url https://s3.filebase.com s3 cp rescue.car s3://<bucket>/rescue-<R>.car --metadata import=car`, then `aws --profile filebase --endpoint-url https://s3.filebase.com s3api head-object --bucket <bucket> --key rescue-<R>.car --query Metadata.cid --output text` must print `R`.
4. **Pin 2, Pinata.** `POST https://api.pinata.cloud/v3/files/public/pin_by_cid` with `{"cid": "<R>", "name": "rescue-<commit>"}` and `Authorization: Bearer $PINATA_TOKEN` (a key with the scope `org:files:write`); poll the pin request until it is pinned; `data.cid` must equal `R`. If the free plan refuses it (V7): Lighthouse, `POST https://upload.lighthouse.storage/api/v0/dag/import` with the CAR and `Authorization: Bearer $LIGHTHOUSE_API_KEY`; its `Hash` must equal `R`.
5. **Verify** (`verify`, then a person):
   - `GET https://delegated-ipfs.dev/routing/v1/providers/<R>` lists providers of both services;
   - `https://<gateway>.myfilebase.com/ipfs/<R>/` answers 200 with `text/html`, and its `index.html` is byte-identical to `dist/index.html`;
   - in Chrome, Firefox and a phone browser, `https://<R>.ipfs.inbrowser.link/` loads the page, its hash routes work and a wallet connects. `inbrowser.link` has had no maintainer since 2026-09-30, so it is a second door, never the only one;
   - optionally `https://ipfs.aleph.cloud/ipfs/<R>/` (path style).
6. **Publish.** On `api`: `RESCUE_CID` = `R` and `RESCUE_URLS_JSON` = the URLs that passed, Filebase's first. On `web`: `VITE_RESCUE_URL` = the first of them (a rebuild). The CID and the URLs go to the watch channel, the launch log and the domain reviews (RUNBOOK steps 1.4, 6.0 and 7.3). The CID is what users check: no DNSLink and no IPNS name in Season 1, since both can be repointed.
7. **Keep.** Every released CID stays pinned on both services for at least 12 months (RUNBOOK 13.3); a new release never unpins an older one.
8. **Tokens.** Only in an uncommitted, gitignored `apps/rescue/.env.pin` on the machine of the person who pins (the founder or the architect). CI holds none. The scripts print hosts and CIDs, never a token. The names follow D13: `FILEBASE_TOKEN`, `PINATA_TOKEN`, `LIGHTHOUSE_API_KEY`.
9. **Bandwidth.** Counting the stored, uncompressed files, Filebase's free egress (5 or 10 GB a month) covers a few thousand full loads of the page; `inbrowser.link` spreads load over both providers. The `verify` script prints the release's total size. Moving Filebase to its paid plan is the founder's call (pending founder, Appendix A Q4).
10. **When.** First pin (take-back and Redeem) before `stock_up_ts` on D13; full pin (every exit) on D14 (§1.3).

### 6.8 Tests and the stopped-services drill

- **Unit** (Vitest, recorded account fixtures): every discovery decoder against golden bytes; plan ordering (descending indices, ≤ 8 per transaction, ≤ 1,232 B); M1 A14 writability for reserved, executable and read-only payees; each exit's preconditions; the chain clock (the local clock 30 s off changes nothing); `CardMoved` re-read and rebuild; `rpc_scan_refused` leaves the per-wallet flows working.
- **Static:** no import of `@onepercent/sdk/api`, `services/**` or `packages/db` from `packages/sdk/src/rescue`, `packages/cli/src/rescue` or `apps/rescue`; no `fetch` there except to the RPC URL; no key read from the environment or standard input; no copy string outside the copy module (page).
- **Validator e2e** (`pnpm e2e:validator rescue`, CI `program` job): a soak-genesis state (§8.3) holding every kind of position: FRESH and REFED Deck entries; cards of every kind; a Pending Pull past 300 s; Revealed Pulls with House slots, a reserved-key referrer and an executable depositor; owed SOL; an open Final Pull with unclaimed shares, zero shares included; empty unlisted vaults; a closable Binder. **The API, indexer, keepers, executor, Postgres and Redis are not running.** Each wallet runs `onepct-rescue all`, then the permissionless commands run. Pass: those wallets' Deck entries are gone, their Binders are empty and closed, every Pull is closed, `sol_owed` is 0, every claim bit is set, every empty unlisted vault is closed, and lamports and tokens end where M1 §16.2's P2 final drain says.
- **The same scenario through the page** (Playwright, M3's mock wallet, `apps/rescue/e2e`).
- **Devnet drill** (acceptance of master M6.2, with the founder's go): with the `dev` stack's `api`, `indexer` and both keepers stopped, every exit that devnet's state allows runs through the page and the CLI; the signatures go in the PR. An exit devnet cannot reach (for example, the Final Pull before its date) is shown on the validator run instead, and the PR says which.

---

## 7. M6.3 Hardening and the release candidate (RC)

### 7.1 Deep property runs

- On the RC commit, every property suite runs at 10,000 cases × 200 steps: P1, P2 (with every M2 and M4 operation), CR-1 (every special segment that can be live in Season 1), M-REF, EX-1, SB-1 and P4 `season_conservation`. P4 runs as many seasons as complete in 6 h on the CI runner, at least 1,000, and reports the count.
- Two independent runs with different random seeds, both recorded in the report: the CI `rc` job and the architect's machine. Any failure blocks `rc-N`. There is no 100,000-case run (master §0.5 item 5).
- **Mainnet feature set, refreshed.** RC re-captures `fixtures/mainnet/features.json` (S0's method: `getProgramAccounts` on `Feature111111111111111111111111111111111111` at `finalized`, read-only) and re-runs on it every test master §0.5 item 4 lists (T06.16, T07.05, T07.11, T08, T11.01, T11.02, the CR suites). The PR lists the features activated since S0's snapshot (slot 454,626,912) and any pending one.

### 7.2 Benches and budgets (`bench_rc.rs`, printed by `pnpm program:report`)

Method (M1 §16.3, extended to M2 and M4): whole SDK-shaped transactions, every instruction included; for each shape the worst variant (first-of-mint vaults, maximum quantities, `DECK_MAX`, every special segment that can be live, the largest Binder); LiteSVM 0.16.0 on the sBPFv3 artifact, with mainnet's feature set (the refreshed snapshot of §7.1) for the callback and the tests master §0.5 item 4 lists; sizes from `serializedSize` with dummy signatures; logs from the transaction metadata. The devnet fulfilment figure comes from S2's script, re-run by the architect on the RC's devnet build.

| Bench | Budget | Source |
|---|---|---|
| `consume_randomness`, OG ×10 at `COVERAGE.deckMax`, The 1% and the Jackpot live, the largest Binder T06.16 allows, mainnet feature set | ≤ 200,000 CU | master CR-4, M1 §10.1 |
| Full fulfilment on devnet (S2's measurement, re-taken on the RC build) | ≤ 270,000 CU | master CR-4 |
| Callback heap | ≤ 24 KiB | M1 §9.9 |
| Callback logs, OG ×10 | ≤ 9,000 B, no "Log truncated" | M1 §12, CR-5 |
| Every user transaction shape | ≤ 1,232 B; Feed ≤ 1,047 B | master §7.5 |
| Every instruction's CU | ≤ its `CU_LIMITS` entry (measured × 1.25, rounded up to 1,000) and ≤ 1,400,000 | M1 §16.3 |
| Exec transaction without the swap | report the bytes left for Jupiter's route | M2 T12.16 |
| Rescue transactions (take-back × 8 and Redeem × 8 with their ATA creates; settle × 2) | ≤ 1,232 B | M1 §15.4 |
| Launch transaction (M4's `onepct-ops launch`) | ≤ 1,232 B, or M4's two-transaction fallback | master §11.4 M4 |
| `onepercent.so` | report its size and the ProgramData rent at the live rate; RUNBOOK step 3's funding uses it (F12 assumed ≈500 KB) | master §5.1 |

A budget missed is a stop-and-report, never a silent change (master Appendix A.3 lists the only parameter levers, each a founder decision).

### 7.3 Static hygiene

`pnpm program:clippy` with `-D warnings` clean (§2 rule 2 for the fixes); `pnpm lint:words`; the pause-bit grep and exit structure (M2 T16.01); no economic literal outside `params.rs` (M1 §18 item 7); no test feature, mock or test path in the program crate (M1 T11.05); gitleaks; the dependency-age audit of both lockfiles against `VERSIONS.md`.

### 7.4 IDL and layout freeze

- `scripts/rc-freeze.mjs` writes `fixtures/rc/rc-<N>.json`: tag, commit, SHA-256 of the IDL and of the generated types, of `fixtures/vectors/layouts.json`, of the error list and of the event list, the three cluster program ids, and (after §7.5) the three verified hashes.
- CI job `rc` (every PR from `rc-1` on): the IDL, the types, the layout vectors and the error and event lists must equal the latest `rc-<N>.json`. A PR that changes them must add `rc-<N+1>.json`; only the architect opens such a PR. Codex writes `rc-1.json` once, in the RC PR.

### 7.5 Cluster builds and the verified hash (M6-A4)

- **Program id per cluster.** `scripts/set-program-id.mjs --cluster mainnet|canary|devnet --id <PUBKEY>` rewrites `declare_id!` in `programs/onepercent/src/lib.rs` and `[programs.<cluster>]` in `Anchor.toml`, then regenerates the IDL (`pnpm anchor:build && pnpm sdk:idl`). The public keys come from the founder (F8); no key file enters the repository. The architect commits each variant on a branch `rc/<N>-<cluster>` and tags it `rc-N-<cluster>`.
- **CI `ids-diff`.** `git diff --stat rc-N rc-N-<cluster>` may touch only `programs/onepercent/src/lib.rs` (the `declare_id!` line), `Anchor.toml`, and the address field of `packages/sdk/src/idl/onepercent.{json,ts}`; anything else fails.
- **Run-time program id.** A static test proves every SDK builder and PDA helper takes `programId` from its caller and that no file under `services/**`, `apps/**` or `packages/cli/**` reads the IDL's `address`. Services take `PROGRAM_ID` from their environment (S0), the web from `/api/config.programId`, the rescue tools from `ONEPERCENT_PROGRAM_IDS`. If M1's or M2's SDK cannot do this without a signature change, stop and report (Appendix B, item B4).
- **Verified build** (`solana-verify` 0.5.2, run from `app/` on each `rc-N-<cluster>` tag; facts read 2026-10-08, Appendix C):
  ```
  IMG=solanafoundation/solana-verifiable-build@sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd   # Docker Hub tag 4.3.0
  solana-verify build --library-name onepercent --base-image "$IMG" --arch v3
  node scripts/check-sbf-flags.mjs target/deploy/onepercent.so
  solana-verify get-executable-hash target/deploy/onepercent.so
  ```
  - `--arch v3` is solana-verify's own flag (since 0.4.11). Do not write `-- --arch v3`: arguments after `--` go to cargo. Do not combine it with `--cargo-build-sbf-args`.
  - Always pass the image digest: OtterSec's remote worker runs an older `solana-verify` whose image map stops before 4.3.0; the digest is stored in the verification PDA and passed through. The image is linux/amd64 only (emulated on Apple silicon: slow but identical).
  - The build uses `--locked`: `app/Cargo.lock` is committed. Never run `anchor build` after it: it overwrites the `.so`.
- **CI `verifiable-build`** (manual dispatch, and on `rc-*` tags): runs the same commands on GitHub's runner and uploads the three hashes; the architect reproduces them locally; they must be equal. They go into `fixtures/rc/rc-<N>.json` and are published at RUNBOOK step 3.
- **On mainnet** (RUNBOOK steps 3–5): `solana-verify get-buffer-hash -um <BUFFER>` before the deploy, `solana-verify get-program-hash -um <PROGRAM_ID>` after it, both equal to the published mainnet hash; then the OtterSec verification PDA, signed by the Squads vault through a vault transaction (`solana-verify export-pda-tx … --uploader <VAULT> --encoding base58 --compute-unit-price 0`, imported in Squads), and `solana-verify remote submit-job --program-id <ID> --uploader <VAULT>`. The verification needs a public source repository at the tagged commit (pending founder, Appendix A Q2). It must be in place before the seal (RUNBOOK step 12).
- `executableHash` in `@onepercent/sdk/governance` returns the same value as `get-program-hash` and `get-buffer-hash` (golden test against both on the drill program).

### 7.6 RC checklist (in the RC PR, each item with its evidence)

1. G1, G2.1 and G4.1 passed: the RC contains M1, M2.1 and M4.1 (master §11.1 D12). The services gates (G2.2 and G2.3 on D13, G4.2 on D14) are not RC inputs: the services deploy on their own and build on the frozen IDL.
2. CI green; §7.1 runs; §7.2 within budget; §7.3 clean.
3. `fixtures/rc/rc-1.json` written; the three cluster builds reproduce their hashes locally and in CI.
4. The refreshed feature snapshot and its tests pass.
5. Links to the end-to-end evidence (master §8.3 E1–E4) that exists at the tag: M2's, and M4's E4b (G4.1); E4a follows with G4.2.
6. `CU_LIMITS` and the PARAMS §26.3 measurements (`SERVICES.landing.tipLamports`, `.maxComputeUnitPriceMicroLamports`) are present in `packages/config`.
7. After the architect's PASS and the founder's merge, the architect tags `rc-1` (annotated) on the merge commit, then the three `rc-1-<cluster>` tags; the founder fast-forwards `release`.

### 7.7 What the RC audit receives (Gate G6)

The RC PR's report, `rc-1.json` and the cluster tags, the full program and services diff since G4.1, the bench and property reports, Soak-V phase 1's report, and the MON, RESCUE and OPS PRs' evidence. A finding fixed before the mainnet deploy produces `rc-2` (and so on) with the same checklist.

---

## 8. M6.4 Dress rehearsal: the soak (SOAK)

### 8.1 Two parts (M6-A1)

| Part | Where | What it proves | Volume |
|---|---|---|---|
| **Soak-V** | the soak validator: `solana-test-validator` 4.3.0 running the devnet-id build of `rc-N`, the images of every service (the PR heads named in the run report until their gates pass), Postgres, Redis, a mock oracle | the whole system under launch-like load and every chaos item of master §8.3, deterministically | 20,000 packs in the main run, ≥ 24 h on `rc-N`; an end-of-season run; a sealing run; re-runs on the merged images (§8.7) |
| **Soak-D** | devnet: the Railway `dev` stack on the devnet build of `rc-N`, the real MagicBlock devnet queue in `Config.vrf_queues`, devnet pump.fun | the real oracle, real network latency and the real deploy, with the chaos items devnet allows | ≥ 300 Rips (OG ×1–×3) at most one Rip per 3 s, to spare the shared queue |

Soak-D needs a devnet deployment in OnAir with coverage, which M4's E4a produces if M4's V6 finds pump.fun on devnet (M4 §13.6; master §8.3). If it does not, Soak-D runs the StockUp-phase flows and the operational chaos only, and the real-VRF evidence is S2 plus the canary's burst (§9, pending founder Q1). The report says which; the architect decides G6 on it.

### 8.2 The Soak-V stack (`app/soak/`)

| Component | What it is |
|---|---|
| `compose.yaml` | brings everything up on one host with Docker (at least 8 vCPU, 16 GB RAM, 100 GB SSD; the founder or the architect provides it) |
| `validator` | `solana-test-validator` 4.3.0 from the Agave release, with `--upgradeable-program <program id> onepercent.so <authority>` (the devnet build of `rc-N`), `--bpf-program Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz mock_vrf.so`, pump.fun's programs and fixed accounts from `fixtures/mainnet/pump/` with mainnet's feature set, as M4's `e2e:validator launch` loads them (so the keeper's fee chain runs), the `--account` files of §8.3, `--limit-ledger-size` |
| services | the images of `indexer`, `keeper` (×2: `keeper-a`, `keeper-b`), `executor` (M4's test-transfer adapter, `EXECUTOR_SWAP=stub`), `monitor`, `api` (public), `quote-signer`, built from the production Dockerfiles; Postgres 17; Redis 7. Env files are generated per run under `app/soak/env/` (gitignored), with soak keys generated at run time, D13 names and `PRIVATE_HOST=::` |
| `mock-oracle` (new) | watches the mock queue and fulfils each request with `0xF0` and 32 random bytes after a delay drawn from MagicBlock's measured base-layer latency (median 0.9 s, 2–10 slots: `research/randomness.md`), capped at 10 s. Chaos modes: pause; drop a fraction; late (after `VRF.timeoutSeconds`); duplicate (`0xF1` replay); reorder |
| mock VRF capacity mode | an append-only mode of `test-programs/mock-vrf`: requests stored in MagicBlock's queue layout (the one `decodeVrfQueue` reads, M2 §11.7) with a 30,000-byte capacity, refusing a request when full as MagicBlock does. M1's default mode and tests are unchanged |
| `market` (new) | the stub counterparty of the keeper's exec pairs, through its validator stub-swap mode (M2 `e2e:validator exec`): it co-signs with its own soak key and delivers `expected`, or exactly `min_out` on demand (OPS-13). The executor needs none: its test-transfer adapter pays `expected` from its own $1PCT account (M4 §11.1). If K1 has no such mode, stop and report |
| `driver` (new) | the load generator (§8.4), signing for 2,000 buyers and 800 depositors generated at run time |
| `chaos` (new) | the scheduler of §8.5: Docker stop, kill and network disconnect; guardian and admin instructions with the soak keys; the queue filler |
| `report` (new) | the measurements of §8.6 into `app/soak/reports/<run>/` (JSON and a Markdown summary) |

- **Pyth on the validator.** MAJOR stock trades need fresh `PriceUpdateV2` accounts. If the run has a Hermes key and the upgraded Pyth receiver and Wormhole receiver, cloned with their accounts at genesis (`--clone-upgradeable-program`, `--clone`; PARAMS §21.1), accept the keeper's posted updates, MAJOR trades run. Otherwise the keeper runs MAJOR trades in dry-run, TRENDING trades run against the injected pools, and the canary covers real MAJOR trades (§9). The report says which.
- **Intake on the validator.** A local validator has no Helius history, so the soak's fresh Feeds are attested by a soak-only key set as `Config.intake_signer`, as M2's tests do for quotes. The intake service itself is covered by M2's acceptance.

### 8.3 Soak genesis (`pnpm soak:genesis [--end | --sealing]`)

Built with the M1 harness's `export_fixtures(dir, now)` and the M2 and M4 injectors (timestamps rebased on `now`):
- **Main run.** Config with soak roles (admin = a soak admin key, two soak guardian keys, the 30,000-byte mock queue as `vrf_queues[0]`); Machine in OnAir (`on_air_ts = now − 60`, `end_ts = now + SEASON.durationSeconds`); `token_mint` with its curve injected in M4's 166-byte `create_v2` layout (`creator` = FeeIn), a $1PCT vault holding `TOKEN_1PCT.devBuyAmount` and the four The 1% slots (the state `power_on` leaves), and $1PCT in the executor's own token account for its test transfers; five MAJOR buckets of 1,500 SOL of book each with their vaults; two TRENDING buckets with injected pools; a Deck of 30,000 entries over 200 mints (SPL and Token-2022 metadata), 20,000 of them FRESH from 800 depositors whose Binders hold `fresh_in_deck = 25`, and 10,000 REFED; 2,000 funded buyers.
- **Book sizing.** 20,000 packs at the mix of §8.4 spend about 5,750 SOL; the stock carves about 72% of that at stocked value, about 4,100 SOL; 7,500 SOL of seeded book covers it with margin when MAJOR buys run in dry-run.
- **`--end`:** the same population, with `end_ts = now + 3,600`.
- **`--sealing`:** phase FinalPull with `final_ts = now − SEASON.sealDelaySeconds + 300`, claims partly done.

### 8.4 Load profile (`app/soak/soak.config.ts`, zod-checked; test inputs, not PARAMS)

| Parameter | Main run |
|---|---|
| Packs | 20,000 |
| Duration | ≥ 24 h (the final run on `rc-N`) |
| Rate | 2,500 packs in the first hour (a launch hour), then 700 per hour |
| Editions | The Original 50%, Blue Shift 25%, Signature 15%, After Hours 10% |
| Quantity | ×1 40%; ×2–×5 40%; the edition's maximum 20%; capped at tap by the SDK `maxQty` |
| Buyers | 2,000 wallets with Zipf-distributed activity; 30% bind a referrer |
| Holder boost | 20% of Rips carry a HOLD attestation from the soak intake key |
| After each reveal | Dust: Feed back 60%, Redeem 20%, Keep 20%. Silver to Black: Sell back 40% (the real quote signer on X2's recorded fixtures, as M2's G2.2 run), Redeem 30%, Feed back 10%, Keep 20%. Jackpot and The 1%: Redeem |
| Depositors | fresh Feeds (at most 25 fresh cards each) keep the Deck above `COVERAGE.dustBuffer + 4 × max qty`; 5% of entries are taken back over the run |
| Settles | the keeper; with the keeper stopped, clients prepend settles (M3 §12.6) |
| End | the drain: every wallet runs `onepct-rescue all`; then permissionless settle, refund and close-vaults |

### 8.5 Chaos schedule (main run; hours from its start)

| # | When | Event | Expected |
|---|---|---|---|
| C1 | every 2 h | `kill -9` the keeper leader; restart it after 5 min | the other replica leads within `SERVICES.keeper.leaderFailoverSeconds`; no OPS-05 page |
| C2 | every 6 h | network-partition the leader for 3 min (`docker network disconnect`) | failover within 60 s (worst case ≈55 s: `idle_session_timeout` 45 s plus the follower's retry); the cut-off replica sends nothing once it loses the lock |
| C3 | h 3 and h 15 | the mock oracle withholds every fulfilment for 6 min | Pending Pulls refund after 300 s; OPS-02 pages; nothing pauses automatically; at h 15 a guardian pauses RIP, then unpauses |
| C4 | all run | 0.2% of requests dropped, 0.2% fulfilled late (after 300 s), 0.5% replayed as duplicates | refunds; `CallbackSkipped` reasons 4 and 5 only; no state change from late or duplicate callbacks |
| C5 | h 5 and h 17 | Deck drain: take-backs at 20 per second for 10 min while Rips are pending, below `reserved_dust` | House Cards; `buy_packs` refuses with `MachineHungry` while short; the callback never reverts; INV-05 holds |
| C6 | h 7 | guardian `DisableBucket` on the bucket backing the most pending packs; the admin re-enables it 30 min later | pending packs still carve from their backing bucket; the keeper sells that bucket down; Sell back of that mint falls back to Sell at market; Redeem works |
| C7 | h 9 | queue filler: requests nobody fulfils until the queue is 90% full, for 15 min | OPS-01 warns above 50%; `/api/machine` reports busy above 80%; a full queue makes `buy_packs` fail cleanly; exits unaffected |
| C8 | h 11 | stop the indexer 20 min, then `indexer:replay` from the last finalized slot | OPS-06 fires; the web's data degrades while exits still build from chain; replay yields identical rows (M2 acceptance 11) |
| C9 | h 13 | stop `api` 10 min | the rescue CLI and page land exits against the validator RPC |
| C10 | h 19 | a guardian sets all five pause bits for 20 min | every exit lands; Rip, Feed, Feed back, Sell back, stock trades and $1PCT buys are refused |
| C11 | h 21 | restart Postgres; flush Redis | services recover; no transaction sent twice (keyed jobs) |
| C12 | h 22 | the market delivers exactly `min_out` on three keeper exec trades in a row | OPS-13 critical |
| C13 | h 23 | a soak tool sends one exec pair with the keeper key outside the keeper | KEY-01 critical |

**End-of-season run (`--end`):** OnAir → BuysClosed at `end_ts` (the keeper collects creator fees in the last minute); MAJOR sells at the 20 s spacing without the gross cap; pending Pulls resolve; `start_final_pull` at `end_ts + SEASON.finalPullDelaySeconds` with `pending_pulls == 0`; the keeper pushes every `claim_final_sol`; the driver claims tokens and redeems; the close-vault pass. **Sealing run (`--sealing`):** FinalPull → Done at `final_ts + SEASON.sealDelaySeconds`; permissionless Burn after Done; every exit after Done.

### 8.6 Measurements and evidence

- **Invariants.** Every INV check's history from the monitor (zero violations), and `soak_check.rs`: every hour and at the end, the run dumps every program account and every vault token account to `app/soak/dumps/<t>/`, loads them into LiteSVM and runs the M1 harness's `check_invariants()` (M1 §14, master §9.1). It is independent of the monitor's TypeScript.
- **Pulls.** Counts by final state; reveal latency p50, p95 and max; settle latency p50 and p95 with the keeper up; refunds by cause; stuck Pulls.
- **Stuck Pull:** an open Pull with `status == Pending` and `chain_now > created_ts + VRF.timeoutSeconds + SERVICES.keeper.scanSeconds + 60`; or `status == Revealed` and `chain_now > revealed_ts + SERVICES.keeper.settleBacklogAlertSeconds` while a keeper leads; or any open Pull after the drain.
- **Failovers.** For each kill and partition: the event time, the time the other replica took the lock, and its first sent transaction.
- **Monitor.** Every alert fired, matched to the chaos item that should raise it; unexpected criticals listed; page delivery and acks.
- **Exits.** The drain's results; final lamports and tokens checked with M1 §16.2's P2 final-drain rules.
- **Resources.** CU per instruction against `CU_LIMITS`; transaction sizes; RPC calls per service and minute.

### 8.7 Acceptance (master §11.4 M6.4)

1. Zero invariant violations: every monitor INV check and every `soak_check` dump.
2. Zero stuck Pulls.
3. Keeper failover within `SERVICES.keeper.leaderFailoverSeconds` on every kill and partition (at least 12 kills and 4 partitions in the main run).
4. With the keeper up, settle p95 ≤ `SERVICES.keeper.settleP95TargetSeconds`.
5. Every chaos item raised its expected alerts and no unexpected critical alert fired.
6. The drain recovered every position; the indexer replay was identical.
7. Soak-D: the same criteria at its volume, or the documented fallback of §8.1.
8. Re-runs on the merged images (D14, after G4.2): the `--end` and `--sealing` runs and a 6-hour main-run segment with C1, C2, C3 and C8, each meeting 1–6. G6 reads them for the services and the full main run for the program.

Soak-V and Soak-D gate G6 and Power-On, not Stock-Up (master §11.3). A defect found after Stock-Up is fixed through the 12 h timelock.

---

## 9. M6.5 The mainnet canary

### 9.1 What it is

- The same RC build (`rc-N-canary`) under the canary program id (F8), on mainnet, team-only, at tiny size. Railway `staging`, `staging.onepercent.fun` behind basic auth, the staging bot.
- Distinct keys for every role (master §6 rule 5). The upgrade authority is the founder's canary deployer key, kept (never Squads, never None), so the program can be closed after its season and its rent recovered (master §5.1). The canary's `Config.admin` is a founder key, so its admin steps take minutes instead of 12 h.
- Funding per F14. The monitor runs in `staging` against it with its own Telegram chats.

### 9.2 Checklist (run by the founder and the architect; RUNBOOK track C)

| # | Check | How | Pass | Owner |
|---|---|---|---|---|
| C1 | Deploy | `rc-N-canary` verified build; buffer hash checked; deploy with the canary program keypair | `solana-verify get-program-hash` equals the canary hash | founder |
| C2 | `initialize` | `onepct-ops init --cluster canary` signed by the canary deployer (M6-A3); canary roles and launch wallet; `token_mint` = the public key of the throwaway coin's mint keypair, generated now and used at C7; queue `Cuj97…` | Config decodes; roles equal the canary's published set | founder |
| C3 | Season | `onepct-ops set-season` signed by the canary admin, `S` a recent slot, `stock_up_ts` a few minutes ahead; the keeper advances | phase StockUp | founder |
| C4 | Hit list | `onepct-ops hitlist add` WIF and BONK, canary caps | buckets listed | founder |
| C5 | Staging stack | every `staging` service ready; monitor green; `onepct-ops sw check --host staging.onepercent.fun` | all checks pass | architect |
| C6 | Wallets (the final run of S5) | the founder signs Feed (1, 2, 3 bags; an 8-transaction batch) and take-back in Phantom, Solflare and Backpack. Rip, Redeem and Sell back need a canary pack (§9.3): under Q1's option A their prompts are checked on devnet | no "may be malicious" warning; sizes and approval counts as M1 and M3 measured; screenshots | founder |
| C7 | Launch rehearsal (master §8.4, M4 §12.5): T−1, D15 before 12:00 | M4's `onepct-ops launch lut`, `plan`, `check`, `send` and `report` with `--cluster canary`, a throwaway coin (neutral name, ticker and art; its address published as a test) and the 40M dev buy | `launch report` passes; its mint has exactly {MetadataPointer, TokenMetadata} and no authority, and its pump program slots are recorded: they are the baseline of M4's `launch check` items 1 and 8 and of `gonogo` G1 and G3 | founder (pending founder Q1, option A) |
| C8 | Fee chain | the staging keeper's first fee-chain transaction after C7 | `CreatorFeesCollected.amount > 0` with the PoweredOn split; otherwise NO-GO for Power-On (M4 Appendix A V8) | the staging keeper; the architect observes |
| C9 | Real swap through the exec pair | a keeper StockBuy of the available `stock_sol` (WIF), with a posted or sponsored Pyth update. If K1's policy will not trade an amount that small, the check moves to the first mainnet trades after On Air (RUNBOOK step 9.6) | `ExecEnded` Δ ≥ `min_out`; slip report | the staging keeper; the architect observes |
| C10 | Landing values | trades land with `SERVICES.landing.tipLamports`; `maxComputeUnitPriceMicroLamports` re-checked against the canary's Machine and Pull accounts (PARAMS §26.3) | both confirmed or corrected in a PR | the architect (reads only) |
| C11 | VRF burst | 300 requests (PARAMS §15 burst test) | no expiry; p95 ≤ `vrfLatencyP95AlertSeconds`; the occupancy reader agrees with the queue | the founder sends with the architect's script (pending founder Q1) |
| C12 | Monitor | the drill items marked devnet in §5.2 that apply to mainnet (pause and unpause by a canary guardian, role disable and re-enable, stop and start services), on the canary | routes and posts as specified | the founder signs with a canary guardian key; the architect checks |
| C13 | Rescue | the page and the CLI against the canary with the staging `api`, indexer and keepers stopped | every exit the canary's state allows lands | the founder signs; the architect observes |
| C14 | Season end | the canary's BuysClosed, Final Pull and Done on mainnet (after T0) | the transitions land; claims work | keeper; architect observes |
| C15 | Close | after the canary's Done: redeem and sell what can be recovered; `solana program close <CANARY>` | ProgramData closed, rent back to the founder | founder |

### 9.3 The coverage limit (pending founder, Appendix A Q1)

A Rip needs one MAJOR bucket with `15 × price` of free book (one OG pack: 1.5 SOL). Only packs and creator fees fill the stock: there is no seed instruction and no test path, and a SOL donation to the Machine never becomes stock (DG-8). A throwaway coin's creator fees will not reach 1.5 SOL. So the canary cannot open packs: C6's Rip, Redeem and Sell back prompts, C11's burst through `buy_packs`, and a canary Final Pull with a real share are out of reach, and the canary's 40M tokens can come back only through a Final Pull claim, which needs a canary pack (with no season spend every share is 0, M4 §0.5 item 6). Until the founder decides (Q1), M6.5 follows option A: the canary launches at T−1 (C7), which M4's V8 and `launch check` item 8 need, and nothing in the go / no-go depends on a canary Rip. M5's Appendix A.1 rows 8–10 (a hit post, a royalty DM and Rip × 1 through the Rip Blink, with the staging bot) need canary packs too: under option A they run on devnet with the dev bot (Appendix B, B16).

### 9.4 Tooling (OPS)

`onepct-ops canary check` runs the read-only part of C1–C5 and C12 and prints a PASS / FAIL table; every other step uses the commands of §10 and M4's `onepct-ops launch` with `--cluster canary`.

---

## 10. M6.6 Runbook tooling and switch-over support (OPS)

### 10.1 `onepct-ops` commands added by M6

M2 §11.10's v1 commands (`init`, `set-season`, `role set`, `guardian`, `lut`) and K1's `hitlist` stay as they are, with M6-A3's signing rule. Every command takes `--cluster mainnet|canary|devnet` (or `--program <ID>`) and `--rpc <URL>`.

| Command | Does | Signs |
|---|---|---|
| `program show` | ProgramData: authority, last deploy slot, data length, `executableHash` (§5.4), compared with `fixtures/rc/rc-<N>.json` | read-only |
| `program buffer-check --buffer <B> --expect <hash>` | the buffer's authority and `executableHash`, compared with the expected hash | read-only |
| `program set-authority --to <VAULT> --keypair <deployer>` | the loader's SetAuthority from the deployer to the vault, after checking that `<VAULT>` is vault 0 of the multisig named in `EXPECTED_ADDRESSES_JSON` and typing it twice (RUNBOOK step 4) | the deployer (M6-A3) |
| `program propose-upgrade --buffer <B>` | refuses unless the buffer's authority is the vault and its hash equals the `--expect` hash; builds a vault transaction: loader Upgrade (ProgramData, program, buffer, spill = the vault, authority = the vault); prints the unsigned base58 transaction for the Squads import, the decoded instruction and its simulation as the vault | never |
| `program propose-seal` | refuses unless the phase is FinalPull or Done, `pending_pulls == 0`, no other proposal is active or approved, and the OtterSec verification is in place (§7.5); builds the vault transaction SetAuthority(ProgramData, vault → None) and prints the earliest execution time, `final_ts + SEASON.sealDelaySeconds`. Executing it before the phase is Done is a RUNBOOK error that step 12.2's checks prevent | never |
| `squads check` | threshold, members and permissions, time lock, config authority, vault addresses, against `EXPECTED_ADDRESSES_JSON` | read-only |
| `squads show [--index <i>]` | decodes transactions and proposals with the watcher's decoders (§5.4), with their release times | read-only |
| `admin update-bucket \| pause \| set-team \| add-queue \| set-token-mint` | builds the matching `admin_config` action (M1 §9.2) for the cases M2's v1 commands do not cover (re-enabling a bucket after a guardian disable, an admin pause, team wallets, a queue, the token mint); on mainnet it emits the Squads transaction of `squads wrap`, as M2 §11.10 requires | never on mainnet |
| `squads wrap` | wraps the instruction an admin command produced (`set-season`, `role set`, `hitlist add`, `admin …`) into an unsigned vault transaction for the Squads import, with its simulation as the vault | never |
| `addresses [--md \| --json]` | every address to publish at Power-On (§10.4), read from chain and the multisig | read-only |
| `gonogo --at t24 \| t10 --t0 <ISO time> [--rehearsal-mint <MINT>]` | the checks of §10.2; prints PASS, FAIL or RE-VALIDATE per check and an overall GO or NO-GO | read-only (simulation) |
| `sw check --host <host> [--expect web \| landing]` | §10.3 | read-only |
| `canary check` | §9.4 | read-only |

- **Clusters.** Every command, M2's v1 commands included, accepts `--cluster canary`: the mainnet RPC with the canary program id, and admin instructions signed by the canary admin key (M6-A3), since the canary has no Squads.
- **Stable names for the runbook.** OPS makes sure these exist, adding aliases if M2's v1 names differ: `guardian pause --bits <list>`, `guardian unpause --bits <list>`, `guardian disable-role <role>`, `guardian disable-bucket <index>`, `guardian lower-cap <index> <lamports>`, `guardian select-queue <index>`, `role set <role> <pubkey>`, `lut create | extend | freeze`.
- **Typed confirmation.** An M6 command that signs prints the cluster, the program id, the signer's public key and the decoded plan, then waits for the operator to type the program id's first four and last four characters. M4's `launch send` keeps its own `--confirm <first 8 characters of the mint>` (M4 §12.4).
- **Squads output.** An unsigned transaction whose fee payer is the vault, base58-encoded, in the format the Squads app's transaction builder imports (the format `solana-verify export-pda-tx --encoding base58` produces, Appendix C). The command also writes the decoded plan as JSON next to it, for the members' check.
- **Never** a Squads proposal created or approved by a file key: the members approve with their hardware wallets in the Squads app (RUNBOOK §0.5).

### 10.2 Go / no-go checks (`onepct-ops gonogo`)

| # | Check | Source | PASS when | On failure |
|---|---|---|---|---|
| G1 | pump.fun, PumpSwap, pump fees and Mayhem versions | each ProgramData's last deploy slot and `executableHash` | at `t24`: equal to the set the canary rehearsal ran against (C7's `launch report`; M4's `fixtures/pump/programs.json`), then recorded as the baseline; at `t10`: equal to the `t24` baseline | **RE-VALIDATE** (they change often: pump.fun upgrades through its own Squads multisig with no time lock, six times in the 30 days to 2026-10-08): G2, G3 and G11 must pass again on the new version, and the founder decides whether to re-run the canary rehearsal (M4 §12.3 item 1) |
| G2 | `create_v2_enabled` | pump.fun Global PDA `["global"]` (`4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`): discriminator `a7e8e8b1c86c727f`, length ≥ 451, byte at offset 450 | `== 1` | NO-GO (hard) |
| G3 | `create_v2` extension set unchanged | the canary rehearsal coin's mint (`--rehearsal-mint`, from C7's `launch report`), and at `t10` also the most recent `create_v2` mint (signatures of pump.fun's mint authority PDA `TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM`) | Token-2022, mint and freeze authorities null, extensions exactly {MetadataPointer (18), TokenMetadata (19)}: S1's reference set | NO-GO (hard): `power_on` would refuse anyway (`MintNotSafe`) |
| G4 | MagicBlock queue health | `Cuj97…` owner and size; `decodeVrfQueue` every 60 s, 10 reads at `t24` and 4 at `t10`; the VRF program's ProgramData slot | owned by the VRF program, 30,000 B; occupancy ≤ `MONITOR.vrfQueueOccupancyAlertBps` and oldest item ≤ `VRF.busyOldestItemSeconds` at every read; a VRF redeploy in the last 24 h is reported | NO-GO, unless the founder accepts after a second window passes |
| G5 | No Solana feature activation within ±24 h of T0 | `getProgramAccounts` on `Feature111111111111111111111111111111111111` (S0's method), the epoch schedule and the measured slot time (`getRecentPerformanceSamples`) | no feature activated at an epoch boundary inside [T0 − 24 h, now]; no feature pending (a pending feature activates at the next boundary); every boundary inside [now, T0 + 24 h] listed with its projected time | NO-GO (hard) if a feature activated in the window or is pending before a boundary inside it. A later boundary cannot be known before about 12 h ahead: residual risk, watched on Agave's feature-gate tracker (RUNBOOK step 8) |
| G6 | Our program | ProgramData; the multisig | the authority is the Squads vault; `executableHash` equals the published mainnet hash; GOV-03 passes; no proposal active or approved except those the founder lists | NO-GO (hard) |
| G7 | Config | Config account | roles, `team_wallet`, `team_wallets`, `token_mint` (the vanity mint) and the queue list equal `EXPECTED_ADDRESSES_JSON`; phase StockUp; no pause bit; no role disabled | NO-GO |
| G8 | Machine | Machine, Deck header | the five launch MAJOR buckets listed and enabled with their caps; `pending_pulls == 0`; the Deck size reported against the Stock-Up KPI (≥ 4 × the packs expected in the first 6 h; alarm below `deckLowAlertEntries`) | the Deck figure is information for the founder; anything else NO-GO |
| G9 | Services | `/api/status`, the monitor's checks | every production service ready; monitor fresh; no open critical alert; a keeper leader; indexer lag below `SERVICES.indexer.maxLagSecondsForIntake`; the flags `/api/config` serves as planned (`FEED` on; `PACKS`, `SELL_BACK`, `BLINKS_RIP`, `HOLDER_BOOST` off) | NO-GO |
| G10 | Balances | `getBalance` | the launch wallet holds the dev buy cost from a live curve quote plus fees and rent; keeper and executor fee payers ≥ 2 × `feePayerLowLamports`; the multisig holds ≥ 3 SOL liquid (PARAMS §17) | NO-GO |
| G11 | M4's launch checks (manual) | the founder runs `onepct-ops launch check` (M4 §12.3: eight checks, including the mainnet simulation of the launch transaction, within 1,232 B or as M4's two-transaction fallback) with the key files, at `t24` and `t10`; `gonogo` prints the reminder and the architect records the output | no NO-GO line; each WARN accepted by the founder in the launch log | NO-GO (hard) |
| G12 | Rescue | `RESCUE_CID` and `RESCUE_URLS_JSON` from `/api/status`; delegated routing for the CID; `onepct-rescue status` with a public RPC | at least two URLs, run by different operators, serve the pinned `index.html`; providers of both pinning services are listed; the CLI reads the phase | NO-GO |
| G13 | Gate G6 (`t24` only) | the architect's RC audit PASS and the soak reports | recorded | NO-GO |

The report also lists the founder's manual items (RUNBOOK step 8): G11's output; `FLAG_KEEPER_STOCK_LIVE` and `FLAG_BOT_ALERTS` still off on their services; guardians on shift; support rota staffed; announcements ready; DexScreener funds ready.

### 10.3 Switch-over support (`onepct-ops sw check`)

The landing's files stay untouched (master §5.3). SW adds to the web image, append-only in M3's files:
- **A landing-proxy mode.** A second Caddy config, `apps/web/Caddyfile.landing-proxy`, that forwards every request to `{$LANDING_UPSTREAM}` (the landing service's private address) with the landing's own headers passed through, and the image's start command choosing the config from `WEB_MODE` (`app`, the default, or `landing-proxy`). RUNBOOK step 2 uses it to attach the domains to `web` before SW-1, so that SW-1 is a `web` deployment and its rollback a Railway Rollback of `web` (Railway has no domain move; re-attaching a domain can leave it answering 404 for minutes, Appendix C).
- **A self-identifying header.** `X-Onepercent-Service: web` in app mode and `X-Onepercent-Service: landing-proxy` in the proxy mode, one line in each config.

`sw check --host <h>` then checks:
- `--expect web`: the header says `web`; `/` is 200 with the app shell; `/api/config` answers 200 with `cluster: mainnet`, the mainnet program id and the flags (its phase is null before RUNBOOK step 3: SW-1 precedes the RC deploy, B14); `/x/<a fixed address>` carries its OG tags through Caddy; `/api/stream` sends a `ping` within `SERVICES.api.ssePingSeconds`; the CSP and HSTS headers of M3 §15.3 are present; `/status` and the rescue link answer;
- `--expect landing`: the header says `landing-proxy` or is absent (the landing served directly), and `/` serves the landing's page (its `<title>` recorded at RUNBOOK step 2.0);
- both: TLS valid for the host, and the total time from the first failing to the first passing check during a move (RUNBOOK step 2).

### 10.4 Published addresses (`onepct-ops addresses`)

Read from chain, never typed: the program and its ProgramData; Config, Machine, Deck, `vault_auth`, FeeIn and the protocol lookup table; every vault ATA of a listed bucket and the $1PCT vault; the Squads multisig, its vaults (admin and team) and its members; both guardians; the keeper, executor, intake signer and quote signer; the launch wallet; `team_wallet` and `team_wallets`; `token_mint`; the VRF queue; the ops wallet (from `EXPECTED_ADDRESSES_JSON`); after Power-On, the $1PCT bonding curve and the launch lookup table, which M4's `launch report` also lists (both lists must agree). Output in Markdown for the watch channel and the site, and in JSON for the monitor's `EXPECTED_ADDRESSES_JSON`.

---

## 11. Tests (per PR)

| PR | Tests |
|---|---|
| MON | Each check of §5.2 as a pure function over recorded snapshots: pass, fail and boundary cases with the PARAMS keys (no literal); the consistent-snapshot rule (a transaction between reads → re-read → `inconclusive`); the router (claims, severities, dedupe, escalation after `escalateAfterSeconds`, repeats every `pageRepeatSeconds`, ack only from the listed users, resolution); paging with Postgres down; governance decoders against recorded Squads accounts (a vault transaction with a loader Upgrade, one with SetAuthority to None, a config transaction with SetTimeLock) and the drill's loader bytes (golden); `releaseAt`; idempotent public posts; `/api/status` parses with the extended schema, carries `"fresh":true` exactly, and degrades as §5.6 says; the monitor refuses to boot with any `*_KEYPAIR`; no page or post contains a user address, a secret or a full RPC URL (captured outputs) |
| STATUS | Fixture states (all operational; each dependency degraded or down; paused bits; Sealed; a queued upgrade; API down) render the expected copy keys; trust lines only per M3 §14.3; axe; the chunk holds no `@solana/web3.js` |
| RESCUE-A, -B | §6.8 unit and static tests; `pnpm e2e:validator rescue` |
| RESCUE-PAGE | §6.8 Playwright run; the CSP meta; the size budget; the build and CID reproducibility checks of §6.7 steps 1–2, Kubo cross-check included; `dist/` holds no dotfile, empty directory, symlink, `.mjs` file or service worker |
| RC | §7.1–§7.5; `set-program-id` round trip; `ids-diff` on a synthetic tag pair; the run-time program id static test |
| SOAK | `soak:genesis` produces a state that passes `check_invariants()`; the mock oracle's modes on the validator; the mock VRF capacity mode refuses when full and leaves M1's tests unchanged; the chaos scheduler's dry plan; a 30-minute smoke run in the nightly CI (500 packs, C1, C3, C5) |
| OPS | Each command against recorded accounts: `program show` hashes equal `solana-verify`'s on the drill program; `propose-upgrade` and `propose-seal` produce the exact loader instruction bytes of the drill (golden) inside a vault transaction whose fee payer is the vault; `propose-seal` refuses before FinalPull, with a pending Pull, with another open proposal or without the verification; `gonogo` on fixture states for each check's PASS and FAIL (§10.2); the typed confirmation of §10.1 |
| SW | `sw check` against a recorded web response and a recorded landing response; a container test of the web image in both modes: each answers with its `X-Onepercent-Service` header, the proxy passes the landing's own headers and status codes through, and app mode is unchanged otherwise |

---

## 12. Commands and CI

New scripts: `pnpm --filter worker monitor:drill`; `pnpm e2e:validator rescue`; `pnpm --filter rescue {build, e2e, car, pin, verify}`; `pnpm soak:{genesis, up, run, report, down}`; `pnpm rc:{freeze, report}`; `node scripts/set-program-id.mjs`. New CI jobs (append-only): `rescue` (two builds compared, size budget, the CAR and its CID, the Kubo cross-check with `ipfs/kubo:v0.43.1`, Playwright), `rc` (from `rc-1` on: freeze check; nightly-sized property runs on `rc-*` tags), `ids-diff` (on `rc-*-*` tags), `verifiable-build` (manual dispatch and `rc-*` tags), and a nightly soak smoke run.

**The architect will run, from `app/`:**

```
pnpm install --frozen-lockfile && pnpm params:rs --check && pnpm lint:words
pnpm program:build && pnpm program:clippy && pnpm program:test && pnpm test:e2e && pnpm program:report
PROPTEST_CASES=10000 pnpm program:test
pnpm e2e:validator rip && pnpm e2e:validator feed && pnpm e2e:validator rescue
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
docker compose up -d && pnpm --filter @onepercent/db migrate && pnpm --filter "./services/*" test
pnpm --filter rescue build && pnpm --filter rescue car && pnpm --filter rescue e2e
pnpm soak:genesis && pnpm soak:up && pnpm soak:run --smoke && pnpm soak:report && pnpm soak:down
pnpm --filter worker monitor:drill --env validator --all
solana-verify build --library-name onepercent --base-image "$IMG" --arch v3 && solana-verify get-executable-hash target/deploy/onepercent.so
git diff --exit-code packages/sdk/src/idl fixtures/vectors packages/db/drizzle fixtures/rc
```

---

## 13. Acceptance criteria (master §11.4 M6, numbered as there)

1. **M6.1 Monitor and status.**
   1. Every check of §5.2 exists with its PARAMS-keyed threshold, cadence, severity and route.
   2. The drill (§5.9) fires every check in its environment and routes it as specified; both guardians receive a page on their phones and ack it.
   3. The upgrade watcher decodes and posts each lifecycle step of a drill upgrade, a drill seal and a drill config change, with correct release times; GOV-02 flags a hash that does not match.
   4. `/api/status` and `/status` show the matrix of §5.5 with live states, and degrade as §5.6 and §5.7 say when the monitor or the API is down.
   5. The monitor holds no key, sends no transaction and pauses nothing (static test and review).
2. **M6.2 Rescue.**
   1. Take-back and Redeem through `onepct-rescue` merged by D12.
   2. Every exit of §6.3 executes with the API, indexer and keepers stopped: on the validator for all of them, on devnet for those devnet's state allows (§6.8).
   3. The page is pinned on two independent IPFS services under one CID, reproduced in CI, listed by delegated routing and loaded in browsers through Filebase's gateway and `inbrowser.link` (§6.7); its first pin precedes `stock_up_ts`.
   4. No rescue code path reaches an Onepercent server (static test).
3. **M6.3 Hardening and RC.**
   1. Deep property runs pass on the RC commit, twice, with recorded seeds (§7.1).
   2. Every bench is within budget (§7.2); clippy is clean; §7.3 holds.
   3. The IDL and layouts are frozen in `fixtures/rc/rc-1.json`, with the CI check (§7.4).
   4. The three cluster builds reproduce their verified hashes locally and in CI; the hashes are recorded for publication (§7.5).
   5. `rc-1` and its cluster tags exist on the merged commit.
4. **M6.4 Dress rehearsal.** §8.7.
5. **M6.5 Canary.** The checklist of §9.2 is run and its evidence recorded, except the items Q1 holds; `onepct-ops canary check` passes on the canary.
6. **M6.6 Runbook tooling.** Each `onepct-ops` command of §10.1 works on recorded fixtures and on devnet (`program`, `squads` and the seal path on the drill program and multisig, as G0.1); `gonogo` produces the full §10.2 report on devnet and on mainnet read-only; `sw check` distinguishes the web from the landing.

**Definition of done** (every PR): master §12; CI green; generated files (IDL, SDK, golden vectors, `drizzle/`, `fixtures/rc`) committed; `VERSIONS.md`, `README.md` and the `.env.example` files updated; no `TODO` without a milestone tag; `pnpm lint:words` clean.

---

## 14. Audit-gate checklist (the architect)

**G6.1 (MON, STATUS):**
- [ ] Every PARAMS §18 monitor item and every invariant of master §9.1 has a check; thresholds come from config keys.
- [ ] The consistent-snapshot rule; `inconclusive` never counts as a violation.
- [ ] No key, no transaction, no automatic pause; pages name the guardian command only.
- [ ] Routing, escalation, repeats, acks, outages; nothing user-identifying or secret in pages and posts.
- [ ] Watcher decoding of loader and Squads transactions; release times; hash chain.
- [ ] `/api/status` degrades honestly; `/status` shows trust lines only when the chain makes them true.

**G6.2 (RESCUE-A, -B, -PAGE):**
- [ ] Every account derived from chain; only SDK builders; A14 writability.
- [ ] No Onepercent server in any rescue path; works with services stopped, in every phase.
- [ ] Key handling per §2 rule 5; the page never touches a key.
- [ ] CID reproducible; two independent pins; gateways serve it.

**G6.3 (RC):**
- [ ] Program diff is lint-only; suites re-run.
- [ ] Budgets met; deep runs pass; feature snapshot refreshed.
- [ ] Freeze file, cluster tags, `ids-diff`, run-time program id.
- [ ] Verified hashes reproduced twice.

**G6.4 (SOAK):** §8.7, the dumps and `soak_check`, the failover table, the alert matching.

**G6.5 (SW, OPS):** the landing-proxy mode changes nothing in app mode; commands never sign an admin instruction; seal preconditions; go / no-go checks complete and sourced; the canary evidence.

**Gate G6** (master): the RC audit of the full program and every service on the last `rc-N` (the architect's task A9 in the master), G6.1–G6.5, the soak reports, then the founder's go / no-go at T−24 h (RUNBOOK step 8).

---

## 15. Do NOT

**Scope and process**
- Change an instruction, an account layout, a seed, an error, an event or an economic value; edit M1–M4's owned files beyond §1.2's list.
- Push to `main`; edit `docs/codex/*`, `RUNBOOK.md`, `AGENTS.md`, `apps/web/src/experience/` or the landing.
- Send a transaction on devnet, the canary or mainnet without the founder's go; send any mainnet transaction from Codex's environment.

**Monitor**
- Pause, disable, rotate or upgrade anything automatically; hold a key; put a user's address, a secret or a full RPC URL in a page, a post or a log.
- Report an `inconclusive` multi-account check as a violation, or a violation from a single stale read.

**Rescue**
- Call an Onepercent API, the indexer, Redis or Postgres from a rescue path; put an exit behind a flag, an allow-list or a rate limit; refuse an exit because of the phase.
- Read a key from an environment variable or standard input; write, log, print or transmit a key; ask for a seed phrase.
- Encode a program instruction by hand.

**RC and soak**
- Build a mainnet binary from anything but `rc-N-mainnet`; run `anchor build` after `solana-verify build`; claim a hash nobody reproduced.
- Add a test feature, a mock or a flag to the program crate; give the soak a test path in the program.

**Words never shipped** (code, comments, strings, docs and tests under `app/`; `app/packages/config/src/vocabulary.ts` holds the lists): the spooky and trust lists of AGENTS.md; in user-facing copy, the promise words. No "ZK" anywhere.

---

## 16. Report back (in each PR)

1. Commands and results (§12), the base commit, new `VERSIONS.md` rows.
2. MON: the drill report; the alert-key → check map; the scraped metric names found on each service.
3. RESCUE: the e2e and devnet drill signatures; the CID, both pin receipts and the gateway checks.
4. RC: the bench table, the property-run seeds and counts, the feature-snapshot diff, `rc-1.json`, the hashes from both builders.
5. SOAK: the run reports (§8.6) and the failover table.
6. SW and OPS: `sw check` outputs against staging in both modes; the `gonogo` report on devnet and a read-only mainnet run.
7. Deviations, and every place you stopped to decide.

---

## Appendix A. Open questions for the founder

Each item is marked "(pending founder)" where the brief depends on it. Until a decision lands, Codex builds as the recommendation says.

**Q1. The canary cannot open packs (§9.3).** A Rip needs one MAJOR bucket with 15 × price of free book (1.5 SOL for one Original pack). Only packs and creator fees fill the stock (no seed, no test path; a donation to the Machine never counts, DG-8), and a throwaway coin's creator fees will not reach 1.5 SOL. Consequences: no canary Rip, Redeem or Sell back for the wallet tests; no canary VRF burst through `buy_packs`; M5's Appendix A.1 rows 8–10 (a hit post, a royalty DM, Rip × 1 through the Rip Blink, all on the canary) cannot run there; and the canary's 40M tokens (≈1.18 SOL of dev buy, F14) come back only through a canary Final Pull claim, which needs at least one canary pack, so they would stay in the canary's vault.
- **Option A (recommended).** Power-On the canary anyway at T−1 (master §8.4, M4 §12.5), to rehearse the real launch transaction and to run what needs PoweredOn or OnAir without packs: the fee chain (M4's V8 needs a real collection there; it is a NO-GO condition for Power-On), a real Jupiter swap through the exec pair with whatever fees arrive, the OnAir → BuysClosed → FinalPull → Done transitions on mainnet. Its coin is also the rehearsal coin of `launch check` item 8 and `gonogo` G3. Accept that the ≈1.18 SOL dev buy is not recovered. Run the 300-request VRF burst through the architect's S2 probe program on mainnet (rent recovered by closing it; about 0.15 SOL of fees). Check the Rip, Redeem and Sell back wallet prompts, and M5's rows 8–10, on devnet only.
- **Option B.** Only simulate the canary's launch transaction (no SOL spent) and skip every post-Power-On canary check. The first real fee chain, exec-pair swap and draw then happen at mainnet T0; M4's V8 has no evidence before T0, and `launch check` item 8 and G3 rely on the newest public `create_v2` mint.
- **Option C (not recommended).** Generate 1.5 SOL of canary creator fees by trading the throwaway coin: about 500 SOL of volume at the curve's 0.30% creator fee, paying about 4.75 SOL of pump.fun's protocol fee plus slippage, and it is volume the team makes on a public venue.

**Q2. A public source for the verified build (§7.5).** The repository `lilacwine77/onepercent` is private. OtterSec's verification, which explorers show as "verified", rebuilds from a public repository at the tagged commit. A published hash alone stays reproducible only by people who have the source.
- **Option A (recommended).** A public mirror repository holding only the program workspace (`app/Cargo.toml`, `app/Cargo.lock`, `app/rust-toolchain.toml`, `app/Anchor.toml`, `app/programs/onepercent/**`) at each `rc-N-mainnet` tag, laid out as `app/` is so that the build is byte-identical; the architect exports it with a script and CI checks that it rebuilds the same hash.
- **Option B.** Make the whole repository public before the RC deploy (briefs, services and docs included).
- **Option C.** Publish only the hash and the build command; no explorer badge.

**Q3. An ops wallet.** Multisig transfers wait 12 h (the time lock covers every vault transaction), so a fee payer running low on L0 cannot be topped up quickly from the multisig. Recommendation: a founder-held ops wallet with at most 5 SOL, published at Power-On and listed in `Config.team_wallets` (so it can never Rip or Feed), used only to top up the keeper and executor fee payers and to pay the DexScreener profile at T0.

**Q4. Paid bandwidth for the rescue page (§6.7).** Filebase's free plan carries a few thousand loads of the page a month, and a busy outage could use that up. Recommendation: stay on the free plans; the founder moves Filebase to its Pro plan ($7.50 a month, 250 GB of IPFS egress) if its console shows more than half of the month's egress used, or for the season if the founder prefers the margin.

---

## Appendix B. Amendments proposed to other docs

The architect folds these in when re-issuing each document; until then this brief's §0.3 governs M6.

| # | Document | Amendment | Why |
|---|---|---|---|
| B1 | `00-MASTER-BRIEF.md` §8.3, §11.4 M6.4 | The soak runs as Soak-V (validator, 20,000 packs, every chaos item) and Soak-D (devnet, real queue, smaller volume) (M6-A1) | Devnet SOL and coverage cannot carry 20,000 packs at compiled prices; withheld callbacks cannot be forced on MagicBlock |
| B2 | Master §11.4 M6.1 | "Every check fires in a drill: on devnet where the trigger exists, on the soak validator from an injected state for program-enforced invariants" (M6-A2) | A correct program cannot break its invariants on devnet |
| B3 | `02-M2-BRIEF.md` §11.10 | `--cluster mainnet` never signs an admin instruction; operations signed by a person's key (`init` by the deployer, `lut`, `guardian`, the canary's admin, the authority move) sign with that person's `--keypair` after a typed confirmation (M6-A3) | `initialize` must be signed by the upgrade authority before the move to Squads |
| B4 | `01-M1-BRIEF.md` §15, `02-M2-BRIEF.md` §10 | Every SDK builder and PDA helper takes `programId` from its caller; nothing outside tests reads the IDL address (M6-A4) | One services build serves devnet, the canary and mainnet; each cluster's binary differs only in `declare_id!` |
| B5 | `PARAMS.md` issue 4 | Record M6's `SERVICES.monitor` keys, `RESCUE` and `ONEPERCENT_PROGRAM_IDS` (§4.2) with D14's and D15's `SERVICES.transport`, and `validateParams()` check 23 | M6-A5 |
| B6 | `COPY.md` issue 3 | §5 Status, §6 Rescue, §7 Watch channel, with the keys of §5.7 and §6.6 (M6-A6) | Only COPY.md strings may ship |
| B7 | `03-M3-BRIEF.md` §15.3, §15.4; master §5.3 | `VITE_RESCUE_URL` joins the public `VITE_` variables. The web image gains a landing-proxy mode (`WEB_MODE`, `LANDING_UPSTREAM`) and the header `X-Onepercent-Service` (§10.3). SW-1 becomes: attach the domains to `web` in landing-proxy mode before X-ray Week (D11, 06:00), then switch `web` to app mode at SW-1; the rollback is a Railway Rollback of `web` (seconds), with moving the domains back as the second line (≤ 5 min) | M6-A7; Railway has no domain move, and re-attaching a domain issues a new verification token and can leave it unrouted for minutes (Appendix C) |
| B8 | `02-M2-BRIEF.md` §11.1 | `ALERT_WEBHOOK_URL` stays unset in production; the monitor routes every alert from the `alerts` table; S0's leader module takes its lock name as a parameter (`onepct:monitor`) | M6-A8 |
| B9 | `02-M2-BRIEF.md` §11.3, §11.8; `03-M3-BRIEF.md` §5.1 C, §12.4, §14.1 | Every `getTransaction` (the indexer, the `/api/rpc` allow-list, Verify, the Pull watch) must accept version-1 transactions (`maxSupportedTransactionVersion: 1`) and must not use a client that rejects them. On 2026-10-08 some pump.fun creates on mainnet were version-1 transactions, and asking for them with `0` returned error −32015. A third party could call one of our permissionless instructions (a settle) in such a transaction and stall the indexer's cursor. Verify at M6 start | Found during this brief's research |
| B10 | Master §5.1, F14; `PARAMS.md` §17 | The canary's dev buy is recoverable only if a canary pack is opened; see Q1. PARAMS §17's "Rehearsal: T−1, a throwaway coin, ≈0.05 SOL" row becomes "T−1: the canary's launch rehearsal (master §8.4, M4 §12.5); its ≈1.18 SOL dev buy is in F14" | §9.3; C7 is the rehearsal coin |
| B11 | Master §6 | Add the ops wallet row if Q3 is accepted | Q3 |
| B12 | Master §11.4 M6.2 | The rescue page's first pin (take-back and Redeem) precedes `stock_up_ts`, because Feed opens at Stock-Up | §1.3 |
| B13 | `PARAMS.md` §24 N7 | Information: SIMD-0525's 200 ms slot target takes effect at epoch 1053 (about 2026-10-09 14:45 UTC). Slot-counted windows (`XRAY.priceMaxAgeSlots`, `MARKET.price.maxAgeSlots`) shrink in wall time, and epochs last about 24–26 h instead of 30–33 h. No value changes | Appendix C |
| B14 | `02-M2-BRIEF.md` §11.8; `03-M3-BRIEF.md` §7.2 | `/api/config` answers 200 with the cluster, the program id and the flags even when the program's Config does not exist yet, with `phase` (and the other chain sections) `null`; the web then keeps its flags. On mainnet, SW-1 (X-ray Week, D11) comes before the RC deploy (D4, RUNBOOK step 3): if the route failed, the web would turn every flag off (M3 §7.2) and X-ray Week would show nothing | D4 moved the first mainnet deploy after SW-1 |
| B15 | `00-MASTER-BRIEF.md` §11.1; `02-M2-BRIEF.md` §1.2 | `packages/cli` is created by whichever of M2's S3, M6's RESCUE-A and M6's SW merges first; the others rebase and append their `bin` entries and registrations (§1.2) | The rescue CLI is due D12 and the switch-over check D10, while S3's PR is due D12 |
| B16 | `05-M5-BRIEF.md` Appendix A.1 | Rows 8–10 (hit post, royalty DM, Rip × 1 through the Rip Blink) run on devnet with the dev bot while the canary cannot open packs (Q1); the other rows stay on staging | §9.3 |
| B17 | Master §8.4 | While the canary cannot open packs (Q1 option A): the 300-request VRF burst runs through the architect's S2 probe program; the Rip, Redeem and Sell back wallet prompts are checked on devnet; the launch rehearsal is the canary's own launch at T−1 with the 40M dev buy (M4 §12.5) | §9.2, §9.3 |

---

## Appendix C. Sources (read on 2026-10-08 and 2026-10-09) and facts to re-verify at M6 start

### C.1 Sources

| Topic | Fact used here | Source |
|---|---|---|
| Verified builds | `solana-verify` 0.5.2 (crates.io, 2026-09-21) is the latest release; `--arch v3` is its own flag (since 0.4.11; arguments after `--` go to cargo); `build`, `get-executable-hash`, `get-buffer-hash`, `get-program-hash` (trailing zero bytes stripped before hashing), `export-pda-tx … --uploader --encoding base58`, `remote submit-job`, `get-program-pda`; `verify-from-repo --remote` is an error in 0.5.x | crates.io API `solana-verify`; github.com/solana-foundation/solana-verifiable-build at v0.5.2 (README, `src/main.rs`, `src/image_config.rs`) |
| Build image | Docker Hub `solanafoundation/solana-verifiable-build` tag 4.3.0 = `sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd`, linux/amd64, platform-tools 1.57 | Docker Hub API; `docker/v4.3.0.Dockerfile` in the same repository |
| OtterSec registry | API `https://verify.osec.io` (`/status/<id>`, `/status-all/<id>`, `/job/<id>`, `/logs/<build_id>`); the verification PDA is seeded by the signer; a build counts when the signer is the current upgrade authority; an upgrade marks the program unverified until the PDA is updated; its worker pins an older `solana-verify` (hence the explicit image digest) | github.com/otter-sec/solana-verified-programs-api at v2.0.7; solana.com/docs/programs/verified-builds (Squads section, edited 2026-07-30) |
| Squads v4 program | Time lock counted from the approval timestamp and checked at execution against the current value (error 6021); `MAX_TIME_LOCK` 7,776,000 s; a config change marks earlier unapproved proposals stale; cancel needs threshold votes on an Approved proposal; layout: discriminator, `create_key`, `config_authority`, `threshold` u16, `time_lock` u32; the program is immutable since November 2024 | github.com/Squads-Protocol/v4 `programs/squads_multisig_program/src/{state,instructions}`; docs.squads.so "How secure is Squads" |
| Squads tools | `@sqds/multisig` 2.1.4 (2025-06-16); `squads-multisig-cli` 0.1.7 (crates.io 2025-12-16) with `usb://ledger`; the app's Transaction Builder imports base58 transactions; program page upgrade flow (buffer authority = the vault); members sign with Ledger through Phantom or Solflare; a vault cannot call the loader's ExtendProgram | npm registry; crates.io; docs.squads.so (developers assets → programs, transaction builder, time locks, FAQ); Agave v4.3 `program-runtime/src/cpi.rs` |
| Solana CLI 4.3 | `program write-buffer`, `deploy --buffer`, `set-buffer-authority`, `set-upgrade-authority … --skip-new-upgrade-authority-signer-check`, `extend`, `show` (authority `none` when sealed), `close`; ProgramData header 45 bytes | solana.com/docs/programs/deploying; anza-xyz/agave v4.3 `cli/src/program.rs`, `cli-output/src/cli_output.rs` |
| pump.fun | Global PDA `["global"]` = `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`, 1,088 bytes, discriminator `a7e8e8b1c86c727f`, `create_v2_enabled` at byte 450 (1 on 2026-10-08), `toggle_create_v2` by the Global authority, error 6046 `CreateV2Disabled`; pump.fun, PumpSwap and pump fees upgraded 2026-10-08 16:20 UTC through Squads multisig `2yMoQqQrtbhq3nQ3wFoQQawWS65qcqUXcwHEYha4rshW` (3-of-4, time lock 0), six pump.fun upgrades in 30 days; recent `create_v2` mints carry only MetadataPointer (18) and TokenMetadata (19) | github.com/pump-fun/pump-public-docs (`idl/pump.json`, `docs/PUMP_PROGRAM_README.md`, `docs/instructions/COIN_CREATION.md`); mainnet reads 2026-10-08 20:45–21:15 UTC |
| Features | `solana feature status --display-all --output json`; a pending feature activates at the first slot of the next epoch; none pending on mainnet on 2026-10-08; SIMD-0525's 200 ms slot target activated at epoch 1052 and takes effect at epoch 1053; SIMD-0500 not scheduled; Agave's tracker page and JSON are the live schedule | anza-xyz/agave v4.3 `cli/src/feature.rs`, `runtime/src/bank.rs`; github.com/anza-xyz/agave/wiki/Feature-Gate-Tracker-Schedule; solana-improvement-documents proposals 0500, 0525, 0437 |
| Wallet reviews | Phantom: a new-domain notice usually lifts after review; a review form for notices that persist or transaction warnings; guidance on single signers and simulation with `sigVerify: false`. Blockaid: support portal `report.blockaid.io` (false positives, project verification) | docs.phantom.com/developer-powertools/domain-and-transaction-warnings; blockaid.io/contact |
| Watchdog | UptimeRobot's free plan includes keyword monitors at 5-minute intervals | uptimerobot.com/pricing |
| MagicBlock latency | median 0.9 s (2–10 slots) on the base layer, measured 2026-10-07 | `research/randomness.md` |
| IPFS services | Storacha's write switch-off (2026-05-15) and `storacha.network` → `fil.one` (S3 storage, no IPFS); Fleek hosting ended 2026-01-31; `ipfs.io` and `dweb.link` retired on 2026-09-21, browsers sent to `inbrowser.link`; Shipyard stopped IPFS work on 2026-09-30 | github.com/storacha/upload-service/pull/708; fil.one/pricing; docs.ipfs.tech/case-studies/fleek/; blog.ipfs.tech/2026-08-beyond-sponsored-gateways/ (2026-08-25); gatewaychanges.ipfs.io; ipshipyard.com/blog/2026-the-end-of-ipfs-at-shipyard/ (2026-08-24); probes of 2026-10-09 (429 with `Retry-After` 900) |
| Filebase | Free plan without a card: 5 GB, 500 pins, 1 dedicated gateway, 1 Site, 1 IPNS name, no custom domain, 10 GB of IPFS egress (5 GB on the service-limits page); RPC at `rpc.filebase.io` with bucket-scoped Bearer tokens (`dag/import`, `pin-roots` true); S3 import with the `import=car` metadata, CID in `x-amz-meta-cid`; Pinning Service API at `api.filebase.io/v1/ipfs` | filebase.com/pricing; filebase.com/free; filebase.com/docs/ipfs/rpc-api; filebase.com/docs/ipfs/pinning/pinning-files; filebase.com/docs/ipfs/pinning-service-api; filebase.com/docs/account/service-limits; discuss.ipfs.tech/t/introducing-filebase-sites-simplified-ipfs-websites-with-ipns/20004 |
| Pinata | Free plan: 1 GB, 500 files, 1 dedicated gateway (10 GB and 10,000 requests a month), 60 API requests a minute; HTML served only through a dedicated gateway with a custom domain; CAR uploads on paid plans only; `POST /v3/files/public/pin_by_cid` with the scope `org:files:write` | pinata.cloud/pricing; docs.pinata.cloud/account-management/limits; docs.pinata.cloud/files/uploading-files.md; docs.pinata.cloud/api-reference/endpoint/pin-by-cid.md |
| Lighthouse | 5 GB free; CAR import at `upload.lighthouse.storage/api/v0/dag/import`; its public gateway is for paying users | lighthouse.storage/pricing; docs.lighthouse.storage/how-to/upload-data/car |
| Deterministic CIDs | `ipfs-car` 3.1.0 (2025-10-08): raw leaves, 1 MiB chunks, 1,024 links, directories sharded above 1,000 entries, common path prefix stripped, dotfiles, empty directories and symlinks skipped. IPIP-0499 `unixfs-v1-2025` (2026-03-05): the same settings with a 256 KiB HAMT threshold; Kubo has it from v0.40, the latest is v0.43.1 (2026-09-15); plain Kubo defaults are CIDv0, 256 KiB chunks and 174 links | registry.npmjs.org/ipfs-car; github.com/storacha/ipfs-car (`unixfs.js`, `cmd/pack.js`); github.com/storacha/files-from-path; specs.ipfs.tech/ipips/ipip-0499/; blog.ipfs.tech/2026-03-reproducible-cids/; github.com/ipfs/kubo `docs/changelogs/v0.40.md`, `docs/config.md`, releases |
| Gateways | `inbrowser.link` serves `https://<cidv1>.ipfs.inbrowser.link/` with one origin per CID, from Cloudflare Pages since 2026-09-29, unmaintained since 2026-09-30; it finds providers through delegated routing, which listed Filebase's and Pinata's browser-reachable providers on 2026-10-09; `ipfs.aleph.cloud` served HTML (path style); 4EVERLAND's public gateway serves no HTML; Pinata's public gateway refused HTML (403) | github.com/ipfs/service-worker-gateway issues 1215, 1086, 1088; delegated-ipfs.dev/routing/v1/providers (probe, 2026-10-09); docs.4everland.org; docs.ipfs.tech/concepts/public-utilities/ |
| Browsers | A `<meta>` CSP cannot set `frame-ancestors`, `report-uri` or `sandbox`, and a gateway's own CSP header can only tighten it; Chrome's Local Network Access prompts when a public page calls a local or private address (enforced from Chrome 141–142) | w3.org/TR/CSP3; developer.mozilla.org (CSP `connect-src`); developer.chrome.com/blog/local-network-access (2025-06-09) |
| Railway | No domain move: remove, then add, with a new `_railway-verify` token per service and a 404 while unattached; Rollback restores a deployment's image and variables without a rebuild (retention 72 h on Hobby, 120 h on Pro); config-as-code files are not read after 2026-12-01; `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`; private networking at `<service>.railway.internal` | docs.railway.com (`/guides/roll-back-bad-deploy`, `/deployments/deployment-actions`, `/networking/domains/working-with-domains`, `/networking/troubleshooting/ssl`, `/config-as-code`, `/deployments/healthchecks`, `/networking/private-networking`); the station.railway.com threads listed in RUNBOOK Appendix R-D |
| Repository | `lilacwine77/onepercent` is private (GitHub API, 2026-10-08) | `gh repo view` |
| Devnet | pump.fun, PumpSwap, MagicBlock VRF, the upgraded Pyth receiver and Squads v4 are deployed on devnet (slot 508,944,461) | devnet `getAccountInfo`, 2026-10-08 |

### C.2 Verify at M6 start (D9), before the PR that depends on each item

| # | Item | Check | Blocks |
|---|---|---|---|
| V1 | The OtterSec worker builds our layout to the same hash | a devnet verification of the drill program from the public source layout of Appendix A Q2 (`verify-devnet.osec.io`, `/logs/<build_id>`); compare with the local hash | RUNBOOK step 5 |
| V2 | The verification survives the seal | a devnet program verified, its authority set to None, `/status` and `/status-all` read again | step 12 |
| V3 | Squads tooling with the members' Ledgers | each member's devnet dry run through the app (Phantom or Solflare, blind signing) and through `squads-multisig-cli 0.1.7 … --keypair usb://ledger` (it builds on the current Rust); the app imports `onepct-ops`'s base58 transactions; its "Squad address" equals vault 0 | RUNBOOK §0.5 |
| V4 | Version-1 transactions (B9) | `getTransaction(sig, {maxSupportedTransactionVersion: 1})` on Helius and Triton for a recent version-1 transaction; whether S0's JSON-RPC client and `@solana/web3.js` 1.99.0 decode it | MON, the indexer |
| V5 | Slot time and epochs | `getRecentPerformanceSamples` after 2026-10-09 15:00 UTC shows about 0.20–0.22 s per slot; recompute the epoch boundaries near T0 | `gonogo` G5 |
| V6 | Feature schedule near T0 | Agave's tracker JSON and its release schedule (the v4.4 rollout and when feature activations resume) | step 8 |
| V7 | The IPFS release (§6.7) | (a) Filebase's free plan accepts `dag/import` on `rpc.filebase.io` with a bucket token, and the response shape; its free dedicated gateway serves HTML (`curl -sI https://<gateway>.myfilebase.com/ipfs/<CID>/index.html` → 200, `text/html`); its console's monthly egress (10 GB or 5 GB); (b) Pinata's `pin_by_cid` on the free plan returns neither `over_free_limit` nor 403; (c) `ipfs-car` 3.1.0 and Kubo's `unixfs-v1-2025` give the same CID for `dist/`; (d) `curl -s https://delegated-ipfs.dev/routing/v1/providers/<CID>` lists both services; (e) `https://<CID>.ipfs.inbrowser.link/` loads the page and its hash routes in a real Chrome; (f) Lighthouse's free dashboard URL serves HTML (fallback only) | RESCUE-PAGE, before the first pin |
| V8 | The external watchdog's terms | UptimeRobot's current terms for the free plan | step 0.2.4 |
| V9 | Railway domain moves and rollbacks | the timings and steps of RUNBOOK step 2 and P9 on the `staging` environment | step 2 |
| V10 | CLI outputs | `solana --version` ≥ 4.3.0 on the operator machine; `solana program deploy --help` lists `--buffer`, `--program-id` and `--upgrade-authority` as step 3.4 uses them; `solana program show` and `spl-token display` print what RUNBOOK steps 3 and 7.4 expect | steps 3, 7.4 |
| V11 | SIMD-0431 | `solana feature status YbbRLkvenrocjGPGyoQE4wjnvYzTgfsk38NFmcYK7a5 -um` (a 10 KiB minimum per program extension once active) | playbook P8 |
| V12 | pump.fun's Global authority | who controls `FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF`, the key that can turn `create_v2` off | information for step 8 |

---

## Changelog

- 2026-10-20 (D9): first issue, with `RUNBOOK.md`. Includes the S0 audit's inputs (`PRIVATE_HOST=::`, private `/metrics`, the ≈55 s failover worst case, the pre-deploy migration command), decisions D13–D16, and the alignment with `04-M4-BRIEF.md` (exact I14, CF1, F1–F3, L1, the FeeIn alerts, `hold_log`, `executor_trades`, `onepct-ops launch` and the T−1 canary rehearsal) and with `05-M5-BRIEF.md`'s requests to the runbook.
