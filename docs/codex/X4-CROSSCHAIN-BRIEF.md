# Codex brief — X4: cross-chain intake via the Relay API (Robinhood Chain + BNB Chain, then Base)

Issued 2026-10-08 by the architect. Parallel track that ships **after launch**, behind a flag that is **off by default**. It implements the core of master brief §11.4 M8a and SPEC §12. Where this brief differs from the master brief, this brief wins for X4; every difference is listed in §13.

## 0. Context in 8 lines

- Many trenchers also hold down-bad bags on Robinhood Chain (4663), BNB Chain / BSC (56) and Base (8453).
- X4 lets them **sell** those bags in their own EVM wallet and receive **native SOL in their own Solana wallet**: one source-chain deposit per bag, after an exact-amount approval the first time. Then they Rip.
- **Foreign bags never become Dust Cards** (SPEC §12, §2.7). X4 touches no program, SDK, Deck or My cards code. Its only link to the machine is a "Rip a pack" link after SOL lands.
- Rail: **Relay** (`api.relay.link`), the only provider verified end to end for arbitrary RH memecoins (Pons V2 curves included) to native SOL. LI.FI, deBridge, Mayan and Across are rejected or deferred (`research/gap-crosschain.md` §3, §7).
- Non-custodial: our servers hold no EVM or Solana key and never sign for a user. Users sign on the source chain, and Relay's solver delivers the SOL.
- We charge an **app fee of 50 bps** through Relay `appFees`. It accrues off-chain in USDC to a team EVM address and is shown on its own fee line.
- Values come from SPEC §12 and PARAMS §20. Facts come from `research/gap-crosschain.md` and `research/gap-evm-launchpads.md`, including their fact-check appendices. If anything is ambiguous or impossible, **stop and report**.
- Visuals: build a functional panel with minimal brand styling. The architect adds the experience layer later, through the props interface of §7.4.

## 1. Rules for this track

1. **Branch.** Create `feat/x4-crosschain` from `origin/feat/m0-scaffold`. The PR base is `feat/m0-scaffold` until PR #1 merges; then rebase on `main` and retarget. Never push to `main`. M-lanes run in parallel, so rebase often.
2. **File ownership.** X4 may create or edit only:
   - `app/packages/crosschain/**` (new package `@onepercent/crosschain`);
   - `app/services/api/src/crosschain/**`. In `app/services/api/src/app.ts`, exactly three changes: one import, one `mountCrosschain(app)` call, and `allowMethods: ["GET", "POST"]` in the existing CORS line;
   - `app/apps/web/src/crosschain/**`, plus one route registration (§7.1);
   - `app/packages/config/src/crosschain.ts` and `tests/crosschain.test.ts` (new), plus one re-export line in `src/index.ts` between `// --- X4 crosschain: begin ---` and `// --- X4 crosschain: end ---`;
   - mechanical lines only: dependency entries in `apps/web/package.json` and `services/api/package.json`; `pnpm-lock.yaml`; X4 rows in `VERSIONS.md`; an X4 block in `app/.env.example` and `services/api/.env.example`; an X4 section in `app/README.md`.

   Anything else: stop and report.
3. **Flag.** `CROSSCHAIN_ENABLED`, a server env variable, default `false`. **Off:** no `/api/crosschain/*` route exists (404), and the web page shows only "Not available yet." **On:** the API refuses to boot unless `RELAY_API_KEY`, `CROSSCHAIN_APP_FEE_RECIPIENT` and an RPC URL for every enabled chain are set.
4. **Pins.** Exact versions, at least 14 days old at pin time (master §0.3 C), recorded in `VERSIONS.md` with publish date and source.
   - One `viem` version across the workspace, ≥ 2.55.0 (the first with the `robinhood` chain). If you pin ≤ 2.56.0, always pass explicit RPC URLs.
   - Do **not** add `@relayprotocol/relay-sdk` or `relay-kit-ui` (§13). Call Relay over REST with zod-typed `fetch`, as we do for Jupiter and Helius (master §4.2).
5. **Code rules.** TypeScript strict, ESM, Node 22, zod on every boundary: env, HTTP in and out, and every Relay, Etherscan and RPC response. Token amounts and wei are `bigint` (decimal strings in JSON). USD is integer cents parsed from Relay's decimal strings; never put money in a JS `Number`. bps are integers.
6. **CI never calls the network.** Every test runs on recorded fixtures (§5.7).
7. **No secrets in git or in the browser bundle.** The Relay key, the Etherscan key and keyed RPC URLs live only in the `api` service env.

## 2. Verified external facts (docs.relay.link re-read 2026-10-08; on-chain facts from the research)

