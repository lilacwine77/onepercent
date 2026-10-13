# Keeper

The keeper implements permissionless Settle, expired Pull refunds, phase
transitions, Final Pull start and SOL claims, the empty-vault pass, and team withdrawal. It never constructs an
execution pair, requests another draw, or changes pause bits. K1 and M4 own the
remaining work. Every deadline comes from the confirmed Clock sysvar.

`adapter.ts` imports the final SDK's account sizes/offsets, `RESERVED_KEYS`,
`Payee`, and `SettleInput`. Its runtime imports use `@onepercent/sdk/layouts`
and `@onepercent/sdk/constants`: these avoid loading transaction dependencies
before the worker's environment guard and preserve its exact startup log.
The existing Rust vectors continue to validate those
contracts. These local adapters remain because their signatures differ from M1:

- The local and SDK builders accept a runtime `programId`. The local transaction
  builders retain injected limits and return a legacy `Transaction` for the journal.
- Pull, ledger and snapshot decoders enforce exact size, version, status and PDA
  checks and return the keeper's projection. M1's layout decoders have different
  inputs/outputs and do not apply all of those checks.
- `parsePullRevealedLogs(logs, programId)` is only a trigger for a fresh account
  scan. S1's parser takes a transaction result and returns committed events plus
  malformed/truncation diagnostics; replacing it would change the trigger contract.

S4's verified `decodeVrfQueue` already loads from `@onepercent/sdk/verify` in
production. Its unavailable-export fallback remains: queue reads alert as
unavailable while the jobs and confirmed indexer expiry monitoring stay independent.

## Worker integration (D21)

`services/worker/src/index.ts` routes only `ROLE=keeper` through
`startKeeperWorker` in `bootstrap.ts`; the other role branches remain available
for their respective owners. The worker declares direct dependencies on
`@onepercent/config`, `@onepercent/sdk`, and the existing exact
`@solana/web3.js` pin.

Bootstrap validates the complete config namespace before opening resources,
loading a role key, or acquiring leadership. M1's `VRF`, `TX_LIMITS`, `MONITOR`,
`CU_LIMITS`, and the single shared `SERVICES` object now provide those values.
Missing or invalid parameters still fail closed; no production fallback supplies
economics, timeouts, or compute limits. A null priority fee
cap remains valid pending measurement; TxSender then refuses to sign or send.

The official S4 `@onepercent/sdk/verify` decoder is loaded lazily. A missing export
retains the unavailable-queue alert; confirmed-indexer expiry monitoring and exits
remain independent. A malformed export or an installed
module that fails to load is a startup error. The queue layout is never guessed. An initial decode yields `oldestItemSlot`;
`getBlockTime` resolves that slot before a second decode supplies `oldestItemTs`.
Missing block time retains occupancy and reports age as unknown (null in the
report, NaN in the age gauge).

The leader bridge accommodates S0 acquiring leadership before `createRuntime`
returns. Each term receives its own signal, journal claim token, sender and
scheduler. SQL updates are fenced by that token; an aborted term cannot
overwrite a replacement term's signed transaction. K1 can append tasks through
`createKeeper`'s `extensions` interface; they receive the term signal and leader
assertion and must honor both. A dedicated monitor task cannot block exits.

Bootstrap starts the leadership watchdog for both leader and follower replicas,
using S0's validated operational timing. Its stop wrapper first revokes the role
guard and key, then aborts the lifetime and every active term synchronously.
It stops leader acquisition and awaits every term and the watchdog before
calling the original runtime stop, which closes Redis and the database pool.
The same idempotent cleanup runs after a startup failure and through
`installShutdown`; S0's shutdown deadline remains in force.

Reveal notifications defer housekeeping between reads and sends, then trigger
another exit scan. In-flight sends keep their durable reconciliation path.
`createKeeper`'s `websocketUrl` option selects a provider's separate WS endpoint;
by default the HTTP URL becomes WS/WSS. Socket failure retains the periodic
scan. Validator rehearsals pass `websocketUrl: "ws://127.0.0.1:8900"` because its
WS port differs from its HTTP port.

## Journal and retries

Jobs use stable Pull/pack keys. Two-pack groups keep the same key if a client
already settled one pack. Every action re-reads chain state. Signed bytes,
signature, original uncompiled instruction plan, budget and attempts are durable before a send; after a
lost response a replacement leader resumes exactly those bytes. S0's TxSender
handles confirmation, expiry, final-history lookup and the bounded retry budget.
D23 reserves an attempt only for a new simulated and signed record, never for
resending its persisted bytes. Exhausting attempts never clears the signature:
later scans still reconcile ambiguous signatures. Exhausted jobs with no live
signature stay out of the hot drain. Unneeded fresh work is skipped without a
signing attempt or error. No raw provider errors or transaction bytes are logged.
The original account flags are preserved because compilation can promote them
when a payee is also the fee payer. A signed record without its plan fails closed. Plans retain the lookup-table
addresses for K1, atomically with their original instructions and signed bytes.

D21 keeps confirmed jobs eligible for history reconciliation until finality.
A reverted confirmation returns to `signed` with the same bytes and signature;
the journal retains its original plan and total attempts. The first confirmation
is counted once, so finality polls do not duplicate settlement latency samples.
A successful finalized signature completes its settle, refund, team-withdraw or
close-vault job even if subsequent activity changes the observed state. An
advance requires the target phase at finalized commitment; a finalized no-op is
skipped with `no_effect`, and its scan-window key allows another attempt at the
next scan. Legacy advance keys remain readable for persisted signatures. Jobs
reconciled from application state still require finalized completion. For an
absent Pull, its absence and `Machine.next_seq > seq` must agree in one finalized
bank read. Confirmed completion suppresses resends while the signature
is polled. An unresolved signature can be replaced only after finalized block-height
expiry, another history read and finalized application-state reconciliation.
The rebuild callback then re-reads the Pull, account privileges and crank state.
Its fresh plan and replacement signature are persisted in one fenced SQL update.
A failed callback leaves the old evidence intact; a journal failure prevents
sending, and any committed replacement stays paired with its plan. Finalized
failures and definitive first-submission preflight rejections also reconcile
application state before replacement. A merely confirmed error remains ambiguous.

