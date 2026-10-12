# Feed validator checks

`w2-feed.validator.spec.ts` runs `/feed` with the Wallet Standard fixture wallet,
an isolated Solana test validator 4.3.0 and the deployable sBPFv3 program. It does
not build Rust artifacts. Set `WEB_PROGRAM_ARTIFACT` to the existing, reviewed
`onepercent.so`, or place it at `app/target/deploy/onepercent.so`.
If that artifact uses an explicitly selected test deployment identity, also set
`WEB_FEED_PROGRAM_ID`. The local validator, fixture frontend build and Node
runner then share that identity. This option never enables remote transactions.
With no override, tests use the SDK golden-vector identity.

From `app/`, after the normal web build:

```sh
WEB_PROGRAM_ARTIFACT=/absolute/path/onepercent.so npm exec --yes --package=pnpm@10.34.5 -- pnpm --filter web test:e2e:validator
```

Run this as the only heavy process. Playwright uses one worker and starts the
web preview on port 4173. Each test creates its own validator with random RPC
ports and an API on loopback port 4175, then removes the temporary ledger.
Use an artifact built from the reviewed program source for release evidence;
passing against a different branch is only a compatibility check.

`w2-feed.fixtures.spec.ts` runs with the isolated fixture frontend alongside W1
and W3. It checks D30 selection and dated refusals, a signed Feed with the exact
simplified success line and an In the machine row, and a signed take-back with
business services unavailable in both wallet capability modes. The fixture
signs in Node, then updates explicit test accounts and status receipts. It never
submits those bytes to a network and does not certify program execution.

`w2-feed.devnet.spec.ts` requires an existing live app and its real X-ray and
intake services. It does not start or replace them. From `app/`:

```sh
WEB_DEVNET_URL=https://your-devnet-app.example WEB_DEVNET_WALLET=/absolute/path/disposable-user.json npm exec --yes --package=pnpm@10.34.5 -- pnpm --filter web test:e2e:devnet
```

The private wallet file stays outside the repository and must not be a payer or
protocol role. It must already hold SOL and two available pump fixture mints
from `app/fixtures/devnet/provisioning.json`. The test checks the devnet genesis,
deployment and roles before installing its Node signer. It executes X-ray,
feeds two bags, takes one back, reloads In the machine, then attaches public
transaction signatures, decoded events, balances and Deck observations. No
asset provisioning or old-deposit take-back is performed by this test. Tracing
is disabled and private bytes never enter the browser or report.

The public Solana devnet RPC alone cannot serve the production intake history
query. See `docs/codex/DEVNET.md` for the required historical provider and
service credentials. A local or fixture pass never substitutes for this gate.

`feed-validator-check.ts` additionally runs the production planner, transaction
engine and exits in Node with generated Wallet Standard signers. It covers the
two signing capabilities, merge and rent receipts, per-bag refusal, dropped
submission reconciliation and an approval held past finalized blockhash expiry:

```sh
WEB_PROGRAM_ARTIFACT=/absolute/path/onepercent.so npm exec --yes --package=pnpm@10.34.5 -- pnpm --filter web exec tsx e2e/helpers/feed-validator-check.ts
```

This is supplemental evidence. It does not test the rendered UI, browser wallet
registration or visible approval counts, and cannot replace the Playwright gate.

The wallet's two signers and the intake signer are generated in memory for
each test. No wallet file or remote network is used. Wallet signing happens in
Node; the page only receives public addresses and signatures. Both the direct
wallet send feature and the signed transaction API path broadcast to the local
validator.

The intake path uses the production S2 service, chain reader, mint safety checks,
message encoder and response schema. Mint ownership, token balances, nonce
windows and the Deck are real validator reads. Snapshot and swap provenance are
explicit synthetic evidence; the attestation log and indexer projection are
in-memory test substitutes. The fixture authorizes its in-memory intake signer
directly; deployment key custody and S2 authorization gates remain covered by
the service tests. This suite does not certify external history providers or a
production database deployment. Every Feed attestation records
the whole live balance before the wallet signs.

