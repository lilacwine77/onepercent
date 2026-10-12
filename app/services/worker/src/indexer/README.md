# S1 indexer

This module builds on S0 without changing its runtime, schema or migration.
`ROLE=indexer` attaches `createIndexer` to the worker entry and drains it before
S0 closes Redis/Postgres. S0 retains ownership of signals and the shutdown
deadline. D21 leaves the indexer block isolated for additive keeper wiring; executor and monitor remain
health-only in M2. The landing and the M1 worktree are untouched.

## Runtime and dependencies

`SERVICES.indexer` and `SERVICES.api` now use PARAMS issue 3 values in the existing
config object. `validateParams()` validates these settings, including intake lag
strictly below the alert threshold. No PENDING value or economic constant was
introduced. Worker production dependencies explicitly include the existing SDK,
config package and exact `@solana/web3.js` 1.99.0 pin. pnpm regenerated the lockfile;
its peer snapshot normalization does not add an external package version.

VRF statistics remain available. VRF alert thresholds are an optional
`vrfAlertThresholds` input; config's monitor thresholds and `MONITOR` belong to
M6.1 and are not added here. Without that future input the indexer runs normally
and publishes VRF metrics/statistics, but does not evaluate those two VRF alerts.

S2 supplies `recomputeProvenance` from its pure intake rules. Until that module is
available, missing attestation logs persist `path=unknown` and alert, as specified.
Signing alone never writes consumption. The matching landed Feed's `att_ix` is
used; an unrelated Ed25519 instruction cannot supply provenance.

Optional fallback environment: `INDEXER_RPC_URL_FALLBACK`. `INDEXER_WS_URL` optionally
overrides the primary RPC URL's ws/wss form. All private health and key-isolation
behavior remains S0's. No wallet is needed by this service.

## Ordering, repair and publication

The durable cursor is `cursors.name=indexer`. Standard RPC signature pagination,
version-0 transactions and canonical block signature positions determine order.
Consecutive failures are counted per RPC method, so healthy slot reads cannot
mask broken history reads. Recovery requires successful primary slot reads and
successful probes of its failing methods throughout the configured recovery
window.
RPC codes -32004, -32016, -32007 and -32009 indicate unavailable node evidence.
The shared client retries reads with the bounded jitter policy in
`SERVICES.transport`, then the indexer tries its configured fallback. If neither
node can supply the evidence, the poll defers with `rpc_node_lag`, preserving the
durable cursor and the last successful scan timestamp. Block times that remain
unavailable stay null until a later poll. A skipped-slot response alone never
authorizes a rollback; rooted range and retention checks still apply.
WebSocket notifications only schedule HTTP polling; their data is never stored.
`chain_events.data._indexer` holds replay-only provenance, buyer nonce, fresh mask
or an explicit incomplete-history reason. It is stripped from public events.

Account and Deck snapshots use named cursor fences under the same Postgres
advisory transaction lock as event projection. A later account snapshot cannot be
rolled back by an older event. Deck chunks are accepted only when the before/after
headers and their mutation counters agree. Saturated counters are rejected since
they cannot demonstrate a coherent snapshot. A second consecutive nonzero drift
observation alerts. Full account scans and Deck reconciliation run on a separate
single-flight timer. A changing Deck header defers repair with exponential
backoff (base `pollMs`, capped by the relevant reconciliation interval), counted
in `onepct:indexer:reconcile_retries`. It cannot abort transaction ingestion.
Targeted ingestion reads only event-named ledger/Pull PDAs plus the singleton
state, once per tick. Account reads use sequential `getMultipleAccounts` batches
of at most 100, with each ledger/vault pair sharing a bank context. Keeper-owned bucket `failing` values survive normal reads, replay and rollback;
buckets are refreshed in place rather than truncated with the event mirrors.

Finality checks compare the signature and transaction position against the rooted
block. Unavailable or pruned evidence never authorizes deleting a transaction.
Rollback removes the affected confirmed suffix, preserves finalized rows and
rebuilds mirrors before account reconciliation. The same transaction persists a
stream-reset marker. Redis resets seed only the latest `sseReplayEvents` committed canonical rows,
including after an interrupted reset or Redis data loss. Already delivered confirmed events
cannot be retracted from a connected client; clients still reconcile on-chain
state as required by M3.

`indexer:published` is a durable outbox checkpoint. Redis publication follows the
SQL commit, and a failed publish does not advance its checkpoint. `indexer:stream-reset`
remains present until a complete rebuild succeeds. Event IDs are
`slot-txIndex-eventIndex`; S0 packs the last two components into Redis's second ID
integer. `@onepercent/sdk/events` exports `ONEPERCENT_EVENT_STREAM_EVENTS` for
S1/S4. Administrative/diagnostic entries map to null and remain in SQL; they do
not impersonate a phase transition or reveal. Every public envelope preserves
its original `name` and confirmed `signature`. Quarantined transactions never
publish.

A deterministic transaction-data error persists the transaction as truncated,
marks its raw events incomplete and alerts `indexer_tx_unprocessable`. The
signature cursor advances; later valid transactions continue. RPC/DB failures
retry without skipping data. Quarantined rows are excluded from the last-event
watermark, replay projections, fresh-mask reconstruction and reveal ordinals.

