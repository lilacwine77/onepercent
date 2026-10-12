# Meteora launch and season fixtures

D29 is the binding launch specification. The pump adapter remains available for the Feed and X-ray.

Read-only mainnet captures on 2026-10-09. No mainnet transaction was signed or sent.
The binaries are executable bytes from the upgradeable loader's ProgramData
accounts, after the 45-byte loader header, including the allocated trailing
padding. `programs.json` records the finalized observation slot, deployment slot,
program data address, authority, byte length and SHA-256 for each dump.

| Fixture             | Program source release                                                  | SHA-256                                                            |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `dbc.so`            | DBC `f552f20aa3c1c7631427c3827aeea7c58b902813`, release 0.2.1           | `4c26a8a5da99f8ce932fa0300c46675b527090021fbb74214c9486bedda9f23b` |
| `damm-v2.so`        | DAMM v2 `a85c926607433f23f0ea60f4ca7b1ae92f4156cb`, release 0.2.4       | `4d5b920baebc090f89b2e8796a3452ed067c9667a143058c96a312f2c1e6848b` |
| `token-metadata.so` | Immutable mainnet Metaplex program, required by SPL pool initialization | `31f0a627dba051a938de650464e55cc5397a4be0fd496929c1f9cf02fe5e9011` |

Both tracks captured byte-identical DBC, DAMM v2 and metadata binaries. The
canonical executable files are the three root files above; `programs.json`
retains both finalized read observations and their common hashes. Consumers use
its `programs[].file` and `programs[].sha256` fields, including token metadata.
`refresh-mainnet.mjs` refreshes these canonical files through read-only RPC.

The source release assignments above are D29's pins. A read-only binary dump
does not itself prove a reproducible source-to-binary build.

## IDL provenance

The two program repositories do not commit their current generated IDLs at
the source commits pinned by D29. The IDLs here are the byte-exact published
IDLs from Meteora's official SDK repositories for those source release versions.
Do not reformat or strip upstream documentation from these two JSON files.
The launch track's earlier IDLs match these canonical files exactly after
removing only `docs` fields. Its DAMM reference checkout had a different raw
hash (`645833d042b8f647a121ea698337ec1b6b4af303b5bcfcb1960130518da9ebff`)
because documentation/serialization differed, not the ABI. The redundant
normalized fixture files have been removed.

The SDK's `src/meteora/*.idl.json` files are derived runtime copies with only
`docs` fields removed to satisfy vocabulary rules. They are not a second source
of truth: the SDK test compares each entire object against the corresponding
canonical JSON after that single normalization. No instruction names, types,
offsets, discriminators or account ordering are changed. `METEORA-LICENSE.txt`
preserves the supplied MIT license.

