# Pump compatibility interface

The pump SDK remains available for the Feed, X-ray and external pump-born bags.
$1PCT launches on Meteora DBC under D29. The active launch composer is
[`../tx/launch.ts`](../tx/launch.ts); the DBC math, account layouts and encoders
are in [`../meteora/`](../meteora/).

The pump encoders, program addresses, PDA seeds and external layouts follow
`pump-public-docs` commit `2293f9a66c654e9fe82dc5e8f4618538f24bb35f`.
Sanitized upstream IDLs and dated mainnet account reads remain in
`app/fixtures/pump` and `app/fixtures/mainnet/pump`. Fixture tests never contact
an RPC endpoint. Pump instruction vectors, layouts and valuation behavior are
preserved.

`devBuyQuote` mirrors the initial pump reserves and curve fee tier with integer
ceiling divisions. `createV2Ix` takes an explicit `creatorFeeBps` argument.
These external APIs remain testable; the Onepercent launch path does not use
them. D29 removes pump creator-fee checks from that path.

The original pump launch captures and `vectors/pump_ix.json` are historical.
The latter retains its superseded eleven-account `power_on` entry for
provenance. Active tests verify pump instructions separately and pin the D29
twelve-account adapter in `fixtures/meteora/power-on-vector.json`.

Run the external compatibility checks from `app/`:

```sh
VITEST_MAX_WORKERS=2 pnpm --filter @onepercent/sdk test src/pump/pump.test.ts
```

The historical `fixtures/pump/validator-launch.ts` forwards to the Meteora driver. Use
`fixtures/meteora/validator-launch.ts` for the current launch rehearsal.
A successful external venue simulation does not authorize `power_on`; the
M4.1 program remains subject to its deployment and ABI checks.
