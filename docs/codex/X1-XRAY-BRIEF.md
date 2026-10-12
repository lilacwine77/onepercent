# Codex brief — X1: X-ray (wallet scan + shareable card)

Issued 2026-10-08 by the architect. This is a parallel track, independent of M1. X-ray only reads: **no wallet connection, no transaction, no Feed logic.** Base `main` (M0 merged as `123f70d`, PR #1). Work branch `feat/x1-xray`, one PR.

## 0. Context in 6 lines

- **What X-ray does.** It scans any Solana wallet without a connection. It shows which bags are Feedable, which have a bid, and how much rent sits in empty token accounts, then renders a shareable card. It goes live at X-ray Week (T−7) and is the season's entry point.
- **Sources.** `docs/codex/MODEL.md`; `docs/codex/PARAMS.md` (§6 `FEED_RULES`, §14 addresses, §18 `XRAY`, §19); and the engineering spec, cited as SPEC §x (published with M1). This brief restates every SPEC and art-direction (DA §5) rule that X1 needs, and it wins for X1 scope.
- **Parallel tracks.** X2 owns `app/packages/market` (Jupiter clients, value function). X3 (bot and Blinks) consumes `XrayResult` (§6.2) as is. M1 adds `XRAY`, `PROGRAM_IDS`, `PUMP_LAYOUTS` and `WSOL_MINT` to `packages/config`.
- **Who builds what.** The architect owns the experience layer: animation, final card polish, coins. You build the plumbing and a faithful functional layout behind stable interfaces: `XrayView` props and `cards/xray-card.tsx`.
- **Numbers.** Every number is either computed from chain state or labelled "≈". A token's value in SOL is a Price v3 estimate labelled "≈". Firm quotes belong to X2 and the Feed and Sell panels.
- If anything is ambiguous or impossible, **stop and report with options**.

## 1. Rules

1. **Branch.** Work on `feat/x1-xray` from `main`, open a PR, and **never push to `main`**. If M1, X2 or X3 merges first, rebase and regenerate `pnpm-lock.yaml` with `pnpm install`; never hand-merge it. Edit only the files in §2.
2. **Dependencies.** Pin exact versions, each published at least 14 days before you add it (master brief §0.3 C). Record the date and source in `app/VERSIONS.md`. Add nothing heavier than this list:

| Package | Pin | Used in | Why |
|---|---|---|---|
| `@solana/web3.js` | the version `main` pins | eligibility, api | no churn |
| `@solana/spl-token` | 0.4.15 (2026-07-09) | eligibility | `unpackMint`, `unpackAccount`, `getExtensionTypes`, `AccountLayout` |
| `zod` | 4.6.5 | eligibility, web | same as M0 |
| `satori` | 0.33.5 (2026-09-22) | api | 0.34–0.44 are under 14 days old |
| `@resvg/resvg-js` | 2.6.2 | api | prebuilt binaries, musl included |
| `@fontsource/fraunces`, `@fontsource/dm-sans` | 5.3.0 | api | `.woff` files for satori |
| `@bonfida/spl-name-service` | 4.1.0-beta.1 (2026-09-11) | api | approved pre-release (§5.3) |

3. **No network in tests.** Every provider response is a recorded fixture. A test setup makes any unmocked `fetch` throw. CI never reaches mainnet, Helius or Jupiter.
4. **Code.** TypeScript strict, ESM, Node 22. Helius and Jupiter go through zod-typed `fetch`, with no provider SDK. No provider key ever reaches the browser, and no URL containing `api-key` is ever logged.
5. **Numbers.** `packages/config` doesn't export `XRAY`, `PROGRAM_IDS`, `PUMP_LAYOUTS` or `WSOL_MINT` yet, and its export map needs a build before typecheck. Mirror the values verbatim in `packages/eligibility/src/params.ts`, headed `// MIRROR of PARAMS.md — switch to @onepercent/config after M1`, and pin each one in a test. Do not edit `packages/config`. Three operational values are not in PARAMS. Mark each `// PROPOSED (X1), pending PARAMS §18`: `XRAY_PRICE_MAX_AGE_SLOTS = 54_000` (≈ 6 h at 0.4 s per slot), `XRAY_MAX_TOKEN_ACCOUNTS = 2_000`, `XRAY_CACHE_MAX_ENTRIES = 5_000`.
6. **Strings.** User-facing strings live only in `packages/eligibility/src/copy.ts` (API, card, bot) and `apps/web/src/xray/strings.ts` (web chrome). Components contain no raw literals. Any string not quoted from SPEC here is marked `// PROVISIONAL until COPY.md`.

## 2. File ownership

**X1 may edit only:**
- new files under `app/packages/eligibility/**`, `app/services/api/src/{xray,cards}/**` and `app/apps/web/src/xray/**`;
- `app/apps/web/src/main.tsx`: route registration, at most 5 lines;
- `app/services/api/src/app.ts`: one import, `app.route("/", createXrayRouter(deps.xray))`, and an optional `deps` parameter on `createApi` (M0 tests unchanged);
- `app/services/api/src/index.ts`: at most 5 lines that build the deps;
- the `package.json` dependencies of eligibility, api and web; `app/pnpm-lock.yaml`; new rows in `app/VERSIONS.md`;
- new variables in `app/.env.example` and `app/services/api/.env.example`;
- `app/services/api/tsconfig*.json`, for JSX in `cards/` only;
- `app/services/api/Dockerfile`: COPY and build lines for the new package.

**Off limits:** `packages/{config,market,sdk}`, the bot, the worker, the program, CI and the landing.

**Exports.** The `@onepercent/eligibility` export map mirrors `@onepercent/sdk` (src for types and dev, dist at runtime). Subpaths: `"."`, `"./xray-result"`, `"./format"`, `"./copy"`.

## 3. `packages/eligibility` (pure TypeScript, no I/O)

`RawAccount = { address: string; owner: string; lamports: bigint; data: Uint8Array }`.

### 3.1 `origin.ts`: `checkPumpOrigin(mint, curve: RawAccount | null): boolean` (H1, SPEC §3.2)

- **PDA.** `bondingCurvePda(mint)` = `findProgramAddressSync([utf8("bonding-curve"), mint], 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P)`.
- **True iff** the curve exists, its address equals the PDA, its owner is pump.fun, `data.length ≥ 8`, and `data[0..8]` = `17b7f83760d8ac60`.
- **Length-tolerant.** Live sizes include 81, 150, 151 and 166 B (CATCRAFT's curve was 151 B on 2026-10-08). Read nothing else, and never trust the `pump` suffix.

### 3.2 `mint-safety.ts`: `mintIsSafe(mint)` (H2, SPEC §3.1)

Returns `{ ok: true, program: "spl"|"token2022", decimals, extensions }` or `{ ok: false, code }`. Checks run in order, and the first failure wins:
1. The owner is SPL `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` or Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`; otherwise `unknown_program`.
2. `unpackMint(address, info, owner)` succeeds; otherwise `mint_unparseable`. Always pass the account's owner, so a Token-2022 mint is never read with the 82-byte SPL layout.
3. `decimals ≤ 9`; otherwise `decimals`.
4. `mintAuthority` is null; otherwise `mint_authority`. Then `freezeAuthority` is null; otherwise `freeze_authority`.
5. Token-2022 only: take `getExtensionTypes(tlvData)` and drop `Uninitialized` (0) zero-padding entries. Every remaining type must be in {MetadataPointer 18, TokenMetadata 19}. Any other number, including numbers newer than spl-token's enum, gives `token_extensions`. A TLV read error gives `mint_unparseable`.

### 3.3 `snapshot.ts`: `evaluateSnapshot(slotS, e?: { balanceAtS: bigint | null; mintFirstSeenSlot?: number })` (S1)

The first matching rule wins:

| Condition | Result |
|---|---|
| no `slotS` | `unchecked` |
| `mintFirstSeenSlot > slotS` | `not_held` |
| `balanceAtS` null or missing | `unknown` |
| `balanceAtS > 0` | `held` |
| `balanceAtS = 0` | `not_held` |

S2 (bought, not airdropped), S3 (one hop) and S4–S5 belong to the intake signer. X-ray never claims them.

### 3.4 `value.ts`, `curve-cap.ts`: display value only

`estimateValueLamports({ amountRaw, decimals, usdPrice?, ageSlots?, solUsd, curveCapLamports?, skip })`:
- **Returns `undefined`** when there is no price, when `ageSlots > XRAY_PRICE_MAX_AGE_SLOTS` (Price v3 returns prices up to 14 days stale), when `solUsd ≤ 0`, or when `skip` is set.
- **`skip`** covers three cases: a frozen account; a mint with `ScaledUiAmountConfig` (25) or `InterestBearingConfig` (10); an incomplete curve whose quote is not SOL or can't be decoded.
- **Otherwise** it returns `floor(amountRaw / 10^decimals × usdPrice / solUsd × 10^9)`, capped by `curveCapLamports` when present. Floats are fine: the result is labelled "≈".

`curveCapLamports(curve)`:
- For an **incomplete** SOL-quoted curve it returns `real_quote_reserves` (u64 LE at offset 32); otherwise `null`.
- Decode the `complete` and `quote_mint` offsets from the official IDL (`pump-fun/pump-public-docs` `idl/pump.json`) and assert them on fixtures. A missing `quote_mint` on a short layout means SOL.
- It reads past H1 on purpose and serves display only, so keep it out of `checkPumpOrigin`. The cap is an upper bound; the fee haircut is X2's value function.

### 3.5 `classify.ts`: `classifyWallet(input)`

- **Input.** `{ owner, tokenAccounts, mints, curves, prices, solUsd, slotS, snapshot, excludedMints }`. `mints`, `curves` and `snapshot` are maps keyed by mint. `excludedMints` defaults to {`WSOL_MINT`}; $1PCT is added once config has it (H3).
- **Output.** `{ bags, empties: { address, mint, rentLamports: bigint }[] }`, where `Bucket = "feedable" | "not_feedable_season" | "sell" | "close" | "not_in_set"`.
1. **Parse.** Run `unpackAccount(address, info, owner)` on each token account. Skip unparseable ones and count them in the logs.
2. **Close.** An account with `amount = 0` is `close` unless it is frozen, its `closeAuthority` belongs to someone other than the owner, or it is Token-2022 with a withheld `TransferFeeAmount`. `rentLamports` is the account's **actual lamports**. Never compute rent; SIMD-0437 changes it. Empty wSOL accounts count.
3. **Aggregate.** Ignore non-empty wSOL, which is SOL. Sum the other non-empty accounts per mint.
4. **Hard checks.** Per mint, `hard = !excluded && H1 && H2`. **Fail:** `["not_in_set"]`. The reason is the first failure among `excluded`, `mint_missing`, `not_pump_fun`, then the mint code. **Pass:** the snapshot result decides. `held` → `["feedable"]`. `not_held` → `["not_feedable_season"]` with reason `snapshot_not_held`. `unknown` or `unchecked` → `["feedable"]` with reason `snapshot_at_feed`. **Sell:** add `"sell"` to any non-frozen bag, in the set or not, whose estimate is ≥ `XRAY.sellMinLamports` (2,000,000). A bag can be both Feedable and Sell.
5. **Order.** Bags: feedable, then not_feedable_season, then not_in_set. Within each group, by value descending, then mint. Empties: by rent descending, then address.

### 3.6 `copy.ts`, `format.ts`

| Reason code | Text |
|---|---|
| `not_pump_fun` | "Not from pump.fun" (SPEC) |
| `token_extensions` | "Not supported (token extensions)" (SPEC) |
| other mint codes, `mint_missing`, `excluded` | "Not supported" (PROVISIONAL) |
| `snapshot_not_held` | "Not feedable this season (bought after {S date})" (SPEC). The date is `getBlockTime(S)` in UTC, as "Oct 22" |
| `snapshot_at_feed` | "Final check when you Feed" |

- **Feedable label.** "Feedable ✳ 0.002–0.02 SOL each time it's pulled". Compute it from the mirrored edition prices × `royaltyPerDustCard` bps ÷ 10,000 (PARAMS §19); never type the numbers.
- **`xrayLine(result)`** (bot and `og:description`). "X-ray: 7xKp…d2Qa ✳ 37 bags ✳ 16 feedable ✳ 12 have a bid ≈0.79 SOL ✳ 104 empty accounts ≈0.21 SOL rent back" (SPEC §2.4). Omit segments that are zero, and use the singular for n = 1.
- **`format.ts`** (shared with web):

| Function | Behavior |
|---|---|
| `lamportsToSol` | exact, ≤ 9 decimals, trailing zeros trimmed |
| `amountToUi` | exact |
| `shortAddress` | 4+4 with U+2026 ("7xKp…d2Qa") |
| `cardTicker` | uppercase `[A-Z0-9]`, ≤ 10 characters (PARAMS `UI.tickerMaxChars`); if empty, the mint's first 4 characters |
| `cleanText(s, max)` | strips C0/C1, bidi U+202A–202E and U+2066–2069, and zero-width U+200B–200F and U+FEFF; trims. Symbol max 16, name max 32 |
| `formatSolDisplay` | always floor. ≥ 1 SOL: ≤ 2 decimals ("412.6"). 0.01–1: 2 decimals ("0.84"). Below 0.01: 2 significant digits ("0.0061") |
| `formatPct` | 1 decimal with U+2212 ("−99.6%"); multipliers use "×" |

## 4. Fixtures

**4.1 Mainnet accounts.** One file per case: `fixtures/mainnet/<case>.json` = `{ address, owner, lamports: string, dataBase64, slot, recordedAt, source: "mainnet", note }`.
- Record with `scripts/record-fixtures.ts`. It is manual, needs an RPC URL and never runs in CI.
- Verify each account on-chain when you record it. The candidates below were checked at slot 454,608,043 on 2026-10-08.

| Case | Candidate |
|---|---|
| Legacy SPL pump coin + curve | Fartcoin `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump` (SPL, 82 B); curve `TBHe5tJnuT4CQbHorJ1uVdfUoaYGPKgfCpiv2jgesVN` (150 B, complete) |
| Token-2022 `create_v2` coin + curve | CATCRAFT `ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump` (414 B, extensions 18 + 19, null authorities); curve `8M4JEgo2UdMQYLJdmwsTn4cUjsGxuj7CKXvA6898wc36` (151 B) |
| Pump coin **without** the `pump` suffix | pick one from Jupiter `/tokens/v2/recent`, then verify its PDA, owner and discriminator |
| Incomplete curve, SOL quote | any live pre-graduation coin (cap test) |
| Non-pump tokens | BONK `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` (SPL, null authorities, no curve); USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mint and freeze authority) |
| TransferHook | PUMP `pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn` (T22, extensions 14 + 18 + 19, null authorities) |
| PermanentDelegate | any mainnet T22 mint that carries it; verify it, and list its extensions in `note` |
| Token accounts | empty SPL (165 B); T22 with ImmutableOwner (170 B); T22 with TransferFeeAmount |

**4.2 Synthetic variants** (`fixtures/synthetic/`). Derive each from recorded bytes, with `source: "synthetic"`, `derivedFrom` and `change`. Required:
- mint authority set; freeze authority set; decimals 10;
- wrong curve owner; wrong discriminator; a curve placed under another mint's PDA;
- curve lengths 8, 81, 166 and 300; an odd TLV tail;
- a frozen account; `closeAuthority` ≠ owner.

**4.3 Wallets** (`fixtures/wallets/`). Owners are synthetic pubkeys, documented in each file; token accounts are encoded with `AccountLayout` over the recorded mints. **Never commit a scan of a real person's wallet.**
- `trencher`: ≥ 12 bags covering every bucket, plus ≥ 5 empty accounts with real lamports (2,039,280 legacy; 1,488,440 and 1,513,840 post-September 2026).
- `clean`: no token accounts.
- `mixed`: only `not_in_set` bags, some of them `sell`.
- Each wallet file holds a price map and an `expected` block with counts and, per mint, buckets and reason.

**4.4 Provider bodies** (`services/api/src/xray/__fixtures__/`). Record real responses, re-key them to the synthetic wallets and redact the keys:
- Helius: `getTokenAccountsByOwner` (×2), `getMultipleAccounts`, `getAssetsByOwner`, `getTransactionsForAddress`, `getSlot`, `getBlockTime`.
- Jupiter: Price v3, Tokens v2 `search`.
- Golden result: one `XrayResult` for `trencher`, copied to `apps/web/src/xray/__fixtures__/result.json`. A test parses both copies with the schema.

## 5. Providers (`services/api/src/xray`)

### 5.1 `ChainSource`

```ts
interface ChainSource {
  getTokenAccounts(owner: string): Promise<RawAccount[]>;
  getAccounts(addresses: string[]): Promise<Map<string, RawAccount | null>>;
  getMetadata(owner: string): Promise<Map<string, { symbol?: string; name?: string; image?: string }>>;
  getSlot(): Promise<number>;
  getBlockTime(slot: number): Promise<number | null>;
  getSnapshotEvidence(owner: string, mints: string[], slotS: number): Promise<Map<string, SnapshotEvidence>>;
}
```

`helius.ts` speaks JSON-RPC to `HELIUS_RPC_URL`, or to `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`.
- **Token accounts.** `getTokenAccountsByOwner(owner, { programId }, { encoding: "base64", commitment: "confirmed" })`, once per token program.
- **Accounts.** `getMultipleAccounts` in batches of `XRAY.accountsPerBatch` (100), base64: the mints first, then the curve PDAs.
- **Metadata.** `getAssetsByOwner { ownerAddress, page, limit: 1000, options: { showFungible: true, showZeroBalance: true } }`, paged until a page comes back short. Read only symbol, name and image, through a passthrough zod schema checked on the recorded page.
- **Snapshot evidence.** Only when `FEED_SNAPSHOT_SLOT` is set. For each in-set mint, call `getTransactionsForAddress(owner, { transactionDetails: "full", encoding: "jsonParsed", sortOrder: "desc", limit: 1, maxSupportedTransactionVersion: <highest documented>, filters: { slot: { lte: S }, tokenAccounts: "balanceChanged", tokenTransfer: { mint } } })`. `balanceAtS` = Σ `postTokenBalances` where owner = wallet and mint = mint. It is `0n` when no transaction is ≤ S. Run at most 8 calls at a time, within a 2.5 s total budget. An unfinished call, an error or a plan without the method gives `null`. Evidence never fails a scan.
- **Timeouts.** 5 s per call, with one jittered retry on 429 or 5xx.
- **Fixtures.** `fixture-source.ts` serves the data from §4.3 and §4.4.

### 5.2 `PriceSource` (use this exact interface; X2 delivers the real one in `packages/market`)

```ts
interface PriceSource {
  getPrices(mints: string[]): Promise<Record<string, { usdPrice: number; blockId: number; ageSlots: number } | undefined>>;
  getTokenInfo(mints: string[]): Promise<Record<string, { symbol: string; name: string; logoURI?: string; launchpad?: string; ath?: number } | undefined>>;
  getSolUsd(): Promise<number>;
}
```

`price-source.ts` is a temporary adapter and the **only** file that calls Jupiter.
- **Host and key.** Use `https://api.jup.ag`. Send `x-api-key` only when `JUPITER_API_KEY` is set; keyless works at 0.5 RPS. Never use `lite-api.jup.ag` (deprecated).
- **`getPrices`.** `GET /price/v3?ids=` in chunks of `XRAY.priceIdsPerCall` (50). A missing mint is normal and maps to `undefined`. `ageSlots = chain.getSlot() − blockId`; a null `blockId` maps to `undefined`.
- **`getTokenInfo`.** `GET /tokens/v2/search?query=<≤ 100 comma-separated mints>`, mapped as `id → { symbol, name, logoURI: icon, launchpad }`. Tokens v2 has **no ATH field** (checked 2026-10-08), so `ath` stays `undefined`. Until X2 supplies it, `worst` is `null` and cards show "—".
- **`getSolUsd`.** Price v3 for `WSOL_MINT`; throw if it is missing.
- **Rate.** A serial token bucket at `JUPITER_MAX_RPS` (default 0.5 keyless, 1 with a key). Query only non-empty, non-wSOL mints.
- **Errors.** Any `PriceSource` error fails the scan with 502 `prices_unavailable`, and nothing is cached. Never show "0 have a bid" just because a provider was down.

### 5.3 `names.ts`

- **Interface.** `NameResolver.resolve(name): Promise<string | null>`. Lowercase the input and accept only `^[^\s/]{1,100}\.(sol|sns)$`.
- **Implementation.** `resolve(connection, name)` from `@bonfida/spl-name-service`, with the default `{ allowPda: false }` and a `Connection` on the Helius URL. `DomainDoesNotExist` and `DomainExpired` map to `null`, then 404.
- **Why the beta.** Stable 4.0.1 stops resolving `.sol` after finalized slot 452,825,395 and throws `UnsupportedTldError`. That slot has passed: SNS is moving `.sol` to its SRS registry. 4.1.0-beta.1 resolves `.sol` through SRS. The exception is approved; record it in `VERSIONS.md`.
- **Tests.** Use a fake resolver.

## 6. API

### 6.1 Routes (`router.ts`: `createXrayRouter`)

| Route | Returns |
|---|---|
| `GET /api/xray/:address` | `XrayResult` JSON |
| `GET /api/xray/:address/card.png?format=landscape\|square` | PNG, 1200×630 or 1080×1080 |
| `GET /x/:address` | share page with OG meta (§8.4) |

`service.ts` also exports `xrayService.get(input)` (parse, cache, scan) for in-process callers such as X3's Blinks. It skips the HTTP middleware.

### 6.2 `XrayResult` (`packages/eligibility/src/xray-result.ts`; X3 relies on this exact shape)

```ts
const Sol = z.string().regex(/^\d+(\.\d{1,9})?$/);              // exact decimal SOL
const B58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const N = z.number().int().nonnegative();
export const BucketSchema = z.enum(["feedable", "not_feedable_season", "sell", "close", "not_in_set"]);
export const ConditionSchema = z.enum(["Mint", "Near Mint", "Lightly Played", "Played", "Heavily Played", "Damaged"]);
export const XrayResultSchema = z.object({
  address: B58, chain: z.literal("solana"), scannedAt: z.iso.datetime(), cached: z.boolean(),
  counts: z.object({ bags: N, feedable: N, notFeedable: N, sellable: N, empty: N, notInSet: N }),
  totals: z.object({ sellValueSol: Sol, rentBackSol: Sol }),
  worst: z.object({ symbol: z.string(), mint: B58, drawdownPct: z.number().min(0).max(100) }).nullable(),
  bags: z.array(z.object({
    mint: B58, symbol: z.string().max(16), name: z.string().max(32), logoUrl: z.url().nullable(),
    amountUi: z.string().regex(/^\d+(\.\d+)?$/), decimals: z.number().int().min(0).max(255),
    tokenProgram: z.enum(["spl", "token2022"]), buckets: z.array(BucketSchema).min(1),
    reason: z.string().max(80).optional(), valueSol: Sol.optional(), priceAgeSlots: N.optional(),
  })),
  emptyAccounts: z.array(z.object({ address: B58, mint: B58, rentLamports: N })),
  card: z.object({ title: z.string(), condition: ConditionSchema, oneLiner: z.string() }),
  share: z.object({ landscapeUrl: z.url(), squareUrl: z.url(), xIntentUrl: z.url() }),
});
export type XrayResult = z.infer<typeof XrayResultSchema>;
```

**Field semantics**
- `address` is canonical base58, resolved if the input was a name. `scannedAt` is in UTC.
- `bags` holds every non-empty, non-wSOL mint; its `buckets` never contain `close`.
- `counts.bags` counts only **in-set** bags (feedable or not_feedable_season). That is the number the card shows.
- `reason` is the §3.6 text. It is set on `not_in_set`, on `not_feedable_season`, and on `feedable` with `snapshot_at_feed`.
- `valueSol` is present only when the estimate is defined. `priceAgeSlots` is present whenever a price came back.
- `symbol` and `name` are cleaned. DAS on-chain metadata wins over Jupiter, and the symbol falls back to the mint's first 4 characters.
- `logoUrl` keeps `https:` only, otherwise `null`. Jupiter `icon` wins over the DAS image.
- `worst` is the highest `(1 − usd/ath) × 100` (1 decimal) over in-set bags with `usdPrice` and `ath > usdPrice`. Its `symbol` is the card ticker without `$`.

**Invariants (tested)**
- `bags == feedable + notFeedable`.
- `bags.length == counts.bags + notInSet`.
- `sellable` = the number of bags with `sell`.
- `empty == emptyAccounts.length`.
- `sellValueSol` = Σ `valueSol` over `sell` bags, summed in lamports.
- `rentBackSol` = Σ `rentLamports`.

### 6.3 Pipeline (`scan.ts`)

1. **Parse** the trimmed input. `^0x[0-9a-fA-F]{40}$` → 400 `{ error: "evm_not_supported", message: "Solana wallets only for now." }` (SPEC). A name goes to the resolver; `null` → 404 `name_not_found`. Anything else must decode from base58 to 32 bytes and round-trip; otherwise 400 `invalid_address`. PDAs are allowed.
2. **Cache.** A hit on the canonical address returns `cached: true`. Concurrent scans of one address are single-flight.
3. **Token accounts.** More than `XRAY_MAX_TOKEN_ACCOUNTS` → 422 `wallet_too_large`.
4. **Fetch.** Mints, then curve PDAs; metadata, prices, SOL/USD and token info; if S is set, snapshot evidence and `getBlockTime(S)`.
5. **Build.** `classifyWallet` → counts, totals, `worst`, `cardCopy` (§7) and share links (§8.3).
6. **Store.** Save `ScanRecord { result, coins }` for `XRAY.cacheSeconds` (86,400). `coins`: up to 3 in-set bags with the largest drawdowns, as `{ ticker, drawdownPct | null }`. `cache.ts`: `CacheStore<T> { get(k); set(k, v, ttlS) }`, an in-memory LRU (`Map`, no dependency) capped at `XRAY_CACHE_MAX_ENTRIES`. Postgres or Redis later.

**Failures.** A 10 s deadline gives 504 `scan_timeout`. A Helius failure gives 502 `upstream_failed`. The body is always `{ error, message }`, and a failed scan is never cached.

### 6.4 Abuse controls (`rate-limit.ts`, `turnstile.ts`: HTTP middleware on all 3 routes)

- **Client IP.** If `TRUST_PROXY_HEADER` is set (for example `cf-connecting-ip`), read that header. Otherwise use `getConnInfo` from `@hono/node-server/conninfo`. When no IP resolves, the request goes into one `"unknown"` bucket.
- **Rate limit.** Behind a `RateLimiter` interface: an in-memory sliding 60 s window allowing `XRAY.rateLimitPerMinutePerIp` (60). Above it → 429 `rate_limited` with `Retry-After`.
- **Turnstile.** On `/api/xray/:address` only (crawlers fetching `card.png` or `/x` can't solve it). From the 11th request per IP in the window (`XRAY.turnstileAfterRequests` = 10, PARAMS A5), call `TurnstileVerifier.verify(header "cf-turnstile-response", ip)`. `false` → 403 `turnstile_required`. X1 ships `NoopTurnstileVerifier`: always true, logged at debug.
- **Bot bypass.** X3's bot sends `Authorization: Bearer <BOT_API_SECRET>`. Only when that variable is set, and the token matches in a constant-time compare, the request skips both the limit and Turnstile.

## 7. Card copy (`card-copy.ts`, pure; DA §5.3 adapted to v2)

`cardCopy({ address, bags, dust, empties, worst: { ticker, drawdownPct } | null }) → { title, condition, oneLiner }`. Here `dust` = in-set bags without `sell`, and `empties` = `counts.empty`.

**Condition** (in-set bags):

| Bags | 0 | 1–3 | 4–10 | 11–30 | 31–80 | ≥ 81 |
|---|---|---|---|---|---|---|
| Condition | Mint | Near Mint | Lightly Played | Played | Heavily Played | Damaged |

**Title** (first match wins):

| Rule | Title |
|---|---|
| 0 bags | Suspiciously Clean |
| worst ≥ 99.5 | Held to the Last Decimal |
| bags ≥ 50 | Complete Set Collector |
| `dust × 10 ≥ bags × 7` | Dust Bunny |
| otherwise | Certified Bagholder |

The DA rules on multichain, Bag Weight and median hold are dropped: X-ray has no data for them.

**One-liner.** With 0 bags: "Clean. Suspiciously clean." Otherwise take the eligible lines, in this fixed order:
1. "You didn’t lose money. You collected it."
2. "Down 96%. Still holding. Respect." (only if worst ≥ 96)
3. "Every top, collected."
4. "{n} bags. {d} are dust. {e} accounts are sitting on your rent." (only if n, d and e are each ≥ 2)
5. "Worst bag: ${TICKER}, −{dd}% from ATH. A classic." (only if there is a worst)
6. "The charts went down. The collection went up."
7. "Diamond hands. Mostly by accident."

**Picking a line.** Index = `fnv1a32(utf8(address)) mod eligible.length`, using FNV-1a 32-bit (offset 2166136261, prime 16777619). The same address with the same data always gets the same line.

**Excluded DA lines.** "The machine takes dust. It gives back SOL." reads as a reward promise. "{c} chains. One machine." belongs to the cross-chain track. Every line jokes about the market or about collecting, never about the person.

## 8. Share cards and share page

### 8.1 Rendering (`services/api/src/cards`)

- **Pipeline.** satori renders SVG, then `@resvg/resvg-js` renders PNG (`loadSystemFonts: false`). JSX uses satori's runtime (`"jsx": "react-jsx"`, `"jsxImportSource": "satori/jsx"`, include `src/**/*.tsx`; Vitest must use the same import source), so the API has no React.
- **Modules.** `xray-card.tsx` exports a pure `XrayCard({ model, format })`. `render.ts` loads the fonts once and caches each PNG per (address, format, scannedAt) in the LRU.
- **Fonts.** satori reads woff, not woff2. Resolve these with `createRequire`: `@fontsource/fraunces/files/fraunces-latin-{700-normal,600-normal,600-italic}.woff`; `@fontsource/dm-sans/files/dm-sans-latin-{400,500}-normal.woff`.
- **Glyphs.** These font subsets lack ✳ (U+2733) and ≈ (U+2248). Draw both as inline SVG (`<Sep/>`, `<Approx/>`), and test that no text node contains them.
- **Tokens:**

| Group | Tokens |
|---|---|
| Base | cream #fff1e7, ink #26062e, lilac #d5a2f1, plum #2c1235, mauve #773e83 |
| Paper | paper #fff9ee, paper-edge #f1dfd5 |
| X-ray | deep #120d30, mid #243969, rim #92ebf0, cyan #94f5ed, glint #efffff |
| Gold | gold-hi #f6d272, gold #d9a441 |
| 1% corner | 18 18 48 18 |

- **Color rules.** Gold means money only, and gold text never sits on cream: use a gold chip with ink text instead. X-ray colors never mean money. No red or green: losses are ink, with U+2212.
- **No network while rendering.** Coins show the ticker's first letter.

### 8.2 Layout (DA §5.2 with SPEC §2.1's v2 lines)

**Landscape 1200×630.** Safe area y 15–615. Background: radial paper #fff9ee → #f1dfd5.

| Zone | Content |
|---|---|
| Top band, y 0–104 | Lilac. The lower edge curves (inline SVG path) to y 120 at center. "1%" at x 64, "Onepercent." right-aligned, both Fraunces 700 |
| Left column, x 64–700 | "X-ray ✳ 7xKp…d2Qa" (DM Sans 500, 30) · "{n} bags." (Fraunces 700, 112, −0.04em) · "Worst: $TICKER −99.6% from ATH" or "Worst: —" (Fraunces 600, 44; 36 if > 24 characters) · title in an ink pill (cream DM Sans 500, 30) · "Condition: {c}" (DM Sans 500, 30, ink) · one-liner in curly quotes (Fraunces 600 italic, 34, ≤ 2 lines) |
| X-ray panel, x 740–1136, y 150–500 | 1% corner. Radial #243969 → #120d30. Scanlines `repeating-linear-gradient(0deg, #ffffff14 0 2px, transparent 2px 5px)`. Up to 3 cyan coin medallions (rim gradient rim → mid, glint initial), each with its drawdown below in cream DM Sans 500, 28 ("−99.6%" or "—") |
| Bottom band, y 540–630 | Lilac. "The machine takes your dust ✳ onepercent.fun" (DM Sans 500, 30, ink) |

**Square 1080×1080.**

| Zone | Content |
|---|---|
| Top band, y 0–130 | Same as landscape |
| Headline, y 170–520 | Same elements as the landscape left column |
| Panel, x 72–1008, y 560–900 | Coins, plus the breakdown "16 feedable ✳ 12 have a bid ≈0.79 SOL ✳ 104 empty accounts ≈0.21 SOL rent back". Zero segments omitted. SOL figures in gold-hi, the rest in cream, ≥ 28 px |
| Bottom band, y 950–1080 | Same line as landscape |

**Never on a card:** Bag Weight, an "≈X SOL" offer for the wallet, personal names or @handles.

### 8.3 Share links (`share.ts`, built at scan time)

- **Page.** `${PUBLIC_WEB_URL}/x/${address}`.
- **Images.** `landscapeUrl` and `squareUrl` = `${PUBLIC_API_URL}/api/xray/${address}/card.png?format=…&v=${unixSeconds(scannedAt)}`. `v` busts unfurl caches; the route ignores it.
- **`xIntentUrl`.** `https://x.com/intent/post?text=…&url=<page>`, with text "X-ray ✳ {n} bags ✳ {title}" (PROVISIONAL). The image unfurls from the page's `og:image`.
- **Referral codes** (SPEC §6.7) are out of scope. `buildShareLinks(address, { ref? })` accepts an optional base58 `ref` and does not use it yet.

### 8.4 `GET /x/:address`

- **Shell.** Take `WEB_SHELL_URL` (the built `index.html`, cached 10 min) and inject tags before `</head>`. Without it, serve a minimal document with the tags and a link to the page.
- **Tags.** `og:title`: "X-ray ✳ 7xKp…d2Qa". `og:description`: `xrayLine` without its prefix. `og:image`: `landscapeUrl`, plus `og:image:width` and `og:image:height`. `og:url`. `twitter:card` = `summary_large_image`, plus `twitter:image`.
- **Escaping.** HTML-escape every interpolated value: token symbols are attacker-controlled. Test with symbols containing `<script>` and `"`.
- **Errors.** An invalid address gets a 404 without a scan.
- **Proxying.** In production, Caddy proxies `/x/*` to the API (master brief §3.2). That wiring is not part of X1.

## 9. `apps/web` (`src/xray/`)

- **Routing.** No router library. `route.ts` exports `matchXrayPath(pathname)` for `/x` and `/x/:address`. `main.tsx` renders `<XrayPage/>` on a match, otherwise `<App/>`, and listens to `popstate`.
- **`XrayField`** (DA §4.4, AGENTS.md). One pill control: cream fill, 1.5 px ink border, an ink "X-ray it" button, a mauve placeholder. Focus: a 2 px ink border and paper fill. **No outer ring and no separate focus box.** Submit: `pushState("/x/" + encodeURIComponent(v.trim()))`.
- **`useXray(input)`.** Fetches `${VITE_API_URL}/api/xray/${enc}`, validates with `XrayResultSchema.safeParse` (an invalid body is an error), and aborts when the input changes. States: `idle`, `loading` ("X-raying…", `role="status"`), `error` (the API's `message`, `role="alert"`) and `done`.
- **`XrayView({ result, onShareX, onCopyLink })`.** Presentational only: no fetch, no logic. Keep the props stable for the architect's layer. **Header:** the short address, counts line, title pill, condition and one-liner, then the landscape card `<img>` (alt = the `og:description`). **Sections:** Feedable: label and reason. Not feedable this season. Has a bid: "≈{x} SOL if sold now" in a gold chip. Not in the set: with the reason. Empty accounts: count and "rent back ≈{x} SOL". **Style:** tokens from `styles.css`, plus the DA tokens in `xray.css` scoped under `.xray`. Tabular numerals. Text ≥ 15 px on desktop and ≥ 14 px on mobile. No monospace.
- **Share.** "Share on X" calls `window.open(xIntentUrl, "_blank", "noopener")`. "Copy link" copies `location.origin + "/x/" + address` and announces "Copied".

## 10. Environment, keys, running without them

Add the new variables to both `.env.example` files, with comments and no values. `xray/env.ts` parses them with zod and fails fast.

| Variable | Meaning |
|---|---|
| `HELIUS_API_KEY` / `HELIUS_RPC_URL` | Either one; the URL wins |
| `JUPITER_API_KEY` | Optional; keyless runs at 0.5 RPS |
| `JUPITER_MAX_RPS` | Optional |
| `XRAY_SOURCE` | `live` or `fixtures`. Defaults to `live` when a Helius variable is set, else `fixtures` (logs "X-ray: fixtures mode") |
| `FEED_SNAPSHOT_SLOT` | Optional; enables §3.3 |
| `PUBLIC_WEB_URL`, `PUBLIC_API_URL` | Default `http://localhost:5173` and `http://localhost:3000` |
| `WEB_SHELL_URL`, `TRUST_PROXY_HEADER`, `TURNSTILE_SECRET` (D13) (the noop verifier ignores it), `BOT_API_SECRET` | Optional |

- **Fixtures mode.** Only the fixture wallets and a fixture name map resolve. Everything else → 404 `not_in_fixtures`.
- **Live smoke.** `pnpm --filter api xray:smoke <address|name>` (`smoke.ts`) prints counts, buckets and timings. It never runs in CI.
- **The founder provides two keys.** **Helius**, on a plan with DAS and `getTransactionsForAddress`. Without the latter, every snapshot status reads "Final check when you Feed". **Jupiter**, from developers.jup.ag. The free tier (1 RPS) covers development; X-ray Week needs a paid plan. Neither key is needed to build, test or demo.

## 11. Tests (Vitest, no network)

- **Eligibility.** Origin: Fartcoin, CATCRAFT and the no-suffix coin pass. BONK, a wrong owner, a wrong discriminator and another mint's PDA fail. Lengths 8, 81, 150, 151, 166 and 300 all pass. `mintIsSafe` covers every code: the SPL and T22 pump mints pass; PUMP and the PermanentDelegate mint → `token_extensions`; USDC → `mint_authority`; synthetic freeze → `freeze_authority`; decimals 10 → `decimals`; a T22 mint with an SPL owner and an odd TLV tail → `mint_unparseable`. Snapshot: every branch. Value: the 1,999,999 / 2,000,000 sell boundary, stale prices, the curve cap, and the non-SOL-quote and ScaledUiAmount skips. Classify: the three wallets match `expected`; account sizes 165, 170 and with TransferFeeAmount; frozen and close-authority cases; empty wSOL → `close`. `cardCopy`: condition boundaries 0/1/3/4/10/11/30/31/80/81; title precedence; the 70% dust boundary; determinism, with one known FNV vector; template eligibility. `format`: exactness, U+2212, and `cleanText` on bidi and zero-width input. `params.ts` stays pinned to PARAMS.
- **API.** Scan: `trencher` equals the golden result (ignoring `scannedAt`) and holds every §6.2 invariant. A repeat returns `cached: true` with the same `scannedAt`. Concurrent requests run one scan. Errors: 400 EVM (exact message) and 400 invalid; 404 name; 422; 429 with `Retry-After`; 403 on the 11th request with a failing fake verifier; 502 on price failure (nothing cached); 504; the bearer bypass. Providers: Helius request bodies; Jupiter chunking at 50 and 100; `x-api-key` sent if and only if a key is set; the keyless limiter (fake timers); omitted mints; `ageSlots`. Share page: `/x` meta and escaping.
- **Cards.** SVG snapshots for `trencher` and `clean`, in both formats. The PNG IHDR reads 1200×630 and 1080×1080. No ✳ or ≈ in any text node. Fonts load from the `.woff` paths.
- **Web.** `matchXrayPath`. `XrayView` on the golden result: counts, reasons, gold chip. `XrayPage` on success, on the EVM message, and on a schema-invalid body (shown as an error). Share actions, with `window.open` and the clipboard stubbed. The field shows no outline or ring on focus (checked on computed style).

## 12. Acceptance criteria (the architect will run these)

1. `git diff main --stat` touches only §2 paths. The landing is byte-identical.
2. From `app/`, on a **clean checkout with nothing built**: `pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` all pass. `pnpm lint:words` passes as well, once M1 adds it.
3. Tests pass with the fetch guard on and no provider variable set.
4. With `XRAY_SOURCE=fixtures pnpm --filter api dev`: `curl /api/xray/<trencher>` parses with `XrayResultSchema`, and a repeat returns `cached: true`; `curl /api/xray/0x52908400098527886E0F7030069857D2E4169EE7` → 400 "Solana wallets only for now."; `card.png` is a valid 1200×630 PNG, and `?format=square` returns 1080×1080; `/x/<trencher>` carries `og:image` and `twitter:card`.
5. `pnpm --filter web dev`, against that API, renders `/x/<trencher>`. Share and Copy work.
6. `XrayResultSchema` and its type import from `@onepercent/eligibility/xray-result`. The web bundle contains neither `@solana/web3.js` nor `spl-token`.
7. Every mainnet fixture has `slot`, `recordedAt` and `source`. Every synthetic one has `derivedFrom` and `change`. No fixture is a real person's wallet.
8. `grep -rniE 'api-key|helius|jupiter_api' apps/web/dist` finds nothing.
9. A whole-word, case-insensitive grep of the diff finds none of the §13 words and no "ZK". User-facing strings (`copy.ts`, `strings.ts`, card text) contain none of "earn", "yield", "guaranteed", "Bag Weight".
10. Optional, with the founder's keys: `xray:smoke` on two real wallets takes ≤ 4 s cold and ≤ 300 ms cached (M4.1 targets), and a `.sol` name resolves.

## 13. Do NOT

- Connect a wallet, build or sign any transaction, or call any Feed, Sell, Close or attestation flow.
- Create `packages/market`, a value function or firm quotes, or call Jupiter outside `price-source.ts`.
- Edit `packages/config`, the program, the SDK, the bot, the worker, CI or the landing.
- Invent economic numbers. The PROPOSED values in §1.5 are the only new ones.
- Show a value without "≈", or use Jupiter's `liquidity` field.
- Trust the `pump` suffix, read a Token-2022 mint with the SPL layout, or hard-code rent.
- Put a provider key in the web bundle or in logs.
- Fetch remote images during card rendering.
- Commit a real person's wallet scan, a `.env` file or a key.
- Add any EVM or multichain logic: `0x…` only gets the 400 message.
- Use these words in code, strings, fixtures or docs: grave, graveyard, tomb, tombstone, bury, burial, ghost, ghoul, lich, haunt, wake, funeral, mourner, undertaker, soul, cremate. No "ZK" wording anywhere, and never "earn", "yield" or "guaranteed" in user-facing copy.

## 14. Report back

In the PR, post:
- the new `VERSIONS.md` rows;
- the §12 commands with their results;
- the fixture list with slots;
- `xray:smoke` timings, if you had keys;
- whether the SNS beta resolved `.sol` and `.sns` live;
- every deviation from this brief, and why;
- open questions, especially any pump.fun coin extension outside {18, 19} and any Jupiter or Helius field that differs from §5.
