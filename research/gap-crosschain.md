# Gap research: cross-chain intake (sell bags on Robinhood Chain, BSC or Base and receive native SOL on Solana)

**As of 2026-10-08, roughly 11:00–12:30 UTC.** "Verified" means one of two things. Either I called the provider's production API that day and got a working quote, route or chain listing, or I read the chain state over RPC. Anything taken only from docs or the press is labelled as such. Anything I could not confirm is marked **UNVERIFIED**.
Reference prices on 2026-10-08 (NEAR 1Click token feed): SOL $114.05, ETH $2,545.54, BNB $764.24.

---

## 1. Summary

- **Where the trenches are.** Only three chains have real launchpad activity today. In 30-day launchpad fees from DefiLlama:
  - Solana: $111.6M
  - **Robinhood Chain (RH): $94.9M**, of which Pons V2 alone is $86.5M
  - **BSC: $42.9M**, of which Flap.sh is $37.1M
  - Base is a distant fourth at $2.1M.
  - Monad, HyperEVM, Abstract, Sonic, Tron, Sui, MegaETH, Ink and Plasma are all below $0.15M per 30 days. They are not worth integrating.
  - **Build order: RH first, then BSC, then Base.** Base costs almost nothing extra because it runs through the same API.
- **Recommended primary provider: Relay (relay.link).** It is the only provider verified end-to-end for **arbitrary RH memecoins, Pons bonding-curve tokens included, to native SOL** in one source-chain transaction. That transaction is preceded by an exact-amount ERC-20 approval the first time a token is sold.
  - Relay's own chain API lists RH (chain 4663) with `tokenSupport: All`.
  - On RH, Relay's origin swaps go through KyberSwap, 0x, Nordstern and others. KyberSwap natively routes **Pons V2 bonding curves**: 59 of 60 sampled Pons V2 tokens were routable.
  - Observed fills land in 0–1 s.
  - Fees: $0.02 flat, 0.15% platform fee on "minor swaps", plus DEX or curve costs. Integrator fees are supported through `appFees` in bps, paid out in USDC.
  - This route is already the production rail for this exact use case. In a 24-second snapshot, 20 of 20 RH→Solana Relay requests succeeded. 15 came from **fomo**; the others came from **Phantom** (85 bps app fee), LI.FI and other apps.
- **Fallbacks:**
  - BSC and Base: **LI.FI**. It can route independently of Relay through OKX or Fly swaps plus a **Mayan** bridge (verified).
  - RH: no second provider does memecoin to SOL in one shot without Relay. LI.FI on RH falls back to Relay itself.
  - The independent RH fallback has two steps: **(1)** sell the token for USDG on RH through KyberSwap (or LI.FI same-chain), then **(2)** bridge USDG to SOL through **NEAR Intents 1Click** (about 22 s, −0.1% to −0.7%) or **LI.FI→Layerswap** (about 15 s).
- **Rejected:**
  - deBridge: 0.001 ETH (about $2.55) or 0.005 BNB (about $3.82) flat fee per order, so 15–34% cost on $10–25 bags. It also fails on Pons curve tokens.
  - Mayan: does not support RH.
  - Across: only delivers USDC to Solana, and only to an existing token account. No native SOL.
  - Squid: RH is not listed.
  - Bungee: public API deprecated.
  - Gas.zip: RH source disabled, and per-chain limits are tiny.
  - Jupiter: no cross-chain API.
  - 1inch Fusion+: supports RH, but the flow is complex (secrets/hashlock), RH orders are not gasless, and long-tail coverage is unknown.
- **Signatures per bag:**
  - First sale of a token: **approve + deposit**, or one wallet confirmation with EIP-5792.
  - Later sales of the same token: one transaction.
  - Relay's **Permit2 mode**: one off-chain signature with no gas once the token is approved to Permit2.
  - Ten bags take one confirmation on MetaMask or Coinbase Smart Wallet (EIP-5792 batching through EIP-7702). Wallets without batching need 10–20 prompts.
  - **Phantom's EVM provider documents no EIP-5792.** Its developer SDK does not yet list RH or BSC for dapps, although the help center says app connections work. **This is the #1 day-1 test.**
- **Bot-wallet users** (GMGN, fomo, Axiom hold most RH trench flow) cannot connect to a dapp. Give them a **Relay open deposit address** per user: send ETH or USDG on RH, or BNB, USDT or USDC on BSC, and native SOL arrives in their Solana wallet. Only "solver currencies" work. Memecoins sent to a deposit address are **unrecoverable**.
- **Minimum economic bag** (net cost under about 5–7%):
  - RH: about $2–3. A $1 bag still works at about −7%.
  - BSC: about $3–5, plus any Flap/four.meme tax.
  - Base: about $2–3.
  - Ethereum L1: about $10 or more. Skip it.
- **Buildable in about 1 week by an AI coder:**
  - Relay SDK plus an RH/BSC/Base scanner.
  - Launchpad-origin eligibility checks.
  - Sequential signing, with an EIP-5792 batch when the wallet supports it.
  - Status tracking and refund UX.
  - Deposit-address mode for Telegram and bot users.
  - LI.FI fallback for BSC and Base.
  - Leave out of v1: a custom "sweeper" contract, the RH two-step fallback (keep it as a v1.1 feature flag), and Ethereum L1.

---

## 2. Chain landscape (which chains have hot trenches now)

### 2.1 Activity by chain

Source: DefiLlama API, pulled 2026-10-08. Endpoints were `overview/dexs/{chain}` and `overview/fees/{chain}`, filtered by category; 30-day windows end about 2026-10-07.

| Chain | DEX vol 24h | DEX vol 30d | **Launchpad fees 30d** | Top launchpads (30d fees) | Trading-app fees 30d | Verdict |
|---|---|---|---|---|---|---|
| Solana | $2,206M | $76.4B | **$111.6M** | pump.fun 55.3M, StonkFun 28.0M, LaunchLab 11.5M, bonk.fun 9.4M | $56.7M (Axiom 34.5, fomo 14.5, GMGN 7.0) | Home chain |
| **Robinhood Chain** | $1,095M | $45.2B | **$94.9M** | **Pons V2 86.5M**, Pons V1 2.78M, NOXA Fun 1.93M, Pools (Uniswap Labs) 0.75M, o1 0.63M, StonkBrokers Nightshades 0.50M, LetsCash 0.40M | $27.9M (GMGN 14.3, fomo 9.5, Axiom 4.0) | **Tier 1** |
| **BSC** | $819M | $32.3B | **$42.9M** | **Flap.sh 37.1M**, Genius.fun 3.78M, Binance Alpha 1.67M, four.meme 0.26M | $14.9M (GMGN 11.5, fomo 2.7) | **Tier 1** |
| Base | $1,183M | $30.3B | $2.1M | o1 1.08M, clanker 0.71M, BaseStonk 0.17M, Zora coins 0.01M, flaunch 0.01M | $1.5M | Tier 2 (free with the same API) |
| Ethereum | $1,633M | $44.0B | $0.10M | — | $3.2M | Skip (gas, no launchpad trench) |
| Hyperliquid L1 / HyperEVM | $346M | $9.8B | $0.01M | LiquidLaunch, Hfun ≈ 0 | $0.1M | Skip |
| Monad | $52M | $3.2B | $0.13M | Nad.fun 0.13M | ≈ 0 | Skip (Phantom also dropped Monad on 2026-08-26) |
| Tron | $51M | $1.48B | $0.03M | SunPump | ≈ 0 | Skip |
| Sui | $33M | $1.52B | ≈ 0 | — | ≈ 0 | Skip |
| Arbitrum | $182M | $5.7B | ≈ 0 | — | — | Skip |
| Abstract, Sonic, MegaETH, Ink, Plasma, Unichain, Berachain, Zora | under $11M/day | $17M–$336M | ≤ $0.04M | — | — | Skip |

### 2.2 Robinhood Chain context (verified unless noted)

- **Basics.**
  - Mainnet since **2026-07-01**. Arbitrum Orbit L2, gas paid in ETH.
  - **Chain ID 4663 (0x1237).** RPC `https://rpc.mainnet.chain.robinhood.com` returned 0x1237.
  - ArbOS version read from the ArbSys precompile: **61**. EIP-7702 has been supported since ArbOS 40.
  - About 0.1 s blocks (about 9.7 blocks/s measured). Base fee about 0.02 gwei.
  - **Permit2** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) and **Multicall3** (`0xcA11bde05977b3631167028862bE2a173976CA11`) are deployed at their canonical addresses. Both are also deployed on BSC and Base.
  - Explorers: `robin.etherscan.io`, listed in the Etherscan V2 chainlist as chainid 4663, and `robinhoodchain.blockscout.com`.
- **DEXes.**
  - Uniswap v3/v4 carries about 96–99.8% of volume (press).
  - DexScreener also shows Ramses v3, Up, Giga, Topaz, Robinswap, 0swap, Alandale and Flap.
  - KyberSwap additionally routes through PancakeSwap Infinity CL and PMMs on RH.
- **Trench dynamics.**
  - RH DEX volume was $1.09B per 24h and $45.2B per 30 days on 2026-10-08.
  - Volume on memecoin/stock-token pairs fell about **96% from its early-September peak** of about $443M/day (Fortune, 2026-10-06, citing CryptoQuant).
  - Pons V2 launches, measured from factory logs:

    | Date | Launches per 20k-block window | Approximate rate |
    |---|---|---|
    | 2026-09-01/02 | 755 | about 32k/day |
    | about 2026-09-11 | 313 | — |
    | about 2026-09-20 | 269 | — |
    | about 2026-09-29 | 297 | — |
    | 2026-10-08 | 30 | about 1.3k/day |

    Pons docs say public launches are now closed; only whitelisted launchers can create tokens.
  - For us this means a **huge stock of bags down 80% or more**, which is exactly our target.
