# Codex brief — X2: market data package (Jupiter, Pyth, value function, hit-list rules)

Issued 2026-10-08 by the architect. X2 is a **parallel track**: it runs next to M1, adds one new package (`app/packages/market`), and contains **no on-chain logic and no keeper loop**. It ships as **two PRs**, so other tracks can start early: **X2a** (prices and token info, about half a day) and then **X2b** (swap quotes, value function, Sell back quote, listing bars). Authority order: `MODEL.md` > `MODEL-SPEC.md` (cited as **SPEC §x**; not in the repo yet, so this brief and `PARAMS.md` restate everything X2 needs) > `PARAMS.md` > `00-MASTER-BRIEF.md` > this brief.

## 0. Context in 6 lines

- Product: "The 1% Machine" on Solana. Trenchers Feed bags into the Deck, openers Rip packs (4 Dust Cards + 1 hit), and hits come from a public list of liquid tokens (SPEC §3.4) bought by an atomic keeper.
- Every token amount shown in SOL is "≈ X if sold now" and comes from the **value function** (SPEC §5.3): an executable Jupiter sell quote, capped at real reserves. **Never price × amount, never Jupiter's "liquidity" figure.**
- **Sell back** pays `floor(min(Σ stocked value, live quote) × 8_700 / 10_000)` within an hourly budget (SPEC §5.4). Off-chain, X2 computes the quote and pre-checks every on-chain limit. The API signs it later (not X2).
- The hit list has two classes, MAJOR and TRENDING, each with a published listing bar (SPEC §3.4). X2 evaluates those bars as pure functions and writes a pass/fail report per criterion. `onepct-ops hitlist check` (M3.2) will call them.
- Consumers: `services/api` (X-ray, values, price cache, quote signer), `services/worker` (keeper stock policy, M3.2) and `packages/cli` (hit-list ops). **Another track codes against the `PriceSource` interface in §5.1 now**, so it must match exactly.
- If anything here is ambiguous, contradicts PARAMS.md, or a provider behaves differently from §3, **stop and report** instead of guessing.

## 1. Rules for this track

1. **Branches.** X2a: `feat/x2-market`. X2b: `feat/x2-market-b`, branched from `feat/x2-market`. Base: `feat/m0-scaffold` until PR #1 is merged, then `main`. Rebase when PR #1 lands. Open X2b with base `feat/x2-market` until X2a merges. **Never push to `main`.**
2. **File ownership.** X2 may edit only:
   - `app/packages/market/**`;
   - the **X2 section** of `app/packages/config/src/index.ts`, appended at the end of the file between the markers in §4;
   - `app/pnpm-lock.yaml`, only for the changes `pnpm install` makes for the new importer. No other importer's resolution may change.

   Everything else is out of bounds, including `app/.env.example`, `app/VERSIONS.md`, root configs, `packages/sdk` and the M0/M1 config blocks. List the lines those files need in the PR (§10). The integrator applies them.
3. **Numbers.** Every number comes from `@onepercent/config`. In `packages/market`, only `src/params.ts` imports config; all other modules import from `params.ts`. Add a key only if it is missing, inside the X2 section, and list it in the PR. **Never invent an economic number**: if one is missing, stop and ask.
4. **Money.** Lamports and token base units are `bigint`, and rounding is `floor` unless stated otherwise. Floats are allowed only for display USD (`usdPrice`, `getSolUsd()`) and for the volatility statistic (§6.6). Never multiply a float into a lamport amount.
5. **I/O.** Every HTTP client takes an injected `fetch`. Time, sleep and randomness come from an injected `Clock` (`nowMs()`, `sleep(ms)`, `random()`). Validate every provider response with zod (passthrough of unknown fields).
6. **Tests.** Every test runs on recorded fixtures, and CI never calls the network (§7). TypeScript `strict`, ESM, Node 22, Vitest, exactly as M0.
7. **Dependencies.** Use only `zod` and `@solana/web3.js` at the exact versions already in the lockfile; never add a second version. `fast-check` 4.10.2 (master brief §4) may be added as a devDependency of `market` only. Do not use a Jupiter or Pyth SDK, `@pythnetwork/hermes-client` or `@solana/kit`; use zod-typed `fetch` (master brief §4). Respect `minimumReleaseAge` if the workspace sets it.
8. **Secrets.** Read env only through `loadMarketEnv()`:

   | Variable | Required | Use |
   |---|---|---|
   | `JUPITER_API_KEY` | optional; empty means keyless at 30 req/min | `x-api-key` header |
   | `PYTH_HERMES_URL` | optional; default from config | base URL, which may contain a path |
   | `PYTH_HERMES_API_KEY` | required for live Hermes calls (§3) | `Authorization: Bearer` |
   | `SOLANA_RPC_URL` | required for live calls | JSON-RPC |

   Keys never appear in a URL, a log line, an error message or a fixture. Log only the RPC URL's host.

## 2. Target layout (create exactly this)

