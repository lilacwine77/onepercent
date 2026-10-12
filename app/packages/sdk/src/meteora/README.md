# Meteora launch adapter

D29 fixes the Onepercent launch profile: legacy SPL Token, fixed one-billion supply, SOL quote, flat 250 bps, no dynamic fee, FeeIn as partner and all partner LP permanently locked. `buildDbcLaunchConfig` computes this profile from the migration threshold, defaulting to 85 SOL. Its integer formulas and external constants are recorded in PARAMS §11.1.1.

`createDbcConfigIx` sets both fee destinations to FeeIn. `dbcConfigMismatches` compares every active config field, including computed curve values, vesting, creator share and post-migration fee settings. Account padding is ignored. The decoders verify Anchor discriminators through the pinned account coder. Callers must check account ownership and PDA addresses separately.

`quoteDbcExactOut` quotes an untouched pool and rejects output beyond the migration threshold. The atomic launch initializes the pool and buys before any other transaction can trade. The gross input is the exact maximum input with zero slippage by default. `dbcSwap2Ix` encodes ExactOut (2), with desired token output in `amount_0` and maximum SOL input in `amount_1`. Pool initialization does not create user ATAs: the caller creates both SPL token accounts, wraps SOL and closes the wSOL account afterward.

`quoteDammV2ExactOut` accepts the D29 migrated pool profile only. DBC and DAMM use the same Q64.64 concentrated-liquidity delta formulas and fee rounding for this profile. `quoteMeteoraSell` covers a sale inside one segment, with fees in SOL output; it rejects a crossing below the supplied segment boundary. These are bounded profile mirrors, not general support for arbitrary Meteora fee schedulers, dynamic fees or compounding pools.

The migration builder creates a single partner position and omits the creator position. DBC's quote-only enum 0 maps to DAMM OnlyB 1. The claim builders are SDK surfaces for M4.1 CPI and the separate services track. This module does not implement the keeper or hold a FeeIn signing capability.

Fixtures, licenses, pinned source references, deployed binary hashes and unsigned mainnet captures are documented in `app/fixtures/meteora/SOURCE.md`. The `encodeDbc*Fixture` functions only create synthetic account buffers for tests; they do not claim to be mainnet observations.