The suite covers 16 deposits and 3 take-backs, both wallet capabilities, partial
submission and retry, real blockhash expiry, an individual intake refusal,
account merges before intake, exact rent receipts and Rent-derived deposit
lines. It disables Feed and public non-RPC reads before take-back. D30 retires
W2.07; no corresponding trading route is called. Rent-rate variants are covered
by the chain unit tests.

The recorded S1 devnet result at `app/fixtures/reports/devnet.json` confirms
pump.fun is present, so the no-pump devnet fallback cannot replace the separate
devnet E1 gate. That gate requires a deployed program matching the web SDK and
an authorized devnet setup. This local test never reads the supplied devnet
funding wallet.

## Resumed browser validation, 2026-10-11

All six browser validator tests passed after integration with current main
(4.2 minutes, one worker): W2.01/W2.02 in both wallet capability modes,
W2.03, W2.04, W2.05 and the combined W2.06/W2.08/W2.09 case. W2.07 remains
retired by D30. The tests use the simplified Feed experience from main without
changing its components or restoring removed copy.
The full fixture project also passed all 16 tests (51.1 seconds), including
the four Feed cases: default selection and dated refusals, take-back with both
wallet capabilities, and a signed Feed followed by the exact simplified success
line and In the machine row. Business endpoints can be unavailable for exits;
the browser still uses the RPC transport, plus the signed relay when needed.

```sh
WEB_FEED_PROGRAM_ID=DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr WEB_PROGRAM_ARTIFACT=~/.codex/worktrees/devnet-provision/1%/app/target/deploy/onepercent.so CARGO_BUILD_JOBS=3 RUST_TEST_THREADS=2 VITEST_MAX_WORKERS=2 npm exec --yes --package=pnpm@10.34.5 -- pnpm --filter web test:e2e:validator
```

The artifact SHA-256 is
`7fded56921a2be659e17fcbe41728db8e001db2c58f171106031dd8eb4cd6488`,
matching the deployed devnet artifact recorded in
`app/fixtures/devnet/upgrade-1.json`. No Rust artifact was built or copied.
The available source checkout differs from this merged revision; this run
establishes browser compatibility with that deployed artifact, not a new build
of the merged program sources.

W2.03 signs the third transaction but deliberately omits its network broadcast.
The app waits for finalized blockhash expiry before displaying partial progress
and rebuilding only the two remaining bags. A wallet exception before returning
a signature is a different ambiguous outcome and cannot certify this case.
W2.04 independently holds a wallet approval through real blockhash expiry.

The real devnet Feed journey remains blocked before signing. After this browser
validation, the architect authorized a dedicated test user and the deployed API.
The wallet received 0.5 SOL and bought 25,000 tokens from each of two existing
pump devnet curves. All three transactions finalized; their signatures and
public receipts are recorded in `app/fixtures/devnet/m3.2-feed-live.json`.
The wallet retains both bags and 0.495568934 SOL. That initial remote attempt
used no role key and changed no service or program configuration.

`POST /api/feed/attest` returned HTTP 503 with
`{"asOfSlot":null,"error":{"code":"evidence_unavailable"}}`.
The intake logs in the request's time window contain `RpcError`,
`rpc_error:-32602`. Repeating the history reader's read-only request on the
verified devnet provider returned exactly
`Invalid params: tokenTransfer filter requires finalized commitment`.
The deployed reader requested `confirmed`. The logs do not expose the HTTP
request ID, so their correlation is temporal.

X-ray was deliberately not requested: deployed `HELIUS_RPC_URL` is absent,
so its resolver selects the mainnet endpoint despite the API's devnet cluster.
A second eligibility blocker would remain after repairing history reads:
both purchases occurred after snapshot slot 509605276, so the first-acquisition
rule predicts `snapshot_not_held`. That initial attempt did not observe the refusal over HTTP,
because the provider failure happened first. No Feed or take-back transaction
was signed or sent; G3.2 remains open.

