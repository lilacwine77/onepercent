# Final Pull upgrade, D18 / D37

This delivery extends the 48-hour season from merged PR #83 and includes the
public mainnet inputs from merged PR #84. The branch is based on main commit
`8234a08`. Neither merge is a deployment confirmation.

The existing Machine remains 3,808 bytes. Config, Binder, Bucket and Card keep
their deployed sizes and offsets. The snapshot uses the already reserved
`final_sol_total`, `final_1pct_total` and per-bucket `final_pool` fields. No
migration or Machine/Config realloc is required. The only growing user account
is the ordinary Binder when its owner claims nonzero Final cards.

## Behavior and accounting

`advance_phase` closes buys at the stored `end_ts`. Anyone can call
`start_final_pull` in BuysClosed at `end_ts + 600`, with no pending draw or
executor pair. Revealed draws need not be settled first. Late settlement stays
available; amounts that previously returned to stock now credit `burn_sol`.

The snapshot freezes stock plus Jackpot SOL, every remaining listed bucket
including disabled buckets, and unpulled The 1% amounts plus Jackpot tokens.
Pack burn, team SOL, deposited Dust Cards and existing user cards remain separate.
Claims use floored pro rata shares of revealed pack spend. Refunded purchases do
not count. Snapshot totals never decrease; remaining balances decrease by actual
claims. Rounding remainders remain tracked and are never redirected to team.

SOL claims are permissionless and idempotent. Uncreditable owners receive their
share as backed `Binder.sol_owed`; `withdraw_owed` remains available. Token
claims require the owner and create Redeemable Final cards, ordered $1PCT then
bucket index. Zero claims set their bits too. Neither claim has an expiry,
pause bit, Config dependency, attestation, oracle, quote API or keeper requirement.

Done becomes due 259,200 seconds after `final_ts`. It does not expire claims or
remove the upgrade authority automatically. Only Burn becomes permissionless in
Done. The existing paired execution, canonical mint and venue checks, price
reference, `min_out`, tranche, spacing and hourly cap all remain. A caller can
move venue reserves; the loss bound is the tranche and recurring caps, not a
promise of bounded total loss over time.

The final accounting is independently reconstructible from `FinalPullStarted`,
`FinalSolClaimed`, `FinalTokensClaimed`, `PhaseAdvanced`, Machine and Binders.
`final_pool_sol + paid SOL = final_sol_total`; token pool balances plus issued
Final-card amounts equal their frozen totals. Token ledgers do not change when
cards are issued. Redeem reduces the corresponding ledger and vault together.

## Conservative implementation choices

- Both claims reject an in-flight executor pair. This is a transaction-local
  accounting lock, with no pause or service dependency.
- A positive SOL claim requires current sysvar rent plus all tracked Machine
  liabilities to be backed. An underfunded account fails atomically without
  consuming the claim bit; a permissionless top-up restores the exit. This also
  avoids silently accepting a partial payment after a rent increase.
- SOL pushes use one durable job per Binder instead of a shared multi-owner
  transaction. Each recipient keeps independent finalized reconciliation and
  retry history. Owners can always invoke either claim directly.
- Empty vault closes stay available. A Done Burn may recreate its closed,
  canonical empty ledger using the caller's SOL; its ATA is recreated with the
  standard associated-token instruction before the pair. SDK callers opt in with
  `composeExecTransaction({ ..., restoreTokenVault: true })` after detecting
  a closed vault. Supply one explicit compute limit for the original route;
  the composer adds the measured 53,000 CU restoration allowance, capped at
  the runtime maximum. Simulate the complete route. Ordinary season
  transactions keep their existing shape and budget.
  Preparation leaves existing cards, claims and vault tokens untouched; the
  caller pays account rent. Done Burn is available through the SDK; the keeper
  cranks season transitions and SOL claims, not automatic Done Burn trades.

## Build and review before the 48-hour deadline

