# Mainnet release inputs and reproduction

Run commands from `app/`. `mainnet.json` contains only the two externally supplied
public addresses and the two measured transport values. `null` means blocked;
do not substitute devnet values. The release input validator rejects incomplete
input, unknown fields, test identities and invalid measurement rounding.

```sh
pnpm release:mainnet:apply --input release/mainnet.json
pnpm build:libs
pnpm release:mainnet:check
pnpm program:release:check --cluster mainnet
```

The architect reviews and commits the generated changes, including PARAMS. From
that clean commit, on a machine with Docker (linux/amd64 support), Node 22.22.3,
pnpm 10.34.5, Anchor 0.32.2 and the repository's Rust/Solana toolchains:

```sh
pnpm install --frozen-lockfile
pnpm build:libs
pnpm program:release:build --cluster mainnet
cd target/release/mainnet
shasum -a 256 -c onepercent.so.sha256
```

The command checks the compiled mainnet identity, exports the committed Rust
sources to temporary storage outside the repository, and runs two clean builds
in the pinned Docker image. Both builds use Rust 1.95.0, cargo-build-sbf 4.3.0,
platform-tools v1.57, sBPFv3, `--locked` and exactly the `mainnet` feature. Both
container source/output paths are fixed. Different outputs stop the command.
Only the ELF, checksum and manifest are copied into `target/release/mainnet/`.
Incidental signing files produced by cargo-build-sbf are discarded outside the
repository; no operational key is used by the recipe.

Give a third party the public source mirror, the manifest's commit and the
checksum. They check out that commit and run the same commands. Compare the
ELF's SHA-256 with `manifest.json`; the manifest also records source tree,
public input and Cargo.lock hashes, toolchain versions, image identity and
features. Docker image IDs can differ when rebuilding a Dockerfile; the pinned
base digest and recorded toolchain recipe, plus identical ELF bytes, are the
reproduction criteria. A native development build is not the release proof.

No Docker or missing inputs is a failure, never a fallback to an unverified
binary. This recipe does not publish an explorer verification or deploy a
program. The separate runbook explains on-chain byte comparison and authority
handover: [`DEPLOY-MAINNET.md`](../../docs/codex/DEPLOY-MAINNET.md).

The read-only `program:deploy:check budget` models a **new** Agave 4.3.0 deployment
with an explicit buffer, identical payer/upgrade authority, zero compute price,
and one signing attempt. It reads every rent amount and fee from the selected
RPC, counts upload chunks as the CLI does, and accounts for reuse of the buffer
funding by ProgramData. It rejects existing program/buffer accounts: reconcile
partial uploads first. The result covers deployment only. Init, DBC, LUT and
Proxima are separately simulated/quoted in the runbook; retries incur additional
fees. The `verify` command reads finalized Program and ProgramData together,
checks the loader/PDA/authority, compares every ELF byte and rejects nonzero
trailing capacity.

On mainnet, both `budget` and `verify` require
`--approved-commit "$APPROVED_RC_COMMIT"` and
`--approved-elf-sha256 "$APPROVED_RC_ELF_SHA256"`. Obtain the full nonzero commit
and ELF SHA-256 from the independently approved release candidate, not from the
manifest beside the binary being checked. Before contacting RPC, the checker
binds the manifest and ELF to these pins, resolves the commit's source tree and
Cargo.lock from local Git, and checks the local Cargo.lock against that commit.
Missing Git objects, null commits, a substituted binary/manifest or mismatched
source and lock hashes stop the command.

References: [Solana verified builds](https://solana.com/docs/programs/verified-builds),
[Agave 4.3.0 deployment implementation](https://github.com/anza-xyz/agave/blob/v4.3.0/cli/src/program.rs).