A read-only browser observation used the production web build, the real Railway
RPC proxy and an address-only wallet that rejects signing. The SDK found no
entries for this wallet before navigation and after reload. The page showed
an unavailable-service error, with RPC 503 responses and royalties HTTP 404.
Zero visible rows in that degraded state do not validate In the machine.
No X-ray, valuation, metadata or transaction request was allowed by the browser
guard, and no API response was replaced.

All workspace commands used the pinned pnpm 10.34.5, with
`CARGO_BUILD_JOBS=3`, `RUST_TEST_THREADS=2` and `VITEST_MAX_WORKERS=2`.
Heavy steps ran serially. The complete build selected the devnet deployment
above. No program build or Rust test was run because program sources were
unchanged relative to main.

| Command from `app/`                                            | Result                                              |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm install --frozen-lockfile`                               | Pass, no dependency changes                         |
| `pnpm build:libs`, `pnpm build`                                | Pass                                                |
| `pnpm lint`, `pnpm format:check`, `pnpm lint:words`            | Pass                                                |
| `pnpm typecheck`                                               | Pass                                                |
| `pnpm exec tsc --noEmit -p apps/web/e2e/tsconfig.json`         | Pass                                                |
| `SERVICES_INTEGRATION=1 pnpm test`                             | 3,789 passed, 3 skipped                             |
| `pnpm --filter web test:e2e:fixtures`                          | 16 passed                                           |
| `pnpm --filter web test:e2e:validator` with the artifact above | 6 passed                                            |
| `pnpm --filter web test:static`                                | 33 passed, static rules pass                        |
| `pnpm --filter web budget`                                     | All limits pass; entry 119,340 / 123,000 bytes gzip |
| `pnpm --filter web dist:check`                                 | Pass, 57 production files                           |
| `pnpm --filter web lcp`                                        | Pass, all three routes                              |

The integration run used the migrated, isolated
`TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/onepercent_m32_20261011`
and `TEST_REDIS_URL=redis://127.0.0.1:56379/12`. The three skips are the optional
generated-IDL comparison and two PostgreSQL-only cases in the memory store suite.

LCP medians from `scripts/lcp.mjs`, three cold samples per route, 4x CPU slowdown,
1.6 Mbps and 150 ms latency: `/` 1,384 ms, `/x` 1,504 ms, X-ray result 1,476 ms,
all below 2,200 ms. Every individual sample also stayed below that limit.
The complete measurements are in `app/target/web-lcp.json`; command logs are
in `/tmp/m32-resume-*.log`.

### Decisions taken

- Preserve main's experience components and copy catalogs; adapt the live bridge
  to their existing props, including the single plan/deposit row and refund line.
- Use the immutable configured deployment for Feed PDAs, instruction builders
  and event decoding, matching Rip and My cards.
- Share the submission guard across those flows; a Feed reconciliation callback
  takes precedence over a height-only unlock while a receipt is ambiguous.
- Preserve both API feature sets and cause diagnostics, with one validated signed
  relay and an isolated, bounded RPC transport.
- Correct the static asset test's URL-to-path conversion for a checkout containing
  `%`, and measure `/x` as well as `/` and the existing X-ray result route.

## Helius finality repair, 2026-10-11

The intake history reader now uses `finalized` for every Helius `tokenTransfer`
filter. It reads the provider's finalized boundary first; any newer requested
range is fully paginated at `confirmed` without that filter. Both ranges retain
their context and slot bounds. The snapshot must be finalized, and a missing
recent range still fails closed. X-ray's snapshot reader and recorder also
request `finalized` explicitly. No eligibility rule or economic parameter changed.

The focused regression run passed 62 tests, including the exact provider
`-32602` response, outgoing commitments, recent purchases, canonical ordering,
and unavailable recent history. A real Helius devnet read now finds both test
purchases and their balances at finalized slot 510033907.

