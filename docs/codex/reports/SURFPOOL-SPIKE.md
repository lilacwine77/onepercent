# Surfpool 1.0.0 spike

Date: 2026-10-10. Branch supplied by the architect: `test/surfpool-spike`.

## Recommendation

**Reject Surfpool 1.0.0 as a replacement for our current e2e validator.** Keep
`solana-test-validator` and LiteSVM as the existing gates. Surfpool is useful for
isolated fork experiments, but the full requested journey did not pass.

Two independently reproduced incompatibilities prevent replacement:

1. The current localnet **sBPFv3** artifact fails the real upgradeable-loader
   deployment with `Failed to parse ELF file: invalid file header`. Enabling
   sBPFv3, or all SVM features, does not fix this.
2. An isolated **sBPFv2** compilation reaches the real launch, P1 Jupiter stock
   purchases and fee collection, then Feed fails at its Ed25519 precompile with
   `Unsupported program id`. A standalone valid Ed25519 instruction fails both
   with default features and with `--features-all`.

Do not treat the sBPFv2 run as validation of the shipped sBPFv3 artifact. Do not
replace the signature precompile with a permissive program to make tests green.
There are no changes to the production program, SDK, economic constants, launch
authorization checks, dependency pins, existing e2e runners or CI configuration.
No Git commands were used and no mainnet transaction was submitted.

## Reproduction

From `app/`, with the workspace pin `pnpm@10.34.5`:

```sh
CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2 ONEPERCENT_CLUSTER=localnet pnpm program:build
pnpm e2e:surfpool --report /tmp/surfpool-canonical-three.json
```

The runner defaults to three cold passes. It writes public evidence to the OS
temporary directory (or the explicit `--report` path),
returns nonzero when the journey fails, and does not convert a known failure into
a passing test. `--passes 1`, `--probes-only` and `--flow-only` support diagnosis.
`SURFPOOL_BINARY` can locate the installed binary on another machine; the runner
requires its version to be exactly 1.0.0.

An optional alternate artifact may be supplied as `SURFPOOL_PROGRAM`. This is a
diagnostic override, not a change to the canonical build. To reproduce the v2
experiment without copying `target/`:

```sh
scratch="$(mktemp -d /tmp/onepercent-surfpool-v2-XXXXXX)"
ln -s "$PWD/target" "$scratch/target"
CARGO_BUILD_JOBS=3 ONEPERCENT_CLUSTER=localnet CARGO_TARGET_DIR="$scratch/target" \
  pnpm exec cargo build-sbf --manifest-path programs/onepercent/Cargo.toml \
  --sbf-out-dir "$scratch/deploy" --arch v2
SURFPOOL_PROGRAM="$scratch/deploy/onepercent.so" \
  pnpm e2e:surfpool --flow-only --report /tmp/surfpool-v2-three.json
rm -rf "$scratch"
```

No dependency was added. The canonical `target/deploy/onepercent.so` remains v3.
Large build outputs are shared through a temporary symlink; snapshots, SQLite
files and surfnet logs live in temporary directories removed by the runner.

## Safety and actual fork boundary

The runner reads `HELIUS_*` configuration from the founder-specified `.env.local`
(or `SURFPOOL_ENV_FILE` / environment). It uses public mainnet RPC only when no
Helius endpoint or key is available. The credential and remote URL stay in the
parent process; neither is passed to Surfpool arguments, child environment,
stdout or the evidence report.

Surfpool receives a runner-owned loopback proxy. This proxy forwards only an
explicit allowlist of read RPC methods, never transactions, simulations or
cheatcodes. The runner tests that `sendTransaction` receives HTTP 403 before
starting the passes. Helius is used for real upstream reads, with a verified
mainnet genesis. All transaction connections point to the newly spawned local
surfnet, and all signers are disposable. The devnet wallet is never opened.

Surfpool normally reports the upstream mainnet genesis. The production launch
runtime correctly rejects that identity for `localnet`. The proxy therefore
supplies a fresh local genesis identifier to **the local fork only**, after
checking the true upstream genesis. Production launch checks stay intact.

