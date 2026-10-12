# @onepercent/market

Offline-testable market clients for The 1% Machine. X2a provides Jupiter display
prices, token metadata, Pyth SOL/USD with Jupiter fallback, and shared HTTP,
cache and replay utilities. X2b adds executable quotes, reserve caps, Sell back and listing evaluation in
its separate, stacked PR. No service loop or transaction signing is included.

```ts
import { createPriceSource, loadMarketEnv } from "@onepercent/market";

const prices = createPriceSource({ fetch, env: loadMarketEnv() });
const info = await prices.getTokenInfo(mints);
const displayPrices = await prices.getPrices(mints);
const solUsd = await prices.getSolUsd();
```

`PriceSource` implements the interface in the X2 brief verbatim. Every requested
mint is present in a result; missing or stale data is `undefined`. USD prices are
for display only. A token's SOL value must come from an executable sell quote.
Icons are exposed only when their URL uses HTTPS. No ATH is inferred.

## Environment

`loadMarketEnv()` is the only environment reader. Pass it a string dictionary in
tests or when loading a local environment file. See `.env.example` for the four
settings:

- `JUPITER_API_KEY`: optional; absent selects the keyless request limit.
- `PYTH_HERMES_URL`: optional; defaults to config and preserves a base path.
- `PYTH_HERMES_API_KEY`: required for live Hermes calls. Without it the price
  source skips the request and falls back to Jupiter wSOL.
- `SOLANA_RPC_URL`: required for live slot/account reads.

Never print keys or the RPC URL's path/query. Provider payloads are not included
in errors. HTTP responses are validated with passthrough zod schemas.

## Shared clients and timing

Provider clients accept an injected `fetch`, `Clock` and optional shared HTTP
client. Display-price, token, Hermes and slot clients also accept a cache.
Price and token clients inside `createPriceSource` share one Jupiter
limiter. Consumers constructing multiple clients for the same organisation must
pass the same HTTP client/limiter; across processes, partition the organisation's
capacity with `jupiterShareBps`. Request counts are separate from endpoint credit
costs. A 429 follows the provider reset header, even below the configured rate.

The limiter uses a strict rolling minute (no continuous refill that would permit
more than the minute capacity). Fractional process shares are rounded down to an
integer request count; a zero capacity is rejected. Price, token, Hermes and slot
clients coalesce identical concurrent requests. Price data is cached per mint, but
age is recomputed against the
confirmed slot cache, so a warm price cannot bypass the staleness filter. A price
cache hit can still refresh the slot after its one-second TTL.

`TtlCache` is asynchronous; its values must be JSON safe. Missing values are
stored as `null`. The in-memory cache stores JSON copies with bounded LRU eviction,
so caller mutation cannot alter cached state. Timeouts cover both response headers
and body parsing. Native timeout waits are cancelled when each attempt finishes.

## Tests and fixtures

From `app/`:

```sh
pnpm install --frozen-lockfile
pnpm --filter @onepercent/market typecheck
pnpm --filter @onepercent/market test
pnpm --filter @onepercent/market build
```

The package's own scripts build `@onepercent/config` first, because config exports
its generated `dist` files. No config package manifest change is required. Tests
use the workspace test runner, which handles the percent character in this repo's
path. The setup file disables global network access. Clients instead receive
`fixtureFetch()` from `@onepercent/market/testing`.

Fixture replay matches method, path and sorted query. RPC replay matches method
and parameters independently of the redacted transport URL and incidental request
id. Select individual fixture files to isolate scenarios with identical requests.
A missing fixture fails explicitly. `createStaticPriceSource` is available for
other tracks' tests without a live provider.

Fixture recording is a manual operation, never a CI step:

```sh
pnpm --filter @onepercent/market fixtures:record --env-file /absolute/path/to/.env.local
```

Live secrets stay outside version control. Each fixture records its observation
time and request/response provenance. The architect explicitly authorised
synthetic Pyth fixtures because no Hermes key is available; those examples test
parsing, authentication headers, freshness and confidence, and do not establish
live Pyth prices or historical route behaviour. Synthetic boundary fixtures carry
`synthetic.from` and `synthetic.edit` metadata. The PR lists the full inventory.

## Integration and decisions

Only the X2 section was appended to config. `X2_PENDING_M1` copies exactly the
subset listed in the brief from PARAMS §22.4; a test compares every value against
that document. `SELL_BACK.payoutBps` still comes from M0. When M1 integrates, remove
the temporary subset and redirect `src/params.ts` to M1 exports. Technical units
and integer bounds in that adapter are representation constants, not new policy.

The integrator should add the four blank environment lines above to
`app/.env.example`. X2a adds no new dependency versions and needs no VERSIONS row.
The existing optional native websocket build scripts remain unapproved; the
clients use injected HTTP fetch and do not require them.

Architect decisions for X2b: keep floor interpolation and test
`marginalValue(h, a) <= valueAt(a) + 1n`, including rungs `(2, 1)`, `(4, 2)` with
`h = a = 1`. A confirmed missing curve or canonical pool means no Pump cap;
an RPC failure or an unavailable required vault means cap unavailable.

## X2b: executable values and Sell back

Create one shared HTTP client for Jupiter and one shared RPC client for chain
readers. Reuse them in all clients belonging to that process/organisation share:

```ts
import {
  buildLadder,
  createChainRpc,
  createExitCapClient,
  createHoldersClient,
  createHttpClient,
  createJupiterLimiter,
  createJupiterSwapClient,
  createJupiterTokensClient,
  createMintSafetyClient,
  createValueClient,
  loadMarketEnv,
} from "@onepercent/market";

const opts = { fetch, env: loadMarketEnv() };
const http = createHttpClient({
  ...opts,
  provider: "jupiter",
  limiter: createJupiterLimiter({ env: opts.env }),
});
const swap = createJupiterSwapClient({ ...opts, http });
const tokens = createJupiterTokensClient({ ...opts, http });
const rpc = createChainRpc(opts);
const exitCaps = createExitCapClient({ ...opts, rpc });
const mintSafety = createMintSafetyClient({ ...opts, rpc });
const holders = createHoldersClient({ ...opts, rpc });
const { valueNow } = createValueClient({
  quoteSell: swap.quoteSell,
  getExitCap: exitCaps.getExitCap,
});
const current = await valueNow(mint, amount);
const ladder = await buildLadder(mint, baseAmount, valueNow);
```

`current.status === "unavailable"` renders as an em dash. Successful SOL values
mean approximately what could be received if sold now. The value uses one sell
quote and a read-only reserve cap; it never uses display prices. wSOL and zero
amounts require no I/O. A quote exceeding all real reserves is unavailable,
not a reduced but supposedly executable quote. Virtual reserves cannot raise
this cap. `/order` amounts include the provider fee; `/build` always requests
zero platform fee and checks the returned slippage floor. Building returns
instructions and lookup-table addresses only. `priceImpact` is retained as a
decimal string, not used in monetary arithmetic.

`quoteSellBackBatch(input, snapshot, valueNow)` accepts only chain-derived card
and machine fields from the caller. It values the total token amount with one
quote, then applies the stocked-value cap, payout, SOL floor, UTC-hour budget
and bucket cap in the prescribed order. Invalid bounds, duplicate indices and
oversized batches fail before provider I/O. A single-card quote has exactly
its six quote fields plus the SB message inputs. JSON helpers enforce strict
schemas and decimal bigint strings. Encoding and signing remain with SDK/API.

The UTC hour reset is the architect-approved mirror of PARAMS §0.6. When M3.1
ships, its actual on-chain semantics must be compared with this implementation
and golden vectors added if they differ. No pause bit or exit authority is
implemented here.

## X2b: listing evidence

`createListingEvidenceGatherer` accepts the clients above, a Hermes client and
a `buildLadder` callback. `evaluateMajor` and `evaluateTrending` are pure and
return a strict, JSON-safe `x2-listing-v1` report with every criterion. Missing
fetched evidence is null and fails its criterion. The mint identity is the
validated input, not fetched evidence. The provider depth field is used only
for the explicitly labelled listing criterion.

The probe uses integer Pyth prices and exponent normalization before one final
division. Both SOL and token feeds must satisfy the existing age/confidence
bounds. Historical updates must be inside their requested UTC day; otherwise
the seven-day statistic is unavailable. Eight positive closes yield seven log
returns and sample standard deviation, rounded up to bps. Log differences
avoid ratio overflow for extreme finite values.

The five-major report snapshot lives in the standard Vitest snapshot directory.
It is test evidence from separately timed recordings, not a live listing
approval. All latest Pyth success samples and WIF's eight historical points are
explicitly synthetic. The other four majors have no historical points, so their
sigma criteria fail closed. A recorded PUMP mint fails safety because of its
TransferHook.

## X2b: recording and integration notes

The full manual recorder now also records chain and swap observations. Select
`--chain-only`, `--x2b-swap-only`, or `--x2b-edges-only` to refresh just that group.
Rerun tests and review snapshots after refreshing live inputs; quotes and account
state are time-sensitive. No recorder runs in CI.

Each pair of 81-, 150- and 166-byte curves was independently decoded in published
IDL field order and compared with the offset decoder. Fixtures include the
public source URL, SHA-256, offsets and expected fields. Real 115- and 151-byte
variants are also covered. Fully absent appended fields default as specified;
partially present fields are malformed and yield unavailable data. The PumpSwap
fixture is 301 bytes, and its quote balance comes from its real token vault.
Confirmed lack of a Pump curve also covers an empty, system-owned prefunded PDA.

Reserve-cap-binding and above-reserve swap fixtures are synthetic boundary
variants linked to a recorded live curve with two reserve lamports. The live
candidate probed during recording migrated before the account snapshot; no
observed executable cap-binding quote is claimed. The stored algorithm and
boundaries are unchanged. Negative virtual reserves, missing vaults and mint/
holder edge cases are likewise marked synthetic.

Add this row to `app/VERSIONS.md` during integration (that file was not edited):

| Package    | Version | Used by                  | Source                                                       |
| ---------- | ------- | ------------------------ | ------------------------------------------------------------ |
| fast-check | 4.10.2  | @onepercent/market (dev) | [npm registry](https://registry.npmjs.org/fast-check/4.10.2) |

Its transitive `pure-rand` 8.4.2 is pinned in the lockfile. No other importer's
resolution changed. X2b adds no economic config keys: the complete X2 section
already shipped in X2a. Added adapter constants are solely public layout offsets,
representation widths, the incinerator address and the provider account limit.