```
app/packages/market/
  package.json          # "@onepercent/market"; exports mirror @onepercent/sdk (types from src, "development" condition,
                        # import from dist) plus "./testing"; scripts build|typecheck|test like the other packages,
                        # plus "fixtures:record" (manual, never in CI)
  tsconfig.json  tsconfig.build.json  vitest.config.ts   # setupFiles: tests/setup.ts (network guard)
  .env.example          # the 4 variables of §1.8, with comments, no values
  README.md             # usage, env, how to record fixtures, which PR shipped what
  src/
    index.ts  params.ts  env.ts  errors.ts  clock.ts  cache.ts  testing.ts
    http/       fetch-json.ts  retry.ts  rate-limit.ts  status.ts  redact.ts        # X2a
    rpc/        slot.ts                                                             # X2a
    jupiter/    price.ts  tokens.ts (X2a) · swap.ts (X2b)
    pyth/       hermes.ts  (latest: X2a · historical: X2b)
    price-source.ts                                                                 # X2a
    chain/      pump-layouts.ts  exit-cap.ts  mint-safety.ts  holders.ts           # X2b
    value/      value-now.ts  ladder.ts                                             # X2b
    sellback/   quote.ts                                                            # X2b
    listing/    evidence.ts  evaluate.ts  sigma.ts  report.ts                       # X2b
  scripts/record-fixtures.ts
  tests/  setup.ts  *.test.ts  fixtures/{jupiter,pyth,rpc}/*.json
```

- `typecheck` and `test` must pass on a clean checkout in CI order (typecheck runs before build). `@onepercent/config` currently exports only `dist`. If it must be built first, do that inside `market`'s own scripts. Do not edit config's `package.json`, and report the choice.

## 3. Provider facts (verified by the architect on 2026-10-08; re-check when recording fixtures)

| Provider | Fact |
|---|---|
| Jupiter, all endpoints | Base `https://api.jup.ag`, key in `x-api-key`. Keyless works at 30 req/min. Plans: Free 60, Developer 600, Launch 3,000, Pro 9,000 req/min. The window is a 60 s sliding window, counted **per organisation**: the API and the quote signer share one org, the keeper has another. Over the limit: HTTP 429 with `x-ratelimit-reset` (unix seconds); `x-ratelimit-remaining` is also sent. Credits: Price v3 1, `/order` 1, `/build` 1, Tokens search **10** |
| Price v3 | `GET /price/v3?ids=a,b,…` takes ≤ 50 ids. The response is keyed by mint: `{usdPrice, blockId, decimals, priceChange24h, liquidity, createdAt}`. Omitted mints are missing keys. **`blockId` is a slot**: live, it read 454,606,158 while `getSlot` read 454,606,224. Prices up to 14 days old are still returned (`research/valuation.md`), so freshness is our job |
| Tokens v2 | `GET /tokens/v2/search?query=<comma-separated mints>` takes ≤ 100 mints. It returns an array of `{id, name, symbol, icon, decimals, tokenProgram, launchpad, graduatedPool, graduatedAt, holderCount, liquidity, usdPrice, priceBlockId, firstPool{id,createdAt}, audit{isSus?, mintAuthorityDisabled, freezeAuthorityDisabled, topHoldersPercentage, …}, organicScore, organicScoreLabel, isVerified, tags, createdAt, updatedAt}`. `audit.isSus` is present only when true. **There is no ATH field** |
| Swap V2 `/order` | `GET /swap/v2/order?inputMint&outputMint&amount` with optional `taker` (omitted: quote only, `transaction: null`), `swapMode` (`ExactIn` only), `slippageBps`, `excludeRouters` (`metis,jupiterz,dflow,okx`). The response has string `inAmount`/`outAmount`, `otherAmountThreshold`, `router`, `requestId`, `feeBps`, `priceImpact` and `routePlan`. `outAmount` is net of Jupiter's fee (10 bps observed on memecoin → SOL). No quote returns HTTP 400 (for example `"Failed to get quotes"`) |
| Swap V2 `/build` | `GET /swap/v2/build`. **`taker` is required.** `slippageBps` defaults to 50; `maxAccounts` is 1–64 (default 64); `platformFeeBps` defaults to 0 (needs `feeAccount`). Also: `payer`, `destinationTokenAccount`, `nativeDestinationAccount`, `transactionVersion`, `wrapAndUnwrapSol`. It returns `computeBudgetInstructions`, `setupInstructions`, `swapInstruction`, `cleanupInstruction`, `otherInstructions`, `addressesByLookupTableAddress`, `blockhashWithMetadata`, `inAmount`, `outAmount`, `otherAmountThreshold`. An instruction is `{programId, accounts[{pubkey,isSigner,isWritable}], data: base64}`. `/build` charges no Jupiter fee, routes through Metis only, and needs `/submit` or our own RPC to land |
| Pyth Hermes | **An API key is now required.** Live calls without a key return `401 unauthorized` on both `https://hermes.pyth.network` and `https://pyth.dourolabs.app/hermes`. The key goes in `Authorization: Bearer <key>`. `GET {base}/v2/updates/price/latest?ids[]=<feed>&parsed=true` returns `parsed[]: {id (no 0x), price{price: string, conf: string, expo: int, publish_time}, ema_price, metadata{slot,…}}`. `GET {base}/v2/updates/price/{publish_time}?ids[]=…&parsed=true` returns the first update with `publish_time ≥ t` |
| Solana | A slot is ≈ 0.27 s. `getSlot` (commitment `confirmed`) |
| PumpSwap pool | Verified on a live canonical pool (`2B8tft…`, 301 B): discriminator `f19a6d0411b16dbc`; `index` u16 @9; `creator` @11; `base_mint` @43; `quote_mint` @75; `pool_quote_token_account` @171; `lp_supply` @203; `coin_creator` @211; `is_mayhem_mode` @243; `is_cashback_coin` @244; `virtual_quote_reserves` **i128 LE @245** (+17.37 SOL observed). Payouts are capped at the **real** quote vault. Virtual reserves affect pricing only |
| pump.fun BondingCurve | Borsh field order: `virtual_token_reserves`, `virtual_sol_reserves`, `real_token_reserves`, `real_sol_reserves` (u64 @32), `token_total_supply`, `complete` (bool @48), then appended fields `creator` @49, `is_mayhem_mode` @81, `is_cashback_coin` @82, `quote_mint` @83 (default pubkey = SOL), `creator_fee_bps` u64 @115. Live lengths are 81, 150 and 166 B. Trailing fields absent on shorter accounts read as false or default. **Verify every offset on ≥ 2 recorded live accounts per length; if one disagrees, stop and report** |