External accounts and programs are fetched lazily. This is a fork backed by
current reads, **not an atomic snapshot of mainnet at one slot**. The runner
checks real pump origin for its dust mint and the launch tool verifies Meteora
program hashes and immutable DBC settings. It does not substitute local Meteora
or Jupiter binaries for mainnet programs.

## Journey evidence

| Requested step                               | Current v3 artifact             | Isolated v2 diagnosis                                                        |
| -------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| Deploy our localnet program                  | FAIL: loader rejects ELF header | PASS: actual loader upgrade transaction                                      |
| Initialize Config, Machine and Deck          | Blocked by deployment           | PASS: signed `initialize`, season configuration and StockUp transition       |
| DBC config and launch tooling                | Blocked                         | PASS: real `executeLaunch` runtime, immutable config, frozen LUT, plan, send |
| `power_on`                                   | Blocked                         | PASS: part of the atomic launch; decoded Machine confirms timestamp and mint |
| Feed real pump dust                          | Blocked                         | ATTEMPTED, FAIL: native Ed25519 instruction unsupported                      |
| Rip / oracle callback                        | Blocked                         | Not reached after Feed failure                                               |
| Settle / Redeem                              | Blocked                         | Not reached                                                                  |
| Sell / Feed back (P2)                        | Blocked                         | Not reached                                                                  |
| P1 MAJOR StockBuy with Pyth                  | Blocked                         | PASS: real Jupiter instructions, refreshed forked Pyth timestamps            |
| P1 TRENDING StockBuy                         | Blocked                         | PASS: real Jupiter instructions and PumpSwap reserves                        |
| `claim_launch_fees` / `collect_creator_fees` | Blocked                         | PASS: signed transaction against the real DBC pool                           |

The card-cycle code after Feed is an unvalidated continuation, not evidence that
VRF, settle, Redeem or P2 work in this version. Complete journey stability is
**0/3**, not three successful e2e runs.

The dust probe uses FARTCOIN mint
`9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump`, 1,000 base units per disposable
wallet. Its existing bonding-curve PDA and owner are read from the fork. Token
balances are assigned locally with `surfnet_setTokenAccount`; no token purchase
or transfer occurs on mainnet. Intake attestations are genuinely signed locally,
but service-side eligibility/indexer checks are outside this runner.

For stock coverage, the runner funds FeeIn locally and invokes the real collection
instruction, then buys WIF as MAJOR and
`ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump` as the sampled TRENDING mint.
The latter is discovered from the existing captured pool fixture and its actual
pool is re-read on the fork. Amounts are bounded by config: 5 SOL for MAJOR and
`STOCK.trendingTrancheMaxLamports / 1000`, 0.0015 SOL, for TRENDING. These are local
test trades, not a production listing or economic parameter change.

Each Jupiter route executes between `exec_begin` and `exec_end`; the runner
asserts increased inventory and a cleared exec record. WIF requires Pyth token
and SOL prices. **TRENDING uses PumpSwap reserves, not Pyth**, as specified by P1.
Pyth price, confidence, exponent, feed id and owner are retained; only publish
timestamps are refreshed by local account mutation. This tests the consumer
path, not Pyth publisher authentication or oracle delivery.

The launch fee test observes a 25,885,844-lamport stock increase. This consists of
23,846,564 lamports of DBC partner fees plus 2,039,280 lamports returned when the
payer-funded wSOL ATA is closed. The stock delta must not be called trading fees
alone. Subsequent stock setup separately supplies simulated liquidity to FeeIn.

## Verified capabilities and limitations