| Item | Value |
|---|---|
| Quote | `POST https://api.relay.link/quote/v2`, header `x-api-key`. The docs say every quote/v2 request requires a key from 2026-10-02. A quote that sets `referrer` without a key → 401 `UNAUTHORIZED_QUOTE` |
| Body we send | `user`, `recipient`, `refundTo`, `originChainId`, `destinationChainId: 792703809`, `originCurrency` (token), `destinationCurrency: "11111111111111111111111111111111"` (native SOL, 9 dp), `amount` (base units, digits), `tradeType: "EXACT_INPUT"`, `slippageTolerance` (bps string), `appFees: [{recipient, fee}]` (fee in bps as a string; the recipient must be EVM), `referrer`. Optional: `usePermit`, and `indicativeQuote` ("an inexecutable quote meant to be used as a preview"). `POST /price` is deprecated |
| Response | `requestId`; `fees.gas` (origin gas); `steps[]`; `details` |
| `steps[]` | Each step: `id` (approve, deposit, swap, authorize1…), `kind` (transaction or signature), `requestId`, `items[]` with `status`, `data` and `check`. Execute in array order and skip `status: "complete"` items; an `approve` is always followed by `deposit` or `swap`. A signature item has `data.sign` (`signatureKind` eip191 or eip712, `domain`, `types`, `primaryType`, `value`) and `data.post` (`endpoint`, `method`, `body`); the signature goes in the query string |
| `details` | `currencyIn`, `currencyOut` (`amount`, `amountUsd`, `minimumAmount`), `refundCurrency`, `recipient`, `totalImpact`, `slippageTolerance`, `timeEstimate`, `route`, and `expandedPriceImpact` (`swap`, `execution`, `relay`, `app`, `sponsored`, in USD). The legacy `fees` object "does not reflect the full cost": use `expandedPriceImpact` |
| Approvals | **Standard:** `approve(approvalProxy, exact input amount)`, then a deposit tx. RH approvalProxy `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be`, erc20Router `0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f`, v2 depository `0x4cd00e387622c35bddb9b4c962c136462338bc31`. **`usePermit: true` on a memecoin:** `approve(Permit2, max)`, then `authorize1`, an EIP-712 `PermitBatchWitnessTransferFrom` posted to `/execute/permits`; the solver pays the origin gas |
| Status | `GET /intents/status/v3?requestId=` → `status` (waiting, depositing, pending, submitted, delayed, success, refund, failure), `inTxHashes`, `txHashes`, `failReason`, `updatedAt`. Relay suggests polling once per second. `/requests/v2` is **deprecated**; `/requests/v3` (key required) returns actual fees and app fees |
| Freshness | "Quotes are revalidated when being filled, keep your quotes as fresh as possible." The quote has no validity field, so we enforce our own maximum age (§4) |
| Fees | Execution: $0.02 flat plus destination gas. Platform: 0.15% on minor swaps (0.06% major, 0.01% stablecoin, 0% bridge). Swap cost: DEX or curve fees plus impact. App fees come on top and accrue as off-chain USDC: `GET /app-fees/{addr}/balances`, then `POST /app-fees/{addr}/claim` |
| Limits per key | `/quote` 50/min by default, 10/s elevated on request; `/requests` 100/min; `/requests/v3` 200/min; other endpoints 200/min |
| Refunds | Paid on the origin chain to `refundTo`. After an origin swap, the refund is what the depository received (USDG or ETH on RH, USDC on BSC and Base) minus gas; nothing is sent if it cannot cover the gas. Without `refundTo`, automatic refund is disabled |
| `errorCode` | `NO_SWAP_ROUTES_FOUND`, `NO_INTERNAL_SWAP_ROUTES_FOUND`, `NO_QUOTES`, `INSUFFICIENT_LIQUIDITY`, `SWAP_IMPACT_TOO_HIGH`, `AMOUNT_TOO_LOW`, `AMOUNT_TOO_HIGH`, `INSUFFICIENT_FUNDS`, `INVALID_ADDRESS`, `INVALID_RECIPIENT`, `INVALID_INPUT_CURRENCY`, `UNSUPPORTED_CURRENCY`, `CHAIN_DISABLED`, `UNSUPPORTED_CHAIN`, `ROUTE_TEMPORARILY_RESTRICTED`, `PRICE_FETCH_FAILED`, `REQUEST_TIMED_OUT`, `RPC_HTTP_ERROR`, `SERVICE_UNAVAILABLE`, `SWAP_QUOTE_FAILED`, `SANCTIONED_CURRENCY`, `SANCTIONED_WALLET_ADDRESS`, `UNAUTHORIZED`, `UNAUTHORIZED_QUOTE`, `PERMIT_FAILED`, `UNKNOWN_ERROR`. An HTTP 429 carries no code |
| Coverage | RH, BSC and Base are all `tokenSupport: All`. About 10% of fresh Pons V2 bags have no route at any moment (19 of 21 routable on 2026-10-08), so "no route" is a normal state. A first-time Solana recipient needs at least 0.00065 SOL of output |
| Canonical contracts | Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` and Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` on all three chains. `eth_simulateV1` works on the RH, BSC and Base RPCs |

## 3. Target layout

```
app/packages/crosschain/                  # @onepercent/crosschain. "." = server; "./browser" = browser-safe subset
  src/chains.ts                           # registry (§5.1)
  src/scan/{etherscan,rpcLogs,balances,index}.ts
  src/eligibility/{robinhood,bsc,base,template,stockToken,index}.ts
  src/relay/{schemas,client,steps,permit,fees,status,errors}.ts
  src/{limiter,cache,index,browser}.ts
  fixtures/{relay,rpc,etherscan}/*.json   # recorded, each with meta
  scripts/record-fixtures.ts              # manual and online; never run in CI
  tests/*.test.ts
app/services/api/src/crosschain/{env,mount,routes,rateLimit}.ts  + *.test.ts
app/apps/web/src/crosschain/
  ForeignBagsPage.tsx providers.tsx wagmi.ts solana.tsx api.ts copy.ts flow.ts useForeignFlow.ts signing.ts
  components/{ConnectBar,BagList,BagRow,FeeLines,BagProgress,LandedNotice}.tsx   + *.test.ts(x)
app/packages/config/src/crosschain.ts     + tests/crosschain.test.ts
```

## 4. `packages/config`: X4 section

```ts
// PROVISIONAL — X4, from PARAMS.md §20 and SPEC §12, 2026-10-08
export const CROSSCHAIN = {
  supportedChains: [4663, 56, 8453],
  defaultEnabledChains: [4663, 56],          // Base after its QA (§10); env CROSSCHAIN_CHAINS can narrow or add 8453
  appFeeBps: 50,                             // 0.5%, to the team, on its own fee line
  relayReferrer: "onepercent.fun",
  maxSellTaxBps: 500,                        // creator/sell tax above 5% → excluded
  slippageBps: { pool: 300, curve: 800, max: 1_000 }, // never 3,500
  quoteMaxAgeMs: 30_000,                     // older → re-fetch before any signature
  statusPollMs: 2_000,
  statusTimeoutMs: 600_000,
  defaultSelection: { minNetUsdCents: 300, maxBags: 10 },
  minBag: {                                  // USD cents of SOL out, net of every fee
    4663: { greyOutBelowUsdCents: 100, recommendUsdCents: 300 },
    56:   { greyOutBelowUsdCents: 200, recommendUsdCents: 500 },   // plus tax
    8453: { greyOutBelowUsdCents: 100, recommendUsdCents: 300 },
  },
  scan: { maxTokensPerChain: 200, maxPreviewQuotes: 12, eligibilityCacheMs: 600_000, previewCacheMs: 30_000 },
  relayQuotesPerMinute: 50,                  // ops raise it by env once Relay grants 10/s
} as const;
```

- Add a zod schema and `validateCrosschainParams()`.
- Tests: `appFeeBps === 50`; `maxSellTaxBps === 500`; `pool ≤ curve ≤ max ≤ 1_000`; `greyOut < recommend` on every chain; `defaultEnabledChains ⊆ supportedChains`; `maxBags === 10`.
- `quoteMaxAgeMs` is our own rule; Relay publishes no validity field. The architect mirrors these values into PARAMS §20.

## 5. `packages/crosschain`

