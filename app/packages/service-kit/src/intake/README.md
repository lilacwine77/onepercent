# Intake provenance

Pure rules for M2 §11.4, shared by the FEED signer and the indexer fallback.
There is no I/O and no mutation of consumption or live-card state here.

`normalizeHistoryTransaction` takes a Helius full `jsonParsed` transaction.
Failed transactions return `null`. Missing balances, owners, inner instructions,
unsafe numeric lamports, or undecoded System instructions fail with
`EvidenceUnavailableError` for successful transactions. Failed rows still need
an explicit error, a signature, and a valid slot before they can be ignored.
The caller must obtain every history page at a fixed
confirmed upper slot before supplying `complete: true` to `analyzeWalletHistory`.
The latter reconstructs balances per token account, retaining accounts untouched
by a later transaction. Missing account history and ambiguous same-slot ordering
also fail closed.

The first inflow uses net wallet balances across every account. A signed decrease
in another token proves spending. For native SOL, the fee is subtracted only when
the wallet is the fee payer. Account creations include inner instructions and
the prefunded `transfer` + `allocate` path. Their funding is a conservative upper
bound on rent until exact historical rent is provided through
`rentForCreatedAccount`. No rent rate is invented. If rent could explain all
native spending, classification is unavailable rather than treating the inflow
as a purchase or a transfer. An optional rent resolver must provide evidence of
the actual rent paid, not a current rent estimate for an old transaction.
For temporary token accounts already closed by transaction end, ownership can
come from an unambiguous parsed initialization by SPL Token or Token-2022.
A native-token account created and closed back to its paying wallet in the same
transaction is rent-neutral (D22), provided its native mint, owner, destination,
and zero pre/post account lamports establish that lifecycle. Other ambiguous
bags are refused independently of valid bags in the same request.

`evaluateFeedProvenance` requires fresh balances, team membership, consumption,
and live-card reads from its caller. It returns only the soft-rule verdict; token
safety, whole-bag checks, phase, cap, expiry, signing, and append-only logging are
the API service's responsibility. Sender history is required only for a possible
one-hop transfer. A sender whose first inflow was a transfer never qualifies.

`createWalletHistorySnapshot` produces compact evidence up to `S`: the first
inflow and per-account balances. `analyzeWalletHistory` can resume from that
snapshot while replaying every transaction after `S`. The API caches only this
prefix for `SERVICES.signers.evidenceCacheSeconds`, with a 256-entry memory
bound. Live history, balances, consumption, and verdicts are read again. Four
concurrent history workers share the existing 10 s transport deadline; accepted
bags and cap allocation keep request order.

`recomputeProvenance(input, readBeforeFeed)` and
`createProvenanceRecomputer(readBeforeFeed)` adapt these rules to S1's landed
Feed fallback signature. The reader must reconstruct evidence immediately
before the identified Feed, including historical balance and consumption, and
bind it to that slot and transaction signature. Current post-Feed balances and
mismatched amounts are refused. Returning `null` leaves the indexer to record
its explicit unknown provenance and alert.

The tests are explicitly synthetic. The S6 corpus of 20 real wallets is absent
from this checkout; its expected verdicts, reasons, dates, latency, and provider
cost cannot be represented as validated by these tests.

The shared entry point is `@onepercent/service-kit/intake` (D22). The ATA identity
comes from canonical config. The Token-2022 native mint remains a local external
identity because config does not export it; service-kit does not add an SDK
dependency solely for this constant. Neither value is an economic default.