- **Pons V2 mechanics** (docs, GitHub source and on-chain).
  - Factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`.
  - Every token sits on its own constant-product curve. At **4.2 ETH** it graduates into a Uniswap v4 pool behind a Pons hook (`0xE5e7…044`), with liquidity locked permanently.
  - The 4.2e18 graduation threshold appears in the event data of recent launches.
  - Curve sell function: `sell(tokensIn, minQuoteOut, recipient)`.
  - Sampled 15 curves: **`feeBps` = 100 (1%) on all 15**. `creatorTaxBps` ranged 0–300. The cap is 20% total.
  - Sells close once `readyToGraduate()` is true.
  - Pons docs: "no audit has closed yet".
  - Pons V1 (factory `0xA5aAb3F0…1feB`) launched straight into Uniswap v3 WETH pools.
- **Stock-token pairs.**
  - Many memecoins are paired against Robinhood Stock Tokens (NVDA, PFE, AMC, GME, MSTR…).
  - Aggregators route them as two hops (memecoin → stock token → USDG/WETH). Verified with MEMES, which is paired with BB, AMC, MSTR, RDDT and GME.
  - Stock tokens are restricted for US persons and show weekend and market-hours premia (the HIMS episode), so expect bad pricing on those hops at times.
- **Rug risk.** An on-chain analyst attributes at least $18.43M of rugs to one ring across 53 launches, using "exempt wallets" that bought up to 86% of supply in seconds (cryptotimes, 2026-09-28; single source, unconfirmed). Pons V2 has a `snipeTaxExemptions` feature. **"Born on Pons" does not mean safe.**

### 2.3 BSC and Base launchpad notes

- **Flap.sh (BSC).**
  - Portal `0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0`. The label comes from Bitquery; I verified that the address is an active proxy with 17,818 logs in the last 2,000 blocks.
  - Vanity suffixes: **7777 for tax tokens, 8888 for standard tokens**. Graduates to PancakeSwap.
  - Creators can set a 1–10% trading tax. GMGN has warned that some Flap tokens can push the sell tax to **100%**. **Sells must be simulated.**
  - Flap also has an RH deployment (`0x26605f…eb09` per Bitquery). Aggregators do **not** route it: Relay returned `NO_SWAP_ROUTES_FOUND`.
- **four.meme (BSC).**
  - TokenManager2 `0x5c952063c7fc8610FFDB798152D69F0B9550762b`. The label is third-party; I verified it is an active proxy.
  - Vanity suffix **4444**. Now small at $0.26M per 30 days, but there are many legacy bags.
- **Base.** clanker (Uniswap v3/v4), Zora creator coins (v4 vs ZORA), BaseStonk and o1. Small, but every one I tested routes.

---

## 3. Provider matrix

Columns: **RH** = Robinhood Chain 4663 as source. **Long-tail source** = sells arbitrary memecoins on the source chain.

| Provider | RH | Other hot sources | Native SOL out | Long-tail source tokens | API / SDK | Fees (memecoin → SOL) | Integrator fee | Latency | Refund | Keys / limits | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Relay** | **YES, verified** (chains API `tokenSupport: All`; live quotes) | BSC, Base, ETH, Arb, Monad, HyperEVM, Abstract, Sonic, MegaETH, Tron (limited)… 61 chains | **YES** (`1111…1111`) | **YES.** On RH via 0x, KyberSwap (incl. `pons-v2` curves), Nordstern, Magpie, Rialto, Fabric, Fynd, PancakeSwap. On BSC, Flap and four.meme curves via 0x | REST `/quote/v2` → steps → `/intents/status/v3`, websocket, webhooks; `@relayprotocol/relay-sdk` 8.0.4 | $0.02 flat + 0.15% platform ("minor swap") + DEX/curve cost; user pays origin gas | **`appFees` in bps**, accrued in USDC, claimable | **0–1 s** fill observed | On origin to `refundTo`, in the solver currency (USDG/ETH/USDC) minus gas | Key "required" for quote/v2 from 2026-10-02 per docs, but keyless calls still returned 200 on 10-08; **50 quotes/min** default, 10/s elevated | **PRIMARY** |
| **LI.FI** | YES (chain listed). RH bridges: across, symbiosis, glacis, **relaydepository**, lifiIntents, paxos, layerswap | 58 mainnets incl. BSC, Base, Sui, Tron | YES | Via Kyber, OpenOcean, Bitget, Fly, Nordstern. On RH memecoin → SOL it **depends on Relay**; some failures seen (CASHCAT tx-gen fail, SUPR filtered at 17% impact) | `/v1/quote`, `/v1/status`; `@lifi/sdk` 4.11.0 | **+0.25% LI.FI fee** on top of the underlying | `fee` + `integrator` (Portal) | 1–15 s | DONE + REFUNDED states | **75 quotes / 2 h without key**; 100 rpm with key | **FALLBACK** for BSC and Base (via Mayan); RH only as two steps |
| deBridge DLN | YES (supported-chains-info) | BSC, Base, Arb, ETH, HyperEVM, Monad, Tron, MegaETH | YES | Pre-swap works for pool tokens; **Pons curve token → `TOKEN_PAIR_NOT_TRADABLE`** | `create-tx` (one call), order status; **Solana hooks** | **Flat 0.001 ETH (RH/Base) or 0.005 BNB (BSC)** + 4 bps + taker margin (about 9 bps observed) + opex (about $1 to Solana) | `affiliateFeePercent` (up to 10%) | Seconds | Cancel signed on the destination chain → full refund | Public | Reject for bags; whales only |
| NEAR Intents (1Click) | Partial. Only whitelisted assets: ETH, WETH, USDG, USDe, PONS, CASHCAT. RH ETH → "No liquidity" | Base ETH OK; **BSC: temporary minimum $1,000** | YES | **No** (whitelist only) | Deposit-address flow: `/v0/quote` → deposit → `/v0/status`; TS SDK | 0.0001% protocol + 0.1–0.2% surcharge without JWT; observed −0.1% to −0.7% | `appFees` (bps) | **About 22 s** (RH USDG), about 32 s (Base) | `refundTo` on origin | JWT optional | **RH fallback leg** (USDG → SOL) |
| Mayan | **NO** (v11 init: SOL, ETH, Monad, BSC, Base, Arb, OP, Polygon, Avax, Sui, Unichain, Linea, HyperEVM, HyperCore) | BSC, Base | YES | Liquid tokens (CLANKER OK); Zora coin → route not found | REST + `@mayanfinance/swap-sdk` | Swift/MCTP relayer fee | `referrerBps` | 3–35 s | Swift refunds on origin | — | Indirect (inside LI.FI) |
| Across | YES, but **EVM destinations only** (ETH/WETH/USDG → USDC) | — | **NO** ("Destination swaps are not supported yet for routes involving Solana"; USDC only, needs an existing ATA) | — | Swap API | — | — | — | — | — | Reject |
| 1inch Fusion+ | YES (since 2026-07-22) | ETH, Base, Arb, Solana… | UNVERIFIED | Unknown; Swap API "does not route certain v4 hook pools" | Cross-Chain SDK: quote → hashlock secrets → `placeOrder` → `submitSecret` | Resolver spread; **RH cross-chain is not gasless** | Paid Business plan only | — | Escrow timeouts | API key | Reject for v1 (complexity) |
| Squid | **Not listed** in supported chains | BSC, Base, HyperEVM, Solana | — | — | Integrator-id header | — | Yes | — | — | — | Reject |
| Bungee / Socket | **UNVERIFIED** (public v1 API returns 410 "deprecated, migrate to Socket V3") | — | (Socket guide: EVM → Solana OK) | — | — | — | — | — | — | — | Reject |
| Rango | Claims RH via Relay and GasZip (X post, **UNVERIFIED**); public key returned 403 | BSC, Base… | — | Aggregates Relay | API key | Rango fee + underlying | Yes | — | — | — | No benefit over Relay |
| Jupiter | No cross-chain **API**. In-app "Universal Deposit" (ETH, Base, Arb, Sui → **USDC** on Solana; Sept 2026) | — | No (USDC) | — | — | — | — | — | — | — | Reject |
| Wormhole Connect / Portal | No evidence of RH | — | — | Portal swap runs on Mayan | — | — | — | — | — | — | Reject |
| Gas.zip | Listed, but **"Source: Chain Disabled"** | BSC → SOL: "Chain Limit Exceeded" at $15 | Native gas only | No | — | — | — | — | — | — | Reject |
| OKX DEX API | In-app RH trading since 2026-09-03; API cross-chain RH → SOL **UNVERIFIED** | Seen as a referrer on Relay BSC → SOL | — | — | API key | — | Yes | — | — | — | Not needed |
| **KyberSwap** (same-chain building block) | **YES** (slug `robinhood`; routes `pons-v2`) | BSC (`flap` curves), Base | n/a | **YES** | `GET /{chain}/api/v1/routes` + build; `x-client-id` | Pool/curve fees | Yes (fee params) | — | — | Free | Used inside Relay; standalone for the RH fallback |

---

## 4. Evidence: live tests run on 2026-10-08

Setup for every quote:
- The origin user was a random EOA, so quotes do not depend on balances.
- The recipient was a valid random Solana pubkey.
- Every quote was EXACT_INPUT to native SOL.

### 4.1 Relay, RH → SOL

| Bag (type) | In | Out (SOL) | Total impact | Origin router → bridge asset | Origin gas |
|---|---|---|---|---|---|
| CASHCAT (deep v3/v4) | $24.23 | $24.07 (0.2117 SOL) | −0.69% | 0x → USDG | $0.139 |
| CATS (v4 vs WETH, $15k liquidity) | $25.70 | $24.73 | −3.79% | KyberSwap → USDG | $0.063 |
| VLAD (v3 vs WETH) | $27.57 | $26.96 | −2.24% | 0x → USDG | $0.045 |
| MEMES (v4 vs **stock tokens**, about $1k liquidity each) | $5.61 | $5.45 | −2.88% | KyberSwap → USDG | $0.062 |
| PONS, $1 | $1.00 | $0.97 | −3.06% | Nordstern → USDG | $0.037 |
| PONS, $5 | $5.02 | $4.95 | −1.39% | Nordstern | $0.048 |
| PONS, $200 | $200.86 | $198.12 | −1.37% | Nordstern | $0.046 |
| SUPR (**Pons V2 curve**, fresh) | $42.63 | $41.60 | −2.42% | KyberSwap (`pons-v2`) | $0.0016 |
| EMOGLOBIN (Pons V2 curve) | $42.67 | $41.15 | −3.55% | KyberSwap | $0.0016 |
| 8 Pons V2 curve tokens launched Sep 1–29, sold at 0.2% of supply | $5.2–$9.0 | — | −2.7% to −9.3% (includes 1% curve fee + 0–3% creator tax) | KyberSwap | $0.0016 |
| Flap token on RH (curve) | — | — | **NO ROUTE** | — | — |
| A tiny DOPAMEME bag | — | — | Error: output below the **0.00065 SOL** rent minimum | — | — |

### 4.2 Relay, BSC and Base → SOL

| Bag (type) | In | Out | Total impact | Origin router → bridge asset | Origin gas |
|---|---|---|---|---|---|
| BSC: Flap graduated (Pancake v2) | $20.00 | $19.19 | −4.08% | 0x → USDC | $0.042 |
| BSC: Flap **curve** token (paired vs QQQB) | $20.04 | $19.24 | −3.98% | 0x → USDC | $0.077 |
| BSC: four.meme **curve** token | $19.99 | $19.64 | −1.76% | 0x → USDC | $0.046 |
| BSC: 7 dead Flap tokens (no pairs on DexScreener) | — | — | NO ROUTE (no liquidity, which is expected) | — | — |
| Base: CLANKER (v3) | $20.25 | $19.90 | −1.76% | KyberSwap → OUSD | $0.031 |
| Base: BaseStonk (v4 vs USDC) | $10.01 | $9.70 | −3.01% | KyberSwap → OUSD | $0.022 |
| Base: 3 Zora creator coins (v4 vs ZORA) | about $10 each | — | −0.84%, −2.54%, −10.4% (the last had $4k liquidity) | Kyber / 0x → OUSD | $0.035–0.047 |

### 4.3 Coverage and fee checks

- **KyberSwap coverage of Pons V2.** 59 of 60 tokens sampled from five launch windows (2026-09-01 to 10-08) returned a route when selling 1% of supply. All used `pons-v2`; the median value was $25–42.
- **Relay app fee test.** `appFees: [{fee: "75"}]` on a $29.56 bag charged $0.2166 in USDG on the origin chain. `expandedPriceImpact` broke down as: swap −$0.757, execution −$0.020, relay −$0.044, app −$0.217.
- **Relay approvals.** The approve step is for the **exact amount** (not infinite) to the approvalProxy `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be`.
- **Relay Permit2 mode.** With `usePermit: true`, the steps are:
  1. An `approve` to Permit2 (infinite, which is standard for Permit2).
  2. `authorize1`: an EIP-712 `PermitBatchWitnessTransferFrom` signature posted to `/execute/permits`. **The solver pays origin gas.**

### 4.4 The same bags on other providers

- **deBridge:**

  | Bag | In | Out | Flat fee | Effective cost |
  |---|---|---|---|---|
  | CASHCAT | $25.10 | $23.82 | 0.001 ETH (about $2.55) | **−14.6%** |
  | CATS | $27.02 | $24.46 | about $2.55 | **−18.9%** |
  | BSC Flap curve token | $20.99 | $19.46 | 0.005 BNB (about $3.82) | **−25.5%** |
  | Base Zora coin | $11.41 | $10.04 | about $2.55 | **−34%** |
  | Pons curve token | — | — | — | Not tradable |

- **LI.FI:**
  - CATS: $26.06 → $25.03, via Kyber + Relay.
  - CASHCAT: "None of the available routes could successfully generate a tx".
  - SUPR: filtered out (impact above 10%).
  - BSC Flap curve token: $20.35 → $20.02 via **OKX + Mayan**, 3 s.
  - Base Zora coin: via **Fly + Mayan**.
  - **With `denyBridges=relaydepository`, LI.FI cannot route RH memecoins or ETH to SOL.** RH USDG → SOL still works via **Layerswap** ($19.98 → $19.83, 15 s).
- **NEAR 1Click** (RH USDG → SOL):

  | Size | Impact |
  |---|---|
  | $2 | −0.65% |
  | $5 | −0.34% |
  | $10 | −0.24% |
  | $50 | −0.46% |
  | $500 | −0.14% |

  All at about 22 s. RH ETH: no liquidity. Base ETH $20.29 → $20.25, about 32 s. BSC: minimum $1,000 (temporary).
- **Mayan.** Base CLANKER via FAST_MCTP, ETA 35 s. Base Zora coin: route not found. RH: not supported.
- **Across.** Solana destination swaps are not supported. USDC to Solana requires an existing token account.
- **Gas.zip.** RH: source disabled. BSC → SOL: per-chain limit exceeded at $15.

### 4.5 Production usage of Relay

Snapshot from the Relay `/requests/v2` API:
- **RH → Solana:** 20 of 20 requests were `success` between 12:12:41 and 12:13:05 UTC.
  - Referrers: **fomo** (15), **phantom** (1, app fee 85 bps), lifi (1), elon123 (1), none (2).
  - Inputs were mostly memecoins (COOK, BCI, SHROOM, FOMOPAD, PAWS, BOW, SPACEHOOD…).
  - Outputs were mostly USDC, plus some SOL.
  - Fill durations: 0–1 s.
  - fomo's app fees ranged 16–136 bps, plus 2–20 bps referral splits.
  - fomo uses ERC-4337 UserOps that batch approve and deposit in one operation, with **3,500 bps slippage**.
- **BSC → Solana:** 20 requests in 68 s. Referrers: fomo 16, okx 2, rango 1.
- Single snapshot. The `/requests` endpoint is rate-limited without a key.

---

## 5. Per-provider details

### 5.1 Relay (PRIMARY)

- **Chains (`GET https://api.relay.link/chains`, 61 chains).** Robinhood (4663) has:
  - `tokenSupport: All`.
  - Solver currencies **ETH and USDG** (`0x5fc5360d0400a0fd4f2af552add042d716f1d168`).
  - Contracts: erc20Router `0xb92fe925…4fff4f`, approvalProxy `0xccc88a9d…15be`, v2 depository `0x4cd00e38…bc31`.
  - Solana (792703809) has native SOL `11111111111111111111111111111111`. Solana depository: `99vQwtBw…SrN2`.
