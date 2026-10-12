# Season executor

The launch service plans Burn and JackpotBuy from confirmed Machine, Config and canonical Meteora account reads. It uses chain time, the configured minimum tranche, independent random timers, one serialized signing path and its own `onepct:executor` PostgreSQL advisory lock. Burn stops at Done under D18. No holder attester or final claims are implemented here.

`executor_jobs` persists the exact instruction plan, lookup table contents, signed bytes, signature and cumulative signing-attempt budget before sending. A replacement leader first reconciles that record through `TxSender`. Confirmed-but-unfinalized records remain pending. A quote is rebuilt only on a later tick after the sender proves the old transaction failed or expired using finalized history and state. A failure, pause or missing dependency never creates a new signature for an ambiguous intent.

A second simulation can reject a persisted plan before signing. The store retires it only through an atomic, current-leader update that verifies no transaction record exists. A later tick, including after restart, reads fresh state and gets a new quote. Signed or unreadable journal evidence cannot take this path.

The shared Sender helper sends the same signed bytes through plain RPC on transport failure. If that fallback rejects, the original Sender submission remains ambiguous: fallback preflight cannot authorize a replacement. Signature history and finalized expiry still decide reconciliation. On mainnet, Sender tips come from `SERVICES.landing.tipLamports`. Both that value and the priority-fee cap remain pending their owning milestones' measurements. No substitute amount is used. The executor wallet supplies only fees, tips and account rent. Every swap input comes from the paired program instructions and is consumed inside the pair.

Both timers reconcile pending intents of either kind before planning a fresh trade. The native source ATA is created if absent, closed to the executor, and recreated immediately before `exec_begin`, all in the same atomic transaction. This separates outside credits, including a donation of one wSOL lamport, from execution input. Residue is checked against the source account's `postTokenBalances` in the matching transaction receipt, including loaded lookup-table keys. For previously signed plans without the reset, the historical `preTokenBalances` supplies the baseline. Missing evidence or a nonzero execution residue keeps the intent pending; a real residue emits `executor_residue` and cannot be reset by the other timer or a new process. A later outside donation cannot alter that historical check.

Before any unsigned intent can proceed, the executor also checks the latest finalized successful receipt of each kind. This covers older releases that persisted finality before checking residue, including a crash between those steps. The history lookup is scoped to the deployment and verifies signed bytes before selecting the current executor's payer; a previous role holder's source ATA is separate. Missing history fails closed, and validated receipt bindings are cached for the term.

The two business timers share a term cancellation signal. An unexpected timer failure cancels and drains its sibling. Alert persistence failures are logged without terminating the business loops.

## P1 integration

`p1.ts` binds the SDK's actual `checkExecBegin` and `composeExecTransaction` exports and derives its types from them. Production uses that binding by default. The selected cluster deployment supplies the program ID and the DBC config pin to account reads, PDA derivation, builders and preflight.

The reader discovers venue addresses, then reads Config, Machine, Clock, mint, ledger, vault, source ATA and all oracle accounts in one RPC bank snapshot. P1's `readMeteora` validates both the DBC and DAMM paths. Tranche sizing uses recorded quote reserves, excluding accrued fees and donations. An absent canonical source ATA is modeled after P1's idempotent preparation, with rent obtained from RPC; the full unsigned transaction is then simulated.

P1 adds source ATA preparation itself. The service checks the complete compiled message and runs preflight again against its final instruction list. Fee collection and claims remain separate transactions: no additional Onepercent instruction can enter the exec pair. Journal intents bind the cluster and program ID; another selected deployment cannot replay them.

The unsigned `executor:dry-run --cluster mainnet` uses the same reader, preflight and composer without loading a signing key or submitting a transaction. The existing landing tip and priority-fee measurements are still PENDING in config. Until supplied by their owning milestones, mainnet startup and dry run report `executor_landing_parameters_pending`; no replacement amount is invented.

The local test-transfer adapter is refused for every cluster other than devnet and localnet. A rehearsal must supply tokens in the disposable executor's token account and a separate rehearsal-owned wrapped SOL account in `EXECUTOR_STUB_QUOTE_ACCOUNT`. The adapter transfers the exact exec input there and the expected tokens into the program vault, inside the pair. Neither mainnet nor a user wallet can use this adapter.

Boot, leadership acquisition and each trade-state read verify the actual RPC genesis. Devnet and mainnet must match their pinned network identifiers. Localnet also requires a loopback RPC endpoint and refuses either public network's genesis. A mismatched `CLUSTER` variable cannot enable test transfers on a mainnet endpoint. The source ATA must be an initialized native SPL account for wSOL owned by the executor.

## Decisions taken

- Use P1's exported types and implementations directly, with one coherent account snapshot per preflight and deployment-bound retry evidence.
- Add an executor journal table because the brief's trade-history rows cannot preserve signed bytes and safe retry state across restarts.
- Keep the Jupiter build request local because the installed market client lacks B11's `wrapAndUnwrapSol` option. The request fixes that option to false and reads returned lookup tables from chain.
- Serialize the two independent timer callbacks because they share one source account and one fee wallet.
- Retain pending confirmation evidence until finality and record slippage from the matching transaction's `ExecEnded` event, never from a global balance difference.
- Validate the complete compiled P1 message against the required instruction order, account bindings, sole executor signer and read-only ordering-protection account. Receipt attribution also binds mint, bucket, kind, input, minimum output and a newer trade timestamp; a stale unsigned intent is skipped without claiming execution.

The known loss bound for mutable-reserve assets remains the on-chain tranche, spacing and caps until the guardian disables the executor. The reserve-based min-out is not an independent price oracle.

Devnet selects the already approved `devnet-rpc-p75-v1` profile at bootstrap and
in the unsigned dry run: plain RPC, p75 measured by `TxSender` for each signed
attempt, 1,000,000 micro-lamports/CU cap, no Sender instruction or tip. Mainnet
continues to require its measured landing parameters; the devnet profile cannot
fill them. A nonzero tip is rejected when composing a devnet executor plan.
The policy minimum and all on-chain tranche, spacing and hourly caps are unchanged.