## 4. Config: the X2 section

1. **Check the base first.** If `@onepercent/config` already exports the PARAMS.md §22.4 blocks (M1 merged), import them and add only `MARKET`. Otherwise, add `X2_PENDING_M1`, holding **exactly** these PARAMS.md §22.4 key paths and values, nothing more:
   - `LAMPORTS_PER_SOL`, `BPS_DENOMINATOR` and `WSOL_MINT`;
   - `PROGRAM_IDS.{pumpFun, pumpSwap, splToken, token2022}` and `PUMP_LAYOUTS`;
   - `STOCK.{targetBaseLamports, pythMaxAgeSeconds, pythMaxConfBps, trendingPoolFeeAllowanceBps}`;
   - `SELL_BACK.{quoteTtlSeconds, solFloorLamports, hourlyBudgetMinLamports, hourlyBudgetBpsOfStockSol, eligibleKinds}`. Take `payoutBps` from the M0 block, which is unchanged;
   - `HIT_LIST.{launchMajors, solUsdPythFeedId, neverListed, majorBar, trendingBar, capMaxPriceImpactBps}`;
   - `XRAY.priceIdsPerCall`, `FEED_RULES.{maxMintDecimals, allowedToken2022Extensions}` and `TX_LIMITS.redeemPerTx` (the Sell back batch bound, PARAMS A7).

   Whichever of M1 and X2 merges second deletes `X2_PENDING_M1` and re-points `market/src/params.ts`. That is a one-file change.
2. **Section format** (append-only; do not touch `PARAMS`, `paramsSchema` or `validateParams`):

```ts
// ===== BEGIN X2 MARKET SECTION — owner: X2 (docs/codex/X2-MARKET-BRIEF.md). [OFF] =====
// Client behaviour and third-party facts only; no economic value. [EXT] verified 2026-10-08; [A] architect default.
export const MARKET = {
  http: { timeoutMs: 5_000, maxAttempts: 4, backoffBaseMs: 250, backoffMaxMs: 4_000, rateLimitWaitMaxMs: 60_000 }, // [A]
  jupiter: {
    baseUrl: 'https://api.jup.ag', // [EXT]
    planRequestsPerMinute: { keyless: 30, free: 60, developer: 600, launch: 3_000, pro: 9_000 }, // [EXT] per org, 60 s sliding
    plan: 'developer', // SPEC §8.7: Developer plan, ≥ 10 RPS
    tokensMintsPerCall: 100, // [EXT]
    buildMaxAccounts: 40, // [A] leaves room for exec_begin / exec_end and compute budget in a v0 tx
    listingProbeExcludeRouters: ['jupiterz', 'dflow', 'okx'], // [A] Metis only = what /build executes
  },
  pyth: { defaultHermesUrl: 'https://hermes.pyth.network', requestsPerMinute: 60 }, // [EXT] / [A]
  rpc: { slotCacheMs: 1_000, requestsPerMinute: 600 }, // [A]
  price: { maxAgeSlots: 13_500, cacheTtlMs: 10_000, missCacheTtlMs: 10_000 }, // [A] 13,500 slots ≈ 1 h at ≈ 0.27 s
  tokenInfo: { cacheTtlMs: 21_600_000 }, // [A] 6 h
  solUsd: { cacheTtlMs: 5_000, fallbackToJupiter: true }, // [A]
  exitCap: { curveFeeBps: 125 }, // [EXT] pump curve 0.95% protocol + 0.30% creator, SOL pairs
  ladder: { maxRungs: 12, stopBelowRecoveryBps: 5_000 }, // [A] research/valuation.md STEP 1
  listing: { majorSellProbeLamports: 150_000_000_000n, sigmaWindowDays: 7, largestAccountsScanned: 20 }, // SPEC §3.4
} as const;
// marketParamsSchema (zod, strict) + validateMarketParams(), in this section only.
// ===== END X2 MARKET SECTION =====
```

3. X2a adds the whole section, including keys only X2b uses. Tests for the section live in `packages/market/tests/config-section.test.ts`. They cover: `validateMarketParams()` passes; it rejects a negative timeout, `maxAccounts` outside 1–64, and a plan missing from the table.

## 5. PR X2a — prices and token info (first, small)

### 5.1 The interface (export it verbatim from `src/price-source.ts`; another track depends on it)

```ts
export interface PriceSource {
  getPrices(mints: string[]): Promise<Record<string, { usdPrice: number; blockId: number; ageSlots: number } | undefined>>;
  getTokenInfo(mints: string[]): Promise<Record<string, { symbol: string; name: string; logoURI?: string; launchpad?: string; ath?: number } | undefined>>;
  getSolUsd(): Promise<number>;
}
export function createPriceSource(opts: {
  fetch: typeof fetch; env: MarketEnv; cache?: TtlCache; clock?: Clock; logger?: MarketLogger;
  jupiterPlan?: JupiterPlan; jupiterShareBps?: number; maxPriceAgeSlots?: number;
}): PriceSource & { getSolUsdDetailed(): Promise<SolUsdReading> };
```