Use a clean reviewed checkout containing the actual mainnet release inputs.
The checked-in `release/mainnet.json` contains PR #84's public pins. Do not
invent or substitute deployment addresses. Verify the existing program ID,
DBC config and economic constants against the running season before the
upgrade. D31 uses the founder's upgrade authority
with no timelock; D36's launch wallet is a separate role.

From `app/`:

```sh
export CARGO_BUILD_JOBS=3 VITEST_MAX_WORKERS=2
pnpm release:mainnet:check
ONEPERCENT_CLUSTER=mainnet pnpm params:rs
ONEPERCENT_CLUSTER=mainnet pnpm params:rs --check
ONEPERCENT_CLUSTER=mainnet pnpm program:build
pnpm program:release:check --cluster mainnet
```

The cluster wrapper passes Cargo `--features mainnet`; a localnet artifact is
not a mainnet artifact. Check sBPFv3 flags and the mainnet program identity.
For the reproducible production artifact, commit the reviewed applied release
inputs and run `pnpm program:release:build --cluster mainnet`. The existing
release recipe explicitly builds `--features mainnet`, compares two independent
builds, and writes the artifact and manifest under `target/release/mainnet/`.
Record the source commit, release-input hash, Cargo lock hash and binary SHA-256.

Before upgrade, archive a finalized read of Program/ProgramData, Config,
Machine and outstanding Pulls. Record program authority, account sizes,
`on_air_ts`, `end_ts`, phase, pools, all ledgers, pending count and last slot.
Use RPC rent queries for buffer/ProgramData funding and retain the rescue CLI.
Keep the existing program address. Do not initialize again or rerun Power-On.

## Sign the upgrade

The founder reviews the binary hash and signs with the current upgrade authority.
The fee payer supplies rent and fees. No service or user signs for the founder.
The exact signer URIs are supplied by the operator, never committed.

```sh
solana program show "$FINAL_PULL_PROGRAM_ID" --url "$FINAL_PULL_RPC"
solana program deploy target/release/mainnet/onepercent.so \
  --program-id "$FINAL_PULL_PROGRAM_ID" \
  --upgrade-authority "$FINAL_PULL_UPGRADE_SIGNER" \
  --fee-payer "$FINAL_PULL_FEE_PAYER" \
  --url "$FINAL_PULL_RPC"
```

Check ProgramData capacity before sending; if the CLI requires extension,
fund only the required program-data increase using live rent. Application
accounts are not reallocated. The upgrade workflow and authority requirement
follow the [Solana deployment reference](https://solana.com/docs/programs/deploying).
This PR does not execute an upgrade or seal the program.

## Post-upgrade verification

1. Wait for finality. Record signature, slot and ProgramData authority. Dump the
   deployed program and compare its executable bytes to the reviewed artifact,
   allowing only the loader's trailing allocation padding.
2. Compare Config and Machine with the archived snapshot at a consistent RPC
   bank. Their sizes and economic parameters must match. Explain expected
   intervening user transactions from their events; an upgrade itself writes
   neither account.
3. Simulate direct RPC rescue exits for existing positions. Confirm the new
   instruction discriminators work; before the deadline `start-final-pull`
   must refuse with its phase/time guard. Do not change season timestamps.
4. Deploy the matching SDK, rescue CLI and keeper. Verify fresh chain reads and
   finalized job reconciliation. At `end_ts + 600`, with no pending draw,
   observe FinalPullStarted and compare every frozen pool to the preceding
   state. Recover stale draws with existing settle/refund exits.
5. Exercise a consenting owner's SOL/token claim and Redeem, checking exact
   floor shares, token ledger backing and both claim bits. A keeper SOL push
   does not require the owner's signature. Keep RPC-only commands available.
6. At `final_ts + 259,200`, crank Done. Check late claims and permissionless
   Burn under its existing caps. Removing the upgrade authority is a separate,
   irreversible founder action after these checks, never part of this upgrade.

No mainnet transaction or live production-state verification is claimed by the
local test report. The compatibility fixture proves upgrade behavior for the
captured prior localnet build of commit `07669e889388ee592f29d4c1c89bcefa5cd58ce7`;
the release operator must also compare the actual deployed binary and accounts.
