# S4 public API

This module exports `createPublicApi(runtime, environment)` for the S0 **public**
role. It does not load a signing key, submit transactions or write an indexer
mirror. The architect's integration extension mounts S4 alongside X1/X3 through
one `registerPublic` call. S0 owns the only mounted `/health` handler. Outer CORS
keeps Actions wildcard access and `WEB_ORIGIN` everywhere else, with
`Last-Event-ID` allowed only on `/api/stream` and `Retry-After` exposed.

## Integration status

1. SDK dependencies declare `zod: "4.6.5"` and
   `@onepercent/config: "workspace:*"`; the API declares
   `@onepercent/sdk: "workspace:*"`. These reuse the
   existing workspace pins; zod's recorded publication date in `VERSIONS.md` is
   2026-09-13. The inventory has an appended S4 section and pnpm 10.34.5
   regenerated the lockfile. No manual dependency links are needed.
2. The public entry point supplies its S0 runtime to `createApi`. The additive
   registration owns only S4 routes and does not define M3's `/api/values`,
   `/api/logo/:mint`, `/api/web/config` or `/api/beacon`.
3. G1 and P0 remain required. The calibrated draw constants, compiled parameter key list,
   coverage, transaction limits, VRF thresholds and `SERVICES` operational keys
   must come from `@onepercent/config`. `loadPublicSettings`, the economic reader
   and Verify reject missing exports. Until public settings are available,
   dependent S4 routes return an explicit 503 while X1/X3 and S0 health remain
   available. D22/M6 B14 keeps `/api/config` independent: it returns the environment
   cluster, program id and flags with null chain fields before deployment. HOLD keeps its specified 404. Role/key isolation and the public
   environment are checked eagerly.
   Test fixture numbers are never production fallbacks.
   Missing signer URLs or bearer tokens keep the public process running (D24).
   Each unconfigured signer is logged with `signer_configuration_missing`;
   its requests return 503 `signer_unavailable` and its readiness is unavailable,
   without contacting a default destination. Config, health, X-ray and read routes
   remain usable. Invalid supplied credentials and shared tokens still fail boot.
4. S1 must populate the existing S0 tables and `onepct:events` stream. The public
   reader does not replace the indexer. S2 must accept the public SDK signer
   schemas, distinct bearer tokens and `x-client-ip-hash`.

The module exports are added append-only in `packages/sdk/package.json`:
`@onepercent/sdk/api` and `@onepercent/sdk/verify`. Queue decoding is also exported
from `./verify`, so no unapproved package subpath is needed.

## Decisions taken

- Amounts remain validated decimal strings on the wire. `parseU64` converts them
  to bigint at arithmetic boundaries, avoiding unsafe JSON serialization.
  `asOfSlot` is a safe integer; health and standard JSON-RPC retain their specified
  envelopes. Error responses and pings may have an unknown (`null`) slot.
- Public route construction is lazy only to isolate missing G1/P0 configuration
  from existing routes. Successful construction is reused; missing settings are
  never replaced with local defaults. The entry test distinguishes missing real
  config from the configured case using explicit test fixtures and mocked I/O.
- The parameter hash is SHA-256 of the compiled `ONCHAIN_KEYS` map, sorted with a
  locale-independent lexical comparison; bigint values are decimal strings.
- The machine/Me Redis cache measures age from **before** the source read. A slow
  read, future-dated entry or expired entry is not served. Redis cache failures
  fall back to a fresh read. No stale-while-revalidate response is returned.
- RPC rejects batches and unknown methods, validates each method's parameters,
  caps multiple-account reads, requires bounded Deck slices in single and batch
  reads, and blocks Deck simulation account output. D11 history methods enforce
  confirmed commitment, history limit at most ten and transaction version zero.
- The audit requires the configured RPC quota on every method, including local
  exit preparation reads and simulation. `/api/verify` itself is not limited.
  Feed and Sell back use requested-wallet and salted IP quotas; value uses its
  configured IP quota. No on-chain permission or economic bound changes.
