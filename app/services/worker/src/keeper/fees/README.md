# Launch trading-fee keeper

This lane runs inside the existing keeper leadership term and serial durable
`keeper_jobs` queue. It adds no service key or private-key database column.
The launch scope stops phase automation at BuysClosed. Final Pull claims and
Burn after Done are separate milestones; HOLD is disabled at launch (D18).

The reader checks the pinned DBC config, canonical curve and migrated DAMM pool,
position identity, and FeeIn NFT ownership from RPC. The position is selected
from the successful finalized DBC migration instruction, including CPI and v0
loaded accounts, then its DAMM PDA, NFT mint and current FeeIn ownership are
validated. Extra positions donated to FeeIn are irrelevant. The RPC must retain
the migration transaction history; missing proof defers collection. Finalized
provenance is cached for the process lifetime, while ownership is reread each
time. The current DBC surplus
flag decides whether the Pool transaction also needs Surplus. A database flag
never selects that instruction. Each collection is Curve or Pool, optionally
Surplus, then `collect_creator_fees`. A rent increase prepends only the FeeIn
shortfall from the keeper, measured with `getMinimumBalanceForRentExemption`.

PoweredOn to OnAir appends `advance_phase` to the same collection transaction.
The existing phase job closes buys, then the queue immediately discovers the
BuysClosed collection. Last-minute and BuysClosed jobs have durable identities
per season. Other collections use a reproducible hash to choose a 120 to 300
second interval; restart and leadership changes preserve the same cadence.
An unresolved fee signature blocks another periodic collection. Empty periodic
collections are skipped. A fresh zero fee balance never proves a signed job
completed: the sender must reconcile its persisted signature. Discovery and
the job drain share the same retry predicate. Exhausted definitive failures
retain their journal but allow a new periodic intent after the normal cadence;
exhausted ambiguous signatures continue to block it.

Configure `PROTOCOL_LOOKUP_TABLE` with the active frozen protocol lookup table.
The reader verifies the table owner and frozen authority. SDK builders and the
sender reject transactions larger than the packet limit. The keeper's configured
program address and Meteora config are selected together for its cluster.

The DBC migration backup uses the pinned external ABI and a disposable NFT mint
account signer. Only public account addresses and fully signed transaction bytes
enter the journal. The extra signer exists in memory until signing or leadership
loss. A restart resubmits the saved bytes without that signer. A different mint
is generated only for a fresh build after the sender's finalized expiry/history
reconciliation. TxSender accepts this one explicitly listed additional signer
and verifies both signatures; its default remains payer only.

Migration uses DBC's existing global authority rent reserve. This lane does not
fund that authority: a missing external reserve causes simulation failure and
a durable job alert. The observed local rehearsal's setup funding is not a
production funding instruction.

FeeIn silence compares current curve reserves or DAMM vault balances with the
previous Redis observation and the latest positive indexed fee collection. It
alerts after the configured silence window only with recent reserve activity,
and escalates after two windows. Observation failures are logged and never
classified as recovery. Nonzero base fees raise `launch_base_fees`; M4.1 retains
any DAMM base proceeds in FeeIn's canonical token account and continues SOL
collection. Authority/config/NFT mismatches raise `fee_in_creator_changed`.

The reader defers fee work when Machine records an exec in flight. Claims and
collection are composed only in their own transaction, never inside a stock,
Burn or JackpotBuy exec pair. P1 enforces this again on chain.

## Decisions taken

- Use finalized migration history because the pinned DBC v2 metadata does not
  store the migrated position address. Never infer provenance from the number
  of FeeIn-owned positions or their liquidity. The [pinned DBC migration](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/f552f20aa3c1c7631427c3827aeea7c58b902813/programs/dynamic-bonding-curve/src/instructions/migration/dynamic_amm_v2/migrate_damm_v2_initialize_pool.rs)
  assigns the first position to the partner under the launch profile.
- Share retry eligibility between discovery and processing so an exhausted,
  proven terminal failure cannot permanently stop periodic collections.