- **Injection.** Every client receives its config by injection (URLs, keys, `fetch`, viem transports, clock). Nothing in the package reads `process.env`.
- **`./browser`** exports only types, error codes, `validateSteps`, `validatePermit`, the fee-line helpers and the public fields of the registry. It must not import `node:` built-ins or anything that holds a key; a web test bundles it and asserts this.

### 5.1 Chain registry (`chains.ts`)

- **Per chain:** `id`; `name` ("Robinhood Chain", "BNB Chain", "Base"); the viem chain (`robinhood`, `bsc`, `base`); `nativeSymbol`; `explorerTx` (`https://robin.etherscan.io/tx/`, `https://bscscan.com/tx/`, `https://basescan.org/tx/`); `permit2`; `multicall3`; `relayContracts` (every address a Relay step may call or approve); `canonicalQuoteAssets`; `rpcLookbackBlocks`; the launchpad addresses of §5.3.
- **Solana:** relay chain id `792703809`; `explorerTx` `https://solscan.io/tx/`.
- **`relayContracts`:** the RH set is in §2. For BSC and Base, record `GET /chains` into `fixtures/relay/chains.json` and copy the addresses into the registry. A test asserts that the registry equals the fixture.
- **At runtime**, the API fetches `/chains` hourly and `/chains/health?chainId=` every 60 s. A changed contract set or `healthy: false` makes the chain `paused` (logged at `error`) until a reviewed registry update.

### 5.2 Wallet scan

- **Discovery** (which token contracts the address has ever received):
  - **Primary: Etherscan V2 `tokentx`** (`https://api.etherscan.io/v2/api?chainid=…&module=account&action=tokentx&address=…&sort=desc`). One key covers 4663, 56 and 8453 (SPEC §12 D2). The RH free tier ended 2026-10-15, so this needs the Lite plan or above.
  - The key travels in the query string: build the URL inside the client and never log it.
- **Fallback** (automatic on an error or a 5 s timeout, or with `CROSSCHAIN_SCAN_PROVIDER=rpc`): `eth_getLogs` for ERC-20 `Transfer(*, address)`, topic2 = the padded address, on our managed RPC.
  - Chunk the calls to the provider's caps (RH: ≤ 10M blocks and ≤ 10k logs per call), back to `rpcLookbackBlocks`.
  - BSC public RPCs cap logs at 500 blocks, so the BSC fallback needs a managed RPC.
- **Balances are always read on-chain:** Multicall3 `balanceOf`, `decimals`, `symbol` and `name` (allowFailure) for up to `maxTokensPerChain` contracts, plus the native balance. Drop zero balances.
- **Display.** Strip zero-width and soft-hyphen characters from names and symbols, and always show the short address next to the symbol. Never match a token by its name or symbol.
- X4 sells the **full balance** of each bag; partial sells are out of scope.

### 5.3 Eligibility: origin → template → tax → liquidity → route → simulation

The first failing gate wins and returns a typed reason. Results are cached per `chainId:token` for `eligibilityCacheMs`.

**Origin** comes from registry views only. Never accept a vanity suffix, a clone template or `tx.to` as proof.

