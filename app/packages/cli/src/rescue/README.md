# onepct-rescue

The SDK discovers positions from Solana account data. The CLI talks only to the
explicitly supplied RPC; it needs no API, indexer, keeper, database or cache, and
no exit reads a pause bit. It uses the existing SDK builders for Take back,
Redeem, Settle, Refund, Withdraw owed, Close My cards (`close_binder`), Close
vault, Final Pull claims and the phase cranks. Final Pull transactions use only
chain accounts, without an attestation or service dependency.

## Get the CLI

### Standalone file (recommended for users)

From `app/`, with the pinned toolchain (`node >=22.22.2 <23`, `pnpm@10.34.5`):

```sh
pnpm install --frozen-lockfile
pnpm rescue:bundle
cd packages/cli/dist/rescue-release
shasum -a 256 -c onepct-rescue.cjs.sha256
node onepct-rescue.cjs --help
```

`pnpm rescue:bundle` runs `packages/cli/scripts/rescue-bundle.mjs`: esbuild
0.28.2 bundles the CLI and its dependencies into one CommonJS file, builds it
twice and refuses to write unless both builds are byte-identical. The output
directory holds `onepct-rescue.cjs`, `onepct-rescue.cjs.sha256` and
`manifest.json` (artifact SHA-256, the lockfile's SHA-256, the esbuild version
and the Node range). Paths inside the file are relative to `app/`, so the same
commit and lockfile give the same hash on another machine: anyone can rebuild it
and compare. The file needs only Node; copy it anywhere. An optional directory
argument (`pnpm --filter @onepercent/cli rescue:bundle <dir>`) writes the
release elsewhere.

### From the workspace

```sh
pnpm install --frozen-lockfile
pnpm build:libs
node packages/cli/dist/rescue/index.js --help
```

The package also declares the `onepct-rescue` binary for this build.

## Cluster and program id

`--cluster mainnet|devnet|localnet` defaults to `mainnet` (`mainnet-beta` is
accepted). Published ids live in `ONEPERCENT_PROGRAM_IDS` in
`@onepercent/config`: devnet is published, mainnet is `null` until P6 publishes
the founder's id. The CLI selects the deployment through the SDK's
`createDeploymentSelector` (`ClusterDeployment`):

- the published id for the cluster, or the `--program <ID>` given;
- with neither, exit 4 `program_id_not_published_use_advanced_program`: no id is
  ever guessed. Today this is the case for mainnet, and always for localnet;
- a `--program` different from the published id is reported as custom, with a
  warning to check its upgrade authority. `status` shows it from chain, and
  every command checks that the account is an upgradeable program whose Config
  PDA decodes.

The RPC genesis hash must match mainnet or devnet when selected; for localnet it
must be neither.

```sh
R="node onepct-rescue.cjs --rpc $USER_RPC --program $PROGRAM_ID"
$R status
$R find "$WALLET"
$R all --keypair /path/to/owner.json --dry-run
$R all --keypair /path/to/owner.json
```

## Commands

- `status`, `find <WALLET>`: read-only. The Clock sysvar supplies chain time;
  `status` also reports whether a phase transition is due.
- `take-back --entry <INDEX>... | --all`: owner-signed.
- `redeem --card <INDEX>... | --all`: owner-signed, every card kind.
- `withdraw-owed`: owner-signed; pays `min(sol_owed, Binder balance above rent)`.
- `claim-final-sol [--wallet <OWNER>]`: permissionless, paid with `--fee-payer`.
  The owner defaults to the fee payer; an explicit wallet receives its own share.
- `claim-final-tokens`: owner-signed. Creates Final cards; `redeem --all` then
  transfers their tokens to the owner.
- `close-my-cards`: owner-signed `close_binder`, returning the Binder's rent. It
  is planned only when the program's checks pass: no card, no FRESH card in the
  Deck or an unsettled Pull, no owed SOL, no open Pull, and either no season
  spend or both Final Pull claim bits set. Otherwise the plan names the missing
  step (`BinderNotEmpty`, `PullPending`, `FinalNotClaimed`).
- `settle --pull <SEQ|ADDRESS>... | --paying <WALLET> | --all-open`: fee payer.
- `refund --pull <SEQ|ADDRESS>... | --all-due`: fee payer, chain timeout only.
- `close-vaults --mint <MINT>... | --all`: fee payer; rent goes to the stored payer.
- `crank advance-phase`: fee payer. Sends `advance_phase` only when chain time
  makes a transition due (Setup to Stock-Up, Powered On to On Air, On Air to
  Buys Closed, Final Pull to Done), re-reading after each one, so several due
  transitions run in one command. Nothing due is exit 4 and sends nothing; an
  exec trade in flight is reported for a later retry.
- `crank start-final-pull`: permissionless, at least 600 seconds after `end_ts`,
  from Buys Closed with no pending Pull or trade in flight. Run
  `crank advance-phase` first if the season is still On Air. Unmet preconditions
  return exit 4; an already started Final Pull is a no-op.
