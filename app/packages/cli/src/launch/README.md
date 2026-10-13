# Meteora launch tooling

## D36 mainnet: founder launch wallet and friend's Proxima Deployer

The founder deploys and initializes the program from their own machine, prepares
DBC, the season with time before `stock_up_ts`, and the protocol LUT while the
Machine remains in Setup. No final mint address is known in advance and no
Custom Token Address is needed. Init cannot omit `token_mint`: the CLI schema and
program require a nonzero public key. Use the program's public address temporarily,
then replace it with the verified token mint during Setup. The placeholder is
not a token mint and cannot pass launch checks. Follow the
[mainnet runbook](../../../../../docs/codex/DEPLOY-MAINNET.md).

All Proxima commands below require `--cluster mainnet --rpc <url> --program <P6>
--mainnet-program <P6> --dbc-config <P3> --mint <public-mint>
--flow proxima --pool-creator <friend-deployer-public-address>`.
Read-only commands use `--wallet-address <founder-launch-wallet>`.
Mutations require `--wallet <external-founder-deployment-key-file>` and
`--confirm <first-eight-mint-characters>`. Key files stay outside the repository.
The friend never supplies their Deployer secret to the CLI.

1. Before `stock_up_ts`, the friend launches any new mint on Proxima with our
   **DBC Config public key**, a dev buy of at least 4% (40,000,000 1PCT) into their
   own Deployer wallet, null mint/freeze authorities and immutable metadata. They
   transfer exactly `TOKEN_1PCT.devBuyAmount` to the founder's distinct launch
   wallet and send the token address.
2. The founder runs read-only `launch verify` with that mint and the friend's
   `--pool-creator`. It validates the existing launch before mint registration;
   it signs and submits nothing. A third party using our public DBC config fails
   the creator check; a launch on another config also fails.
3. The founder runs `launch set-mint` during Setup (phase 0 only), then updates
   `params.token_mint` in their public deployment input to the verified address
   for later deployment checks, preserving the initial input separately.
   `launch check` reports `stock-up`. At `stock_up_ts`, run `launch stock-up`,
   then transfer admin and upgrade authority to the founder's Ledger. The
   founder's deployment wallet remains the launch wallet.
4. The founder runs `launch check`, then `launch deposit`: the launch wallet's
   canonical ATA must hold at least `TOKEN_1PCT.devBuyAmount`; the transaction
   transfers exactly that amount from that ATA to the vault.
5. `launch check`, then `launch power-on`: the vault must hold at least that amount,
   still unaccounted. Launch wallet surplus stays in the wallet and never blocks
   Power-On. An already funded vault skips another deposit. Donated vault excess
   is reported separately and never increases the tracked 40M.
6. `launch report` records finalized mint, canonical pool, full D29 config,
   FeeIn, tracked amount, clock and The 1% slots. Run immediately after Power-On,
   before later product activity changes these launch-specific balances. This
   report identifies its evidence as finalized account state.

With `--pool-creator`, the finalized pool's creator must match that public address
and differ from the launch wallet. An existing mint during Setup is allowed only
with that option and all launch validations passing. `set-mint` is refused after
Setup, even if Config already contains the requested mint. Without the option,
the existing same-wallet flow still requires `pool.creator == launch_wallet`
and no mint before Stock-Up. `launch check` reports `set-mint`, `stock-up`,
`awaiting-proxima`, `deposit`, `power-on` or `powered-on`.
The canonical pool and its immutable DBC config prove the initial supply. Current
supply may be lower after burns, but never higher; mint and freeze authorities
remain null and D29 metadata policy remains immutable. Every DBC field and
`fee_claimer = FeeIn` remain checked.

Each mutation simulates, persists its signed transaction journal, submits, and
verifies its finalized postcondition. The declared pool creator is bound to the
journal. An ambiguous attempt resubmits the same bytes; it never rebuilds
automatically. `proxima_reconciliation_required` requires reviewing the recorded
signature and finalized state before archiving a definitively expired attempt.
Retrying completed deposit/Power-On verifies state without transferring again.
Remove a stale `.lock` only after confirming no operator process remains active.

The Proxima transactions fit without a launch LUT. The protocol LUT is independent.
Use `--flow proxima` to rehearse this path on localnet or devnet. Mainnet selects
it automatically and rejects `launch send` / `--flow atomic`. `--pool-creator`
is rejected on commands outside the Proxima path. Public release pins and D35's
provisional landing values must be supplied by the architect before mainnet launch.

## Atomic localnet/devnet rehearsal

D29 replaces the $1PCT launch venue with Meteora DBC. The Feed and X-ray still
use the pump SDK. This track implements D29 section 4 items 1 to 3 and 5;
the keeper fee chain remains a separate track. Launch uses M4.1's canonical
`powerOnIx` builder and the real program.

## Commands

Build from `app/` with the pinned `pnpm@10.34.5`. The `onepct-ops` binary routes
to `packages/cli/dist/launch/ops.js`; existing operator commands keep their
original handler. No new dependency is required.