| Chain | Launchpad | Proof |
|---|---|---|
| RH | Pons V2 | Factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`, `getLaunchedToken(t)`: require `exists && token == t`. Keep `curve`, `pairToken`, `creatorTaxBps`, `phase` and `deployer` |
| RH | Pons V1 legacy / Pons V1 active / Noxa | `getLaunchedToken(t).exists` on `0x0c37a24F5D23A486FA692d1500881d698B1F77a4` / `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` / `0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB`. Then `ownerOf(positionId)` on the v3 NPM `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` must be the matching locker: `0x31ca5E101941A93A7DD6d0497928700625CF54B5` / `0x736D76699C26D0d966744cAe304C000d471f7F35` / `0x7F03effbd7ceB22A3f80Dd468f67eF27826acD85` |
| RH | Doppler (Long.xyz, Bankr…) | Airlock `0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862`, `getAssetData(t)`. Require `poolInitializer ∈ {0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544, 0x5f9eb5f6726fe88d5e39867967f5b833d2fa3215}`, `governance == timelock == 0x…dEaD`, and migrator `0xba2f330edb16cd8056f5988d8ce19bbc63475a0e` |
| BSC | four.meme (TM V1, TM2) | Helper3 `0xF251F83e40a78868FcfA3FA4599Dad6494E46034`, `getTokenInfo(t).tokenManager ∈ {0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC, 0x5c952063c7fc8610FFDB798152D69F0B9550762b}`. Keep `liquidityAdded` and `quote` |
| BSC | Flap | Portal `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`, `getTokenV8Safe(t)`. It reverts with `0xde6137d1` for unknown tokens. Require `status` 1 (Tradable) or 4 (DEX) |
| Base | Clanker v4 | Factory `0xE85A59c628F7d27878ACeB4bf3b35733630083a9`: `deploymentInfoForToken(t).token == t` |
| Base | Zora v4 | Factory `0x777777751622c0d3258f214F9DF38E35BF45baF3`: `getVersionForDeployedCoin(t) > 0` |
| Base | Doppler (Bankr) | Airlock `0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12`; initializers `0xbdf938149ac6a781f94faa0ed45e6a0e984c6544` or `0x5f9eb5f6726fe88d5e39867967f5b833d2fa3215`; migrator `0x6ddfed58d238ca3195e49d8ac3d4cea6386e5c33`. Same rules as on RH |

**Not in X4** (`LAUNCHPAD_NOT_SUPPORTED`): Pools.trade and Clanker ≤ v3.1 (both need an event index), four.meme OpenFour, Flap VaultPortal, Flap on RH, Bags, LetsCash, o1, Virtuals, Arc. Custom deploys return `ORIGIN_UNKNOWN`.

**Template.**
- **Resolve first.** Follow EIP-1167 clones, Solady clones and EIP-1967 proxies to the implementation, then scan its runtime for PUSH4 selectors.
- **Deny list** (a hit → `TEMPLATE_UNSAFE`; the list lives in `template.ts`, with one test per entry):
  - `mint(address,uint256)` and `mint(uint256)`;
  - `blacklist(address)`, `setBlacklist(address,bool)`, `addBlacklistAddress(address)` and `addToBlacklist(address)`;
  - `setTaxRate(uint256)`, `setSellTax(uint256)`, `setFees(uint256,uint256)` and `setProjectTaxRates(uint16,uint16)`;
  - `setTradingEnabled(bool)` and `setMaxTxAmount(uint256)`.

  A hit is tolerated only when the launchpad rule proves the gating role is renounced (`owner()` is `0x0` or `0x…dEaD`). Name the fixture that needed the exception.
- **Per launchpad:**
  - Pons V2, Pons V1, Noxa and Clanker v4: `owner()` reverts or is `0x0`.
  - Doppler: `owner() ∈ {Airlock, 0x…dEaD, 0x0}` and `vestedTotalAmount() == 0`.
  - four.meme: graduated → `owner() == 0x0 && _mode() == 0`; on the curve, `owner() == TM2` is allowed, with `_mode() == 0`.
  - Zora: owners can rename the coin, so set `renamable: true`.

**Tax.** `sellTaxBps` is read per launchpad: Pons `creatorTaxBps`; Flap `sellTaxRate()` on tax tokens and 0 on standard tokens (decided by the V8 struct's token version, never by the suffix); four.meme `feeRateSell()` if the template has it, else 0; Doppler, Clanker and Zora 0, because their dynamic hook fees appear in the quote.
- Above `maxSellTaxBps` → `TAX_TOO_HIGH`. Always return `sellTaxBps` for disclosure.
- The 1% Pons curve or hook fee is a DEX/curve cost, not a tax.

**Liquidity.**
- **Pons V2 phase.** It passes when `phase == 2` (pool), or when it is on its curve and `!readyToGraduate()`. Read that on the record's `curve`, and confirm the location on the fixture. Otherwise → `GRADUATING`.
- **Canonical quote assets** (anything else → `QUOTE_ASSET_NOT_CANONICAL`):
  - RH: native ETH, WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, or a Robinhood Stock Token, identified on-chain by `ACCESS_CONTROLLED_REGISTRY() == 0xe10b6f6b275de231345c20d14ab812db62151b00`;
  - BSC: WBNB `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`, USDT `0x55d398326f99059fF775485246999027B3197955`, USDC and USD1 (take these two addresses from BscScan's verified token pages and cite the source);
  - Base: ETH, WETH, USDC, ZORA.
- **Stock-token pairs.** Require `!tokenPaused()` on the stock token, and `isBlocked(user) == false` called **on the registry**, never on the token. Set `stockPair: true`.

**Route.** The preview quote (§5.4) must succeed. `NO_SWAP_ROUTES_FOUND` and its kin → `NO_ROUTE`; `SWAP_IMPACT_TOO_HIGH` → `TOO_THIN`; net SOL out below the chain's `greyOutBelowUsdCents` → `TOO_SMALL`.

**Simulation** (the honeypot gate, at quote time). `eth_simulateV1` (viem `simulateCalls`) of the exact approve and deposit, from the user's address, must succeed; otherwise `CANNOT_SELL_NOW`. It is skipped for Permit2 quotes, because the solver submits those.

### 5.4 Relay client (`relay/*`)

- **`quote(params, { preview })`** builds the §2 body:
  - `recipient = solAddress`, and `refundTo = evmAddress` **always**;
  - `slippageTolerance`: `curve` for curve-phase tokens (Pons V2 phase 0, four.meme `!liquidityAdded`, Flap status 1), else `pool`;
  - `appFees = [{ recipient: appFeeRecipient, fee: String(appFeeBps) }]` and `referrer = relayReferrer`;
  - `usePermit` only as §5.5 allows.
- **Previews** set `indicativeQuote: true`. Before the Solana wallet is connected, they may use the package constant `PREVIEW_RECIPIENT`, a fixed valid pubkey. An executable quote with `PREVIEW_RECIPIENT` throws (test).
- **Schemas.** zod covers quote, error, status, chains, health and requests/v3: strict on the fields we use, passthrough for the rest.
- **Limiter and timeouts.** One shared token bucket for `/quote` at `relayQuotesPerMinute` (env override). A call waits at most 2 s for a token, then returns `RATE_LIMITED`. Calls time out after 10 s. A per-endpoint circuit breaker opens for 30 s after 5 consecutive failures, and the scan then reports that chain as `paused`.
- **`status(requestId)`** calls `/intents/status/v3`. On `success`, make one `/requests/v3?id=` call to read the actual SOL out (field names from the fixture). If it is missing, show the quoted amount with "≈".
- **`parseFeeLines(quote, sellTaxBps)`** returns `relayFeeUsdCents` (relay + execution), `dexCurveUsdCents` (swap), `appFeeUsdCents` (app), `creatorTaxBps`, `originGasWei`, `originGasUsdCents`, `outLamports`, `minOutLamports` and `netUsdCents`. Show SOL amounts, never Relay's impact percent: it is wrong for tax tokens.

### 5.5 Signing modes, Permit2 and validation

- **Modes.** The web chooses `batch` (EIP-5792), `permit2` or `sequential` (§7.3).
  - `permit2` is used **only** when `allowance(owner, Permit2) ≥ amount` already holds. We never ask for a Permit2 approval.
  - If a `usePermit` quote still contains an `approve` step, discard it and re-quote without `usePermit`.
- **`validateSteps(quote, expected)`** runs on the server, and again in the browser before every prompt. Each check rejects with its own code:
  - `details.recipient ≠ solAddress` → `RECIPIENT_MISMATCH`;
  - `currencyIn` token or amount ≠ the request → `INPUT_MISMATCH`;
  - a wrong `chainId`, `from ≠ evmAddress`, or `value ≠ 0` → `STEP_FIELD_MISMATCH`;
  - a `to` outside `{token (approve only)} ∪ relayContracts` → `STEP_TARGET_UNKNOWN`;
  - an approve that does not decode to `approve(spender ∈ relayContracts, amount == input amount)`, `maxUint256` included → `APPROVAL_NOT_EXACT`;
  - a step id outside {approve, deposit, swap, authorize1}, or more than one approve or deposit per bag → `STEP_UNEXPECTED`.
- **`validatePermit(sign, post, expected)`** requires: `signatureKind == "eip712"`; `domain.verifyingContract == Permit2` and `domain.chainId` == the bag's chain; permitted token == the token, amount == the input amount; spender ∈ `relayContracts`; deadline ≤ now + 10 min; `post.method == "POST"` with the `post.endpoint` path exactly `/execute/permits`.

### 5.6 Typed errors (`errors.ts`)

| Our code | From | Copy (in `copy.ts`) |
|---|---|---|
| `NO_ROUTE` | NO_SWAP_ROUTES_FOUND, NO_INTERNAL_SWAP_ROUTES_FOUND, NO_QUOTES, INSUFFICIENT_LIQUIDITY, UNSUPPORTED_CURRENCY | "No route yet for this coin" |
| `TOO_THIN` | SWAP_IMPACT_TOO_HIGH (never overridden) | "Too thin to sell right now" |
| `TOO_SMALL` | AMOUNT_TOO_LOW, or below the grey-out | "Too small to sell after fees" |
| `RETRY_LATER` | ROUTE_TEMPORARILY_RESTRICTED, PRICE_FETCH_FAILED, REQUEST_TIMED_OUT, RPC_HTTP_ERROR, SERVICE_UNAVAILABLE, SWAP_QUOTE_FAILED, 5xx | "Route busy. Try again in a minute" |
| `RATE_LIMITED` | 429, or our limiter | "Busy. Try again in a few seconds" |
| `BLOCKED` | SANCTIONED_CURRENCY, SANCTIONED_WALLET_ADDRESS | "This coin or wallet can't be used here" |
| `CHAIN_PAUSED` | CHAIN_DISABLED, UNSUPPORTED_CHAIN, health check | "{chain} is paused for now" |
| `CONFIG` | UNAUTHORIZED, UNAUTHORIZED_QUOTE, INVALID_* caused by our own inputs (logged at `error`) | "Something's off on our side. Nothing was sent" |
| `PERMIT_FAILED` | PERMIT_FAILED | "Signature not accepted. Tap to try again" |
| `UNKNOWN` | anything else | "Something went wrong. Nothing was sent" |

**Eligibility reasons and their copy:**
- `ORIGIN_UNKNOWN` and `LAUNCHPAD_NOT_SUPPORTED`: "Not from a supported launchpad".
- `TEMPLATE_UNSAFE`: "Token contract can block or mint: skipped".
- `TAX_TOO_HIGH`: "Sell tax {x}% is above 5%".
- `GRADUATING` and `CANNOT_SELL_NOW`: "Can't be sold right now".
- `QUOTE_ASSET_NOT_CANONICAL`: "Paired with an unknown asset".
- Every validation code of §5.5: "Quote check failed. Nothing was sent".

### 5.7 Fixtures and recording

- **Recording.** Run `pnpm --filter @onepercent/crosschain fixtures:record` manually; it reads a gitignored `.env.local` and never runs in CI.
  - It calls Relay, Etherscan and the RPCs read-only, as a throwaway EVM address with a throwaway Solana pubkey.
  - It writes `meta: { recordedAt, chainId, blockNumber, source }` into each file and strips headers and keys. A test greps `fixtures/` for `apikey=`, `x-api-key` and the key values.
- **Simulation.** `eth_simulateV1` uses a state override that credits the throwaway address with the token. It is read-only: nothing is signed or broadcast.
- **Synthetic fixtures.** A response that cannot be recorded, such as a 429, may be hand-written with `meta.source: "synthetic"`.
- **Replay.** Tests replay through an injected `fetch` and a viem `custom` transport keyed by (method, params); an unrecorded request throws `UnrecordedRequestError`. A Vitest setup file replaces `globalThis.fetch` with a thrower, so a missing injection fails loudly.
- **Required fixtures.** If a listed token has died, pick a live substitute that plays the same role.
  1. **RH Pons V2 → SOL.** A curve-phase token (e.g. QUEEN `0xe0a2dea2d841f3cbc796024e39dead1d5a160618`) and a graduated one (UBIK `0x812486EAea648819853F8E372dc9f1516C7868Bd`, creator tax 100 bps). Record registry reads, template code, both quote kinds (standard and `usePermit`), the simulation, status `pending` then `success`, and requests/v3.
  2. **BSC four.meme → SOL.** Curve token `0xe3db791c5d25f9d13e8bb4befac8f6ad77c14444` and graduated `0x924fa68a0FC644485b8df8AbfA0A41C2e7744444`: the Helper3 reads, quote and simulation.
  3. **Flap BSC.** One standard (`…8888`) and one tax (`…7777`) token, with V8 struct and tax reads.
  4. **Rejections.** Pons V2 `0x6fb318cbcd9872c33606b3abcdd23b1216f8a5d8` (1,000 bps tax; also record its `NO_SWAP_ROUTES_FOUND` quote); the clone "UBIK" `0xe1243842E091f073841Fc1Ac9527eA7E64F168Bd`; CHUMP `0x0E0d2C89a5a019FE1cF762e5e33187631DACC21B`; the Doppler stock-pair BONER `0x98096d17e191B3dA1d5f99a6D7b3584351b11E18`.
  5. **Relay.** `/chains`, `/chains/health`, a `refund` status, a 401 `UNAUTHORIZED_QUOTE`, a `SWAP_IMPACT_TOO_HIGH`, and a 429 (synthetic).
  6. **Base.** A Clanker v4 token and a Zora v4 coin, both with routes.
  7. **Etherscan.** A `tokentx` page for a public address that holds RH and BSC bags.

## 6. `services/api/src/crosschain`

- **`env.ts`.** Its own zod schema over `process.env`; do not edit M0's `env.ts`. Required variables follow rule 3.
  - `CROSSCHAIN_ENABLED` (default `false`) and `CROSSCHAIN_CHAINS` (CSV ⊆ supported);
  - `RELAY_API_URL` (default `https://api.relay.link`), `RELAY_API_KEY`, `RELAY_QUOTES_PER_MINUTE`;
  - `CROSSCHAIN_APP_FEE_RECIPIENT` (EVM address);
  - `CROSSCHAIN_RPC_URL_4663`, `CROSSCHAIN_RPC_URL_56`, `CROSSCHAIN_RPC_URL_8453`;
  - `ETHERSCAN_API_KEY` and `CROSSCHAIN_SCAN_PROVIDER` (`etherscan` or `rpc`);
  - `CROSSCHAIN_QA_REFERRER`, honored only when `NODE_ENV !== "production"`.
- **`mount.ts` and `routes.ts`.** `mountCrosschain(app)` returns at once when the flag is off. Otherwise it calls `app.route("/api/crosschain", createCrosschainRoutes(deps))`, and `routes.ts` takes every dependency by injection.
- **Per-IP limits** (in memory until Redis lands): scan 6/min, quote 30/min, permit 30/min, status 120/min.
- **Logs** may hold the requestId, chainId, short addresses, error codes and latency. Never log a key, an Etherscan URL, a full request body or a signature.

`GET /api/crosschain/config` returns `{ enabled, chains: [{ chainId, name, nativeSymbol, status }], appFeeBps, maxSellTaxBps, minBag, defaultSelection, quoteMaxAgeMs }`, all taken from config.

`POST /api/crosschain/scan` takes `{ evmAddress, solAddress? }` and returns:

```ts
{ scannedAt, chains: Array<{ chainId, name, status: "ok" | "paused", nativeBalanceWei,
  bags: Array<{ token, symbol, name, decimals, balance, launchpad: LaunchpadId | null,
    eligible: boolean, reason?: IneligibleReason, sellTaxBps: number | null, stockPair: boolean,
    phase: "curve" | "pool" | null, defaultSelected: boolean,
    preview: { kind: "quoted"; outLamports; minOutLamports; netUsdCents; fees: FeeLines }
           | { kind: "deferred" } | { kind: "error"; code: CrosschainErrorCode } }> }> }
```

- **Previews** are indicative quotes for eligible bags only, at most `maxPreviewQuotes` per scan, cached for `previewCacheMs`. The rest are `deferred`, and their row gets a "Get price" button that calls `quote`.
- **`defaultSelected`:** eligible, `netUsdCents ≥ minNetUsdCents`, and in the top `maxBags` by `netUsdCents`.
- **Timeout.** A chain that takes more than 8 s comes back `paused`; the others are still returned.

`POST /api/crosschain/quote` takes `{ chainId, token, amount, evmAddress, solAddress, preferPermit? }` and returns:

```ts
{ requestId, quotedAt, expiresAt /* quotedAt + quoteMaxAgeMs */, mode: "standard" | "permit2",
  steps: Array<{ id; kind: "transaction"; chainId; from; to; data; value }
             | { id; kind: "signature"; sign: Eip712Payload; post: { endpoint; method; body } }>,
  outLamports, minOutLamports, fees: FeeLines, recipient, refundTo, slippageBps, timeEstimateSec,
  refundCurrency: { symbol, chainId } }
