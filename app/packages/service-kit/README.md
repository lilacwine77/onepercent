# Services core (S0)

Node 22 ESM runtime shared by `api` and `worker`. S0 adds no business routes or
jobs itself. The API mounts the X1/X3 public routes on this runtime; S1–S4 add
the remaining routes/jobs. Executor and monitor stay health-only in M2.

## Roles and startup

API roles: `public` (default), `intake-signer`, `quote-signer`.
Worker roles: `indexer` (default), `keeper`, `executor`, `monitor`.

Set `DATABASE_URL`, `REDIS_URL`, a per-service `RPC_URL`, `PROGRAM_ID` and
`LOG_IP_SALT`. Each hot role receives only its own `*_KEYPAIR` variable. Even an
empty foreign variable is rejected. Any other environment variable containing a
valid Ed25519 keypair is also rejected, regardless of its name. Signers also require their own
`INTERNAL_TOKEN` (at least 32 characters); `bearerMatches` compares SHA-256
digests with `timingSafeEqual`. S2 registers and authenticates internal routes. S0 exposes no
internal signing route. Do not load an environment containing several roles'
keys. No development key file is read automatically.

Keys support a base58 64-byte keypair or JSON byte array. The variable is deleted
when parsed. Only guarded signing methods are exposed; serialization and
inspection redact the key. A mismatch, disabled role, failed Config read, expired
check or shutdown blocks signing. Config failures also return HTTP 503 from
`/health`. Rechecks recover after an authorized on-chain rotation.

The committed IDL still contains only M0 `ping`. S0 uses the exact draft Config
layout from M1 §7.1: canonical PDA, owner, discriminator, 872-byte size, version 1
and bump. The M0 program cannot provide this Config. G2.2 still requires G1/P0
and final SDK integration; the draft adapter is isolated in `keys.ts`.

## Operational placeholders

`params.ts` merges `@onepercent/config.SERVICES` over operational placeholders.
D14/D15 publish `SERVICES.transport` now; P0 merges the remaining groups into
that same `SERVICES` object (D15(c)). Until then,
`S0_OPERATIONAL_PLACEHOLDERS` contains only S0's subset of M2 §4.3 [A]. These are
provisional operational values awaiting PARAMS issue 3. No economic constants
are defined here. D14 separates RPC (10 s), SQL (5 s), Redis (2 s) and webhook
(5 s) timeouts from keeper scheduling. The breaker opens after 5 transport
failures for 30 s; JSON-RPC application errors do not count. The fee cap
and Sender tip remain `null`. `TxSender` refuses signing/sending with a null fee
cap; S3 measures the cap and K1 measures the tip. S0 invents no measurement.

`JsonRpcClient` classifies `-32004`, `-32016`, `-32007` and `-32009` as
`node_lag`. Reads retry up to `SERVICES.transport.rpcNodeLagMaxAttempts` (3)
with capped exponential equal jitter: base 100 ms, ceiling 400 ms, giving
50–100 ms then 100–200 ms waits by default. The final transient error remains
available to the caller through `isRpcNodeLag`; it does not open the transport
breaker. Only getters and unsigned simulation retry; submissions never do.
Cancellation interrupts backoff. `blockTimeNow` can read the finalized head
when the confirmed head's time is unavailable, and remains transient if neither
has a timestamp. The indexer applies its configured fallback after exhausted
node lag before deferring unfinished work to its next poll.

## Health and data

`PRIVATE_HOST` defaults to `127.0.0.1`, `PRIVATE_PORT` to `3001`. Bind it to the
private interface in deployment. Railway requires `PRIVATE_HOST=::` for its
private IPv6 network. Do not expose `/ready` or `/metrics` publicly.
The public role also listens on `PORT` (default 3000), publishing `/health`.
`/ready` probes DB, Redis and confirmed RPC; hot roles also need a fresh role
check. The RPC timeout must be strictly shorter than the role-recheck interval.
Set different private ports for separate local processes. Shutdown invalidates
signing and leadership before closing connections, with
`SERVICES.transport.shutdownDrainMs` (10,000 ms) as the drain deadline before
forcibly closing remaining HTTP connections. Uncaught
exceptions and unhandled rejections emit sanitized logs and exit with code 1.

Pino emits JSON with `{service, role, cluster, version, commit}`. Nested fields,
error text, credentials, request bodies and URLs are sanitized before output.
IPs use SHA-256 of `LOG_IP_SALT` followed by the IP. Alerts persist and atomically
claim a deduplication window in PostgreSQL before optional webhook delivery.
Nothing pauses automatically; paging is M6.

Redis limiting uses one Lua call and Redis time. Public SSE IDs retain
`slot-txIndex-eventIndex`; Redis's two-part native ID encodes
`slot-(txIndex * 2^32 + eventIndex)`. Bounds and round-trip checks retain ordering
without changing public cursors. Only S1 publishes confirmed events.

## Leadership and transactions

The keeper lock uses a dedicated PostgreSQL session and
`pg_try_advisory_lock(hashtext('onepct:keeper'))`. Session loss invalidates its
abort signal synchronously. Jobs must honor that signal; each transaction also
checks leadership immediately before signing and sending. A server session idle
timeout bounds abandoned locks; followers retry within the failover budget.
The `onLeader` task stays pending for its entire term. Unexpected completion or
rejection aborts the term and closes its session to release the lock; late task
callbacks cannot cancel a newer term. The executor uses the same lifecycle with
its separate `onepct:executor` lock.

`TxSender` builds v0 with lookup tables, uses capped p75 priority fees over
writable accounts, simulates, and checks packet size before signing. Callers
supply measured CU limits, a role guard, leadership guard, chain reconciliation
and a durable `TxJournal`. S3 stores that journal in keyed keeper jobs. Signed
bytes persist before send; ambiguous sends retry the same bytes. Rebuilding an
unresolved signature requires finalized block-height expiry and transaction-history lookup. Failed
transactions and expired conflicting fingerprints reconcile finalized application
state before rebuilding. D23 durable `keeper_jobs.attempts` reservations count
new signed records across restarts; a reservation follows successful simulation
and immediately precedes signing. Failed simulation and empty rebuild plans do
not reserve a signing attempt. Resending persisted bytes consumes no durable
attempt; sends remain bounded by the per-call pass loop and finalized expiry.
S3 implements `TxJournal.reserveAttempt` atomically. Normal expired retries also
reconcile finalized state. Confirmed state completion suppresses resends while
the signature is polled. A safe rebuild callback can return null to skip obsolete
work without clearing its prior signature evidence. Valid JSON-RPC
rejections expose only `RpcError.code` and a safe classification, without opening
the transport breaker. A preflight rejection is definitive only on the first
submission of a transaction built during the current `send` call. Rejected
resends, including stored signed records resumed by a new process, remain
ambiguous and retain their bytes until finalized expiry, a history recheck and
finalized state reconciliation permit rebuilding. `AlreadyProcessed` polls
signature history until the outcome is verified.
A null fee cap prevents sending. No transaction is sent
at import or startup.

## Verification

From `app/`, run `pnpm --filter @onepercent/service-kit test` and
`pnpm --filter @onepercent/service-kit typecheck`.

Container tests skip unless `SERVICES_INTEGRATION=1`, `TEST_DATABASE_URL` and
`TEST_REDIS_URL` select isolated local instances. CI supplies Postgres 17 and
Redis 7, applies migrations and runs those tests. Unit tests use generated
keypairs and recorded/injected responses; no live provider is contacted.
