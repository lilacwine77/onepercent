# onepct-ops

The current mainnet procedure is D31/D32 in
[`DEPLOY-MAINNET.md`](../../../docs/codex/DEPLOY-MAINNET.md). One founder wallet
holds final Config admin and program upgrade authority, with no multisig or
timelock. Ledger is recommended. The friend who deploys the program also uses
his Proxima Deployer wallet as the launch wallet; it receives the 4% dev buy
and signs deposit and Power-On directly. Service operators generate and install
the separate role keys. No private key belongs in this repository.

## Initial deployment and handover

After `pnpm build:libs`, the dedicated entrypoint is:

The user rescue CLI, `onepct-rescue`, is documented in
[src/rescue/README.md](src/rescue/README.md).

```sh
node packages/cli/dist/deploy/ops.js validate --cluster mainnet \
  --rpc "$MAINNET_RPC_URL" --program "$PROGRAM_ID" --init "$PUBLIC_INIT_FILE"
```

Commands: `validate`, `addresses`, `check --stage deployed|initialized|handoff`,
`init`, `season-point`, `set-season --slot ... --ts ... --stock-up-ts ...`,
`transfer-admin`. The file is strict public JSON:
`{ founder_admin, ops_wallet, params: InitParams }`. `params.admin` initially
matches the friend's `launch_wallet`; final admin is `founder_admin`. Two
distinct guardian addresses remain in the unchanged program ABI. All service
roles, founder, guardians, ops and launch wallet must be distinct. Founder,
launch and ops must be published in the eight `team_wallets` slots.

Initialization requires the current program upgrade authority. Therefore deploy,
init, DBC creation, season and mint preparation precede both authority transfers.
The final `check --stage handoff` verifies the same founder address in Config
and ProgramData, reading finalized state. It verifies all configured roles.

Mutations require `--wallet` pointing to an external mode-600 file. Without
`--confirm`, they simulate and print a public confirmation digest without opening
the signer. Review the instruction and repeat with that exact `--confirm`.
Changing an input invalidates it. A successful mutation includes finalized
postcondition checks; an ambiguous send returns its public signature and must
be reconciled before any retry. RPC errors and key contents are never printed.

## Direct D31 governance

The existing `onepct-ops` entrypoint is `packages/cli/dist/launch/ops.js`.
Non-launch commands use `--cluster devnet|mainnet`, `--rpc-url` and `--program-id`.
Mainnet `role`, `set-season` and K1 `hitlist` mutations now accept `--keypair`
without any Squads option. The CLI reads finalized Config, verifies its owner,
length, discriminator and version, then requires the signer to equal Config.admin.
It simulates, prints decoded instructions, asks for the program id's first and
last four characters, checks genesis again and sends once with preflight.

```sh
onepct-ops --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --keypair "$ADMIN_FILE" role set keeper "$KEEPER"
```

For a hardware signing workflow, `--admin <public-address>` instead of `--keypair`
returns a simulated `unsigned-admin-transaction`, its decoded instructions,
base64 transaction, blockhash and last-valid height. It reads no private file
and sends nothing. This is a generic unsigned export, **not a Ledger transport
implementation**. Use reviewed wallet tooling to sign and submit while the
blockhash remains valid; never export a Ledger seed to satisfy `--keypair`.
Program upgrade-authority transfers use Solana CLI's native `usb://ledger` path.
The deployment runbook prepares Setup before handing admin to the founder.

```sh
onepct-ops --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --admin "$FOUNDER" role set keeper "$KEEPER"
```

Roles: `admin`, `guardian0`, `guardian1`, `keeper`, `executor`, `intake-signer`,
`quote-signer`, `launch-wallet`. Guardians sign directly with their separate
`--keypair`: `SetPause --bits <0..31> --paused true|false`, `DisableBucket --index`,
`LowerCap --index --cap`, `DisableRole --role`, `SelectVrfQueue --index`.
A guardian cannot transfer protocol or user assets. Exits remain independent
of pause bits and all services.

The original `init <params.json>` also supports a direct mainnet deployer and
single public admin without `--multisig`. It takes the flat M1 InitParams shape;
the dedicated deployment command uses the wrapper and verifies handover, so
follow that runbook for a new release. The rent buffer is bounded by
`GOVERNANCE.initRentBufferMaxLamports`; addresses and buffer have no default.
`set-season` requires a finalized slot and its exact RPC block time.

## Protocol LUT

The existing managed lifecycle uses the ops wallet published in Config's
`team_wallets`, with the D18 5 SOL cap. Obtain the six protocol addresses with
`deploy/ops.js addresses`, then plan without a key:

```sh
onepct-ops --cluster mainnet --rpc-url "$MAINNET_RPC_URL" \
  --program-id "$PROGRAM_ID" --ops-wallet "$OPS" lut create \
  --addresses "$PROTOCOL_ADDRESSES"
```

Review the report and repeat with `--keypair "$OPS_FILE"` and the exact printed
`--confirm-mainnet-lut` token; terminal confirmation is also required. The tool
creates, extends, waits for activation and removes authority. It verifies exact
finalized contents after every step; success requires a frozen table. Use
`lut extend` or `lut freeze --lut ... --addresses ...` to resume a reconciled
partial lifecycle. An already frozen correct table can be verified without a
signer. No automatic replacement follows an ambiguous transaction. Solana's
1,232-byte limit and duplicate/overflow checks are enforced.

D32 mainnet does not require an atomic-launch LUT; protocol LUT use by services
is unchanged. The `launch` family, including D32 set-mint, deposit, Power-On,
checks and reports, is documented in [`src/launch/README.md`](src/launch/README.md).

## Compatibility and tests

Explicit historical `--multisig`/`--creator` exports remain supported for earlier
fixtures and deployments. They are never required for D31; mixing proposal
options with direct governance signing is refused. Those exports remain unsigned
and simulation does not prove execution or approval. Legacy devnet individual
LUT operations are retained. The old RUNBOOK's Squads/canary/12h instructions are
superseded by D31/D32 and the current deployment runbook.

The M1 adapter retains canonical instruction decoding/intent verification and
runtime program-id PDA resolution. K1 receives only read RPC interfaces and
public authority; the common runner owns simulation/signing. External instructions
are limited to the existing checked listing ATA exception. Tests exercise
canonical instruction bytes, cluster boundaries, direct mainnet admin identity,
unsigned exports, init/public-file validation and handover, LUT lifecycle and
transaction outcome handling with generated in-memory test signers.