```

The server runs these checks in order:
1. Validate the input. `solAddress` must be a 32-byte base58 key **on the ed25519 curve** (`PublicKey.isOnCurve`, from the workspace's pinned `@solana/web3.js`), so SOL never goes to a PDA.
2. The chain is enabled and healthy.
3. Eligibility, from the cache. Never trust the client's view.
4. `amount ≤ balanceOf`.
5. The Permit2 allowance, if `preferPermit`.
6. The Relay quote.
7. `validateSteps` or `validatePermit`.
8. The simulation (standard mode).

Never return Relay's raw body.

`POST /api/crosschain/permit` takes `{ requestId, chainId, evmAddress, token, amount, sign, post, signature }`. It re-runs `validatePermit` and requires `recoverTypedDataAddress(sign, signature) == evmAddress`. It then POSTs `post.body` to `RELAY_API_URL + "/execute/permits?signature=…"` with the key. Any other endpoint → 400.

`GET /api/crosschain/status/:requestId` (`^0x[0-9a-fA-F]{64}$`) returns `{ status, inTxHashes, txHashes, solanaTxUrl?, actualOutLamports?, failReason?, updatedAt }`. It makes at most one upstream call per requestId per second and caches terminal states for 10 min.

## 7. `apps/web/src/crosschain`

### 7.1 Route

- **Registration.** If `apps/web` already has a router, register `/foreign` → `lazy(() => import("./crosschain/ForeignBagsPage"))`. Otherwise add exactly one conditional in `main.tsx`: render the lazy page when `location.pathname === "/foreign"`, else `<App />`.
- wagmi and viem must stay out of the main chunk.
- The page calls `GET /api/crosschain/config`. On a 404 or no answer, it shows only "Not available yet."

### 7.2 Wallets (choice and why)

- **EVM: wagmi + viem.**
  - **Connectors.** `injected()` with EIP-6963 discovery: Phantom EVM, Rabby, MetaMask and Backpack each appear under their announced name, with no `window.ethereum` race. `walletConnect({ projectId })` is added only when `VITE_WALLETCONNECT_PROJECT_ID` is set (Robinhood Wallet on mobile, QR on desktop).
  - **Why wagmi.** It gives chain add and switch for 4663, typed `signTypedData`, and EIP-5792 hooks (capabilities, sendCalls, calls status), on the same viem version as the server.
  - **No third-party modal** (RainbowKit, AppKit): the DA forbids third-party logos.
  - **Transports.** Public keyless RPCs only: the viem defaults, or `VITE_RPC_URL_<id>`, which must be keyless.
- **Solana recipient: the connected Solana wallet only, never a paste field.** Use M4's wallet provider if it exists. Otherwise wrap the page in a local `WalletProvider` from `@solana/wallet-adapter-react` 0.15.40 and `-base` 0.9.28 (master §4.2 pins), with Wallet Standard detection and `autoConnect` off. Phantom gives both addresses in one app.

### 7.3 Flow

1. **Connect and scan.** Connect the EVM wallet, then scan; include `solAddress` once the Solana wallet is connected. Bags are grouped under chain chips with the default selection pre-ticked. Ineligible rows are greyed out with their reason.
2. **Review.** Every selected row shows its fee lines and "SOL goes to 7xKp…d2Qa". The total reads "≈ X SOL · at least Y SOL", plus "enough for N packs" using the cheapest of `PACK_EDITIONS` (`packages/config`).
3. **"Sell {n} bags".** For each chain group, switch to that chain, then:
   - **Batch.** If `wallet_getCapabilities(chainId)` reports `atomic.status` `supported` or `ready`, fetch fresh quotes for the group's bags (limiter-aware) and validate them. Flatten `[approve_i?, deposit_i]` and send **one** `wallet_sendCalls` with atomicity **not** required, so one bad bag cannot revert the others. Read each deposit from the calls status.
   - **Otherwise, per bag**, quote with `preferPermit: true`. If the quote comes back `permit2`, sign the EIP-712 payload and POST it via `/permit` (no gas). If not, go **sequential**: approve, wait for the receipt, then deposit. Re-quote first if stale; the new quote has no approve step.
   - **Freshness.** Before **every** prompt, if `now − quotedAt > quoteMaxAgeMs`: re-fetch, re-validate, show the new numbers and require a new tap ("Prices moved. Tap for a fresh quote.").
   - **Gas.** In the standard flow, if the native balance is below 1.2 × `fees.gas`, block that bag with "Add a little {ETH|BNB} on {chain} for gas." Permit2 bags are exempt.
4. **Progress per bag:** Quoting → Approving → Selling → Bridging to Solana → **"Landed. 0.438 SOL in 7xKp…d2Qa"**.
   - **Landed:** a Solscan link, then a "Rip a pack" link to `/packs`.
   - **Refund:** "Refunded as {symbol} on {chain}", with the source-chain tx link and "Retry". Retry re-quotes a sale of the refund currency, a solver currency.
   - **Timeout:** "Still on its way", with both links.
   - **Wallet rejection:** "Wallet said no. Nothing was sent."
5. **Reload.** In-flight `requestId`s are kept in `localStorage` (try/catch) so a reload resumes polling.

### 7.4 Interface boundary (for the architect's experience layer)

- **Logic** lives in `flow.ts` (a pure reducer over per-bag states `idle | quoting | ready | approving | selling | bridging | landed | refunded | failed | stale`) and in `useForeignFlow.ts`.
- **Components** take typed props only: `ConnectBar`, `BagList`, `BagRow`, `FeeLines`, `BagProgress`, `LandedNotice`. The architect will replace their visuals, so keep logic out of them.
- **`FeeLines` rows, in order:** Relay fee · DEX / curve cost · Creator tax {x}% (included above; shown when > 0) · Our fee 0.5% · Network fee ≈ {gas} {ETH|BNB} · You get ≈ {sol} SOL · At least {min} SOL.
- **Styling.** Use the M0 §4 brand tokens (cream, ink, lilac, plum; Fraunces and DM Sans), tabular figures and integrated focus (AGENTS.md). No animation.
- **Copy.** Chain chips "Robinhood Chain", "BNB Chain", "Base". Title "Sell foreign bags → SOL". Subline "Foreign coins accepted. Sold in your wallet; SOL lands in your Solana wallet. Foreign bags are sold, never fed: they don't become Dust Cards." Every string lives in `copy.ts`; the architect moves them into `packages/copy` later.

## 8. Env vars and CSP

- **Server (`api`):** the variables of §6.
- **Web:** `VITE_WALLETCONNECT_PROJECT_ID` (optional, public) and `VITE_RPC_URL_4663|56|8453` (optional, keyless only).
- Add every variable to the `.env.example` files with a comment and no value.
- **CSP:** list in the PR the `connect-src` origins the page needs (public RPCs, WalletConnect relay). Do not edit CSP or Caddy files.

## 9. Acceptance criteria (the architect will run these)

1. `git diff origin/feat/m0-scaffold --stat` (or `origin/main` once #1 has merged) touches only the paths of rule 2. The `app.ts` diff is at most 3 changed lines.
2. From `app/`, `pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` passes. The landing's root commands are unchanged.
3. The tests pass with networking disabled. The `UnrecordedRequestError` test proves the guard, and no fixture contains a key.
4. **RH Pons V2 fixture:**
   - The scan marks the curve token and the graduated token eligible, with `launchpad: "pons-v2"` and `sellTaxBps` equal to the recorded `creatorTaxBps` (100 for UBIK).
   - The quote returns `mode: "standard"` with steps `[approve, deposit]`. The approve decodes to `approve(0xccc88a9d…15be, amount)` with `amount` exactly the input, and `validateSteps` passes.
   - The fee lines are integers, and `outLamports ≥ minOutLamports`.
   - The `usePermit` fixture (allowance ≥ amount) yields `mode: "permit2"` and one EIP-712 step that `validatePermit` accepts.
5. **BSC four.meme fixture.** Origin is four.meme via Helper3 (TM2) and the token is eligible; the quote and simulation pass. The graduated token passes `owner() == 0x0 && _mode() == 0`.
6. **Rejections:**
   - the 1,000 bps Pons token → `TAX_TOO_HIGH`, and its recorded Relay 400 → `NO_ROUTE` with "No route yet for this coin";
   - the clone UBIK and CHUMP → `ORIGIN_UNKNOWN`;
   - a bytecode fixture containing `mint(address,uint256)` → `TEMPLATE_UNSAFE`;
   - BONER → eligible with `stockPair: true`.
7. **Validation negatives.** Each case fails with its own code:
   - the recipient changed;
   - an approve of `maxUint256`, or to an unknown spender;
   - a `to` outside the allowlist, a wrong `chainId`, or a non-zero `value`;
   - a changed Permit2 `verifyingContract`, or a `post.endpoint` other than `/execute/permits`;
   - an executable quote using `PREVIEW_RECIPIENT`;
   - an off-curve `solAddress`.
8. **Quote request bodies.** Every quote request built in tests has `refundTo == evmAddress`, `recipient == solAddress`, `appFees == [{ recipient: <CROSSCHAIN_APP_FEE_RECIPIENT>, fee: "50" }]`, `referrer`, and `slippageTolerance` "300" or "800". No code path sets `overridePriceImpact`, a slippage above 1,000 bps, or an infinite approval (tests plus `grep`).
9. **Freshness.** With fake timers, a prompt after `quoteMaxAgeMs` triggers a re-fetch and requires a new tap. No signature request is ever issued on a stale quote.
10. **Signing mode** (wagmi mock connector):
    - atomic `supported` → one `wallet_sendCalls` with 2N calls, atomicity not required;
    - unsupported, with a Permit2 allowance → the signature path;
    - otherwise → approve, then deposit, in that order.
11. **Status.** The recorded `pending → success` renders "Landed. … SOL in …" with a `https://solscan.io/tx/` link and the "Rip a pack" link. The recorded `refund` renders "Refunded as USDG on Robinhood Chain" with "Retry".
12. **Flag.** With `CROSSCHAIN_ENABLED` unset, `/api/crosschain/config` returns 404 and the page shows only "Not available yet." With `true` but no `RELAY_API_KEY` or no fee recipient, the API exits non-zero with a readable zod error.
13. **Rate limits** (fake timers): the 51st Relay quote within a minute waits, then returns `RATE_LIMITED`; the 7th scan from one IP within a minute → 429.
14. **Bundle.** After `pnpm --filter web build`, `dist/` contains no `x-api-key`, no `api.relay.link`, no `etherscan` and no RPC key. wagmi and viem appear only in the lazy chunk.
15. **Config.** The §4 config tests pass, and `validateParams()` still passes.
16. **Vocabulary.**
    - `grep -rniwE 'grave|graveyard|tomb|tombstone|bury|burial|ghost|ghoul|lich|haunt|wake|funeral|mourner|undertaker|soul|cremate'` over the X4 paths returns nothing.
    - The same grep over `copy.ts` for `earn|yield|guaranteed|profit|Robinhood tokens` returns nothing.