`onepct:indexer:status` carries `asOfSlot` (last fully scanned slot), `scanSlot`,
`confirmedSlot`, `lastEventSlot`, `lagSlots`, `lagSeconds`, `checkedAt`,
`chainTime` (scanned block time) and `confirmedTime`. A fresh confirmed-tip read
at the end of ingestion determines lag: confirmed slot minus the last fully
scanned slot, and the corresponding block-time difference. `lastEventSlot` is
informational: a quiet program scanned through the tip has zero lag. Failed polls
retain the last successful scan watermark and time. Both successful and failed polls
alert at `lagAlertSeconds`. Unavailable block times remain null. Intake must
reject an unavailable or stale status. The legacy numeric
`onepct:indexer:lag_slots` key carries the same slot difference.
`onepct:indexer:vrf` carries the 24-hour opened/refunded Pull counts and expiry rate.

## Event ABI and historical limits

The event SDK uses the generated final M1 event definitions, including
ReferralRedirected, and the shared S1/S4 publication table. Its snapshot is checked
against the committed and freshly built IDLs. The six M2 events remain provisional
until P0. Account adapters retain their validated M1 checks and offsets; P0's
additional fields carved from reserved bytes must be checked at P0 integration.

M1 does not emit standalone DustPick events: picks are embedded in PackRevealed.
PullOpened omits buyer_nonce. Top-level buys parse Anchor arguments while ignoring
trailing bytes; CPI buys read and validate the exact Pull named by PullOpened.
Unreadable openings alert and retain an incomplete record instead of blocking
the signature cursor.
PackRevealed omits fresh_mask, which comes from the ordered Deck history or the
open Pull account. Reveal order is the global one-based ordinal of canonical
PullRevealed events. `pulls.live_flags` accumulates the OR across all pack flags.
A truncated opening can recover a still-open Pull through its observed buy
instruction and the account. A closed Pull whose original logs were lost cannot
supply missing historical draw widths/hit details from accounts. Those events
remain explicitly incomplete; the indexer never invents a result.

A truncation that removes BagFed recovers consumption from the original confirmed,
successful top-level Feed even if the bag has already been taken back. Recovery
reads the depositor, mints and amounts from the instruction and the exact message
at `att_ix`. Successful execution is the authority: M1 already verified the
Ed25519 instruction and its signer against Config at execution time. Recovery
uses M1's bounds, accepting later attestation instructions, low/overlapping
offsets and Anchor trailing bytes. It does not consult the current Config signer
or repeat cryptographic verification with narrower layout rules. Evidence is
always marked `incomplete`; failed transactions never contribute consumption.

The append-only attestation-log join separately checks signer, wallet, nonce,
expiry and every ordered bag. Missing log provenance uses the S2 fallback or
`path=unknown` with an alert. Unreadable instruction evidence alerts and skips;
it never blocks later confirmed signatures. No balance, current bag, fabricated
Deck index or deposit supplies evidence.

`IndexerFeedRecovered` is an explicit internal evidence record in `chain_events`,
with negative ordinals reserved under its real instruction. It projects only
consumption and is never published as SSE or presented as a program event. It is
committed atomically, participates in fork deletion and replay, and preserves
first-Feed precedence. Duplicate processing reuses persisted proofs after key
rotation. Reprocessing a previously indexed truncated transaction can add its
missing evidence and rebuild ordered consumption under the same SQL lock.
Offline mirror replay reuses retained evidence; it does not fetch missing old
instruction bytes from RPC. Deployments with pre-existing unproven transactions
must re-ingest those transactions to create their evidence first.

The draft Feed wire limit is six bags, and its accounts are seven fixed plus
four per bag. These ABI assumptions remain checked against G1/P0 alongside the
event/account codecs.

Replay is an offline operation: stop the worker first, build the workspace, then
run `ROLE=indexer pnpm --filter worker indexer:replay --from-slot <s>` with the
normal indexer environment. The command uses the compiled production entry,
starts no listener/polling/WebSocket and closes the S0 runtime after printing
mirror hashes. `--from-slot` identifies the
requested range, but earlier retained events are replayed as the necessary
baseline, otherwise older live cards and first-feed consumption would disappear.
The final account reconciliation rebuilds account-only mirrors. Hashes use one
Postgres session with `SET TIME ZONE 'UTC'`, including in the integration tests,
so timestamp serialization is independent of the machine's timezone. Identical
hashes require an identical account snapshot, not a moving live chain. Historical fresh
mask reconstruction after an ahead-of-cursor snapshot reads prior ordered Deck
events incrementally, processing each prior event once across an ordered backlog.
Its cache is invalidated on rollback/rebuild. Normal packs fetch only their touched
Deck rows.

## Validation

From `app/`: `pnpm --filter @onepercent/sdk test`, `pnpm --filter worker test`.
The SDK tests compare every M1/M2 codec with Anchor's event coder, exercise failed
CPI nesting, foreign log injection, silent top-level instructions and truncation.
Worker tests cover ordering, fallback, forks, retry publication, consumption,
coherent snapshots and 1,000 seeded Deck operations. These seeded tests are model
tests, not a validator acceptance run.

`SERVICES_INTEGRATION=1`, local `TEST_DATABASE_URL` and `TEST_REDIS_URL` enable the
Postgres/Redis suites in the existing CI `services` job. They create isolated test
databases/stream keys and cover transaction rollback, replay hashes of every
mirror and Redis recovery. They never access remote providers. Only the disposable test database disables `attestation_log_insert_only` after
migration so test resets can truncate its fixture log. Production enforcement is
unchanged. Replay assertions print `S1_REPLAY_HASHES` for every mirror table in
canonical, recovered and repaired scenarios. Local Postgres initialization is
blocked by the sandbox's shared-memory restriction; measured hashes therefore
come from the `services` CI run. G1/P0 ABI checks and the 1,000
operation live validator comparison remain acceptance work, not claimed passes.