| Fixture        | Exact upstream URL                                                                                                                                                                                                     | SHA-256                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `dbc.json`     | [DBC SDK 31a472c, release 0.2.1](https://raw.githubusercontent.com/MeteoraAg/dynamic-bonding-curve-sdk/31a472c74ea41d67c728aab694e7af8b1e09ffb5/packages/dynamic-bonding-curve/src/idl/dynamic-bonding-curve/idl.json) | `beedc8c869bc04865c26349a72a3ba9c773e61f48be2d33093c591a015fe82fd` |
| `damm-v2.json` | [DAMM SDK 8c0f726, release 0.2.4](https://raw.githubusercontent.com/MeteoraAg/cp-amm-sdk/8c0f726e70ab7c21f81640a95f3604c75b02022a/src/idl/cp_amm.json)                                                                 | `ccbe93966accca0693790fd3a35b06ed4ca3758cd4d8675c31df92703b9a974d` |

The launch ABI was checked against these pinned program sources:

- [DBC VirtualPool and PoolState](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/state/virtual_pool.rs).
- [DBC PoolConfig](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/state/config.rs).
- [DBC partner trading fees](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/instructions/partner/ix_claim_partner_trading_fee.rs).
- [DBC partner surplus](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/instructions/partner/ix_withdraw_partner_surplus.rs).
- [DAMM position fees](https://github.com/MeteoraAg/damm-v2/blob/a85c926607433f23f0ea60f4ca7b1ae92f4156cb/programs/cp-amm/src/instructions/ix_claim_position_fee.rs).

For DBC, the IDL and source agree on the two `u64` arguments to
`claim_trading_fee`, the argument-free `partner_withdraw_surplus`, and their
ordered accounts, including the final event authority and program accounts.
For DAMM, `claim_position_fee` takes no arguments; its pool and position NFT
account are read-only, while the position and both destination accounts are
writable. The source transfers both accrued token fees and resets both counters.
It does not expose a quote-only maximum parameter.
The architect's amendment therefore collects both sides: the base remains in
FeeIn's canonical SPL $1PCT ATA, while wSOL is closed to FeeIn. A nonzero base
amount is reported in `LaunchFeesClaimed` and never prevents SOL collection.

Account offsets include the eight-byte discriminator:

| Account           | Length | Discriminator (hex) | Fields used by launch validation                                                 |
| ----------------- | ------ | ------------------- | -------------------------------------------------------------------------------- |
| DBC `VirtualPool` | 424    | `d5e005d16245775c`  | `config` 72, `base_mint` 136, `base_vault` 168, `quote_vault` 200                |
| DBC `PoolConfig`  | 1048   | `1a6c0e7b74e6812b`  | `quote_mint` 8, `fee_claimer` 40, `creator_trading_fee_percentage` 245           |
| DAMM `Pool`       | 1112   | `f19a6d0411b16dbc`  | `token_a_mint` 168, `token_b_mint` 200, `token_a_vault` 232, `token_b_vault` 264 |
| DAMM `Position`   | 408    | `aabc8fe47a40f7d0`  | `pool` 8, `nft_mint` 40                                                          |

## Account capture

`accounts.json` records the addresses, finalized capture slots and data hashes
of validator account fixtures. `damm-customizable-config.bin` is the real DAMM
config `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` required by D29.
The launch and executor captures of `accounts/damm-customizable.json` retain
identical 328-byte account data, also identical to `damm-customizable-config.bin`.
Its `observations` array preserves the launch read at slot 454844314, the M4.1
read at slot 454847493 and the executor read at slot 454848238. All share the
SHA-256 `988089b8bacd1967ad85e4acd2bb520c847c872a74fed0614b01a89c57ae73a5`.

`wsol-mint.bin` is the canonical SPL native mint. Raw account bytes have adjacent
`.meta.json` files; the harness writes `solana-test-validator --account` JSON
only in its temporary directory.

The localnet/devnet DBC config uses the public test-only signer under `keys/`,
whose address is pinned per cluster in `METEORA_BY_CLUSTER`. The local rehearsal
creates that account through the real DBC program. It is never a mainnet key.
Mainnet remains PENDING until the launch track pins the ops-held config signer's
public key; the mainnet build and release check refuse PENDING and the test key.
`METEORA.dbcConfig` remains an entry in the `ONCHAIN_KEYS` path registry.

The vocabulary exception applies only to the two IDL paths above with these
exact SHA-256 hashes. Reformatting or changing an IDL disables its exception.

## Local season rehearsal

`scripts/e2e-meteora-curve.ts` uses integer forms of the official SDK's
[buildCurve](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/31a472c74ea41d67c728aab694e7af8b1e09ffb5/packages/dynamic-bonding-curve/src/helpers/buildCurve.ts)
and [curve helpers](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/31a472c74ea41d67c728aab694e7af8b1e09ffb5/packages/dynamic-bonding-curve/src/helpers/common.ts)
for a local test configuration with 20.7% migration allocation and the confirmed
85 SOL threshold. Exact prices, liquidity and measured transfers are recorded
in `../reports/m4-meteora-season.json`. These are test inputs; the launch track
records the production curve before creating the immutable mainnet config.

The pinned program's
[flash rent helper](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/instructions/migration/flash_rent.rs)
requires the DBC global pool authority to hold 1 SOL before migration. The local
rehearsal funds that authority from its disposable fixture payer. Migration
borrows account rent and reimburses the authority from the payer in the same
instruction. This setup transfer is neither a trading fee nor a stock seed.

For AFTER_END, the harness restarts a fresh validator with the exact real DBC,
DAMM, token and program state from the completed migration. Only the Machine's
on-air and end timestamps are pre-aged. It then advances the phase, trades on
DAMM and checks the real Pool claim plus the entire team allocation. Temporary
account JSON normalizes `rentEpoch` to zero without changing account data or
lamports; this avoids JavaScript precision loss for the captured u64 maximum.

The replay creates a new ledger: it retains account state but cannot retain the
migration transaction history. The rehearsal keeps the same fee reader across
this reset, matching one keeper leadership term. It retains only provenance
resolved from finalized history before the reset and revalidates the current
accounts and NFT ownership after it. A cold reader with no history still fails
closed. No position address is injected into the production reader.

`migration-history.json` is the public JSON-RPC history captured on the local
validator with the pinned DBC binary above on 2026-10-10. It contains no signer
secrets. The worker regression checks its real instruction against the pinned
IDL: discriminator `TCqN7bA2Pd9`, curve/config/pool at 0/2/4, and the first
position mint/NFT account/position at 5/6/7. The pool is indexed by
`getSignaturesForAddress` before the reset. After reset and finalization of the
new ledger, the original signature is absent at both confirmed and finalized
commitment, and from signature-status history.

## Executor decoder evidence

The executor shares the unchanged M4.1 IDLs, dumps and hashes above. Earlier
stripped IDL copies and duplicate program files have been removed. Their only
IDL differences were documentation properties; all ABI data matched.

## Decoder offsets and canonical addresses

Offsets include the eight-byte Anchor discriminator. The selected fields below
were checked against the IDLs, the pinned Rust structs and raw account bytes.
All integers are little-endian; `sqrt_price` is a `u128` Q64.64 square root.

| Account         | Field                            | Offset / length    |
| --------------- | -------------------------------- | ------------------ |
| DBC VirtualPool | discriminator `d5e005d16245775c` | 0 / 8              |
| DBC VirtualPool | config                           | 72 / 32            |
| DBC VirtualPool | base mint                        | 136 / 32           |
| DBC VirtualPool | base vault / quote vault         | 168 / 32, 200 / 32 |
| DBC VirtualPool | base reserve / quote reserve     | 232 / 8, 240 / 8   |
| DBC VirtualPool | sqrt price                       | 280 / 16           |
| DBC VirtualPool | is migrated                      | 305 / 1            |
| DBC VirtualPool | total account length             | 424                |
| DBC PoolConfig  | quote mint                       | 8 / 32             |
| DAMM v2 Pool    | discriminator `f19a6d0411b16dbc` | 0 / 8              |
| DAMM v2 Pool    | token A mint / token B mint      | 168 / 32, 200 / 32 |
| DAMM v2 Pool    | token A vault / token B vault    | 232 / 32, 264 / 32 |
| DAMM v2 Pool    | liquidity                        | 360 / 16           |
| DAMM v2 Pool    | sqrt price                       | 456 / 16           |
| DAMM v2 Pool    | pool status / collect fee mode   | 481 / 1, 484 / 1   |
| DAMM v2 Pool    | token A amount / token B amount  | 680 / 8, 688 / 8   |
| DAMM v2 Pool    | layout version                   | 696 / 1            |
| DAMM v2 Pool    | total account length             | 1112               |

The [DBC PoolState source](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/state/virtual_pool.rs)
asserts 416 bytes before the discriminator. Its SHA-256 is
`f1cda3d60eb49690b72db9edf3eb3c469429990b1d76d5d6dfa3c5d599ba57be`.
The [DAMM v2 Pool source](https://github.com/MeteoraAg/damm-v2/blob/a85c926607433f23f0ea60f4ca7b1ae92f4156cb/programs/cp-amm/src/state/pool.rs)
asserts 1104 bytes before the discriminator. Its SHA-256 is
`ddcc405e154a78a1de6daf5ce697fc1e8bb1b54ca06ca0fe50b40997a272ba7a`.

Both [DBC pool initialization](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/instructions/initialize_pool/ix_initialize_virtual_pool_with_spl_token.rs)
and [DAMM v2 dynamic-config initialization](https://github.com/MeteoraAg/damm-v2/blob/a85c926607433f23f0ea60f4ca7b1ae92f4156cb/programs/cp-amm/src/instructions/initialize_pool/ix_initialize_pool_with_dynamic_config.rs)
derive their pool as `["pool", config, max(mintA, mintB), min(mintA, mintB)]`
under their respective program, comparing raw public-key bytes. Their SHA-256
values are `1e64fb5dae95e4c78af35c67b9d932380abf626f7868364031ef218b2aef06ab`
and `86fa1fffc0f1ec018515d6a2bf22fa07e81bcd5b860b1090e00faef810c0a95b`.
The capture script independently derives each selected pool address.

## Account captures

`decoder-accounts.json` records the capture time, finalized slot, address, owner, byte
length and SHA-256 for every file. Each `accounts/*.json` includes the unmodified
base64 data and owner, plus the RPC slot. For validator loading, `account.rentEpoch`
is normalized to zero; its original exact decimal value is `rpcRentEpoch`.

Capture time: `2026-10-09T11:07:31.795Z`, finalized slots 454848237 through 454848239.

| Fixture               | Address                                        | Observation                                      |
| --------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `dbc-active`          | `AYgu3bEE4n6Eq13rTNX4RkwXHSaiWq51DJ9fVHt9uLjs` | `is_migrated=0`, sqrt price `128794468968736475` |
| `dbc-active-config`   | `2TuuiPb322sDf3d8K9fuELiD74edJBpksjBrv9nYZSnE` | Quote mint wSOL                                  |
| `dbc-migrated`        | `HsFQ9BMxtREZ15mpngqgtnUd9gH5bCzv19Xq87QgGdLP` | `is_migrated=1`, sqrt price `41157157678601157`  |
| `dbc-migrated-config` | `EFLohDsDiSHSNrPj6a3EWzMVKTSvjVDdzZSnwW4CYdKD` | Quote mint wSOL                                  |
| `damm-migrated`       | `9nScc7xkdzyawXA64cnamkFo7asCMDXKGqNQpsX1WPtp` | Sqrt price `125545362027818175`                  |
| `damm-customizable`   | `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` | Canonical DAMM migration config                  |

The active DBC mint is `8SAaSSvJ3i4FRzzGWavfJfwJ2XDk63GrchsmNRqjjDV`.
The migrated DBC and DAMM v2 mint is
`EkHFmmqJMz95jaeNGj9onEAtzWdLtjqmRNsqov28BAGS`. Six token-vault captures accompany
these pools. Owners are checked in the capture script. The active pool was found
with `getProgramAccounts`, then all retained evidence was obtained with
`getAccountInfo`.

From `app/`, re-capture using the existing workspace dependencies:

```sh
node fixtures/meteora/capture-mainnet.mjs
```

The optional `MAINNET_RPC_URL` environment variable selects another RPC endpoint.
The script first verifies the mainnet genesis hash. It makes only
`getGenesisHash` and `getAccountInfo` calls. If the active fixture has migrated,
it fails explicitly instead of silently recording a different branch.

## Math and instruction evidence

The curve math mirror follows the pinned
[Meteora curve builder](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/a28b7239e71899eb52ff7aacac4dec90441885c4/packages/dynamic-bonding-curve/src/helpers/buildCurve.ts),
`buildCurve`, `getFirstCurve` and the integer curve helpers. This reference SDK
checkout is pinned at `a28b7239e71899eb52ff7aacac4dec90441885c4`; the launch
mirror adds no Meteora dependency. The deployed source pins define instruction
ABI and rounding.

`mainnet-launch-simulation.json` is a fresh unsigned mainnet capture at slot **454848440**. `verify-mainnet.ts` creates ephemeral public identities in memory and only calls `simulateTransaction` with signature verification disabled. It does not read a key file and never broadcasts. Run from `app/`:

```sh
node --import tsx fixtures/meteora/verify-mainnet.ts
```

The capture combines config creation, pool initialization and the exact-output dev buy to preserve simulated state across instructions. Its short test metadata keeps this combined proof under the packet limit; production creates the config separately, then sends the single launch transaction using the frozen lookup table. This proof excludes the Onepercent `power_on` handler and deposit, which are exercised by the separate local flow.

Observed results:

- No simulation error; 196,317 compute units.
- All decoded D29 config fields match the expected immutable config.
- SPL supply exactly 1,000,000,000,000,000 units, mint and freeze authorities null.
- Exactly 40,000,000,000,000 units bought for 1,192,328,122 lamports.
- Quote reserve 1,162,519,918; partner fee 23,846,564; protocol fee 5,961,640; creator fee 0.
- Next sqrt price 101,353,483,280,186,128, matching the integer exact-output mirror.

The exact curve values and derivation are recorded as EXT (Meteora) in PARAMS §11.1.1. Changing the threshold recomputes the curve before config creation. The default 20.7% migration allocation yields approximately 27.979690688 SOL initial market cap and 410.628019323 SOL migration market cap, with 79.2999988514609% sold on the curve.

The migrated fee-mode enum is venue-specific: DBC quote-only `0` becomes DAMM `OnlyB = 1`. Migration fee option `6` selects Customizable, required for 250 bps. Optional creator/partner migration fees and pool creation fees are zero. DAMM's protocol migration liquidity fee is external program behavior, not a user-configurable D29 fee.

## Local validator launch and migration

`validator-launch.ts` uses solana-test-validator 4.3.0 and the exact program
binaries in `programs.json`. It runs without a remote RPC after fixture loading.
The disposable launch signers exist only in memory. The validator ledger and its
own generated identities are temporary and removed when the process exits.

Run from `app/`:

```sh
CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2 pnpm e2e:validator launch
```

Build `target/deploy/onepercent.so` with `pnpm program:build` before this run.
The fixture runs the CLI execution core through `launch config`, `launch lut`,
`launch plan`, `launch check` and `launch send`, then reloads the same journal
and runs `launch report`. The resumed send returns the identical signature and
the finalized report passes. The mint and DBC pool addresses
are both pre-funded System accounts before launch. The frozen launch table has
17 addresses. The real M4.1 rehearsal on 2026-10-09 uses a 787-byte transaction
and consumes 213,717 compute units in simulation. `validator-launch.json` records
the Onepercent program artifact SHA-256
`8a87be50958865b5c977e195ef0ba9e1b4d5976c74c99202384b1d3a986a9547`.
The plan, check and finalized send all pass. The vault ends with
40,000,000 $1PCT and the launch token account is closed. The dev buy incurs
29,808,204 lamports of trading fees: 23,846,564 to the partner and 5,961,640 to
Meteora. The config's partner is FeeIn.

The initial launch capture used a local substitute while M4.1 was unavailable.
That substitute has been removed. The current `validator-launch.ts` loads the
real Onepercent program and uses M4.1's cluster-aware `powerOnIx`; its local
config signer is the pinned public test-only signer described above. Fresh
`validator-launch.json` records the real handler rehearsal. The local landing
policy only supplies test transport settings and cannot be selected for mainnet.

The next partial-fill buy reaches a quote reserve of 85,000,000,001 lamports.
The one-lamport excess is exactly the sum of the two rounded-up input deltas in
the math mirror; the configured threshold remains 85,000,000,000. Migration
then creates a DAMM v2 pool with these verified fields:

- Base fee numerator 25,000,000, equivalent to 250 bps; mode 0; scheduler periods,
  frequency and reduction all zero.
- Collect-fee mode 1, DAMM's quote-only mode; dynamic fee and compounding off.
- Position NFT owner FeeIn; unlocked and vested liquidity zero.
- Pool liquidity, pool permanently locked liquidity and position permanently
  locked liquidity are all 77,222,686,168,650,494,068,152,987,524,501. Thus all
  issued LP is permanently locked to the FeeIn-owned position.

The deployed DBC charges a separate, fixed protocol liquidity migration fee of
20 bps. This run records 414,000,004,754 base units and 170,000,000 quote lamports.
The new DAMM pool starts with 206,586,002,372,721 base units and 84,830,000,000 quote
lamports. This external migration cost is separate from the 250 bps trading fee
and the config's zero optional migration fee.

DBC's global pool authority must have SOL to lend rent during migration. The
`accounts/dbc-pool-authority.json` snapshot records its mainnet System account at
slot 454,849,667 with 68,821,882,530 lamports. The migration implementation's
`instructions/migration/flash_rent.rs` spends from that authority, then reimburses
it from the migration payer in the same transaction. The rehearsal verifies its
balance is unchanged and records a payer debit of 22,616,080 lamports for rent
and transaction fees: 22,606,080 lamports of rent and a 10,000-lamport transaction
fee. No mainnet account is funded by this test.

A subsequent 1,000,000-token DAMM buy also passes the math mirror: 423,205,512
lamports in, 10,580,138 total fee, 2,116,027 protocol quote fee, zero protocol
base fee and exact output and sqrt price. `validator-launch.json` records the
commands and observations; `accounts/local-damm-*.bin` and matching metadata
retain the locally generated account bytes and hashes. These are local replay
vectors, distinct from the unsigned mainnet simulation vectors.

`refresh-mainnet.mjs` records mainnet program data and the two supporting
accounts. Account data and owners are unchanged when loaded locally; only the
account JSON's `rentEpoch` is normalized to zero because the RPC's u64 maximum
cannot round-trip exactly through a JavaScript number.