17. **Docs.** `app/README.md` has an X4 section (enable locally, record fixtures, run tests). `VERSIONS.md` has a row for every new pin.

## 10. Founder QA (mainnet, after the architect's PASS; Codex never sends a mainnet transaction)

Run on staging with `CROSSCHAIN_ENABLED=true`, using $2–5 bags and a little gas on each chain.

- **Phantom** (EVM + Solana) on RH and BNB Chain: connect, switch chain, approve then deposit sequentially, and confirm SOL lands. Note whether `wallet_getCapabilities` exists.
- **MetaMask** on RH and BNB Chain: note the `atomic` status; if batching is supported, send one batch of 2 bags. **Rabby:** the sequential flow. **Robinhood Wallet:** via WalletConnect, if a project id is set.
- **Cases:**
  - a Pons V2 curve bag and a graduated Pons V2 bag;
  - a Doppler stock-pair bag, a four.meme curve bag and a Flap tax bag;
  - a no-route bag, which must be greyed out;
  - a stale quote: wait 35 s before signing;
  - a wallet rejection, and zero gas;
  - one forced refund (`CROSSCHAIN_QA_REFERRER=debug-force-refund`, development key, staging only).
- **App fee:** check on Relay `/requests/v3` that the actual `appFees` are 50 bps, paid to our recipient.
- **Base:** add `8453` to `CROSSCHAIN_CHAINS` only after a Clanker v4 bag and a Zora bag pass this same list.