- **Origin swap sources** (`GET /swap-sources?chainId=4663`): weth, 0x, magpie, kyberswap, rialto, fabric, fynd-hosted, nordstern, binance, pancakeswap.
- **Flow.**
  1. `POST /quote/v2` with: `user` (EVM), `recipient` (Solana pubkey), `originChainId`, `originCurrency` (token), `amount`, `tradeType: EXACT_INPUT`, `destinationChainId: 792703809`, `destinationCurrency: 1111…1111`, `refundTo` (EVM), and optionally `slippageTolerance` (bps), `appFees`, `usePermit`, `useDepositAddress`, `ttl`, `useQueueing`, `subsidizeFees`, `includedOriginSwapSources`.
  2. The response returns `steps[]`: `approve` (if allowance is short) and `deposit`, or `authorize1` for Permit2. Each step carries the tx data and a `check` endpoint.
  3. Execute the steps, then poll `GET /intents/status/v3?requestId=…`, or use the websocket or webhooks.
- **`/price`** gives a lightweight quote with no calldata, suitable for scan-time valuation.
- **Fees** (docs, `fees.md`):
  - **Execution:** $0.02 flat plus destination gas.
  - **Swap cost:** DEX fees, impact and solver rebalancing.
  - **Platform:** 0% for bridging, 0.01% for stablecoin swaps, 0.06% for "major" swaps, **0.15% for "minor" swaps**.
  - **App fees:** set by the integrator.
  - Revenue share for integrators needs an API key, KYB and more than $10M of 30-day volume.
- **App fees.** `appFees: [{recipient: EVM address, fee: bps}]`. They accrue to an off-chain **USDC** balance. Check with `GET /app-fees/{addr}/balances`, then claim with `POST /app-fees/{addr}/claim` followed by a signature posted to `/execute/permits`. Benchmarks: Phantom charges 85 bps on RH → SOL; fomo charges about 16–136 bps.
- **Refunds.**
  - Paid on the **origin chain** to `refundTo`, minus refund gas.
  - For origin swaps, the refund is whatever the depository received after the swap. **On a failed fill, the user gets USDG or ETH back on RH, not their memecoin.**
  - If the refund cannot cover its own gas, no refund is sent.
  - The docs warn that without `refundTo`, automatic refund can be disabled (deposit addresses). **Always set `refundTo`.**
  - A failed or reverted origin transaction leaves the user's tokens in place; only gas is lost.
- **Deposit addresses** (`useDepositAddress: true`).
  - Open addresses are reusable per route; `strict: true` makes a one-time address.
  - **Only solver currencies are processed. Non-solver tokens sent to a deposit address are not recoverable.**
  - Deposits of $0.05 or less are not swept.
  - Destination calldata is not allowed.
- **Gasless.**
  - Permit2 flow (`usePermit`): one approval transaction per token, then gasless signatures, with the solver paying origin gas.
  - ERC-4337 batching and a 7702 BatchExecutor (Calibur) are available for embedded wallets. That path does not apply to MetaMask or Phantom.
- **Destination actions.** `txs` is **EVM-only**. There is no Solana post-fill instruction, which we do not need: the user opens packs in a separate Solana transaction.
- **Keys and rate limits.**
  - Self-serve key from the Relay dashboard, sent as the `x-api-key` header.
  - Defaults: `/quote` 50/min, `/requests/v3` 200/min, others 200/min.
  - Elevated: `/quote` 10/s.
  - Docs say quote/v2 requires a key from **2026-10-02**. A keyless quote/v2 still returned HTTP 200 on 2026-10-08. Get a key anyway.
- **Security.**
  - Audits: Spearbit/Cantina (Feb 2025, vault and periphery), Certora (Jun 2025, Solana depository), Zellic (Nov 2025, EVM/SVM depository and allocator).
  - Depositories are described as non-upgradable with no owner withdrawal path. Trust concentrates in the **allocator**.
  - **Incident:** from **2026-09-12 to 09-26**, an API flaw leaked pending trades to MEV bots. About 5,600 users were sandwiched, with about $136k of searcher profit (median victim about $11.88). Relay announced about $312k of automatic compensation (reported by Odaily and a YouMind repost). I found no contract exploit.
- **SDK.** `@relayprotocol/relay-sdk` 8.0.4 (`getQuote`, `execute`, adapters for viem and Solana). UI kit: `@relayprotocol/relay-kit-ui` 12.0.5.

### 5.2 LI.FI (FALLBACK for BSC and Base; RH partial)

- `GET https://li.quest/v1/chains` lists **4663 "Robinhood Chain"** (key `out`) and Solana (`1151111081099710`).
- Tools on 4663:
  - Bridges: across, symbiosis, glacis, relaydepository, lifiIntents, paxos, smartDeposits, layerswap.
  - Exchanges: bitget, openocean, kyberswap, fly, nordstern, lifiIntentsDex, smartDeposits, rialto.
- On BSC and Base, LI.FI can bridge with **Mayan** (Swift/MCTP), CCTP, near, gasZip and others, so the path is independent of Relay.
- LI.FI powers Robinhood Wallet swaps and stock-token "Intents" (LI.FI blog, July 2026).
- **Fees.** 0.25% LI.FI service fee. Integrator `fee` is set through Portal registration.
- **Limits.** Without a key, `/quote` is limited to **75 requests per 2 hours**. With a key: 100 rpm.
- **Status.** `GET /v1/status`, with outcomes including `DONE` + `REFUNDED`.
- **Security.** Exploited on 2024-07-16 for about $11.6M through a new GasZipFacet that drained wallets with **infinite** approvals. Finite approvals were safe.