- `MarketLogger` is `{ debug, info, warn }`, pino-compatible, no-op by default (no pino dependency). `jupiterShareBps` (default 10_000) is the share of the org's limit this process may use.
- `src/testing.ts` (subpath `@onepercent/market/testing`) exports `createStaticPriceSource(data)` for other tracks' tests, and `fixtureFetch(dir)` (§7).

### 5.2 Behaviour

- **All three methods.** Deduplicate mints. Every requested mint is a key of the result; `undefined` means unknown, omitted or stale. `[]` returns `{}` with no I/O. Validate each mint with `new PublicKey(m)`; an invalid one throws `MarketError('INVALID_INPUT')` before any request.
- **`getPrices`.** Chunks of `XRAY.priceIdsPerCall` (50); one `getSlot` per call (cached `slotCacheMs`); `ageSlots = max(0, slot − blockId)`. A missing or null `blockId`, or `ageSlots > maxPriceAgeSlots`, gives `undefined`: log the count of drops, never throw for a stale price. **`liquidity` is parsed and discarded**; it never leaves the module.
- **`getTokenInfo`.** Tokens v2 search in chunks of `tokensMintsPerCall` (100). `symbol` and `name` are trimmed; `logoURI` = `icon` only if it is an `https:` URL; `launchpad` = `launchpad` when non-null; `ath` stays `undefined` (Tokens v2 has no such field; never derive one). Keep the full parsed record for X2b as `JupiterTokensClient.getTokens(mints)`.
- **`getSolUsd`.** Read Hermes latest for `HIT_LIST.solUsdPythFeedId`. Accept it only if `nowSec − publish_time ≤ STOCK.pythMaxAgeSeconds` (60), `price > 0` and `conf × 10_000 ≤ STOCK.pythMaxConfBps × price` (bigint). Otherwise, if `solUsd.fallbackToJupiter` is set, use the Price v3 wSOL price under the same slot-staleness filter; else throw `PRICE_UNAVAILABLE`. The value is `Number(price) × 10^expo`, display only. `getSolUsdDetailed()` returns `{usd, source: 'pyth' | 'jupiter', publishTime | ageSlots}`. Cache `solUsd.cacheTtlMs`.
- **Caching.** `TtlCache` is async (`get`, `set(key, value, ttlMs)`, `delete`), so a Redis implementation can come later; values are JSON-safe (bigint as string). `InMemoryTtlCache` is bounded (LRU, 10,000 entries). Keys are namespaced (`jup:price:v3:<mint>`, `jup:tokens:v2:<mint>`, `pyth:latest:<feed>`). Misses are cached `missCacheTtlMs`. Concurrent identical requests are coalesced.

### 5.3 HTTP core (shared by X2b)

- **`fetchJson(schema, request)`.** Per-attempt timeout through `AbortController` (`http.timeoutMs`), then a zod parse (failure: `PROVIDER_SCHEMA`). Retry up to `maxAttempts` on network errors, timeouts, 429 and 5xx; never on other 4xx. Delay with full jitter: `clock.random() × min(backoffMaxMs, backoffBaseMs × 2^attempt)`. On 429, wait until `x-ratelimit-reset`, at most `rateLimitWaitMaxMs`.
- **Rate limiting.** A token bucket per provider: one Jupiter limiter per org, shared by price, tokens and swap; one each for Pyth and RPC. Jupiter capacity = `planRequestsPerMinute[plan] × shareBps / 10_000` per sliding 60 s. Without an API key the plan is `keyless`, with one `warn`.
- **Errors.** `MarketError` carries `code` (`INVALID_INPUT | PROVIDER_HTTP | PROVIDER_AUTH | PROVIDER_RATE_LIMITED | PROVIDER_TIMEOUT | PROVIDER_SCHEMA | STALE_PRICE | WIDE_CONFIDENCE | PRICE_UNAVAILABLE | NO_ROUTE | QUOTE_UNAVAILABLE | EXIT_CAP_UNAVAILABLE`), `provider`, `status?` and `retryable`. Messages go through `redact()`, which strips API keys, bearer tokens, and RPC URL paths and queries.
- HTTP status codes live in `src/http/status.ts`, the only file besides `params.ts` allowed to hold numeric literals (§8.4).

## 6. PR X2b — swap quotes, value function, Sell back quote, listing bars

### 6.1 Jupiter Swap V2 client (`jupiter/swap.ts`)

**`quote({inputMint, outputMint, amount: bigint, excludeRouters?})`.**
- Request: `GET /swap/v2/order` with exactly `inputMint`, `outputMint`, `amount` (decimal string), `swapMode=ExactIn` and optional `excludeRouters`.
- **Never send** `taker`, `referralAccount`, `referralFee` or `payer`.
- Returns `{inAmount, outAmount, minOut: otherAmountThreshold, router, requestId, feeBps, priceImpact, fetchedAtMs}`, with amounts as bigint.
- A 400 that mentions a route or quote is `NO_ROUTE`, with no retry.
- Helpers:
  - `quoteSell(mint, amount)`: token → wSOL;
  - `quoteBuy(mint, lamports)`: wSOL → token.