Local public API S4, intake S2 and a real S1 indexer ran against devnet with an
isolated PostgreSQL database and Redis namespace. `POST /api/feed/attest` now
returns HTTP 200 with two `snapshot_not_held` refusals at the real Config snapshot, 509605276. No snapshot or indexer override was used, and no successful Feed
attestation or user transaction was signed. This validates the provider repair;
it does not complete the two-bag Feed and take-back gate.

Validation after the repair used pinned pnpm 10.34.5 and the same worker limits:
`build:libs`, `lint`, `format:check`, `typecheck`, `lint:words` and the full
`SERVICES_INTEGRATION=1 pnpm test` all passed. The full run has 3,796 passing tests
(3,746 Vitest and 50 Node) and three existing skips. Integration used migrated
Postgres `onepercent_m32_helius_20261011` on port 55432 and Redis database 12 on
port 56379. The separate live replay used database `onepercent_m32_live_20261011`
and Redis database 13. All three local services were stopped cleanly afterward.
Logs are `/tmp/m32-helius-*.log`; no program artifacts were built.

See `app/fixtures/devnet/m3.2-feed-live.json` for the public responses and
`app/fixtures/devnet/m3.2-feed-live-configuration.md` for the exact service
variables and the distinction between X-ray's environment setting and the
signer's on-chain snapshot.

## Snapshot-compliant devnet cycle, 2026-10-11

The architect authorized the retained provisioning wallet `feed-wallet-0` to
reclaim its 1,000-token card and Feed its entire resulting 8,000-token bag.
Real Helius history confirms an initial purchase at slot 509604630 and an
8,000-token balance at the unchanged Config snapshot 509605276. No snapshot,
consumption or indexer override was used.

Both transactions finalized successfully:

- Take-back: `5iazUcsLXW8PKtxf1VBjLRgXGa7qLNDdate2Ak7dL57TUz5rCpQjYKvoCs7f7Ag9goe6gnz1Fp66w3skwh6kqz4B`, slot 510038979.
- Feed: `aoRPj1XmcsoDXRdqKnpg51udiVDTqhqCRnnZ7ky6HvwiZ1EXSPwUkCEz9RRn4KUKj6xUpxwJbz1vSY6x8Es1Ari`, slot 510039100.

The real local intake returned HTTP 200, one attestation and no refusal, using
snapshot 509605276 and nonce 2. The client verified its signer, whole-bag amount,
canonical message and Ed25519 signature before signing. The take-back event
returned 406,400 lamports. Feed deposited 8,000,000,000 base units with a
406,400-lamport Deck deposit and closed the empty token account, returning
1,513,840 lamports before the new deposit and transaction fee.

The on-chain Deck and local API agree on the transitions 50 -> 49 -> 50 globally
and 3 -> 2 -> 3 for the wallet. In the machine's production reader was also
checked through the local `/api/rpc`: the final entry is index 49, amount
8,000,000,000, deposit 406,400. `/api/me` confirms `freshInDeck=3` and the vault
deposit remains `held`; its 23,000,000,000 accounted units match the on-chain
MintLedger and vault balance. The real indexer persisted both events and the
intake attestation. All reads use the existing devnet deployment.

The first post-Feed `/api/machine` verification returned HTTP 503 with logged
cause `snapshot_too_old`. A fresh read returned HTTP 200 and all checks passed;
no transaction was rebuilt or resubmitted after finalization. This API/SDK run
completes the replacement real-devnet scenario requested by the architect.
It does not claim another browser run or a Railway deployment change.

Public receipts and before/after observations are in
`app/fixtures/devnet/m3.2-feed-snapshot-cycle.json`. No application or program
source changed for this replay. The local services were stopped after capture.

## Audit 3 corrections for fedb3c4, 2026-10-12