### 5.3 deBridge DLN (rejected for bags)

- `GET /v1.0/supported-chains-info` lists Robinhood 4663, Solana 7565164, BSC, Base, Arbitrum, Ethereum, HyperEVM, Tron, Monad, MegaETH, Story and others.
- `create-tx` returns a ready transaction with pre-swap. Fees:
  - **Flat fee from `DlnSource.globalFixedNativeFee()`**: 0.001 ETH on RH and Base, 0.005 BNB on BSC (observed). Refunded on cancel.
  - 4 bps protocol fee.
  - About 4–9 bps taker margin.
  - Operating expenses (about $1 when the destination is SOL).
- `affiliateFeePercent` up to 10%.
- **Solana hooks** are supported: destination instructions bound to the order.
- Cancelling requires a transaction on the destination chain by the destination authority.
- Pons curve token → `TOKEN_PAIR_NOT_TRADABLE`.
- Only competitive for bags of hundreds of dollars or more.

### 5.4 NEAR Intents, 1Click (RH fallback leg)

- `GET /v0/tokens` lists `hood` assets: ETH, WETH, USDG, USDe, PONS, CASHCAT.
- Model: the user sends funds to a one-time **deposit address** from any wallet, CEX or bot.
- Tests:
  - RH USDG → SOL: about 22 s, −0.14% to −0.65%.
  - RH ETH → SOL: "No liquidity available".
  - BSC: "minimum swap amount is $1,000" (temporary).
  - Base ETH → SOL: OK.
- OpenAPI exposes `appFees` (bps) and a referral field.
- Unauthenticated requests pay an extra 0.1–0.2% (press). A partner JWT removes it.

### 5.5 Mayan

- `GET https://sia.mayan.finance/v11/init` lists: Solana, Ethereum, Monad, BSC, Base, Arbitrum, Optimism, Polygon, Avalanche, Sui, Unichain, Linea, HyperEVM, HyperCore (destination only). **No RH.**
- The same config's `evmWalletSupports.phantom` list is stale: it still includes Monad.

### 5.6 Across

- `/api/swap/chains` includes Robinhood and Solana.
- `available-routes` from 4663 go only to EVM chains (ETH/WETH, and USDG → USDC).
- The swap API to Solana returns "Destination swaps are not supported yet for routes involving Solana". USDC to Solana needs the recipient's USDC token account to exist.
- **Incident:** on 2026-07-17 a relayer lost about $4.5M to forged Solana deposit records. User funds were unaffected; it was not a contract flaw.

### 5.7 1inch Fusion+

- RH supported since **2026-07-22**.
- Cross-chain orders to and from RH are **not gasless** (1inch help article dated 2026-09-03).
- The flow needs secret and hashlock management.
- Long-tail support is unknown; some v4 hook pools are skipped.
- Integrator fees require a paid Business plan.
- Not used in v1.

### 5.8 Others

- **Squid:** the supported-chains doc has no RH.
- **Bungee:** `public-backend…/supported-chains` returns 410, deprecated in favour of Socket V3. Socket was exploited for $3.3M on 2024-01-16 (infinite approvals).
- **Rango:** RH via Relay and GasZip per an X post (UNVERIFIED).
- **Jupiter:** no cross-chain API. Universal Deposit delivers USDC.
- **Wormhole:** no RH evidence.
- **Gas.zip:** RH source disabled; small per-chain limits.
- **OKX:** RH in-app only; API unverified.
- **Layerswap:** reachable through LI.FI for RH USDG → SOL.

---

## 6. Batching and UX

### 6.1 Signatures per bag, by wallet

| Wallet | RH | BSC | Base | 1 bag (first time) | 10 bags | Notes |
|---|---|---|---|---|---|---|
| **Phantom (EVM)** | In-app yes (2026-07-23/24). **Dapp provider: UNVERIFIED** | In-app yes (about 2026-10-01). Dapp: UNVERIFIED | Yes | approve + deposit (2) | Up to 20, or 10 approvals + 10 gasless Permit2 signatures | Browser SDK chain table (fetched 10-08) lists Ethereum, Polygon, Base, Arbitrum and Monad (deprecated) only, with **no 4663 or 56**. The help center says "you can connect Phantom to apps on Robinhood Chain". **No EIP-5792 documented.** One app gives both the Solana and EVM addresses, which is the best UX if it works. |
| **MetaMask** | Yes (add chain 0x1237) | Yes | Yes | **1 confirmation** via EIP-5792 + 7702 smart account (first use: upgrade prompt) | **1 confirmation** | 7702 batching is chain-dependent. Its toolkit network list includes BSC and Base; **RH is unknown**. Check `wallet_getCapabilities`. |
| Coinbase Smart Wallet / Base app | UNVERIFIED for RH | Yes | Yes | 1 | 1 | EIP-5792 native |
| Rabby, OKX, Trust, Bitget, Backpack | Trust, Bitget, Backpack advertise RH | Yes | Yes | 2 | Up to 20 | Not listed on eip5792.xyz |
| Robinhood Wallet | Yes, via **WalletConnect** (mobile; QR on desktop) | — | Yes | 2 | Up to 20 | Gas subsidy ended 2026-09-29 |
| GMGN / fomo / Axiom embedded wallets | — | — | — | Cannot connect | — | Use the **deposit-address** path: sell in-app to ETH/USDG/BNB, then send to the address. fomo already sells RH → SOL via Relay. |

### 6.2 Batching techniques, ranked for a one-week build

1. **EIP-5792 `wallet_sendCalls`.**
   - Fetch a Relay quote per bag just in time, flatten every step item (`approve_i`, `deposit_i`), and send them as one batch.
   - Detect support with `wallet_getCapabilities(chainId)`: `atomic.status` is `supported` or `ready`.
   - With viem's `sendCalls` (experimental fallback) or wagmi `useSendCalls`, fall back to sequential transactions. **Check the exact viem fallback flag.**
   - Atomic batches revert entirely if one bag's slippage fails. Use per-bag slippage of 300–800 bps and allow non-atomic execution. Deposits from a 7702- or 4337-batched EOA are fine: fomo's 4337 batches succeed in production.
2. **Relay Permit2 mode** (`usePermit: true`).
   - Read `allowance(owner, Permit2)` on-chain. If it is already sufficient, the bag costs **one EIP-712 signature with no gas**.
   - Otherwise the bag costs one Permit2 approval transaction (batchable with 5792), then a signature.
   - This also solves "no ETH for gas" for tokens already approved to Permit2.
3. **Sequential with a progress queue** (fallback for Phantom, Rabby and others).
   - Re-quote each bag right before its prompt, because quotes expire.
   - Default selection: the top 5 bags by net value.
4. **Deposit address** (Telegram and bot wallets): one plain transfer, no dapp.
5. **Custom sweeper contract.** Permit2 `PermitBatchTransferFrom` pulls N tokens, runs aggregator calldata, then makes one Relay deposit, so 10 bags cost one signature and one transaction. **Not for v1**: it needs a new contract, an audit-grade review and it holds approvals. Revisit only if multi-bag users dominate.

### 6.3 Gas per chain (2026-10-08)

| Chain | Gas price | Approve (about 46k gas) | Relay swap + deposit (measured) |
|---|---|---|---|
| RH | 0.020 gwei | about $0.002–0.005 | **$0.0016–$0.06** (Kyber), up to $0.14 (heavy 0x routes) |
| BSC | 0.05 gwei | about $0.002 | **$0.04–0.08** |
| Base | 0.006 gwei | about $0.001 | **$0.02–0.05** |
| Ethereum L1 | 0.25 gwei | about $0.03 | about $0.2–0.35 (estimate) |

Solana side: receiving native SOL is free for the user. A first-time recipient needs at least 0.00065 SOL of output; Relay enforces this rent minimum.

### 6.4 Minimum economic bag size (recommended UI thresholds)

| Chain | Fixed costs | Variable costs | Grey out below | Recommend at least |
|---|---|---|---|---|
| RH | About $0.02 Relay + $0.002–0.05 gas (+ approve) | 0.15% Relay + **1% Pons curve fee + 0–3% creator tax** or v3/v4 pool fee + impact + our app fee | **Net quote under $1** | **$3** (measured: $1 → −6.7%, $2 → −4%, $5 → −2.4% all-in) |
| BSC | About $0.02 + $0.04–0.08 | Pancake / curve fees, **Flap/four.meme tax 1–10%** | $2 | **$5** |
| Base | About $0.02 + $0.02–0.05 | v3/v4 fees | $1 | **$3** |
| ETH L1 | About $0.25–0.4 | — | — | Not supported in v1 |

Packs start at **$10 (The Original)**. Show a running SOL total ("you'll have X SOL, enough for N packs") and suggest a top-up from existing SOL to reach the next pack.

---

## 7. Recommended architecture and flow

### 7.1 Provider choice

- **Primary: Relay**, called directly through its API or SDK, for RH, BSC and Base → native SOL.
- **Fallback:**
  - BSC and Base: **LI.FI** with `denyBridges=relaydepository` to force an independent path (Mayan).
  - RH: two steps. **KyberSwap** (or LI.FI same-chain) memecoin → USDG, then **NEAR 1Click** USDG → SOL (deposit address, about 22 s) or **LI.FI → Layerswap** (about 15 s).
  - Put the fallback behind a server-side health switch: Relay `/chains/health` plus quote error rate.

### 7.2 Components

- **Frontend.** Vite + React, viem/wagmi with EIP-6963 injected wallets plus WalletConnect/Reown (for Robinhood Wallet mobile), and the Solana wallet adapter (Phantom).
  - Define RH with `defineChain({id: 4663, nativeCurrency: ETH, rpcUrls: rpc.mainnet.chain.robinhood.com})`.
  - Label chains in the brand's DA, for example "coin slots" (RH / BSC / Base) on the convert machine. No spooky vocabulary.
- **Backend (serverless).**
  - Holds the Relay key, LI.FI key, Etherscan key and RPC keys.
  - Proxies `/quote/v2` and `/price`; caches prices for 15–30 s; queues requests to stay within 50 quotes/min. **Request elevated limits (10/s) before launch.**
