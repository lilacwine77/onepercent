# RUNBOOK — The 1% Machine, Season 1 launch

**Mainnet procedure superseded by D31/D32 (2026-10-12):** use
[`DEPLOY-MAINNET.md`](DEPLOY-MAINNET.md) for the executable deployment and launch
sequence. The ownership table, Squads approvals, timelocks and atomic mainnet
launch below are historical. The technical friend deploys and uses his Proxima
Deployer wallet as `launch_wallet`: the 40M dev buy arrives there directly, then
he signs deposit and Power-On without an intermediate transfer. After init and
Setup preparation, he transfers Config admin and upgrade authority to the one
founder wallet, with on-chain verification of each transfer; Ledger is
recommended. The services operator generates and installs the separate hot-role
and guardian keys, never displaying their secrets. No Squads or timelock is
required. Other operational evidence remains applicable where consistent with
the current decisions.

Issued 2026-10-20 (D9) by the architect, with `06-M6-BRIEF.md`; written on 2026-10-08 and 2026-10-09, so steps 0, 1 and 2.0, which fall before D9, run from this text. This is the operational checklist from the domain reviews to the seal. The founder and the architect execute it; Codex builds the commands it uses (M6 brief §10) and never edits it. Calendar: master §11.1, with **T0 = Thu 2026-10-29 16:00:00 UTC**. If the founder moves T0, every date below moves with it, except the steps already done.

**Binding amendments:** D37 shortens On Air to 48 h, releases The 1% at 0 / 12 / 24 / 36 h and starts Last Call 6 h before `end_ts`; the 10 min Final Pull delay and 72 h seal delay stay unchanged. D18 removes the calendar constraint and defers Final Pull claims and Burn-after-Done to the timelocked follow-up upgrade. D27 and `D29-METEORA-LAUNCH.md` replace the pump launch, Token-2022, creator reassignment and fee-chain procedures below with Meteora DBC, SPL Token and DAMM v2. Those older launch procedures are superseded. The architect updates the operational sequence with the M4.2 launch tooling; M4.1's validated scope and config-pinning order are in `app/README.md`.

---

## 0. How to use this runbook

### 0.1 Owners

| Code | Who | Holds | Never |
|---|---|---|---|
| **F** | The founder | Squads member 1, the program keypairs (mainnet, canary), the vanity mint keypair, the deployer, the launch wallet, guardian 1, the ops wallet | Shares a key in chat, a doc or git |
| **M2, M3** | Squads members 2 and 3 (founder side, separate hardware wallets) | One vote each | Approve a proposal they did not decode |
| **G2** | Guardian 2, the trusted operator in another time zone | Guardian key 2 | Touch an exit (the program forbids it anyway) |
| **A** | The architect | No mainnet key. Builds, verifies, monitors, diagnoses, drafts proposals, tags releases | Signs or sends a mainnet transaction; moves mainnet funds |
| **C** | Codex | Nothing operational | Runs anything here |

### 0.2 Conventions