- SSE retains S0's `{id,event,data}` envelope. One shared poll confirms the batch
  against committed DB events and reconstructs payloads from canonical DB data,
  removing `_indexer` and adding `name`, `signature` and `asOfSlot`. Strict SDK
  payload schemas reject mismatches. Deleted/failed transactions are suppressed.
  The frame's slot is derived from its ID, never its embedded payload.
- A queue item's absolute creation time is resolved from its oldest active slot
  with `getBlockTime`. The provider's modulo creation field is not reliable for
  old entries. Occupancy includes allocated holes, conservatively. Unreadable
  queues return null fields and `busy:false` with an alert; nothing pauses buys.
- M1's `PackSettled.paid` combines royalty and returned deposit and may be partial.
  The API does not invent an allocation rule. `royalties.lamports24h` / `total`
  are null for a period with a partial payment. `royalties.settlementReceipts`
  always reports the actual confirmed SOL received, **including returned
  deposits**; redirected amounts are excluded. `count24h` counts distinct packs
  settled to the wallet. The rest of Me remains available.
- The M1 callback emits zero live flags. Verify uses its exact draw math
  and explicitly reports bucket selection as recorded, not recomputed. M4 must
  preserve each `PackRevealed.live_flags` when specials change between packs.
- Feed hard-check refusal codes `not_pump_fun`, `not_supported`, `mint_forbidden`
  are COPY.md's binding names under D22. Refusal dates accept either ISO dates or
  ISO timestamps. Signer errors use the shared SDK `SignerErrorReason` enum and
  strict `SignerErrorResponse` envelope `{ reason }`.

## Draft compatibility

The read-only adapter in `data/draft-layouts.ts` records the draft IDL digest and
checks account owner, discriminator, version, size and integer ranges. No draft
IDL or program source outside S4-owned paths was replaced. The M1 layouts used
here match its brief. M2's future P0 additions at Machine offsets 2576–2600,
Bucket offset 120 and ExecRecord offset 72 are absent from the draft and are not
read by this API. The two layouts retain their existing sizes.

M1's pinned Anchor event parser does not handle the nested VRF callback frame
correctly in the validator capture. The capture uses an explicit invocation
stack and the IDL event coder, accepting only events inside this program's frame.
S1 and the M3 direct Verify consumer must use their stack-aware decoder.

## Validation

Tests are offline by default; network readers are injected. `SERVICES_INTEGRATION=1`
enables Postgres/Redis checks in the CI `services` job using isolated databases
and streams. Local Postgres initialization is blocked by sandbox shared-memory
permissions (`shmget: Operation not permitted`). No wallet is needed.

From `app/`, use the pinned pnpm 10.34.5:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

The audit validation removes workspace `node_modules` and generated build output
before frozen installation. All dependency links are generated by pnpm. SDK/API
builds exclude test sources and their fixtures, avoiding duplicate compiled test
discovery. The 100 existing recorded validator Pulls use a test mock VRF, not a
live provider proof. Additional independent Rust host cases and remaining G1
capture gaps are documented in the Verify README.

Clean audit run: frozen installation, lint, format, typecheck and build passed.
The default parallel `pnpm test` run had one timeout in the unchanged X2
`market-exit-caps.test.ts:120` five-second test. The complete retry passed with
`VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm test`, preserving
every test timeout and assertion: 1,033 passing tests (including 27 script tests),
22 CI-gated integration skips. API: 279 passed, ten skipped; SDK: 83 passed.
Post-build inspection found no test or test-fixture artifacts in either SDK or
API `dist`. File ownership, vocabulary and `git diff --check` also passed.

## Fixes from the S4 audit

