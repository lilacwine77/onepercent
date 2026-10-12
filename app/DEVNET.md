# Devnet: P3 upgrade precondition

P3 uses reserved bytes: Machine stays 3,808 bytes. No realloc, funding transfer,
admin attestation or reset instruction is added. Fresh initialization starts the
unsettled-reveal counter at zero with complete history. Mainnet starts fresh and
must not use this legacy devnet procedure. The deployed devnet identity and
cluster build instructions live in [DEVNET.md](../docs/codex/DEVNET.md).

The operational entry point is `node scripts/devnet-deploy.mjs --upgrade
--expected-sha256 <reviewed-devnet-ELF-hash>` from `app/`, after the devnet feature
build and release check. It enforces the following sequence, including on resume:

1. Use the existing guardian instruction, signed by the configured devnet admin,
   to set only `PAUSE_BITS.rip`. Wait for finalization, then read Config at a
   finalized slot and verify the guardian Rip bit. Other pause bits are preserved.
   VRF callbacks, settlement, refunds and all other exits remain available.
2. Inventory Pulls with finalized `getProgramAccounts`, the Pull discriminator
   filter, and `minContextSlot` at least the finalized paused Config slot. Validate
   ownership, discriminator, quantity, mask, status and canonical PDA. **Every
   Pull blocks the upgrade**, including Pending, revealed and partially settled.
   A final settlement/refund normally closes the Pull; even a fully settled
   account still present blocks this deliberately strict inventory.
3. Poll for at most 150 inventories, with 2 s between attempts. Outstanding draws
   must reveal and settle, or time out and be refunded. On timeout, invalid RPC
   data, a missing pause or any error, stop and leave Rip paused. There is no
   automatic settlement, no new authority and no exit attestation.
4. Check the finalized pause and empty inventory again immediately before each
   loader upgrade broadcast, including retransmission of a persisted signature.
   Keeping Rip paused and having no Pending Pull prevents a pre-upgrade callback
   from creating an uncounted reveal between inventory and execution.
5. After verifying the deployed bytes, repeat the pause and empty inventory check
   at a finalized slot at least the deployment slot, before calling the existing
   permissionless `advance_phase`. Check again before each activation broadcast.
   Then verify `last_reveal_ts > 0`, `pending_pulls == 0`, `unsettled_reveals == 0`
   and empty inventory. Activation retains normal phase transitions; it introduces
   no program-side gate or new failure condition in callbacks or exits.
6. Only then remove the guardian Rip bit if this run originally added it. An
   existing guardian pause stays set. The resume transaction also checks empty
   inventory before broadcast. The compiled 30 s StockBuy delay still applies.

The journal stores P3 progress under the reviewed artifact hash, independently of
ProgramData's changing slot. A restart with the upgraded artifact already present
still performs activation. Never delete uncertain transactions: rerun the same
command to reconcile their signatures. Run only one sending script at a time.

`node scripts/devnet-upgrade-preflight.mjs` is a **read-only diagnostic**: it now
requires a finalized guardian Rip pause and zero Pulls, and cannot replace the
upgrade entry point. The disposable `devnet-upgrade-drill.mjs` has no initialized
Machine: before every upgrade broadcast it instead requires absent Config,
absent Machine and zero Pulls. It cannot migrate the live Machine.

Legacy listing timestamps remain zero; they do not reconstruct historical notice
periods. Legacy payout bounds use the already retained current hour; unknown
previous-hour windows refuse buys. Inflow history becomes complete after the
necessary hour transitions, documented in
[P3-KEEPER-HISTORY.md](programs/onepercent/P3-KEEPER-HISTORY.md).

The regression tests cover an old Pending Pull, its reveal before upgrade, and
an additional new reveal: preflight refuses each nonempty inventory, so the old
settlement cannot consume the new reveal's counter through this migration path.
Post-upgrade inventory rejection also keeps activation and Rip resumption blocked.
This branch's automated validation does not deploy or pause the live devnet.
