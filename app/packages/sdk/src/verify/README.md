# Verify

`verifyPull({pull, packs, programId})` is asynchronous and runs in a browser using
Web Crypto SHA-256. It recomputes the caller seed, each tier sample, the six segment
widths and each dust index. Missing or duplicate pack numbers fail completeness.
An absent request seed remains `matches: null`. Bucket selection stays explicitly
recorded: the events do not contain the historical free capacity of every bucket.
These checks recompute the public draw; they do not independently verify the
provider's cryptographic proof.

M4-A2 evaluates widths with each pack's `liveFlags`. The Pull mask is an OR over
the packs, so every pack's flags must be contained in that mask. Older responses
without per-pack flags fall back to the Pull mask; an explicit per-pack zero is
preserved.

`math.ts` mirrors the final M1 SDK and Rust `math/draw.rs` exactly, within the S4
owned path. All production economic inputs come from `@onepercent/config`.
Missing or malformed calibrated odds and draw tags raise `VerifyUnavailableError`.
The recorded fixture configuration is checked against final M1 exports and is
never used as a runtime fallback.

The fixtures contain 256 Rust host draw vectors and 256 Rust host dust vectors,
copied from the read-only M1 draft. Their configuration is a recorded test input;
provenance is recorded in `fixtures/provenance.json`.

`fixtures/m1-host-pulls.json` adds six independent Rust host cases (37 packs):
legal x5/x10 Rips, After Hours x5, a short Deck that reaches House picks, and a
first-pack Jackpot with flags `[4, 0]` and Pull OR `4`. Samples, widths, tiers,
dust indices and caller seeds were exported directly from the read-only M1 host
library, without a validator or any signer. `fixtures/capture-m1-host.rs` is the
reproducible exporter; its source, library and M1 source hashes are recorded in
the fixture. These are math vectors, not callback executions. G1 still needs
corresponding multi-pack and short-Deck callback captures, plus request-instruction
caller seeds bound to the recorded callbacks. The existing 100 validator Pulls
below are x1 only and do not supply that additional evidence.

`fixtures/validator-pulls.json` separately records 100 actual confirmed buy and
callback pairs on Agave 4.3.0, using M1's production sBPFv3 binary and test mock
VRF. All four editions are covered. Each record retains both signatures, slots,
transaction logs, decoded callback events and the chain Pull header. The run's
artifact and draft IDL hashes are included. These draws were revealed but not
settled; the fixture does not assert exit coverage or provider-proof verification.
Every recorded draw is checked, and flipping one randomness byte fails all 100.

`capture-validator.mjs` reproduces the capture with `M1_APP`,
`FIXTURE_EXPORT_BINARY` and `SOLANA_TEST_VALIDATOR` pointing to the built M1 SDK,
fixture exporter and Agave 4.3.0 respectively. It uses only temporary genesis
fixtures and ephemeral local signers. The read-only M1 artifacts and the devnet
wallet are never modified. Its genesis Deck contains 1,000 entries, backed by
matching mint, vault and ledger fixture amounts; additional rent uses the
exporter's original Rent-derived per-entry deposit.
After regenerating, run `pnpm exec prettier --write
packages/sdk/src/verify/fixtures/validator-pulls.json` from `app/`.

The capture parser tracks actual program IDs through every invocation depth before
decoding program data. The pinned Anchor EventParser does not recognize this
standard nested callback invocation as the target program and returns no events.

The `./verify` export also exposes `decodeVrfQueue`; see `../vrf/README.md`.