The audit supersedes the earlier unrestricted exit-read proxy policy. Every RPC
method now consumes the configured 600/minute IP bucket before JSON parsing.
The proxy has its own `JsonRpcClient` and circuit. `SERVICES.api` configures
`rpcMaxConcurrentPerIp` (16), `rpcMaxConcurrent` (64), `rpcMaxResponseBytes`
(4 MiB) and `rpcCapacityRetryAfterSeconds` (1). These operational limits allow
a normal page's four to six parallel reads, including ten simultaneous
six-read page loads on distinct IPs. They retain a finite process budget:
64 maximum-size responses represent 256 MiB of raw bodies before assembly and
JSON parsing, so increasing concurrency also requires a memory budget review.
There is no server waiting queue; excess concurrent work still receives
HTTP 503 with a JSON-RPC error and the configured `Retry-After`.
An IP refusal precedes parsing and uses a
null response ID. Every admitted IP slot is released on completion or failure.
Oversized replies, caller cancellations and timeouts on client-shaped account,
history and simulation reads are `RpcError` rejections ignored by the breaker.
This includes local deadlines and explicit HTTP 408/504 responses for those
heavy reads. Network failures, HTTP 429/other 5xx and lightweight read timeouts
still count as outages.
Provider failures cannot open the runtime circuit used by machine/config/VRF/value reads.
The composed API rejects `/api/*` request bodies above 64 KiB before parsing,
including existing Link and Actions handlers. CORS rules remain unchanged.

A public process shares one SSE poller and one batched confirmation query per
poll. RUNBOOK limits: **200 SSE connections per process and 4 per salted IP**, with 32 queued
frames per client. Saturation returns 429 with Retry-After; a slow client is
closed and may resume with Last-Event-ID. Initial replay is separately bounded
at 500 events; a burst exceeding the 32 queued frames also closes that client.
These are operational memory/socket
bounds, not economic parameters. The SDK exports payload schemas for the actual
S1 program events, including final M1 `ReferralRedirected`. S1 and S4 use the
same `ONEPERCENT_EVENT_STREAM_EVENTS` object; `PROGRAM_EVENT_STREAM_NAMES` is
an alias. Administrative and diagnostic events retain null categories.

Parsed signer refusals retain their reason and do not trip a transport circuit.
Only transport/timeouts and unparseable 5xx count toward that circuit. Private
readiness probes are coalesced and cached for five seconds. Machine cache misses
are coalesced per runtime cache/key. Indexer lag is
`max(0, core.asOfSlot - scanSlot)` using S1's Redis scan watermark and the current
confirmed account context, never a saved lag or an old event row. The last
successful `checkedAt` must be no older than the indexer poll interval plus one
RPC, DB and Redis timeout budget (strictly less than 19 seconds with current
parameters). Missing, malformed, future or expired telemetry reports unknown lag.

Binder reads fetch the 112-byte header, then only active cards in slices of at
most 64 KiB, with at most four concurrent reads. Slices use `minContextSlot` and
a matching header before/after the read; changing counts, reservations or nonces
trigger one retry. Normal confirmed-slot advancement remains readable. Unused
capacity is never downloaded. Verify receives each pack's `live_flags` from its
confirmed `PackRevealed` event and falls back to Pull flags for older captures.

Build roots exclude tests and test fixtures. The existing X-ray runtime fixture
source remains intentionally imported. M3 route-ownership assertions now use a
bare Hono app with `registerPublic`, so M3.1 routes can coexist after rebase.

## D22 contract follow-up

`ConfigResponse` keeps every field required. Before G1 publishes its compiled
hash exports, `paramsHash`, `asOfSlot` and chain sections are explicitly null.
With published parameters, a confirmed absent Config or Machine keeps the known
hash and observation slot while returning null chain sections. Present accounts
are still validated, including when their peer is absent. Invalid published
parameters, owner/layout mismatches and RPC failures remain 503. Other S4 routes
keep their existing missing-settings 503 behavior. `/api/config` retains the
existing outer CORS policy and sends `Cache-Control: no-store`.

The signer contract tests use S2-shaped Feed and Sell back successes and business
refusals with `asOfSlot`, COPY refusal keys, and strict `{ reason }` 429/503 errors.
Repeated parsed refusals preserve their reason and Retry-After without opening
a transport circuit. The examples adapt S2 d23fd58 to D22; they do not execute
that older S2 implementation or attest to its cryptographic outputs.