**`build({inputMint, outputMint, amount, taker, slippageBps, maxAccounts?, destinationTokenAccount?, nativeDestinationAccount?, payer?})`.**
- `slippageBps` is **required**: callers pass a config value. `maxAccounts` defaults to `buildMaxAccounts`.
- It always sends `platformFeeBps=0` and never sends `feeAccount`.
- Returns typed instructions plus `toTransactionInstruction(ix)` (web3.js), `lookupTables`, `outAmount`, and `minOut` = `otherAmountThreshold`.
- **Sanity check:** require `minOut ≥ floor(outAmount × (10_000 − slippageBps) / 10_000)`, else `PROVIDER_SCHEMA`.

Not included: `/execute`, `/submit`, signing, sending, blockhash handling.

### 6.2 Exit caps (`chain/*`, read-only RPC over injected fetch)

**`getExitCap(mint)` → `{kind: 'none'} | {kind: 'curve' | 'pumpswap', realQuoteLamports, feeBps, mayhem, solQuote, slot}`.**

1. **Bonding curve.** The PDA is `["bonding-curve", mint]` under `PROGRAM_IDS.pumpFun`. Without an account with the pump owner and discriminator `17b7f83760d8ac60`, the result is `none`, for example WIF or BONK.
2. **Live curve** (`complete == false`): `realQuoteLamports = real_sol_reserves`, `feeBps = exitCap.curveFeeBps`, `solQuote = (quote_mint is default)`.
3. **Completed curve.** Derive the canonical pool `["pool", u16 0 LE, pool_authority, mint, WSOL_MINT]` under `PROGRAM_IDS.pumpSwap`, with `pool_authority = PDA(["pool-authority", mint], pumpFun)`. If it exists (owner and discriminator checked): `kind: 'pumpswap'`, `realQuoteLamports` = **balance of `pool_quote_token_account`** (`getTokenAccountBalance`; virtual reserves ignored), `feeBps = STOCK.trendingPoolFeeAllowanceBps`, `solQuote = (quote_mint == WSOL_MINT)`. No canonical pool (older coins migrated to Raydium): `none`.
4. Decoders are length-tolerant (§3). A missing account or an RPC error is `EXIT_CAP_UNAVAILABLE`, never `none`. These readers are **display and quote-cap helpers only**: on-chain checks belong to the program (spike S4), and X2 switches to `packages/sdk` decoders once they exist.

**Mint safety and holders** (also `chain/*`; listing bars only):
- `getMintSafety(mint)` (`getAccountInfo`, `jsonParsed`) returns the owner program (SPL or Token-2022), `decimals ≤ FEED_RULES.maxMintDecimals`, whether mint and freeze authority are null, the Token-2022 extension names, and `safe` (extensions ⊆ `allowedToken2022Extensions`).
- `getTopHolders(mint)` reads `getTokenLargestAccounts` (up to `largestAccountsScanned`), the owners and `getTokenSupply`. It excludes the canonical pool, the bonding curve, the incinerator `1nc1nerator11111111111111111111111111111111` and every **off-curve** owner (PDAs: pools and vaults), listing each exclusion. `top10Bps = ceil(Σ top-10 remaining × 10_000 / supply)`.

### 6.3 Value function (`value/value-now.ts`, SPEC §5.3)

**`valueNow(mint, amount)` → `{status: 'ok', lamports, quoteLamports, capped, capLamports?, router, requestId, fetchedAtMs} | {status: 'unavailable', reason}`.**

- `mint == WSOL_MINT` gives `lamports = amount`, and `amount == 0n` gives `0n`, both with no I/O.
- Otherwise run one `quoteSell(mint, amount)` (`R`) and `getExitCap(mint)` in parallel. A failed quote gives `NO_QUOTE` / `PROVIDER_ERROR`; a failed cap gives `CAP_UNAVAILABLE`. Then:
  - `kind 'none'`: `lamports = R`.
  - `!solQuote`: `NON_SOL_QUOTE`. `realQuoteLamports == 0`: `NO_REAL_RESERVES`.
  - `R > realQuoteLamports`: `QUOTE_EXCEEDS_REAL_RESERVES`. The quote is provably not executable (the WBTC-pair case in `research/valuation.md`).
  - Otherwise `cap = floor(real × (10_000 − feeBps) / 10_000)`, `lamports = min(R, cap)`, `capped = R > cap`.
- `unavailable` renders as "—". **No path may compute price × amount or read `usdPrice` or `liquidity`** (test in §8).

### 6.4 Marginal quote ladder (`value/ladder.ts`)

- **`buildLadder(mint, baseAmount)`.** Rungs `s_k = baseAmount × 2^k` for `k < ladder.maxRungs`, each `out_k = valueNow(mint, s_k).lamports`. Stop at the first unavailable rung, or after the first rung with `recovery_k = floor(out_k × s_0 × 10_000 / (out_0 × s_k)) < stopBelowRecoveryBps`. Then clamp: `out_k = min(out_k, 2 × out_{k−1})` (per-unit value non-increasing), then `out_k = max(out_k, out_{k−1})` (record `nonMonotone: true` when it fires).
- **`valueAt(ladder, x)`** (pure). Floor linear interpolation between rungs; below `s_0`, `floor(x × out_0 / s_0)`; above the last rung, `undefined`. **Never extrapolate.**
- **`marginalValue(ladder, held, add)`** = `valueAt(held + add) − valueAt(held)`, or `undefined` if either side is.
- **`capLamportsAtImpact(ladder, impactBps)`** = `out_k` of the largest rung with `recovery_k ≥ 10_000 − impactBps`. It sizes a bucket's cap at listing (`HIT_LIST.capMaxPriceImpactBps`, 2%) and, later, the keeper's chunks (0.5%, M3.2).

