# S2 quote signer

`createQuoteService` implements M2 §11.5 and D22. The request carries only an owner and distinct card indices. Config, Binder and Machine are read together at `confirmed`. Binder amounts, kinds, values, mint and nonce come from those canonical accounts. The M1 hour rotation runs before the X2 snapshot is built. X2 obtains one executable `/order` for the batch total through this role's own Jupiter credential; real exit caps still apply.

S4's public proxy limits IPs and requested wallets; the private router authenticates calls and independently limits the wallet. The service validates its input and output with S4's shared contract. Every success and refusal carries `asOfSlot`, the final live account-read slot. D24 error bodies are exactly `{ reason }`, validated by the six-code shared SDK schema; observed slots remain internal. Request cancellation and authorization are checked between asynchronous stages and before signing. `createQuoteLogWriter` only inserts; identical message hashes use `ON CONFLICT DO NOTHING`. Refusals never insert or sign. HTTP amounts are decimal strings.

Before quoting, the Config pause masks must leave SELLBACK enabled. Before logging or signing a successful quote, the service re-reads Config, Machine and Binder and re-runs X2's checks against that final state with the same provider quote. A changed batch mint or total requires a new request. This re-read never extends the quote's original expiry, and an expired quote is refused. No second `/order` is requested.

## SWITCH points

- `schema.ts` imports the canonical `@onepercent/sdk/api` wire contract directly. Integration tests exercise the real S4 proxy, including retry headers and breaker behavior.
- `draft-sdk.ts` imports canonical SDK `rotateHour`, `attestationExpiry` and structural constants. Its read-only JSON projections and existing readers remain because they return string keys and enforce stricter role checks than the raw SDK decoders. The readers receive the runtime program ID. Account sizes, offsets, owners, discriminators and PDA bumps remain checked against `__fixtures__/m1-accounts.json`, produced by M1 SDK encoders.
- `encoder.ts` uses the canonical SDK `sellBackMessage` by default. Both M2 §7.1 byte lengths and SHA-256 vectors must match before the encoder can be used. An optional injected encoder passes the same checks. The quote and proxy tests use the production encoder.
- Canonical `SELL_BACK` and `TX_LIMITS` config exports provide the unchanged frozen TTLs and batch bound. There are no local economic copies.
- D22 permits S2's private role mounts in the API process entry point. S4 owns the only public proxy.

## Decisions taken

- Insert the immutable log before invoking the signer. A database failure therefore cannot produce an unrecorded signature. Recheck authorization after insertion so a revocation during database work also prevents signing. A row without a returned signature is only an audit attempt; it never changes on-chain eligibility or state.
- A floor-rounded zero payout is refused with X2's existing `INVALID_INPUT` code, matching the program's explicit rejection. X2 currently returns a successful zero payout for that edge case; its other refusal reasons pass through unchanged. The API emits only `ok`, `reason` and `asOfSlot`, with no action hint, per D30 and the cleanup instruction. The market package's internal result stays unchanged.
- No listed bucket maps to `MINT`, and an absent card maps to `INVALID_INPUT`, using the existing X2 refusal union.
- A SELLBACK pause maps to the existing `PHASE` refusal, before the provider call or after the final read. Final budget/card checks reuse the same market quote; changed aggregate amounts and elapsed expiry map to `QUOTE_UNAVAILABLE`.
- Jupiter outages open a local circuit using the existing `SERVICES.transport` operational settings. The RPC adapter uses S0's validated RPC client and its circuit.

## Validation

The quote unit suite covers both brief message vectors, the M1 account fixture, all X2 refusal codes, aggregate provider quoting, confirmed chain time with a host clock 30 seconds ahead, MAJOR/TRENDING expiry, hour boundaries, input tampering, canonical account identity checks, no signing on database/guard/cancellation failure, and a real Ed25519 signature through S0's guarded role key. D22 tests parse success and refusal with the shared S4 schema and verify the final slot. Pause changes and budget/card changes during the provider call are rechecked without another `/order`. No RPC or provider network is used by the tests.

Container tests use `SERVICES_INTEGRATION=1` and a localhost `TEST_DATABASE_URL`. B1 makes the audit log append-only even in tests: unique fixture rows remain in the disposable CI database; teardown never deletes them. The combined G2.2 acceptance run still needs the validator/service integration flow from M2 §13.6.
