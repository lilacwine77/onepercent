# D29: $1PCT launches on Meteora DBC (amends M4)

**Mainnet launch amendment, D31/D32 (2026-10-12):** D29's economics, immutable
config, FeeIn, LP lock and canonical-account checks remain binding. The atomic
launch sequence in §4 is now reserved for devnet/localnet; mainnet follows
[`DEPLOY-MAINNET.md`](DEPLOY-MAINNET.md). Pin the public address of the DBC config
keypair generated offline **before the build**, then create its account **after
Onepercent init**, before Proxima. The friend's Proxima Deployer wallet is the
registered launch wallet, receives the 40M dev buy directly and signs deposit
then Power-On in separate transactions. The one founder wallet receives Config
admin and upgrade authority after Setup preparation; no Squads or timelock.

Issued 2026-10-09 by the architect, on the founder's decision. Binding for M4.1 (program), M4.2 (launch tooling, keeper fee chain, API) and any copy that names the launch venue. Where this file conflicts with 04-M4-BRIEF.md or PARAMS.md, this file wins. The facts below were verified on mainnet by reading the deployed programs and running unsigned `simulateTransaction` calls on 2026-10-09:
- Meteora DBC `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, source commit `f552f20`.
- Meteora DAMM v2 `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`, source commit `a85c926`.

## 1. Why

pump.fun ignores a custom creator fee on SOL pairs: our income there would be 0.30% on the curve, then 0.95% stepping down to 0.05% after graduation. The founder wants about 2% of every buy and every sell.

A self-hosted Meteora Dynamic Bonding Curve (DBC) config delivers that:
- a flat 2.5% pool fee on the curve and the same flat 2.5% on the DAMM v2 pool after graduation;
- Meteora takes 20% of each fee, so **we net 2.0% per buy and per sell**, paid in SOL.

Trade-offs accepted by the founder:
- no pump.fun label;
- traders pay 2.5% per trade;
- the post-graduation fee is fixed at config time. Only a Meteora operator can change it later (up to 10%). We cannot.
- cheaper third-party pools can draw volume away.

The **Feed and the X-ray do not change**: they still accept and value pump.fun-born bags. Only $1PCT's own launch venue changes.

## 2. The DBC config (created once, before launch, by the ops wallet; it has no authority and never changes)

| Field | Value |
|---|---|
| Quote mint | wSOL. `collect_fee_mode` = 0, so fees are always taken in SOL |
| Base fee | Flat 250 bps: no scheduler, cliff = floor. Dynamic fee off |
| `fee_claimer` (partner) | The program's FeeIn PDA `["fee_in"]` |
| `leftover_receiver` | FeeIn PDA |
| `creator_trading_fee_percentage` | 0. The pool creator (the launch wallet) earns nothing |
| Token | SPL Token (`token_type` 0), decimals `TOKEN_1PCT.decimals` (6), total supply `TOKEN_1PCT.totalSupply` (1,000,000,000). `token_update_authority` = 1 (Immutable). Mint and freeze authority are null by construction |
| Curve | Reproduce pump.fun's shape so trenchers read familiar numbers: initial market cap ≈ 28 SOL; about 79.3% of supply sold on the curve; migration when the quote reserve reaches `migration_quote_threshold` = 85 SOL (85,000,000,000 lamports), market cap at migration ≈ 411 SOL. Use Meteora's curve builder math and record the exact sqrt prices and amounts in PARAMS. The founder may change the threshold before the config is created |
| Migration | DAMM v2, Customizable, with DAMM config `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck`. `migrated_pool_fee_bps` = 250, flat (base fee mode 0). Migrated collect-fee mode: quote only (SOL). Dynamic fee off. No compounding |
| LP after migration | `partner_permanent_locked_liquidity_percentage` = 100 and every other partner or creator liquidity share = 0. All LP is locked forever, and the position NFT goes to FeeIn |
| Migration fee option | The lowest available |

The config address goes into `ONCHAIN_KEYS.dbcConfig` (CONST, set once it exists). `onepct-ops launch check` re-reads every field above and is NO-GO on any difference.

## 3. Program changes (M4.1)

1. **`power_on` launch-pool check** replaces the pump.fun checks (brief §6.1 account 5 and check 6).
   - Account 5 becomes `launch_pool`, an `UncheckedAccount`. It must satisfy all of the following:
     - owner = DBC;
     - VirtualPool discriminator;
     - key = PDA(`["pool", dbcConfig, max(mint, wSOL), min(mint, wSOL)]`, DBC);
     - `base_mint` = mint;
     - `config` = `ONCHAIN_KEYS.dbcConfig`.
   - Read the config account as well (owner DBC, key = `dbcConfig`) and check that its quote mint is wSOL, `fee_claimer` = FeeIn and the creator trading-fee percentage is 0.
   - **Account list (binding for the SDK builder and the launch tool):** 1 `launch_wallet` (signer, mut), 2 `config`, 3 `machine` (mut), 4 `mint`, 5 `launch_pool`, 6 `dbc_config`, 7 `fee_in` (mut), 8 `ledger` (mut), 9 `vault`, 10 `vault_auth`, 11 `token_program`, 12 `system_program`. Every constraint from brief §6.1 is unchanged except for accounts 5 and 6.
   - Failures reuse the existing errors: `AccountMismatch` for keys and owners, `NotLaunchCurve` for field mismatches. Error numbers stay append-only. If a new error is needed, append it after P0's errors.
   - `mint_is_safe` and the decimals check are unchanged. They work for the SPL Token program.
2. **New instruction `claim_launch_fees(kind)`**: anyone may call it. It moves our fees from Meteora into FeeIn, and the existing `collect_creator_fees` then splits them (D27).
   - **`kind = Curve`**: CPI DBC `claim_trading_fee` (or `claim_trading_fee2`, whichever the deployed program exposes for partner claims), signed by FeeIn with `invoke_signed`. The destination is FeeIn's canonical wSOL ATA. Then close that ATA to FeeIn (unwrap), using M4-A3's pattern. Request the full quote amount and 0 base.
   - **`kind = Pool`** (after migration): CPI DAMM v2 `claim_position_fee`, with FeeIn as owner of the position NFT account. The quote amount goes to FeeIn's wSOL ATA, which is then closed to FeeIn. DAMM v2's `claim_position_fee` always claims both sides: the quote side follows the wSOL path above; any base ($1PCT) side lands in FeeIn's canonical $1PCT ATA (created idempotently) and stays there, never moved by our program. With quote-only fee collection it should be 0; a non-zero amount is emitted in `LaunchFeesClaimed { kind, quote, base }` so the keeper alerts. Base fees never block the SOL claim.
   - **`kind = Surplus`**: CPI DBC `partner_withdraw_surplus` into the same wSOL path.
   - Every CPI target program id is checked against the constants. Accounts are fixed per kind, with no remaining accounts. The instruction never touches the position NFT except as the owner signer for `claim_position_fee`. No instruction may transfer, close or delegate the NFT; add a test that proves it.
   - Saturating arithmetic. No pause bit and no Config read. It is a liveness path, like an exit.
3. **D27 split**, as recorded: BELOW_FLOOR 100% stock; SEASON 50/50 stock/team; AFTER_END 100% team; no creator-fee burn.
4. **Tests**:
   - load the DBC and DAMM v2 programs, and the real config and pool fixtures, into the local validator (`.so` dumps at the commits above);
   - full flow: create config, init pool, dev buy, `power_on`, a trade, `claim_launch_fees(Curve)` + `collect_creator_fees`, a buy past the threshold, `migration_damm_v2`, a trade on DAMM v2, `claim_launch_fees(Pool)` + `collect_creator_fees`;
   - assert the exact lamports at every step.

## 3b. Executor reads for $1PCT (M2 P1; replaces M2 §6.4 "pump.fun bonding curve" and the PumpSwap read for `$1PCT`)

Burn and JackpotBuy buy $1PCT. Under D29, $1PCT trades on the DBC curve before migration and on the canonical DAMM v2 pool after it. Trending hit tokens keep the PumpSwap read of M2 §6.4 unchanged.

- **Which pool.** Only the canonical pool counts. Before migration, that is the DBC VirtualPool at the D29 §3.1 PDA, with `is_migrated == 0`. After migration (`is_migrated == 1`), it is the DAMM v2 pool that DBC created at migration (PDA per the DAMM v2 IDL from DAMM config `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` and the two mints). Any other pool is `AccountMismatch`. Third-party pools may serve as the swap route, but never as the price reference.
- **Reference price.** Spot price from the pool's `sqrt_price` (Q64.64): `price = sqrt_price² / 2^128`, in quote lamports per base unit. Use u128/U256-safe integer math, and every division floors.
- **Buy only:** `L_eff = L × (10_000 − METEORA_FEE_ALLOW) / 10_000`, then `expected = L_eff × 2^128 / sqrt_price²`, then `min_out = expected × (10_000 − slip) / 10_000`. `slip` is `BURN.minOutSlipBps` for Burn and `JACKPOT.minOutSlipBps` for JackpotBuy.
- **Safety of the spot-price shortcut.** Spot price ignores price impact, so `expected` is an upper bound. A tranche that is too large fails `min_out`, which is safe, and the keeper re-plans smaller. The existing tranche caps apply.
- **New CONST** `METEORA.feeAllowBps = 300`. It covers the 2.5% pool fee plus a margin, and is used only for $1PCT reads.
- Field offsets come from the pinned IDLs (`fixtures/meteora/`, DBC `f552f20`, DAMM v2 `a85c926`) and are confirmed against mainnet account fixtures. Pin check values in Rust and SDK tests.

## 4. Launch tooling (M4.2)

1. **`onepct-ops launch config`** creates the DBC config from the ops wallet (D18 cap 5 SOL) in one transaction, verifies it by re-reading, and prints the address for PARAMS.
2. **The launch transaction** is one atomic v0 transaction (D28). It replaces brief §12.1 rows 3–5 with:
   - DBC `initialize_virtual_pool_with_spl_token` (signers: vanity mint, launch wallet as payer and creator; config = `dbcConfig`; name, symbol, uri);
   - create the launch wallet's wSOL ATA, transfer, `sync_native`;
   - DBC `swap2` for exactly `DEV_BUY` $1PCT (exact-out, or partial-fill), bounded by a quoted maximum SOL in;
   - close the wSOL ATA.

   Rows 6–10 are kept, with SPL Token in place of Token-2022: vault ATA, `transfer_checked` to the vault, `power_on`, close the launch ATA, tip.

   Measure the size with the frozen lookup table. Above 1,232 B is NO-GO; report the measurement to the architect.
3. **Checks** (`launch check`):
   - the config matches §2 exactly;
   - the pool address is absent (the mint classifier from the audit fixes applies to the pool and the mint);
   - the dev-buy quote comes from the DBC math mirror;
   - simulation post-state: pool fees accrue to the partner, FeeIn is the `fee_claimer`, the launch wallet ends with 0 $1PCT.
4. **Keeper fee chain** (replaces PARAMS §13.4 "Fee collection chain" and brief §11.2), every 2–5 min:
   - `claim_launch_fees(Curve)` while the pool is not migrated, or `claim_launch_fees(Pool)` once it is (plus `Surplus` once, after migration);
   - then `collect_creator_fees`, all in one transaction;
   - also crank DBC `migration_damm_v2` (permissionless) when the curve is complete and not yet migrated, as a backup to Meteora's migrator.
   - The FeeIn silence alert stays.
5. **SDK** `packages/sdk/src/meteora/**`:
   - DBC and DAMM v2 layouts and builders, read from the IDLs at the commits above (pinned under `fixtures/meteora/`);
   - fee and quote math mirrors;
   - golden vectors from the mainnet simulations.

   The pump SDK stays for the X-ray and the Feed.

## 5. Copy and docs

- Wherever $1PCT's launch venue is named, say Meteora.
- The fee disclosure: "2.5% on every $1PCT buy and sell: 2% to Onepercent (half to the boosters stock, half to the team), 0.5% to Meteora."
- Keep "Creator fees are split by the rule in force when they are collected", renaming "creator fees" to "trading fees" where the copy means ours.
- COPY.md and `packages/copy` stay in strict parity. No em dash.
- PARAMS: replace the pump launch rows (§13.4 EXT rows, "Launch settings" at line 454) with §2 above and the program ids. Mark them EXT (Meteora).