### 6.5 Sell back quote (`sellback/quote.ts`, SPEC §5.4, PARAMS §9)

**Input.** The caller reads all of it from chain; X2 never trusts a client number.
- `{owner, cards: [{cardId, cardIndex (u16), mint, amount (u64), valueLamports (u64), kind}], nonce (u32 = binder.sb_nonce), nowTs}`, with 1 to `TX_LIMITS.redeemPerTx` cards and distinct `cardIndex`.
- A `MachineSnapshot`: `{phase, endTs, stockSolLamports, stockBookLamports (stock_sol + Σ C(b)), hitOutLastHourLamports, sbHourIndex, sbPaidHourLamports, stockSolAtHourStartLamports, bucket: {mint, class: 'MAJOR' | 'TRENDING', enabled, bookCostLamports, capLamports}}`.

**Algorithm:** run the checks in this order. The first failure returns `{ok: false, reason}`. There is no partial fill.

```
PHASE            phase != 'OnAir' or nowTs >= endTs
KIND             some kind ∉ SELL_BACK.eligibleKinds (silver, blue, holo, black)
MINT             cards not all on one mint, or ≠ bucket.mint
BUCKET_DISABLED  !bucket.enabled
QUOTE_UNAVAILABLE  q = valueNow(mint, Σ amount) is unavailable or 0    // ONE quote for the batch total
v       = min(Σ valueLamports, q.lamports)
payout  = floor(v × SELL_BACK.payoutBps / 10_000);  margin = v − payout
below   = stockBookLamports < STOCK.targetBaseLamports + hitOutLastHourLamports;  toTeam = below ? 0 : margin
SOL_FLOOR        stockSolLamports < payout + toTeam + SELL_BACK.solFloorLamports
sameHour = floor(nowTs / 3600) == sbHourIndex                     // lazy UTC clock-hour reset, PARAMS §0.6 [A]
paid     = sameHour ? sbPaidHourLamports : 0;  base = sameHour ? stockSolAtHourStartLamports : stockSolLamports
HOURLY_BUDGET    paid + payout > max(hourlyBudgetMinLamports, floor(base × hourlyBudgetBpsOfStockSol / 10_000))
CAP              bookCostLamports + v > capLamports
```

- `3600`, the u16 and u32 bounds live in `params.ts` (`SECONDS_PER_HOUR`, `U16_MAX`, `U32_MAX`). The hour-reset mirror is the architect's reading of PARAMS §0.6: when `sell_back` lands (M3.1), the program's semantics win; fix the mirror then and add golden vectors.

**Output** `{ok: true, quote}`. `quote` is a `SellBackBatchQuote`: `{cardIds, mint, amount, payoutLamports, expiresAt, nonce}`, the SB-v1 message inputs `{owner, cards: [{cardIndex, amount}], totalAmount, quoteLamports: q.lamports}`, `{valueLamports: v, stockedValueLamports, bucketClass}`, and metadata `{router, requestId, quoteFetchedAtMs}`. `expiresAt = nowTs + SELL_BACK.quoteTtlSeconds[major | trending]` (60 / 20 s).

- `quoteSellBackCard(card, …)` is the batch of one. It returns `SellBackQuote` = **exactly** `{cardId, mint, amount, payoutLamports, expiresAt, nonce}`, plus the message inputs above.
- `serializeSellBackQuote` / `parseSellBackQuote` round-trip through JSON (bigint as decimal strings, zod strict).
- X2 **does not sign and does not encode the message bytes**. `packages/sdk` owns the `1PCT-SB-v1` encoding and its golden vectors; the API owns the Ed25519 signing, behind a local (KMS-free) signer interface.

### 6.6 Hit-list listing bars (`listing/*`, SPEC §3.4, PARAMS §8.2)

**Evidence gatherers** (I/O) return typed evidence. Every field is nullable: `null` means it could not be fetched.
- `gatherMajorEvidence(mint, pythFeedId)`: mint safety; Pyth latest; Tokens v2 (`firstPool.createdAt`, `liquidity`, `symbol`); the 150 SOL probe; 8 daily Hermes closes; a ladder for `capLamports` (base rung = `quoteBuy(mint, 1 SOL).outAmount`).
- `gatherTrendingEvidence(mint)`: the bonding-curve origin proof; mint safety; Tokens v2 (`graduatedPool`, `graduatedAt`, `holderCount`, `organicScore`, `audit.isSus`, `symbol`); the derived canonical pool and its real quote balance; mayhem flags (curve @81, pool @243); quote mints; top holders; a ladder for `capLamports`.

**Evaluators** `evaluateMajor(evidence, nowMs)` and `evaluateTrending(evidence, nowMs)` are pure. They return a `ListingReport` `{version: 'x2-listing-v1', mint, class, checkedAt, pass, criteria[], info}`, with each criterion `{id, pass, observed, threshold, source}`. `pass` is true only if **every** criterion passes; missing evidence fails its criterion with `observed: null`. bigint is serialized as strings, and a zod schema covers the report.

**MAJOR criteria:**

| `id` | Passes when |
|---|---|
| `never_listed` | symbol ∉ `neverListed` |
| `mint_is_safe` | the mint-safety check is safe |
| `pyth_fresh` | age ≤ 60 s |
| `pyth_conf` | `conf × 10_000 ≤ 100 × price` |
| `age_days` | `firstPool.createdAt` ≥ 90 d before now |
| `liquidity_usd` | Tokens v2 `liquidity` ≥ 1,000,000. This is the SPEC §3.4 bar, labelled `[EXT]`, **listing only**; never a value |
| `sell150_recovery_bps` | ≥ 9_700 |
| `sigma_daily_bps` | ≤ 1_500 |