- **Scanner** (no wallet connection needed: user pastes an address or connects):
  - Etherscan V2 `tokentx`, which covers chainid 4663, 56 and 8453. **BSC and Base are paid-only since late 2025: the Lite plan is about $49/month.** Blockscout is an alternative for RH.
  - Multicall3 `balanceOf` for current balances.
  - Eligibility filter, then valuation via Relay `/price`, falling back to DexScreener for display.
  - Flags: no route or no liquidity ("can't be converted"), high tax, graduating curve (`readyToGraduate`), honeypot.
- **Eligibility (on-chain, cached):**
  - RH Pons V2: `factory.getLaunchedToken(token)` (selector `0x3cf28b5a`) returns a non-zero struct. Index with the `TokenLaunched` topic `0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607` (token, curve and deployer indexed).
  - RH Pons V1: index the factory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` launch logs. Topic0 `0x14613701…c62a`, with topic1 = token (inferred from logs).
  - BSC: Flap portal `TokenCreated` logs plus the 7777/8888 suffix; four.meme TokenManager2 plus the 4444 suffix.
  - Base: clanker, Zora, o1 and BaseStonk factories (**addresses to be confirmed**).
  - Universal fallback: Etherscan V2 `getcontractcreation`, requiring `contractCreator` to be in an allowlist of launchpad deployer contracts.
- **Execution:**
  - Per bag: `quote/v2` with `refundTo = user EVM`, `recipient = user Solana`, explicit `slippageTolerance` (300 bps for deep pools, up to about 1,000 bps for curves; **never fomo's 3,500**), and `appFees` (suggest 50–85 bps, below Phantom's 85).
  - Batch with 5792 where supported, else Permit2 if already approved, else sequential.
- **Tracking:**
  - Relay websocket or `/intents/status/v3` per requestId, plus Solana balance polling.
  - On success, show "SOL landed" and enable the "Open packs" CTA, which is a normal Solana transaction in Phantom (MagicBlock VRF pack program).
- **Refund UX.** When a request is refunded, show "refunded as USDG on Robinhood Chain" with a one-click **retry** (USDG is a solver currency, so the retry costs about $0.02 and fills in about 1 s).

### 7.3 Exact user flows

1. **Web, connected wallet.**
   - Paste an address or connect.
   - The machine scans RH, BSC and Base. A result card shows eligible bags with net SOL per bag and a total (shareable).
   - The user picks bags (default: all with net ≥ $3, capped at 10).
   - Connect an EVM wallet and a Solana wallet (both from Phantom if it supports the chain).
   - Switch to the source chain and sign: one confirmation with 5792, or the approve and deposit prompts.
   - SOL lands in about 1–5 s.
   - "Open packs" (one Solana signature).
2. **Telegram bot** (non-custodial).
   - `/convert`, then the user pastes an EVM address; the bot scans.
   - Button "Convert in wallet" opens a deep link that loads our web app inside Phantom's in-app browser (`https://phantom.app/ul/browse/<url>`) or MetaMask's (`https://metamask.app.link/dapp/<url>`). The user signs there.
3. **Bot-wallet users** (GMGN, fomo, Axiom).
   - The bot shows a **personal Relay open deposit address**: RH ETH/USDG → SOL to their Solana wallet (or BSC BNB/USDT/USDC, Base ETH/USDC), as a QR code plus copy button.
   - Big warning: "ETH/USDG only, other tokens are lost".
   - The user sells their bags in-app and sends the proceeds. SOL arrives automatically.

### 7.4 One-week build plan (AI coder; architect audits)

| Day | Work |
|---|---|
| D1 | Relay key; chain configs; wallet connect (wagmi + Reown + Phantom). **Test Phantom EVM on 4663 and 56** (`wallet_switchEthereumChain`, `sendTransaction`, `wallet_getCapabilities`) and MetaMask 5792 on 4663. |
| D2 | Scanner (Etherscan V2 + Multicall3), Pons V2/V1 eligibility, valuation via `/price`, result card. |
| D3 | Relay quote and execute (sequential), status websocket, refund and retry UI, app fees. |
| D4 | EIP-5792 batching with capability detection and fallback; Permit2 mode (allowance check). |
| D5 | BSC and Base (Flap, four.meme, clanker/Zora eligibility, tax and honeypot warnings); deposit-address mode; Telegram deep links. |
| D6 | Mainnet QA with $2–5 bags on each chain, covering: tax token, curve token, stock-token pair, no-route token, quote expiry, wrong chain, zero gas, refund (forced via referrer `debug-force-refund`). |
| D7 | Buffer; LI.FI fallback for BSC/Base behind a flag; monitoring (error-rate alerts, Relay health). |

**Not in week 1:** the RH two-step fallback (ship as v1.1), the sweeper contract, Ethereum L1, other chains, deBridge and 1inch.

---

## 8. Risks

1. **Single-rail dependency on Relay.** All one-shot RH memecoin → SOL routes, LI.FI's included, go through Relay. Mitigations: the two-step fallback, health switch and status page.
2. **MEV and slippage.**
   - Relay's API leak (2026-09-12 to 09-26) let MEV bots sandwich users. Production apps use huge slippage (fomo 3,500 bps).
   - Use explicit, tight slippage and show "minimum received".
   - The BSC public mempool is sandwich-prone. RH (Arbitrum FCFS sequencer) is less so.
3. **Unsellable or honeypot tokens.**
   - Flap can push sell tax to 100%.
   - Dead tokens have no liquidity.
   - Pons curves are briefly unsellable while graduating.
   - The quote is not a guarantee. A reverted origin transaction costs only gas.
4. **Refund currency.** On a failed fill the user receives USDG or ETH on the origin chain, not the original token. This needs clear UI and a retry path.
5. **Approval surface.**
   - Relay uses exact-amount approvals (good).
   - Permit2 mode means an infinite Permit2 approval (industry standard, but phishing-prone).
   - Aggregator history: LI.FI and Socket were drained through infinite approvals.
   - Never request infinite approvals to our own contracts.
6. **Wallet fragmentation.** Phantom's dapp support for RH and BSC is unverified, and no batching is documented. If RH fails on Phantom, the primary audience needs MetaMask or Rabby. Zero-build fallback: tell users to use Phantom's built-in swap (RH token → SOL), which already runs on Relay.
7. **Rate limits at launch spikes.** 50 quotes/min default per key. Request 10/s, cache `/price`, and queue.
8. **Stock-token pairs.** Market-hours and weekend premia and issuance pauses, plus restrictions for US persons, can distort multi-hop routes.
9. **Trench decay and launchpad risk.**
   - RH pair volume is down about 96% from its peak; Pons launches are down about 25x.
   - Pons contracts are unaudited per its own docs.
   - A rug ring used exempt wallets.
   - Being "born on a launchpad" is a provenance filter, not a safety filter.
10. **Frontend integrity.** We build the transactions, so a compromised frontend could swap the recipient. Mitigations: show the Solana recipient and amounts prominently, use a strict CSP, pin the SDK and the domain.
11. **Explorer API costs and policy.** Etherscan put BSC and Base behind a paywall in late 2025, and its RH free-tier status is unknown.
12. **Relay app-fee payout mechanics.** USDC accrues off-chain and is claimed by signature. It is not on-chain until claimed, so set up a disclosed treasury flow.

---

## 9. Open questions (verify on day 1–2)

1. Does Phantom's injected EVM provider accept `wallet_switchEthereumChain` to **0x1237 (RH)** and **0x38 (BSC)**, and can it send dapp transactions there? The help center says yes; the Browser SDK chain table omits both.
2. Does Phantom support `wallet_sendCalls` / `wallet_getCapabilities` (EIP-5792)? Nothing is documented; assume no.
3. Does MetaMask's 7702 atomic batching work on RH (4663)? Check `wallet_getCapabilities`.
4. Will Relay enforce the quote/v2 API key (documented from 2026-10-02; not enforced on 10-08), and what elevated limits will they grant? Which chains and currencies can app-fee claims use?
5. Flap 7777 tax tokens and four.meme tax tokens: do Relay origin swaps handle fee-on-transfer correctly end-to-end? Test with a real $2 sell.
6. Base launchpad factory addresses (clanker, Zora, o1, BaseStonk) and Pons V1 / NOXA / Pools provenance checks: confirm the exact view functions or event signatures.
7. Is the Etherscan V2 free tier available for chainid 4663 (BSC and Base are paid)? Otherwise use Blockscout for RH.
8. Relay deposit addresses: confirm that open addresses for RH USDG → SOL are reusable per user, and confirm the auto-refund behaviour when a CEX or bot sends.
9. NEAR 1Click on RH: is the "No liquidity" for ETH → SOL persistent, and when does the BSC $1,000 minimum end?
10. 1inch Fusion+ RH ↔ Solana: long-tail token support and minimums. Only relevant as a third rail later.

---

## 10. Sources

**Primary APIs** (called 2026-10-08):
- `https://api.relay.link/chains`, `/quote`, `/quote/v2`, `/price`, `/swap-sources?chainId=4663`, `/requests/v2`, `/documentation/json`
- `https://li.quest/v1/chains`, `/v1/tools`, `/v1/quote`
- `https://dln.debridge.finance/v1.0/supported-chains-info`, `/v1.0/dln/order/create-tx`
- `https://sia.mayan.finance/v6…v11/init`, `https://price-api.mayan.finance/v3/quote`
- `https://app.across.to/api/swap/chains`, `/api/available-routes`, `/api/swap/approval`
- `https://1click.chaindefuser.com/v0/tokens`, `/v0/quote`, `/docs/v0/openapi.yaml`
- `https://backend.gas.zip/v2/chains`, `/v2/quotes`
- `https://aggregator-api.kyberswap.com/{robinhood|bsc}/api/v1/routes`
- `https://api.dexscreener.com/latest/dex/…`
- `https://api.llama.fi/overview/dexs/{chain}`, `/overview/fees/{chain}`
- `https://api.etherscan.io/v2/chainlist`
- RH RPC `https://rpc.mainnet.chain.robinhood.com`: `eth_chainId`, ArbSys `arbOSVersion`, `eth_getLogs` on the Pons factories, curve `feeBps` / `creatorTaxBps`; BSC and Base public RPCs.