Close-vault and team jobs are keyed by their chain-time pass window. Empty vaults
are checked against every listed bucket, both token programs, the actual ATA and
its ledger payer. Non-writable payers are recorded as skipped and alerted once
per mint/payer across passes. An absent vault is left alone. A new pass runs at
boot, hourly, and on observing Done; a recreated vault is eligible in a later
pass window. Phase cranks require the corresponding nonzero timestamp.

Final Pull uses the unchanged Machine layout. At `end_ts +
SEASON.finalPullDelaySeconds`, with no pending Pull or exec trade, the keeper
sends `start_final_pull`, prepending `advance_phase` atomically if still On Air.
It rechecks the current phase, deadline and pending count before sending. A
state change skips the job; the next scan window permits another attempt.
Final Pull advances to Done at `final_ts + SEASON.sealDelaySeconds`, and the
next housekeeping scan runs the Done close-vault pass.

In Final Pull and Done, a Binder header scan discovers positive season spend
with SOL claim bit clear. Each job is keyed `final_sol:<binder>`, reads the
canonical Binder and owner again, and sends a permissionless `claim_final_sol`.
Completion reads the Binder and Machine in one bank: an absent Binder proves
completion only after that bank has reached Final Pull. Older banks and a
concurrent claim keep the durable job retryable until finalized reconciliation.
Executable and reserved recipients stay read-only so the on-chain Binder credit
path remains available. Token claims are owner-signed through the SDK or rescue
CLI; the keeper never signs them. Refused Binder scans are isolated from phase
transitions and other exits.

SOL pushes use one transaction per Binder in this release. This deliberately
keeps one immutable signed transaction and retry journal per recipient; adding
greedy multi-recipient batches requires shared journal reconciliation. Each
transaction is simulated for its compute limit and uses the existing bounded
TxSender landing/retry path. Manual rescue claims remain available at any time,
including after a keeper job exhausts its operational retry budget.

The existing S0 metrics registry is reused. Settle latency is a conservative
chain-clock observation from reveal until confirmation is observed; this is not
a measured validator p95. VRF queue gauges show the maxima across all
allow-listed queues only when every queue is readable, otherwise NaN; individual
queues alert separately. Expiry ratios and
wallet clusters use confirmed indexer events over the preceding 24 hours.

`runKeeperLeadershipWatchdog` from `leadership.ts` runs alongside the runtime,
outside `onLeader`, with the process lifetime signal. Its `pool`, `rpc`, and
`alerts` come from the runtime; `intervalMs` and `leaderFailoverSeconds` come
from config. It observes the keeper advisory lock across replicas in the current
database and alerts after a confirmed absence exceeds the threshold. Failed
database or Clock reads never establish absence or recovery. `bootstrap.ts`
registers this task and awaits it before shared resources close.

## Priority-price measurement

PARAMS §26.3 requires at least 24 hours of minute samples on mainnet, both
unfiltered and filtered to existing launch-major main pool accounts. No cap is
published from a shorter or gapped window. Supply verified pool addresses in a
JSON file outside the repo:

```json
[{ "name": "launch-major-pools", "accounts": ["<pool public key>"] }]
```

From `app/`, after `pnpm --filter worker build`:

```sh
node services/worker/dist/keeper/fee-cli.js --groups /tmp/onepct-pools.json --output /tmp/onepct-fees.jsonl
node services/worker/dist/keeper/fee-cli.js --output /tmp/onepct-fees.jsonl --report
```

Only `RPC_URL` is needed; there is no wallet loader. The collector verifies
mainnet genesis and account existence, records each raw fee sample, retries transport failures within the same minute,
resumes an
unchanged filter set, computes each p75 using TxSender's nearest-rank rule, and
reports the window's p99 rounded up to the next 10,000 micro-lamports. A lock file
prevents concurrent collectors; after a killed collector, inspect the evidence
before removing its stale `.lock`. The measured key must then be written to
config by its owner. The 24-hour measurement, validator settle p95 and devnet
close-vault drill have not been run on this pre-M1/P0 branch.

## Validation

Fixture tests exercise instruction/layout parity, A14 payees, idempotent cranks,
refund boundaries, partial settlement, retries, leadership loss, log filtering,
VRF metrics/alerts and fee-window completeness. `store.test.ts` includes opt-in
Postgres tests, run by the existing CI `services` job when
`SERVICES_INTEGRATION=1` and `TEST_DATABASE_URL` targets its local container.
S0's existing integration tests cover Redis and advisory-lock takeover.

## Audit fixture provenance

`fixtures/mainnet-beta.json`, `fixtures/vrf-devnet.json`, and the test-only
`fixtures/s4-vrf-decoder.ts` are copied from S4 commit
`6faecfd39d2897d311c4600490f30ac899e584fc` (`packages/sdk/src/vrf`).
The mainnet snapshot has an empty queue; the recorded devnet snapshot exercises
active entries with known, unknown, and unavailable block-time responses. The
copied decoder is imported only by tests; production loads the SDK export.
