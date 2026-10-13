# The 1% Machine — M0

An independent pnpm workspace for the application. M0 contains a brand placeholder,
service health checks, provisional typed parameters, and one local Anchor instruction:
`ping` emits `Pong { version: 1 }`. MagicBlock is reserved for M1.

## Install

Use Node 22 LTS (at least 22.22.2), pnpm 10.34.5, Rust 1.95.0, Anchor 0.32.2,
and Agave/Solana CLI 4.3.0. Exact versions and verification sources are in
[VERSIONS.md](VERSIONS.md). All commands below run from `app/` unless stated otherwise.

```sh
nvm use
pnpm install --frozen-lockfile
```

The `packageManager` field pins pnpm. The workspace enforces a 14-day minimum
release age for npm dependencies, including transitive resolutions. If a different pnpm version is installed,
use `npm exec --yes --package=pnpm@10.34.5 -- pnpm` in place of `pnpm` in these
commands. This also works without changing the global package manager.

With Rustup installed, install the host compiler and matching Anchor CLI:

```sh
rustup toolchain install 1.95.0 --profile minimal
cargo +1.95.0 install --git https://github.com/solana-foundation/anchor --tag v0.32.2 avm --locked
avm install 0.32.2
avm use 0.32.2
```

Add Cargo's and AVM's binary directories to `PATH`. Install the archive for your
platform from the [Agave 4.3.0 release](https://github.com/anza-xyz/agave/releases/tag/v4.3.0)
and add its `solana-release/bin` directory to `PATH`. Verify with
`anchor --version` and `solana --version`. CI installs these same releases from
scratch; its installation commands are in the app workflow.

## Run locally

In separate terminals:

```sh
pnpm --filter api dev
pnpm --filter web dev
pnpm --filter worker dev
pnpm --filter bot dev
```

The API defaults to port 3000, the web to `http://localhost:5173`, and the worker's
health server to port 3001. The web fetches the API health endpoint and shows
`API: ok` when it responds successfully.

```sh
curl http://localhost:3000/health
curl http://localhost:3001/health
```

The bot logs `bot disabled` and exits successfully unless `TELEGRAM_BOT_TOKEN` is
set. With a token, `/start` replies `Dust in, Packs out.`.

`.env.example` lists every application setting with blank values and comments.
Service variables are validated before startup, and invalid values produce a
readable error. `VITE_API_URL` is public browser configuration. Service shutdown
handles both SIGINT and SIGTERM.

Services read exported environment variables (for example,
`PORT=3002 pnpm --filter api dev`). Vite also reads `app/.env` for the web.
Docker accepts service environment files through `--env-file`.

## TypeScript checks and builds

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Tests run in every TypeScript workspace. The validator smoke test is separate and
runs through `anchor test`. `pnpm build` produces each package's `dist/` directory
and the Vite web bundle. `pnpm format` applies the same uncustomized Prettier defaults
as the repository root; generated IDL/types and lockfiles retain generator output.

## Local program and SDK

```sh
pnpm anchor:build
pnpm sdk:idl
pnpm anchor:test
```

The program exposes only `ping`, with one signer account. The smoke test calls the
SDK helper and decodes the emitted event from the actual transaction logs on a local
validator. `anchor test` starts and stops the validator.

The SDK uses `@solana/web3.js` 1.x and `@anchor-lang/core` 0.32.2, matching the
program and IDL client generation. Program builders, PDA helpers and account
readers require the caller's runtime `programId`; no deployment address is taken
from the generated IDL. Services use their configured `PROGRAM_ID`.
Meteora builders use a single deployment context: construct
`createDeploymentSelector(programIdsByCluster)` from runtime configuration,
then select the cluster once. `powerOnIx(deployment, input)` and
`claimLaunchFeesIx(deployment, input)` derive both the program ID and Meteora
pins from that context; their inputs have no separate cluster or program ID.
The web build pins the public `CLUSTER` and `PROGRAM_ID` pair from the build environment
(or `app/.env`) through the same selector. Set both for a live build. `VITE_CLUSTER`,
when supplied, must match the wallet network (`devnet` for localnet fixtures).
No address falls back to the IDL in production. An unconfigured build keeps live
program actions unavailable. The pin is compiled into lazy transaction chunks, so
Redeem and other exits do not need `/api/config` to recover the program identity.
Tests and the visual harness supply their own explicit fixture deployment.

The existing lower-level helpers take `deployment.programId`. A missing Meteora
pin rejects Meteora construction without preventing ordinary exits.
`pnpm sdk:idl` copies the generated JSON and TypeScript files unchanged into the
SDK; commit both after a program interface change. CI rejects stale generated files.

`pnpm anchor:build` explicitly builds sBPFv3 and checks the ELF flags.
`pnpm anchor:test` builds and checks that same artifact, prepares an ephemeral
local test wallet under `.anchor/`, and runs the validator with `--skip-build`.
In a checkout whose path has no `%`, the equivalent direct CLI sequence is:

```sh
node scripts/prepare-local-wallet.mjs
export RUSTUP_TOOLCHAIN=1.95.0
anchor build --no-idl -- --arch v3
node scripts/check-sbf-flags.mjs target/deploy/onepercent.so
anchor idl build --out target/idl/onepercent.json --out-ts target/types/onepercent.ts
anchor test --skip-build
```

The wallet and `target/deploy/` program keypairs are ignored by Git. The validator
loads the program at the public address configured in `Anchor.toml`, so each clone
can use its own local keys.

The npm scripts and CI explicitly set `RUSTUP_TOOLCHAIN`: Anchor 0.32.2 otherwise
uses the moving `stable` host compiler for IDL generation, even with a pinned
`rust-toolchain.toml`. Agave supplies its separate platform-tools SBF compiler (recorded in VERSIONS.md).

For checkout paths containing a literal `%`, the web and test runners use temporary
symlinks to the same workspace, with Node preserving those paths. The Anchor runner
aliases its Cargo output directory for LLVM. This follows the landing's existing
local-server approach; generated outputs still live in `app/` and aliases are
removed when the commands finish. Use the pnpm scripts in these checkouts.

`ping(programId, connectionOrRpc, signer)` accepts a deployment public key,
a connection or RPC URL, and a caller-owned
wallet interface (`publicKey`, `signTransaction`, `signAllTransactions`). The helper
does not create or persist a signer.

## Disposable devnet upgrade drill (M0.1)

For a new checkout, build once with `pnpm anchor:build`. With the artifact present,
run or resume the delegated S0/G0.1 exercise from `app/`:

```sh
pnpm devnet:drill --run-id m01 --env-file "$HOME/Documents/ChatGPT/1%/app/.env.local"
```

The script reads only `HELIUS_API_KEY` from that file. It verifies the devnet
genesis and checks the finalized payer balance before creating any deployment
transaction. For the existing `m01` run, fund
`AEC78wEfjEEdVWwKmG6hCrtPKcmyzuAZmxd7jw79qU7M` with at least **3 devnet SOL**,
then run the command above. A sufficient balance bypasses old faucet receipts and
uncertain requests without issuing a new request. When funding is still needed,
it tries the Helius devnet faucet and falls back to the public devnet RPC; an
uncertain earlier request stops new requests and leaves the same run resumable.
Already-funded runs do not require the initial rent budget again.
It accepts no external wallet, program address or arbitrary RPC endpoint. At most
two successful requests of 2 devnet SOL fund the same disposable payer.

Disposable keys and the transaction journal are stored outside the repository at
`~/.local/share/onepercent/devnet-upgrade-drill/<run-id>/` with directory mode 0700
and file mode 0600. `*.keypair.json` is also ignored by Git. Use the same run ID to
resume; do not delete the journal or generate replacement keys after an uncertain
RPC response. The exact signed transaction is saved before broadcast. A transaction
whose outcome is unknown after expiry stops the drill for reconciliation.
After a terminated process leaves `run.lock`, verify that its recorded PID has
exited before removing that lock explicitly; simultaneous recovery never removes
another process's lock automatically.

The sequence is deploy, direct upgrade, transfer to a Squads v4 2-of-3 vault,
governed upgrade after its 60-second timelock, and governed removal of the upgrade
authority. Both proposals must reject early execution. A fresh valid buffer then
proves that an upgrade fails with `Immutable`. Authority, deployment slots and
artifact bytes are checked on-chain; signatures and simulation slots are retained
in the public `report.json` alongside the private journal.

This is a loader and governance exercise using the unchanged M0 sBPFv3 binary at
a disposable program address. Anchor's declared program address remains unchanged,
so `ping` execution is verified separately on the local validator. This script
does not establish a callable application deployment on devnet. The 60-second
delay and faucet budget apply only to this drill, not the product configuration.

`pnpm test` includes the drill's guard tests without running network transactions.
Recorded results and the mainnet feature snapshot are in [VERSIONS.md](VERSIONS.md).

## Services and containers

Hono provides the API and worker health routes: its standard request/response API
allows route tests without a network socket, and its CORS middleware restricts the
API to `WEB_ORIGIN`. Pino logs structured service events; Zod validates environment
settings. grammY handles the bot command.

Each service uses a multistage `node:22-alpine` Dockerfile and runs as the `node`
user. Build with the `app/` directory as the context:

```sh
docker build -f services/api/Dockerfile -t onepercent-api .
docker build -f services/worker/Dockerfile -t onepercent-worker .
docker build -f services/bot/Dockerfile -t onepercent-bot .
docker run --rm -p 3000:3000 onepercent-api
docker run --rm -p 3001:3001 onepercent-worker
docker run --rm onepercent-bot
```

## Parameters and milestone boundary

`@onepercent/config` is the single source of provisional parameters from the M0
brief. Values use bigint lamports/base units and integer basis points. Validation
checks the full price split, card royalties, ordered editions and tiers, the dev-buy
allocation, and zero team token allocation. Hit odds and the wallet card limit remain
`null` pending M1. No economic execution or wallet integration is included in M0.

The accepted M1 compatibility target is `ephemeral-vrf-sdk =0.17.3` with
`default-features = false` and `features = ["anchor-compat"]`; it is deliberately absent from M0 dependencies.

## CI and landing verification

`.github/workflows/app.yml` runs TypeScript and local-program checks when `app/` or
that workflow changes. It has no deployment step. The root landing retains its own
npm setup. Run its unchanged checks from the repository root:

```sh
npm ci
npm test
npm run build
```

## Bot, Blinks and wallet link

X3 adds the plain Telegram chat bot, read-only X-ray Actions, a disabled Rip
Action, and wallet linking by one signed SIWS message. The bot never initiates a
conversation. Feed and Rip commands only open the corresponding page inside
Phantom or Solflare. This track builds no transactions.

Set `PUBLIC_WEB_URL` for the bot to exactly the API's `WEB_ORIGIN`, without a
trailing slash; use HTTPS except on localhost. Set `PUBLIC_API_URL` to an API
origin reachable from the bot (HTTPS, except local/private hosts), and set the same
optional `BOT_API_SECRET` of at least 32 characters on the bot and API. This new
credential is server-to-server only. It must never use a `VITE_` prefix. The web
continues to use public `VITE_API_URL`. Leaving the shared credential unset disables
link creation and lookup; leaving `TELEGRAM_BOT_TOKEN` unset still logs
`bot disabled` and exits successfully.

In a private chat, use `/start`, `/xray <address|name.sol>`, `/feed`, `/rip ah 5`,
`/link`, `/me`, or `/alerts on|off`. Bare addresses and `.sol` names also run an
X-ray. In a group, `/xray` is public; `/hits on|off` is restricted to administrators
and only records a preference in this track. No production caller sends hit posts.

Referral links use `https://t.me/<bot>?start=ref_<code>`, where the code is a Solana
address or a lowercase alias of 3–16 letters, digits or underscores. The first
valid code is retained and appended to that user's private Feed and Rip targets.
Group replies never use a private user's pending code. X1's share artifacts carry
`ref=<scanned address>` by default, or preserve the valid incoming code; the bot
uses those artifacts unchanged. X-ray Actions preserve a valid incoming code and
otherwise use the scanned address (the submitting account for a generic POST).
Aliases remain unresolved until a later track.

X-ray values use exact decimal SOL strings and the label `≈… SOL est.` for X1's
capped estimates. `feedable` counts verified holdings; `checkAtFeed` appears as
`to check at Feed`. An absent `worst` omits that line. Long `.sol` names are
shortened with `…` only in Blink titles, to 40 characters; requests retain them.

`/link` creates a single-use 10-minute URL at `/link/<nonce>`. Open it in the
wallet browser, connect, and sign the displayed message. The API rebuilds the
message, verifies it with Ed25519 and consumes the nonce on the first verification
attempt. Issuing a newer link invalidates earlier open links for that user.
Successful binding replaces any previous user/wallet pair on both sides. The
page keeps no browser storage and makes no third-party requests.

Bot preferences and wallet bindings currently use in-memory stores: restarts
lose them, and replicas do not share them. The store interfaces are reserved for
`packages/db`; do not deploy multiple replicas expecting durable linked state.
The notification sender is implemented and tested, but has no production caller.

The API serves `/actions.json`, `/api/actions/xray`, the `?address=` / `?addr=`
variants and `/api/actions/xray/<address-or-name>`. X-ray POST returns an external
link to the web X-ray page. `/api/actions/rip/<edition>` is always disabled.
Actions alone have wildcard CORS; wallet-link endpoints remain restricted to
`WEB_ORIGIN`. Actions call X1's shared service directly, using its scan cache.
Bot and Actions import the canonical X1 schema and floor display helper from
`@onepercent/eligibility`; only `reasonCode: "mint_missing"` permits absent amounts.
A clean wallet has an explicit Blink description; empty-account-only wallets show
rent back. The API validates `BOT_API_SECRET` once through X1's environment schema.

Link rate limits use the socket IP by default. Set `TRUST_PROXY_HEADER` only when
the trusted deployment proxy overwrites that header; the first valid IP is used.
In-memory maps and pending notifications are capped at 10,000 entries. Nonces have
10,000 active and 20,000 total slots; closed identifiers return 410 until the original
expiry plus 60 seconds, then 404. Cleanup scans run at most once per second, with
exact expiry on lookup. Saturated stores refuse new entries without evicting active
limits, referrals or bindings; alert opt-outs remain available.

The credential guard checks private text, command arguments and media captions,
including mixed-case word sequences, before handlers receive them. PUBLIC_API_URL
allows HTTP only for private/local IPs and local host names (including short service
names such as `api`, `.localhost`, `.local` and `.internal`); no DNS lookup is needed.

Before SW-1, use separate HTTPS previews of this web app and API. The landing
continues to own onepercent.fun. The API preview serves its own `/actions.json`;
inspect an Action with
`https://dial.to/?action=solana-action:<urlencoded action url>`. Dialect registration
and Backpack belong to M5.2; single-use `/go/<session>` URLs belong to the rest of
M5.1. Production reverse-proxy routing belongs to the switch-over milestone.

Per-user bot limits proposed for `PARAMS.md` are 20 updates per minute, 6 X-rays
per minute, and 3 link requests per 10 minutes. Only the first rejection in each
window gets a response. The notification sender additionally enforces 25 messages
per second globally, one second between sends to a chat, and 20 per minute to a
group. A 403 disables that chat; a 429 retries once after Telegram's delay.

X3 tests run offline with explicit fetch guards, fake Telegram responses and
Wallet Standard wallets, and ephemeral Ed25519 test keys. Run the standard
workspace validation commands above. On a phone, the founder still checks that
`/link` opens and signs in both wallets, `/me` shows the linked wallet, `/feed` and
`/rip` open the intended preview paths, and an X-ray Blink unfurls in the inspector.
This manual check is not a merge blocker.

## M2 S0 services core

API and worker entry points now use `@onepercent/service-kit`. The public API
serves X-ray, share cards, Actions and wallet linking from X1/X3 alongside S0
health. The M0 worker heartbeat has been removed; S1–S4 attach the remaining
indexer, signer, keeper and public API features.
The executor and monitor roles stay health-only for M2. See
[service runtime](packages/service-kit/README.md) and [database](packages/db/README.md).

Start local dependencies, build, then migrate:

```sh
docker compose up -d
pnpm build:libs
DATABASE_URL=postgresql://onepercent:local-development-only@127.0.0.1:5432/onepercent pnpm --filter @onepercent/db migrate
```

API/worker now require `DATABASE_URL`, `REDIS_URL`, their own `RPC_URL`,
`PROGRAM_ID` and `LOG_IP_SALT`. The examples list names only. Set one `ROLE` per
process and only its own role key; even empty foreign key variables prevent
startup. Do not source a shared file containing several services' keys. No local
key file is automatically loaded. Signer roles also need separate `INTERNAL_TOKEN`
values of at least 32 characters. S0 implements no signing HTTP route. X-ray uses
`TURNSTILE_SECRET`; non-Solana credentials must never end in `SECRET_KEY` or
`PRIVATE_KEY`, which remain reserved by role isolation (D13).

`api` defaults to `ROLE=public`, serving the full public API and `/health` on
`PORT=3000`. The
private listener defaults to `127.0.0.1:3001` and serves `/health`, `/ready`,
`/metrics`; select another `PRIVATE_PORT` when running several local processes.
`worker` defaults to `ROLE=indexer`, with only the private listener. These settings
supersede M0's heartbeat-only defaults above. In deployment, bind the private
listener to the private interface and expose no public ingress to it. Config
mismatch, role disablement or an unavailable/stale Config check stops signing and
returns 503. DB/Redis/RPC failures are also visible at `/ready`.

Railway's pre-deploy command for the API and worker production images is:

```sh
node node_modules/@onepercent/db/dist/migrate-cli.js
```

It applies committed forward-only migrations, serializes concurrent deploys and
rejects modified migration history. S0's `0000` contains all 22 M2 tables. Never
edit it after merge; generate the next migration after rebasing.

The draft Config adapter follows M1 §7.1. The current M0 program has no Config and
therefore cannot authorize a service key. G2.2 still requires M1/P0 integration.
M2 §4.3 operational [A] values are documented placeholders until PARAMS issue 3;
the unmeasured fee cap and Sender tip stay null. `TxSender` refuses sends until the
fee cap is measured by S3.

Container integration tests run in CI against PostgreSQL 17 and Redis 7. Locally:

```sh
SERVICES_INTEGRATION=1 TEST_DATABASE_URL=postgresql://onepercent:local-development-only@127.0.0.1:5432/onepercent TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @onepercent/service-kit test
SERVICES_INTEGRATION=1 TEST_DATABASE_URL=postgresql://onepercent:local-development-only@127.0.0.1:5432/onepercent pnpm --filter @onepercent/db test
```

Without the explicit integration flag, those tests report skips. With the flag,
missing local URLs fail. DB tests create and remove their own isolated database;
no provider network or deployed keys are used.

## M3.1 web shell and deployment

The web container uses the **repository root** as its context. Its dedicated
ignore file admits `app/` and only the landing assets in the sync script. The root
landing and its Docker configuration remain independent.

```sh
pnpm install --frozen-lockfile
pnpm build:libs
pnpm --filter web assets:landing
pnpm --filter web build
pnpm --filter web test:static
pnpm --filter web test:e2e:fixtures
pnpm --filter web budget
pnpm --filter web lcp
pnpm --filter web dist:check
docker build -f apps/web/Dockerfile -t onepercent-web ..
docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3000 onepercent-web
```

`test:e2e:fixtures` builds its own production-mode app in
`target/web-fixtures`, with the SDK fixture program, devnet wallet chain and
fixture Turnstile site key. It starts fresh local servers on ports 4173 and 4174;
it never reuses the normal `dist` or an already running server. To check this
build without a browser, run
`pnpm --filter web exec node e2e/fixtures-server.mjs --build-only`.

The landing allow-list contains `assets/crt-poster.webp` and the 1% TV film
(`media/onepercent-explained.mp4` and its `.webp` poster frame). Each is copied
without transformation to `/landing/<name>`, compared byte for byte and omitted
from git. The film's captions are the app's own
(`public/experience/home/onepercent-explained.vtt`), kept identical to the landing's
`public/media/onepercent-explained.vtt`. Each new cut of the film bumps the `?v=` of
its three URLs in `src/experience/home/film/film.ts`, as the landing's player does. Add an asset to the sync script and the Docker allow-list only when a
delivered experience component consumes it. Missing source assets fail the build.

`budget` reads the Vite manifest plus the build's rendered-module inventory;
missing inventories fail. The entry closure cannot include the Solana clients or
3D libraries. Dynamic route closures and CSS have separate gzip limits in
`apps/web/budget.json`. `lcp` starts the fixture API on port 4174 and the production
preview on 4173. It runs three cold Chromium contexts per route with CPU x4,
1.6 Mbps and 150 ms latency, and writes measurements to ignored
`target/web-lcp.json`. It fails if any run exceeds a limit, if paint metrics
are missing, or if a request leaves the local fixture origins. Its TBT measurement
sums long tasks after FCP over the explicit five-second observation window.

Railway `dev` settings for `web`: repository root as build context,
`app/apps/web/Dockerfile`, `API_UPSTREAM` pointing at the API's private service
address, and Watch Paths limited to `app/apps/web/**`, `app/packages/**`, the pnpm
workspace/lock files and the copied `public/assets/crt-poster.webp`,
`public/media/onepercent-explained.mp4` and `public/media/onepercent-explained.webp`. The API uses
its existing `app/` context and watches its own and shared packages. No domain
switch occurs with this code change.

The browser receives only `VITE_API_URL`, `VITE_TURNSTILE_SITE_KEY` and
`VITE_CLUSTER`; use the same-origin API in deployments. `TURNSTILE_SECRET`
lives only on the API and is mandatory for live X-ray. Before SW-1, verify on
Railway `dev`: the copied poster loads, an address route returns its OG metadata,
`curl -N /api/stream` receives the backend's ping without buffering, all responses
carry the configured CSP, and the real Turnstile widget loads under that CSP.
Fixture tests do not certify Railway or the live gate. Validator and devnet suites
must fail when their prerequisites or scenarios are absent; they must never
silently substitute fixture runs.

If the shell's pnpm is 10.34.6, run the commands through
`npx --yes pnpm@10.34.5` instead: the workspace retains its approved exact
10.34.5 engine pin. Do not change release-age or engine settings to bypass it.

Set the web image's public `VITE_TURNSTILE_SITE_KEY` and `VITE_CLUSTER` build
arguments for the target environment. On the API, set
`WEB_SHELL_URL=http://web.railway.internal:8080/index.html` (adapt the private
service name/port) and both public share origins to the external web origin.
The `/index.html` path is served by Caddy and cannot recurse through `/x/*`.
An unset shell URL renders only the share fallback; it does not boot the app.
The existing X1 renderer caches that HTML for ten minutes: restart the API after
a web deployment so direct share links immediately use the new asset filenames.

The LCP check requires successful config responses and, for the address route, a
successful X-ray response plus its rendered Copy link control before accepting
measurements. An error page cannot satisfy this performance gate.

Playwright defaults to the fixtures project. Choose a single project per command.
The validator project requires `WEB_VALIDATOR_URL`; the devnet project requires
`WEB_DEVNET_URL`. Each must identify an already running web origin backed by its
matching real environment. Those projects never start the fixture API or preview
server. Missing origins or missing W2/W3 scenarios fail explicitly, including the
nightly step until those milestones are available. No skipped or empty run
certifies their gates. The web CI job also runs the vocabulary scan.

The web transaction-engine suite retains npm LiteSVM 0.8.0 for its local transfer
test. That runtime rejects the compiled sBPFv3 artifact, as already recorded in
`VERSIONS.md`. Following M1 §16.5's fallback, the artifact-loading check starts
`solana-test-validator` 4.3.0 on temporary localhost ports and verifies the
executable program account. Put that exact validator version on `PATH` before
`pnpm --filter web test:chain`. The check cleans up its process and temporary
ledger, needs no devnet wallet and does not certify Feed or Rip instructions.
An absent artifact fails in CI and is an explicit skip in local runs.

For IP-based limits behind Cloudflare and Railway, configure Caddy's
`trusted_proxies` with the explicitly reviewed ingress CIDRs for that deployment.
Do not trust arbitrary client-supplied proxy headers. On the API, set
`TRUST_PROXY_HEADER` only to a single-address header (`CF-Connecting-IP` or
`X-Real-IP`) that the trusted ingress overwrites; do not use the comma-separated
`X-Forwarded-For` chain. Keep direct API ingress restricted to that proxy path.
The default remains the socket address until that trust chain is configured.

Caddy preserves API cache policies, including token logos and share cards. Only
the HTML share route forces `no-cache`; the event stream remains unbuffered.
Missing paths under assets, landing assets and experience assets return 404,
without falling back to the app HTML.

## Bot, Blinks and wallet link — B1

This section supersedes the X3 operational details above. The bot accepts Solana
wallet addresses and forwards `.sns` inputs unchanged to X1's optional resolver.
Legacy name inputs are refused without a scan. Private X-rays use the linked
wallet as the share referral when lookup succeeds. Replies offer one Feed menu
button and one Share button; groups receive only the Share button.

Feed, Rip and My cards links use canonical `/feed`, `/rip` and `/cards` routes.
Each Phantom and Solflare button gets its own random `/go/<id>` URL, valid for
`BOT.sessionTtlSeconds`. Fetching the SPA shell consumes nothing; the page redeems
the id once by POST and checks the same-origin destination before navigation.
A used or expired id returns 410 through its expiry grace period, then 404.
If session creation is unavailable, the bot sends direct canonical wallet links
and logs only a throttled `go_fallback` event. The URL contains only the opaque id;
the session stores the action, optional edition/count and referral code.

`/machine` displays the config and machine snapshots, with no invented launch
date and no token value in SOL unless an executable quote is available. Setup
without a deployed program has no countdown. Missing M4 fields omit their
corresponding lines. `/unlink` removes the wallet pair, disables alerts and skips
queued jobs. `/alerts off` also works without a link or shared API credential.
B1 stores preferences but does not send production notifications; delivery,
Backpack and transaction Actions belong to B2.

Set `DATABASE_URL` on the bot in every Railway environment. Postgres persists
starts, referrals, preferences and links. The API's existing pre-deploy migrator
applies `0001_m5_bot.sql` after S0; the bot never migrates. A dedicated Postgres
advisory lock allows only one poller during deploy overlap. Losing that connection
stops polling. Without a database, local runs warn once and use memory stores.
The private listener defaults to `127.0.0.1:3001`: `/health` reflects polling and
lock ownership, while `/ready` checks the database and required tables. Set the
private host for Railway as for the other services. Never expose it publicly.

The public API uses its runtime Postgres pool and Redis limiter for link, Go and
Actions routes. IP keys are salted hashes. Only `FLAG_BLINKS_XRAY=on` enables the
X-ray Action; off returns a disabled GET and a 403 POST. Successful Action GETs
are cached per URL for 60 seconds ahead of scan rate limits. X-ray headers always
identify mainnet; the disabled Rip stub identifies the configured cluster.
Session routes remain browser-origin restricted and never cache responses.
Hourly retention removes link and Go rows after expiry plus the configured grace.

The M5 config marker contains `BOT_OPS`, `BLINKS_OPS` and `validateBotParams`.
The bot, Blinks and link sessions use the canonical M1 config exports directly.
The `/machine` response adapter
uses S4's numeric phase/pause/coverage contract with fixtures and accepts the
predeployment null phase. Local copy modules remain until M3's copy package and
the Bot/Blinks copy sections land. No registry dependency or version was added.

Run the standard workspace checks and the existing `services` integration job.
The new DB tests cover the migration and constraints; bot and API contract suites
exercise memory stores always and Postgres when `SERVICES_INTEGRATION=1`. API
Redis tests use `TEST_REDIS_URL`. All provider and Telegram calls in unit tests
are stubbed. On iOS and Android, the founder still runs M5 Appendix A.1 rows 1–6
on a preview in Phantom and Solflare. These device checks are not a merge gate.

### B1 audit operations

Retention runs once when the API starts, then hourly. The bot's dedicated
Postgres lock connection enables TCP keepalive. During a deployment overlap,
the replacement bot deliberately returns 503 from `/health` while waiting for
the previous poller to release the lock. Do not configure Railway's deployment
healthcheck to use this endpoint: it can prevent the old deployment from stopping
and the replacement from acquiring the lock. Use the private `/ready` endpoint
for deployment readiness; retain `/health` for polling-state monitoring.

Accepted deviation from M5's writer split: the API's unbind transaction also
sets the private chat's alerts to `off` and marks its queued notification jobs
as skipped. This keeps the link removal and opt-out atomic. The bot still applies
its idempotent local opt-out after a successful unbind response.

## M1 program and SDK

M1 adds the on-chain Feed, Rip, callback, settle, timeout refund, Redeem and vault
exits. The SDK exports their transaction builders, zero-copy account codecs,
attestation encoders, PDA helpers and public error mapping. The production program
contains no test instruction or test feature. At the M1 boundary, later-milestone
instructions returned `NotImplemented` and the season special segments were
disabled. The M4.1 section below records the implemented season instructions.
D1/D20 retain the `spotlight_deposit` and `spotlight_take_back` stubs, which return
`NotImplemented`. The SDK's generic stub encoder includes them; no Spotlight
segment or user flow is enabled.

Use the M0.1 toolchain from `VERSIONS.md` on `PATH`: Anchor 0.32.2, Agave 4.3.0,
Rust 1.95.0 and Node 22. The build wrapper supplies `--arch v3` and verifies the ELF
flags of both artifacts. It aliases the output directory when its path contains
`%`, which LLVM cannot use for temporary output files. IDL generation uses
`cargo test --lib`; Clippy shares the host test profile to limit disk usage.

```sh
pnpm install --frozen-lockfile
pnpm params:rs --check
pnpm lint:words
pnpm program:build
pnpm program:clippy
pnpm program:test
pnpm test:e2e
pnpm e2e:validator feed
pnpm e2e:validator rip
pnpm e2e:validator settle-closed
pnpm program:report
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

`PROPTEST_CASES` defaults to 1,000. Each state-machine case has 200 steps. Set
`PROPTEST_CASES=10000` for the deeper campaign. Host test optimization changes only
the harness; tests always execute the same release `.so`. The state-machine suites
split the requested total across workers, retain shrinking, and print reproducible
seeds. `M1_PROPTEST_THREADS` controls their concurrency. `program:test` supplies
Cargo's `--no-fail-fast`, so an unsuccessful suite does not skip later suites.
The supplemental D17 property in P2 uses the same requested case count across
four shorter payment scenarios; it does not replace the 200-step P2 campaign.

`pnpm golden:update` regenerates the Rust layout, PDA, instruction, attestation and
math vectors. `pnpm sdk:idl` copies the generated IDL/types, exports its constant
snapshot and generates `packages/sdk/src/events/m1.json`, the separate
`packages/sdk/src/events/m4.json` schema, and the event types.
The 21 final M1 events include `ReferralRedirected`; the indexer and public API
share one exhaustive event-name table. Six provisional M2 events remain separate.
Tests compare the snapshot with both the committed IDL and `target/idl` after a
program build. TypeScript tests compare the vectors byte for byte, including
account privileges and parameter parity. Generated JSON retains its generator's format.

The test mock runs at the real MagicBlock VRF program address in LiteSVM and the
local validator. It checks the real request CPI and scoped callback signer, charges
the specified mock request fee, and stores requests in its queue. It is never
used for a devnet deployment. Runtime fixture export writes only disposable test
signers into ignored temporary directories. The validator loads the SPL program
ELFs exported from the same LiteSVM fixture, alongside the production v3 artifact.
The npm LiteSVM 0.8.0 fallback limitation recorded in M0.1 remains; E1–E4 use Agave
4.3.0, with E3's timeout established by a pre-aged exported Pull. E4 sends signed
SDK Settle transactions with closed FRESH Binders, distinct depositors, a referrer
and the buyer as fee payer, using the configured one- and two-pack CU limits.

The developer-only `e2e:devnet feed` command validates the devnet genesis before
funding or deployment. `DEVNET_RUN_ID` selects a resumable run. Supply an existing
bag with `DEVNET_TEST_SIGNER_KEYPAIR` and `DEVNET_BAG_MINT`, or set
`DEVNET_CREATE_FIXTURE=1` to generate disposable signers and a real pump.fun bag.
The S1 fixture uses the pinned official IDL to create a Token-2022 mint, buy a
small bag and collect trading fees into the disposable program's FeeIn PDA.

`DEVNET_EXECUTE=1` enables the funding/S1 transactions; `DEVNET_FIXTURE_ONLY=1`
stops after S1 without building or deploying. `DEVNET_DEPLOY=1` separately enables
the program deployment and Feed/TakeBack gate. `DEVNET_FUNDER_KEYPAIR` supplies an
external funding wallet, which signs only a journaled SOL transfer to the
disposable signer. `DEVNET_FUND_LAMPORTS` is checked against the live rent budget
and capped at this gate's 6.9 SOL authorization. No funding key is copied into the
workspace. All test signers and the program address stay disposable.

A temporary A12 build changes only `declare_id!` and the copied IDL address;
compiled parameters remain byte-identical and the repository's program ID stays
unchanged. Private run journals live under ignored `target/devnet-m1/`. Generate
the public proof with
`node --conditions=development --import tsx scripts/e2e-devnet-report.ts <run-id>`;
it records public addresses, transaction signatures, costs and checks without
key material. M1 cannot run Rip on devnet because `power_on` is a later-milestone
instruction.

The measured CU limits and signed transaction packing tables are in
`fixtures/reports/cu.json`, `real-vrf.json`, `callback.json` and `tx-sizes.json`. Feed uses the
measured conservative legacy/v0 limits, then applies its byte budget to the actual
signed transaction shape. A lookup table must exist and contain the required
accounts for a v0 batch; the builder can reduce a batch when its shape needs it.

CU fixtures use deterministic signers and 32 samples per variant in each of five
isolated processes. Their combined maximum preserves the expensive address
samples when more transaction shapes are added. Settle includes its Memo
instructions, a corpus with all royalty/referral credits redirected, and four
closed-Binder forms with a referrer. Its maxima are 39,299 / 65,430 CU, giving
50,000 / 82,000 limits after the prescribed margin. The size matrix signs 48
Settle shapes, up to 1,119 bytes.
A normal test fails on report drift. To remeasure after a program change, run
`UPDATE_REPORT=1 pnpm program:report`, synchronize `CU_LIMITS` with the componentwise
maximum of the native report and `real-vrf.json`, and rerun the config tests.

`node --conditions=development --import tsx scripts/e2e-real-vrf.ts` reads the
actual devnet MagicBlock ELF and queue, then measures signed SDK transactions on
a local Agave validator. It records the exact snapshot and controlled local
occupancies, both Deck sizes, HOLD and buyer/sponsor fee payers. The M4.1 recalibration covers
3,072 simulations, including 768 full-queue failures mapped to `busy`. Measured
maxima are 84,979 / 86,869 CU; BuyPacks limits become 107,000 / 109,000 after the
specified 25% margin and rounding. This is a local measurement using real provider
code and state; no BuyPacks transaction ran on devnet. `VRF_SNAPSHOT_ONLY=1` records
only the remote snapshot metadata without starting a validator.
The architect accepted the original calibration for the M1 gate. The actual devnet
BuyPacks gate moves to M4, after `power_on`; no additional probe is required.

`pnpm lint:words` delegates to the web workspace's canonical scanner. It imports
the shared config vocabulary, scans tracked and untracked application sources
through `git ls-files`, and retains the approved X3 vocabulary-test exclusion.
The earlier M1 scanner has been removed. An on-demand `workflow_dispatch` run includes
the six 10,000-case property jobs and the existing M3.1 program steps;
the M3.1 web job and its program steps are unchanged.
Gitleaks scans `origin/main..HEAD` for a PR and all refs nightly, and uploads a
redacted JSON report even when a scan fails. Fixture exceptions require the
reviewed rule, path and exact public content; negative controls check those
boundaries. The classified history findings are in
[`fixtures/reports/gitleaks.json`](fixtures/reports/gitleaks.json).

The config schema remains available through `paramsSchema` and `validateParams`.
`PARAMS.SERVICES` is the same object exported as `SERVICES`, with the strict
transport, indexer and API schemas applied during validation. Web SSE timing
reads the same API setting. S1/S4 use the final M1 exports without changing values.
Its construction is marked as pure so web bundles that only use `WEB` can omit
the unused economic validation schema. With the fixture build, the entry bundle
is 116,848 bytes gzip against the unchanged 120,000-byte budget; all 122 generated
on-chain parameters remain identical.

The current local results and unresolved gate conditions are recorded in
[`fixtures/reports/validation.json`](fixtures/reports/validation.json).
D17 checks SOL recipients against the current Rent and the amount actually paid,
after applying the source account's rent cap. Permissionless settlement and
timeout refunds redirect uncreditable payments to stock. Under D20, even an empty
System-owned buyer or depositor must be writable: a third party cannot redirect
their payment by passing a read-only account. Only referrers retain the empty
account exception. TakeBack and permissionless CloseVault check the recipient
before mutating state and return `PayeeBelowRent` if a top-up is needed. TakeBack
checks only a positive projected SOL refund. The SDK's live rent pre-check accepts
`instruction: "takeBack"` for this zero-credit exception; its default remains strict.
The pre-check returns the `payeeBelowRent` copy key and numeric data, without
embedded display text. Compute exhaustion similarly maps to
`computeBudgetExceeded`; `packages/copy` owns both messages.
The thirteen `review_rent_payee` regressions cover both runtime
feature sets, capped royalties/referrals, payee aliases and timeout refunds.
`ReferralRedirected` records referrals credited to stock; the existing
`PackSettled.referral_to_team` field remains in the event layout and stays zero.

## M2 S3 keeper and operator CLI

The keeper implementation and its S0 registration are documented in
[keeper v1](services/worker/src/keeper/README.md). It includes chain-checked
settlement, refunds, phase cranks, empty-vault passes, team withdrawal, durable
signature recovery, VRF monitoring, and the read-only 24-hour priority-fee
collector. The worker entry point remains S0-owned; M1/P0 parameters and S4's
verified queue decoder are required for the final integration gate.

[onepct-ops](packages/cli/README.md) provides initialization, season/role settings,
guardian actions and lookup-table commands. Mainnet signing follows D21 and D23
below. Squads commands produce unsigned transaction/proposal material and an
explicitly scoped simulation; the CLI does not submit those proposals or transactions.

### D21 integration update

D21 supersedes the S3 boundaries in the preceding section. `ROLE=keeper` now
registers its leader loop and lifetime watchdog in an isolated worker startup
branch. Shutdown revokes signing and drains both tasks before closing the pool.
M1/P0 configuration and the measured fee cap remain prerequisites for activation.
Confirmed jobs remain under observation until finality, with the same signed
bytes retained through a fork and fresh plans built only after safe replacement.

Mainnet LUT commands now have an explicit ops-wallet confirmation path that
creates or extends, freezes, and verifies finalized authority removal and exact
contents. Partial execution is reported as incomplete. Other mainnet operations
continue to produce unsigned Squads material. See the CLI README for the required
confirmation token and recovery procedure.

### D23 S3 audit update

D23 counts keeper transaction attempts per new signature; replay does not spend
the rebuild budget. Finalized transactions or finalized action reconciliation
gate job completion, and
an absent Pull is checked with Machine sequence in the same RPC bank. S4's
queue decoder is loaded from `@onepercent/sdk/verify`; unknown block time leaves
occupancy visible and age unknown.

D23 also supersedes the earlier mainnet CLI signing description: `init` and
`guardian` use local operator signatures after genesis checks and a terminal
confirmation. Admin operations continue to export decoded, simulated unsigned
Squads transactions. LUT operations derive the protocol address list, check the
ops-wallet policy and team-wallet membership, and verify finality and freezing.

## M5 B2 items 1–2: Backpack and Rip Blinks

This addition implements the launch slice of M5 B2 (D18) on top of B1: Backpack
browse links, Rip Actions and their generic form, image placeholders, discovery
and validation tooling. The `/me` details and `/alerts` modes, notifications and
digests, Feed/Highlight Actions and actual Dialect submission (M5.2 items 3–5)
remain after launch. The Feed and Highlight template files expose the
architect's agreed props only; their HTTP routes are not mounted. This section
supersedes the B1 notes above about Phantom and Solflare buttons only, Backpack
and transaction Actions belonging to B2, and the disabled Rip stub.

Backpack uses the dedicated [Browse documentation](https://docs.backpack.app/deeplinks/other-methods/browse)
form `https://backpack.app/ul/v1/browse/<encoded target>?ref=<encoded origin>`.
The bot's X-ray reply keeps B1's private Feed-menu callback, so every reply has
three buttons or fewer. That menu, Feed, Rip, My cards and Link offer Phantom,
Solflare and Backpack. Feed, Rip and My cards request three distinct single-use
`/go` sessions, one per wallet button; B1's direct-target fallback applies only
when sessions are unavailable. `/link` keeps its single-use nonce for all three
buttons. The web link page includes Backpack too. `backpackLink` is appended to
the M3 wallet builders; the general wallet hint remains M3-owned. The installed
Backpack iOS/Android test from Telegram (M5 B-2) is a founder check;
documentation and golden strings do not establish that mobile result.

M4's live-special helpers and extended snapshots are absent: Rip uses M1's live
flags of zero and omits Jackpot/The 1% values. `actions.json` maps `/x/*`,
`/rip`, `/packs` and `/api/actions/**`; the `/verify/*` Highlight rule of M5
§10.2 ships with the Highlight Blink, so no rule points at an unmounted route.

Rip POST reads only `account` from the body to build the transaction; it accepts
Dialect’s `type: "transaction"` and ignores additional fields. The edition,
quantity, live flags and optional referral come from its URL. It reads the
confirmed Binder and active queue,
uses the SDK to build an unsigned legacy transaction, enforces one wallet signer
and the instruction/size/compute limits, and simulates before returning it. No
holder attestation or API signing is involved. Snapshot gates read chain time;
POST never consumes the 60-second GET cache. Referral aliases remain unresolved.

Actions use B1's shared 60-second GET cache, including its `Age` header, and its
shared per-IP POST quota; Rip also applies its per-account quota. An Actions POST
above the existing 64 KiB body limit returns a JSON `ActionError`, the wildcard
Actions/CORS headers and `Cache-Control: no-store`; other API routes keep their
previous 413 response.

The images are plain 1080-square placeholders for the architect. Their `as of`
line uses the snapshot read time rounded down to the minute. The cache uses the
server's current minute; `m` is checked only for syntax. Cache hits return the
remaining lifetime, so another HTTP cache cannot add
60 seconds to an already cached snapshot. Image errors use `no-store`.

B2 reuses B1's `BLINKS_OPS` (M5 §4.2). No economic parameter, registry dependency, version
pin, IDL or program source changes are required. There is no new `VERSIONS.md`
row.

### Blinks registration

D18 defers submission until after launch; this PR prepares the sheet. The
[Dialect registration documentation](https://docs.dialect.to/blinks/blinks-provider/blink-registry)
describes manual review and submission to `hello@dialect.to`. The founder submits
and confirms whether separate URL patterns need separate entries. No email or
registration is sent by these tools.

Run from `app/`:

```sh
pnpm --filter api blinks:check --origin https://onepercent.fun
pnpm program:build
pnpm --filter api blinks:e2e
```

The checker reads discovery, validates Action schemas, headers and OPTIONS, then
checks each icon's PNG signature and cache lifetime. Run it on the deployed host
for X-ray and Rip once their routes are available. Open each in
`https://dial.to/?action=solana-action:<urlencoded action URL>`, submit the emitted
sheet, then inspect `https://registry.dial.to/v1/list` for the registered entries.
Production flags still require the founder's wallet checklist. A local fixture
check is not a production or installed-wallet certification.

The local validator command checks Agave 4.3.0 and both sBPFv3 artifacts, reuses
M1's runtime-exported OnAir fixtures, and verifies OG ×1 and ×5 simulation, landed
Pulls and immutable first-referrer binding (E2.01/E2.03). Its temporary local keys
are test-only, removed on exit, and never logged. No devnet funds are needed.
E2.02 belongs to the deferred Feed Blink. The manually dispatched nightly workflow
runs `blinks:e2e` once, in its `prop_p1_feed` leg.

For an offline fixture check, run
`pnpm --filter api exec node --conditions=development --import tsx src/actions/tests/check-fixtures.ts`.
M5-A11 preserves X1's scan-image cache: the checker requires a valid cache age
for X-ray and static icons, and enforces the 60-second maximum on Action GETs
and Rip images. Fixtures reproduce X1's 3,600-second image header. They supply
the static X-ray fallback icon locally; they do not prove that the web deployment
serves that asset.

## M6 rescue CLI: chain-only exits

`@onepercent/sdk/rescue` discovers positions and builds every shipped exit from
the user's RPC: Take back, Redeem, Settle, Refund, Withdraw owed, Close My cards,
Close vault and the `advance_phase` crank. `onepct-rescue` adds local file
signing, simulation, confirmation and the ordered `all` flow. It does not contact
an application service and no exit reads a pause bit. `--cluster` defaults to
mainnet, whose program id is refused until published or passed with `--program`.
`pnpm rescue:bundle` builds the reproducible standalone file with its SHA-256.
See [the rescue CLI guide](packages/cli/src/rescue/README.md) for commands,
recovery and the stopped-services validator drill. The Final Pull upgrade adds claims and a start crank. The IPFS page remains
a later track under D18.

## M4.1 season on-chain, launch scope

D27 uses the final 50/50 season split. D29 launches $1PCT on Meteora DBC,
then migrates to DAMM v2. Local tests execute the pinned mainnet program dumps;
`fixtures/meteora/SOURCE.md` records their hashes and source provenance.

Power-On validates the configured launch wallet, the safe SPL mint and its Meteora DBC
pool and config, credits exactly the disclosed dev buy from unclaimed vault slack, and
sets the season timestamps. The 3,808-byte Machine keeps its existing offsets;
the new mint and two reserved final totals occupy bytes 2,608 through 2,655.
The final totals remain zero until the D18 follow-up upgrade.

The DBC config pin is selected explicitly by cluster. Localnet and devnet use
the public test signer at
`fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json`
(`AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k`). Never use it on mainnet.
`powerOnIx` and `claimLaunchFeesIx` require `cluster: "localnet" | "devnet" |
"mainnet"`; mainnet currently fails because its config pin is PENDING.
Checked-in generated constants and vectors use localnet.

Mainnet launch setup runs in this order: ops generates and holds a separate
config signer, the launch track's `onepct-ops launch config` creates and verifies
the config, its public key is pinned in `METEORA_BY_CLUSTER.mainnet.dbcConfig`,
then the production program is generated and built:

```sh
ONEPERCENT_CLUSTER=mainnet pnpm params:rs
pnpm program:release:check
ONEPERCENT_CLUSTER=mainnet pnpm program:build
```

The generator and direct Anchor wrapper reject PENDING mainnet pins before
building. The release check also rejects the public test key on mainnet. Only
the public key enters the repository; ops retains the production signer.
The Anchor wrapper also checks `--provider.cluster` (both argument forms),
rejects conflicts with `ONEPERCENT_CLUSTER`, and requires that explicit variable
when a custom RPC URL is supplied as the provider cluster.
For a devnet artifact use `ONEPERCENT_CLUSTER=devnet`; localnet is the default
for repository checks. Return to `pnpm params:rs` before checking in generated
localnet artifacts.

The callback evaluates The 1% and Jackpot before each pack. Each
`PackRevealed.live_flags` is that pack's mask; `Pull.live_flags` is their OR.
Special wins create backed cards, which use the existing Redeem exit.
`advance_phase` promotes released cards and supports the eventual
FinalPull-to-Done transition without implementing the snapshot or claims.

D27 trading-fee collection reads its regime before crediting proceeds:

- PoweredOn or OnAir, stock book below 2 SOL: all proceeds enter stock.
- PoweredOn or OnAir, book at least 2 SOL: 50% stock and 50% team, including
  above the 30 SOL stock target. Team rounds down; stock takes the remainder.
- BuysClosed and later: all proceeds enter team, without a stock credit.

No trading fees fund burn. The 5% pack burn stays unchanged. To seed stock,
send SOL to `feeInPda()[0]`, then call `collectCreatorFeesIx`; the same regime
applies to that transfer. It creates no depositor claim. FeeIn's rent floor is
retained, and native tokens in its canonical wSOL account are collected too.

The launch SDK exports `powerOnIx`, `claimLaunchFeesIx`, `collectCreatorFeesIx`, `onePctLiveIndex`,
`jackpotLive`, `liveFlags`, `releaseTimes`, `creatorFeeRegime` and
`splitCreatorFees`. Launch builders require an explicit cluster and reject a
PENDING mainnet config. Vectors cover the layouts, instruction metas, launch-pool
checks, specials and D27 rounding. `CreatorFeesCollected.target` remains the
Sell back target for diagnostics; it never selects the trading-fee regime.

`claimLaunchFeesIx` supports Curve, Pool and Surplus. It signs only the pinned
Meteora CPI as FeeIn. Curve requests zero base fees; Pool claims both sides and
retains any unexpected base amount in FeeIn's canonical $1PCT ATA. Both paths
create that ATA idempotently. `LaunchFeesClaimed` reports `quote` and `base`;
nonzero base calls for a keeper alert. The program cannot transfer, close or
delegate the position NFT, or debit the retained $1PCT. Each wSOL ATA is closed
to FeeIn, including its rent and any prior native balance; the subsequent
collection splits the resulting FeeIn balance above its current rent floor.

Run from this directory with the pinned pnpm 10.34.5:

```sh
export CARGO_BUILD_JOBS=3 RUST_TEST_THREADS=2 M1_PROPTEST_THREADS=2 VITEST_MAX_WORKERS=2
pnpm install --frozen-lockfile
pnpm program:build
pnpm golden:update
pnpm program:clippy
pnpm program:test
PROPTEST_CASES=10000 pnpm program:test --test prop_p2_packs --test prop_cr1_callback --test prop_p4_season --test prop_m_ref
pnpm test:e2e
pnpm e2e:validator season
pnpm program:report
pnpm lint
pnpm format:check
pnpm lint:words
pnpm typecheck
pnpm test
pnpm build
```

`program:test` already uses `--no-fail-fast`. The `season` validator command
covers real DBC config creation, pool initialization, dev buy, Power-On, trading
and Curve collection, migration past 85 SOL, and DAMM trading and Pool collection.
It replays the resulting venue accounts with only Machine timestamps aged to
exercise AFTER_END without waiting two days. Exported fixtures also cover
forced special wins followed by settle and Redeem. Exact lamports are checked
for all three D27 regimes. Disposable test signers and validator ledgers are
removed after each run; only the explicitly public test config signer is kept.

D18 leaves `start_final_pull`, `claim_final_sol` and `claim_final_tokens` as
stubs; Final Pull math, claims and Burn-after-Done belong to
`feat/m4.1b-final`. The P4 launch campaign stops at BuysClosed, redeems cards,
returns unpulled bags and withdraws team SOL; remaining stock and pack burn
retain their tracked claims. The executor uses the merged P1 handlers. D29
includes real DBC and DAMM v2 fee paths and migration rehearsal. The launch
tooling is present; live E4a remains a separate deployment rehearsal.

## B2 audit fixes

Rip accepts the Actions-spec body, including Dialect's transaction type, without
using body parameters to build purchases. The checker probes each distinct Rip
button with `n=0` and requires an uncached Actions error before any chain read.
Insufficient-SOL copy includes the full purchase, VRF and transaction fees, Pull
rent and a conservative Binder rent allowance. Unavailable budget inputs produce
the generic simulation error. Empty, non-executable System-owned Binder accounts
are treated as uninitialized by both Rip and `/api/me`.

GET and image requests share a snapshot for at most two seconds, including reads
already in flight. POST always reads fresh. Response cache keys use only known
query parameters, ignore Host and treat HEAD as GET. Transient X-ray failures
are not cached. Images use the server minute; cached and pending images do not
consume another IP allowance. Rip charges its account quota before the shared
IP quota and logs fixed outcome codes without request identifiers.

Bot wallet buttons use one row each and require three distinct `/go` sessions.
Referral storage failures retain replies without a referral. Deferred alerts,
My cards details and hit posts no longer promise availability at On Air.

## M4.2 season services

Apply the forward `0002_m4_season_services` database migration before starting
the updated workers. It adds trading-fee history, the block-0 projection,
executor attempts and their transaction journal, plus nullable per-pack live
flags. Historical unknown flags stay null. The indexer's existing confirmed
event order and fork rebuild also govern the season projections.

`ROLE=executor` uses its own role guard and leader lock. Burn and JackpotBuy
have separate timers and share a serial transaction queue. The executor uses
P1's actual preflight, composition and instruction builders with a selected
cluster deployment. DBC and DAMM reads use P1's canonical account checks and
recorded quote reserves. Durable intents bind the cluster and program ID.
`SERVICES.landing` still contains measurement-dependent values owned by K1;
they are not filled with defaults. See the executor's README for the remaining
integration gates and its unsigned dry run. The validator `exec` flow exercises
the worker reader, planner and composer for both kinds on DBC and DAMM v2,
then verifies real swaps and exact accounting. The `season` validator also
simulates the fee keeper reader and its atomic Curve, Pool + Surplus and
Pool collection plans, plus its backup migration, against the real venues.
PostgreSQL and Redis service integration tests require their CI services.

The keeper collects Meteora Curve fees, then Pool fees and unclaimed partner
Surplus after migration, before `collect_creator_fees` in the same transaction.
The PoweredOn-to-OnAir transition appends `advance_phase` to that collection.
The phase keeper stops at BuysClosed for this launch scope. The fee keeper
continues collecting afterward, can submit the backup DAMM migration, and
monitors positive collections, reserve changes and unexpected base fees.
Set `PROTOCOL_LOOKUP_TABLE` to the frozen active protocol table. A PENDING
mainnet Meteora config refuses fee-chain construction.

The public API adds `/api/block0` and `/api/creator-fees?limit=100`, optional
season fields on `/api/machine`, and the corresponding season SSE categories.
Block-0 uses `launchPool` for the DBC pool address. It stays pending until its
complete window is finalized and the confirmed scan passes the required
32-slot margin. Its internal ready marker uses the existing durable outbox;
it is not a program event. API reads share a repeatable-read SQL snapshot.
Amounts remain decimal strings and unknown spending remains null.

Final Pull, Burn-after-Done, HOLD and the full launch CLI are outside this
services delivery. `finalPull` remains null and HOLD remains disabled. The
landing and architect-owned experience components are unchanged.

## P3 keeper account evidence

The [P3 layout and proof contract](programs/onepercent/P3-KEEPER-HISTORY.md)
documents the reserved-byte extension, legacy activation through `advance_phase`,
execution-time StockBuy guards, and the bounds K1 can derive without event
history. [DEVNET.md](DEVNET.md) describes the required pre-upgrade Pull inventory.
No K1 integration is included.

## Final Pull upgrade (D18, 48-hour season)

The program now implements `start_final_pull`, `claim_final_sol`,
`claim_final_tokens` and permissionless Burn in Done. Existing Machine and
Config layouts are unchanged. Claims remain available without a pause, signer
service or keeper, including zero claims and claims after Done. Token claims
create Final cards redeemable through the existing exit.

The SDK and `onepct-rescue` expose the new instructions. The keeper starts the
snapshot at `end_ts + 600` with no pending draw, pushes SOL claims using a
durable job per Binder and advances to Done at `final_ts + 259,200`. The
historical launch-scope exclusions above describe the pre-upgrade artifact.

See [the upgrade procedure](../docs/codex/FINAL-PULL-UPGRADE.md) for mainnet
feature builds, founder-authority signing and post-upgrade accounting checks.
The legacy binary fixture and `t25_upgrade_final_pull` exercise existing
serialized accounts across the upgrade, including a complete season through
Done and Burn. `final-pull-cu.json` records measured transaction budgets.