**Relay docs:**
- [App fees](https://docs.relay.link/features/app-fees.md)
- [Fees](https://docs.relay.link/references/api/api_core_concepts/fees.md)
- [API keys](https://docs.relay.link/references/api/api-keys.md)
- [Quote v2](https://docs.relay.link/references/api/get-quote-v2.md)
- [Refunds](https://docs.relay.link/references/api/api_core_concepts/refunds.md)
- [Deposit addresses](https://docs.relay.link/features/deposit-addresses.md)
- [Gasless swaps](https://docs.relay.link/features/gasless-swaps.md)
- [Smart accounts](https://docs.relay.link/references/api/api_guides/smart-accounts.md)
- [Solana](https://docs.relay.link/references/api/api_guides/solana.md)
- [Audits](https://docs.relay.link/security/contract-audits)
- API-leak incident: [Odaily](https://www.odaily.news/en/newsflash/521108), [YouMind repost](https://youmind.com/landing/x-viral-articles/relay-sandwich-attack-compensation)

**LI.FI:**
- [Fees FAQ](https://docs.li.fi/faqs/fees-monetization)
- [Rate limits](https://docs.li.fi/api-reference/rate-limits)
- [Live on Robinhood Chain](https://li.fi/knowledge-hub/li.fi-is-live-on-robinhood-chain-from-day-one)
- [Incident report, 16 July 2024](https://li.fi/knowledge-hub/incident-report-16th-july)

**deBridge:**
- [Fee structure](https://docs.debridge.com/dln-details/overview/fee-structure.md)
- [Affiliate fees](https://docs.debridge.com/home/monetization/affiliate-fees)
- [Hooks](https://docs.debridge.com/home/use-cases/hooks.md)
- [Cancelling orders](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/cancelling-order)

**1inch:**
- [Robinhood cross-chain swaps](https://business.1inch.com/whats-new/robinhood-cross-chain-swaps)
- [Robinhood Chain on 1inch](https://help.1inch.com/en/articles/16799830-robinhood-chain-on-1inch-what-s-supported-today)

**Other providers:**
- Squid: [supported chains](https://docs.squidrouter.com/chains-and-tokens/get-supported-tokens-and-chains.md)
- Jupiter: [Universal Deposit](https://docs.jup.ag/user-docs/onramp/deposit/universal-deposit)
- Across incident: [threatcluster](https://threatcluster.io/cluster/across-protocol-loses-45m-in-exploit-user-funds-unaffected-b7e57bc0)
- Socket exploit: [CoinDesk](https://www.coindesk.com/de/tech/2024/01/17/socket-bungee-restart-operations-after-apparent-33m-exploit)

**Robinhood Chain:**
- [Robinhood bridging docs](https://docs.robinhood.com/chain/bridging/)
- [Pons v2 docs](https://docs.ponsfamily.com/v2)
- [Pons contracts on GitHub](https://github.com/ponsdotdev/pons-labs)
- [Fortune, 2026-10-06](https://fortune.com/2026/10/06/443-million-memecoin-frenzy-robinhood-circle-latest-memecoin-boom-bust)
- [CryptoTicker guide](https://cryptoticker.io/en/robinhood-chain-memecoins-explained/)
- [Galaxy Research](https://www.galaxy.com/insights/research/robinhood-chain-launch-analysis-base-comparison-memecoins-distribution-thesis)
- [Rug-ring analysis](https://www.cryptotimes.io/2026/09/28/analyst-exposes-18-43m-robinhood-chain-memecoin-rug-pull-ring/)
- [KuCoin on stock-paired memes](https://www.kucoin.com/blog/robinhood-stock-paired-meme-coins)

**BSC launchpads:**
- [Bitquery Flap.sh (BSC)](https://docs.bitquery.io/docs/blockchain/BSC/flap-sh/)
- [The Defiant on Flap](https://thedefiant.io/news/defi/flap-overtakes-pump-fun-in-daily-revenue-with-1-18-million)

**Wallets:**
- [Phantom Robinhood Chain FAQ](https://help.phantom.com/hc/en-us/articles/53628774801683-Robinhood-Chain-FAQ)
- [Phantom drops Monad, adds RH](https://cryptonews.net/news/blockchain/33202089/)
- [Phantom adds BNB Chain](https://cryptobriefing.com/phantom-wallet-adds-bnb-chain-support/)
- [Phantom Browser SDK](https://docs.phantom.com/sdks/browser-sdk/index)
- [EIP-5792 wallet list](https://www.eip5792.xyz/ecosystem/wallets)
- [MetaMask batch transactions](https://docs.metamask.io/wallet/how-to/send-transactions/send-batch-transactions/)
- [Robinhood Wallet: connect to dapps](https://robinhood.com/us/en/support/articles/connect-to-dapps/)
- [Etherscan BSC/Base paywall](https://finance.yahoo.com/news/ethereum-explorer-etherscan-locks-avalanche-143215634.html)

---

## Independent fact-check (2026-10-08)

**Checked 2026-10-08, 12:53–13:25 UTC, by an independent verifier who did not reuse the report's raw outputs.** Every item below was re-derived that day from one of three things: a fresh call to a production API, a fresh RPC read, or a primary doc.
- Test identities: a random EVM EOA (`0x8ba1…BA72`) as `user` and `refundTo`, and a freshly generated on-curve Solana pubkey as recipient. LI.FI Intents rejects off-curve (PDA-like) recipients.
- Prices had moved slightly since the report. NEAR 1Click feed at about 13:15 UTC: SOL $112.05, ETH $2,525.61, BNB $758.02.

Verdicts:
- **Confirmed**: matches.
- **Corrected**: substantially right, but a number, scope or conclusion must change.
- **Wrong**: does not hold.
- **Unverified**: could not be checked independently.

### Scorecard

| # | Claim (report section) | Verdict |
|---|---|---|
| 1 | Relay supports RH 4663 with all tokens and native SOL out (§3, §5.1) | Confirmed |
| 2 | One-shot RH memecoin → SOL; exact-amount approval; Permit2 mode (§1, §4.3) | Confirmed |
| 3 | KyberSwap routes 59 of 60 Pons V2 tokens (§4.3) | **Corrected**: 19 of 21 today |
| 4 | Relay fees: $0.02 + 0.15%; `appFees` in bps accrue as off-chain USDC (§5.1) | Confirmed |
| 5 | Relay API key and rate limits (§5.1) | **Corrected** |
| 6 | Relay deposit addresses accept solver currencies only (§5.1, §7.3) | Confirmed |
| 7 | Relay is the production rail: fomo, and Phantom at 85 bps (§4.5) | Confirmed |
| 8 | LI.FI: RH listed; relies on Relay for RH memecoin → SOL; Layerswap USDG leg; 0.25% fee; 75 quotes per 2 h (§5.2) | Confirmed, plus one extra failure |
| 9 | deBridge flat fee: 0.001 ETH or 0.005 BNB (§5.3) | Confirmed |
| 10 | Mayan has no RH; Across has no Solana destination swaps; NEAR 1Click has an RH whitelist (§5.4–5.6) | Confirmed |
| 11 | DefiLlama 30-day launchpad fees, hence "RH first" (§1, §2.1) | **Corrected**: numbers exact, but the short-window trend flips the live ranking |
| 12 | Pons V2 factory, hook and curve mechanics; creator tax 0–3% (§2.2) | **Corrected**: creator tax goes up to 10% |
| 13 | BSC eligibility: Flap Portal with 7777/8888, four.meme TM2 with 4444 (§2.3, §7.2) | **Corrected**: allowlist incomplete |
| 14 | Wallets: Phantom RH dapps yes, SDK lacks 4663/56, no EIP-5792; MetaMask supports 5792 (§6.1) | Confirmed; RH batching still unverifiable |
| 15 | Explorer: Etherscan V2 covers 4663; BSC and Base are paid (§7.2, §8.11, Q7) | **Corrected**: RH free tier ends 2026-10-15 |

### Details

**1. Relay chain support: Confirmed.**
- `GET https://api.relay.link/chains` at 12:53 UTC returned 61 chains.
- Robinhood Chain (RH):
  - `tokenSupport: All`, `depositEnabled: true`.
  - Solver currencies: USDG (`0x5fc5360d0400a0fd4f2af552add042d716f1d168`) and ETH.
  - Contracts: `approvalProxy` `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be`, `erc20Router` `0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f`, v2 depository `0x4cd00e387622c35bddb9b4c962c136462338bc31`. All three have bytecode on RH.
- BSC and Base are also `tokenSupport: All`.
- Solana: native SOL `11111111111111111111111111111111`, depository `99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2`.
- `GET /chains/health?chainId=4663` returned `{"healthy":true}`.
- `GET /swap-sources?chainId=4663` returned weth, 0x, magpie, kyberswap, rialto, fabric, fynd-hosted, nordstern, binance, pancakeswap. This matches the report exactly.
- Source: https://api.relay.link/chains

**2. One-shot RH memecoin → native SOL: Confirmed.**
- Keyless `POST /quote/v2` at about 12:58 UTC:
  - Bag: QUEEN (`0xe0a2dea2d841f3cbc796024e39dead1d5a160618`), a Pons V2 curve launched at 12:54 UTC; 2,000,000 tokens (0.2% of supply).
  - Result: $8.49 in, 0.072718 SOL ($8.18) out, −3.72% total.
  - Route: KyberSwap (`pons-v2` + robinswap-v3) → USDG; `timeEstimate` 1 s; origin gas $0.0016; default slippage 200 bps.
- Standard steps:
  1. `approve(0xccc88a9d…, 2e24)`. The amount equals the input exactly; it is not infinite.
  2. A deposit transaction to the approvalProxy.
- With `usePermit: true`:
  1. `approve(Permit2, 2^256−1)`.
  2. `authorize1`: an EIP-712 `PermitBatchWitnessTransferFrom` signature posted to `/execute/permits`.
  - The execution cost rose from $0.020 to $0.031, because the solver pays origin gas.
- Nuance: another fresh Pons V2 token (`0x6fb318cbcd9872c33606b3abcdd23b1216f8a5d8`, 10% creator tax) returned `NO_SWAP_ROUTES_FOUND` at both 0.2% and 0.02% of supply. The scanner must treat "no route" as a normal state.
- Sources: https://api.relay.link/quote/v2 (live); https://docs.relay.link/features/gasless-swaps.md

**3. KyberSwap coverage of Pons V2: Corrected.**
- Claim: 59 of 60 sampled Pons V2 tokens were routable.
- Test: `GET https://aggregator-api.kyberswap.com/robinhood/api/v1/routes` (the slug `robinhood` is confirmed).
  - Sample: 21 Pons V2 tokens launched 2026-10-08 between 07:14 and 12:54 UTC (every 20th launch).
  - Each quote sold 0.2% of supply for USDG.
- Result: **19 of 21 were routable (90%)**.
  - Every route went through `pons-v2`, sometimes combined with pmm, pancake-infinity-cl, orvex-cl or uniswapv3.
  - Outputs were about $6.6–11.7.
  - The two failures had creator taxes of 1,000 and 200 bps. Neither was `readyToGraduate`.
- Correction: plan for **up to about 10%** of fresh Pons bags being unroutable at any moment, not about 2%.
- Source: https://aggregator-api.kyberswap.com/robinhood/api/v1/routes (live)

**4. Relay fees and app fees: Confirmed.**
- The fees doc lists exactly these tiers:

  | Swap type | Platform fee |
  |---|---|
  | Bridge | 0% |
  | Stablecoin | 0.01% |
  | Major | 0.06% |
  | Minor | 0.15% |

  - It also lists the $0.02 flat execution fee.
  - Revenue share requires an API key, KYB, and more than $10M of 30-day volume.
- The doc's definitions leave memecoin → SOL ambiguous, because one side (SOL) is a major token. Live quotes charged 0.15% anyway:

  | Bag | Value | Relay fee | Execution |
  |---|---|---|---|
  | QUEEN | $8.49 | −$0.0127 | −$0.0201 |
  | BSC Flap 8888 token | $3.68 | −$0.0055 | −$0.0201 |

- App-fees doc:
  - Set with `appFees: [{recipient, fee}]`, fee in bps.
  - Fees "accrue in an offchain base USDC balance".
  - Check the balance with `GET /app-fees/{addr}/balances`.
  - Claim with `POST /app-fees/{addr}/claim`, then post a signature to `/execute/permits`.
  - The recipient must be an EVM address.
- A keyless quote with a 50 bps `appFees` returned HTTP 200 and charged $0.0413. That fee was computed on the post-swap USDG value.
- Sources: https://docs.relay.link/references/api/api_core_concepts/fees.md ; https://docs.relay.link/features/app-fees.md

**5. Relay API key and rate limits: Corrected.**
- The docs say: "Starting October 2, 2026, every quote/v2 request will require a valid API key". In practice, keyless quote/v2 still returned HTTP 200 throughout 12:58–13:25 UTC.
- Limits (header `x-api-key`):

  | Endpoint | Default | Elevated |
  |---|---|---|
  | `/quote` | 50/min | 10/s |
  | `/requests` | **100/min** (the report said 200) | 5/s |
  | Other endpoints | 200/min | 200/min |

- New finding: the docs also say "Quote requests that set a referrer must be authenticated."
  - A keyless quote with `referrer: "debug-force-refund"` returned **HTTP 401 `UNAUTHORIZED_QUOTE`**.
  - So the D6 forced-refund QA step needs the key. Get it on D1.
- Source: https://docs.relay.link/references/api/api-keys.md

**6. Relay deposit addresses: Confirmed.**
- Docs:
  - "Only tokens listed as solver currencies for a given chain can be processed by deposit addresses."
  - "Non-solver tokens and NFTs sent to deposit addresses are not recoverable through normal processes."
  - Deposits of $0.05 or less are not swept.
  - Open addresses are reusable per route; strict addresses are single-use.
  - For open addresses, omitting `refundTo` disables automatic refund.
  - "Calldata execution on destination is not allowed."
- Live tests:
  - `useDepositAddress: true` for RH ETH → SOL returned a deposit address: 0.008 ETH ($20.30) → 0.17899 SOL, −0.66%.
  - The same request for a memecoin returned HTTP 400 "Deposit addresses only supported for major tokens".
- Solver currencies per `/chains`:

  | Chain | Solver currencies |
  |---|---|
  | RH | ETH, USDG |
  | BSC | BNB, USDT, USDC, USDe, SOMI |
  | Base | ETH, WETH, USDC, USDT, cbBTC, SOL, DEGEN, OUSD |

- Sources: https://docs.relay.link/features/deposit-addresses.md ; https://docs.relay.link/references/api/api_core_concepts/refunds.md

**7. Relay as the production rail: Confirmed.**
- Snapshot: `GET /requests/v2?originChainId=4663&destinationChainId=792703809&limit=20` at 13:20 UTC.
- Result: 20 of 20 requests were `success`, created between 13:19:20 and 13:19:54 UTC.
- Referrers: fomo 11, none 4, BasedBot 2, elon123 2, and phantom 1 (BBDGR → CASH, **85 bps** app fee).
- Inputs were mostly RH memecoins: PONS, INU, AI, SIRIUS, BULLISH, ECSTASY, MOO and others. Outputs were mostly USDC, with some SOL.
- fomo's app fees in this window were 1–107 bps, plus 18–20 bps splits.
- Source: https://api.relay.link/requests/v2 (live)

**8. LI.FI fallback: Confirmed, with one extra failure.**
- `/v1/chains` lists 4663 "Robinhood Chain" (key `out`) and Solana `1151111081099710`.
- `/v1/tools` on RH matches the report exactly:
  - Bridges: across, symbiosis, glacis, relaydepository, lifiIntents, paxos, smartDeposits, layerswap.
  - Exchanges: bitget, openocean, kyberswap, fly, nordstern, lifiIntentsDex, smartDeposits, rialto.
  - Bridges able to reach Solana from RH: glacis, layerswap, lifiIntents, relaydepository, smartDeposits.
- Live quotes:

  | Route | Settings | Result |
  |---|---|---|
  | RH ETH → SOL | `denyBridges=relaydepository` | 404 "No available quotes". Glacis and lifiIntents were filtered out because they need a destination-chain signature; Layerswap returned "Route not found". |
  | RH USDG → SOL | Relay denied | Works via **Layerswap: $19.98 → $19.73 in 15 s**. LI.FI fee $0.05 (0.25%). |
  | RH Pons curve token QUEEN → SOL | Relay allowed | **422 "None of the available routes could successfully generate a tx"** |

- Docs: "LI.FI charges a 0.25% service fee". Unauthenticated `/quote` is "75 requests per two hours" (the response header showed `ratelimit-limit: 75`). With a key, the limit is 100 rpm.
- Implication: today LI.FI cannot be counted on for RH memecoins at all, not even as a wrapper around Relay. Keep it for BSC and Base, and for the RH USDG leg only.
- Sources: https://li.quest/v1/chains ; https://li.quest/v1/tools?chains=4663 ; https://li.quest/v1/quote (live) ; https://docs.li.fi/api-reference/rate-limits ; https://docs.li.fi/faqs/fees-monetization

**9. deBridge flat fee: Confirmed.**
- On-chain read of `DlnSource(0xeF4fB24aD0916217251F553c0596F8Edc630EB66).globalFixedNativeFee()`:
  - RH: 0.001 ETH.
  - BSC: 0.005 BNB.
  - Base: 0.001 ETH.
- `supported-chains-info` lists 18 chains, including Robinhood 4663, Solana 7565164, BSC and Base.
- On $10–25 bags, this flat fee alone costs 10–38%. The rejection stands.
- Sources: https://dln.debridge.finance/v1.0/supported-chains-info ; `eth_call` on public RH, BSC and Base RPCs

**10. Mayan, Across and NEAR 1Click: Confirmed.**
- **Mayan.** `v11/init` lists solana, ethereum, monad, bsc, base, arbitrum, optimism, polygon, avalanche, sui, unichain, aptos, linea, hyperevm and hypercore. There is no Robinhood Chain. The report's list omits Aptos, which does not matter here.
- **Across.**
  - `available-routes?originChainId=4663` returns EVM destinations only: ETH/WETH, and USDG → USDC.
  - `swap/approval` for RH USDG → SOL returns "Destination swaps are not supported yet for routes involving Solana."
- **NEAR 1Click.** `/v0/tokens` lists these `hood` assets: USDG, PONS, CASHCAT, ETH, WETH, USDe. It is a whitelist only.
- Sources: https://sia.mayan.finance/v11/init ; https://app.across.to/api/available-routes?originChainId=4663 ; https://app.across.to/api/swap/approval ; https://1click.chaindefuser.com/v0/tokens

**11. Chain landscape and build order: Corrected.**
- Claim: 30-day launchpad fees of Solana $111.6M, RH $94.9M (Pons V2 $86.5M), BSC $42.9M (Flap $37.1M) and Base $2.1M justify building RH first, then BSC.
- DefiLlama `overview/fees/{chain}`, pulled at about 13:05 UTC, reproduces the 30-day figures exactly. Shorter windows tell a different story:

  | Chain | Launchpad fees 24h | 7d | 30d | 7-day daily average vs 30-day daily average |
  |---|---|---|---|---|
  | Solana | $3.17M | $25.71M | $111.59M | −1% |
  | RH | $0.65M | $7.32M | $94.94M | **−67%** |
  | BSC | $0.95M | $10.96M | $42.86M | **+10%** |
  | Base | $0.03M | $0.45M | $2.12M | −9% |

- Over 24 hours, Pons V2 alone made $0.561M, against $0.905M for Flap.
- RH DEX volume peaked at $3.67B on 2026-09-04 and now runs at about $1.0–1.1B/day (DefiLlama `overview/dexs/robinhood`).
- Fortune (2026-10-06) cites CryptoQuant for memecoin/stock-token pair volume of about $443M/day in early September. It then says activity "has fallen 96%".
- Correction: **BSC (Flap) is now the bigger live trench**, by launchpad fees over both 24 hours and 7 days.
  - RH-first is defensible only on the *stock* of dead bags left by the September frenzy. That stock is exactly our "bags down 80%" target.
  - Relay serves RH, BSC and Base through the same API. Ship RH and BSC together on day 1 instead of sequencing them.
- Sources: https://api.llama.fi/overview/fees/robinhood (and `/solana`, `/bsc`, `/base`) ; https://api.llama.fi/overview/dexs/robinhood ; https://fortune.com/2026/10/06/443-million-memecoin-frenzy-robinhood-circle-latest-memecoin-boom-bust

**12. Pons V2 factory and curve mechanics: Corrected (creator tax).**
- Confirmed: **contracts and selectors.**
  - Factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`, listed in the Pons docs and the GitHub README. It has 24,177 bytes of code.
  - Its dispatcher contains selector `0x3cf28b5a` = `getLaunchedToken(address)`. Selector `0xc68360a5` = `readyToGraduate()` is also present.
  - Meme hook: `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`.
  - Pons V1 factory: `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` (24,353 bytes).
- Confirmed: **launch volume and graduation targets.**
  - The `TokenLaunched` topic `0x8d4aad49…89607` emitted 403 logs in blocks 83,130,388–83,329,587 (07:13:57–12:55:05 UTC). That is about 1.7k launches/day; the report said about 1.3k/day.
  - 348 of these 403 logs (86%) carry a 4.2e18 (4.2 ETH) graduation target.
  - The other 55 are custom-pair launches whose target is in the pair asset. Pairs seen: USDG; stock tokens such as NVDA and TTWO; other memecoins.
  - So "graduates at 4.2 ETH" holds for ETH-paired curves only.
- Confirmed: **launch access.**
  - The docs say "Public launches are closed, so only whitelisted addresses can create a token for now".
  - Launches continue anyway: the two launch transactions inspected were both sent to contract `0xe33e9e479df8802cb0866d5d05258bec4cf62948`.
  - The window had 351 distinct creator addresses.
- Confirmed: **safety and fee mechanics.**
  - Docs: "No audit has closed. Treat v2 as unaudited".
  - Snipe tax "starts at 99% of a buy and decays exponentially to zero across the first 5 seconds".
  - The launcher and the creator fee recipient are exempt automatically. Creators can name extra exempt addresses at creation. This is consistent with the "exempt wallets" rug-ring report.
  - Sells close "as soon as `readyToGraduate()` returns true".
  - `feeBps` was 100 on 11 of 11 sampled curves.
  - Caps from the GitHub README: curve fee ≤ 10%, creator tax ≤ 10%, total trade fee ≤ 20%.
- Corrected: **creator tax.** `creatorTaxBps` on 81 curves launched today (every 5th launch):
  - Range 0–1,000 bps, median 175.
  - 8.6% were above 300 bps; 4.9% sat at the 1,000 bps (10%) cap.
  - The report's "0–3%" understates the worst case. Selling into a Pons curve can cost **1% plus up to 10%** before any aggregator or Relay fee.
  - Read `creatorTaxBps()` for every bag and show it. Consider dropping bags with more than 5% tax from the default selection.
- Sources: https://docs.ponsfamily.com/v2 ; https://github.com/ponsdotdev/pons-labs ; RH RPC (`eth_getLogs`, `eth_call`)

**13. BSC launchpad eligibility (Flap.sh, four.meme): Corrected (incomplete).**
- Confirmed: **Flap, from its own "Deployed Contract Addresses" page.**
  - BNB Chain Portal: `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0` (v5.23.1).
  - Vanity suffixes: Standard Token implementation **8888**; Tax Token V3 implementation **7777**.
  - Robinhood Portal: `0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09`.
  - The BSC Portal emitted 3,048 logs in the last 300 blocks.
  - Fees: the bonding-curve fee on BNB Chain is 1%. Documented creator tax options are 1, 3, 5 and 10%. Tax Token V3 allows separate buy and sell rates.
- Confirmed: **four.meme.**
  - Its official GitHub org (`four-meme-community`, linked from four.meme's gitbook) lists TokenManager2 at `0x5c952063c7fc8610FFDB798152D69F0B9550762b`.
  - TokenManager2 covers tokens created after 2024-09-05.
- Missing from the report: add each of these to the allowlist or exclude it explicitly.
  - **four.meme TokenManager V1** (`0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC`) covers tokens created before 2024-09-05. These are exactly the "legacy bags".
  - **four.meme OpenFour** is a new modular launch engine, with docs updated 2026-10-01 and TaxToken / StrategyTaxToken types. Find its Core through the Registry `0x912CEf0C3aE9Ab6eB3Ec87cab69371cFb317Ab94` and identify tokens with `core.tokens(token)`.
  - **Flap VaultPortal** (BSC `0x90497450f2a706f1951b5bdda52B4E5d16f34C06`) is a second Flap launch path.
  - **Flap also runs on Base**: Portal `0x0000BC1c4fD15Dd79029AF8F5d77D68ae4490000`. This matters for the Base allowlist.
- Unverified: GMGN's warning that "some Flap tokens can push sell tax to 100%". Flap's docs only document rates up to 10%. Keep the sell simulation anyway.
- Live Relay quotes, BSC → SOL:
  - Flap 8888 token: $3.68 → $3.60 (−2.17%), via 0x → USDC.
  - Flap 7777 token (1% tax) at 0.1% of supply: `SWAP_IMPACT_TOO_HIGH` (42.47%).
  - The same 7777 token at 0.01% of supply: quoted, but with an impact of **+13%**. Relay's USD valuation of tax tokens can therefore be wrong. Display the SOL output, not the impact percentage.
- Sources: https://docs.flap.sh/flap/developers/deployed-contract-addresses.md ; https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/inspect-a-tax-token.md ; https://github.com/four-meme-community/four-meme-ai (`skills/four-meme-integration/references/contract-addresses.md`) ; https://github.com/four-meme-community/openfour-docs

**14. Wallet support: Confirmed (RH batching unverifiable).**
- **Phantom.**
  - Help Center: users can "connect Phantom to apps on Robinhood Chain". The article has no date.
  - The Browser SDK network table lists chain IDs 1, 11155111, 137, 80002, 8453, 84532, 42161, 421614, 143 (deprecated) and 10143 (deprecated). There is no 4663 and no 56.
  - The SDK docs do not mention EIP-5792, `wallet_sendCalls` or `wallet_getCapabilities`.
  - Phantom added RH around 2026-07-24 (cryptonews, 2026-07-25).
  - Phantom added BNB Chain on 2026-10-01: in-app balances, send and swaps. Dapp connections are not mentioned.
- **eip5792.xyz** lists MetaMask, Coinbase Smart Wallet, Safe, Ambire, Reown AppKit embedded, thirdweb, Openfort, Abstract Global Wallet, TokenPocket and Splits. Phantom, Rabby, OKX, Trust and Backpack are not listed.
- **MetaMask** docs:
  - EIP-5792 atomic batching works by upgrading the account under EIP-7702.
  - The listed networks include BNB Smart Chain and Base. **Robinhood Chain is not listed.**
  - A fallback to `eth_sendTransaction` is documented.
- Still unverifiable without a real wallet: how Phantom's injected provider behaves on 0x1237 and 0x38, and MetaMask's `atomic` status on 4663. The day-1 test stands.
- Sources: https://help.phantom.com/hc/en-us/articles/53628774801683-Robinhood-Chain-FAQ ; https://docs.phantom.com/sdks/browser-sdk/index ; https://www.eip5792.xyz/ecosystem/wallets ; https://docs.metamask.io/wallet/how-to/send-transactions/send-batch-transactions/ ; https://cryptobriefing.com/phantom-wallet-adds-bnb-chain-support/ ; https://cryptonews.net/news/blockchain/33202089/

**15. Explorer API for the scanner: Corrected (answers open question 7).**
- `api.etherscan.io/v2/chainlist` lists 4663 Robinhood Chain (`robin.etherscan.io`, status 1), 56 and 8453.
- Etherscan's "Supported chains" page:
  - BSC and Base are "Paid Tier Only".
  - Robinhood Chain shows "Free Tier Available", **but "community endpoints are free until October 15, 2026"**.
  - From then: "Effective October 16, 2026, they require a Lite plan or above". Source-code and ABI endpoints stay free.
- Our launch, around 2026-10-29, falls after that date.
- The RH Blockscout API (`robinhoodchain.blockscout.com/api…`) answered server-side curl with a Cloudflare "Just a moment…" challenge (HTTP 403). It cannot simply replace Etherscan in the backend.
- Correction: either budget a paid Etherscan plan covering 4663, 56 and 8453 from day 1, or build the scanner on RPC alone: `eth_getLogs` on factory events plus Multicall3 `balanceOf`. The RPC route needs no explorer. The Lite plan price ($49/month in the report) was not re-verified.
- Sources: https://api.etherscan.io/v2/chainlist ; https://docs.etherscan.io/supported-chains

### Additional spot checks

- **RH chain basics: Confirmed.**
  - `eth_chainId` returned 0x1237.
  - ArbSys `arbOSVersion()` returned 116, which is ArbOS 61 because ArbSys adds 55.
  - Gas price was 0.0202 gwei.
  - Block rate was about 9.8 blocks/s (199,199 blocks in 20,468 s).
  - Permit2 (9,152 bytes) and Multicall3 (3,808 bytes) are deployed at their canonical addresses.
- **Relay audits: Corrected.** The audits page lists four reports:

  | Auditor | Date | Scope |
  |---|---|---|
  | Spearbit | Feb 2025 | Relay Depository (EVM). The file is a Cantina re-review of the `relay-vaults` repo. |
  | Certora | Jun 2025 | Relay Depository (EVM), file "relay-escrow" |
  | Zellic | Nov 2025 | Settlement Protocol |
  | **Zellic** | **Apr 2026** | **Oracle** |

  - No Solana-depository audit and no Allocator audit is listed.
  - The page states the depository is "Non-upgradable" and has "No admin withdrawal". Its security "relies on the Allocator's signing authority".
  - Source: https://docs.relay.link/security/contract-audits
- **Relay API-leak incident: Confirmed, from secondary sources only.**
  - Odaily (2026-09-29): an API flaw leaked pending orders.
  - About 5,600 users were sandwiched, for about $136k of searcher profit and a median loss of about $11.88.
  - Relay plans about $312k of automatic compensation, and paid Outputlayer a $50k bounty.
  - No contract was exploited.
  - The dates 09-12 → 09-26 come from the YouMind repost (2026-09-28).
  - I found no post written by Relay itself.
  - Sources: https://www.odaily.news/en/newsflash/521108 ; https://youmind.com/landing/x-viral-articles/relay-sandwich-attack-compensation
- **SDK versions: Confirmed.** Latest on npm:

  | Package | Version | Published |
  |---|---|---|
  | `@relayprotocol/relay-sdk` | 8.0.4 | 2026-10-06 |
  | `@relayprotocol/relay-kit-ui` | 12.0.5 | 2026-10-06 |
  | `@lifi/sdk` | 4.11.0 | 2026-10-07 |

  These releases are only days old. Pin exact versions.

### What changes for the build

1. Ship **RH and BSC on day 1**, using the same Relay integration. Do not justify RH-first on current activity.
2. Fee display per bag must read the Pons `creatorTaxBps` (up to 10%) and the Flap tax. By default, exclude bags whose total tax exceeds about 5%.
3. Treat "no route" as a normal state: about 10% of fresh Pons tokens today. Grey these bags out at scan time using `/price`.
4. Get the Relay API key on D1. It is needed for any quote that sets a `referrer`, including the forced-refund QA trick, and the docs say quote/v2 requires it.
5. Scanner: plan on a paid Etherscan plan, because the RH free tier ends 2026-10-15. The alternative is to index factory logs over RPC.
6. Eligibility allowlist: add four.meme TokenManager V1 and OpenFour, and Flap VaultPortal. Add Flap's Base Portal if Base is in scope.
7. LI.FI is not a fallback for RH memecoins. The RH fallback remains KyberSwap → USDG, then Layerswap (via LI.FI) or NEAR 1Click.