Finalized failed submissions and expired submissions bypass state-based
reconciliation. A busy Deck can no longer turn a definitive failure into a
pending exit. Expiry still requires the finalized block-height barrier and a
subsequent history lookup with no signature; an unavailable receipt service
never authorizes a duplicate submission.

The integrated regression uses real Deck readers, take-back preparation, SDK
builders, transaction execution and an ephemeral signing wallet, with simulated
RPC transport. A is pulled during signing, its transaction finalizes with
CardMoved, and B remains withdrawable without the API while global Deck counters
keep changing. A second case leaves A unresolved inside its validity window and
withdraws B of the same mint without treating B's token credit as A's receipt.
These are local regression tests, not new on-chain receipts.

Decisions taken:

- Take-back locks and journals use card identities independent of mutable Deck
  indices. Disjoint withdrawals do not reconcile or clear each other's pending
  submissions. Indistinguishable entries share a conservative identity; every
  pending transaction for that identity must resolve before it unlocks.
- Take-back success uses its own signature receipt. The former absence plus
  token-balance delta cannot distinguish a concurrent withdrawal of another card
  of the same mint. Definitive failure remains failed if the one-time index
  refresh cannot establish the card's location or absence.
- HTTP deadlines produce TimeoutError; only caller cancellation produces
  AbortError. Both abort the transport, but a deadline automatically enables
  RPC discovery after an unavailable wallet mirror. Tests include a displaced
  card and a transport that replaces the abort reason.

No experience component, program instruction, economic parameter or snapshot
eligibility rule changed.

Validation with pnpm 10.34.5 passes: `build:libs`, `lint`, `format:check`,
`lint:words` and `typecheck`. The full `pnpm test` run uses
`SERVICES_INTEGRATION=1`, Postgres on 55432 and Redis on 56379: 3,870 tests pass
and 3 are skipped (3,820 Vitest plus 50 Node passes). All 16 browser fixtures and
33 static tests pass. The web build, all budgets and `dist:check` pass; entry
gzip is 119,402 bytes against 123,000 and the production check covers 57 files.
No new network transaction or Rust build was needed for this correction.

## Re-audit corrections for 61bbc45, 2026-10-12

The two remaining take-back findings have separate regressions:

- A 120,000-entry Deck changes through unrelated activity every ten seconds.
  Discovery rechecks the depositor's candidate entries individually and retains
  intact entries. Global counter stability is required only to prove absence.
  Partial discovery and partial caches never authorize a missing-entry result;
  preparation and reconciliation fail closed when absence remains uncertain.
- Sixty REFED mints are polled for 45 seconds with the wallet API unavailable.
  The real RPC client, Deck reader, mint reader, deposit reader and take-back
  planner use a transport enforcing the 600-request quota. Mint decimals are
  batched and cached; sixty held vault deposits need three batched RPC reads.
  The next take-back prepares successfully without a 429.

Additional cases cover cancellation before the first take-back read, queued
siblings after an early Promise.all failure, API cancellation, immediate
post-exit refresh, polling backoff and the proxy's two-request concurrency cap.
No experience component, on-chain instruction, attestation rule or economic
parameter changed.

Decisions taken:

- Feed background reads use one serial lane with at most a quarter of the proxy
  quota, configured by `FEED_BACKGROUND_RPC_SHARE`. Take-back reads bypass that
  lane; beginning the action aborts the old polling group before any exit read.
  The rolling-minute cap allows small reads to finish promptly. The production
  browser projection includes the RPC limit and tests its canonical value.
  The Deck fallback retains its own bounded range pacing.
- An unavailable wallet mirror doubles the polling delay, up to the existing
  `WEB.configRefreshMs`. Explicit discovery and post-action refresh bypass that
  delay. The API is never required to verify a selected exit.

