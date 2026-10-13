# Verified versions

Verified on **2026-10-08** for M0.1. Direct library versions are exact in package
manifests; `pnpm-lock.yaml` and `Cargo.lock` pin transitive resolutions. Publication
dates below were read from npm's `time[version]`, crates.io's `version.created_at`
and GitHub's release `published_at`, with sources linked in each table.

## Toolchain

| Component                       | Version                                  | Published (UTC) | Verification                                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js                         | 22 LTS; minimum 22.22.2, locally 22.22.3 | Major line      | `node --version`; [Node releases](https://nodejs.org/en/about/previous-releases). `.nvmrc`, CI and Docker track the required Node 22 line.                                                                                                             |
| pnpm                            | 10.34.5                                  | 2026-07-10      | [npm registry](https://registry.npmjs.org/pnpm); exact `packageManager` and `engines.pnpm`.                                                                                                                                                            |
| Rust host compiler              | 1.95.0                                   | 2026-04-16      | [Rust release](https://blog.rust-lang.org/2026/04/16/Rust-1.95.0/); approved alignment of `rust-toolchain.toml`, build scripts and CI with program `rust-version = "1.95"`.                                                                            |
| Anchor CLI, AVM and anchor-lang | 0.32.2                                   | 2026-09-14      | [Anchor release notes](https://www.anchor-lang.com/docs/updates/release-notes/0-32-2), [release metadata](https://api.github.com/repos/solana-foundation/anchor/releases/tags/v0.32.2), and the crates.io rows below.                                  |
| Agave / Solana CLI              | 4.3.0                                    | 2026-09-18      | [Official release](https://github.com/anza-xyz/agave/releases/tag/v4.3.0); sBPFv3 build toolchain.                                                                                                                                                     |
| Agave SBF platform-tools        | 1.57 (Rust 1.95.0)                       | 2026-08-21      | [Official release](https://github.com/anza-xyz/platform-tools/releases/tag/v1.57); Local `cargo-build-sbf --help` identifies platform-tools 1.57 and Rust 1.95.0.                                                                                      |
| solana-verify                   | 0.5.2                                    | 2026-09-21      | [crates.io API](https://crates.io/api/v1/crates/solana-verify/0.5.2); verified builds use `[workspace.metadata.cli] solana = "4.3.0"` and `--arch v3`. Installed locally (`solana-verify --version`); no Docker verified-build result is claimed here. |
| Container base                  | node:22-alpine                           | Major line      | Required by M0; Node 22 major tag for builder and runtime.                                                                                                                                                                                             |

## TypeScript libraries and tools

This table covers every external npm version named in the app workspace manifests,
including the package manager. Workspace references resolve to this repository.
Registry links expose both each version's metadata and its publication timestamp.

| Package                     | Version      | Published (UTC) | Used by                                            | Source                                                                 |
| --------------------------- | ------------ | --------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `@anchor-lang/core`         | 0.32.2       | 2026-09-14      | onepercent-app, sdk                                | [npm registry](https://registry.npmjs.org/@anchor-lang/core)           |
| `@eslint/js`                | 10.0.1       | 2026-02-06      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/@eslint/js)                  |
| `@fontsource/dm-sans`       | 5.3.0        | 2026-07-19      | web, api                                           | [npm registry](https://registry.npmjs.org/@fontsource/dm-sans)         |
| `@fontsource/fraunces`      | 5.3.0        | 2026-07-19      | web, api                                           | [npm registry](https://registry.npmjs.org/@fontsource/fraunces)        |
| `@hono/node-server`         | 2.1.1        | 2026-08-14      | api, worker                                        | [npm registry](https://registry.npmjs.org/@hono/node-server)           |
| `@solana/web3.js`           | 1.99.0       | 2026-09-08      | onepercent-app, sdk, market, eligibility, api      | [npm registry](https://registry.npmjs.org/@solana/web3.js)             |
| `@sqds/multisig`            | 2.1.4        | 2025-06-16      | onepercent-app (devnet drill tooling)              | [npm registry](https://registry.npmjs.org/@sqds/multisig)              |
| `@testing-library/dom`      | 10.4.2       | 2026-09-13      | web                                                | [npm registry](https://registry.npmjs.org/@testing-library/dom)        |
| `@testing-library/jest-dom` | 7.0.1        | 2026-08-09      | web                                                | [npm registry](https://registry.npmjs.org/@testing-library/jest-dom)   |
| `@testing-library/react`    | 16.3.3       | 2026-08-27      | web                                                | [npm registry](https://registry.npmjs.org/@testing-library/react)      |
| `@types/node`               | 22.20.4      | 2026-09-19      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/@types/node)                 |
| `@types/react`              | 19.3.0       | 2026-09-09      | web                                                | [npm registry](https://registry.npmjs.org/@types/react)                |
| `@types/react-dom`          | 19.3.0       | 2026-09-09      | web                                                | [npm registry](https://registry.npmjs.org/@types/react-dom)            |
| `@types/three`              | 0.180.0      | 2025-09-03      | web (experience layer, labs' pin)                  | [npm registry](https://registry.npmjs.org/@types/three)                |
| `@vitejs/plugin-react`      | 6.1.1        | 2026-08-28      | web                                                | [npm registry](https://registry.npmjs.org/@vitejs/plugin-react)        |
| `abort-controller`          | 3.0.0        | 2019-03-30      | bot                                                | [npm registry](https://registry.npmjs.org/abort-controller)            |
| `esbuild`                   | 0.28.2       | 2026-08-08      | cli (rescue bundle; the version tsx already locks) | [npm registry](https://registry.npmjs.org/esbuild)                     |
| `eslint`                    | 10.11.0      | 2026-09-18      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/eslint)                      |
| `fast-check`                | 4.10.2       | 2026-09-19      | market                                             | [npm registry](https://registry.npmjs.org/fast-check)                  |
| `globals`                   | 17.12.0      | 2026-09-01      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/globals)                     |
| `grammy`                    | 1.46.0       | 2026-08-26      | bot                                                | [npm registry](https://registry.npmjs.org/grammy)                      |
| `gsap`                      | 3.15.0       | 2026-04-13      | web (experience layer)                             | [npm registry](https://registry.npmjs.org/gsap)                        |
| `hono`                      | 4.13.9       | 2026-09-24      | api, worker                                        | [npm registry](https://registry.npmjs.org/hono)                        |
| `jsdom`                     | 30.1.1       | 2026-09-22      | web                                                | [npm registry](https://registry.npmjs.org/jsdom)                       |
| `pino`                      | 10.3.1       | 2026-02-09      | api, bot, worker                                   | [npm registry](https://registry.npmjs.org/pino)                        |
| `pnpm`                      | 10.34.5      | 2026-07-10      | packageManager / engines                           | [npm registry](https://registry.npmjs.org/pnpm)                        |
| `prettier`                  | 3.9.9        | 2026-09-23      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/prettier)                    |
| `react`                     | 19.3.0       | 2026-09-09      | web                                                | [npm registry](https://registry.npmjs.org/react)                       |
| `react-dom`                 | 19.3.0       | 2026-09-09      | web                                                | [npm registry](https://registry.npmjs.org/react-dom)                   |
| `three`                     | 0.180.0      | 2025-09-03      | web (experience layer, labs' pin)                  | [npm registry](https://registry.npmjs.org/three)                       |
| `tsx`                       | 4.23.15      | 2026-09-20      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/tsx)                         |
| `typescript`                | 5.9.3        | 2025-09-30      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/typescript)                  |
| `typescript-eslint`         | 8.70.1       | 2026-09-21      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/typescript-eslint)           |
| `vite`                      | 8.3.1        | 2026-09-24      | web                                                | [npm registry](https://registry.npmjs.org/vite)                        |
| `vitest`                    | 5.0.1        | 2026-09-15      | onepercent-app                                     | [npm registry](https://registry.npmjs.org/vitest)                      |
| `zod`                       | 4.6.5        | 2026-09-13      | api, bot, config, market, worker, eligibility, web | [npm registry](https://registry.npmjs.org/zod)                         |
| `@solana/spl-token`         | 0.4.15       | 2026-07-09      | eligibility                                        | [npm registry](https://registry.npmjs.org/@solana%2fspl-token)         |
| `satori`                    | 0.33.5       | 2026-09-22      | api                                                | [npm registry](https://registry.npmjs.org/satori)                      |
| `@resvg/resvg-js`           | 2.6.2        | 2024-03-26      | api                                                | [npm registry](https://registry.npmjs.org/@resvg%2fresvg-js)           |
| `@bonfida/spl-name-service` | 4.1.0-beta.1 | 2026-09-11      | api; approved beta, disabled by default (D9)       | [npm registry](https://registry.npmjs.org/@bonfida%2fspl-name-service) |

`minimumReleaseAge: 20160` in `pnpm-workspace.yaml` applies the 14-day rule to every
npm resolution, including transitive dependencies. No release-age exclusion is
configured. All direct pins above had reached 14 days at verification; the newest
is Vite 8.3.1, published 2026-09-24T12:26:19.940Z. The npm lockfile was regenerated
under this policy because the previous resolution retained a younger Vite peer;
no exclusions were added.

`three`, `@types/three` and `gsap` were added for the experience layer (D19) on
2026-10-09, at the versions the experience labs are built and tested with (three
0.180.0, not the newer 0.186.x); their lockfile resolutions install under the same
14-day rule.

Node 22.22.2 is the minimum required by the selected jsdom release. TypeScript
5.9.3 is retained across the selected ESLint, React and Anchor client tooling.
Prettier uses its default configuration.

An independent registry audit of all **402 locked npm versions** (379 package
names), including optional platform packages, Squads and the merged market package, passed
at **2026-10-08T19:48:32Z** against cutoff **2026-09-24T19:48:32Z**: zero violations
and zero metadata errors. The newest transitive is `rolldown 1.2.11`, published
2026-09-24T14:30:23.950Z, with an age of 20,478.141 minutes at the audit. The lockfile
contains one version each of web3.js (1.99.0), the Anchor TS client (0.32.2) and
Squads (2.1.4), with no legacy Anchor client. Its SHA-256 was unchanged throughout
the audit: `02c32e4e6e367c26fcf8e91754d3df95c58bcb8c7f75344f15d1686883f2fd15`.

`@sqds/multisig` is an exact root development dependency for the approved disposable
devnet drill; no new application workspace package was created. Its published
web3.js range accepts the workspace's 1.99.0 version.

The three existing service Dockerfiles now bootstrap pnpm 10.34.5 under the
approved file-scope alignment. They match `packageManager` and `engines.pnpm`;
the bootstrap version's publication date was verified separately in the table
above. This records their pinned configuration, not a Docker build result.

## Cargo lockfile changes

Compared with the M0 lockfile at this branch's base, the only added or changed
registry resolutions are these 11 Anchor crates, all moving from 0.32.1 to 0.32.2.
Each crates.io publication timestamp was checked separately. Every entry is older
than 14 days; no Cargo release-age exception is needed. Other locked crates retain
their existing versions.

| Crate                             | Version | Published (UTC) | Source                                                                                  |
| --------------------------------- | ------- | --------------- | --------------------------------------------------------------------------------------- |
| `anchor-attribute-access-control` | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-attribute-access-control/0.32.2) |
| `anchor-attribute-account`        | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-attribute-account/0.32.2)        |
| `anchor-attribute-constant`       | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-attribute-constant/0.32.2)       |
| `anchor-attribute-error`          | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-attribute-error/0.32.2)          |
| `anchor-attribute-event`          | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-attribute-event/0.32.2)          |
| `anchor-attribute-program`        | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-attribute-program/0.32.2)        |
| `anchor-derive-accounts`          | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-derive-accounts/0.32.2)          |
| `anchor-derive-serde`             | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-derive-serde/0.32.2)             |
| `anchor-derive-space`             | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-derive-space/0.32.2)             |
| `anchor-lang`                     | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-lang/0.32.2)                     |
| `anchor-syn`                      | 0.32.2  | 2026-09-14      | [crates.io API](https://crates.io/api/v1/crates/anchor-syn/0.32.2)                      |

## GitHub Actions

The official v4 tags were resolved through the GitHub API and pinned to their
commit on the verification date.

| Action                                                              | Tag | Pinned commit                            |
| ------------------------------------------------------------------- | --- | ---------------------------------------- |
| [actions/checkout](https://github.com/actions/checkout/tree/v4)     | v4  | 11d5960a326750d5838078e36cf38b85af677262 |
| [actions/setup-node](https://github.com/actions/setup-node/tree/v4) | v4  | 49933ea5288caeca8642d1e84afbd3f7d6820020 |
| [actions/cache](https://github.com/actions/cache/tree/v4)           | v4  | 0057852bfaa89a56745cba8c7296529d2fc39830 |
| [pnpm/action-setup](https://github.com/pnpm/action-setup/tree/v4)   | v4  | f40ffcd9367d9f12939873eb1018b921a783ffaa |

## Reserved for M1

MagicBlock is **not installed by M0.1**. The approved M1 target is
`ephemeral-vrf-sdk = "=0.17.3"`, with `default-features = false` and
`features = ["anchor-compat"]`, per master brief §0.3 E. Its publication date is
**2026-09-24**, verified in the
[crates.io API](https://crates.io/api/v1/crates/ephemeral-vrf-sdk/0.17.3).
The Anchor 0.32.2 compatibility build remains an S0 check until its measured result
is recorded below.

## S0 result

**Partial: the sBPFv3 build, IDL generation and validator smoke pass with the
approved Rust 1.95.0 host. Rust LiteSVM 0.16.0 executes the v3 artifact and emits
Pong(version=1), using 767 CU. The delegated devnet drill is ready to resume after
the founder funds the existing payer; execution is deferred as instructed, without
blocking toolchain delivery. No devnet deployment or authority change has been
submitted. G0.1 remains open until the actual devnet receipts are recorded.**

### Mainnet feature snapshot

[`fixtures/mainnet/features.json`](fixtures/mainnet/features.json) was captured
with `getProgramAccounts` for
`Feature111111111111111111111111111111111111`, using
`{"encoding":"base64","commitment":"finalized","withContext":true}`.
`getGenesisHash` was checked against the public mainnet endpoint and `getBlockTime`
was read for the returned context slot.

| Observation            | Result                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Cluster                | `mainnet-beta`                                                                                                               |
| Genesis hash           | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`                                                                               |
| Captured at            | 2026-10-08T18:37:37Z                                                                                                         |
| Finalized context slot | 454626912                                                                                                                    |
| Context block time     | 2026-10-08T18:37:28Z                                                                                                         |
| Feature accounts       | 312 total; 310 activated, 2 pending activation                                                                               |
| RPC software           | Solana core 4.3.0; feature-set 3383571666                                                                                    |
| Validation             | Passed: unique sorted addresses, owner, base64 decoding, 9-byte data, activation slots at or before the context, and counts. |

The fixture retains every raw account, with its decoded nullable `activatedAt`
slot. The mainnet harness uses entries whose `activatedAt` is not null. Retaining
the two pending accounts preserves the full RPC observation. The file contains
only the RPC hostname, without credentials. Encoding follows the official
[Feature account state](https://github.com/anza-xyz/solana-sdk/blob/master/feature-gate-interface/src/state.rs);
the request follows [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts).

### SIMD-0500 status

Feature address: `B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`.

| Cluster | Evidence at finalized commitment                                                                                                                                          | Result                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Mainnet | Absent from the snapshot at slot 454626912; an independent `getAccountInfo` call to the public endpoint returned `value: null` at slot 454627000 (API 4.3.0).             | Not activated at observation. |
| Devnet  | `getAccountInfo` returned `value: null` at slot 508909543, observed 2026-10-08T18:37:38Z (API 4.4.0-beta.0). Genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. | Not activated at observation. |

These are observations at the recorded slots, not predictions of activation.
No transaction was submitted to obtain the snapshot or feature status.

### Local build and runtime evidence

Measured on 2026-10-08, macOS arm64, with unchanged M0 program source:

| Check                 | Result                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anchor                | CLI 0.32.2; AVM built from tag v0.32.2 reports its internal version 0.32.1                                                                                                                                        |
| Platform compiler     | v1.57, `rustc 1.95.0-dev (ae660768a 2026-08-17)`                                                                                                                                                                  |
| Host compiler         | `rustc 1.95.0 (59807616e 2026-04-14)`                                                                                                                                                                             |
| Deploy artifact       | 150,592 bytes; ELF64 little endian; flags 3                                                                                                                                                                       |
| SHA-256               | `2cd988bfac3bd0d7036a7af872e2a5ad36165a029d9a1c18bc9630ec10d2f295`                                                                                                                                                |
| IDL and TS types      | Regenerated with Anchor 0.32.2, byte-identical to M0                                                                                                                                                              |
| Validator 4.3.0 smoke | One test passes: actual `ping` emits `Pong { version: 1 }`                                                                                                                                                        |
| npm LiteSVM 0.8.0     | Runtime initializes; v3 loading fails: `Failed to add program: invalid account data for instruction`. No execution claimed. M1 npm flows use the brief's validator fallback.                                      |
| Rust LiteSVM 0.16.0   | PASS on host Rust 1.95.0: loads the v3 artifact and executes ping, emitting Pong(version=1), 767 CU. Runtime resolves Agave 4.2.2.                                                                                |
| MagicBlock            | Isolated compile-only v3 probe passes: anchor-lang =0.32.2 and ephemeral-vrf-sdk =0.17.3, default-features=false, anchor-compat. SDK program ID typechecks as anchor_lang::Pubkey. No workspace dependency added. |

Exact build sequence (use the pnpm wrappers in paths containing `%`):

```sh
export RUSTUP_TOOLCHAIN=1.95.0
anchor build --no-idl -- --arch v3
node scripts/check-sbf-flags.mjs target/deploy/onepercent.so
anchor idl build --out target/idl/onepercent.json --out-ts target/types/onepercent.ts
pnpm sdk:idl
anchor test --skip-build
```

`cargo-build-sbf --help` reports default architecture v0. Every entry point
therefore passes v3 explicitly. `anchor build -- --arch v3` builds v3 but also
passes `--arch` to the IDL's host `cargo test`, which rejects it. Splitting SBF
and IDL generation preserves the host pin and tests the same v3 artifact.

### Approved host Rust alignment

The architect approved host Rust **1.95.0**, published **2026-04-16**, replacing the
master brief's original 1.90.0 host pin. `rust-toolchain.toml`, the Anchor wrapper
and the CI program job use 1.95.0; the program manifest now declares
`rust-version = "1.95"`, matching the measured platform-tools compiler version.
The release date is verified in the
[official Rust announcement](https://blog.rust-lang.org/2026/04/16/Rust-1.95.0/).

The former 1.90.0 host could not generate the IDL once the program's required
minimum became 1.95. Independently, the isolated Rust LiteSVM probe encountered
`solana-syscalls` calls to `MaybeUninit::write_copy_of_slice` and
`write_clone_of_slice`, stable only since
[Rust 1.93.0](https://doc.rust-lang.org/std/primitive.slice.html#method.write_copy_of_slice).
These two findings prompted the approved host alignment. The SBF compiler remains
Agave 4.3.0's platform-tools 1.57, and all deploy builds still request sBPFv3.
No compiler-version bypass is used. Runtime outcomes remain separate measured
checks in the S0 evidence; changing the host pin alone is not an execution result.

### Rust LiteSVM rerun with the approved host

The isolated Rust probe with `litesvm =0.16.0` and `precompiles` completed on
2026-10-08. Its 14-day-audited Cargo lockfile was reused unchanged. It loaded the
same 150,592-byte sBPFv3 M0 artifact, invoked the real `ping` discriminator with a
signer, and asserted the exact emitted `Pong { version: 1 }` payload:

```text
PASS Rust litesvm 0.16.0: e_flags=3; ping emitted Pong(version=1); CU=767
Program data: a5mNrWc4RHUBAA==
```

Reproduction command for the isolated probe (outside the workspace):

```sh
CARGO_BUILD_JOBS=2 OPENSSL_NO_VENDOR=1 OPENSSL_DIR=/opt/homebrew/opt/openssl@3 \
  cargo +1.95.0 run --locked --manifest-path "$PROBE_DIR/litesvm/Cargo.toml" \
  -- "$APP_DIR/target/deploy/onepercent.so"
```

The host probe linked the already installed OpenSSL 3.6.4 (2026-08-25) after a
slow vendored C build; this changes no Rust dependency resolution or SBF artifact.
The Rust runtime gate passes. The npm 0.8.0 v3 loader refusal still requires the
specified validator fallback. The MagicBlock compatibility compile was also rerun
successfully under host 1.95.0. IDL and SDK regeneration remain byte-identical to M0.
The local validator smoke passed after retrying without the earlier heavy native
compilation load; no validator timeout or program configuration was changed.

### Devnet authority lifecycle — ready for founder-funded continuation

The architect authorized this drill on 2026-10-08, including disposable local
signers, a Squads v4 2-of-3 vault and a 60-second test timelock. The reproducible
script is `scripts/devnet-upgrade-drill.mjs`; the runbook is in `README.md`.
`@sqds/multisig =2.1.4` is a development dependency of the existing app root.
No application workspace package or on-chain product logic was added.

The M0 v3 artifact is already built locally. From the repository root, this single
command resumes the existing payer and journal after the founder credits at least
**3 devnet SOL** through [the official faucet](https://faucet.solana.com/):

```sh
pnpm --dir app devnet:drill --run-id m01 --env-file "$HOME/Documents/ChatGPT/1%/app/.env.local"
```

For a new checkout only, first build with `pnpm --dir app anchor:build`. The env
file supplies only the Helius API key; no credential is included in this command.
Before the first deployment transaction, the script checks the finalized balance.
A sufficient external credit bypasses obsolete faucet receipts and the retained
uncertain request, without sending a new faucet request or replacing keys. Below
the threshold, the existing uncertain request leaves the run untouched and reports
the funding requirement. A funded partial run resumes without requiring rent
already committed to its accounts; a completed run only rechecks the sealed
program. Four regression tests cover external funding and funding-stage resume.

The script accepts only verified devnet endpoints/genesis and generates its own
signers. All private keys and signed-transaction journals remain outside the
repository at `~/.local/share/onepercent/devnet-upgrade-drill/m01/` (0700/0600).
It records a signed transaction before broadcasting it, reconciles its signature
on resume, and refuses to replace an expired transaction with an unknown outcome.
It also locks each run against concurrent signing processes. The committed guard
tests exercise cluster, artifact, authority, multisig, funding and replay boundaries.

The requested sequence is implemented: deploy the unchanged M0 v3 binary under a
disposable address, direct upgrade, transfer to the Squads vault, governed upgrade,
then governed removal of authority. The two proposals require two approvals and
60 seconds from the on-chain approval timestamp. Early execution must produce
Squads error 6021. After sealing, a new complete buffer must produce loader error
`Immutable` and `Program not upgradeable` on an attempted upgrade. These steps are
**not yet executed on devnet**. The unchanged Anchor binary keeps its declared ID;
this drill verifies the loader/governance lifecycle, while `ping` execution is
covered by the local validator at the declared address.

| Observation                                             | Evidence / result                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devnet genesis                                          | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, checked via both authorized endpoints                                                                                                                                                                                                                                                                                                   |
| Squads program                                          | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, executable, owned by the upgradeable loader                                                                                                                                                                                                                                                                                              |
| Squads ProgramConfig                                    | `BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr`; creation fee 0 lamports on both RPCs at finalized slots 508914871 / 508914873, observed 2026-10-08T18:58:46–47Z                                                                                                                                                                                                                         |
| Disposable program                                      | `4H5vF1hXex1HdLz8hYseEntXeGaEe9iGALcA7Q3vz6Yh` (generated; not deployed)                                                                                                                                                                                                                                                                                                                |
| Disposable payer                                        | `AEC78wEfjEEdVWwKmG6hCrtPKcmyzuAZmxd7jw79qU7M`                                                                                                                                                                                                                                                                                                                                          |
| Intended multisig / vault                               | `4Dfk4xtr2JjEkTT7ZH7zUFXGb9gEasvtmaAs7rfFzEFT` / `GVhUkKX5ZwhHKRgr8bgDBM3p8RhtF2GKopdKxrkqEtR3` (derived; not created)                                                                                                                                                                                                                                                                  |
| Helius faucet                                           | Request at 2026-10-08T19:09:59Z returned no usable signature. Both RPCs subsequently showed 0 lamports and no payer history at slots 508917884 / 508917887. Reconciled again after 181 seconds at finalized slot 508918455, 2026-10-08T19:13:02Z: still 0 lamports, no signatures. A separate invalid-parameters diagnostic confirmed HTTP 500 `Internal server error` for this method. |
| Public devnet faucet                                    | Explicit JSON-RPC rejection `-32603` at 2026-10-08T19:13:24Z; no signature returned                                                                                                                                                                                                                                                                                                     |
| Last funding observation                                | 2026-10-08T19:21:46Z, finalized slot 508920658: payer balance 0, no signatures, zero deployment transactions created. The second Helius attempt (19:14:02Z) is retained as uncertain in the private journal; it is not replaced by another request.                                                                                                                                     |
| Deployment / upgrade / authority transaction signatures | None: funding failed before any signed deployment transaction was created                                                                                                                                                                                                                                                                                                               |
| G0.1                                                    | Open: deferred until the funded devnet lifecycle completes and actual transaction signatures/slots are recorded                                                                                                                                                                                                                                                                         |

The script requires a finalized balance of at least 3 devnet SOL to proceed; it
requests at most two successful 2-SOL faucet credits to this same payer. No wallet
rotation or production funding source is used. The same run ID and keys are kept
for continuation. RPC availability and generated addresses are not execution
proofs, and this document does not claim that the devnet authority lifecycle passed.

The official Solana proof-of-work faucet was also investigated read-only as an
alternative. At finalized slot 508923199 (2026-10-08T19:31:52Z), its 23 sources
held a combined 1.0008332 devnet SOL; 21 were empty, including the recommended
difficulty-3 source. The only two remaining sources could not fund this drill,
and the payer lacked the measured 10,000-lamport initial transaction fee. No
mining, installation or faucet transaction was performed. This does not replace
the missing devnet lifecycle evidence. Sources: [official faucet guidance](https://faucet.solana.com/)
and [audited PoW implementation](https://github.com/jarry-xiao/proof-of-work-faucet/tree/1efbcbf87497ed6d75a9bda373766ab11c5b4501).

### Isolated local rehearsal of the complete governance drill

**PASS on a local validator only, completed 2026-10-08T19:39:57Z. This is not
devnet execution evidence and does not close G0.1.** Agave validator 4.3.0 cloned
Squads and its ProgramConfig read-only from devnet. A temporary copy of the drill
used only the loopback RPC, its exact local genesis and a separate temporary key
directory. The committed script retains its strict devnet-only guard. The binary,
loader instructions, SDK, two approvals and 60-second timelocks were unchanged.

Local genesis: `AFKaMBQfUNbZnuUugcw6fUpZHQ2GYG7HAE1BXyzazrPH`. The initial run
found an uninitialized proposal-map access; optional chaining fixed it, and the
same journal resumed without redeployment or a new transaction identity. The full
rehearsal then finalized **775 transactions** with the original artifact hash.

| Local operation      | Finalized slot | Local signature (not a devnet receipt)                                                     |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `deploy`             | 251            | `uHF3XU5ppotS9yFKuVQ29gG4v2p83AsbqQUvf22FNmCPHXTMb5p1KRwpUVxVbocvRXE12u69kUViPcM5omDX3LA`  |
| `direct-upgrade`     | 414            | `2qj3PX25Gbd6NNSjCcyMXy344vyVai9EK59mAWGMmdh5JmB85Ba7u1Rzw4hbjvesDdTy6vAKYfDQopnRj2hy6A1v` |
| `multisig-create`    | 446            | `5n3CLBBw3WWaFA3P1ebcLMPUkVyAZeKftDAPTcJeX1tjA3c4jMDLDSkxjTxUZ77DbxtGpSCLdUDmHsRN1XQs8VcG` |
| `authority-to-vault` | 478            | `3Hkb8EajmMYN2YMAJeLUBLfsnaBuZcsXDF2jfHYNDgon7pq6UJbkYEvhjotLC5b5B4fHTbdJcqmmXg4kYGDxxN6n` |
| `upgrade/execute`    | 981            | `2Vz1mzormwuANwmhjQkuiPjfZC7TgN7jnUfyWshLF5Fnyuz6oUJLLnPNb86MAWV1JBLZPsLHLaQm17bSiqKWdprc` |
| `seal/execute`       | 1261           | `2BCxsfg8nL5zeSmfRCYA5cLn6NtWsbW4VMrfJfcnWC6gBxamu344VYnqx7R24XaxjrTG3STRjFenj3T2ygv6sEn5` |

Early execution returned exactly `InstructionError: [0, { Custom: 6021 }]` at
local slots 839 and 1112. The upgrade executed 78 seconds after approval; authority
removal executed after 83 seconds. The final ProgramData authority was `None` and
the executable bytes were unchanged. A complete fresh buffer then produced exactly
`InstructionError: [0, "Immutable"]` and `Program not upgradeable` at local slot 1383. Re-running the completed journal created **zero new transactions or faucet
receipts** and preserved the completion timestamp. The isolated validator was
stopped after verification.

### Integration with rewritten main and X2

The feature branch was rebased onto `origin/main` at `018bd0f` after the main
history rewrite and the X2a/b merges. The architect authorized aligning the new
`packages/market/package.json` web3.js pin from 1.98.4 to **1.99.0**. The combined
lockfile was regenerated with `pnpm install --no-frozen-lockfile` under the same
14-day policy; no duplicate client or age exemption was introduced.

This corrects the earlier [PR merge CI failure](https://github.com/lilacwine77/onepercent/actions/runs/37833910772)
where both jobs stopped at `ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY` for web3.js
1.98.4. The previous feature-only CI had passed, but did not cover that merge.
The PR report records the new combined checkout checks and the final `ts` and
`program` results. Only the feature branch is pushed, with `--force-with-lease`.

The last devnet funding observation remains **2026-10-08T19:41:01Z**, finalized
slot **508925496**: **0 lamports and no payer signatures**. This is a historical
observation, not a refreshed balance. The founder now owns the faucet credit;
the command above is prepared for continuation without waiting on funding.
Local governance success remains distinct from devnet evidence, so G0.1 stays open.

## X1 native dependency installation

The transitive `bigint-buffer` 1.1.5 package stays outside
`onlyBuiltDependencies` in `pnpm-workspace.yaml`; only `esbuild` is allowed.
Its native install script is intentionally disabled. Clean installations use its
JavaScript fallback, so the optional native-binding warning is expected. No build
permission is added for this package.

X1 uses the same web3.js 1.99.0 pin as M0.1 in eligibility and the API. Its other
added pins remain the approved X1 versions, and the lockfile is regenerated under
the inherited 14-day release-age policy.

## G0.1 devnet drill — PASS (2026-10-08)

Run by the architect with `pnpm --dir app devnet:drill --run-id m01` after funding the payer with devnet SOL.

| Step                                                                              | Result                                                                 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Deploy (sBPFv3 artifact `2cd988bf…f295`)                                          | Program `4H5vF1hXex1HdLz8hYseEntXeGaEe9iGALcA7Q3vz6Yh`, slot 508934754 |
| Direct upgrade                                                                    | slot 508935046                                                         |
| Authority → Squads v4 2-of-3 vault `GVhUkKX5ZwhHKRgr8bgDBM3p8RhtF2GKopdKxrkqEtR3` | slot 508935046                                                         |
| Execute before timelock release                                                   | Refused: `TimeLockNotReleased` (6021) — expected                       |
| Governed upgrade after the 60 s timelock                                          | slot 508935640                                                         |
| Governed seal (authority → None)                                                  | Executed after timelock; authority `null`                              |
| Upgrade after seal                                                                | Refused: `Account is immutable` — expected                             |

Full public evidence (no secrets): `~/.local/share/onepercent/devnet-upgrade-drill/m01/report.json` on the architect's machine. **G0.1 is closed.**

## X3 dependencies — verified 2026-10-08

| Package                          | Exact version | Used by                     | Published       | Registry                                                                          |
| -------------------------------- | ------------- | --------------------------- | --------------- | --------------------------------------------------------------------------------- |
| @onepercent/config               | workspace:*   | bot, api                    | Local workspace | Existing M0 configuration; no external registry release                           |
| @solana/actions-spec             | 2.4.2         | api, development types only | 2024-10-24      | [npm registry](https://registry.npmjs.org/@solana/actions-spec/2.4.2)             |
| @wallet-standard/app             | 1.1.1         | web                         | 2026-06-03      | [npm registry](https://registry.npmjs.org/@wallet-standard/app/1.1.1)             |
| @wallet-standard/base            | 1.1.1         | web                         | 2026-06-03      | [npm registry](https://registry.npmjs.org/@wallet-standard/base/1.1.1)            |
| @wallet-standard/features        | 1.1.1         | web                         | 2026-06-03      | [npm registry](https://registry.npmjs.org/@wallet-standard/features/1.1.1)        |
| @solana/wallet-standard-features | 1.5.0         | web                         | 2026-09-10      | [npm registry](https://registry.npmjs.org/@solana/wallet-standard-features/1.5.0) |

The registry metadata confirms each pinned release and its publication date.
Wallet Standard packages require Node 22 or newer. Existing Node 22.22.3 and
pnpm 10.34.6 satisfy this track. Link verification uses built-in Node Ed25519.

X3 also consumes `@onepercent/eligibility` (`workspace:*`, API and bot) for the X1
result schema and exact SOL formatting helpers; no additional registry package.

## M2 S0 additions

Registry publication dates checked on 2026-10-08. Existing pins from the rebased
M0.1 workspace are retained, including its single `@solana/web3.js` 1.99.0,
pino 10.3.1, Hono 4.13.9 and node-server 2.1.1. No second Solana client SDK is added.

| Package     | Version | Published (UTC) | Used by                                            | Source                                                     |
| ----------- | ------- | --------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| drizzle-orm | 0.45.3  | 2026-09-21      | db                                                 | [registry](https://registry.npmjs.org/drizzle-orm/0.45.3)  |
| drizzle-kit | 0.31.11 | 2026-09-21      | db generation                                      | [registry](https://registry.npmjs.org/drizzle-kit/0.31.11) |
| pg          | 8.23.0  | 2026-08-08      | db, service-kit                                    | [registry](https://registry.npmjs.org/pg/8.23.0)           |
| @types/pg   | 8.23.1  | 2026-08-17      | db, service-kit types                              | [registry](https://registry.npmjs.org/@types/pg/8.23.1)    |
| ioredis     | 5.11.1  | 2026-06-04      | service-kit                                        | [registry](https://registry.npmjs.org/ioredis/5.11.1)      |
| prom-client | 15.1.3  | 2024-06-27      | service-kit                                        | [registry](https://registry.npmjs.org/prom-client/15.1.3)  |
| bs58        | 6.0.0   | 2024-06-24      | service-kit key parsing and transaction signatures | [registry](https://registry.npmjs.org/bs58/6.0.0)          |

Local compose and the services CI job use `postgres:17` and `redis:7` as specified
by M2. No RPC/provider key is supplied to tests. The service runtime has no need
for SPL Token builders until later service jobs; `@solana/spl-token` is not added
in S0. M0.1's existing pnpm 10.34.5 pin remains unchanged after rebase.

## M3.1 additions

Verified against npm registry metadata on **2026-10-08**. The versions below are
older than fourteen days on that date. Existing exact pins remain unchanged.

| Package                            | Version | Published (UTC)          | Source                                                                      |
| ---------------------------------- | ------- | ------------------------ | --------------------------------------------------------------------------- |
| `@wallet-standard/app`             | 1.1.1   | 2026-06-03T21:03:29.713Z | [npm registry](https://registry.npmjs.org/@wallet-standard/app)             |
| `@wallet-standard/base`            | 1.1.1   | 2026-06-03T21:03:29.904Z | [npm registry](https://registry.npmjs.org/@wallet-standard/base)            |
| `@wallet-standard/features`        | 1.1.1   | 2026-06-03T21:03:29.941Z | [npm registry](https://registry.npmjs.org/@wallet-standard/features)        |
| `@solana/wallet-standard-features` | 1.5.0   | 2026-09-10T09:00:03.182Z | [npm registry](https://registry.npmjs.org/@solana/wallet-standard-features) |
| `@playwright/test`                 | 1.63.0  | 2026-09-04               | [npm registry](https://registry.npmjs.org/@playwright/test)                 |
| `@axe-core/playwright`             | 4.13.0  | 2026-08-11               | [npm registry](https://registry.npmjs.org/@axe-core/playwright)             |
| `litesvm`                          | 0.8.0   | 2026-05-20               | [npm registry](https://registry.npmjs.org/litesvm)                          |

`@axe-core/playwright` 4.13.0 is the newest stable release satisfying M3's age
rule. The runtime image preserves the landing's `caddy:2.11.4-alpine` pin.
Registry inspection establishes version availability and age; the lockfile,
installation and browser runs establish integration separately.

## M2 S4 integration dependencies

The architect authorized these manifest additions on 2026-10-08. S4 reuses the
existing exact `zod` 4.6.5 pin, published 2026-09-13 (25 days before this change),
and adds only local workspace dependencies otherwise. No external package
version or release-age exception is introduced.

- SDK: `zod: "4.6.5"` and `@onepercent/config: "workspace:*"`.
- API: `@onepercent/sdk: "workspace:*"`.
- `pnpm-lock.yaml` regenerated by pnpm 10.34.5 with the unchanged 14-day minimum
  release age. The earlier dependency publication record remains authoritative.

Validation uses a fresh frozen-lockfile installation after removing workspace
`node_modules` and TypeScript build output. No temporary dependency links are
required; workspace links are created solely by pnpm from the manifests.

## M1 dependency and runtime validation

M1 keeps Anchor 0.32.2, Agave 4.3.0, Rust 1.95.0, web3.js 1.99.0 and the
Anchor TS client 0.32.2. pnpm remains the M0.1 workspace pin 10.34.5. New direct
Rust pins are below; dates come from the crates.io API or its local sparse-index
`pubtime` metadata, with the registry source linked.

| Crate                             | Version | Published (UTC) | Source                                                                            |
| --------------------------------- | ------- | --------------- | --------------------------------------------------------------------------------- |
| `bytemuck`                        | 1.25.2  | 2026-07-19      | [registry](https://index.crates.io/by/te/bytemuck)                                |
| `solana-sha256-hasher`            | 2.3.0   | 2025-07-25      | [registry](https://index.crates.io/so/la/solana-sha256-hasher)                    |
| `anchor-spl`                      | 0.32.2  | 2026-09-14      | [registry](https://crates.io/api/v1/crates/anchor-spl/0.32.2)                     |
| `ephemeral-vrf-sdk`               | 0.17.3  | 2026-09-24      | [registry](https://crates.io/api/v1/crates/ephemeral-vrf-sdk/0.17.3)              |
| `solana-sdk-ids`                  | 2.2.1   | 2025-02-12      | [registry](https://index.crates.io/so/la/solana-sdk-ids)                          |
| `five8_core`                      | 0.1.2   | 2025-03-19      | [registry](https://index.crates.io/fi/ve/five8_core)                              |
| `litesvm`                         | 0.16.0  | 2026-08-24      | [registry](https://crates.io/api/v1/crates/litesvm/0.16.0)                        |
| `proptest`                        | 1.11.0  | 2026-03-24      | [registry](https://crates.io/api/v1/crates/proptest/1.11.0)                       |
| `serde`                           | 1.0.229 | 2026-07-18      | [registry](https://index.crates.io/se/rd/serde)                                   |
| `serde_json`                      | 1.0.151 | 2026-07-20      | [registry](https://index.crates.io/se/rd/serde_json)                              |
| `solana-keypair`                  | 3.1.2   | 2026-02-24      | [registry](https://crates.io/api/v1/crates/solana-keypair/3.1.2)                  |
| `solana-signer`                   | 3.0.1   | 2026-06-08      | [registry](https://crates.io/api/v1/crates/solana-signer/3.0.1)                   |
| `solana-transaction`              | 4.1.6   | 2026-08-07      | [registry](https://crates.io/api/v1/crates/solana-transaction/4.1.6)              |
| `solana-message`                  | 4.4.1   | 2026-08-07      | [registry](https://crates.io/api/v1/crates/solana-message/4.4.1)                  |
| `solana-instruction`              | 3.4.1   | 2026-08-07      | [registry](https://crates.io/api/v1/crates/solana-instruction/3.4.1)              |
| `solana-address`                  | 2.6.1   | 2026-06-03      | [registry](https://crates.io/api/v1/crates/solana-address/2.6.1)                  |
| `solana-account`                  | 4.3.2   | 2026-08-07      | [registry](https://crates.io/api/v1/crates/solana-account/4.3.2)                  |
| `solana-clock`                    | 3.1.1   | 2026-06-24      | [registry](https://crates.io/api/v1/crates/solana-clock/3.1.1)                    |
| `solana-rent`                     | 4.3.0   | 2026-06-24      | [registry](https://crates.io/api/v1/crates/solana-rent/4.3.0)                     |
| `solana-compute-budget-interface` | 3.0.0   | 2025-08-07      | [registry](https://crates.io/api/v1/crates/solana-compute-budget-interface/3.0.0) |
| `agave-feature-set`               | 4.2.1   | 2026-08-13      | [registry](https://crates.io/api/v1/crates/agave-feature-set/4.2.1)               |

The mock additionally pins `solana-program 2.3.0` (2025-06-06) and
`borsh 0.10.4` (2024-09-23), already present in the shared dependency graph.
Its independent lockfile uses the same approved registry versions as the program
lock; `fixtures/reports/mock-cargo-age.json` records zero additional resolutions.

The program-lock audit covers **385 added or changed registry resolutions**,
with **zero release-age violations and zero metadata errors**, recorded in
[`fixtures/reports/cargo-age.json`](fixtures/reports/cargo-age.json). Eight initially
young selections were lowered to admissible compatible versions: cc, ctutils,
either, find-msvc-tools, light-poseidon, serde_with, serde_with_macros and web-sys.
web-sys' exact dependency family also requires js-sys 0.3.105 and wasm-bindgen
0.2.128 (including its macros/support/shared crates), replacing the corresponding
M0.1 transitive selections. This is required by the 14-day rule for M1's added
web-sys dependency; no direct M0.1 toolchain or client pin changed.

The host compilation failure was a missing feature, not a Rust 1.95
incompatibility or a sandbox write failure. five8 1.0.0's broad core dependency
resolved to the existing five8_core 0.1.2. That version implements `Error` and
`Display` only with `std`, which solana-keypair 3.1.2's parse error requires.
A dev-only exact dependency enables `five8_core/std`; no crate version was moved
for this fix, and the production artifact does not enable a new test feature.

Browser-safe SDK encoding promotes two already-locked dependencies: buffer 6.0.3
([published 2020-11-23](https://registry.npmjs.org/buffer)) and @noble/hashes 1.8.0
([published 2025-04-21](https://registry.npmjs.org/@noble/hashes)). Explicit Buffer
imports avoid relying on a browser global. SDK tests and a Vite browser build
validate this path.

Anchor's IDL constant macro needs typed integer expressions for large values; the
Rust generator writes matching numeric suffixes. Actual IDL literals are JSON
scalars/arrays, UTF-8 byte arrays for byte strings, and base58 strings for Pubkeys.
All 122 exported parameters are checked against config by the SDK.

The sBPF build uses `anchor build --no-idl -- --arch v3`; host IDL generation is
separate. Both program and mock ELF flags are 3. MagicBlock 0.17.3 with
`anchor-compat` compiles with Anchor 0.32.2. The callback matrix's 44 measured cases
cover both all-features and the recorded mainnet feature set, Deck 120,000 and
Binder 65,535. Maximum callback: **101,854 CU**; maximum mock fulfillment plus
45,000 provider allowance: **208,052 CU**; maximum conservative allocation bound:
**17,376 bytes**. OG ×10 logs: **7,078 bytes**. Exact cases and spreads are in
[`fixtures/reports/callback.json`](fixtures/reports/callback.json).

Whole-transaction CU measurements include compute-budget instructions, first ATA
creation, SPL/Token-2022, and distinct FRESH settle payees. Large Feed shapes use a
real lookup-table account and a signed v0 message. CU limits use exactly
`ceil(maximum × 1.25 / 1,000) × 1,000`. See
[`fixtures/reports/cu.json`](fixtures/reports/cu.json) and
[`fixtures/reports/tx-sizes.json`](fixtures/reports/tx-sizes.json).

D20 replaces the mock-only BuyPacks calibration with the larger observed cost
from the real provider ELF and queue cloned from devnet into Agave 4.3.0.
`fixtures/reports/real-vrf.json` records 3,072 signed simulations at occupancies
0, 26, 51 and the exact full snapshot of 52 requests (slot 508,985,211), Deck
100 / 120,000, OG x1 / OG x10 / AH x5, HOLD and both fee-payer arrangements.
The 768 full-queue rejections are included in the maxima and map to `busy`.
Maximum whole-transaction CU is 85,502 / 87,392, giving 107,000 / 110,000 limits.
This proves local execution with the real provider, not a devnet BuyPacks gate;
M1 cannot reach OnAir on a real cluster before M4's `power_on`.
The architect accepted this local calibration for M1 and explicitly deferred the
real devnet BuyPacks gate to M4. The limits stay 107,000 / 110,000 CU.

Host campaigns use an optimized test profile without debug symbols or incremental
artifacts. This avoids exhausting local storage and changes no release code.
Clippy uses that same host profile, and IDL generation selects only `--lib`
instead of also linking every integration-test binary with IDL build features.
Only the host `solana-poseidon` dependency stays at optimization level 0: its
level-1 code generation exceeded 15 minutes; M1 does not invoke Poseidon.
C1 reads account balances without cloning their data; C2 separately verifies token
transfer/burn conservation. Rejected transactions are checked too, accounting for
whether LiteSVM actually charged their fee. Stateful property checks bound rent
shortfalls to observed rent increases and verify monotonic Pull/phase transitions.
The full case count is split across configurable deterministic workers (eight by default; four in the current campaign), with 200 steps
per case. A test fixture tops up only the external mock queue after a rent
increase; underfunded Onepercent accounts retain their real exit behavior.

CU fixtures use deterministic local signers and 32 samples per variant in five
fresh processes. Their aggregate retains the previously measured expensive
Redeem addresses while covering additional SDK transaction shapes and G1's
royalty/referral redirections. The fifth corpus measures 128 closed-Binder
samples across four one-/two-pack forms with a referrer. Settle includes one
full-width Memo per Pull. Measured maxima are 69,029 CU for TakeBack,
39,299 / 65,430 for Settle, and 71,470 / 385,160 for Redeem. The corresponding
limits are 87,000, 50,000 / 82,000 and 90,000 / 482,000 CU. E4 confirms that
signed SDK transactions pay all closed-Binder royalties and referral credits
within the configured limits. The signed Settle matrix
covers 48 forms, with a maximum of 1,119 bytes. The test compares its measured
report to the stored report, so stale `CU_LIMITS` cannot silently survive a
program change. Validator fixtures instead use fresh signers,
the validator's default Rent, and exported SPL/ATA/Memo artifacts. Transactions
start only after a confirmed slot of at least 2.

D17 resolves the six `review_rent_payee` cases on both feature sets. Settle checks
the actual capped credit of 721,920 lamports against the empty recipient's
890,880 minimum and redirects it to stock with its event. TakeBack would leave
695,680 instead of 890,880; CloseVault's real, System-allocated 2,048-byte payer
would finish at 13,599,160 instead of 15,144,960. These two instructions return
the appended `PayeeBelowRent` error before mutation and can be retried after a
top-up. Rent checks retain the recipient's actual data length, which is zero for
an ordinary wallet. The SDK reads the live rent minimum rather than hard-coding
a wallet reserve. Current execution results are in `fixtures/reports/validation.json`.

The G1 follow-up applies D20's writable-account protection for empty buyers and
depositors, stock redirection for uncreditable referrals, and closed-Binder
handling. TakeBack skips its rent check only for a zero projected refund;
CloseVault remains permissionless. The callback obtains all fallible views and
borrows before writing, then completes without a fallible operation. T06.23
checks that boundary and unchanged economic state on malformed input. P2 now
includes third-party writability choices, referrers, actual user fee payers and
an independent payment oracle, plus 58 deterministic payment scenarios.

The local macOS G1 artifact is 662,112 bytes, sBPFv3, SHA-256
`a99e0e928f469e89caedaafe5944ca46c2f48d278aa0823ba754fbd1740fe8fd`.
The authorized devnet run `m1-d17-20261009` deployed the disposable program
`FoTxSjUbEA6435ou5N5YALRrw4FL1accizkYbxdDuzK4`, initialized it, reached StockUp,
and completed Feed followed by TakeBack. All 1,000,000,000,000 base token units
were returned. Its isolated artifact changes only the declared program ID;
compiled parameters are identical. The on-chain ELF matches that isolated build:
`99201a1c6573f840790cbe6d86f1628f1abb08e0e9d3f4eaccb27b3aa4eff413`.
Public receipts, measured CU, retained rent and deployment-fee reconciliation are
in `fixtures/reports/devnet.json`. No additional funding was needed, and the
recorded disposable balance after that run was 3.440932023 devnet SOL. The deployment and private
run journals remain available for the architect; the isolated compilation cache
was removed. This Feed gate does not imply a devnet Rip run.

LiteSVM enforces rent transitions and demotes reserved addresses. T07.11 accepts
an executable requested writable on the mainnet snapshot, consistently with
[SIMD-0162](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0162-remove-accounts-executable-flag-checks.md),
whose feature is active in that snapshot. The SDK still uses the prescribed
read-only metas for executable and reserved payees.

Docker is not installed in this local sandbox. The Linux CI program job completed
two verified builds in fresh target directories and compared their bytes and
hashes in [S7 run 37870549757, job 113627393865](https://github.com/lilacwine77/onepercent/actions/runs/37870549757/job/113627393865).
Both builds produced SHA-256
`ec93b842c89939f04f195af8af31a2afadf0c8f2764136f51a85971303c05c8d`
at 2026-10-09 02:05:53 UTC. This CI result is separate from the local macOS hash
and the disposable devnet artifact above. The build image derives from the official Agave 4.3.0
image pinned by solana-verify 0.5.2 at
`sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd`.
The [official Dockerfile](https://github.com/solana-foundation/solana-verifiable-build/blob/f8cfe2f834f4334aad9c60a29284de0ba396f829/docker/v4.3.0.Dockerfile)
installs cargo-build-sbf 4.3.0 and platform-tools v1.57, but its Rust base is
1.97.1. The CLI selects the container's active host toolchain rather than the
repository override. CI therefore installs and selects host Rust 1.95.0 in a
derived local image, passes its immutable local image ID through `--base-image`,
and explicitly requests `--arch v3 --tools-version v1.57` for both builds.
The derived image preserves the approved M0.1 pins. The successful S7 result
does not replace the CI run required after publishing this integration follow-up.
The nightly matrix runs each property executable at 10,000
cases. CI and devnet results are reported separately from local harness results.
After the rebase on main `578da4c`, the M1 nightly, hygiene and reproducibility
steps are restored over M3.1. A single 03:23 UTC cron schedules both tracks;
the `program` job stays enabled on scheduled runs, and M3.1's web job and program
steps are preserved. Its explicit missing-backend/scenario failure remains until
W2/W3 are available, as documented in the web runbook. Vocabulary checks now use
only the canonical web scanner and import the config lists directly.

The hygiene job uses the standalone Gitleaks CLI, without an action-license
dependency. Its Linux archive is verified before extraction. PR scans use
`origin/main..HEAD`; the nightly scans all refs. Redacted JSON is retained on both
success and failure. `fixtures/reports/gitleaks.json` classifies every finding
from the available full-history scan, with rule/path/content exception tests.
After integration with main `30a8293`, the whole workspace uses the final M1
exports, one validated `SERVICES` object and the generated final M1 event ABI.

| Tool         | Version | Published (UTC) | Source                                                                                   |
| ------------ | ------- | --------------- | ---------------------------------------------------------------------------------------- |
| Gitleaks CLI | 8.24.3  | 2025-04-11      | [official release](https://api.github.com/repos/gitleaks/gitleaks/releases/tags/v8.24.3) |

Linux x64 archive SHA-256:
`9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`.

## M2 S3 keeper and CLI dependency reuse

S3 adds `@onepercent/cli` using only previously recorded exact pins:
`@anchor-lang/core` 0.32.2, `@solana/web3.js` 1.99.0, `@sqds/multisig` 2.1.4 and
`zod` 4.6.5, plus the config workspace link. The keeper uses the existing S0
runtime and the existing workspace toolchain. No new package version or
release-age exclusion is introduced. The lockfile was regenerated with the
workspace's `pnpm@10.34.5` pin and `minimumReleaseAge: 20160`; the PATH bootstrap
version is not the version used for the workspace commands.

### D21 worker dependency declarations

The worker now declares its direct `@onepercent/config` and `@onepercent/sdk`
workspace links and the existing `@solana/web3.js` 1.99.0 pin. `pnpm install`
regenerated the lockfile using pnpm 10.34.5 and the unchanged 14-day policy;
no package version or release-age exemption was added.

## M6 RESCUE-A dependency reuse

RESCUE-A adds no external dependency or pin. It reuses the existing SDK, config,
web3.js, Anchor and zod versions. The workspace remains pinned to pnpm 10.34.5
with `minimumReleaseAge: 20160`; the lockfile is unchanged. The CLI's missing
direct SDK workspace dependency is reported for architectural authorization,
because this track owns only additions to its manifest's bin and scripts fields.

## M2 P2 My cards dependency reuse

P2 adds no dependency, version pin or release-age exception. The program,
SDK and local validator flow reuse the recorded Anchor, Solana, Rust and
TypeScript toolchains. Workspace commands use the `pnpm@10.34.5` pin and the
unchanged `minimumReleaseAge: 20160` policy.

## M4.1 launch scope, D27 and D29 (2026-10-09)

No npm or Cargo dependency pin or lockfile change. All pnpm commands use the workspace's
`packageManager` pin, 10.34.5. Anchor 0.32.2, Solana 4.3.0, host Rust 1.95.0
and the sBPFv3 build wrappers are retained. D27 through D29 were read from
origin/main; the architect merges their decision rows with this branch.

The final D27 season split is 50/50 with a separate 2 SOL floor. Pack splits
and Sell back's 30 SOL target stay unchanged. The localnet/devnet DBC config
signer is explicitly public test material. Mainnet stays PENDING and fails
the parameter, release, Anchor build and SDK builder gates.

DBC and DAMM v2 program dumps, raw accounts, release IDLs and exact provenance
are recorded in `fixtures/meteora/SOURCE.md`. The pinned binaries execute in
the Rust tests and the local validator. No mainnet transaction was signed or
sent. The vocabulary exception requires both the exact upstream IDL path and
its documented SHA-256; our source and copy remain fully scanned.

The local release artifact is 811,864 bytes, with sBPF flags 3 and SHA-256
`8a87be50958865b5c977e195ef0ba9e1b4d5976c74c99202384b1d3a986a9547`.
There are 128 compiled parameters. The IDL, event snapshots, layouts and golden
vectors are generated from this implementation.

The real venue rehearsal creates the DBC config and pool, buys exactly 40M
for the dev deposit, runs Power-On, trades and collects Curve fees, reaches
the 85 SOL migration threshold, migrates, trades on DAMM and collects Pool
fees. It also collects Surplus and verifies all three D27 regimes, with a
replay of the same venue state for AFTER_END. The source-backed DBC flash-rent
account is funded locally and reimbursed exactly. Nonzero Pool base fees are
covered by T24 and remain in FeeIn's canonical base ATA without blocking SOL.

`fixtures/reports/m4-cu.json` records 32 samples per variant; the real validator
measurements are in `m4-meteora-season.json`. New limits, including 25% headroom
and upward rounding, are Power-On 51,000, collection 22,000, Curve/Pool/Surplus
claims 144,000/143,000/84,000 and full fee chains 153,000/168,000/102,000 CU.
The 48-case specials callback matrix peaks at 104,651 CU and 7,224 log bytes.
The real MagicBlock binary was recalibrated locally with this M4.1 artifact
over 3,072 signature-verified simulations. Buy-Packs maxima are 84,979 and
86,869 CU, giving limits of 107,000 and 109,000 CU. The devnet reads supply
the queue and binary fixtures; this does not execute a devnet purchase.

Local validation used Node 22.22.3 and pnpm 10.34.5, with
`CARGO_BUILD_JOBS=3`, `RUST_TEST_THREADS=2`, `M1_PROPTEST_THREADS=2` and
`VITEST_MAX_WORKERS=2`. Heavy commands ran sequentially. The complete Rust run
passed 243 tests with 1,000 property cases and `--no-fail-fast`. P2 (including
the D17 campaign), CR-1, P4 and M-REF then passed at 10,000 cases with seed 20261009. Install, program build, Clippy, golden generation, CU reports,
typecheck, the JavaScript build, all eight validator e2e tests and the separate
`e2e:validator season` command passed. The default JavaScript run passed 2,580
Vitest tests and 44 script tests, with 63 service-test skips: 61 conditional
integration cases and two intentional skips in the in-memory store variant.
The web entry is 117,367 bytes gzip against the 122,000-byte budget.

Three of the conditional cases then passed against a fresh isolated Redis
7.4.11 instance: service-kit SSE/rate limits, API Actions limits and API Intake
limits. Redis was built under `/tmp` with `make -j3`, from the
[official 7.4.11 release](https://github.com/redis/redis/releases/tag/7.4.11),
published 2026-08-17, using source archive SHA-256
`3c266ece0abd54ed3b1c912c6eb86b7508cf382cb690ee6649d3843f018f6357`.
The temporary server and its data were removed after the tests. No workspace
dependency was added.

The additional isolated PostgreSQL 17.11 integration attempt stopped in
`initdb`, before migrations or tests: the sandbox refused its required
56-byte System V shared-memory segment (`shmget`, `Operation not permitted`).
The temporary data directory was removed. The remaining 58 PostgreSQL integration
cases are not validated by this run. PostgreSQL's standard `mmap` setting still
requires that small segment, as documented in its
[kernel resource requirements](https://www.postgresql.org/docs/17/kernel-resources.html#SYSVIPC).

At that delivery, Final Pull claims, their math and Burn-after-Done remained deferred under D18.
The reserved Machine space and stubs remain intact. Production launch tooling
and the atomic launch transaction rehearsal are M4.2 work.

## M2 P2 integration after P1 and cluster deployment (2026-10-10)

The My cards handlers retain the executor's early `ExecInFlight` guard. EX-1
uses valid signed Sell requests and valid Feed back cards, with successful
controls outside an execution. The combined P2 operation set interleaves both
tracks and verifies every bucket's book after each operation before its final
stock drain. T16 adds the M2 permission, error-code, donation and rent matrix.
T01.16 now exercises live Binder exits instead of expecting P0 stub errors.

The SDK builders take an explicit selected program ID, matching the cluster
selection interface. The local Sell flow receives the selected deployment and
uses it for addresses, reads, signed messages and all four transaction builders.
Both My cards batch constants are exported through the generated IDL and checked
against `TX_LIMITS.redeemPerTx`; T13.03 and T14.04 pin eight cards.

The approved D12 guard preserves every edition's previous draw granularity while
a bucket has reservations. Both languages cover returning 30 AH units with a
15 SOL value into 30 OG units with a 1.5 SOL value. Both Binder exits reject a
payout leaving a nonzero owner below its actual rent minimum, before mutation,
without requiring System ownership. An empty, non-executable System account at
the canonical Binder address remains absent even when a third party funds it.

The generated artifact has 130 compiled parameters, sBPF flags 3, 960,208 bytes
and SHA-256 `d5204f9d8df27db85bfcdb9e062e1dfdf6f27d8e9138113a959717d182821e71`.
A final rebuild reproduced the binary used for the full Rust run. All 351 tests
passed with `--no-fail-fast`, 1,000 property cases and seed 20261010. Clippy,
IDL generation and the Rust vector generators passed. The measured P2 maxima
are 32,153/44,473 CU for Sell, 68,584/83,665 for Feed back, 13,519 for owed SOL
and 13,072 for Binder closure. The 25% margin rounded up to 1,000 gives
41,000/56,000, 86,000/105,000 and 17,000 for each exit. Measured signed P2 transactions
reach at most 929 bytes. Full measurements and binary provenance are in
`fixtures/reports/mycards.json`.

The separate local validator commands `sellback`, `exec` and `season` passed,
including real local DBC/DAMM execution, My cards exits and prefunded Binder
addresses. No signed network transaction or dependency change was required.

The complete local validator e2e suite passed all nine tests. With Node 22.22.3
and the pnpm 10.34.5 pin, install, lint, format checking, vocabulary checking,
typecheck, JavaScript tests and the workspace build passed. The JavaScript run
passed 3,263 Vitest tests and 44 script tests; 63 tests were skipped by the
configured suites and are not claimed as validated here. The 24 signed SDK
transaction shapes reproduced every size in the P2 report. Heavy steps ran
sequentially with `CARGO_BUILD_JOBS=3`, `RUST_TEST_THREADS=2`,
`M1_PROPTEST_THREADS=2` and `VITEST_MAX_WORKERS=2`.

## D18 Final Pull upgrade on the D37 48-hour season (2026-10-13)

Final Pull and both claims use existing fields and flags. Machine remains
3,808 bytes; Config, Binder, Card and bucket layouts are unchanged. The checked-in
prior artifact and provenance in `fixtures/upgrade/` initialize, buy, reveal and
settle before the new artifact is installed. T25 then exercises claims, exits,
Done and permissionless Burn without reinitializing or reallocating Machine
or Config.

The localnet sBPFv3 artifact is 1,001,400 bytes, SHA-256
`90b9f3183a324119b1f8e02bf84d377f3a50e58a8f7163461b243c4f13248d03`,
with 133 generated parameters. Final Pull limits come from
`fixtures/reports/final-pull-cu.json`: start 5,000 CU, SOL 9,000 CU,
12-recipient SOL batch 100,000 CU, and 17-card token claim 20,000 CU.
`final-pull-burn-cu.json` covers existing, closed and prefunded ledger paths.
Normal execution budgets stay unchanged. The optional restoration path has a
separate measured allowance. Venue swaps still require route simulation.

P4 passes 10,000 complete 200-step seasons through Final Pull, claims and Done;
T25 separately includes Burn on DBC and DAMM fixtures. The refreshed core and
callback CU reports retain their previous limits. Eleven existing validator e2e
tests pass against the new artifact. Detailed local checks and exclusions are
in `fixtures/reports/final-pull.json`.

Cross-review covered on-chain accounting, account authentication, exits,
SDK instruction composition and keeper reconciliation. This is an internal
review, not the architect's independent PASS. The branch includes main's merged
D37 season and PR #84 public mainnet inputs. No deployment, transaction or
production-state verification is claimed. See `../docs/codex/FINAL-PULL-UPGRADE.md` for the
mainnet-feature build, authority-signed upgrade and post-upgrade checks.

The native `--features mainnet` compile check passes with the published identity
`7H19ieb7A8s8re2fxoh4bd3jf51XXefLroougKLHvreH`. Its sBPFv3 artifact is
1,001,400 bytes, SHA-256
`2fea83fb532524c76048ffdc9702cbbe1ec3d464f25132f6bcfb1eee36823d1c`.
This validates compilation and release pins; the separate reproducible Docker
release build remains required before deployment.