`sell150_recovery_bps`:
- `T = floor(150 SOL × P_sol × 10^e_sol × 10^dec / (P_tok × 10^e_tok × 10^9))`, all in bigint from Pyth integers (normalize the exponents first, so only the final division floors);
- `out = quote(mint → wSOL, T, excludeRouters = listingProbeExcludeRouters).outAmount`;
- `recovery = floor(out × 10_000 / 150 SOL)`.

`sigma_daily_bps`:
- from 8 daily closes, at the UTC midnights before now (Hermes `publish_time` route);
- 7 log returns, sample standard deviation (n − 1);
- `ceil(σ × 10_000)`.

**TRENDING criteria:**

| `id` | Passes when |
|---|---|
| `never_listed` | symbol ∉ `neverListed` |
| `pump_origin` | H1: PDA, owner and discriminator all match |
| `mint_is_safe` | the mint-safety check is safe |
| `graduated_canonical_days` | `graduatedPool` == the derived canonical pool **and** `graduatedAt` ≥ 7 d before now |
| `pool_real_quote_lamports` | ≥ `minPoolQuoteLamports` (300 SOL), real vault only |
| `holders` | ≥ 5_000 |
| `top10_bps` | ≤ 2_500 |
| `organic_score` | ≥ 50 |
| `not_sus` | `audit.isSus` is absent |
| `not_mayhem` | neither mayhem flag is set |
| `sol_quote` | the pool quote is wSOL and the curve quote is SOL |

**Info fields:** `capLamports = capLamportsAtImpact(ladder, capMaxPriceImpactBps)`, the excluded holders, and Jupiter's `topHoldersPercentage` (information only).

Writing dated report files, the daily schedule and Squads proposals belong to `onepct-ops` (M3.2), not X2.

## 7. Fixtures and the network guard

**Network guard.** `tests/setup.ts` replaces `globalThis.fetch` with a function that throws `"network disabled in tests"`. Every client receives `fixtureFetch(dir)` instead. It matches on:
- the method;
- the URL path;
- the **sorted** query;
- for JSON-RPC, the `method` and `params`.

An unmatched request throws, naming the missing fixture.

**Fixture format.** `{recordedAt, request: {method, url, body?}, response: {status, headers: {x-ratelimit-*}, body}}`. Keys and the RPC URL are replaced by placeholders. A test scans `tests/fixtures/**` for anything that looks like a key, `api-key=` or `Bearer `.

**Recording.** `pnpm --filter @onepercent/market fixtures:record` (tsx) runs manually, with real env, and never in CI. Record at least:
- **Price v3:** the 5 launch majors + wSOL; one mint with a days-old `blockId`; one omitted mint; 51+ mints, to force 2 calls.
- **Tokens v2:** the majors; PNUT (pump.fun launchpad, older graduation); one recently graduated PumpSwap coin; one live-curve coin; PUMP (Token-2022 with TransferHook); 101+ mints.
- **RPC:** `getSlot`; `getAccountInfo` for curves (live, complete, mayhem, non-SOL quote; lengths 81, 150 and 166) and for one canonical PumpSwap pool, plus its quote vault balance; `jsonParsed` mints (SPL safe, Token-2022 metadata-only, PUMP); largest accounts, owners and supply for the TRENDING sample.
- **Hermes:** latest SOL/USD and each major feed; 8 daily historical points for one major; a 401 without a key.
- **Swap:** `/order` sells (a small WIF sell, the 150 SOL probe for one major, a curve coin where the cap binds, a hypothetical quote above real reserves, a no-route 400) and one buy; `/build` with `platformFeeBps=0` and `maxAccounts=40`.

**Synthetic fixtures** are allowed only for edge cases: stale or wide Pyth, 429 with reset, 5xx, timeouts, and boundary values. Each one is derived from a real fixture and marked `"synthetic": {"from": "<file>", "edit": "<what changed>"}`.

## 8. Acceptance criteria (the architect will run these)

**Both PRs**
1. `git diff <base> --stat` shows only `app/packages/market/**`, lines between the X2 markers in `app/packages/config/src/index.ts`, and the new importer in `app/pnpm-lock.yaml`.
2. From `app/`: `pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` all pass on a clean checkout. M0 tests are unchanged and green.
3. The network guard is active, and no test reaches the network. Removing a fixture makes its test fail with "missing fixture".
4. **Static tests.**
   - No numeric literal other than `0`, `1`, `2`, `0n`, `1n` or `2n` appears in `src/**`, except in `src/params.ts` and `src/http/status.ts`.
   - Only `src/params.ts` imports `@onepercent/config`.
   - No forbidden word (§9) appears anywhere in `packages/market`.
5. Redaction: keys never appear in errors, logs (captured logger) or fixtures, and the RPC URL is logged by host only.

**X2a**

6. A type test (`expectTypeOf`) proves the exported `PriceSource` equals §5.1 exactly.
7. `getPrices` with 120 unique mints plus duplicates makes **3** Price v3 calls and **1** `getSlot` call. Every requested mint is a key. Omitted mints and those over `maxAgeSlots` are `undefined`, and `ageSlots` is exact. An invalid mint throws `INVALID_INPUT` with zero requests.
8. `getTokenInfo` batches by 100. `logoURI` is set only from `https` icons. `launchpad` is mapped, `ath` is always `undefined`, and unknown mints are `undefined`.
9. `getSolUsd`:
   - fresh Pyth gives the expected value;
   - a 61 s-old reading, or a confidence of 101 bps, falls back to Jupiter wSOL;
   - when both fail, it throws `PRICE_UNAVAILABLE`;
   - the Hermes request carries `Authorization: Bearer`, and the base URL keeps its path.