- `all`: owner-signed Get everything back for one wallet, in this order: refund
  the wallet's timed-out Pulls, settle its revealed Pulls and those paying it,
  Final Pull claims, Redeem, Take back, Withdraw owed, Close My cards, then its
  vault deposits.

Owner commands require `--keypair <FILE>`. Permissionless commands require
`--fee-payer <FILE>`. The file is read once; no signer is read from environment
variables or stdin, and the CLI never asks for a seed phrase. Only public keys
and the RPC host are printed. `--unsigned` or `--dry-run` can use
`--wallet <PUBLIC_KEY>` instead of a file.

`--dry-run` simulates without sending. `--unsigned` also exports the unsigned
transaction in base64. `--yes` skips the terminal confirmation. `--max <N>` caps
sent transactions or previews. Records contain exact integer quantities as
decimal strings. Output is newline-delimited JSON; `--json` explicitly selects
that automation-compatible format. Simulation, signature and remaining-state
records are separate so a lost confirmation never hides the signed attempt.

Exit codes: 0 complete; 1 unexpected error; 2 partial or deferred work; 3 RPC
scan unavailable; 4 unmet preconditions or invalid arguments. A refused or
timed-out program scan leaves direct wallet exits available. Pull addresses and
explicit vault mints avoid program scans; global sequence lookup needs a scan.

## Final Pull (D18)

The Final Pull upgrade enables `crank start-final-pull`, `claim-final-sol` and
`claim-final-tokens`. Both claims remain available indefinitely in Final Pull
and Done, even with a zero share; each records its claim bit. Before the snapshot,
`all` continues the other exits and reports unclaimed season spend as remaining.

```sh
$R crank advance-phase --fee-payer /path/to/payer.json
$R crank start-final-pull --fee-payer /path/to/payer.json
$R claim-final-sol --fee-payer /path/to/payer.json --wallet "$WALLET"
$R claim-final-tokens --keypair /path/to/owner.json
$R all --keypair /path/to/owner.json
```

`all` claims SOL first, then re-reads the Binder before token claims. If Final
card slots need more capacity or rent, it Redeems existing cards first and
retries the claims from fresh state. Its normal Redeem pass includes the new
Final cards. Claim amounts use frozen pools and floor division, never a token
price estimate. Token claims may require Binder rent paid by the owner. The
command reports remaining work;
it never signs with an owner's key through a service.

## Execution and recovery

Every transaction uses a new confirmed blockhash and freshly read indices. The
CLI simulates before asking for approval, and again before signing. It sends
one transaction at a time, within the eight-transaction approval ceiling. Exact
selected indices keep their full initial card or Deck-entry identity; a changed
selection must be selected again. Bulk exits and the crank re-discover after
each confirmation.

CardMoved allows at most `RESCUE.cardMovedRetries` refreshes. Simulation errors
and expired unsigned plans can be rebuilt before signing. After a signed send,
only that signature is checked: a confirmed error may disappear on a fork.
Replacement requires a finalized CardMoved failure, or finalized block-height
expiry followed by another history lookup with no signature. An unresolved
signature returns partial and prints the signature: resolve that attempt before
repeating the command.

A preview cannot predict the effects of earlier unexecuted stages; it says so
and must be refreshed after execution. Pause flags and phases are displayed,
never used to refuse an exit.

## Stopped-services drill

```sh
pnpm program:build
node --conditions=development --import tsx packages/cli/src/rescue/drill.ts
```

The drill exports the existing Rust harness state, starts only a local
validator, loads the deployable sBPF program, builds the standalone bundle and
runs it against the validator's RPC URL (`--cluster localnet --program <id>`)
for phases 0 through 6 with every pause bit and role disabled. A single phase
can be passed as the final argument. Fixtures include FRESH and REFED entries,
all nine card kinds, an expired Pull, a Revealed Pull, House slots, a reserved
referrer, an executable depositor, a zero-balance System depositor, owed SOL and
donated vault tokens.

- Phase 3 runs each exit as its own command (`refund --all-due`,
  `settle --all-open` and `close-vaults --mint` paid by an unrelated wallet;
  `redeem --all`, `take-back --all`, `withdraw-owed` and `close-my-cards` by the
  owner). The other phases run `all`; phase 0 first stops after one transaction
  with `--max 1` and resumes.
- Phase 4 gives the buyer unclaimed season spend: every other exit completes,
  Close My cards is reported as `FinalNotClaimed` and `all` exits 2. Phases 5
  and 6 set both claim bits and the Binder closes.
- After the exits, `crank advance-phase` runs from the same RPC: 0 to 1, 2 to 4
  (two transitions), 3 to 4 and 5 to 6; phases 1, 4 and 6 exit 4 with nothing
  sent.

It checks token destinations, account closures, Binder counters, redirects and
lamport conservation after the owner's fees. Test signer files are disposable,
temporary and removed. This is local-validator evidence. It does not imply a
live devnet deployment, service shutdown or a devnet transaction.