| Capability                                           | Observed result                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--ci`, loopback RPC, mainnet datasource             | Works; binary version 1.0.0, RPC API 3.1.6                                                        |
| `--slot-time 100`                                    | Used throughout; slot production observed                                                         |
| `requestAirdrop`                                     | Balance mutation verified                                                                         |
| `surfnet_setAccount`                                 | Data/owner/lamport mutation and readback verified                                                 |
| `surfnet_setTokenAccount`                            | Real mint ATA credited; exact base-unit balance verified                                          |
| `surfnet_timeTravel`                                 | Clock advanced by 3,600 seconds                                                                   |
| Pause/resume clock                                   | Slots stop, then resume                                                                           |
| Snapshot export and `--snapshot` import              | Balance survives a new process; 27 accounts in each probe                                         |
| `--db` SQLite                                        | Balance survives stop and reopen of a different process                                           |
| `--skip-signature-verification`                      | CLI rejects the argument as unknown                                                               |
| Invalid transaction signature, `skipPreflight: true` | No balance mutation or landed signature observed; a properly signed control transfer succeeds     |
| Valid Ed25519 precompile                             | Unsupported with defaults and all SVM features                                                    |
| `surfnet_writeProgram` alone                         | Not sufficient: account bytes match the new ELF, but execution can retain the placeholder program |
| Explicit loader upgrade                              | Correctly installs v2 and rejects v3; authoritative deployment test                               |

Important implementation details discovered by trying the capabilities:

- Surfpool's `surfnet_writeProgram` initializes a small placeholder executable.
  Replacing ProgramData alone can leave that executable cached. A transaction can
  return success and log `Hello from my program!` while creating no Onepercent
  state. The runner follows the write with an actual loader upgrade and checks
  application state. It does not accept transaction status alone as proof.
- Preserve raw upstream JSON bytes. Parsing and reserializing `u64::MAX`
  `rentEpoch` through JavaScript numbers changes the integer and breaks Surfpool
  decoding. For exported probe snapshots, only deprecated rent metadata is
  normalized to zero before serialization; data, owners and balances are retained.
- Time travel around lookup tables produced both `invalid index` and
  `not a recent slot`. The runner uses an actual bounded wait for the configured
  inter-trade spacing and creates/freezes tables without a jump across their
  activation. The simple Clock test is not proof of complete bank-history replay.
- A signature-verification flag cannot be inferred from documentation for another
  release. The planned VRF workaround uses unsigned VM simulation followed by
  persisting returned writable accounts with a cheatcode. That continuation has
  not been reached and is not counted as a successful oracle callback.

The version-tagged source explains the observed boundaries: Surfpool 1.0.0 uses
LiteSVM 0.9.1 and Solana loader 3.1.6 / solana-sbpf 0.13.1. That ELF parser applies
its older strict v3 header format; our artifact has `e_flags=3`, `e_machine=247`.
LiteSVM's Ed25519 support is a compile-time `precompiles` feature; the Surfpool
workspace enables `nodejs-internal`, not that feature. An SVM activation flag
cannot add code absent from the build.

Sources consulted, then checked against the installed binary and experiments:
[CLI reference](https://solana.com/docs/tools/surfpool/toolchain/cli),
[cheatcode reference](https://docs.surfpool.run/rpc/cheatcodes),
[Surfpool v1.0.0 dependencies](https://github.com/solana-foundation/surfpool/blob/v1.0.0/Cargo.toml),
[version lock](https://github.com/solana-foundation/surfpool/blob/v1.0.0/Cargo.lock),
[writeProgram implementation](https://github.com/solana-foundation/surfpool/blob/v1.0.0/crates/core/src/surfnet/locker.rs),
[old ELF parser](https://github.com/anza-xyz/sbpf/blob/v0.13.1/src/elf.rs),
[LiteSVM precompile feature](https://github.com/LiteSVM/litesvm/blob/v0.9.1/crates/litesvm/Cargo.toml).

## Measurements

All measurements are local wall-clock observations on the supplied macOS machine,
with `CARGO_BUILD_JOBS=3`, `VITEST_MAX_WORKERS=2` and one heavy check at a time.
Program checks ran alongside lightweight RPC experiments; these are not isolated
CI benchmarks. No upstream HTTP 429 or RPC error was observed in the measured
passes. The proxy counts real upstream HTTP requests, response bytes and method
calls, including missing-account reads.

Canonical v3, three cold passes including independent capability probes:

| Pass | Surfnet startup | Deployment attempt, including shutdown | Total with probes | Upstream requests |
| ---- | --------------- | -------------------------------------- | ----------------- | ----------------- |
| 1    | 214 ms          | 3,805 ms                               | 10,179 ms         | 15                |
| 2    | 223 ms          | 3,863 ms                               | 10,365 ms         | 15                |
| 3    | 343 ms          | 4,024 ms                               | 12,171 ms         | 15                |

All three reject the same ELF. Each probe series additionally starts separate
surfnets for all-feature Ed25519, snapshot import and persistent DB reopen.
The initial upstream-genesis verification is one extra request per runner.

Isolated v2, three cold partial journeys, without repeating the capability probes:

| Pass | Surfnet startup | Journey through the Feed failure | Upstream requests | Response bytes |
| ---- | --------------- | -------------------------------- | ----------------- | -------------- |
| 1    | 332 ms          | 48,109 ms                        | 64                | 2,647,101      |
| 2    | 213 ms          | 47,565 ms                        | 64                | 2,647,101      |
| 3    | 211 ms          | 51,187 ms                        | 64                | 2,647,093      |

Each pass completes initialize, DBC config, launch, power_on, both Jupiter stock
buys and fee collection, then fails on the same Feed precompile. Total measured
partial-flow time is 146.9 seconds, approximately 2.45 local minutes. Across these
three flows there are 192 upstream requests, plus one genesis check. Each pass
uses 1 `getEpochInfo`, 32 `getAccountInfo`, 29 `getMultipleAccounts` and 2
`getTransaction` calls. There are no observed upstream errors or rate limits.
The two Jupiter build calls per flow are additional HTTP provider traffic,
not Solana RPC requests counted by this proxy.

The WIF buys return 2,529,267,319 / 2,529,313,807 / 2,529,350,539 base units for
5,000,000,000 lamports. The sampled TRENDING buy returns 53,964,985,196 base units
for 1,500,000 lamports on all three passes. Routes and amounts are observed
current results, not fixed fixtures. Both atomic stock transactions fit in one
packet (541 and 546 bytes in these runs).

Artifact SHA-256:

- Canonical v3: `d5204f9d8df27db85bfcdb9e062e1dfdf6f27d8e9138113a959717d182821e71`.
- Diagnostic v2: `34fa4ded89624b5cc82766477fbe2bfdb1ee8e6597771fab1dacc66c24935150`.

Raw public evidence was written to `/tmp/surfpool-canonical-three.json` and
`/tmp/surfpool-v2-three.json`; the tables here retain the material results without
committing transient chain captures.

## Migration and CI effort

Do not replace an existing CI gate with this spike. It intentionally exits 1 on
the reproduced incompatibilities. A separately approved runtime version/build
must first pass the unchanged v3 artifact and native signature verification.
No new Surfpool version or dependency was installed during this task.

Engineering estimate, conditional on those runtime fixes:

- 0.5 to 1 day to pin and verify a compatible Surfpool build on macOS and Linux,
  including its native precompiles and the actual v3 deployment.
- 1 to 2 days to migrate fixture loading to cheatcodes/snapshots, replace the
  validator lifecycle adapter, validate all previously unreachable card paths,
  and resolve time-travel/lookup-table behavior. Preserve offline deterministic
  validator tests; fork reads are inherently dependent on live external state.
- 0.5 day for a separate opt-in or scheduled GitHub Actions job, secret wiring,
  cache limits, evidence upload and three-pass stability checks. Total estimate:
  **2 to 3.5 engineer-days**, excluding upstream runtime fixes.

Use a restricted `HELIUS_RPC_URL` (or `HELIUS_API_KEY`) GitHub secret, passed only
to the runner. The existing Jupiter route client also requires the configured
`JUPITER_API_KEY` for authenticated API access. Never expose these secrets to
untrusted fork PR jobs. Default public RPC is a fallback, not a reliable CI budget.

Measured runtime cost is about 0.55 local minutes for the three canonical failure
probes. The v2 partial-flow measurement below is the better lower bound for a
future full-flow job. Allow **5 to 10 additional CI minutes** initially for three
successful full journeys plus startup/cleanup; this is a planning allowance,
not a measured Linux result. Dependency installation and cold SBF/Rust builds
are separate and can dominate that budget. Retain the existing build cache and
one canonical `target/`; do not persist fork DBs as large artifacts.

Rate-limit risk is concentrated in cold program/account fetches and missing
accounts, not just transactions. Three clean passes are too small a sample to
establish production provider headroom. Keep the metered read proxy, serialize
passes and cap CI concurrency; do not assume snapshots reproduce an atomic
mainnet state or eliminate Jupiter API calls.

## Validation

All required commands used pnpm 10.34.5, with the prescribed worker limits.

| Command                                                  | Result                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                         | PASS; no dependency or lockfile update. Existing optional native build scripts remain disabled.                      |
| `pnpm lint`                                              | PASS                                                                                                                 |
| `pnpm format:check`                                      | PASS                                                                                                                 |
| `pnpm lint:words`                                        | PASS                                                                                                                 |
| `pnpm typecheck`                                         | PASS, 67.17 s                                                                                                        |
| `pnpm test`                                              | PASS, 3,307 tests (3,263 Vitest + 44 Node); 63 existing optional tests skipped, 161.29 s                             |
| `pnpm build`                                             | PASS, 27.42 s                                                                                                        |
| `ONEPERCENT_CLUSTER=localnet pnpm program:build`         | PASS; canonical v3 and mock artifact flags verified; IDL regenerated                                                 |
| `pnpm program:clippy`                                    | PASS; library warnings denied                                                                                        |
| `pnpm program:test`                                      | PASS; 351 tests, 38 result groups including doc-tests, zero failed/ignored; all default suites with `--no-fail-fast` |
| `pnpm e2e:surfpool`                                      | Expected nonzero result on all 3 canonical passes; actual v3 loader incompatibility reproduced                       |
| `SURFPOOL_PROGRAM=<v2.so> pnpm e2e:surfpool --flow-only` | Nonzero on all 3 diagnostic passes; shared partial journey succeeds, native Feed precompile fails                    |

Control runs on the unchanged existing validator also pass:

- `pnpm e2e:validator feed`: Feed followed by take-back, with the original token
  amount returned.
- `pnpm e2e:validator sellback`: Sell x8, Feed back x8, owed SOL, Redeem of all
  nine kinds, binder close and REFED take-back with an absent binder.

These controls demonstrate the existing backend still handles the attestation
and P2 flows; they do not count as fork coverage.

The application test skips are the existing optional integration gates; they are
not counted as passes and were not enabled by this spike. Rust property suites
used the existing default case budget, including the long Feed and pack traces.
Tests executed for approximately 855.82 seconds in aggregate after native
compilation. Existing test-only unused-function warnings do not fail the suite.
No program source was changed to accommodate Surfpool.

## Decisions taken

- Preserve the canonical v3 build and existing e2e gates. Use v2 only as a clearly
  labelled diagnostic artifact outside the repo.
- Keep credentials in the parent and enforce read-only upstream access in a
  loopback proxy. Give the fork its own genesis identity without changing launch
  authorization checks.
- Use an actual loader upgrade after cheatcode upload, plus decoded state
  assertions, to avoid accepting Surfpool's cached placeholder execution.
- Use the approved immutable localnet DBC pin and existing launch runtime, with
  the same local transport policy as the current rehearsal.
- Acquire stock before Rip because live coverage requires inventory; test Pyth
  on MAJOR and PumpSwap reserves on TRENDING, matching the on-chain interfaces.
- Refresh only Pyth publish times, supply test liquidity locally and sign Feed
  attestations with disposable local intake signers. These are explicit test
  fixtures, not evidence for production admission or oracle delivery.
- Use real-time spacing around LUT creation after observing time-travel history
  inconsistencies. Keep snapshot/DB probes small and delete them after use.
- Report the Ed25519 failure without bypassing signature validation. Downstream
  card steps remain unverified, and the runner reports failure.