Final validation uses pnpm 10.34.5 and one Vitest worker. `build:libs`, `lint`,
`format:check`, `lint:words` and `typecheck` pass. `pnpm test` with
`SERVICES_INTEGRATION=1`, Postgres on 55432 and Redis on 56379 passes: 3,852 tests
and 3 skipped (3,802 Vitest plus 50 Node passes). The 16 browser fixtures and
33 static tests pass. The web build, `budget` and `dist:check` pass; entry gzip
is 119,362 bytes against 123,000, with the built RPC limit verified as 600.
No Rust source changed and no new network transaction was made for this re-audit.

Rescue verification found no browser rescue page in this branch or origin/main:
`/rescue` has a link but no route implementation. D18 and the M3 brief defer the
page to M6. The CLI regression uses the real personal-RPC connection, SDK
builders and dry-run sender with a simulated RPC transport while rejecting all
API endpoints. It covers FRESH and REFED take-back planning and simulation,
without a signer. It does not certify a browser page or a new on-chain receipt.

## Independent audit corrections, 2026-10-12

The review of `86cceff` identified three defects, now covered by regressions:

- Feed displays `/api/me` indices only after checking the current owner, mint,
  amount, flags and deposit on chain. Preparation rereads the selected indices.
  An unavailable or invalid mirror triggers a bounded full scan; concurrent
  callers share it and unchanged Deck counters allow reuse. Range and hint reads
  are spaced using half of `SERVICES.api.rpcPerMinutePerIp`, leaving room for
  transaction reads. A 120,000-entry Deck with one owned entry covers display,
  three preparations and polling with and without the API. Neither case reaches
  the 600-request rolling-minute limit. Mirror omissions never prove an exit
  absent, and an incomplete cached mirror cannot replace offline discovery.
  A caller joining an older scan retains its own minimum context slot. The
  bridge test also clicks Find my cards after a partial mirror response.
- The recipient's negative personal X-ray snapshot no longer rejects a potential
  one-hop Feed. The real intake still decides S3. The row uses the existing
  `feed.row.checkAtFeed` copy. The regression calls the real X-ray classifier,
  history reconstruction, provenance evaluator and Feed adapter for A buying
  before S and transferring to B after S. Safety, cap and intake refusals remain.
- Confirmation preserves a finalized instruction error. The Solana port reads
  matching transaction details and applies the SDK mapping only for errors
  attributable to this program. `CardMoved` rereads and rebuilds once. A second
  failure stops. Ambiguous confirmations never authorize a rebuild.

Minimal bridge changes: the existing `takeBack.findCards` action exposes the
explicit fallback without changing any experience component. If a finalized
failure used the approved transaction budget, the rebuilt remainder reopens the
existing confirmation dialog with its current counts and deposits. Cancellation
or a wallet change prevents another prompt. No cost cap is silently increased.
The two concurrent attestations permitted during their TTL are unchanged.

Validation uses pnpm 10.34.5, Postgres at `127.0.0.1:55432`, Redis at
`127.0.0.1:56379` and `SERVICES_INTEGRATION=1`. Heavy commands run serially.
`build:libs`, `lint`, `format:check`, `lint:words`, `typecheck`, the web build,
`test:static` (33 tests), `budget` and `dist:check` pass. The entry is 119,332
gzip bytes against the 123,000-byte limit. All 16 browser fixtures pass, including
the service-unavailable take-back cases in both signing modes.
The complete `pnpm test` run passes with one Vitest worker: 3,822 passed and
3 skipped (3,772 Vitest and 50 Node passes). Earlier attempts reached existing
five-second timeouts under shared-host load; the final run changes no timeout,
assertion or performance limit.

`e2e:validator feed` passes with the existing p3 artifact and matching fixture
exporter, read in place. Its program SHA-256 is
`2292f0a3afd4e6aec09470fd4836bda4b8fc352851d79804f295ea8188b60396`.
The browser validator uses the existing local artifact with SHA-256
`d5204f9d8df27db85bfcdb9e062e1dfdf6f27d8e9138113a959717d182821e71`.
These runs establish compatibility with those binaries; no Rust source changed
and no new program build was performed.

