# pump.fun M4 launch evidence

Captured 2026-10-09. Mainnet operations were account reads or unsigned `simulateTransaction` calls with `sigVerify: false` and `replaceRecentBlockhash: true`. No wallet file was opened, no signature was made and no transaction was sent. The simulation payer is the funded public fee-recipient address read from `Global`.

## IDLs (V1)

Official repository: <https://github.com/pump-fun/pump-public-docs>, pinned commit `2293f9a66c654e9fe82dc5e8f4618538f24bb35f`. Its current-main IDLs matched the pin exactly. `idl-verification.json` records upstream, stored and current SHA-256 hashes for `pump`, `pump_amm` and `pump_fees`. Stored IDLs remove every `docs` field recursively and use the workspace's pinned Prettier formatter. Other values are preserved. The fee IDL supplies the fee-config layout without a new dependency.

| File             | Upstream SHA-256                                                   | Stored SHA-256                                                     |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `pump.json`      | `6a19bad7758fb822cee79a91575e51a7bd60391c670200408676643e00a79a6d` | `52d78f668849bd302c77b5e42edffac3664e208a906738124f700ff91798ad5e` |
| `pump_amm.json`  | `b7d8c57a4d9c4dd0109a9ab893052352333252d4eedced10ac091d4d66cab89b` | `23680454afae086898e8d17f67912aa14663de84507616fb328d0afbe84ff626` |
| `pump_fees.json` | `f111d2e5c9aa3d4e64d6a4e6b6f34300ccb1eaf6abc46834fe491836dc90aa74` | `b8f55682a574849e3a8e2bf20a67feeab2a80424edb4a6ea7b5542fd1dcfbe79` |

Reproduce from `app/`: `node fixtures/pump/refresh-idls.mjs`. An upstream byte difference stops the script for review; the pin is not silently changed.

Primary references:

- [Coin creation](https://github.com/pump-fun/pump-public-docs/blob/2293f9a66c654e9fe82dc5e8f4618538f24bb35f/docs/instructions/COIN_CREATION.md)
- [Trade v3](https://github.com/pump-fun/pump-public-docs/blob/2293f9a66c654e9fe82dc5e8f4618538f24bb35f/docs/instructions/TRADE_V3.md)
- [Creator-fee collection](https://github.com/pump-fun/pump-public-docs/blob/2293f9a66c654e9fe82dc5e8f4618538f24bb35f/docs/instructions/COLLECT_CREATOR_FEE.md)

## Reads (V2, V6, V9)

`node fixtures/pump/refresh-mainnet.mjs` uses public mainnet RPC, or `MAINNET_RPC_URL` without printing it. `programs.json` and `read-verification.json` record deploy slots, owners and capture slots. All four deploy slots equal M4 section 4.2. Global remains 1088 bytes with creation enabled; initial reserves and the 95 + 30 bps fee tier reproduce the exact quote. Raw binaries, accounts and per-file metadata are in `../mainnet/pump/`.

Devnet reads at slot 509044845 found Global and the executable pump program. Presence alone does not validate E4a. The equivalent Solana CLI read was attempted, but this installation requests a default signer even for `program show`; standard RPC reads provided the loader state without opening a wallet.

## Simulations (V3–V5)

Reproduce: `node --conditions=development --import tsx fixtures/pump/verify-mainnet.mjs`. The script requires the mainnet genesis hash. A random mint public key is used with no mint signer. Creation discovery reads JSON with `maxSupportedTransactionVersion: 1`, because version 1 was observed on mainnet. These external-prefix simulations use legacy transactions; the complete launch uses one v0 transaction.

| Check                           | Slot      | Result  | CU     | Serialized bytes |
| ------------------------------- | --------- | ------- | ------ | ---------------- |
| V3 create + buyer ATA + dev buy | 454748210 | Success | 172636 | 1124 legacy      |
| V4 graduated fee chain          | 454748211 | Success | 136695 | 895 legacy       |
| V5 fresh fee chain              | 454748214 | Success | 50269  | 627 legacy       |

`simulation-verification.json` includes decoded post-state. V3 bought exactly 40000000000000 base units with `max_sol_cost` 1176185869 lamports. The mint has decimals 6, supply 10¹⁵, no mint/freeze authority and extensions exactly 18 and 19. The 166-byte curve names FeeIn as creator, has zero Mayhem/cashback/holder flags, default quote mint, waiting creator fee 3484996 and virtual quote reserves 31161665054. V5 leaves the creator vault at the live rent minimum, 650240 lamports.

Differences from Appendix A: mint size 372 versus 358 bytes and V3 size 1124 versus 1150 bytes reflect different neutral metadata lengths. CU differs by −42 / +8332 / +11050 for V3 / V4 / V5. The IDLs and deploy slots did not change; CU is remeasured per transaction.

V3 is an external prefix only. The atomic full launch, `power_on`, vault accounting and phase/timestamp writes await M4.1. V4/V5 verify external collection only, without the pending Onepercent distribution into Machine stock.

Per-simulation JSON preserves runtime/instruction logs. Arbitrary upstream prose and binary event logs are stored as SHA-256 references to keep external prose outside the product vocabulary. Exact unsigned transaction bytes and simulated post-state remain binary fixtures.

## Current launch decisions

D27 requires an explicit `creatorFeeBps: 0n` in the creation instruction for the
SOL pair. The CLI checks the curve's `creator_fee_bps` at offset 115 is zero and
`can_edit_creator_fee` at offset 123 is false, including simulated post-state.
The creator income follows pump's schedule; M4.1 applies D27's collection split.
The separate custom-rate simulation evidence reported by the architect is
recorded in `docs/codex/DECISIONS.md` D27, not in these original V3 captures.

D28 uses one atomic v0 transaction through Helius Sender. The creation, dev buy,
deposit and `power_on` stay in that transaction. The launch path has no Jito
transport or sequential simulation dependency.

## Offline validator prefix

Run `node --conditions=development --import tsx fixtures/pump/validator-launch.ts`. It verifies fixture hashes, uses only the local validator, disables every runtime feature absent/inactive in the recorded mainnet snapshot, creates and freezes a real lookup table, and attempts the external creation/buy and creator-fee chain. No fake `power_on` is injected. `pnpm e2e:validator launch` runs this prefix and then fails explicitly because full E4 requires M4.1. Any successful prefix report states `fullE4Passed: false` and `machineStockVerified: false`.

The successful local capture is `validator-prefix.json` (2026-10-09T03:54:17.215Z): frozen 24-address table; v0 external prefix 645 bytes and 171825 CU; exact 40M base-unit amount; FeeIn received 3484996 lamports through the external collection chain. The local rent minimum is 890880 lamports, versus the mainnet capture's 650240; the check reads each runtime's rent and does not assume equality. The validator uses 251 active features from the snapshot and deactivates 35 additional runtime features. All 59 snapshot feature accounts absent from this runtime's feature list are listed explicitly. This partial result does not validate Machine stock distribution or full E4.

`launch-sizes.json` records the current complete transaction's synthetic size
measurement: 838 bytes v0 with an 80-byte URI (1548 bytes v0 without a table), and
989 bytes v0 at the maximum metadata lengths of 32/13/200 bytes for name,
symbol and URI. Both v0 measurements use the same frozen 24-address table and
fit the 1232-byte wire limit. The SDK's pump tests reproduce both measurements.
These are offline serialization measurements, not mainnet landing evidence.

`mainnet-full-plan.json` and `devnet-full-plan.json` are historical unsigned
CLI captures from before D28. They preserve the old form and simulator fields
for provenance; those fields are no longer part of the current launch tool.
Their NO-GO results are historical observations, not operational readiness
reports. Missing protocol state, table, landing policy and complete simulation
prevented either capture from authorizing a launch.

The devnet capture's live initial virtual SOL reserve was 1000000000 lamports,
producing a 39206198-lamport quote, and its program deployments differed from
the mainnet baseline. These differences produced WARN results. Prior rehearsal
evidence is required only for mainnet, allowing the first devnet or localnet
rehearsal to bootstrap. No signer file was read and no devnet funds were spent.

## D29 historical status

D29 supersedes every launch-specific instruction and measurement above.
$1PCT now launches on Meteora DBC using SPL Token. The active launch path does
not call pump creation or enforce pump creator-fee fields. The original files
remain unchanged evidence for external pump compatibility used by Feed and
X-ray. Their observations do not establish current Onepercent launch readiness.

The pump validator launch entry point is retired and fails explicitly. Use
`../meteora/validator-launch.ts`. Current twelve-account `power_on` vectors and
atomic transaction sizes are `../meteora/power-on-vector.json` and
`../meteora/launch-sizes.json`: 826 bytes for the standard 80-byte URI, 975 bytes
for maximum metadata, with a frozen 17-address table. Those sizes are offline
serialization measurements, not mainnet landing evidence.