10. **Retries.**
    - A 429 waits until `x-ratelimit-reset`, capped.
    - A 5xx is retried `maxAttempts` times with the exact jittered delays from an injected `random`.
    - 400 and 401 are not retried.
    - A timeout ends as `PROVIDER_TIMEOUT`.
11. **Limiter and cache.**
    - With a fake clock, the 31st keyless call in 60 s waits.
    - Developer × `shareBps` 5_000 allows 300 calls per minute.
    - A repeat inside the TTL makes zero requests; after expiry it refetches.
    - Concurrent identical calls are coalesced.

**X2b**

12. `/order` URLs contain exactly the allowed parameters, and never `taker` or `referral*`. A no-route 400 gives `NO_ROUTE` with no retry. `/build` always sends `platformFeeBps=0` and never `feeAccount`, and its instructions convert to web3.js. A `minOut` below the slippage floor gives `PROVIDER_SCHEMA`. No code references `/execute`, `/submit` or `sendTransaction`.
13. Exit caps, on recorded accounts:
    - a live SOL curve gives `floor(real × 9_875 / 10_000)`;
    - a completed curve with a canonical pool uses the real vault, so ±virtual reserves change nothing;
    - a non-SOL quote is flagged;
    - WIF gives `none`;
    - all three curve lengths decode;
    - an RPC failure gives `EXIT_CAP_UNAVAILABLE`.
14. `valueNow`:
    - a major is uncapped;
    - a cap-binding curve is `capped: true`;
    - a quote above real reserves gives `QUOTE_EXCEEDS_REAL_RESERVES`;
    - a failed quote is unavailable;
    - wSOL and `0n` make no I/O.

    A static test proves that `src/value/**`, `src/sellback/**` and `src/listing/evaluate.ts` never import `jupiter/price.ts` and never mention `usdPrice`; within those files, `liquidity` appears only in the `liquidity_usd` criterion.
15. **Ladder.**
    - Unit vectors cover rungs, the stop rule, both clamps, floor interpolation, no extrapolation and `capLamportsAtImpact`.
    - fast-check properties: `valueAt` is non-decreasing, and `marginalValue(h, a) ≤ valueAt(a)` on clamped ladders.
16. **Sell back.**
    - A table of ≥ 12 vectors checks `payout = floor(min(Σvalue, quote) × 8_700 / 10_000)`, including rounding edges.
    - Each refusal reason fires exactly at its boundary: equal passes, one lamport over refuses. This covers both branches of `max(5 SOL, 25%)`, the hour rollover and fill-first routing.
    - The TTL is 60 s for MAJOR and 20 s for TRENDING.
    - Nonce outside u32, a duplicate `cardIndex`, mixed mints and Jackpot / The 1% kinds are refused.
    - A batch of n cards makes **one** `/order` call, for Σ amount.
    - JSON serialization round-trips.
17. **Listing.**
    - Every criterion has a passing and a failing fixture case, and missing evidence fails closed.
    - The σ vector is checked by hand.
    - The 150 SOL probe amount `T` matches a hand-computed vector.
    - A snapshot report for the 5 launch majors is generated from fixtures.
    - PUMP fails `mint_is_safe`, because of its TransferHook.

## 9. Do NOT

- Do not touch `programs/**`, `packages/sdk`, services, web, CI workflows, root files, or the M0/M1 config blocks. No on-chain changes of any kind.
- Do not add keeper loops, schedulers, timers, `setInterval`, daemons, queues, Postgres or Redis. X2 provides functions; the services (M3.2) run them.
- Do not sign anything, handle keypairs, encode attestation bytes, send transactions, or call `/execute` or `/submit`.
- Do not value a token as price × amount or with any aggregator "liquidity" figure. Do not derive an ATH. Do not extrapolate a ladder.
- Do not add Jupiter referral or platform fees. Do not add a second web3.js version. Do not add a Jupiter or Pyth SDK, or `@solana/kit`.
- Do not invent economic numbers, or change any value that exists in PARAMS.md.
- Do not let CI touch the network. Do not commit keys, `.env` files or unredacted fixtures.
- Do not use these words in code, strings, fixtures or docs: grave, graveyard, tomb, tombstone, bury, burial, ghost, ghoul, lich, haunt, wake, funeral, mourner, undertaker, soul, cremate.

## 10. Report back (in each PR)

- The commands run and their results, and the base commit.
- **Config.** Every key added to the X2 section (`MARKET`, and `X2_PENDING_M1` if it was needed), and confirmation that each `X2_PENDING_M1` value equals PARAMS.md §22.4.
- **Lines for the integrator:**
  - the 4 env lines for `app/.env.example`;
  - the `app/VERSIONS.md` rows for any devDependency added (fast-check);
  - how `market` resolves `@onepercent/config` before build.
- **Fixtures.** The inventory, with `recordedAt` and the synthetic ones marked. Any provider fact in §3 that changed, with evidence.
- Deviations from this brief and why, and open questions. Expected ones: the Hermes historical route behaviour, mayhem flag offsets on 150/166 B curves, and the Sell back hour-reset semantics vs M3.1.