The supplemental six-case browser validator run passes four cases initially.
An isolated retry also passes W2.04 (expired approval), so five cases have
passing evidence. W2.03 (partial Feed after a lost send) still reaches its
120-second wait limit. Its retry trace ends at finalized block height 136; the
lost transaction's last valid block height is 155. The UI correctly stays
at two of four confirmed and never retries early. This supplemental suite is
not reported as 6/6. No test timeout or finality rule was changed.

## Historical compatibility evidence, 2026-10-09

The local run reused the read-only artifact at
`~/.codex/worktrees/m2.1b-mycards/1%/app/target/deploy/onepercent.so`.
Its ELF flags are 3 and its SHA-256 is
`5615cb8a99215c0f03997fae94549bc4b930f540150c7e512b9bc57c9070346c`.
The harness also compares the validator's loaded ProgramData bytes against that
artifact. The main checkout's available artifact had flags 0 and was rejected.

Before the subsequent main integration, the working-tree and candidate source
files below were byte-identical. This comparison does not describe the later
merged revision:

| File under `app/programs/onepercent/` | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `src/instructions/feed.rs`            | `1f3be215b40c4f59d8671f565171cd5f8ff2dabf570e3e5e7f782a20a9220d8f` |
| `src/instructions/take_back.rs`       | `4e82d49dfc680ce1086e01797293674742490071674e6b591bcac11c417c37c4` |
| `src/params.rs`                       | `ff2d4cee3d32479a74482eef25cb23c6ff446f9715b3887c06c354100a027a06` |
| `src/state/machine.rs`                | `4e72b523fb8ae232a6e7d744a2d15b835daa2b4ab9309af8365fdf53252785c2` |
| `src/state/deck.rs`                   | `4014d65ff7ec56993f713acbe72a60cc4c5c1ab6ec70d2072e95d1ee40b0d130` |
| `src/util/dynamic.rs`                 | `17887913d8505246833d8385d4b3b57916479c0dfde61d74c48622980b0191b7` |

That historical comparison found seven differences across the complete Rust
source file sets:
`src/constants.rs`, `src/instructions/close_binder.rs`,
`src/instructions/feed_back.rs`, `src/instructions/sell_back.rs`,
`src/instructions/withdraw_owed.rs`, `src/math/mod.rs` and the candidate-only
`src/math/sellback.rs`. The constants difference changes the two P2 card-count
types from `usize` to `u8` and adds Anchor constant annotations; both values
remain 8. It changes no Feed parameter. The M4 candidates differ in 18 files,
including parameters, Machine state and launch economics, so were less suitable.

This file comparison does not prove which revision produced the available
binary. These runs establish compatibility only. They do not pass G3.2: the
exact reviewed program artifact, successful browser W2 cases and devnet E1 are
still required. The historical Chromium attempt failed before the app loaded with
MachPortRendezvousServer permission denied (1100); no browser protection was
changed.

The supplemental Node cases completed against this artifact:

| Case                                        | Result                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| 16 Feed, 3 take-back, direct send           | 16 Feed prompts, 1 exit prompt, Deck ends at 13                        |
| 16 Feed, 3 take-back, sign then API send    | 2 Feed prompts, 1 exit prompt, Deck ends at 13                         |
| Merge, Feed, separate empty-account closes  | 3 transactions, 3 prompts, exact returned rent after fees and deposits |
| Per-bag intake refusal                      | 1 of 2 bags deposited, refused balance unchanged                       |
| Third submission dropped, expiry, retry     | 4 bags deposited with 5 prompts, no duplicate deposits                 |
| Approval held until finalized expiry, retry | Expired state and `errors.tooLong`, then 1 deposit with 2 prompts      |

These cases exercised the TypeScript source present on 2026-10-09. They detected
and verified the
fixes for expired-blockhash error mapping and the compute budget overhead of
standalone empty-account closes. They are not browser W2 passes. The e2e
TypeScript check passed; that Playwright attempt was blocked at browser launch
before any scenario started. The merged revision requires fresh validation.
