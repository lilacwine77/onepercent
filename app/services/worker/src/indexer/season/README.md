# Launch season indexing

The existing ordered indexer writes `CreatorFeesCollected` into
`creator_fee_collections` and records Power-On in `season_launches`. Every
revealed pack now stores its own `live_flags`; old rows stay null until replay,
so missing historical evidence never becomes a false zero.

Block-0 uses the DBC launch pool from `PoweredOn.launch_pool` and includes the
launch transaction explicitly. It scans all signature pages, retains the
half-open `BLOCK0.slots` window, excludes the pool base vault, aggregates token
changes by owner, and labels Config roles and the vault's disclosed dev buy.
SOL spent is the observed payer balance decrease, including transaction costs;
non-payers have no SOL amount. A missing transaction, token owner, account or
dev-buy row keeps the board pending. It does not stop normal indexing.

The board waits until confirmed is strictly past launch plus the window plus
32 slots, and additionally requires the full external window to be finalized.
External DBC transactions are not in Onepercent's program history. This extra
finality check avoids publishing rows that a later external fork could remove.
The complete replacement and ready marker commit together under the existing
indexer advisory lock. `Block0Indexer.poll(..., true)` performs an explicit
rebuild with the same complete-evidence checks; a failed rebuild preserves the
last complete finalized board.

`IndexerBlock0Ready` is internal outbox metadata, never a decoded program event.
It is tied to the canonical launch transaction but ordered at the end of the
fully ingested scan slot using reserved uint32-max transaction/event indices
and instruction index -1. The existing publisher retries it and restores it
when Redis is reset. Later program events have a later slot. Its public body
contains only the marker name, launch signature and observation slot.

Replay rebuilds the fee-event mirror from retained chain events and preserves
`season_launches` and `block0_buys`, whose source is finalized external history.
Both retained tables participate in replay hashes. Their foreign keys delete
the entire board if its Power-On transaction is removed by fork recovery.
If a later fork affects the notification's observation slot while the finalized
launch survives, rollback removes that marker and returns the board to pending.
The next complete scan republishes it after replacement program transactions,
so its old order key cannot hide them from the stream.
Operational `executor_jobs` and `executor_trades` are independent of event
replay; the existing `exec_trades` remains the canonical execution-event mirror.

D18 excludes the holder attester and Final Pull claims from this launch lane.
No `hold_log` or `final_claims` table is added.
