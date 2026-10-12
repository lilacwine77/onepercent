# S2 signer integration

D22 mounts `ROLE=intake-signer|quote-signer` on S0's existing private health
listener before it starts. There is one runtime, guard and role key per process.
S4 owns the only public proxy. Public routes, environments and rate limits stay
in S4; private routes authenticate and independently limit each wallet.

## Dependencies and SWITCH points

- Build workspace libraries first. Pure provenance is exported by
  `@onepercent/service-kit/intake`, including `recomputeProvenance` and its
  S1 callback adapter. The indexer supplies historical evidence immediately
  before the landed Feed; current post-Feed balances cannot substitute for it.
- `startup.ts` supplies the existing `indexerTime` interface from
  `onepct:indexer:status.scanSlot`, the completed scan boundary from S1's draft.
  It resolves that slot through `getBlockTime`, including quiet successful polls.
  Missing, malformed or unavailable status refuses Feed. Last event time and
  host time are not freshness proofs. The interface remains injectable.
- The quote signer uses the SDK's `sellBackMessage` by default. Both M2 §7.1
  vectors must match first, including for an optional injected encoder.
- Canonical M1 config supplies domains, TTLs, measured batching limits, caps,
  and `INTAKE` rate limits. Missing parameters fail closed; S2 invents no
  economic fallback. Feed nonce allocation, hashing and expiry use the SDK.
  The Feed encoder retains its explicit validated-domain argument, which
  differs from the SDK encoder bound to the compiled domain.
- Wire schemas are imported directly from `@onepercent/sdk/api`. D24 adds the
  per-bag `evidence_unavailable` refusal to that shared enum. Integration tests
  run real signer outputs through S4's `createSignerProxy`, including repeated
  errors beyond its breaker threshold and a subsequent successful request.
- D24 publishes `SERVICES.signers.evidenceCacheSeconds` and `SERVICES.quote`.
  Other required parameters still have no invented fallback. When those
  parameters are absent at startup, the role keeps its private listener and
  metrics, reports health/ready 503 and logs `params_unavailable`. The internal
  endpoint requires its bearer token and returns the shared 503 error. Deploy
  the compiled parameters and restart the role to enable signing; credentials
  and key-isolation failures still abort startup.

## Decisions taken

- D22 takes precedence over the older S4 draft: unsafe mints use `not_supported`,
  excluded mints use `mint_forbidden`, and ambiguous per-bag history uses COPY's
  `evidence_unavailable`. Other valid bags can still be attested.
- Successful HTTP bodies (including per-bag or Sell back refusals) retain the
  final live read's `asOfSlot`. D24 error bodies are exactly `{ reason }` with
  S4's six codes. Backend/configuration failures map to `evidence_unavailable`;
  failed private authorization maps to `role_mismatch`. Internal diagnostics and
  observed slots are never extra fields in the error wire body. HTTP status and
  `Retry-After` remain unchanged.
- Original chunk indices and bag order remain stable. Empty chunks use no nonce;
  accepted chunks use successive available Binder-window nonces. Capacity is
  allocated in request order even when historical reads run concurrently.
- All FEED logs are inserted atomically before any signature. Repeated message
  hashes use insert-on-conflict-do-nothing. Quote logs are also insert-only;
  integration tests leave randomly isolated audit rows intact.
- Historical work has bounded concurrency under the existing ten-second request
  deadline. Only evidence at or before snapshot S is cached for the configured
  TTL; live tails, balances, consumption and live cards are read again.
- A proven temporary native-token account created and closed back to the payer
  in the same transaction is rent-neutral. Unproven rent still fails closed for
  that bag; no current rent rate is substituted for historical evidence.
- Merge packing defaults to canonical `@onepercent/config`. Missing
  byte-limit exports still fail closed; an explicit config can be supplied. It
  reserves both compute-budget instructions and configured byte headroom:
  the 1,232-byte / 1,500-bps fixture yields a 1,047-byte ceiling. Callers supply
  simulated compute settings; the builder invents neither fees nor a CU limit.
- The quote signer checks SELLBACK pause before provider work and after its final
  live read. It uses the existing `PHASE` refusal and a single provider quote.
- Cancellation prevents further signing; an audit insert already in progress
  can finish without a returned signature.

## Outstanding acceptance evidence

S6's real-wallet corpus and G2.2's real intake/indexer Feed run remain integration
gates. P2's real-signer Sell back run is also pending.
Unit fixtures do not establish those end-to-end gates.

Postgres integration uses `SERVICES_INTEGRATION=1`, `TEST_DATABASE_URL` and
`TEST_REDIS_URL` in the existing CI services job. The Redis-only local check uses
`S2_REDIS_INTEGRATION=1`. No default test accesses external providers.