## 11. What the founder must provide

| Item | Why | Where it goes |
|---|---|---|
| **Relay API keys**: one production, one development (Relay Dashboard → API keys) | quote/v2 needs a key since 2026-10-02, and so do `referrer` and app-fee attribution. The development key records fixtures and runs QA | `RELAY_API_KEY` on the `api` service (Railway). The development key only in a local gitignored `.env.local` |
| **Elevated Relay quote limit** (10/s), requested via the Dashboard support widget before the flag goes on | 50 quotes/min is too low for a spike | `RELAY_QUOTES_PER_MINUTE=600` once granted |
| **EVM fee-recipient address**: a team hardware-wallet EOA able to sign Relay's claim | `appFees` accrue as off-chain USDC to it and are claimed by signature (`/app-fees/{addr}/claim`) | `CROSSCHAIN_APP_FEE_RECIPIENT` |
| **Managed RPC URLs** (Alchemy or QuickNode) for 4663, 56 and 8453, with `eth_simulateV1` and `eth_getLogs` | Eligibility reads, the honeypot simulation and the scan fallback. Public RPCs are pruned or capped | `CROSSCHAIN_RPC_URL_4663`, `_56`, `_8453` |
| **Etherscan API key**, Lite plan or above, covering chainids 4663, 56 and 8453 | Primary token discovery. The RH free tier ended 2026-10-15; BSC and Base are paid-only | `ETHERSCAN_API_KEY` |
| **WalletConnect (Reown) project id** (optional, public) | Robinhood Wallet on mobile and QR on desktop | `VITE_WALLETCONNECT_PROJECT_ID` |
| **QA wallets** with $2–5 bags on each chain, some gas, and a Solana wallet | §10 | — |
| **Confirmations:** the referrer string (default `onepercent.fun`) and a public note on where app-fee USDC goes | Honest disclosure (SPEC §12) | Config and ops |