- Each step is a checkbox: **owner**, the **command** (run from `app/` on the operator machine unless stated), the **expected** result, and what to do on failure (**abort / rollback**). Tick it only with its evidence in the launch log.
- **Launch log.** A private file on the operator machine (`~/onepercent-launch-log.md`), one line per step: UTC time, step id, signature or output hash, initials. Public facts (addresses, signatures, hashes) are also posted to the watch channel and, after the season, committed by the architect to `docs/launch/season-1.md`. No secret ever enters the log.
- **Environment on the operator machine.** Solana CLI (Agave) 4.3.0, `solana-verify` 0.5.2, Docker, Node 22 with pnpm 10.34.5, the repository checked out at the tag the step names. Read-only RPC in `MAINNET_RPC` (the founder's own Helius URL). Key files on an encrypted volume, passed by path; never in an environment variable.
- **The project's CLIs.** `onepct-ops` and `onepct-rescue` are the `packages/cli` binaries of the checked-out tag: `pnpm --filter @onepercent/cli exec onepct-ops …` from `app/`, or the built binaries on `PATH` (Appendix R-C).
- **Typed confirmations.** Every M6 `onepct-ops` command that signs prints the cluster, the program id and the plan, then waits for the operator to type the program id's first and last four characters. M4's `onepct-ops launch …` commands are written here as M4 §12.4 defines them; `launch send` takes `--confirm <first 8 characters of the mint>` instead.
- **Squads.** Every admin action is a Squads v4 vault transaction: `onepct-ops` prints an unsigned base58 transaction whose fee payer is the vault; a member imports it in the Squads app's transaction builder, creates the proposal, and two members approve it with their hardware wallets after checking the decoded instructions against the watch channel's post. It can run 12 h after approval (`GOVERNANCE.timelockSeconds` = 43,200). Exact app steps: §0.5.
- **Times** are UTC. "D-numbers" are the working days of master §11.1 (D1 = Thu 10-08 … D15 = Wed 10-28). "L-days" count from launch: L0 = Thu 10-29 (T0), L1 = Fri 10-30, L2 = Sat 10-31, L3 = Sun 11-01 (master: "D0–D3").
- **Never:** paste a key or seed phrase anywhere; run a command from a link someone sent; let anyone but F, M2, M3 or the guardians sign; skip a simulation.

### 0.3 Calendar (from master §11.1)

| When (UTC) | Step | Owner |
|---|---|---|
| D5–D12 | 0. Preparation: keys, multisig, guardians, providers, Railway production, funding, paging | F, A |
| D6 Thu 10-15 | 1. Domain reviews (T−14) | F |
| D8 Mon 10-19 | 2.0 DNS on Cloudflare | F, A |
| D10 Wed 10-21 | 2.1 `web` in production in landing-proxy mode (M6 SW merged); switch-over rehearsal on a throwaway hostname | F, A |
| D11 Thu 10-22, 06:00 | 2.2 The hostname moves to `web` (still serving the landing) | F, A |
| D11 Thu 10-22, 16:00 | 2.3 SW-1: `web` switches to the app (X-ray Week, T−7); then 2.5 Dialect registration | F, A |
| D12 Fri 10-23 | C. Canary deployed; `rc-1` tagged; the G0.1 drill re-run on devnet with `rc-1` (3.1) | F, A |
| Sat 10-24 – Sun 10-25 | 3. RC deploy (first mainnet deploy) and `initialize`; 4. upgrade authority to Squads; 5. `SetSeason`, hit list, verification PDA through Squads | F, M2, M3, A |
| D13 Mon 10-26, by 12:00 | 6.0 First rescue pin (take-back and Redeem) | A or F |
| D13 Mon 10-26, 16:00 | 6. Stock-Up (`stock_up_ts` = 1,793,030,400) and SW-2 | F, A |
| D13–D15 | C. Canary checks; VRF burst (pending founder) | F, A |
| D14 Tue 10-27 | 7.0 `BLINKS_FEED` after G5.2; 7.1 launch funding through Squads (F15); 7.2 announcements ready; 7.3 full rescue pin | F, M2, M3, A |
| D15 Wed 10-28 | 7.4 T−1 canary launch rehearsal (before 12:00); 7.5 mainnet launch lookup table and `launch check`; **8.1 go / no-go at T−24 h, 16:00** (Gate G6) | F, A |
| Thu 10-29, 15:45–15:50 | **8.2 go / no-go at T−10 min** | F, A |
| Thu 10-29, 16:00 | **9. Power-On** (T0) | F |
| Thu 10-29, 16:15 | **9. On Air** (`on_air_ts = power_on_ts + 900`) and SW-3 | keeper, F, A |
| Thu 10-29 15:00 – Sun 11-01 23:59 | 10. L0–L3 support rota | F, G2, A |
| Fri 10-30 04:15; Fri 10-30 16:15; Sat 10-31 04:15 | The 1% #2, #3, #4 eligible (on chain, from timestamps) | - |
| Sat 10-31 10:15 | 11.1 Last Call (`end_ts − 6 h`) | - |
| Sat 10-31 16:15 | 11.2 Buys closed (`end_ts`) | keeper, F |
| Sat 10-31 from 16:25 | 11.3 The Final Pull | keeper, A |
| Mon 11-02 ≈ 16:00 | 12.1 Seal proposal created and approved | F, M2, M3 |
| Tue 11-03 from 16:25 | **12.2 Sealed** (`final_ts + 72 h`; upgrade authority → None) | F, M2, A |

The times after T0 assume `power_on_ts` = 16:00:00 exactly. At step 9.3 the architect recomputes them from the chain (`on_air_ts`, `end_ts`, `final_ts`) and updates this table in the launch log.

### 0.4 Abort principles

- Exits never depend on any step here: take-back, Redeem, settle, refund and the other exits work in every phase, paused or not, with or without services. The rescue page and CLI prove it (M6 brief §6). When in doubt, stop the step; users are not stuck.
- A guardian pause (RIP, FEED, SELLBACK, STOCKBUY, BURN) is the first response to anything unexplained after Stock-Up. It never blocks an exit.
- The program changes only through a 12 h timelocked upgrade after Stock-Up (master §9.2 S8), announced by the watch channel. There is no faster path, by design.
- No fallback plan for an RC slip (D3): if the RC is not ready, the architect brings it to the founder, who decides.

### 0.5 Squads v4 procedures

Squads v4 is immutable since November 2024, so these rules match what runs on chain (Appendix R-D).

- **Signing.** Members sign with their hardware wallets through Phantom or Solflare in the Squads app (Squads documents no direct Ledger connection; the Ledger needs blind signing on). Each member does one dry run on devnet before step 3. Fallback when the app is unavailable: the Squads CLI with the Ledger, `squads-multisig-cli … --keypair usb://ledger` (version 0.1.7 on crates.io; that it builds is checked at M6 start).
- **Vault 0** is the address `onepct-ops squads check` prints as vault index 0; it is the program's upgrade authority, `Config.admin`, and every buffer's authority before an upgrade. Check that the app's "Squad address" is the same address before using it anywhere.
- **Create a proposal from `onepct-ops`.** The command prints an unsigned base58 transaction whose fee payer is vault 0, and its decoded plan. In the Squads app: Transaction Builder → import the base58 transaction → its simulation must show only the expected programs (and Compute Budget) → create the proposal (a member signs). The watch channel then posts the decoded proposal (M6 brief §5.4).
- **Approve.** Two members, each after comparing the app's view with `onepct-ops squads show --index <i>` and the watch channel's post. The release time is the approval time plus 43,200 s; `squads show` prints it. Fallback: `squads-multisig-cli proposal-vote --keypair usb://ledger --multisig-pubkey <M> --transaction-index <i> --action Approve --rpc-url "$MAINNET_RPC"`.
- **Reject or cancel.** An Active proposal ends after 2 rejections (2-of-3). An Approved one is cancelled with 2 cancel votes. Neither changes anything on chain.
- **Execute.** After the release time, a member with the execute permission executes it in the app. Fallback: `squads-multisig-cli vault-transaction-execute --keypair usb://ledger --multisig-pubkey <M> --transaction-index <i> --rpc-url "$MAINNET_RPC"`. The time lock is checked at execution against the multisig's current time lock.
- **Never execute a configuration change** (time lock, members, threshold) while another proposal is waiting for approval: executing it makes every earlier proposal that is not yet approved stale. Approved vault transactions stay executable.
- **Program upgrades** follow playbook P8. The vault cannot extend a program: if the new `.so` is larger, anyone runs `solana program extend <PROGRAM_ID> <bytes>` before the upgrade executes (once SIMD-0431 is active, each extension adds at least 10 KiB). The seal (SetAuthority to None) is not offered by the app's program page: it goes through the Transaction Builder import of `onepct-ops program propose-seal` (step 12).

---

## Step 0. Preparation (D5–D12)

### 0.1 Keys (F8, F9)

- [ ] **0.1.1 Program and mint keypairs.** Owner: F, offline. Generate the mainnet and canary program keypairs and the $1PCT vanity mint keypair (F8) on an offline machine, each into its own file on an encrypted volume: `solana-keygen new --no-bip39-passphrase -o <volume>/<name>.json` (the mint: `solana-keygen grind --starts-with <prefix>:1`, prefix of the founder's choice). Give A the three **public** keys.
  Expected: A runs `node scripts/set-program-id.mjs` with them (M6 brief §7.5) and records them in `ONEPERCENT_PROGRAM_IDS` and the init parameters.
  Abort: a file lost before step 3 → generate again; nothing on chain uses it yet.
- [ ] **0.1.2 People's keys.** Owner: F (G2 for guardian 2, on their own machine). The deployer (upgrade authority until step 4), the launch wallet, the ops wallet (pending founder, M6 brief Appendix A Q3), guardian 1; guardian 2. Canary: its own deployer and admin keys. Public keys to A.
  Expected: every public key in the launch log and with A, who checks each against `init.mainnet.json` and `EXPECTED_ADDRESSES_JSON`.
  Abort: a key exposed before step 3 → generate a new one. After step 3 a role key changes through `role set` via Squads (12 h; P2, P11).
- [ ] **0.1.3 Hot keys.** Owner: F. For production and for staging separately: keeper (one key, both keeper replicas), executor, intake signer, quote signer. Generate each on the operator machine into a temporary file, paste it into exactly one Railway service's variable (`KEEPER_KEYPAIR` in `keeper-a` and `keeper-b`; `EXECUTOR_KEYPAIR`; `INTAKE_SIGNER_KEYPAIR`; `QUOTE_SIGNER_KEYPAIR`), then delete the file (`rm -P` on macOS). Public keys to A.
  Expected: each service's `/ready` reports its role check once `initialize` (step 3) has written the role into Config.
  Abort: a key exposed anywhere → generate a new one before step 3, or rotate after it (playbook P2).
- [ ] **0.1.4 Squads multisig (F9).** Owner: F, M2, M3 in the Squads app with their hardware wallets. A 2-of-3 multisig, time lock 43,200 s, no config authority (autonomous). Record the multisig address, vault 0 (admin and upgrade authority) and the team vault.
  Command (A): `onepct-ops squads check --cluster mainnet --multisig <M> --rpc "$MAINNET_RPC"`.
  Expected: threshold 2, three members with their permissions, time lock 43,200, config authority = the default key. Independent check of the raw account (layout: discriminator 8, `create_key` 32, `config_authority` 32, `threshold` u16, `time_lock` u32): `solana account <M> --url "$MAINNET_RPC" --output-file ms.bin && xxd -s 40 -l 38 ms.bin` shows 32 zero bytes, then `0200`, then `c0a80000`.
  Abort: anything else → create a new multisig; nothing references it before step 3.
- [ ] **0.1.5 Fund vault 0.** Owner: F. At least 3.1 SOL before step 5: the 3 SOL kept liquid through L3 (PARAMS §17) plus the rent of the hit-list ledgers and vault ATAs (≈0.013 SOL) and of the verification PDA. Before step 7.1, add the launch funding of 0.4 (F15, about 6 SOL), which leaves the multisig through Squads.
  Expected: `solana balance <VAULT_0> --url "$MAINNET_RPC"` shows at least 3.1 SOL, and the F15 total on top before step 7.1.
  Abort: short → F tops it up; the steps that pay from the vault (5, 7.1) wait.

### 0.2 Providers and accounts (F10, F13)

- [ ] **0.2.1** Owner: F; A checks each key works. Helius keys, one per service (the intake signer's on Developer or higher, PARAMS §18); Triton as the fallback; Jupiter Developer for two orgs; a Pyth Hermes key; Cloudflare (DNS proxy, Turnstile); Railway `dev`, `staging` and `production` with Postgres 17 and Redis 7.
  Expected: A records one successful read per key (Helius and Triton `getSlot`, a Jupiter quote, a Hermes price, a Turnstile test token) and the three Railway environments with Postgres 17 and Redis 7.
  Abort: a provider unavailable → its fallback (Triton for RPC) or a new key; nothing on chain depends on this step.
- [ ] **0.2.2 IPFS.** Owner: F. Two pinning accounts on free plans (M6 brief §6.7): Filebase (a bucket for the releases, its free dedicated gateway, a token scoped to that bucket) and Pinata (an API key with the scope `org:files:write`); a Lighthouse account as the fallback for Pinata. The tokens go only into the uncommitted `apps/rescue/.env.pin` of the machine that pins, as `FILEBASE_TOKEN`, `PINATA_TOKEN` and `LIGHTHOUSE_API_KEY`.
  Expected: a one-file test directory goes through `pnpm --filter rescue car`, `pin` and `verify` with the same CID at both services.
  Abort: a free plan refuses → the fallback of M6 brief §6.7 (Lighthouse for Pinata; the S3 import for Filebase).
- [ ] **0.2.3 Telegram.** Owner: F. The public bot exists, with M5 Appendix A.0's BotFather settings before SW-1. Create the **ops bot** (BotFather) for the monitor; a private **guardian group** with F, G2 and A; the public **watch channel**, with the ops bot as an admin that can post. Each guardian opens a DM with the ops bot. Record the chat ids and the guardians' user ids for the monitor's variables (Appendix R-B).
  Expected: the ops bot posts a test message in the guardian group and in the watch channel, and DMs each guardian.
  Abort: none needed (nothing on chain); recreate the bot or the chats and update the monitor's variables.
- [ ] **0.2.4 Watchdog.** Owner: F. An external keyword monitor on `https://www.onepercent.fun/api/status` (the hostname attached to `web`, step 2) expecting `"fresh":true` every 5 minutes, alerting both guardians by app and e-mail (M6 brief §5.10). Active from step 2.3: before SW-1, the landing-proxy mode sends every path to the landing.
  Expected: from step 2.3 the watchdog shows the URL up; a test with a wrong keyword alerts both guardians.
  Abort: an alert does not arrive → fix the contacts; the monitor's own paging still works.
- [ ] **0.2.5 Pager (optional).** Owner: F. A push service whose webhook takes a header token, set as `PAGER_WEBHOOK_URL` and `PAGER_WEBHOOK_TOKEN` on the monitor.
  Expected: a test page arrives through the pager. Abort: optional; skip it if it fails.

### 0.3 Railway production stack

- [ ] **0.3.1 Services** (master §3.2): `web`, `api` (`ROLE=public`), `intake-signer`, `quote-signer`, `indexer`, `keeper-a`, `keeper-b`, `executor`, `monitor`, `bot`, Postgres, Redis. The landing service `onepercent` stays as it is.
  Settings for each app service, in the dashboard (Railway's config-as-code files are deprecated and are not read after 2026-12-01; none is used):
  - trigger branch `release` (set per environment); in `staging` it deploys on push; in `production` automatic deploys are disabled and F deploys with "Deploy Latest Commit" after each audit PASS (master §5.2); "Wait for CI" on;
  - Root Directory `app` (the `web` image builds from the repository root per M3 §15.4) and its Dockerfile (`RAILWAY_DOCKERFILE_PATH` when it is not at the root);
  - Watch Paths: its own package and the shared packages, written from the repository root (`app/services/api/**`, `app/packages/**`): Railway matches them from `/` even with a Root Directory;
  - health check path `/health` (Railway's checks use the Host `healthcheck.railway.app`; every service answers any host);
  - `web` and `api`: a deployment overlap (`RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`) so a new deployment serves before the old one stops; workers: a draining time (`RAILWAY_DEPLOYMENT_DRAINING_SECONDS`) of 30 s, above S0's graceful shutdown (`SERVICES.transport.shutdownDrainMs` = 10 s, D15), which stops signing and releases the leader lock.
  Pre-deploy command for every `api` and `worker` service: `node node_modules/@onepercent/db/dist/migrate-cli.js`.
  Variables: Appendix R-B, including `PRIVATE_HOST=::` on every service with a private listener, that is every service but `web` (Railway's private network; S0's default `127.0.0.1` is unreachable).
  Owner: F with A. Expected: each public `/health` answers 200; the monitor reads every private `/ready` (from step 3 on, once `PROGRAM_ID`'s Config exists).
  Abort: a service failing its health check is not promoted; Railway keeps the previous deployment.
- [ ] **0.3.2 Monitor in production before step 3.** Owner: A. `EXPECTED_ADDRESSES_JSON` from 0.1; the ops bot variables from 0.2.3; a test page acked by both guardians.
  Expected: a heartbeat in `monitor_runs` every `chainCheckSeconds`; the program checks report `not_deployed` until step 3; the governance loop reads the multisig.
  Abort: not ready → step 3 waits (a precondition of 3.1).

### 0.4 Funding (F12, F14, F15)

| What | Amount | When | From |
|---|---|---|---|
| RC deploy (F12) | `2 × (128 + 45 + so_len) × lamports_per_byte` (ProgramData and the temporary buffer) + the `initialize` accounts (Config, Machine and its 0.05 SOL rent buffer, Deck header, FeeIn: ≈0.08 SOL) + ≈0.1 SOL of fees. At 512,000 bytes and 5,080 lamports per byte: ≈5.4 SOL. A recomputes it with the RC's `.so` size (M6 brief §7.2) | D12 | F, to the deployer |
| Canary (F14) | ≈3.9 SOL locked + ≈2.6 SOL of temporary buffer + fees; devnet SOL for Soak-D | D11 | F |
| Launch (F15) | the dev buy (≈1.176 SOL; F reads the live quote from M4's `onepct-ops launch plan` at T−48 h, step 7.1) + fees, the vault ATA rent and the launch lookup table's rent + 0.1 SOL margin, to the launch wallet; keeper and executor fee payers ≥ 1 SOL each; DexScreener ≈2.6 SOL (ops wallet); 3 SOL kept liquid in vault 0 | the Squads transfer proposal approved by D14 10:00 so it executes by D14 22:00 | the multisig (step 7.1) |

### 0.5 Guardians

- [ ] **0.5.1** Owner: F, G2. Each guardian runs a devnet pause and unpause on the drill program with their own key file (`onepct-ops guardian pause --bits RIP --cluster devnet --program <drill> --keypair <guardian file>`, then the same with `unpause`), and acks a test page from the ops bot.
  Expected: both instructions land; both acks recorded.
  Abort: a failed pause or a missing ack → fix the key file or the tooling before step 3; nothing on mainnet depends on it yet.
- [ ] **0.5.2** Owner: F, G2. Shift plan for L0–L3 agreed (step 10).
  Expected: step 10's table filled with names. Abort: a gap → F covers it or reports it at 8.1 as a manual item.

---

## Step 1. Domain reviews — D6 Thu 10-15 (T−14)

- [ ] **1.1 Phantom.** Owner: F (A drafts the text). Phantom shows a soft notice on a domain it has not reviewed yet and usually lifts it within days; its developer docs route a notice that persists beyond a week, or a transaction warning that persists, to the domain review form (Appendix R-D). Submit `onepercent.fun` and `www.onepercent.fun` with: the mainnet program id (from 0.1.1; deployed at step 3), the `vault_auth`, Config, Machine and Deck PDAs (A derives them), the Squads vault, a short description, a contact address.
  Expected: the submission's confirmation in the launch log. At D11 and again at D13, A opens the site in Phantom: no warning.
  Abort: none needed (no state changes). A warning still present at D13 → resubmit with the evidence; Feed (step 6) still opens; the canary's wallet tests (C6) show whether transactions themselves warn.
- [ ] **1.2 Blockaid.** Owner: F. Blockaid's support portal (Appendix R-D) has a request to verify that a project will pass its security checks. Same content as 1.1.
  Expected: a ticket number in the launch log.
  Abort: none needed (no state change); resubmit with the evidence if a warning appears.
- [ ] **1.3 Transaction hygiene.** Owner: A. Confirm M3's flows follow Phantom's guidance: a single signer, simulation with `sigVerify: false` before every prompt, Feed transactions at most 1,047 B with lookup tables where needed. Evidence: the canary's C6.
  Expected: C6's evidence shows single-signer prompts and a simulation before each prompt. Abort: a deviation → A reports it against M3 before SW-2.
- [ ] **1.4 Later submissions.** Owner: F. After step 3: "the program is now deployed" to both, with its address. After each rescue pin (6.0 on D13, 7.3 on D14): the release URLs (M6 brief §6.7).
  Expected: each confirmation in the launch log. Abort: none needed.

---

## Step 2. Switch-over SW-1, with a rehearsed rollback — D8 to D11

**Approach.** Railway has no domain move: a custom domain is removed from one service and added to another, which generates a new verification record and can leave the hostname answering 404 for minutes or more (Appendix R-D). So the move happens once, before X-ray Week, while visitors still see the landing: the `web` service becomes the domains' permanent edge in its **landing-proxy mode** (`WEB_MODE=landing-proxy`: its Caddy forwards every request to the landing service over Railway's private network; M6 brief §10.3). SW-1 is then a new `web` deployment in app mode, and its rollback is a Railway **Rollback** of `web` to the previous deployment: no DNS, verification or certificate step. Moving the domain back to the landing service stays as the second-line fallback (≤ 5 min, master §5.3, rehearsed in 2.1). No landing file changes at any stage.

- [ ] **2.0 DNS and Cloudflare — D8.** Owner: F, with A.
  ```
  dig +short NS onepercent.fun
  curl -sI https://onepercent.fun | head -5         # where the apex → www redirect lives today
  curl -sI https://www.onepercent.fun | head -5
  ```
  If the zone is not on Cloudflare yet: import its records into Cloudflare with the proxy off, lower the TTLs, switch the nameservers at the registrar, wait until `dig NS` answers Cloudflare from several resolvers, then check the landing still serves. Then: SSL/TLS mode **Full** (not Full (strict), not Flexible, which loops), Universal SSL on, records proxied. Keep the apex → www redirect as a Cloudflare redirect rule, so only `www.onepercent.fun` is attached on Railway (2.1 tests the alternative if proxied `www` misbehaves).
  Expected: the landing serves through Cloudflare at both names: `curl -sI https://www.onepercent.fun` shows `server: cloudflare` and a 200, and `curl -s https://www.onepercent.fun | grep -o '<title>[^<]*'` prints the landing's title, recorded for `sw check --expect landing` (the command exists from D10).
  Abort: switch the nameservers back at the registrar; the landing keeps serving through its current DNS; 2.2 then moves the domain without Cloudflare.
- [ ] **2.1 Rehearsal on a throwaway hostname — D10, once M6's SW PR is merged.** Owner: F (Railway, Cloudflare), A measures with `onepct-ops sw check` in a 5-second loop.
  1. `web` runs in production in landing-proxy mode (`WEB_MODE=landing-proxy`, `LANDING_UPSTREAM` = the landing's private address, Appendix R-B); `onepct-ops sw check --host <web's Railway domain> --expect landing` passes.
  2. Attach `sw-test.onepercent.fun` to the landing service (its CNAME and `_railway-verify` TXT records in Cloudflare, proxied). Save `railway domain status sw-test.onepercent.fun -s onepercent --json`.
  3. Move it to `web`: remove it from the landing service, add it to `web`, update the CNAME and TXT records with `web`'s values. Time the 404 gap until `--expect landing` passes again (served by `web`'s proxy). Record whether the token changed and whether two TXT values can coexist.
  4. Deploy `web` in app mode (`WEB_MODE=app`); `--expect web` passes. Then Railway → `web` → Deployments → ⋮ on the previous deployment → **Rollback**; time until `--expect landing` passes. Target: under a minute.
  5. Move the hostname back to the landing service (the second-line fallback); time it. Target: ≤ 5 min.
  6. If `www`-style proxied subdomains return 404 at Railway's edge (an open report, Appendix R-D), plan the apex as the Railway hostname and redirect `www` → apex at Cloudflare instead.
  Expected: the timings and the procedure in the launch log; the plan's rollback window noted (Railway keeps a superseded deployment for 72 h on Hobby and 120 h on Pro).
  Abort: landing-proxy mode does not work → use the master's plan: move the domains at SW-1 and roll back by moving them back, with the timings of step 5.
- [ ] **2.2 Move the production hostname to `web` — D11, 06:00.** Owner: F, A watches. As 2.1 step 3 with `www.onepercent.fun` (and the apex if it is attached on Railway).
  Expected: `onepct-ops sw check --host www.onepercent.fun --expect landing` passes through `web`.
  Rollback: re-attach the hostname to the landing service (2.1 step 5).
- [ ] **2.3 SW-1 — D11 Thu 10-22, 16:00 (X-ray Week, T−7).** Owner: F (Railway), A checks.
  Preconditions: G3.1 passed and `release` promoted for `web` and `api`; on `api`: `FLAG_XRAY=on`, `FLAG_TV_LIVE=on` (countdown), `FLAG_BLINKS_XRAY=on`; `/api/config` answers 200 with its flags although the mainnet program does not exist yet (M6 brief Appendix B, B14); the monitor fresh.
  Action: set `WEB_MODE=app` on `web` and let it deploy.
  Expected: `onepct-ops sw check --host www.onepercent.fun --expect web` PASS (app shell, `/api/config`, OG tags of `/x/<address>`, SSE ping, CSP and HSTS, `/status`, the rescue link); the apex redirects; the watchdog (0.2.4) turned on and green; F posts the X-ray Week announcement.
  Rollback (seconds): Railway → `web` → Deployments → ⋮ on the landing-proxy deployment → Rollback; `--expect landing` passes. A Railway rollback also restores that deployment's variables. Past the retention window: set `WEB_MODE=landing-proxy` (a new deployment, minutes). Second line: 2.1 step 5.
  Triggers: `sw check` failing for more than 5 min, TLS errors, `api` down (OPS-07), a wallet or security warning on the domain.
- [ ] **2.4 Later stages.** SW-2 is a flag at Stock-Up (6.3), SW-3 flags at On Air (9.4). The landing service stays as the rollback target until T0 + 7 d (11.4).
  Expected and rollback: in 6.3 and 9.4.
- [ ] **2.5 Dialect registration — after SW-1.** Owner: F. M5 Appendix A.2: step 1 now (test the X-ray Blink at `dial.to`, submit the host to Dialect); steps 2–3 after M5's B2 merges and before SW-3. Not a launch blocker.
  Expected: the X-ray Blink unfurls at `dial.to`; later the registry lists the Actions as registered. Abort: not a launch blocker; the Blinks work at `dial.to` meanwhile.

---

## Step 3. RC deploy (the first mainnet deploy, D4) and `initialize` — Sat 10-24

Window: Saturday from 10:00, after the RC audit's PASS. Latest start: Sunday 10:00, so that step 5's proposals, approved by Sunday 14:00, can run by Monday 02:00, 14 h before `stock_up_ts`.

- [ ] **3.1 Preconditions.** Owner: A, F. The RC audit PASS on `rc-N` (Gate G6's audit part); the tag `rc-N-mainnet`; its hash in `fixtures/rc/rc-N.json`, reproduced by CI and by A; the monitor live in production (0.3.2); the deployer funded (0.4); `release` fast-forwarded to `rc-N` and the services promoted with `PROGRAM_ID` = the mainnet program id; the G0.1 drill re-run on devnet with the `rc-N` artifact (A, Friday 10-23), which rehearses steps 3, 4 and 12 with disposable keys: deploy, direct upgrade, move to a Squads 2-of-3 vault, a timelocked upgrade that refuses early execution, the seal, then `Immutable`:
  ```
  cd app && pnpm devnet:drill --run-id rc-N --env-file <file holding HELIUS_API_KEY>
  ```
  Expected: every item recorded with its evidence; the drill's journal ends with the authority removed.
  Abort: an item missing → wait. If the deploy cannot start by Sunday 10:00, F decides a later `stock_up_ts` (written once by `SetSeason`, step 5) and announces it.
- [ ] **3.2 Build and check the binary.** Owner: F on the operator machine; A in parallel on theirs.
  ```
  git fetch --tags && git checkout rc-N-mainnet && cd app
  IMG=solanafoundation/solana-verifiable-build@sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd
  solana-verify build --library-name onepercent --base-image "$IMG" --arch v3
  node scripts/check-sbf-flags.mjs target/deploy/onepercent.so
  solana-verify get-executable-hash target/deploy/onepercent.so
  ```
  Expected: flags 3; the hash equals the mainnet hash of `rc-N.json` and A's result. Never run `anchor build` after this: it overwrites the file.
  Abort: any difference → stop; A investigates. Nothing is on chain yet.
- [ ] **3.3 Write the buffer.** Owner: F.
  ```
  solana program write-buffer target/deploy/onepercent.so --url "$MAINNET_RPC" --keypair <deployer> --with-compute-unit-price 50000 --max-sign-attempts 50
  solana-verify get-buffer-hash -u "$MAINNET_RPC" <BUFFER>
  ```
  Expected: `Buffer: <BUFFER>`; its hash equals the mainnet hash.
  Abort: a different hash or a failed write → `solana program close <BUFFER> --url "$MAINNET_RPC" --keypair <deployer>` (the rent comes back), then 3.3 again.
- [ ] **3.4 Deploy.** Owner: F.
  ```
  solana program deploy --buffer <BUFFER> --program-id <mainnet program keypair> --upgrade-authority <deployer> --keypair <deployer> --url "$MAINNET_RPC" --with-compute-unit-price 50000 --max-sign-attempts 50
  solana program show <PROGRAM_ID> --url "$MAINNET_RPC"
  solana-verify get-program-hash -u "$MAINNET_RPC" <PROGRAM_ID>
  onepct-ops program show --cluster mainnet --rpc "$MAINNET_RPC"
  ```
  Expected: `Program Id: <PROGRAM_ID>`, `Authority: <deployer>`; the program hash equals the mainnet hash; `program show` PASS.
  Abort: a failed deploy leaves the buffer: retry 3.4. A hash that differs after the deploy: do not initialize; A investigates; the deployer still holds the authority and can upgrade.
- [ ] **3.5 Publish the hash.** Owner: A, F. The program id, the hash, the tag and the build command to the watch channel and the launch log.
  Expected: the post and the log line. Abort: none needed (information).
- [ ] **3.6 `initialize`.** Owner: F. A prepares `init.mainnet.json` from step 0: `admin` = vault 0; the two guardians; keeper, executor, intake signer, quote signer, launch wallet; `team_wallet`; `team_wallets` (the ops wallet included); `token_mint` = the vanity mint's public key; `vrf_queue` = `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh`; `rent_buffer_lamports` = 50,000,000 (M1 A8).
  ```
  onepct-ops squads check --cluster mainnet --rpc "$MAINNET_RPC" --multisig <M>      # read vault 0 aloud with A
  onepct-ops init --cluster mainnet --rpc "$MAINNET_RPC" --params init.mainnet.json --keypair <deployer>
  onepct-ops addresses --cluster mainnet --rpc "$MAINNET_RPC" --json > addresses.mainnet.json
  ```
  Expected: the typed confirmation shows `admin` = vault 0; one signature; Config, Machine, Deck and FeeIn exist; `addresses.mainnet.json` matches the plan. A sets it as the monitor's `EXPECTED_ADDRESSES_JSON`; KEY-05 is green; every hot-key service's `/ready` passes its role check.
  Abort: a failed `initialize` created nothing: fix and retry. A wrong role after success: `role set` through Squads (12 h, step 5). **A wrong `admin` cannot be repaired without new program code**: the check of vault 0 before signing is mandatory.
- [ ] **3.7 Protocol lookup table.** Owner: F.
  ```
  onepct-ops lut create --cluster mainnet --rpc "$MAINNET_RPC" --keypair <deployer>
  onepct-ops lut extend --cluster mainnet --rpc "$MAINNET_RPC" --keypair <deployer> --lut <LUT>
  onepct-ops lut freeze --cluster mainnet --rpc "$MAINNET_RPC" --keypair <deployer> --lut <LUT>
  ```
  Expected: the table holds the M1 §15.4 addresses; its authority is gone (frozen, master §7.5). A sets `PROTOCOL_LUT_ADDRESS` and `ADMIN_MULTISIG_ADDRESS` on `api` (M3 §5.1 B).
  Abort: a failed `create` or `extend` → retry; a wrong table cannot change once frozen → create a new one and use its address (the old one's rent is lost).

---

## Step 4. Upgrade authority to Squads (12 h time lock) — Sat 10-24, right after step 3

- [ ] **4.1 Move the authority.** Owner: F, with A reading vault 0 from `squads check`.
  ```
  onepct-ops program set-authority --cluster mainnet --rpc "$MAINNET_RPC" --to <VAULT_0> --keypair <deployer>
  solana program show <PROGRAM_ID> --url "$MAINNET_RPC"
  ```
  (Equivalent loader call: `solana program set-upgrade-authority <PROGRAM_ID> --upgrade-authority <deployer> --new-upgrade-authority <VAULT_0> --skip-new-upgrade-authority-signer-check`.)
  Expected: `Authority: <VAULT_0>`; GOV-01 green; the watch channel posts the change; `/status` shows the 12 h time lock trust line.
  Abort: a failed transaction → retry. A wrong address is unrecoverable: the command asks for it twice and checks it against the multisig.
- [ ] **4.2 Close leftover buffers.** Owner: F. `solana program show --buffers --buffer-authority <deployer> --url "$MAINNET_RPC"`, then `solana program close <BUFFER> …` for each (rent back).
  Expected: the list is empty. Abort: none needed; a leftover buffer only holds rent.
- [ ] **4.3 Retire the deployer** (master §6): it can no longer upgrade; keep the file offline for the record.
  Expected: `solana program show <PROGRAM_ID>` shows `Authority: <VAULT_0>`. Abort: none (nothing is sent).

From here until the seal, the program changes only through a Squads proposal executed 12 h after its approval (master §9.2 S8), posted by the watcher (playbook P8).

---

## Step 5. `S`, `stock_up_ts`, the hit list and the verification PDA, through Squads — Sat 10-24 → Sun 10-25

- [ ] **5.1 Prepare the transactions.** Owner: A; F checks each decoded plan.
  - `SetSeason`: `onepct-ops set-season --cluster mainnet --rpc "$MAINNET_RPC" --slot <S> --ts <snapshot_ts> --stock-up-ts 1793030400`. `S` is the slot published at X-ray Week (master §11.1 D10); `snapshot_ts` is `getBlockTime(S)`; 1,793,030,400 is Mon 2026-10-26 16:00:00 UTC. **`S` is written once and can never change** (M1 §9.2).
  - The hit list: `onepct-ops hitlist check <mint> --class major` for WIF, BONK, POPCAT, FARTCOIN and PNUT (reports younger than 24 h, M2 §12.1), then `onepct-ops hitlist add <mint> --class major` for each: a vault ATA creation and `admin_list_mint`, paid by vault 0.
  - The verification PDA (pending founder, M6 brief Appendix A Q2, for the public repository URL):
    ```
    solana-verify export-pda-tx <PUBLIC_REPO_URL> -um --program-id <PROGRAM_ID> --commit-hash <commit of rc-N-mainnet> --library-name onepercent --base-image "$IMG" --arch v3 --uploader <VAULT_0> --encoding base58 --compute-unit-price 0
    ```
  Each command prints an unsigned base58 transaction and its decoded plan.
  Expected: F confirms each decoded plan against this step (amounts, mints, `S`, `stock_up_ts`, the repository URL and commit). Abort: a mismatch → A rebuilds it; nothing is signed yet.
- [ ] **5.2 Propose and approve.** Owner: F creates each proposal (§0.5); F and one of M2 or M3 approve after comparing the Squads app's view with the decoded plan and the watch channel's post. Approve all of them by Sunday 14:00 at the latest.
  Expected: each proposal Approved; the watch channel shows each with its release time (approval + 12 h).
  Abort: a mismatch → reject or cancel the proposal (it does nothing), rebuild, propose again.
- [ ] **5.3 Execute and check.** Owner: F (any member with the execute permission), after each release time.
  ```
  onepct-rescue status --cluster mainnet --rpc "$MAINNET_RPC"                  # season clocks
  onepct-ops program show --cluster mainnet --rpc "$MAINNET_RPC"
  solana-verify get-program-pda -um --program-id <PROGRAM_ID> --signer <VAULT_0>
  solana-verify remote submit-job --program-id <PROGRAM_ID> --uploader <VAULT_0>
  curl -s https://verify.osec.io/status/<PROGRAM_ID>
  ```
  Expected: `season_set`, `S`, `snapshot_ts` and `stock_up_ts` as proposed; five MAJOR buckets listed and enabled with their caps; the verification PDA present; the OtterSec status shows the program verified with the published hash.
  Abort: `SetSeason` not executed before `stock_up_ts` → it still works after (the keeper advances at once); announce the new Stock-Up time. A listing that fails → propose again (12 h); Feed does not need the hit list, packs do (before On Air). A failed remote verification is not a launch blocker: the published hash and its reproduction (3.2) are; A follows up with OtterSec.

---

## Step 6. Stock-Up and SW-2 — Mon 10-26, 16:00 (`stock_up_ts`)

- [ ] **6.0 First rescue pin — D13, by 12:00** (take-back and Redeem; M6 brief §6.7). Owner: A or F, on the machine that holds the pinning tokens (0.2.2).
  ```
  git fetch && git checkout <release commit> && cd app
  pnpm --filter rescue build && pnpm --filter rescue car && pnpm --filter rescue pin && pnpm --filter rescue verify
  ```
  Then open each release URL in Chrome, Firefox and a phone browser: the page loads, its hash routes work, a wallet connects, and "Find my things" reads the mainnet program.
  Expected: one CID from `car`, Filebase and Pinata (or Lighthouse); delegated routing lists both services; Filebase's gateway serves the same `index.html`. A sets `RESCUE_CID` and `RESCUE_URLS_JSON` on `api` and `VITE_RESCUE_URL` on `web` (a rebuild); F posts the CID and the URLs on the watch channel.
  Abort: a CID mismatch or a failed check → stop; A investigates. Stock-Up still happens, and `onepct-rescue` covers every exit meanwhile.
- [ ] **6.1 At 13:00.** Owner: A. `SetSeason` executed (5.3); `onepct-ops sw check --host www.onepercent.fun --expect web` PASS; the monitor fresh with no open critical; the intake signer `/ready` (its Helius plan carries `getTransactionsForAddress`, PARAMS §18); indexer lag below 30 s; the rescue page's first pin published (6.0) and its URLs in `VITE_RESCUE_URL`, `RESCUE_CID` and `RESCUE_URLS_JSON`.
  Expected: every item PASS in the launch log.
  Abort: any of these failing → Stock-Up still happens on chain at 16:00 (it is a timestamp); keep `FLAG_FEED=off` until fixed. Take-back works regardless.
- [ ] **6.2 16:00.** Owner: keeper; A watches. The keeper calls `advance_phase` → StockUp.
  Expected: `Machine.phase` = StockUp within `phaseOverdueSeconds` (OPS-12); the watch channel posts it.
  Abort: not done by 16:02 → F runs `onepct-rescue crank advance-phase --cluster mainnet --rpc "$MAINNET_RPC" --fee-payer <ops wallet>` (permissionless; any user could).
- [ ] **6.3 SW-2.** Owner: F (Railway), A checks. Set `FLAG_FEED=on` on `api`, and `FLAG_BLINKS_FEED=on` only if G5.2 has passed (otherwise step 7.0; M5-A13); wait for the redeploy.
  Expected: `/api/config` shows `FEED` on; the Feed panel live; the first landed Feed appears in the indexer and on 1% TV.
  Rollback: `FLAG_FEED=off` (the panel goes, take-back and "In the machine" stay), and a guardian may pause FEED (`onepct-ops guardian pause --bits FEED …`). Exits are unaffected.
- [ ] **6.4 Announce.** Owner: F. The $1PCT mint address (`Config.token_mint`), the exact launch second (T0), the rule "the only $1PCT is `Config.token_mint` of program <PROGRAM_ID>" (SPEC §6.10), the rescue page link, the pinned "Admins never DM first".
  Expected: the posts live and pinned; A checks every address against the chain. Abort: a wrong address → delete the post at once and pin a correction.
- [ ] **6.5 Watch the Deck.** Owner: A. KPI: the Deck reaches about 4 × the packs expected in the first 6 h of On Air (PARAMS §14: ≈15–20k cards at mid scale); OPS-14 warns below 5,000 during Stock-Up. Report the figure daily to F.
  Expected: the daily figure in the launch log. Abort: none (a KPI); at T−24 h it is G8's information line.

---

## Step 7. Launch preparation — D14 Tue 10-27 and D15 Wed 10-28

- [ ] **7.0 Feed Blink — D14, after G5.2.** Owner: F (Railway), A checks. `FLAG_BLINKS_FEED=on` on `api` if 6.3 did not set it (M5-A13). Expected: `/api/config` shows it; the Feed Blink signs and lands at `dial.to` (M5 Appendix A.1 row 10). Rollback: the flag off.
- [ ] **7.1 Launch funding (F15).** Owner: F, M2 or M3. F runs M4's `onepct-ops launch plan --cluster mainnet --mint-keypair <vanity mint file> --wallet <launch wallet file> --uri <metadata URI>` (it sends nothing) and reads its quote; A checks it against the SDK's `devBuyQuote` on the live `Global` (M4 §10.2). The amount is that quote plus fees, the vault ATA rent, the launch lookup table's rent and a 0.1 SOL margin. One Squads proposal transfers it from vault 0 to the launch wallet, and the fee payers' top-up (keeper and executor ≥ 1 SOL each) if the ops wallet does not cover it. Approve by D14 10:00; execute after 22:00.
  Expected: balances per `onepct-ops gonogo` G10; vault 0 keeps ≥ 3 SOL.
  Abort: not executed by D15 12:00 → the founder funds the launch wallet from the ops wallet (published), and records it.
- [ ] **7.2 Announcements ready.** Owner: F. The launch post (T0 to the second, the mint, the rule of 6.4, the disclosed 4% dev buy that becomes the four The 1% cards, "team tokens: 0"); the published-addresses post from `onepct-ops addresses --md` (A checks it against the chain); the DexScreener profile materials; the support replies of step 10.
  Expected: drafts ready; A checks every number and address against the chain. Abort: none needed.
- [ ] **7.3 Full rescue pin — D14** (every exit). Owner: A or F. As 6.0, from the commit that holds RESCUE-B and RESCUE-PAGE. The D13 CID stays pinned (M6 brief §6.7 step 7). F sends the new URLs to the domain reviews (1.4).
  Expected and abort: as 6.0.
- [ ] **7.4 T−1 canary launch rehearsal — D15, before 12:00** (Track C's C7 and C8; M6 brief Appendix A Q1, option A). Owner: F; A records. M4's launch commands against the canary, with a throwaway coin that never uses Onepercent's name, ticker or art (`launch` refuses one that does, M4 §12.4):
  ```
  onepct-ops launch lut    --cluster canary --mint <throwaway mint public key> --wallet <canary launch wallet file>
  onepct-ops launch plan   --cluster canary --mint-keypair <throwaway mint file> --wallet <canary launch wallet file> --uri <https URI> --name <name> --symbol <symbol>
  onepct-ops launch check  --cluster canary …          # the same arguments as plan
  onepct-ops launch send   --cluster canary … --confirm <first 8 characters of the mint>
  onepct-ops launch report --cluster canary
  spl-token display -um <THROWAWAY_MINT>
  solana program show 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P -um     # pump.fun
  solana program show pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA -um     # PumpSwap
  solana program show pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ -um     # pump fees
  solana program show MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e -um     # Mayhem
  ```
  Expected: `launch report` passes and writes `reports/launch/canary-<UTC>.json`; the mint is Token-2022 with only the Metadata Pointer and Token Metadata extensions and no mint or freeze authority; the four programs' last deploy slots are recorded (the baseline of `launch check` item 1 and `gonogo` G1); the canary goes On Air 15 min later; the staging keeper's first fee-chain transaction then lands `CreatorFeesCollected` with `amount > 0` (M4 V8). The coin's address is published as a test.
  Abort: another extension, or an authority still set → **NO-GO** at step 8 (`power_on` would refuse it anyway, `MintNotSafe`); no collection with `amount > 0` → NO-GO for Power-On (M4 V8); A reports to F. Under Q1's option B: `plan` and `check` only, and G3 reads the newest public `create_v2` mint.
- [ ] **7.5 The mainnet launch lookup table and the first `launch check` — D15, after 7.4.** Owner: F; A records.
  ```
  onepct-ops launch lut   --cluster mainnet --mint <vanity mint public key> --wallet <launch wallet file>
  onepct-ops launch check --cluster mainnet --mint-keypair <vanity mint file> --wallet <launch wallet file> --uri <metadata URI>
  ```
  Expected: the table created, extended, then frozen, its address recorded (M4 §12.1); every `launch check` line GO, or WARN accepted by F in the launch log (M4 §12.3: pump versions against the rehearsal's set, `create_v2_enabled`, the Config keys, phase StockUp and FeeIn, the table, the mainnet simulation, the launch wallet's balance, the rehearsal coin's extensions).
  Abort: a NO-GO line → fix it (funding, table) and re-run; one that cannot be fixed by 16:00 → NO-GO at 8.1.

---

## Step 8. Go / no-go — T−24 h and T−10 min

- [ ] **8.1 T−24 h: Wed 10-28, 16:00.** Owner: A and F run, F decides.
  ```
  onepct-ops gonogo --cluster mainnet --rpc "$MAINNET_RPC" --at t24 --t0 2026-10-29T16:00:00Z --rehearsal-mint <REHEARSAL_MINT> > gonogo-t24.txt      # A
  onepct-ops launch check --cluster mainnet --mint-keypair <vanity mint file> --wallet <launch wallet file> --uri <metadata URI> > launch-check-t24.txt   # F (G11)
  ```
  Expected: every check of M6 brief §10.2 PASS: pump programs equal to the canary rehearsal's set, recorded as the T−24 h baseline (G1); `create_v2_enabled` = 1 (G2); the extension set unchanged (G3); queue health over 10 reads (G4); no feature activation at a boundary in [T0 − 24 h, now] and none pending (G5); our program, Squads, Config, Machine, services and balances (G6–G10); `launch check` without a NO-GO line (G11); the rescue pins (G12); **Gate G6**: the RC audit PASS on the deployed `rc-N`, G6.1–G6.5 and the soak reports (G13).
  A also reads Agave's feature-gate tracker (Appendix R-D) for anything scheduled at the epoch boundaries `gonogo` lists inside T0 ± 24 h (with 200 ms slots an epoch lasts about 24–26 h, so two boundaries fall in that window).
  Manual items: G2 (guardian 2) and A on shift for T0; the step 10 rota staffed; 7.2 ready.
  Decision: F writes "GO for T0" or "NO-GO: new T0 = …" in the launch log and in the guardian group.
  Abort (NO-GO): nothing on chain changes (Stock-Up continues, exits stay open); F announces the new time; every later step moves with it.
- [ ] **8.2 T−10 min: Thu 10-29, start 15:45, decide by 15:50.** Owner: A and F run, F decides.
  ```
  onepct-ops gonogo --cluster mainnet --rpc "$MAINNET_RPC" --at t10 --t0 2026-10-29T16:00:00Z --rehearsal-mint <REHEARSAL_MINT> > gonogo-t10.txt      # A (4 queue reads, about 4 min)
  onepct-ops launch check --cluster mainnet --mint-keypair <vanity mint file> --wallet <launch wallet file> --uri <metadata URI> > launch-check-t10.txt   # F (G11)
  ```
  Expected: all PASS, including `launch check` and its mainnet simulation (G11). **G1 RE-VALIDATE** (pump.fun's programs changed since T−24 h; their upgrades have no time lock and were frequent in October 2026): G2, G3 (on the newest `create_v2` mint) and G11 must pass on the new version, then F decides.
  Abort (hard NO-GO): G2, G3, G5, G6 or G11 failing. Announce a delay; nothing on chain changed.

---

## Step 9. Power-On (T0, 16:00) and On Air (16:15) — Thu 10-29

- [ ] **9.1 15:55.** Owner: F at the operator machine; A on the monitor and the guardian group; G2 on shift. F starts M4's `launch send` with `--at` T0: it re-quotes, rebuilds, signs and simulates, then waits for the chain clock (M4 §12.4).
  ```
  onepct-ops launch send --cluster mainnet --mint-keypair <vanity mint file> --wallet <launch wallet file> --uri <metadata URI> --confirm <first 8 characters of the mint> --at 1793289600
  ```
  Expected: the plan and a passing simulation, then the wait for T0. Abort: a failed simulation → stop, re-run `launch check` (G11), F decides; nothing has been sent.
- [ ] **9.2 16:00:00: the transaction goes out.** Owner: F.
  Expected (`onepct-ops launch` prints each check, M4 acceptance 1–2): one signature (or two for M4's fallback); `Machine.phase` = PoweredOn; `power_on_ts` set; `ledger($1PCT).accounted` = 40,000,000 × 10⁶; the BondingCurve's creator is FeeIn with Mayhem off; the launch wallet holds 0 $1PCT.
  Abort: a failed send → `launch send` re-quotes and resends with a fresh blockhash. Before each resend it reads the mint: if the mint exists and the phase is PoweredOn, it stops with success; if the mint exists and the phase is not PoweredOn, it stops and alerts → A diagnoses with `onepct-ops launch report` (a second `create_v2` cannot land on an existing mint). `create_v2` refused (`CreateV2Disabled`, 6046) → stop, announce a delay. Never retry with another mint.
- [ ] **9.3 The same minute.** Owner: F posts, A checks.
  - `onepct-ops launch report --cluster mainnet` → `reports/launch/mainnet-<UTC>.json`. Publish every address it lists, with `onepct-ops addresses --md`, on the watch channel, the site and X (master §6 rule 6). If M4's two-transaction fallback landed, the launch post says so (master §1: no hidden bundles). The Block-0 board on 1% TV.
  - Buy the DexScreener profile from the ops wallet.
  - Flags: `FLAG_HOLDER_BOOST=on` on `api` (no wallet can qualify before T0 + 24 h); `FLAG_KEEPER_STOCK_LIVE=on` on `keeper-a` and `keeper-b`. The executor and the fee chain run from Power-On (M4).
  - A recomputes the calendar from chain: `on_air_ts`, `end_ts = on_air_ts + 172,800`, the Last Call and Final Pull times, The 1% release times, the seal time; updates §0.3's table in the launch log.
  Expected: the posts live; the flags set; the recomputed calendar in the launch log. Abort: a wrong post → correct it at once; a flag that misbehaves → off.
- [ ] **9.4 16:05–16:10: SW-3 ready.** Owner: F (Railway), A checks. `FLAG_PACKS=on` and `FLAG_SELL_BACK=on` on `api`; `FLAG_BLINKS_RIP=on` on `api` and `FLAG_BOT_ALERTS=on` on `bot` only once M5 Appendix A.1 has passed (otherwise later, when it has). The web shows Rip only once the chain's phase is OnAir (M3 §7.2), so turning the flags on before 16:15 is safe.
  Expected: `/api/config` shows the flags; the Rip panel appears at On Air.
  Rollback: flags off; a guardian may pause RIP or SELLBACK.
- [ ] **9.5 16:14–16:15: On Air.** Owner: the keeper; A watches. At `on_air_ts` the keeper sends one transaction: the fee chain, then `advance_phase` (M4 §11.2), so that collection still uses the before-On-Air split.
  Expected: phase OnAir; the watch channel posts it; editions open as coverage allows (The Original needs 1.5 SOL free in one MAJOR bucket; until then it shows "Refilling"); the first Rips reveal in about a second; settle p95 ≤ 5 s; no critical alert.
  Abort: not done by 16:17 (OPS-12) → F runs `onepct-rescue crank advance-phase … --fee-payer <ops wallet>`.
- [ ] **9.6 First hour.** Owner: A, G2. Watch OPS-01 (queue), OPS-02 (expiries), OPS-04 (settle backlog), INV-* and the stock keeper's buys; F posts updates. Any unexplained critical → playbook P1.
  Expected: no unexplained critical alert. Abort: the playbooks (P1–P6).

---

## Step 10. L0–L3 support rota — Thu 10-29 15:00 to Sun 11-01 23:59

- [ ] **10.1 Shifts** (a guardian awake at every moment; the architect on the monitor at peaks). Expected: every block staffed. Abort: a gap → the other guardian covers and F reassigns.

| UTC | Guardian on duty (acks pages, decides pauses) | Monitor | Support (community) |
|---|---|---|---|
| Thu 15:00–23:00 | G1 (F) with G2 as backup during the launch | A | F, A |
| Thu 23:00–Fri 07:00 | G2 | A until 02:00 | G2 |
| Fri 07:00–15:00 | G1 | A | F |
| Fri 15:00–23:00 | G2 | A | F |
| Sat–Sun | alternate 8 h blocks the same way | A on the critical-alert path | F, G2 |

- [ ] **10.2 Standing rules.** The pinned "Admins never DM first". Never ask anyone for a key, a seed phrase or a screenshot of one. Every answer that involves funds points to the exits: take back, Redeem, the rescue page. Keep ≥ 3 SOL liquid in vault 0 through L3 (PARAMS §17).
  Expected: followed by everyone on shift. Abort: a key or seed shared by mistake → treat it as leaked (P2, P11, P12).
- [ ] **10.3 Daily at 12:30.** Owner: A. The keeper's daily hit-list re-check (12:00, M2 §12.1) passed or its failing bucket was disabled by a guardian; fee payers above the warning; no proposal open except the founder's; GOV-01 to GOV-03 and KEY-05 green in the monitor and on `/status`. Summary to F.
  Expected: a short summary to F. Abort: a failing item → its playbook.

---

## Step 11. Last Call, Buys closed and The Final Pull

Times assume `on_air_ts` = 16:15:00 on 10-29; use the step 9.3 recomputation.

- [ ] **11.1 Last Call - Sat 10-31, 10:15 (`end_ts − 6 h`).** Owner: F (announcement). No on-chain action: a countdown only (PARAMS §14). The keeper's Last Call policy starts by itself (PARAMS §8.3).
  Expected: the post. Abort: none (no on-chain action).
- [ ] **11.2 Buys closed - Sat 10-31, 16:15 (`end_ts`).** Owner: the keeper; A watches; F sets the flags.
  - The keeper collects creator fees in the last minute before `end_ts`, then calls `advance_phase` → BuysClosed (OPS-12 after 16:17: F runs `onepct-rescue crank advance-phase` with the ops wallet).
  - Flags off on `api`: `FLAG_PACKS`, `FLAG_SELL_BACK`, `FLAG_FEED`, `FLAG_BLINKS_RIP`, `FLAG_BLINKS_FEED` (the program refuses them anyway; the UI says the season is over).
  - The keeper sells the buckets to SOL: MAJOR at the 20 s spacing without the gross cap (up to about 150 SOL in 10 min), TRENDING within its caps (PARAMS §8.1).
  - Pending Pulls resolve: their callbacks, or refunds at 300 s.
  - Expected: phase BuysClosed by 16:17; the flags off; MAJOR sells under way. Abort: as the first bullet (OPS-12, the crank).
- [ ] **11.3 The Final Pull - from Sat 10-31, 16:25 (`end_ts + 600`).** Owner: the keeper; A watches.
  - The keeper calls `start_final_pull` once `pending_pulls == 0` → phase FinalPull, `final_ts` set; then pushes `claim_final_sol` for every buyer. Openers claim their tokens on the Final Pull screen or the rescue page.
  - Expected: the watch channel posts it; the Final Pull screen live; claims land.
  - Abort: not started by 16:27 (OPS-12; M4's `final_pull_not_started` follows at 30 min) → F runs `onepct-ops final start` (M4 §12.6; permissionless, the ops wallet signs); with no service running, `onepct-rescue refund --all-due`, then `onepct-rescue crank start-final-pull --fee-payer <ops wallet>`. SOL claims not pushed → `onepct-ops final push`.
- [ ] **11.4 The landing service - T0 + 7 d (Thu 11-05, 16:00).** This historical rollback-retention window is independent of the 2-day season (D37); D19 supersedes the retirement procedure. Owner: F. After checking that no domain is attached to it and that no rollback to it is needed: delete the Railway service `onepercent` (master §5.3). The repository's landing files stay untouched.
  Expected: the service deleted; `onepct-ops sw check --host www.onepercent.fun --expect web` still passes. Abort: any doubt about a rollback → keep the landing service longer.

---

## Step 12. Sealed - from Tue 11-03, 16:25 (`final_ts + 72 h`)

- [ ] **12.1 Propose the seal - Mon 11-02, between 12:00 and 16:00.** Owner: A builds, F proposes, F and M2 or M3 approve.
  ```
  onepct-ops program propose-seal --cluster mainnet --rpc "$MAINNET_RPC"
  curl -s https://verify.osec.io/status/<PROGRAM_ID>
  ```
  The command refuses unless the phase is FinalPull or Done, `pending_pulls == 0`, no other proposal is open, and the verification is in place; it prints the earliest execution time (`final_ts + 259,200`). Approving by Tuesday 04:25 lets it run at the Done time.
  Expected: an approved proposal SetAuthority(ProgramData, vault 0 → None); the watch channel posts it with its release time.
  Abort: a finding before execution → members cancel it in the Squads app; fix through playbook P8; propose again (12 h more).
- [ ] **12.2 Execute - Tue 11-03, from 16:25.** Owner: F (with A on the call).
  Checks first: `Machine.phase` = Done (the keeper's `advance_phase` at `final_ts + 72 h`; OPS-12 → F runs `onepct-rescue crank advance-phase`); `pending_pulls == 0`; no other open proposal; the monitor has no open critical; the OtterSec status is verified with the published hash.
  Then execute the proposal in the Squads app.
  ```
  solana program show <PROGRAM_ID> --url "$MAINNET_RPC"
  onepct-ops program show --cluster mainnet --rpc "$MAINNET_RPC"
  ```
  Expected: `Authority: none`; the hash unchanged; GOV-01 now expects None; the watch channel posts "Sealed."; `/status` and the site show the Sealed trust line.
  Abort: **irreversible once executed.** If any check fails, do not execute: the seal waits (exits are unaffected).

---

## Step 13. After the season

- [ ] **13.1** Owner: F. Services keep running while the founder wants the fee chain (from BuysClosed: 100% team; D27, PARAMS §13.4), the permissionless burn after Done, the close-vault pass, the monitor, `/status` and the rescue page. Exits work with or without them.
  Expected: F knows the services' monthly cost. Abort: stopping them stops nothing users need: exits and the permissionless burn need no service.
- [ ] **13.2** Owner: F. The canary's end (track C, C14–C15).
  Expected and abort: C14–C15.
- [ ] **13.3** Owner: F. Keep every rescue CID pinned on both services for at least 12 months; watch Filebase's monthly egress (M6 brief Appendix A Q4).
  Expected: both services list every released CID. Abort: a lost pin → pin it again by CID from the other service (`pin` script).
- [ ] **13.4** Owner: A. Commit the public launch log to `docs/launch/season-1.md`.
  Expected: the file committed. Abort: none.

---

## Track C. The mainnet canary — D12 to D15, then its own season end

Team-only, tiny amounts, the same binary under the canary program id (M6 brief §9). Railway `staging`; `staging.onepercent.fun` behind basic auth; staging keys distinct from production. The canary's upgrade authority stays the founder's canary deployer key (never Squads, never None); its `Config.admin` is a founder key, so its admin steps take minutes.

- [ ] **C1 Deploy — D12.** Owner: F. As steps 3.2–3.4 with the tag `rc-N-canary`, the canary program keypair and the canary deployer; the hash equals the canary hash of `rc-N.json`.
  Expected: `solana-verify get-program-hash` equals the canary hash. Abort: as 3.2–3.4.
- [ ] **C2 `initialize`.** Owner: F. `onepct-ops init --cluster canary --rpc "$MAINNET_RPC" --params init.canary.json --keypair <canary deployer>` with the canary roles, `admin` = the canary admin key, the queue `Cuj97…`, `launch_wallet` = the canary launch wallet and `token_mint` = the public key of the throwaway coin's mint keypair, generated now (the coin itself is created at C7; `launch check` item 3 compares them).
  Expected: Config decodes; roles, launch wallet and `token_mint` equal the canary's published set. Abort: a failed `initialize` created nothing → fix and retry; a wrong role → the canary admin's `role set` (minutes); a wrong `admin` → close the canary program (C15's command) and deploy again under a new canary id.
- [ ] **C3 Season.** Owner: F. `onepct-ops set-season --cluster canary --rpc "$MAINNET_RPC" --slot <recent slot> --ts <its block time> --stock-up-ts <now + 600> --keypair <canary admin>`; the staging keeper advances to StockUp.
  Expected: phase StockUp after `stock_up_ts`. Abort: the keeper does not advance → `onepct-rescue crank advance-phase --cluster canary --rpc "$MAINNET_RPC" --fee-payer <canary admin>`.
- [ ] **C4 Hit list.** Owner: F. `onepct-ops hitlist add <WIF mint> --class major --cluster canary --keypair <canary admin>` (and BONK), with the report's caps.
  Expected: both buckets listed and enabled. Abort: a refused or stale report → `onepct-ops hitlist check` again, then retry.
- [ ] **C5 Staging stack.** Owner: A. `onepct-ops canary check --rpc "$MAINNET_RPC"` and `onepct-ops sw check --host staging.onepercent.fun --expect web` PASS; the staging monitor green.
  Expected: both PASS tables in the launch log. Abort: a FAIL → fix the staging service; the canary checks wait.
- [ ] **C6 Wallets (the final S5 run) — D13.** Owner: F with Phantom, Solflare and Backpack. Feed 1, 2 and 3 bags and an 8-transaction batch; take back. Record warnings, sizes and approval counts with screenshots. Rip, Redeem and Sell back need a canary pack (pending founder, M6 brief Appendix A Q1): under option A they are checked on devnet.
  Expected: no "may be malicious" warning; sizes and counts as M1 and M3 measured.
  Abort: a warning → step 1 resubmissions with the transaction; A checks M3's simulation path.
- [ ] **C7 Launch rehearsal on the canary — D15, before 12:00** (pending founder Q1, option A). Owner: F. Step 7.4: M4's `onepct-ops launch` commands with `--cluster canary`, a throwaway coin (neutral name, ticker and art; its address published as a test) and the 40M dev buy (≈1.18 SOL).
  Expected: `launch report` passes; the canary's On Air follows 15 min later.
  Abort: as step 7.4.
- [ ] **C8 Fee chain — right after C7.** Owner: the staging keeper; A observes. Expected: its first fee-chain transaction lands `CreatorFeesCollected` with `amount > 0` and the PoweredOn split (all to the stock). Abort: no such collection → NO-GO for Power-On (M4 V8); A investigates the fee chain.
- [ ] **C9 A real swap through the exec pair — D15, after C8.** Owner: the staging keeper; A observes. The keeper buys WIF with the available `stock_sol`, through Jupiter `/build`, with a sponsored or posted Pyth price. Expected: `ExecEnded` with Δ ≥ `min_out`; the slip is reported. Abort: if the keeper's policy will not trade an amount that small, A watches the first mainnet trades after On Air instead (9.6).
- [ ] **C10 Landing values.** Owner: A (reads only). Trades land with `SERVICES.landing.tipLamports`; `maxComputeUnitPriceMicroLamports` is re-checked on the canary's Machine and Pull accounts (PARAMS §26.3); any correction goes to a PR.
  Expected: both values confirmed, or corrected in a PR. Abort: none (reads only).
- [ ] **C11 VRF burst — D13 (pending founder Q1).** Owner: F sends with the architect's burst script; A measures. 300 requests at no more than 2 per second through the architect's S2 probe on mainnet (option A), or through canary Rips if Q1 provides coverage. Expected: no expiry; p95 ≤ 20 s (`vrfLatencyP95AlertSeconds`); the occupancy reader agrees with the queue. Close the probe program afterwards (`solana program close`).
  Abort: an expiry or a p95 above 20 s → A reports it; G4 at step 8 decides.
- [ ] **C12 Monitor drill on mainnet.** Owner: F signs with a canary guardian key; A checks the routes. Pause and unpause RIP; disable and re-enable a role (re-enabling is the canary admin's `role set`); stop and start a staging service. Expected: routes and posts as M6 brief §5.2 says.
  Abort: a missing route or post → a MON fix before Stock-Up; the canary pause is cleared by its guardian.
- [ ] **C13 Rescue.** Owner: F signs; A observes. With the staging `api`, indexer and keepers stopped, every exit the canary's state allows through the rescue page and `onepct-rescue --cluster canary`.
  Expected: every exit the canary's state allows lands; the signatures in the launch log. Abort: an exit that fails → a launch-critical finding for A (M6 brief §6), before step 6.
- [ ] **C14 Season end — after T0.** Owner: the staging keeper; A observes. BuysClosed at the canary's `end_ts`, its Final Pull and Done, on mainnet.
  Expected: the transitions land and the canary's claims work. Abort: a transition overdue → `onepct-rescue crank … --cluster canary` with the canary admin key as fee payer.
- [ ] **C15 Close.** Owner: F, after the canary's Done. Redeem and sell what can be recovered; `solana program close <CANARY_PROGRAM_ID> --url "$MAINNET_RPC" --keypair <canary deployer> --recipient <founder wallet> --bypass-warning`; record the rent recovered.
  Expected: ProgramData closed and the rent back. Abort: none needed (the program can stay).

---

## Playbooks

Each playbook starts the same way: the guardian on duty acks the page, posts "investigating" in the guardian group, and keeps the launch log. Exits keep working in every case below.

### P1. A critical invariant alert (INV-*)
1. Guardian: pause the five bits.
   ```
   onepct-ops guardian pause --bits RIP,FEED,SELLBACK,STOCKBUY,BURN --cluster mainnet --rpc "$MAINNET_RPC" --keypair <guardian file>
   ```
2. Page F and A. A reproduces the finding from the monitor's evidence (slot, accounts) with `soak_check` on a dump of the program's accounts.
3. If it is a program bug: P8. If it is a monitor bug: A fixes the check; the guardian unpauses (`… guardian unpause --bits …`).
4. F posts a short notice: exits work; what is paused; next update time.

### P2. A key misuse alert (KEY-*) or a leaked hot key
1. Guardian: `onepct-ops guardian disable-role keeper|executor|intake-signer|quote-signer --cluster mainnet --rpc "$MAINNET_RPC" --keypair <guardian file>`. It takes effect at the role's next instruction.
2. F: a new key (step 0.1.3) in the Railway service; A: `onepct-ops role set <role> <new public key> --cluster mainnet` → Squads proposal (12 h; §0.5). Executing it re-enables the role.
3. A: the damage is bounded on chain (M2 §6.7): report what the key did from `exec_trades`, `executor_trades`, `sell_backs` or `hold_log`.

### P3. VRF expiries above 1 per 1,000 Rips, or clustered (OPS-02)
1. The guardian decides whether to pause RIP; nothing pauses by itself (PARAMS §15). Refunds run anyway (the keeper, or `onepct-rescue refund --all-due`).
2. A checks the queue (OPS-01), MagicBlock's program (GOV-05) and the latency (OPS-03). There is one listed queue (D6): no switch is possible.
3. Unpause when the expiry rate is back under the threshold for 30 min.

### P4. The queue is busy (OPS-01)
Nothing to do on chain: the web shows "Machine busy" above 80% occupancy. F posts a notice if it lasts more than 15 min.

### P5. No keeper leader (OPS-05)
1. A: Railway shows both keeper services; restart them; if the last deploy is the cause, roll it back (P9).
2. Meanwhile F keeps exits flowing with the ops wallet as `--fee-payer`: `onepct-rescue settle --all-open`, `refund --all-due` and `crank advance-phase` (all permissionless: any user can run them too).

### P6. API or indexer down (OPS-06, OPS-07)
1. F posts the rescue page link (the CID) and `/status`.
2. A restarts the service or rolls it back (P9); after an indexer outage, `pnpm --filter worker indexer:replay --from-slot <last finalized slot>`.

### P7. pump.fun or PumpSwap changed (GOV-05)
Before T0: step 8's G1 re-validation, and `launch check` item 1's WARN, on which F decides whether to re-run the canary rehearsal (M4 §12.3). After T0: A checks the executor's and the keeper's fee-chain transactions against the new interface; failing tranches cost only fees; a guardian may pause BURN until they are patched. A program upgrade is needed only if on-chain parsing changed (P8).

### P8. A timelocked fix (program upgrade)
1. A: the fix as `rc-<N+1>` through the normal audit; `fixtures/rc/rc-<N+1>.json`; the verified build reproduced (M6 brief §7.5).
2. F: build and write the buffer (3.2, 3.3), then `solana program set-buffer-authority <BUFFER> --new-buffer-authority <VAULT_0> --url "$MAINNET_RPC" --keypair <deployer of the buffer>`; if the `.so` grew, `solana program extend <PROGRAM_ID> <bytes>`.
3. A: `onepct-ops program buffer-check --buffer <BUFFER> --expect <new hash>`, then `onepct-ops program propose-upgrade --buffer <BUFFER> --expect <new hash>`; F imports it (§0.5), or uses the app's program page with the same buffer and spill = vault 0.
4. Two approvals; the watch channel posts the hash and the release time (12 h); F announces that exits stay open.
5. After 12 h: execute; `onepct-ops program show` shows the new hash; re-export and re-submit the verification PDA (`solana-verify export-pda-tx …` as step 5.1, then `remote submit-job`).

### P9. Roll back a bad service deploy on Railway
1. A identifies the service and the last good deployment (`railway deployment list -s <service> -e production --json`).
2. F: Railway → the service → Deployments → ⋮ on the last good deployment → **Rollback**. Railway restores that deployment's image and its variables without a rebuild, in seconds; it is available for a superseded deployment for 72 h on Hobby and 120 h on Pro. Past that window: **Redeploy** of that deployment (a rebuild from its source, minutes). Never `railway down`: it deletes the latest deployment, it does not roll back.
3. Re-apply any variable changed since that deployment (a rollback reverts the service's variables, `FLAG_*` included), then check `/health`, the monitor's `/ready` probes and `/api/status`.
4. Migrations are forward-only and each one stays compatible with the previous release (M2 §11.2), so the older image runs on the current schema; if it does not, stop and call A.
5. Scripted alternative (untested, dashboard first): `railway api 'mutation($id: String!){deploymentRollback(id:$id){id status}}' --var id=<deployment id>`.

### P10. The domain or DNS fails
F posts the rescue CID and its URLs (`RESCUE_URLS_JSON`, none of them on our domain); A checks Cloudflare and Railway; if the app itself is the cause, the switch-over rollback of step 2.

### P11. A guardian key is compromised
The other guardian clears any pause it set (`… guardian unpause …`; a guardian can never clear an admin pause). A: `onepct-ops role set guardian<0|1> <new key>` through Squads (12 h). Exits were never at risk: a guardian cannot touch them.

### P12. A Squads member key is compromised
The other two members never approve anything they did not create. A replacement through a configuration proposal (`RemoveMember`, `AddMember`; 12 h), executed only when no other proposal waits for approval (§0.5).

### P13. A fee payer runs low (OPS-17)
F tops up the keeper or executor fee payer from the ops wallet (published), and records it.

### P14. FeeIn is no longer the coin's creator (GOV-06, `fee_in_creator_changed`): a P0 incident
pump.fun's admin can reassign a coin's creator, and nothing on chain can stop it (M4 §11.2). Creator fees then stop reaching the Machine. No user's funds are at risk; packs and every exit keep working.
1. Guardian on duty: page F and A at once, whatever the hour.
2. A: confirm from chain (the curve's `creator`, the pool's `coin_creator`, a sharing config) with the slot and the transaction that changed it.
3. F: a factual post on the watch channel and X (what changed and when; exits and packs are unaffected; the stock now grows from packs only); contact pump.fun's support with the evidence.
4. Nothing to pause for this alone; the keeper keeps collecting whatever still reaches FeeIn.

---

## Appendix R-A. Addresses (filled at steps 0, 3 and 9; published at Power-On)

| Item | Mainnet | Canary | Source |
|---|---|---|---|
| Program id / ProgramData | | | 0.1.1; step 3 |
| Upgrade authority | Squads vault 0 → None at step 12 | canary deployer (kept) | step 4 |
| Config, Machine, Deck, `vault_auth`, FeeIn | | | `onepct-ops addresses` |
| Protocol lookup table (frozen) | | — | 3.7 |
| Squads multisig; vault 0 (admin); team vault | | — | 0.1.4 |
| Members 1–3 | | — | 0.1.4 |
| Guardians 1–2 | | | 0.1.2 |
| Keeper, executor, intake signer, quote signer | | | 0.1.3 |
| Launch wallet, ops wallet | | | 0.1.2 |
| `token_mint` ($1PCT, vanity) | | throwaway coin | 0.1.1; C7 |
| Vault ATAs of the five MAJOR buckets and of $1PCT | | | step 5; step 9 |
| VRF queue | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` | same | PARAMS §21 |
| Verified hash (`rc-N`) | | | `fixtures/rc/rc-N.json` |
| Rescue CID and gateway URLs | | | M6 brief §6.7 |

## Appendix R-B. Railway variables (production; staging mirrors it with the canary's values)

Every service on M2's runtime (`api`, `intake-signer`, `quote-signer`, `indexer`, `keeper-a`, `keeper-b`, `executor`, `monitor`): `CLUSTER=mainnet-beta`, `PROGRAM_ID`, `APP_VERSION`, `GIT_COMMIT`, `LOG_LEVEL=info`, `ROLE`, `DATABASE_URL` and `REDIS_URL` (references to the Postgres and Redis services), its own `RPC_URL`, `LOG_IP_SALT`, **`PRIVATE_HOST=::`**, `PRIVATE_PORT`. `web` and `bot` take only their own rows. Never a `*_KEYPAIR` outside its role (the service refuses to boot), never a name ending in `SECRET_KEY` or `PRIVATE_KEY` (D13).

| Service | Its own variables |
|---|---|
| `web` | `API_UPSTREAM` (the `api` service's private address, M3 §15.4), `PORT`, `WEB_MODE` (`landing-proxy` until SW-1, then `app`), `LANDING_UPSTREAM` (the landing service's private address and port, e.g. `http://onepercent.railway.internal:<its PORT>`); build-time `VITE_API_URL`, `VITE_TURNSTILE_SITE_KEY`, `VITE_CLUSTER=mainnet`, `VITE_RESCUE_URL` |
| `api` (`ROLE=public`) | `PORT`, `WEB_ORIGIN=https://onepercent.fun`, `TURNSTILE_SECRET`, the X-ray Helius settings, `JUPITER_API_KEY` (org 1), `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `BOT_API_SECRET`, the two signers' internal URLs and tokens (names per M2), `PROTOCOL_LUT_ADDRESS`, `ADMIN_MULTISIG_ADDRESS`, `RESCUE_CID`, `RESCUE_URLS_JSON`, the `FLAG_*` of the web (below) |
| `intake-signer` | `INTAKE_SIGNER_KEYPAIR`, `INTERNAL_TOKEN`, its Helius key (Developer plan or higher) |
| `quote-signer` | `QUOTE_SIGNER_KEYPAIR`, `INTERNAL_TOKEN`, its own Jupiter key |
| `indexer` | `INDEXER_RPC_URL_FALLBACK` (Triton) |
| `keeper-a`, `keeper-b` | `KEEPER_KEYPAIR` (the same key), the keeper's Jupiter key (org 2), the Hermes key, `FLAG_KEEPER_STOCK_LIVE` |
| `executor` | `EXECUTOR_KEYPAIR`, `EXECUTOR_SWAP=jupiter` (M4 §11.1; the test-transfer adapter is refused on mainnet), its own Jupiter key from the keeper's organisation (M4-A10) |
| `monitor` | `MONITOR_RPC_URL_FALLBACK`, `SCRAPE_TARGETS_JSON`, `EXPECTED_ADDRESSES_JSON`, `TELEGRAM_OPS_BOT_TOKEN`, `OPS_GUARDIAN_CHAT_IDS_JSON`, `OPS_GUARDIAN_USER_IDS_JSON`, `OPS_GROUP_CHAT_ID`, `WATCH_CHANNEL_ID`, optional `PAGER_WEBHOOK_URL` and `PAGER_WEBHOOK_TOKEN`; no key |
| `bot` | `TELEGRAM_BOT_TOKEN`, `LOG_LEVEL=info`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `BOT_API_SECRET`, `DATABASE_URL`, **`PRIVATE_HOST=::`**, `PRIVATE_PORT`, `FLAG_BOT_ALERTS` (M5 §12) |

Pre-deploy command of every `api` and `worker` service: `node node_modules/@onepercent/db/dist/migrate-cli.js`.

| Flag (`FLAG_<NAME>=on\|off`) | Set on | Production: on at |
|---|---|---|
| `XRAY`, `TV_LIVE`, `BLINKS_XRAY` | `api` | SW-1 (step 2.3) |
| `FEED` | `api` | SW-2 (step 6.3) |
| `BLINKS_FEED` | `api` | after G5.2 (6.3 or 7.0; M5-A13) |
| `HOLDER_BOOST` | `api` | Power-On (9.3) |
| `PACKS`, `SELL_BACK` | `api` | SW-3 (9.4) |
| `BLINKS_RIP` | `api` | SW-3 (9.4), once M5 Appendix A.1 has passed |
| `BOT_ALERTS` | `bot` | On Air (9.4), once M5 Appendix A.1 has passed |
| `KEEPER_STOCK_LIVE` | `keeper-a`, `keeper-b` | Power-On (9.3) |
| `BOARDS`, `SOUND` | `api` | the founder's call |
| `SPOTLIGHT`, `CROSSCHAIN*`, `ZK_REDEEM` | — | off (D1; M7) |

Exits are never behind a flag (master §11.5).

## Appendix R-C. Command reference

- `onepct-ops` and `onepct-rescue` are the `packages/cli` binaries: `pnpm --filter @onepercent/cli exec onepct-ops …` from `app/`, or the built binaries on `PATH`. Their commands: M2 §11.10 and M6 brief §6.4, §10.1.
- Solana CLI (Agave 4.3): `program write-buffer`, `program deploy --buffer`, `program show`, `program set-buffer-authority`, `program set-upgrade-authority … --skip-new-upgrade-authority-signer-check` (a PDA cannot sign the checked variant), `program extend`, `program close`, `feature status --display-all --output json`.
- `solana-verify` 0.5.2: `build --library-name onepercent --base-image <digest> --arch v3`, `get-executable-hash`, `get-buffer-hash`, `get-program-hash`, `export-pda-tx … --uploader <VAULT_0> --encoding base58 --compute-unit-price 0`, `get-program-pda`, `remote submit-job`.
- Squads CLI fallback: `squads-multisig-cli proposal-vote | vault-transaction-execute | config-transaction-create | config-transaction-execute … --keypair usb://ledger --rpc-url <RPC>`; config actions are written `"SetTimeLock 43200"`, `"AddMember <PK> <perm>"`, `"RemoveMember <PK>"`, `"ChangeThreshold <N>"`.

## Appendix R-D. Sources

Read on 2026-10-08 and 2026-10-09. The facts the runbook shares with the M6 brief (`solana-verify`, OtterSec, the Squads v4 program, the Solana CLI, pump.fun, feature gates, IPFS) are sourced in the brief's Appendix C.1; its Appendix C.2 lists what is re-checked at M6 start.

| Steps | Fact | Source |
|---|---|---|
| 0.5, 4, 5, 12, P8, P12 | The Squads app: Transaction Builder imports base58 transactions; program upgrades with the vault as buffer authority; time locks; members sign through Phantom or Solflare with a Ledger; `squads-multisig-cli` with `usb://ledger`; v4 immutable since November 2024 | docs.squads.so: `navigating-your-squad/developers-assets/transaction-builder`, `…/developers-assets/programs`, `…/settings/time-locks`, `getting-started/create-a-squad`, `development/cli/installation`, `security/how-secure-is-squads`, `additional-resources/advanced-security-best-practices`; crates.io `squads-multisig-cli` 0.1.7 (source on docs.rs); github.com/Squads-Protocol/v4 |
| 0.1.4 | The multisig account layout (discriminator, `create_key`, `config_authority`, `threshold` u16, `time_lock` u32) | github.com/Squads-Protocol/v4, `programs/squads_multisig_program/src/state/multisig.rs` |
| 1 | Phantom: new-domain notices, the review form, single signer and simulation with `sigVerify: false` | docs.phantom.com/developer-powertools/domain-and-transaction-warnings |
| 1 | Blockaid: support portal for false positives and project verification | report.blockaid.io; blockaid.io/contact |
| 2, P9 | Rollback restores the image and the variables without a rebuild; retention after a deployment is superseded: 24 h (Free, Trial), 72 h (Hobby), 120 h (Pro), 360 h (Enterprise); Redeploy rebuilds; `railway down` deletes the latest deployment; the `deploymentRollback` mutation; no `railway rollback` command (CLI v5.64.1) | docs.railway.com: `/deployments/deployment-actions`, `/guides/roll-back-bad-deploy`, `/pricing/plans`, `/cli/redeploy`, `/cli/down`, `/cli/deployment`, `/cli/api`, `/integrations/api/manage-deployments`; github.com/railwayapp/cli/releases |
| 2 | No domain move: remove, then add; a new verification token per service (`_railway-verify.<label>`); 404 "Application not found" with `x-railway-fallback` while unattached; certificates within an hour, retried for 72 h; behind Cloudflare, SSL mode Full (not Full (strict), not Flexible); 2 custom domains per service on Hobby, 20 on Pro | docs.railway.com: `/networking/domains/working-with-domains`, `/networking/public-networking/specs-and-limits`, `/networking/troubleshooting/ssl`, `/integrations/api/manage-domains`; station.railway.com/questions: `custom-domains-never-bind-to-migrated-se-dfee84a8` (2026-07-19), `migrate-custom-domain-from-a-service-to-c35d5b86` (2025-01-26, Railway staff), `old-custom-domain-showing-not-available-a0f509a7` (2025-10-30, Railway staff), `custom-domain-stuck-at-validating-owners-8c4ec25c` (2026-08-18), `how-to-assign-a-custom-domain-to-differe-2defb3a1` (2026-03-13), `cloudflare-for-saa-s-custom-hostnames-r-2c2dbbaf` (2026-06-08) |
| 2.1 item 6 | Open report: a proxied first-level subdomain (`www`) answers 404 at Railway's edge while the apex works (April 2026, no staff answer) | station.railway.com/questions/fastly-returns-x-railway-fallback-for-cl-cf9a7b39 |
| 2.0 | Cloudflare: the apex → www redirect rule; CNAME flattening at the apex; Host override only on Enterprise | developers.cloudflare.com: `/rules/url-forwarding/examples/redirect-root-to-www/`, `/dns/cname-flattening/set-up-cname-flattening/`, `/rules/origin-rules/` |
| 2 | Let's Encrypt: 5 certificates per exact set of hostnames per 7 days, one reason not to re-attach domains repeatedly | letsencrypt.org/docs/rate-limits/ |
| 0.3 | Trigger branch per environment; disabling automatic deploys; "Deploy Latest Commit"; Wait for CI (a deployment waits, and is skipped after 2 h); Watch Paths match from `/` even with a Root Directory; `RAILWAY_DOCKERFILE_PATH` | docs.railway.com: `/deployments/github-autodeploys`, `/builds/build-configuration`, `/environments`, `/deployments/monorepo`, `/builds/dockerfiles`; station.railway.com/feedback/deploy-specific-commit-1ed91a63 |
| 0.3 | Config as code deprecated; its files are not read after 2026-12-01 | docs.railway.com: `/config-as-code`, `/infrastructure-as-code`; railway.com/changelog/2026-08-20-railway-anon |
| 0.3 | Health checks (any 2xx; Host `healthcheck.railway.app`; 300 s default timeout); `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | docs.railway.com: `/deployments/healthchecks`, `/deployments/deployment-teardown`, `/variables/reference` |
| 0.3, R-B | Private networking: `<service>.railway.internal` over `http://`, at run time only, one network per environment; listeners on `::` (`PRIVATE_HOST=::`) | docs.railway.com: `/networking/private-networking`, `/networking/private-networking/how-it-works`; the S0 audit (PR #10) |
| 3, 5, P8 | Deploying from a buffer, authorities, extend, close; verified builds and the Squads flow for the verification PDA | solana.com/docs/programs/deploying; solana.com/docs/programs/verified-builds; github.com/solana-foundation/solana-verifiable-build (v0.5.2); github.com/solana-developers/verify-squads; verify.osec.io |
| 7.4, 7.5, 8, 9 | pump.fun's Global and `create_v2_enabled`; the `create_v2` mint's extensions; the launch commands and their checks | github.com/pump-fun/pump-public-docs; `04-M4-BRIEF.md` §4.2, §12 and Appendix A |
| 8 | Solana feature activations: Agave's live schedule and release notes | github.com/anza-xyz/agave/wiki/Feature-Gate-Tracker-Schedule; github.com/anza-xyz/agave/blob/master/CHANGELOG.md |
| 0.2.4 | UptimeRobot's free plan: keyword monitors at 5-minute intervals (its commercial-use terms: verify at M6 start, brief C.2 V8) | uptimerobot.com/pricing |
| 2.5 | Dialect's registry of Actions | registry.dial.to/v1/list; `05-M5-BRIEF.md` Appendix A.2 |
| 0.2.2, 1.4, 6.1, 13.3 | IPFS pinning services, CAR uploads and public gateways | M6 brief §6.7 and Appendix C |