`--program` configures the runtime program for `--cluster`. One SDK deployment
context selects that program and the cluster's Meteora pins together. Launch
builders, LUT construction and journal validation receive this context; they
have no independent program, cluster or DBC config override. `--dbc-config`
asserts the selected pin. For mainnet, publish the pre-generated public config
pin before building, then create that account after machine init.

```sh
node packages/cli/dist/launch/ops.js launch config \
  --cluster localnet --rpc http://127.0.0.1:8899 \
  --program <machine-program> --wallet <ops-wallet-file> \
  --dbc-config-keypair <config-signer-file> \
  --migration-threshold-sol 85
```

`launch config` creates one immutable DBC config in one transaction. It
simulates before signing, persists the signed bytes before submission, then
re-reads finalized state and verifies every D29 field before printing `config`.
The journal contains public identities and signed bytes, never private keys.
A restart reconciles that same config and transaction. A changed threshold or
identity is refused under an existing journal. An ambiguous attempt must be
resolved before the operator starts a new creation.

`--migration-threshold-sol` accepts a positive decimal SOL amount with at most
nine fractional digits; the default is exactly 85 SOL. Use the same threshold
for all later commands so their field checks match the created config. The
founder may choose a different threshold before config creation. No command can
edit the created config. Localnet and devnet require the public test signer
whose address is pinned in `METEORA_BY_CLUSTER`. Mainnet config creation requires
a separate ops-held signer and refuses that test address. Mainnet uses the
pre-generated public address from the release input; only its external keypair
is read when creating the pinned account.

Mainnet requires `--mainnet-program`, an exact genesis match and the published
ops wallet from the Machine config. Config and LUT creation enforce the D18
5 SOL ops-wallet cap. Genesis is checked before key-file access, signing and
submission. Localnet requires loopback RPC and rejects mainnet/devnet genesis.

```sh
node packages/cli/dist/launch/ops.js launch plan \
  --cluster localnet --rpc http://127.0.0.1:8899 \
  --program <machine-program> --dbc-config <created-config> \
  --wallet-address <launch-wallet> --mint <mint> --lut <frozen-table> \
  --name "DBC rehearsal" --symbol "TEST" --uri <https-metadata-uri>
```

- `launch lut --dbc-config <address> --mint <mint> --wallet <ops-wallet-file>`
  creates, extends, waits for the extension slot, and freezes the launch table.
  It uses the launch wallet in the Machine config. `--lut` resumes a recorded
  table; only an exact expected address prefix can be extended. A frozen table
  with different DBC accounts is `lut_dbc_accounts_mismatch`, a named NO-GO.
- `launch plan` and `launch check` take public `--wallet-address` and `--mint`
  identities, or local signer paths. Both build and simulate unsigned bytes,
  print numbered GO/WARN/NO-GO checks, exact quote, CU, size and account metas,
  and submit nothing. `--simulate` is a read-only compatibility flag.
- `launch send` requires `--wallet`, `--mint-keypair`, `--dbc-config`, the frozen
  `--lut`, and `--confirm <first-eight-mint-characters>`. A fresh attempt plans
  and simulates before waiting, then repeats both at T0 with a fresh blockhash.
  Any NO-GO stops it. `--accept-warnings` records acceptance of WARN results.
- `--at` accepts only ten decimal digits of Unix seconds within one hour before
  or thirty days after the current time. The wait uses the chain clock. Empty,
  hexadecimal, exponent and millisecond inputs fail validation.
- `launch report` reconciles finalized transaction evidence and records the
  mint, DBC config, pool, tracked 40M, vault, wallet balances, timestamps and
  The 1% slots under ignored `app/reports/launch/`. Slot 0 may be Live in the
  report. Launch simulation still requires all four slots Locked.

Production metadata comes from config. Rehearsals cannot use production branding.
Metadata limits are UTF-8 byte lengths: name 32, symbol 10, HTTPS URI 200.
Mainnet requires the D18 devnet rehearsal evidence. This tooling supplies launch
evidence to M6; it does not replace the full M6 go/no-go.

## Atomic transaction and checks

D28 remains one atomic v0 transaction through Helius Sender:

1. DBC `initialize_virtual_pool_with_spl_token`, signed by the disclosed launch
   wallet and vanity mint.
2. Create launch token and wSOL ATAs, wrap the exact quoted SOL maximum, then
   DBC `swap2` exact-out for configured `DEV_BUY`, and close wSOL.
3. Create the SPL Token vault ATA, transfer `DEV_BUY`, execute the 12-account
   D29 `power_on` instruction, close the launch token ATA, and pay the Sender tip.

The frozen table contains 17 addresses. The complete transaction measures
**826 bytes** at an 80-byte URI and **975 bytes** at maximum metadata, with two
signatures and fourteen instructions. Without a table it is 1,319 bytes.
Anything over 1,232 bytes is NO-GO. There is no bundle transport or fallback.

The integer math mirror reproduces the DBC curve builder and exact-out quote.
At the default threshold, the 40M buy costs 1,192,328,122 lamports. An unsigned
mainnet simulation confirms the quote reserve and the exact partner/protocol
fee amounts. Exact curve values and derivation are recorded in PARAMS as
EXT (Meteora); pinned IDLs, binaries, hashes and captures are in
`fixtures/meteora/`.