## 12. Do NOT

- Create a Dust Card, a Deck entry, a card or any program call from a foreign bag. Do not import Feed builders from `@onepercent/sdk`, and do not touch the program, the SDK or the IDL.
- Custody anything: no server-held EVM or Solana key, no server-side signing, no sweeper contract. No deposit-address mode either: non-solver tokens sent to a deposit address are lost.
- Ask for an infinite approval, a Permit2 approval, or any approval to a contract of ours. Never send `overridePriceImpact`, and never use slippage above 1,000 bps.
- Send SOL anywhere but the connected Solana wallet, offer a paste field for the recipient, or omit `refundTo`.
- Expose a key: keep the Relay key, the Etherscan key and keyed RPC URLs out of the browser, out of logged URLs and out of fixtures. Never let the browser call `api.relay.link` or Etherscan directly.
- Add other providers, SDKs or chains: no LI.FI, deBridge, Mayan, Across, NEAR 1Click, direct KyberSwap, `@relayprotocol/relay-sdk` or `relay-kit-ui`, and nothing beyond 4663, 56 and 8453.
- Trust a token by name, symbol, vanity suffix, clone template or `tx.to`, or accept a token outside §5.3.
- Tie points, odds, boosts or any other reward to cross-chain volume.
- Break the copy rules: no third-party logos; never "Robinhood tokens" (always "Robinhood Chain"); no promise words (earn, yield, guaranteed, profit); never show Relay's impact percent as the price.
- Use these words in code, strings or docs: grave, graveyard, tomb, tombstone, bury, burial, ghost, ghoul, lich, haunt, wake, funeral, mourner, undertaker, soul, cremate.
- Edit `PARAMS.md`, `MODEL*.md`, `COPY.md`, CSP or Caddy files, or any file outside rule 2.

## 13. Deviations from the master brief (architect decisions) and deferred work

- **Flag name.** `CROSSCHAIN_ENABLED` replaces master §11.5's `FLAG_CROSSCHAIN`; when `flags.ts` lands, it will read this variable.
- **No Relay SDK.** This drops `@relayprotocol/relay-sdk` from the master §4.2 M8a row. REST with zod keeps the key server-side, can be tested on fixtures, and avoids a dependency only days old (8.0.4, published 2026-10-06).
- **Status.** Poll `/intents/status/v3`; Relay's `/requests/v2` is deprecated. Websocket status comes later.
- **Deferred to the follow-up brief** (the rest of M8a):
  - the LI.FI fallback for BSC and Base;
  - the RH two-step fallback (`CROSSCHAIN_RH_TWO_STEP`);
  - deposit-address mode for bot wallets, and Telegram `/xray 0x…`;
  - websocket status;
  - the Pools.trade, Clanker ≤ v3.1, OpenFour and Flap VaultPortal indexes;
  - curve-sell adapters, and Arc.

## 14. Report back

Post in the PR: the `VERSIONS.md` diff; the commands you ran, with results; the fixture list with `recordedAt` and block numbers; the Relay contract allowlist per chain, with its source; the CSP `connect-src` list; deviations and open questions, especially any Relay field that differs from §2.