Checks re-read every immutable config field: wSOL quote, 250 bps flat fees,
no dynamic fee, FeeIn partner and leftover receiver, zero creator share,
SPL Token supply and decimals, immutable metadata, exact curve, customizable
DAMM v2 migration settings, and 100% permanent partner LP allocation.
Mint and pool share one account classifier. Missing accounts and empty,
non-executable System accounts are available, with `prefundedLamports` reported.
Existing venue accounts and foreign accounts are NO-GO. Foreign mint and pool
owners have distinct send alerts.

Simulation requires an immutable SPL mint, matching DBC pool/config, exact
quoted partner fees with zero creator/base fees, exactly `DEV_BUY` in the vault,
and zero $1PCT in the launch wallet. Machine and ledger effects must also pass;
a successful no-op `power_on` cannot pass.

Priority-fee sampling supplies the payer, all writable instruction keys and the
Sender tip recipient, deduplicated, sorted and capped at 128. Existing p75 and
fee caps apply. Zero price remains NO-GO for mainnet Sender. The final CU budget
uses measured consumption and the configured margin, then simulates again.

## Reconciliation and retries

The journal is persisted before submission with mode 0600 and a process lock.
While confirmation is pending, the same signed bytes are rebroadcast about every
two seconds until confirmation or blockhash expiry. D23 permits a rebuild only
after finalized expiry, signature-history lookup, and a second finalized read
of both mint and pool. A transport timeout cannot authorize another build.
The journal binds the DBC config identity as well as wallet, mint and program;
old venue journals cannot be replayed by this path.

The attempt budget is per CLI run. The operator owns retry limits across runs.
Restarting reconciles the persisted attempt first. A stale process lock requires
operator review before removal.

## Decisions taken and readiness

- Keep the founder-approved D29 economics and leave D27 collection splits to M4.1.
- Port integer math and use the existing pinned Anchor coders, without a Meteora
  SDK dependency. M4.1's raw IDLs and program dumps are the canonical fixtures.
  Tests compare the normalized SDK IDL copies against those raw IDLs; SOURCE
  combines both captures' provenance and verification procedures.
- Use exact-out at the known initial price; initialization and the dev buy are
  atomic, and the SOL maximum comes from the verified integer quote.
- Use M4.1's cluster-aware `powerOnIx` and its 12-account list. Local e2e executes
  the real program; this proves the local flow, not a production deployment.
- Keep missing production landing parameters NO-GO. The local validator driver
  injects test transport values through a loopback-only execution interface.
- Keep config creation separate from launch. No mainnet creation or launch is
  performed by development verification. Disposable wallet and mint signers stay
  in memory; the public config test signer is loaded only for localnet/devnet.
- Historical pump captures are retained as provenance. Active launch code uses
  Meteora only; pump valuation and Feed functionality remain intact.

## Validation

Validated on 2026-10-09 after reconciling M4.1, with pnpm 10.34.5,
`CARGO_BUILD_JOBS=3` and `VITEST_MAX_WORKERS=2`. Heavy steps ran sequentially.

| Command                                          | Result                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                                   | PASS; dependency manifests and lockfile unchanged                 |
| `pnpm lint`                                      | PASS                                                              |
| `pnpm format:check`                              | PASS                                                              |
| `pnpm lint:words`                                | PASS                                                              |
| `pnpm typecheck`                                 | PASS                                                              |
| `pnpm build`                                     | PASS                                                              |
| `pnpm --filter @onepercent/cli test`             | PASS: 354 tests                                                   |
| `pnpm --filter @onepercent/sdk test`             | PASS: 368 tests                                                   |
| `pnpm --filter @onepercent/config test`          | PASS: 109 tests                                                   |
| `ONEPERCENT_CLUSTER=localnet pnpm program:build` | PASS; real sBPFv3 artifact, generated IDL unchanged               |
| `pnpm e2e:validator launch`                      | PASS with real M4.1 `power_on`                                    |
| `pnpm e2e:validator season`                      | PASS, including Meteora migration and collection after buys close |

The three package test suites ran sequentially in one filtered pnpm command,
with 831 tests passing and no skips. Program sources and existing program
vectors did not change. The three canonical external binaries are byte-identical
to M4.1's dumps; raw IDL hashes and normalized SDK copies also match.

The local driver passed config creation, frozen LUT, plan, check, send, journal
restart with the same signature, report, threshold buy, DAMM migration and a
post-migration exact-output buy. The local launch used 787 bytes and 213,717 CU.
Its report proves the 40M vault deposit, zero launch token balance, flat 250 bps
migrated fee and 100% permanently locked LP held by FeeIn. It records the actual
Onepercent artifact hash and `powerOn: real-m4.1-program`; the local substitute
has been removed. The standard and maximum-metadata vectors remain 826 and
975 bytes.

The earlier unsigned mainnet capture at slot 454848440 remains separate evidence
for DBC config creation and the dev buy. This integration round submitted only
to local validators. Disposable signers stayed in memory; the public config test
signer was used only on localnet. Mainnet stays `PENDING`, and the local report
explicitly records `productionDeploymentVerified: false`.
