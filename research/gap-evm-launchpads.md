# EVM trench chains: approved launchpads, on-chain origin proofs, token safety and sell-route eligibility (as of 2026-10-08)

Scope: this file feeds the cross-chain intake requirement in the founder brief (UPDATE 2). Users sell bags in their own wallet on Robinhood Chain, BNB Chain, Base or Arc, and receive SOL in their own Solana wallet through a swap+bridge API. The file covers which tokens to accept on each chain, how to prove on-chain that a token was born on an approved launchpad, what the token templates can and cannot do, where liquidity lives after graduation, honeypot patterns, data providers, and an eligibility checklist written for TypeScript/viem. Bridge providers, fees and flows belong in `gap-crosschain.md`. One overlap: section 7 includes a routability probe (can the token be quoted RH→SOL right now?), because routability is part of eligibility.

Confidence tags on facts:
- **[V]**: verified on-chain by us on 2026-10-08 with `eth_call`, `eth_getLogs`, `eth_getCode` or receipts against the public RPCs: `rpc.mainnet.chain.robinhood.com`, `bsc-rpc.publicnode.com`, `base-rpc.publicnode.com` and `rpc.mainnet.arc.io`.
- **[P]**: primary source, meaning official docs or the project's GitHub.
- **[S]**: secondary source: Bitquery or Mobula integration docs, DefiLlama adapters, or the press.
- **[U]**: unverified or inferred.

---

## Summary

1. **Chain ranking (DefiLlama, pulled 2026-10-08).**
   - **30-day launchpad fees:** Solana $111.6M, **Robinhood Chain $94.9M**, **BNB Chain $42.9M**, **Arc $5.67M**, **Base $2.12M**, X Layer $0.20M, Monad $0.13M, HyperEVM ≈$5K.
   - **30-day DEX volume:** Solana $87.6B, **Robinhood $47.4B (#2 overall)**, Ethereum $44.1B, BSC $34.0B, Base $30.6B, HyperEVM $9.9B, Monad $3.2B, Arc $1.41B (Arc only launched on 2026-09-16).
   - **Launch-day intake chains:** Robinhood Chain and BSC. Base comes next: few new launches now, but the largest stock of 2025 bags (Clanker, Zora, Bankr).
   - **Arc** is hot and brand new (Argus launchpad: 179,299 tokens in about 3 weeks [V]), but almost all its tokens are tax-hook tokens.
   - **Not recommended for launch:** Monad (Phantom dropped it on 2026-08-26), X Layer, HyperEVM and Ethereum L1.

2. **Robinhood Chain (chain ID 4663) launchpad timeline.**
   - **Noxa** dominated launches from 2026-06-30 to 07-11 (about 60K tokens, flagship CASHCAT), then went dark [S].
   - **Pons V1** ran from 07-13 to 08-12. Its last launch on both V1 factories was 2026-08-12 [V].
   - **Pons V2** (bonding curve → Uniswap v4 with a Pons hook) now dominates: **$86.5M of the chain's $94.9M 30-day launchpad fees** [S, DefiLlama].
   - **Doppler-based stock-paired launchers** (Long.xyz, Bankr and other front-ends): 189,413 Doppler launches by 2026-09-30, of which 97,058 were Bankr's [S, DefiLlama adapter].
   - **Pools.trade** (Uniswap Labs, hookless v4, live since 2026-07-08, public on 08-05).
   - **Long tail:** Flap, LetsCash, o1, Bags, Clanker, Virtuals, StonkBrokers, Mosh (which bundles launches on top of Pons V2), and dozens of near-zero pads.

3. **Where the named tokens were born (all [V] via mint logs and the launchpads' registry calls):**
   - **PONS:** Pons legacy V1 factory, 2026-07-13.
   - **CASHCAT:** Noxa factory, 2026-06-18, before the public launch.
   - **BUN (Bundle Cat):** Pons V2, launched through a Mosh bundle contract and graduated in the same transaction.
   - **UBIK and AUR:** Pons V2, both paired with tokenized gold (GLD).
   - **Artificial Inu (AI) and BONER:** Long.xyz via the Doppler Airlock, quoted in tokenized NVDA and HIMS respectively.
   - **FRONG and POOLS:** Pools.trade.
   - **GOOSE and CHUMP:** custom EOA deploys with no launchpad. A launchpad-only rule rejects them.
   - **A second "UBIK" contract** (`0xe124…68Bd`, created 2026-10-06 by a vanity-clone deployer, owner is an EOA, $2.4M liquidity) was not born on Pons. Reject it, and never match tokens by name or symbol.

4. **No indexer needed for origin proofs.** Every major launchpad exposes an on-chain registry view that proves origin:

   | Launchpad | Registry check |
   |---|---|
   | Pons V2, Pons V1, Noxa | `getLaunchedToken(token).exists` |
   | Doppler | `Airlock.getAssetData(token)` |
   | Clanker v4 | `deploymentInfoForToken(token)` |
   | Zora | `getVersionForDeployedCoin(coin)` |
   | four.meme | `Helper3.getTokenInfo(token).tokenManager` |
   | Flap | `Portal.getTokenV7/V8Safe(token)` (reverts with `0xde6137d1` for unknown tokens) |
   | Argus | `Portal.launches(token)` |

   All are [V]. Pools.trade, Bags, LetsCash and o1 have no registry view that we found and need a small event index.

5. **Clones can be forged.** Never accept "is an EIP-1167 clone of a known template" as proof of origin. Anyone can clone `DopplerERC20V1`, the Flap or four.meme templates, or Zora's coin implementation, and initialize the clone themselves. Origin = factory registry or factory event, then template checks.

6. **"Tax" now mostly lives in v4 hooks, not in tokens.**
   - **Pons V2:** 1% hook fee plus a per-launch creator tax of 0–10%. Sampled: UBIK 1%, AUR 0.55%, BUN 0% [V].
   - **Argus:** 1–10% per side, immutable, plus a 1% pool fee and a snipe tax.
   - **Clanker:** static or dynamic fee hooks.
   - **Doppler and Zora:** dynamic-fee hooks (`fee = 0x800000`).
   - **Token-level taxes still exist** on Flap tax tokens (BSC, RH and others), four.meme's newer template, and Virtuals.

   A "no tax function in the token" check is therefore insufficient. The effective sell cost must be measured with a quote and a simulation.

7. **Liquidity after graduation, launchpad by launchpad.**
   - **Pons V2:** the full-range v4 position NFT sits permanently in `PonsV2LaunchLocker`, which has no withdraw path (BUN position #1534854) [V/P].
   - **Pons V1 and Noxa:** one-sided Uniswap v3 position NFTs sit in protocol lockers (PONS #109216, CASHCAT #100) [V]. The lockers are Ownable and we have not seen their source [U].
   - **Pools.trade:** v4 NFT held by a fee-splitter whose only liquidity functions are `collectFees` and `increaseLiquidity` [V].
   - **Doppler:** liquidity is held by `DopplerHookInitializer`, with a NoOp migrator and governance set to `0xdead` on every sampled RH launch [V].
   - **four.meme:** PancakeSwap V2 LP burned. 币安人生 has 99.998% of its LP at `0xdEaD` [V].
   - **Flap tax tokens:** PancakeSwap V2 LP 100% at `0xdEaD` (sampled) [V].
   - **Clanker v4:** LP in `ClankerLpLocker` [P].
   - **Argus:** a per-launch Locker with no withdrawal [P].

8. **Robinhood-specific risks.**
   - Honeypots appeared on day one: sell-blocking, drains and hidden-mapping balances. Relay blocks known malicious contracts [S].
   - Stock-paired memes quote in Robinhood Stock Tokens. These are beacon proxies with `pause()`, `isBlocked(address)`, issuer mint/burn and a split multiplier [V]. Their pools can decouple from the real stock over weekends: tokenized HIMS hit $132.64 against a $28.84 close while BONER held 53% of on-chain HIMS [S].

9. **Routability is the real gate.** LI.FI quote probe, RH→SOL in one transaction, 2026-10-08:
   - **Routed:** every graduated RH sample (CASHCAT, PONS-era, BUN, UBIK, BONER, AI, FRONG) through a local aggregator ("nordstern" or fly) plus Relay. A fresh Pons V2 curve token also routed.
   - **No route:** Flap-RH curve, Bags curve, o1, LetsCash, four.meme curve tokens, fresh Clanker v4 and Zora coins, and an Argus token.
   - **Graduated BSC/Base samples also routed:** 币安人生, CLANKER and BNKR, via nordstern or KyberSwap plus Mayan.

   Most "-80%" bags never graduated. Those need **direct curve-sell adapters** (four.meme `TokenManager2`, Flap Portal, Bags AMM, Pons V2 curve) before the bridge leg, or must be excluded.

10. **Data coverage on Robinhood Chain.**
    - **Covered:** Alchemy (RPC, Token API, Prices API), GoldRush (since 2026-07-08), Zerion (day one), Tatum, Bitquery, Mobula, Dune, Allium, Goldsky, DexScreener (`robinhood`), GeckoTerminal (`robinhood`), GoPlus (chain 4663 is in `supported_chains`), and Etherscan V2 (`chainid=4663`, robin.etherscan.io) [V/P].
    - **Not confirmed:** Moralis.
    - **Elsewhere:** Etherscan's API for BSC and Base requires a paid plan (Lite at $49/month) since late 2025 [S]. Arc's public RPC does not support `eth_simulateV1`, while RH and BSC public RPCs do [V].

11. **Wallets.** Phantom supports Robinhood Chain (since 2026-07-23), Arc (since 2026-09-16), Base and BNB Chain (since 2026-10-01). One Phantom wallet can therefore sign the EVM sell and receive the SOL [S].

    Much RH trading happens inside trading-app wallets. GMGN, fomo and Axiom earned $14.3M, $9.5M and $4.0M of RH fees in 30 days [S]. Bags held in those embedded wallets must be moved to a wallet the user can sign with first.

**Recommended launch allowlist:**
- **Robinhood Chain:** Pons V2, Pons V1 (both factories), Noxa, Doppler Airlock (any integrator, provided the token config is the NoOp-governance template), Pools.trade.
- **BSC:** four.meme (V1 and V2 managers) and Flap.
- **Base:** Clanker v0–v4, Zora v4 coins, Doppler (Bankr).
- **Arc (optional):** Argus with a tax cap.

Every token must then pass the template, liquidity and routability gates in section 8. **Exclude** Virtuals, custom deploys, unknown v4 hooks and non-canonical quote assets.

---

## 1. Chain prioritization

| Chain (ID) | DEX vol 30d / 24h | Launchpad fees 30d | Leading launchpads (30d fees) | Verdict |
|---|---|---|---|---|
| Robinhood Chain (4663) | $47.4B / $1.11B | $94.9M | Pons V2 $86.5M; Pons V1 $2.78M; Bankr $2.33M (Interface category); NOXA Fun $1.93M (pools still earning, no new launches); Pools $0.75M; o1 $0.63M; StonkBrokers Nightshades $0.50M; LetsCash $0.40M; Mosh $0.36M; Flap $0.35M; Virtuals $0.25M; Bags $0.06M; clanker $0.04M | **Tier 1** |
| BNB Chain (56) | $34.0B / $0.84B | $42.9M | Flap $37.1M; Genius.fun $3.78M; Binance Alpha $1.67M; four.meme $0.26M | **Tier 1**: Flap now, plus the four.meme bag stock from 2025 |
| Base (8453) | $30.6B / $1.19B | $2.12M (plus Bankr $1.0M in the Interface category) | o1 $1.08M; clanker $0.71M; BaseStonk $0.17M; Binance Alpha $0.09M; Umia $0.06M; ZORA Coins $9.3K; flaunch $6.6K | **Tier 1.5**: few new launches, large 2025 bag stock |
| Arc (5042) | $1.41B / $0.05B | $5.67M | Argus World $4.81M; FAZE $0.27M; Peach $0.17M; o1 $0.14M; LIFT V2 $0.08M | **Tier 2**: hot but brand new; tax-hook tokens |
| Monad (143) | $3.2B | $0.13M | Nad.fun V1 $0.13M | Tier 3 (Phantom dropped Monad on 2026-08-26) |
| X Layer (196) | $0.94B | $0.20M | Ignix $0.18M; Flap $17K | Tier 3 |
| HyperEVM (999) | $9.9B | ≈$5K | Alt Fun, LiquidLaunch ($721) | Not a trench venue |

Source for the whole table: DefiLlama `api.llama.fi/overview/fees` and `/overview/dexs`, `breakdown30d`, pulled 2026-10-08 [S]. Read fees as a proxy for trench activity: pad accounting differs, and Pons V2 fees include the hook fee and creator tax.

---

## 2. Robinhood Chain (4663): deep dive

### 2.1 Chain facts

- **Chain ID:** 4663 (`0x1237`) [V]. Arbitrum Orbit L2 (Nitro), ETH gas, blob data availability. Mainnet has been public since 2026-07-01; the earliest token (CASHCAT) was minted at block 88,836 on 2026-06-18 [V/S].
- **Sequencer and finality:** a centralized sequencer run by Robinhood, with no public mempool. Soft confirmation is instant; L1 finality takes about 13 minutes.
- **Blocks:** produced on demand, about 250 ms under load, with multi-minute idle gaps.
- **`block.number` quirk:** Solidity's `block.number` returns an L1 block estimate. This matters for the Noxa and Pons V1 restriction windows (see 2.4) [P: UniswapX playbook].
- **RPC.**
  - Public endpoint: `https://rpc.mainnet.chain.robinhood.com` [V]. It serves recent state only: a historical `eth_getCode` failed with "historical state … is not available". `eth_getLogs` is capped at a 10,000,000-block span and 10,000 results. `eth_simulateV1` is supported [V].
  - viem's built-in `robinhood` chain (exported since viem 2.55.0, 2026-07-08) also lists `rpc.ordofi.network` [V].
  - Managed providers: Alchemy, QuickNode, Chainstack, Dwellir, Blockdaemon, GetBlock, OrbitFlare, Tatum [S].
- **Explorers.**
  - Blockscout at `robinhoodchain.blockscout.com`. Its API answered our server with a Cloudflare challenge [V].
  - Etherscan at `robin.etherscan.io`, also reachable through the Etherscan V2 API with `chainid=4663` [V: chainlist].
- **Core contracts** [V: code present]:
  - WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
  - USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`: a UUPS proxy with `mint` and `upgradeTo` [V]
  - Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
  - Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`
- **Uniswap** [V/P]:
  - v3 factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
  - v3 NonfungiblePositionManager `0x73991a25c818bf1f1128deaab1492d45638de0d3`
  - SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`
  - QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`
  - UniversalRouter `0x8876789976decbfcbbbe364623c63652db8c0904`
  - v4 PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`
  - v4 PositionManager `0x58daec3116aae6d93017baaea7749052e8a04fa7`
  - PancakeSwap V3 factory on RH: `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` [S: Mobula Bow.fun page]
- **Other DEXes** by 30-day fees: Uniswap V4 $64.2M, Uniswap V3 $18.5M, Fables $4.9M, Uniswap V2 $2.7M, Ramses CL V2 $1.6M, up v3 $1.4M, GIGA V3, SushiSwap V3, Ramses DLMM, Alandale V3, SwapHood, RobinSwap [S, DefiLlama].
- **Aggregators and RFQ seen on RH:** KyberSwap, LI.FI, Definitive, Route, fly.trade, 1inch, 0x, Uniswap UniswapX, and Arcus RFQ for stock tokens (integrated in Robinhood Wallet on 2026-10-01) [S]. LI.FI quotes on RH used a local aggregator called "nordstern" [V: quote output].
- **Canonical L1↔L2 bridge (Arbitrum stack):**
  - L1 Gateway Router `0x6a2E3a1e16FC29f27Ce61429746D558d656975bB`
  - L2 Gateway Router `0x1E324B9316138CA9a73F960213621AD1aaf01B89`
  - Bridge `0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3`
  - Outbox `0xf0ce991ea4A0d2400A4AB49b20ae333f6Dce3DE9` [P]

  Fast routes to Solana are Relay, Across and LI.FI (Jumper) [S].
- **Wallets:** Robinhood Wallet, Phantom (since 2026-07-23), Backpack (since 2026-07-12), Zerion, Rainbow, MetaMask/Rabby via custom RPC [S]. Trading-app wallets: GMGN, fomo, Axiom, Maestro, copyfomo [S].
- **Stock tokens:** Robinhood Stock Tokens are listed by `GET https://api.robinhood.com/rhj/assets` [V: 194 assets, all with `chainId` 4663 deployments]. The API exposes `status`, `currentMultiplier` and `pendingMultiplier`; `/prices/{symbol}` adds `isTradingHalt`. Robinhood's docs warn: "a token with a matching name/ticker but a different contract address is not a Robinhood Stock Token" [P].

  Sampled tokens (NVDA `0xd0601CE1…`, HIMS `0xCceE82fE…`) are beacon proxies. The beacon is `0xe10b6f6b275de231345c20d14ab812db62151b00` and the implementation `0xb35490d6…`. The implementation exposes `pause()`, `unpause()`, `paused()`, `isBlocked(address)`, `mint`, `burn`, `hasRole` and `updateMultiplier` [V].

### 2.2 Launchpad history

| Period | Leader | Notes |
|---|---|---|
| 2026-06-30 → 07-11 | **Noxa** (fun.noxa.fi) | 65.8% of launches, about 60K tokens, CASHCAT [S: CoinGecko]. Paused on 07-11 and went dark on 07-13. Noxa factories also exist on MegaETH, Monad, Intuition, Stable, Merlin and Arc [P: Noxa docs]. |
| 07-13 → 08-12 | **Pons V1** (pons.family) | Took 37.2% of launches post-Noxa [S]. The last V1 `TokenLaunched` on both factories was on 2026-08-12 [V]. |
| from ~07-23 | **Pons V2** | Bonding curve, then a v4 pool with the Pons hook. On 2026-09-02, nearly 25,000 tokens and $5.95M of fees in one day [S]. 744 V2 launches in the last 400K blocks (≈13 h) [V]. The docs say public launches are currently closed to whitelisted launchers, checked with `canLaunch(address)` [P]. |
| from ~07-14 | **Doppler-based stock-paired launchers** (Long.xyz, Bankr and others) | 298 Airlock `Create` events in the last 300K blocks (≈10 h). Integrator mix: Long 29/60, unknown `0xae47…` 22/60, Bankr 5/60, others 4/60 [V]. |
| from 08-05 (contracts live 07-08) | **Pools.trade** (Uniswap Labs) | About half of launchpad volume on day one [S]; small now ($0.75M in 30 days). |

Dashboards: Dune "The Robinhood Trenches" by adam_tehc, and DefiLlama's Robinhood launchpad list (90+ pads, most near zero) [S].

### 2.3 Where the named tokens were born

| Token | Address | Created (UTC) | Creation tx → contract called | Launchpad / proof | Quote / pool | FDV (DexScreener, 10-08) |
|---|---|---|---|---|---|---|
| CASHCAT | `0x020bfC650A365f8BB26819deAAbF3E21291018b4` | 2026-06-18 | `0x0e6d23f0…` → `0xd9ec2db5…` | **Noxa**: `getLaunchedToken().exists=1`, position #100 held by the Noxa locker [V] | WETH, Uniswap v3 1% (`0xA70fc67C…`) | ≈$120M |
| PONS | `0x39dBED3a2bd333467115dE45665cC57F813C4571` | 2026-07-13 | `0x1f54f25f…` → `0x0c37a24f…` | **Pons V1, legacy factory**: `exists=1`, position #109216 held by the legacy locker [V] | WETH, Uniswap v3 1% (`0x10CC6BD3…`) | ≈$259M |
| AI (Artificial Inu) | `0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18` | 2026-07-14 | `0x7632524c…` → LongLauncher `0x22e99278…` | **Long.xyz / Doppler**: Airlock asset data, integrator `0x92d4…f765` [V] | NVDA numeraire, v4 with the Doppler hook | ≈$105M |
| POOLS | `0x385b36Ff682Ab4C76E7c37A66b96aABC466471d5` | 2026-07-30 | `0xfbe305aa…` → pools entry `0x00004c4c…` | **Pools.trade** (UERC20 factory event plus a mint to the entry contract) [V] | ETH, hookless v4 | ≈$0.74M |
| FRONG | `0x6245e67affA44a23077f0Ea7f981a8DC743a0c47` | 2026-07-30 | `0xbe6b90c5…` → `0x00004c4c…` | **Pools.trade**; LP NFT #409801 held by fee-splitter `0x7198c32a…` [V] | ETH, hookless v4 0.25% | ≈$3.2M |
| CHUMP | `0x0E0d2C89a5a019FE1cF762e5e33187631DACC21B` | 2026-07-31 | contract creation by EOA `0x5bad…` | **None, custom deploy**; `owner()=0x0` [V] | WETH, v3 | ≈$27M |
| BONER | `0x98096d17e191B3dA1d5f99a6D7b3584351b11E18` | 2026-08-20 | `0x0de235b4…` → LongLauncher | **Long.xyz / Doppler**, integrator `0x92d4…` [V] | HIMS numeraire, v4 with the Doppler hook | ≈$66M |
| GOOSE | `0x348cC963411FB82CD6e0B64345714fEC94F242CB` | 2026-08-26 | contract creation by EOA `0xcdca…` | **None, custom deploy** [V] | ETH, v4 | ≈$4.8M |
| UBIK | `0x812486EAea648819853F8E372dc9f1516C7868Bd` | 2026-09-01 | `0x6710677f…` → Pons V2 factory (`launchToken` with snipe exemptions) | **Pons V2**: `exists=1`, phase=PoolCreated, creator tax 100 bps [V] | GLD (`0xC9a981FE…`) | ≈$7.7M |
| BUN (Bundle Cat) | `0x07EBB29a38Fbcb41563817e5E19f2ceC619C90D2` | 2026-09-02 | `0x3e9dcd19…` → `0x5d2f0d7d…` (Mosh bundle) | **Pons V2** (launched and graduated in one tx); LP NFT #1534854 held by the Pons V2 locker [V] | ETH | ≈$67M |
| AUR (Aurum) | `0xB0788f5F65a9F4C0D8a634C45C391234F46221ab` | 2026-09-23 | `0xff8214a7…` → router `0xdbf28992…` | **Pons V2**: `exists=1`, creator tax 55 bps [V] | GLD | ≈$1.3M |
| "UBIK" (second) | `0xe1243842E091f073841Fc1Ac9527eA7E64F168Bd` | 2026-10-06 | `0xd3bf5b93…` → clone deployer `0x30e0bbe4…` | **None**: EIP-1167 clone with `owner()`=EOA `0x3f5d…`. It minted exactly the original UBIK's current supply (999,977,831.61) to that EOA [V] | SUSD/USDG pools, $2.4M liquidity, $17.4M 24h volume | ≈$8.0M |

Takeaways:
- Origin must be checked through the registry or the creation transaction. A third-party router can be the `to` of the creation transaction (BUN via Mosh, AUR via a router), so `tx.to == factory` is not a valid test.
- Two of the ten largest RH memes (GOOSE, CHUMP) fail a launchpad-only rule. Consider a small, manually curated allowlist of custom tokens: verified source, renounced owner, plain ERC-20 [U, product decision].

### 2.4 Launchpad-by-launchpad: verification, template, liquidity

#### Pons V2: Tier 1, dominant
- **Contracts** [V code; P: docs.ponsfamily.com/v2 and GitHub ponsdotdev/pons-labs]:

  | Contract | Address |
  |---|---|
  | `PonsV2LaunchFactory` | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
  | MemeHook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
  | LaunchLocker | `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952` |
  | LaunchDeployer | `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42` |
  | GraduationExecutor | `0xC7819B64A1dAECD7eC19856d026cb14EfBd89046` |
  | FeeEscrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
  | BuybackVault | `0x42df2a798f82289E177311362e8f5ccC45c1219c` |
  | LaunchAndBuy router | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` |

- **Origin proof:**
  - `getLaunchedToken(address)` returns a tuple of `token, curve, deployer, creatorFeeRecipient, pairToken, graduationThreshold, poolFee, tickSpacing, creatorTaxBps, buybackEnabled, phase, sweptQuote, sweptTokens, sweptAt, exists`. Require `exists == true && record.token == token` [V: works for UBIK, BUN and AUR; all zeros for CASHCAT].
  - Event `TokenLaunched(address,address,address,address,uint256,uint256)`, topic0 `0x8d4aad49…a89607`, with token, curve and deployer indexed [V/S].
  - Graduation: `PoolGraduated` topic0 `0x0a44ef75…` [S]. Hook `PoolRegistered` topic0 `0x01bf263a…` [S].
- **Template:** `PonsV2LauncherToken` = OpenZeppelin ERC20 + ERC20Burnable. The full supply (1,000,000,000, 18 decimals) is minted to the curve. No owner, mint, blacklist or tax; `deployer` is metadata only [P, source read; V: 3,248-byte runtime, `burnFrom` present, no owner]. `launchFactory()` and `curve()` are immutable getters.
- **Fees** [V via `getLaunchFeePolicy`]:
  - Curve: base `curveFeeBps` plus `creatorTaxBps` (protocol caps: curve fee 10%, creator tax 10%, total 20%).
  - After graduation, the hook's `afterSwap` takes `hookFeeBps` plus `creatorTaxBps` on the unspecified currency [P: hook source]. Live policy: `hookFeeBps=100`, `protocolFeeShareBps=3000`, `buybackBurnBps=5000`, `maxInternalPriceImpactBps=300`.
  - Snipe tax on buys: 99%, decaying to 0 within seconds [P/S].
- **Liquidity:**
  - Graduation is two-phase: `graduate` (permissionless), then `createGraduatedPool` (retryable).
  - The v4 pool has `fee=0`, `tickSpacing=200`, `hooks=MemeHook`, and one full-range position NFT moved to `PonsV2LaunchLocker`. The locker has no `collectFees`, no withdraw and no arbitrary call [P; V: BUN position #1534854 owned by the locker].
  - Threshold: 4.2 ETH for ETH-quoted launches. Other quote assets have their own thresholds (GLD-quoted: 24.94 GLD) [V].
  - Edge case: sells on the curve close once `readyToGraduate()` is true and before `graduated` flips [P]. Such a token is temporarily unsellable.
- **Quote assets:** ETH, USDG, cbBTC, and many Robinhood Stock Tokens (AAPL, NVDA, HIMS, GLD, TSLA, SPCX…). The list is owner-mutable; read it from the factory [S: Bitquery].
- **Mosh** (mosh.trade) launches on Pons V2 through "PonsSwarm" bundles (legacy swarm `0x7bdb0b02…`), so Mosh tokens pass the Pons V2 registry check [S/V].

#### Pons V1, both factories: Tier 1 (legacy bags)
- **Factories** [V/P]:
  - Legacy `0x0c37a24F5D23A486FA692d1500881d698B1F77a4` (start block 8,600,612), locker `0x31ca5E101941A93A7DD6d0497928700625CF54B5`.
  - Active `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` (start block 8,991,118), locker `0x736D76699C26D0d966744cAe304C000d471f7F35`.
  - Both are owned by `0x263ed295…`, which is also the Pons protocol fee recipient [V]. No new launches since 2026-08-12 [V].
- **Origin proof:** `getLaunchedToken(address)` returns a tuple of `token, deployer, pairedToken, positionManager, positionId, dexId, launchConfigId, restrictionsEndBlock, supply, isToken0, poolFee, exists, initialBuyAmount` [V: PONS on the legacy factory]. Events: `TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)`, topic0 `0xdb51ea9a…c4235a`, and `TokenDeployed(address,address,address,address,uint256,uint256)`, topic0 `0x14613701…c62a` [V: seen in receipts].
- **Template:** `PonsLauncherToken`, fixed 1B supply minted to the factory. No owner or mint.
  - During `restrictionBlocks`, buys out of the pair pool are throttled (no same-block buy, max wallet about 5%, max transaction about 5.5%). Sells and transfers are never restricted [P: source read].
  - `restrictionEndBlock` is in Arbitrum `block.number` units (L1 estimate). The values observed are ≈25.3–25.5M, already in the past [V].
- **Liquidity:** at launch, the full supply goes one-sided into a Uniswap v3 1% pool (tick range from about −887200 to 204200). The position NFT goes to the locker in the same transaction [V].
  - "Graduation" is just a WETH threshold, with no migration. The default is 4.2 ETH of paired WETH in the locked position [P].
  - LP fees are split creator/protocol 70/30 on the active factory and 90/10 on the legacy one. 80% of protocol revenue buys PONS for burning [P].
  - The lockers are Ownable contracts whose source we have not reviewed [U]. Sells use plain v3 pools and route on aggregators [V: LI.FI].

#### Noxa: Tier 1 (legacy bags, launchpad dead)
- **Contracts:** factory `0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB`, locker `0x7F03effbd7ceB22A3f80Dd468f67eF27826acD85`. Both are owned by `0x7e035fb0…` (dev.noxa.eth) [V/P: docs.noxa.fi].
- **Same ABI and events as Pons V1:** `getLaunchedToken(CASHCAT)` returns `exists=1`, `positionId=100`, `poolFee=10000` [V]. Pons V1 appears to be a fork of the Noxa factory (identical event signatures and `launchFee`=0.0005 ETH) [V; relationship U].
- No launches after about July 11. Our scan found no Noxa `TokenLaunched` after block ~7.3M [V, partial because windows hit the 10k-log cap]. Pools still earn $21K/day in fees [S].
- Fee controversy: exposed.fun alleges Noxa redirected creator fees, and Noxa claims it gave fees to creators. This does not affect sellability [S/U].

#### Doppler Airlock (Long.xyz, Bankr, other front-ends): Tier 1
- **Doppler's official address list for chain 4663** [P: docs.doppler.lol/resources/contract-addresses; V code]:

  | Contract | Address |
  |---|---|
  | Airlock | `0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862` |
  | `DopplerERC20V1` (implementation) | `0x3be8b97fd0e713b5abe0649fa830223b6b4bc599` |
  | `DopplerERC20V1Factory` | `0x1b37d3a72082029c44b35b604ea473617580b69a` |
  | `DopplerHookInitializer` | `0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544` |
  | `NoOpMigrator` | `0xba2f330edb16cd8056f5988d8ce19bbc63475a0e` |
  | `NoOpGovernanceFactory` | `0x85f37f74ef2478a770318bc810177a9835911ad7` |
  | `StreamableFeesLockerV2` | `0x7b6147ac3f615bdb764e7ebd5f517dac1ad163b8` |
  | `RehypeDopplerHookInitializer` | `0x5f9eb5f6726fe88d5e39867967f5b833d2fa3215` |

  LongLauncher is `0x22e99278308b393ea1260859b181ad7e78f5eeed`; it emits `LaunchCreated`, topic0 `0xadc6f1f7…39267b` [V].
- **Origin proof:** `Airlock.getAssetData(token)` returns `numeraire, timelock, governance, liquidityMigrator, poolInitializer, pool, migrationPool, numTokensToSell, totalSupply, integrator`. Require `poolInitializer != 0` [V]. The Airlock event is `Create(address,address,address,address)`, topic0 `0x68ff1cfc…2679ab` [V].

  Integrators observed:
  - Long.xyz: `0x92d435c96e63c43e12d6d0ab28f6b0b04072f765`
  - Bankr: `0xF60633D02690e2A15A54AB919925F3d038Df163e` (Bankr tokens are vanity-mined to end in `ba3` [S])
  - Unknown: `0xae478d76…`, `0xc2297533…`, `0xd8a823e4…` [V]

  On every sampled launch: governance = timelock = `0xdead`, migrator = NoOp, initializer = `DopplerHookInitializer`, `vestedTotalAmount=0`, `numTokensToSell = totalSupply = 1B`, `migrationPool=0xdead…dead` [V].
- **Template:** `DopplerERC20V1` [P source; V], deployed as a 44-byte Solady-style clone.
  - Features: Ownable, ERC20Votes, Permit2 infinite allowance, optional vesting (premint capped at 80% of supply), optional time-limited max balance, `burn`, and owner-only `lockPool`, `unlockPool` and `updateTokenURI`. No mint after initialization.
  - The owner is the Airlock, which has no arbitrary-call path. Airlock only calls `lockPool(migrationPool)` at creation, and `unlockPool` plus `transferOwnership(timelock)` at migration [P].
  - Risk to check: if a Doppler token ever migrates to a non-dead timelock, that timelock could call `lockPool(mainPool)` and block sells into a pool. Require `owner ∈ {Airlock, 0xdead, 0x0}`.
- **Liquidity:** a v4 pool initialized with `fee=8388608` (dynamic fee flag) and `hooks=DopplerHookInitializer` [S/V]. The liquidity is owned by the initializer, not an NFT [V: no position NFT in the BONER creation transaction]. With the NoOp migrator, it stays in the hook. The effective fee is dynamic, so measure it with a quote. Long's fees reportedly feed AI reserves and buybacks, and creators are paid in stock tokens [S].
- **Stock-paired risk:** BONER's pool held 53% of on-chain HIMS during the 2026-08-30 squeeze [S]. When selling, the proceeds route token → stock token → USDG/ETH. Check the stock token's `paused()` and `isBlocked(user)`, and the API's `isTradingHalt`.

#### Pools.trade (Uniswap Labs): Tier 1
- **Contracts** [S: Bitquery; V code]:
  - Entry contracts `0x0000ffffbe8efe702c8703ae3477ff5de3d319c0` (current) and `0x00004c4ccc709ef590f7c81102c0689f0263d4e9` (original).
  - Token factory `UERC20Factory` `0x000000e200088d55c39a11f609e5f667729ad49b`, deployed at block 4,516,017 on 2026-07-08 [S].
  - Launchpads `0x23f8209572b4a1c2ad88a42749e830791fb027f1`, `0xad44d55e…` (tickSpacing 25), `0xce57498d…` and `0x60d73b21…` (tickSpacing 60).
  - CCA auction factory `0x000000001f26a0044baa66024e7b6599c61963f8`.
- **Origin proof:** there is no registry view.
  - Index `TokenCreated(address,(string,string,string,bytes))` (topic0 `0x4ef8284e…ddbf4`) from the UERC20Factory.
  - Then require that the first mint went to a pools.trade entry contract [V: FRONG and POOLS minted to `0x00004c4c…`], or that a pools.trade launchpad emitted `TokenLaunched(bytes32,address,address,(…))` (topic0 `0x3b3d2baf…`) for the token.
  - The UERC20Factory alone is not proof: it is Uniswap's generic token factory.
- **Template:** UERC20, fixed 1B supply, no owner or mint [V: 7,154-byte runtime, no owner].
- **Liquidity:** a hookless v4 pool, 0.25% fee, ETH quote. The LP NFT is moved to a fee-splitter whose only functions are `collectFees`, `increaseLiquidity` and `getSplits`, so it has no exit [V: FRONG position #409801 owned by `0x7198c32a…`]. Uniswap says the pool is protocol-held and the creator cannot remove it [P: blog].

#### Flap (Robinhood deployment): Tier 2 (tax-aware)
- **Contracts** [P: docs.flap.sh deployed-contract-addresses; V code]:
  - Portal (upgradeable proxy, v5.23.1) `0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09`
  - Standard token implementation `0x88882688a067FE97E11C2185b996286e53132222` (vanity suffix `8888`)
  - Tax Token V3 implementation `0x7777C8743C88B3aff3cf262135beF2c8b2e83333` (vanity suffix `7777`)
  - VaultPortal `0xe9F7AB7DE8FB8756acbB6a1cd13316a43308197B`
- **Activity:** 397 launches in 150K blocks (≈5 h) [V]. Despite that, 30-day fees are only $0.35M [S].
- **Origin proof:** `Portal.getTokenV8Safe(token)` (or `getTokenV7`) returns a struct whose first word is `status` (0 Invalid, 1 Tradable, 4 DEX, 5 Staged). Unknown tokens revert with `0xde6137d1…` [V].
- **Template:** clones owned by the Portal [V]. The Tax Token V3 implementation exposes `buyTaxRate`, `sellTaxRate`, `taxRate`, `taxExpirationTime`, `taxProcessor`, `dividendContract`, `antiFarmerDuration` and `liquidationThreshold`, plus `startMigration` and `finalizeMigration`. No tax setter was found among its selectors [V].
- Tax rates are chosen at launch (1/3/5/10% per the overview; V3 allows asymmetric buy and sell rates) and can carry a duration [P]. Graduation on RH: unverified. On BSC: 800M tokens sold or a reserve threshold, then Uniswap/PancakeSwap V3 (non-tax tokens) or V2-style (tax tokens) [P].
- LI.FI found no route for a Flap-RH curve token [V].

#### Bags (Robinhood deployment): Tier 3
- **Factories** [S: DefiLlama adapter; V code]:
  - V1 `0x46aD6f53A3C26C8027826e2104cF0595b7b24D40` (2026-07-10)
  - V2 `0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37` (proxy, 2026-07-12)
  - V3 `0xC4210279fB1e1dE24A87d6F5Cc597c9422Aef899` (proxy, 2026-09-04; 82 launches in ≈3M blocks [V])
- Each token has its own AMM, a BeaconProxy (V3 sample beacon `0x83206fc9…`).
- **Template:** Ownable ERC-20 (owner = its AMM) with a one-shot `mintInitialSupply`. A second mint reverts (`0x745bfc9f`) [V].
- Origin: index the factory's creation event (V3 topic0 `0x7abc1847…`) [V]. No registry view was found. 30-day fees $64K; no LI.FI route for curve tokens [V].

#### Clanker (Robinhood deployment): Tier 2
- **Contracts** [P: clanker-sdk `clankers.ts`; V]: factory `0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94` (block 4,570,632, 2026-07-08 [S]), locker `0x290F735F63824BB5836cDe24a35F5103A5B5Bc99`, fee hooks V2 `0x48B8F6AD…E8cc` (static) and `0x65efDF8C…E8Cc` (dynamic).
- **Origin proof:** `deploymentInfoForToken(token)` returns `(token, hook, locker)`.
- Template: 100B supply, no owner or mint (same as Base, see 4.2). Activity is tiny (6 launches in ≈4 days) [V].

#### LetsCash: Tier 2
- Factory proxy `0x5bd1Fbe78a78fe8236fa00CF48fbEBA74ae34661`; first launch at block 6,160,467 [S/V].
- v4 pools with hooks discovered from the factory. Clone tokens have no owner [V].
- Origin: the factory's launch events (no registry view found) [U]. No LI.FI route for the sampled token [V].

#### o1 Launchpad: Tier 2
- **RH suites** (factory/hook/escrow) [S: DefiLlama `o1-launchpad/config.ts`]:
  - `0x8b40fc20…bccf` / `0xe960…0a44`
  - `0x76f0923a…344a` / `0xca4b…aa44`
  - `0x411f2128…0ba5` / `0x441f…2acc`
  - `0xe64ac411…f297` / `0x778b…eacc`
  - v4-minimal `0xce9c48cfa068947f77738c81be406b53338e5b0d` / `0x0310…2acc`
- Event `Launched(address indexed token, bytes32 indexed poolId, address indexed creator, address quote, uint256 supply, int24 tickSpacing)`.
- Tokens are plain, with no owner [V]. Permanent single-sided v4 positions with a 1% fee split creator/o1/referrer [S]. No LI.FI route for the sampled token [V].

#### Virtuals (Robinhood deployment): EXCLUDE by default
- Factory proxy `0xd4ccbfa37e2f35611b3042e4096ad7a3459bd007` [S/V].
- Tokens clone AgentToken `0x581f7b99…`. Its selectors include `addBlacklistAddress`, `removeBlacklistAddress`, `setProjectTaxRates`, `setProjectTaxRecipient`, `withdrawERC20` and `withdrawETH`, and the owner is a non-dead address [V]. Owner-mutable taxes plus a blacklist make these honeypot-capable by design.

#### Long tail (not approved at launch)
- trench.today: proxy `0x77dc6f63…9d`, `TokenCreate` topic0 `0xe2eb7016…` [S]
- hood.fun: `0x5fcc1df0…452c`, no launches since mid-July [S]
- LaunchHood: `0x62b33a03…`, dead since mid-August [S]
- RobinFun `0xd861cb5d…`, RealFun `0xa3A71925…`, Bow.fun `0xc70e510e…` [S: Mobula]
- Klik `0x16cf6788…`, Ape.store `0x6e4910ea…` [S]
- StonkBrokers Safe Launch / Nightshades: game pads with snipe taxes [S]
- Bottom.fun, Printr, DYOR.fun, Hookers, PAIR, Coinbarrel, token.select, Sentry… (each under $50K of 30-day fees) [S]

### 2.5 Fake-LP and honeypot patterns on Robinhood Chain, with detection

| Pattern | Seen where | Detection |
|---|---|---|
| Sell-blocking or draining token contracts, including "hidden storage mapping" balances | Relay warning, 2026-07-09 ("World" token) [S] | Launchpad registry check (custom contracts are rejected), bytecode clone and template check, sell simulation |
| Copycat or "mirror" contracts with the same name and symbol (vanity suffixes copied) | Second UBIK `0xe124…68Bd` [V] | Never match on symbol; require origin via registry |
| Malicious v4 hooks (revert on sell, `beforeSwapReturnDelta` skim, dynamic fee up to 100%) | Generic v4 risk; RH has a thriving hook scene [S] | Only price and route through pools whose `PoolKey.hooks` is the launchpad's own hook (or zero for Pools.trade); decode the hook-address permission bits (section 8) |
| Fake quote asset (memecoin "paired with NVDA" where the NVDA is a look-alike) | Robinhood docs warning [P] | The quote must be WETH/ETH, USDG, or a contract listed by `api.robinhood.com/rhj/assets` |
| Stock-token side risks: pause, blocklist, multiplier change, weekend decoupling | Stock token implementation [V]; BONER/HIMS squeeze [S] | `paused()==false`, `isBlocked(user)==false`, `isTradingHalt==false`; quote-based valuation with a price-impact cap |
| Creator or protocol hook taxes | Pons V2 (≤10% creator tax + 1%), Flap tax tokens, Argus-style hooks | Read `getLaunchFeePolicy` and `creatorTaxBps` (Pons); cap the effective sell cost measured by simulation |
| Temporarily unsellable curve states | Pons V2 between `readyToGraduate` and `graduated` [P] | Check `phase` and `readyToGraduate()`; retry later |
| Pre-graduation tokens with no aggregator route | Flap-RH, Bags, LetsCash, o1 samples [V] | Per-launchpad curve-sell adapter, or mark "not convertible yet" |
| Value farming via self-launched tokens (launch for 0.0005 ETH, buy, "convert" for rewards) | Product risk [U] | Rewards on realized SOL only; exclude conversions where the user is the registry's `deployer`/creator or a top holder; minimum token age and holder count |

### 2.6 Robinhood Chain eligibility checklist (runtime)

1. `chainId === 4663`. Read the token: `totalSupply`, `decimals`, and code. Reject an EOA (code length 0).
2. **Origin (first match wins):**
   - **Pons V2:** `getLaunchedToken(t).exists`.
   - **Pons V1 legacy/active, and Noxa:** `getLaunchedToken(t).exists`.
   - **Doppler:** `Airlock.getAssetData(t).poolInitializer ∈ {DopplerHookInitializer, RehypeDopplerHookInitializer}`, `governance == timelock == 0xdead`, `liquidityMigrator == NoOpMigrator`.
   - **Pools.trade:** the token is in our index of UERC20Factory events, AND its first mint went to a pools.trade entry contract.
   - **Clanker RH:** `deploymentInfoForToken(t).token == t`.
   - **Optional Tier 2:** Flap `getTokenV8Safe(t).status ∈ {1, 4}` with tax ≤ cap; LetsCash or o1 event index.
3. **Template checks** (per launchpad):
   - Pons V2: no `owner()`.
   - Doppler: `owner() ∈ {Airlock, 0xdead, 0x0}`, `vestedTotalAmount() == 0` (or ≤ X%), `isPoolLocked` only against `0xdead…`.
   - Flap: `buyTaxRate`/`sellTaxRate` ≤ cap.
   - Pools, Noxa, Pons V1: no owner powers.
4. **Liquidity:**
   - Pons V2: `phase == PoolCreated (2)`, or curve tradable and `!readyToGraduate`.
   - Pons V1 and Noxa: `NPM.ownerOf(positionId) ∈ {locker}`.
   - Pools.trade: v4 `PoolKey.hooks == 0x0`.
   - Doppler: `PoolKey.hooks == DopplerHookInitializer`.
   - Quote asset canonical, as in 2.5.
5. **Stock-token quote** (Long, Pons V2 stock pairs): `paused() == false`, `isBlocked(user) == false`, API `status == ACTIVE`, `!isTradingHalt`.
6. **Route and simulation:** get a swap+bridge quote (for example LI.FI or Relay) for the user's full balance to SOL. Require a route, `priceImpact ≤ cap`, and `toAmountUSD ≥ minimum`. Simulate approve plus swap with `eth_simulateV1` from the user's address; it must succeed and the output must be within tolerance of the quote. The effective sell cost (fees, taxes, price impact) must be ≤ cap.
7. **Anti-farming:** `user ≠ deployer/creatorFeeRecipient`, token age ≥ N hours, holders ≥ M (via Bitquery, GoldRush or Zerion).

---

## 3. BNB Chain (56)

### 3.1 Facts
- **Market:** DEX volume $34.0B over 30 days. Trading apps on BSC (30-day fees): GMGN $11.5M, fomo $2.7M, Axiom $0.65M [S]. Phantom added BNB Chain on 2026-10-01 [S].
- **Core assets:** WBNB `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`, USDT `0x55d398326f99059fF775485246999027B3197955` [P: clanker-sdk constants]. PancakeSwap V2 router `0x10ED43C718714eb63d5aA57B78B54704E256024E`, V2 factory `0xca143ce32fe78f1f7019d7d551a6402fc5350c73` [V].
- **Public RPC limits:** BSC public RPCs cap `eth_getLogs` hard (publicnode allows ≤500 blocks with a topic filter; bsc-dataseed returns "limit exceeded"). `eth_simulateV1` works on publicnode [V].

### 3.2 Launchpads

#### Flap (flap.sh): Tier 1 (leader, 30-day fees $37.1M)
- **Contracts** [P; V]:
  - Portal (upgradeable, v5.23.1) `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`
  - Standard implementation `0x8b4329947e34b6d56d71a3385cac122bade7d78d` (`8888`)
  - Standard V3 implementation `0x88881b6f03090462a969eC7f48385744Eeb63333` (`8888`)
  - Tax Token V3 implementation `0x024f18294970B5c76c0691b87f138A0317156422` (`7777`)
  - VaultPortal `0x90497450f2a706f1951b5bdda52B4E5d16f34C06`
  - FlapTokenRegistry (proxy) `0x0000e9f9F5e469f0EEC27F192B4DdDE04D4c0000`
  - FlapTokenLocker `0x0000A8B6741441BB4Ba0DFE313a2bc7b2Cf10000`
  - Tax Token Helper `0x53841c73217735F37BC1775538b03b23feFD8346`
- **Origin proof:** `getTokenV8Safe(t)` or `getTokenV7(t)`. The sampled graduated token returned status 4 (DEX), tokenVersion 4 (TOKEN_TAXED), tax 300 bps, and its pool [V].
- **Migration:** at 800M sold, or a reserve threshold that depends on the deployment (30.1 BNB → 16 BNB → 8 ETH → 16 ETH or 10,000 USD1) [P].
  - Non-tax tokens go to Uniswap/PancakeSwap V3 or a fork, with a range from the initial curve price to 10,000× the last price. They fall back to V2 [P].
  - Tax tokens go to V2-style pools only [P].
  - Sampled tax token: PancakeSwap V2 pair, LP 100% at `0xdEaD` [V]. Who holds the non-tax V3 NFT is unverified [U].
- **Tax tokens:** buy and sell rates set at launch (V3 asymmetric), `taxDuration`, an anti-farmer window, auto-liquidation of collected tax with an adaptive threshold, dividends, and an integrator commission [P]. We found no setter in the RH V3 implementation's selectors [V].
- **Vanity suffixes:** `7777` (tax) and `8888` (standard). These are not proof of origin.

#### four.meme: Tier 1 (2025 bag stock; 30-day fees now only $0.26M)
- **Contracts** [S; V code]:
  - TokenManager V1 `0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC` (proxy)
  - TokenManager2 `0x5c952063c7fc8610FFDB798152D69F0B9550762b` (proxy)
  - TokenManagerHelper3 `0xF251F83e40a78868FcfA3FA4599Dad6494E46034`
- **Origin proof:** `Helper3.getTokenInfo(t)` returns `version, tokenManager, quote, lastPrice, tradingFeeRate, minTradingFee, launchTime, offers, maxOffers, funds, maxFunds, liquidityAdded`. Require `tokenManager ∈ {V1, TM2}` [V: 币安人生, FOURMEME and a fresh token all show TM2; unknown tokens return zeros].
  - Event `TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)`, topic0 `0x396d5e90…cad20`: 32 events in 500 blocks [V].
- **Templates:**
  - The 2025 template (e.g., 币安人生 `0x924fa68a…4444`, 3,822 bytes) shows `owner()=0x0` and `_mode()=0` after graduation [V].
  - The current template is clones of `0x7330d886…` (owner = TM2). It has fee/tax fields (`feeRateBuy`, `feeRateSell`, `feeToBurn`, `feeToFounder`, `feeToLiquidity`, `feeToHolder`), transfer modes (`MODE_NORMAL`, `MODE_TRANSFER_RESTRICTED`, `MODE_TRANSFER_CONTROLLED`) with an owner-only `setMode`, and `setMigratedPool`. Its vanity suffix is now `…ffff` [V].
  - Because TM2 is upgradeable, the four.meme team could in principle re-restrict transfers [U]. Require `_mode()==0` and `owner()==0x0` post-graduation where available, or require the token to still be on the curve.
- **Graduation:** PancakeSwap V2 since March 2025. LP is burned [S; V for 币安人生: 99.998% of LP at `0xdEaD`, `liquidityAdded=1`].
  - The threshold is per quote: FOURMEME `maxFunds` is 18 BNB. A stock-quoted launch (quote BNCB) had `maxFunds` of 1,838.2 BNCB [V].
- **Selling:** pre-graduation curve tokens had no LI.FI route (2 of 2 samples); the graduated 币安人生 routed [V]. A TM2 `sellToken` adapter is needed for curve bags.

#### Others on BSC
- **Genius.fun:** launched 2026-09-17; stock-paired; graduates at 15 BNB to PancakeSwap; vanity suffix `6666`; 30-day fees $3.78M [S]. Contracts not verified by us → Tier 2 pending.
- **Binance Alpha:** DefiLlama "Launchpad", $1.67M on BSC. It is Binance Wallet's TGE/listing platform, not a permissionless meme pad. Separate decision; exclude by default [S/U].
- **Clanker v4 BSC:** factory `0xea30438E0B5f99096cb05A8Da63be55A6A298F6a`, locker `0x1166022e1becc70E7E9aB2250aF1aC7842B9B420` [P/V].
- **o1 BSC:** factory `0xee3e862efde6dcd6df5648af0e2731b9d1df4605`, hook `0xf011…2acc` (since 2026-09-16) [S/V].

### 3.3 BSC patterns
- Classic V2 honeypots and tax tokens (blacklists, max transaction, trading toggles).
- Flap and four.meme "tax tokens", with taxes up to 10% plus commissions.
- four.meme transfer modes.
- Fake vanity suffixes (`4444`, `7777`, `8888`, `6666`).
- Stock-quoted launches whose quote is a thin tokenized equity (e.g., BNCB) [V].

Detection: registry origin, template-specific fee and mode reads, LP-burn check (`pair.balanceOf(0xdEaD)/totalSupply ≥ 99%`), simulation, and GoPlus `token_security` (chain 56) or honeypot.is as a second opinion.

### 3.4 BSC checklist
1. **Origin:** four.meme `Helper3.getTokenInfo(t).tokenManager ∈ {TM1, TM2}`, or Flap `getTokenV8Safe(t)` succeeds with `status ∈ {1, 4}`, or Clanker BSC `deploymentInfoForToken`.
2. **four.meme template:** graduated → `liquidityAdded`, pair LP ≥ 99% burned, `owner()==0x0 && _mode()==0` (newer template: also `feeRateSell` ≤ cap). Curve → `sellToken` adapter available.
3. **Flap template:** `sellTaxRate` ≤ cap; if graduated, pool LP burned (V2) or V3 position owner known [U].
4. Quote asset ∈ {WBNB, USDT, USDC, USD1, plus four.meme/Flap registered quotes valued via route}.
5. Route plus simulation gate as on RH.

---

## 4. Base (8453)

### 4.1 Facts
- **Market:** DEX volume $30.6B over 30 days. Launch activity is low now ($2.1M of 30-day launchpad fees), but holders carry a large 2025 inventory of Clanker, Zora and Bankr bags.
- **Uniswap v4 PoolManager:** `0x498581fF718922c3f8e6A244956aF099B2652b2b` [V code].
- **Etherscan API:** requires a paid plan on Base since late 2025. Blockscout Base has a free tier [S].

### 4.2 Launchpads

#### Clanker (v0–v4): Tier 1
- **Factories** [P: clanker-sdk; V code]:

  | Version | Factory | LP locker |
  |---|---|---|
  | v0 | `0x250c9FB2b411B48273f69879007803790A6AeA47` | n/a |
  | v1 | `0x9B84fcE5Dcd9a38d2D01d5D72373F6b6b067c3e1` | n/a |
  | v2 | `0x732560fa1d1A76350b1A500155BA978031B53833` | `0x618A9840691334eE8d24445a4AdA4284Bf42417D` |
  | v3 | `0x375C15db32D28cEcdcAB5C03Ab889bf15cbD2c5E` | `0x5eC4f99F342038c67a312a166Ff56e6D70383D86` |
  | v3.1 | `0x2A787b2362021cC3eEa3C24C4748a6cD5B687382` | `0x33e2Eda238edcF470309b8c6D228986A1204c8f9` |
  | **v4** | `0xE85A59c628F7d27878ACeB4bf3b35733630083a9` | `0xffA37784D619F228D8B379d287a4D7282e500762` |

  v4 extras: feeLocker `0xF3622742b1E446D92e45E22923Ef11C2fcD55D68`; hooks `0xDd5EeaFf…68CC` (static), `0xb429d62f…28CC` (static V2), `0x34a45c6B…E8cC` (dynamic), `0xd60D6B21…68Cc` (dynamic V2); MEV modules `0xFdc013ce…`, `0xebB25BB7…`.
- **Origin proof (v4):** `deploymentInfoForToken(t)` returns `(token, hook, locker)`. A live sample returned `hook=0xb429…28cc` and `locker=0xffA3…0762`; WETH returned zeros [V].
  - v4 `TokenCreated` topic0 is `0x9299d1d1…fb67`, with the token in topic1 [V]. About 10 launches per 3,000 blocks (≈100 min) [V].
  - Older versions: use the TokenCreated event index (v3.1 likely also has `deploymentInfoForToken` [U]).
- **Template (v4):** 100B supply, 18 decimals, no `owner()` or mint. `admin` can update image and metadata and hand over admin. ERC20Votes and Permit [V selectors].
  - It also has `crosschainMint`/`crosschainBurn` (SuperchainERC20, gated to the Superchain token bridge, which is supply-conserving) [V selectors; gating P].
  - Names can contain zero-width or soft-hyphen characters (the sample's name was `U` + U+00AD soft hyphen + `ADD…`), so normalize names in the UI [V].
- **Liquidity:** the LP is locked in ClankerLpLocker. Fees flow through the static or dynamic fee hooks to the feeLocker. Clanker adds 20% of the creator fee as a protocol fee (e.g., 1% + 0.2%) [P/S].

#### Zora coins: Tier 1.5 (large 2025 stock; 30-day fees now $9.3K)
- **ZoraFactory:** proxy `0x777777751622c0d3258f214F9DF38E35BF45baF3` (implementation `0xbbae128a…`) [V].
  - Functions: `deploy`, `deployCreatorCoin`, `deployTrendCoin`, `getVersionForDeployedCoin(address)`, `zoraHookRegistry`, `contentCoinHook`, `creatorCoinHook` [V].
  - `CoinCreatedV4` topic0 `0x74b670d6…15781`: about 128 events per 1,500 blocks [V].
- **Origin proof:** `getVersionForDeployedCoin(coin) > 0` (a fresh coin returned 4; WETH returned 0) [V]. Pre-v4 coins (Uniswap v3 era) may return 0; for those, use the factory's historical `CoinCreated` index [U].
- **Template:** clone of `0x2c800c1c…`, 1B supply [V].
  - Multi-owner. Owners can `setNameAndSymbol`, `setContractURI` and `setPayoutRecipient`, and can `migrateLiquidity` to registered hooks.
  - Creator coins vest (`claimVesting`, `vestingStartTime`, `vestingEndTime`).
  - No mint selector found [V].
  - Doppler-integrated (`airlock()`, `dopplerFeeRecipient()`).
- **Pools:** v4 with `fee=0x800000`, `tickSpacing=200`, a Zora hook, quoted in ZORA (`0x1111111111166b7FE7bd91427724B487980aFc69`) or the creator coin [V].
- Rename risk: display the address and freeze the name at intake. A fresh coin had no LI.FI route [V].

#### Doppler on Base (Bankr and others): Tier 1.5
- Airlock `0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12`, DopplerERC20V1 `0xdb7b520bb5c3a2c5d4871198081911359f93be87`, NoOpMigrator `0x6ddfed58d238ca3195e49d8ac3d4cea6386e5c33`, NoOpGovernanceFactory `0xe7dfbd5b0a2c3b4464653a9becdc489229ef090e` [P; V Airlock code].
- Bankr launches on Base through Clanker v4 and Doppler Rehype hooks. Bankr's fee wallet `0xF60633D0…` is also the beneficiary on RH [S].
- 2025-era Doppler tokens (older DERC20) may carry owner-gated inflationary mint after migration. This is unverified per token: require `owner ∈ {0x0, 0xdead}` or read the mint-rate parameters [U].

#### Other Base pads
- **o1 Launchpad:** 6 suites. The latest v4-minimal is factory `0x1176122eb77ad6a2339322cda7c4d7ea9bfa63dc`, hook `0x1f91…2acc`. Permanent single-sided v4, 1% fee [S/V].
- **Flaunch:** PositionManager `0x51Bba15255406Cfe7099a42183302640ba7dAFDC` [S/V]. Fading (30-day fees $6.6K). Tier 3, verification method unverified [U].
- **Flap Base:** Portal `0x0000BC1c4fD15Dd79029AF8F5d77D68ae4490000` (tax V3 only) [P/V].
- **Virtuals on Base:** AgentToken template with owner-settable tax and blacklist (as on RH). **Exclude** [V on RH clone].
- BaseStonk, Umia, Ape.Store, Printr: small; not verified [S].

### 4.3 Base checklist
1. **Origin:** Clanker `deploymentInfoForToken` (v4) or the event index (v0–v3.1); Zora `getVersionForDeployedCoin > 0` (or the v3-era index); Doppler `getAssetData`; o1 event index.
2. **Template:** Clanker: no owner, supply 100B. Zora: owners exist, so flag a rename since intake and use the canonical v4 PoolKey. Doppler: `owner ∈ {Airlock, 0xdead, 0x0}`.
3. **Liquidity:** Clanker locker; Zora hook pools; v4 hook ∈ the allowlist.
4. Quote ∈ {ETH/WETH, USDC, ZORA, cbBTC, or a creator coin valued via route}.
5. Route plus simulation.

---

## 5. Arc (5042): Circle's chain, mainnet since 2026-09-16

### 5.1 Facts
- **Chain ID:** 5042 (`0x13b2`) [V]. Native gas is USDC (the ERC-20 interface is `0x3600000000000000000000000000000000000000`) [P/V]. Permissioned validators (Circle plus institutions) [S].
- **Day one:** $410.8M of DEX volume, 82% of it from launchpads. Arguspad handled $202M and 83,751 of 97,025 new tokens [S: BeInCrypto].
- **RPC:**
  - `rpc.mainnet.arc.io`, plus Blockdaemon, dRPC and QuickNode mirrors.
  - Explorer `explorer.arc.io` (Blockscout API v2) [P: viem `arc` chain].
  - The public RPC rejects `eth_simulateV1` and wide `eth_getLogs` ranges (20K blocks is "too large") [V].
- **Uniswap v4 PoolManager:** `0x8366a39CC670B4001A1121B8F6A443A643e40951`, the same address as on RH [V code].
- Phantom supports Arc from day one; LI.FI lists Arc [S/V].

### 5.2 Argus World (arguspad): Tier 2
- **Portal v7:** `0xB021Be536808f551b31789422Fd28a6c9c6e97Da`. Non-proxy; admin `0xf5a0…eeeb` with a 4 h timelock on pointer and hook-code changes [V].
  - Live parameters: `tokenCount()=179,299`, `MAX_TAX_BPS=1000`, `POOL_FEE=10000` (1%), `TICK_SPACING=200`, `treasuryBps=1000`, default quote = USDC [V].
- **Origin proof:** `launches(token)` returns a non-zero record whose fields include the creator, the per-launch hook, splitter and locker, and the quote. USDC returns zeros [V]. `getTokens(offset, limit)` enumerates all launches [V].
- **Template:** clone of `0x1b74922c…`, 1B supply. No mint, pause or blacklist selectors; `owner()` returns the creator (view only) [V; README P].
- **Hook:** per-launch, exposing `buyTaxBps()`, `sellTaxBps()`, `currentSnipeTaxBps()` and `totalFeeBps()`, with no setters [V]. Tax is 1–10% per side, immutable, plus the 1% pool fee [P].
- **Liquidity:** the full supply sits in one v4 position held by a per-launch Locker with no withdrawal; `harvestFees()` is permissionless [P].
- **Routability:** the sampled token had no LI.FI route [V].

### 5.3 Other Arc pads
- o1 Arc: factory `0xee3e862e…f4605`, hook `0x20ee…6acc` [S/V].
- Noxa Arc factory `0xE7d4E64079FE467A21801B36Ccc6D9B3F66BD372` [P/V].
- FAZE, Peach Launchpad, LIFT V2, Foci [S, unverified].

### 5.4 Arc checklist
Argus `launches(t)` non-zero; tax `sellTaxBps + POOL_FEE` ≤ cap; route and quote required. Simulation needs a provider other than the public RPC (Tenderly, Alchemy, or our own node) [U].

---

## 6. Other chains (not for launch)

- **Monad (143):**
  - Nad.fun V1 curve `0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE` [V code]; V2 curve `0x9f3832732923252A21044F21eE6bd87F09514ae4`, factory `0xA25b13127e63ddae6d0b35570FF3D39dBD621001` [S].
  - Also present: Flap Portal `0x30e8ee7b…68b23`, Clanker v4 `0xF9a0C289…`, o1 [V].
  - Phantom dropped Monad on 2026-08-26; launchpad fees are $127K over 30 days [S].
- **X Layer (196):** Ignix ($177K), Flap Portal `0xb30D8c42…`, o1 factory `0x17d9218f…` [S].
- **HyperEVM (999):** LiquidLaunch `0xDEC3540f5BA6f2aa3764583A9c29501FeB020030` ($721 over 30 days) [S].
- **Ethereum:** Clanker v4 `0x6C8599779B03B00AAaE63C6378830919Abb75473` and Doppler; not a trench venue at current gas and activity [S].

---

## 7. Routability probe (LI.FI `GET /v1/quote`, token → SOL, 2026-10-08)

| Chain | Token (launchpad / state) | Result | Path |
|---|---|---|---|
| RH | BUN (Pons V2, graduated, v4 hook) | Route | nordstern swap → Relay |
| RH | CASHCAT (Noxa, v3 1%) | Route | nordstern → Relay |
| RH | BONER (Doppler hook, HIMS) | Route | nordstern → Relay |
| RH | AI (Doppler hook, NVDA) | Route | nordstern → Relay |
| RH | UBIK (Pons V2, GLD) | Route | nordstern → Relay |
| RH | FRONG (Pools.trade, hookless v4) | Route | fly or nordstern → Relay |
| RH | Fresh Pons V2 token on curve | Route (price data missing) | nordstern → Relay |
| RH | Flap token on curve; Bags V3 curve; o1 v4; LetsCash v4 | **No route** | — |
| BSC | 币安人生 (four.meme, graduated, V2) | Route | nordstern → Mayan |
| BSC | Flap tax token (graduated, V2, 3% tax) | Route (≈5% haircut) | 1inch → Relay |
| BSC | four.meme curve tokens (2 samples) | **No route** | — |
| Base | CLANKER (v3), BNKR | Route | KyberSwap/nordstern → Mayan |
| Base | Fresh Clanker v4 token; fresh Zora coin | **No route** | — |
| Arc | Argus token | **No route** | — |

The quotes ran one transaction on the source chain (fill time of about 1 s) through LI.FI's `relaydepository` (Relay) or `mayan` bridges [V]. LI.FI chain list: Robinhood (id 4663, key `out`), Arc 5042, BSC, Base, Monad, X Layer, HyperEVM, Solana [V].

Implication: the converter must treat "has a live route from the swap+bridge API" as part of eligibility. Bags still on a bonding curve need direct curve sells (proceeds in ETH or BNB), then the bridge leg, or they stay ineligible.

---

## 8. Implementation: TypeScript/viem eligibility module

Use viem ≥ 2.55.0, which exports `robinhood` (4663). `arc` (5042) has been exported since 2.49.3, but check that the definition points at mainnet RPCs. Pin an exact version that is at least two weeks old; otherwise `defineChain` the two chains [V: npm and unpkg].

```ts
// Sketch: typed loosely on purpose; tighten client types per chain in production.
import {
  createPublicClient, http, parseAbi, toFunctionSelector,
  type Address, type PublicClient, zeroAddress,
} from 'viem'
import { robinhood, arc, bsc, base } from 'viem/chains'

export const clients: Record<number, PublicClient> = {
  4663: createPublicClient({ chain: robinhood, transport: http(process.env.RH_RPC) }),   // Alchemy or QuickNode for archive data
  56:   createPublicClient({ chain: bsc,       transport: http(process.env.BSC_RPC) }),
  8453: createPublicClient({ chain: base,      transport: http(process.env.BASE_RPC) }),
  5042: createPublicClient({ chain: arc,       transport: http(process.env.ARC_RPC) }),
}

const DEAD = '0x000000000000000000000000000000000000dEaD' as const

// ---------- Registries (all verified on-chain 2026-10-08) ----------
export const RH = {
  PONS_V2_FACTORY: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  PONS_V2_HOOK:    '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
  PONS_V2_LOCKER:  '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952',
  PONS_V1_FACTORIES: ['0x0c37a24F5D23A486FA692d1500881d698B1F77a4', '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB'],
  PONS_V1_LOCKERS:   ['0x31ca5E101941A93A7DD6d0497928700625CF54B5', '0x736D76699C26D0d966744cAe304C000d471f7F35'],
  NOXA_FACTORY: '0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB',
  NOXA_LOCKER:  '0x7F03effbd7ceB22A3f80Dd468f67eF27826acD85',
  UNIV3_NPM:    '0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3',
  DOPPLER_AIRLOCK: '0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862',
  DOPPLER_INITIALIZERS: ['0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544', '0x5f9eb5f6726fe88d5e39867967f5b833d2fa3215'],
  DOPPLER_NOOP_MIGRATOR: '0xba2f330edb16cd8056f5988d8ce19bbc63475a0e',
  CLANKER_V4: '0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94',
  POOLS_ENTRIES: ['0x0000ffffbe8efe702c8703ae3477ff5de3d319c0', '0x00004c4ccc709ef590f7c81102c0689f0263d4e9'],
  FLAP_PORTAL: '0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09',
  WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
} as const

export const BSC = {
  FOUR_HELPER3: '0xF251F83e40a78868FcfA3FA4599Dad6494E46034',
  FOUR_MANAGERS: ['0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC', '0x5c952063c7fc8610FFDB798152D69F0B9550762b'],
  FLAP_PORTAL: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
  CLANKER_V4: '0xea30438E0B5f99096cb05A8Da63be55A6A298F6a',
} as const

export const BASE = {
  CLANKER_V4: '0xE85A59c628F7d27878ACeB4bf3b35733630083a9',
  ZORA_FACTORY: '0x777777751622c0d3258f214F9DF38E35BF45baF3',
  DOPPLER_AIRLOCK: '0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12',
} as const

export const ARC = { ARGUS_PORTAL: '0xB021Be536808f551b31789422Fd28a6c9c6e97Da' } as const

// ---------- Minimal ABIs ----------
const ponsV2Abi = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))',
  'function getLaunchFeePolicy(address token) view returns ((address protocolFeeRecipient, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps))',
])
const ponsV1Abi = parseAbi([ // also the Noxa factory ABI
  'function getLaunchedToken(address token) view returns ((address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount))',
])
const npmAbi = parseAbi(['function ownerOf(uint256) view returns (address)'])
const airlockAbi = parseAbi([
  'function getAssetData(address asset) view returns (address numeraire, address timelock, address governance, address liquidityMigrator, address poolInitializer, address pool, address migrationPool, uint256 numTokensToSell, uint256 totalSupply, address integrator)',
])
const dopplerTokenAbi = parseAbi(['function owner() view returns (address)', 'function vestedTotalAmount() view returns (uint256)'])
const clankerV4Abi = parseAbi(['function deploymentInfoForToken(address) view returns (address token, address hook, address locker)'])
const zoraAbi = parseAbi(['function getVersionForDeployedCoin(address) view returns (uint8)'])
const fourHelperAbi = parseAbi([
  'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
])

export type Origin = { launchpad: string; creator?: Address; graduated?: boolean; extraSellCostBps?: number; notes: string[] }

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

// ---------- Robinhood Chain ----------
export async function originRobinhood(t: Address): Promise<Origin | null> {
  const c = clients[4663]
  // Pons V2
  const v2 = await c.readContract({ address: RH.PONS_V2_FACTORY, abi: ponsV2Abi, functionName: 'getLaunchedToken', args: [t] })
  if (v2.exists && eq(v2.token, t)) {
    const fee = await c.readContract({ address: RH.PONS_V2_FACTORY, abi: ponsV2Abi, functionName: 'getLaunchFeePolicy', args: [t] })
    return { launchpad: 'pons-v2', creator: v2.deployer, graduated: v2.phase === 2,
      extraSellCostBps: v2.phase === 2 ? fee.hookFeeBps + v2.creatorTaxBps : undefined,
      notes: [`pair=${v2.pairToken}`, `creatorTaxBps=${v2.creatorTaxBps}`] }
  }
  // Pons V1 (legacy + active) and Noxa share one ABI
  const v1s = [...RH.PONS_V1_FACTORIES.map((f, i) => [f, RH.PONS_V1_LOCKERS[i], 'pons-v1'] as const), [RH.NOXA_FACTORY, RH.NOXA_LOCKER, 'noxa'] as const]
  for (const [factory, locker, name] of v1s) {
    const r = await c.readContract({ address: factory, abi: ponsV1Abi, functionName: 'getLaunchedToken', args: [t] })
    if (r.exists && eq(r.token, t)) {
      const lpOwner = await c.readContract({ address: RH.UNIV3_NPM, abi: npmAbi, functionName: 'ownerOf', args: [r.positionId] })
      if (!eq(lpOwner, locker)) return null // LP left the locker: reject
      return { launchpad: name, creator: r.deployer, graduated: true, notes: [`v3 fee=${r.poolFee}`, `positionId=${r.positionId}`] }
    }
  }
  // Doppler Airlock (Long.xyz, Bankr, others)
  const a = await c.readContract({ address: RH.DOPPLER_AIRLOCK, abi: airlockAbi, functionName: 'getAssetData', args: [t] })
  if (RH.DOPPLER_INITIALIZERS.some((x) => eq(x, a[4]))) {
    const owner = await c.readContract({ address: t, abi: dopplerTokenAbi, functionName: 'owner' })
    const vested = await c.readContract({ address: t, abi: dopplerTokenAbi, functionName: 'vestedTotalAmount' })
    const okOwner = [RH.DOPPLER_AIRLOCK, DEAD, zeroAddress].some((x) => eq(x, owner))
    const okGov = eq(a[1], DEAD) && eq(a[2], DEAD) && eq(a[3], RH.DOPPLER_NOOP_MIGRATOR)
    if (!okOwner || !okGov) return null
    return { launchpad: 'doppler', graduated: true, notes: [`numeraire=${a[0]}`, `integrator=${a[9]}`, `vested=${vested}`] }
  }
  // Clanker RH
  const cl = await c.readContract({ address: RH.CLANKER_V4, abi: clankerV4Abi, functionName: 'deploymentInfoForToken', args: [t] })
  if (eq(cl[0], t)) return { launchpad: 'clanker-v4', graduated: true, notes: [`hook=${cl[1]}`] }
  // Pools.trade: no registry view; consult our event index (UERC20Factory TokenCreated + first mint to a pools entry)
  return null
}

// ---------- BSC ----------
export async function originBsc(t: Address): Promise<Origin | null> {
  const c = clients[56]
  const i = await c.readContract({ address: BSC.FOUR_HELPER3, abi: fourHelperAbi, functionName: 'getTokenInfo', args: [t] })
  if (BSC.FOUR_MANAGERS.some((m) => eq(m, i[1]))) return { launchpad: 'four.meme', graduated: i[11], notes: [`quote=${i[2]}`] }
  // Flap: getTokenV8Safe reverts (0xde6137d1) for unknown tokens; status is the first word.
  // 0 Invalid, 1 Tradable (curve), 4 DEX (graduated), 5 Staged
  try {
    const sel = toFunctionSelector('function getTokenV8Safe(address)')
    const { data } = await c.call({ to: BSC.FLAP_PORTAL, data: `${sel}${t.slice(2).toLowerCase().padStart(64, '0')}` as `0x${string}` })
    const status = data ? Number(BigInt('0x' + data.slice(2, 66))) : 0
    if (status === 1 || status === 4) return { launchpad: 'flap', graduated: status === 4, notes: ['read buy/sell tax from the V8 lens'] }
  } catch { /* not a Flap token */ }
  const cl = await c.readContract({ address: BSC.CLANKER_V4, abi: clankerV4Abi, functionName: 'deploymentInfoForToken', args: [t] })
  if (eq(cl[0], t)) return { launchpad: 'clanker-v4', graduated: true, notes: [] }
  return null
}
// Base and Arc follow the same pattern: Clanker deploymentInfoForToken, Zora getVersionForDeployedCoin(coin) > 0,
// Doppler Airlock getAssetData, Argus launches(token) (non-zero record; hook address read from the record).

// ---------- Uniswap v4 hook permission bits (lowest 14 bits of the hook address) ----------
export function hookFlags(hook: Address) {
  const f = BigInt(hook) & 0x3fffn
  const bit = (n: bigint) => (f & (1n << n)) !== 0n
  return {
    beforeRemoveLiquidity: bit(9n), beforeSwap: bit(7n), afterSwap: bit(6n),
    beforeSwapReturnsDelta: bit(3n), afterSwapReturnsDelta: bit(2n), afterRemoveLiquidityReturnsDelta: bit(0n),
  }
}
// Rule: a pool may be used for pricing/routing only if hooks == 0x0 or hooks ∈ the per-launchpad allowlist
// (Pons V2 MemeHook, Doppler initializers, Clanker fee hooks, Zora hooks, Argus per-launch hooks read from launches()).
```

**Gating sequence for every candidate (bag, chain, user):**
1. **Origin:** call `origin<Chain>()`. On `null`, the token is ineligible, unless it is on the manual allowlist (e.g., GOOSE or CHUMP after a curated review).
2. **Template:** apply the launchpad-specific checks above (owner, `vestedTotalAmount`, `_mode`, taxes, `phase`, LP owner).
3. **Quote asset:** must be canonical (RH: ETH/WETH, USDG, or a Robinhood Stock Token from `api.robinhood.com/rhj/assets`; BSC: WBNB, USDT, USDC, USD1; Base: ETH, USDC, ZORA; Arc: USDC). If it is a stock token, also require `paused()==false`, `isBlocked(user)==false` and `isTradingHalt==false`.
4. **Route:** request a swap+bridge quote for the whole balance to SOL (LI.FI shown here; Relay or another provider per `gap-crosschain.md`). Require a route, price impact ≤ `MAX_IMPACT_BPS` (e.g., 1,500), and USD value ≥ `MIN_USD` (e.g., $1–2 after fees).
5. **Simulation:** `eth_simulateV1` of [approve, swap tx] from the user's address (viem `simulateCalls`). Require success, with token outflow equal to the requested amount and native or stable inflow ≥ 98% of the quote. Arc: use Tenderly, Alchemy or our own node.
6. **Curve tokens:** if there is no route and the origin says pre-graduation, offer a direct curve sell through the launchpad (Pons V2 curve, four.meme TM2 `sellToken`, Flap Portal, Bags AMM), then bridge the native proceeds. Otherwise mark "not convertible yet".
7. **Anti-farming:** if rewards depend on converted value, exclude `user == creator/deployer`, require token age ≥ 6–24 h, and count only realized SOL received.

---

## 9. Data and API providers: wallet scan, prices, security

| Need | Robinhood Chain (4663) | BNB Chain (56) | Base (8453) | Arc (5042) |
|---|---|---|---|---|
| RPC, logs, simulation | Alchemy, QuickNode, Chainstack, Dwellir, Blockdaemon, GetBlock, OrbitFlare, Tatum; public RPC (pruned state; getLogs ≤10M blocks and ≤10k logs; `eth_simulateV1` OK) [V/S] | publicnode (getLogs ≤500 blocks with topic; `eth_simulateV1` OK), bsc-dataseed (strict), Alchemy, QuickNode [V/S] | mainnet.base.org and publicnode, Alchemy, QuickNode [V] | rpc.mainnet.arc.io (no `eth_simulateV1`, small getLogs ranges), Blockdaemon, dRPC, QuickNode [V/P] |
| Wallet token balances | Alchemy Token API (`alchemy_getTokenBalances`; Portfolio API coverage unconfirmed) [P/U]; GoldRush (since 2026-07-08) [P]; Zerion API (day one) [P]; Tatum [S]; Bitquery Balances API [S]; Mobula (documents RH launchpads) [S]; Moralis: not confirmed | Alchemy, Moralis, GoldRush, Zerion, Codex, Covalent | Same as BSC | Blockscout API v2 (explorer.arc.io); GoldRush/Zerion/Alchemy coverage unverified [U] |
| Prices and pools | DexScreener (`robinhood`), GeckoTerminal/CoinGecko on-chain (`robinhood`), Alchemy Prices API, Codex (claimed), Bitquery; for value, prefer the executable quote [V/S] | DexScreener, GeckoTerminal, Codex (four.meme events), Bitquery four.meme API | DexScreener, GeckoTerminal, Codex | DexScreener (`arc`), GeckoTerminal [S] |
| Token security | GoPlus (chain 4663 in `supported_chains`) [V]; TrustSwap RH honeypot checker (web) [S]; Relay blocks malicious contracts [S]; Blockaid claim unverified | GoPlus, honeypot.is, De.Fi | GoPlus, honeypot.is | GoPlus (5042 listed) [V] |
| Explorer API | Etherscan V2 `chainid=4663` (robin.etherscan.io; free tier presumably, unverified); Blockscout (Cloudflare challenge seen from our server) [V] | Etherscan V2 (paid ≥$49/month since late 2025) [S] | Etherscan V2 (paid); Blockscout Base (free tier) [S] | Blockscout v2 [P] |
| Launchpad-specific indexing | Bitquery (Pons, Pools.trade, Flap, trench.today, Bags pages); Mobula almanac (Pons, Noxa, Long, RobinFun, RealFun, Bow.fun, Bottom.fun, Printr, ApeStore, DYOR.fun); DefiLlama dimension-adapters; Dune "The Robinhood Trenches"; Allium; Goldsky [S] | Codex, Bitquery, DefiLlama adapters | Dune (zora_base, clanker), Codex | — |
| Stock tokens | `api.robinhood.com/rhj/assets`, `/prices/{symbol}`, `/corporate-actions` (60 rps) [V/P] | — | — | — |

Scanning a wallet without a connection works because balances are public. Practical combination: Zerion or GoldRush for multi-chain balances (both cover RH), then the launchpad registry calls in section 8 for eligibility, then the swap+bridge quote for value. Use DexScreener or GeckoTerminal only for display or fallback; they report FDV and liquidity, not executable value.

---

## 10. Risks

- **Upgradeable launchpad infrastructure:**
  - Flap Portals, four.meme TokenManagers, the Bags factories and AMM beacon, the LetsCash factory, the Zora factory and USDG are proxies.
  - Pons V2, Noxa and the Pons V1 factories, Clanker v4 and the Argus Portal v7 are not. The Noxa and Pons V1 lockers are Ownable, with source not reviewed.
  - A template or behavior change can silently break checks. Monitor implementation slots and pin known implementations.
- **Registry semantics drift:** Flap's lens versions (V5–V8), Zora's version numbers, Pons V2 `phase` values. Decode defensively.
- **Hook economics change per launch:** Pons V2 snapshots fees per launch (safe), but other pads may use dynamic-fee hooks. Always measure the sell cost with a quote and simulation; never assume it.
- **Stock-token dependencies (RH):** issuer pause or blocklist, corporate-action multipliers, weekend decoupling, and US-retail restrictions on the underlying product. A meme that sells into HIMS or NVDA can fail or misprice outside market hours.
- **Bags in embedded wallets:** GMGN, fomo and Axiom wallets on RH and BSC may not be able to sign our transactions. The UX needs a transfer step or deep links.
- **Sequencer and finality:** RH has a single sequencer; Arc has permissioned validators. Bridge solvers may pause during incidents.
- **Data freshness:** DexScreener and GeckoTerminal rate limits (GeckoTerminal returned 429 from our IP), Etherscan paywalls, and the public RPCs' pruned state and log caps. Budget for Alchemy or QuickNode plus Zerion or GoldRush.
- **Farming and wash:** launching on an approved pad costs as little as 0.0005 ETH (Pons/Noxa) [V]. Any value-based reward invites self-launched tokens.
- **Scope creep:** about 90 RH pads exist. Keep the allowlist small and review it weekly.

---

## 11. Open questions

1. **Pons V1 and Noxa lockers:** can the owner withdraw the v3 position NFT? Get the source, or scan the bytecode for `decreaseLiquidity`, `transferFrom` or `safeTransferFrom` paths.
2. **Flap non-tax V3 migrations:** who holds the position NFT (Portal, FlapTokenLocker, burned)? And which post-graduation DEX does Flap use on RH (Uniswap v3 or v4)?
3. **Bags, LetsCash, o1:** exact creation-event signatures and any registry views. Event-index specs are needed.
4. **Genius.fun:** factory address, template and LP handling. Not verified here.
5. **Doppler on Base:** behavior of the older DERC20 template (2025). Owner-gated inflationary mint after migration?
6. **Zora pre-v4 coins:** does `getVersionForDeployedCoin` return non-zero for Uniswap v3-era coins? If not, the CoinCreated index must cover them.
7. **Aggregator coverage of curve sells:** which providers (LI.FI's nordstern, KyberSwap, OKX DEX, 0x, Relay) route four.meme, Flap, Bags, LetsCash and o1 pre-graduation tokens? Our sample says mostly none; the exception is Pons V2 via nordstern.
8. **Arc simulation:** which provider supports `eth_simulateV1` or tracing on Arc mainnet?
9. **The second UBIK contract (`0xe124…68Bd`):** team migration or third-party mirror? Treat it as ineligible until the team confirms.
10. **Curated custom tokens:** should GOOSE, CHUMP and similar large RH tokens without a launchpad enter a manual allowlist (verified source, renounced owner, plain ERC-20, deep liquidity)?
11. **Etherscan free tier for chain 4663:** does it cover `getcontractcreation` and `tokentx`?

---

## Sources

On-chain verification (2026-10-08): RPC calls against `rpc.mainnet.chain.robinhood.com`, `bsc-rpc.publicnode.com`, `base-rpc.publicnode.com` and `rpc.mainnet.arc.io`: `eth_getCode`, `eth_call` on registry functions, `eth_getLogs` and receipts of the creation transactions cited above.

**Robinhood Chain**
- CoinGecko, "Robinhood Chain: Built for RWA, Loved for Memes": https://www.coingecko.com/learn/robinhood-chain-built-for-rwa-loved-for-memes
- CoinDesk on Pons fees (2026-09-03): https://www.coindesk.com/tech/2026/09/03/a-memecoin-making-app-becomes-crypto-s-top-fee-generators-as-robinhood-chain-activity-explodes
- CoinDesk on Noxa (2026-07-15): https://www.coindesk.com/business/2026/07/15/the-launchpad-that-fueled-robinhood-chain-s-memecoin-boom-just-gave-away-all-its-revenue
- Fortune (2026-07-13): https://fortune.com/crypto/2026/07/13/robinhood-chain-memecoin-trading-cash-cat-vlad-tenev-crypto/
- AirdropAlert, Robinhood launchpads: https://airdropalert.com/blogs/robinhood-launchpads/
- Memeburn on Pons: https://memeburn.com/pons-made-124m-in-fees-in-30-days/
- Bitquery Robinhood docs:
  - Pons: https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/
  - Pools.trade: https://docs.bitquery.io/docs/blockchain/robinhood/pools-trade-api/
  - Meme coin launches: https://docs.bitquery.io/docs/blockchain/robinhood/robinhood-meme-coin-launches/
  - Flap: https://docs.bitquery.io/docs/blockchain/robinhood/flap-sh-api/
  - Bags: https://docs.bitquery.io/docs/blockchain/robinhood/bags-fm-api/
  - trench.today: https://docs.bitquery.io/docs/blockchain/robinhood/trench-today-api/
- Pons: https://github.com/ponsdotdev/pons-labs · https://docs.ponsfamily.com/ · https://docs.ponsfamily.com/v2
- Noxa: https://docs.noxa.fi/contracts/noxa-fun/
- Mobula almanac:
  - Pons: https://docs.mobula.io/almanac/robinhood-launchpads/pons
  - Long.xyz: https://docs.mobula.io/almanac/robinhood-launchpads/longxyz
  - RobinFun: https://docs.mobula.io/almanac/robinhood-launchpads/robinfun
  - RealFun: https://docs.mobula.io/almanac/robinhood-launchpads/realfun
  - Bow.fun: https://docs.mobula.io/almanac/robinhood-launchpads/bowfun
- Doppler:
  - Contract addresses: https://docs.doppler.lol/resources/contract-addresses
  - Sources: https://github.com/whetstoneresearch/doppler (`src/tokens/DopplerERC20V1.sol`, `src/Airlock.sol`)
- Uniswap:
  - Robinhood v3 deployments: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments
  - UniswapX Robinhood playbook: https://github.com/Uniswap/UniswapX/blob/main/playbook/chains/robinhood.md
  - Pools.trade blog post: https://blog.uniswap.org/pools-trade-a-new-way-to-launch-on-robinhood-chain
  - Liquidity launcher: https://github.com/Uniswap/liquidity-launcher
- Robinhood docs and API:
  - Token contracts: https://docs.robinhood.com/chain/contracts
  - Protocol contracts: https://docs.robinhood.com/chain/protocol-contracts
  - Stock token APIs: https://docs.robinhood.com/chain/stock-token-apis
  - Stock token registry API: https://api.robinhood.com/rhj/assets
- Relay honeypot warning: https://www.gncrypto.news/news/robinhood-chain-honeypot-token-scams-relay-blocks/
- BONER and HIMS:
  - The Defiant: https://thedefiant.io/news/tokens/a-memecoin-called-boner-has-cornered-half-the-tokenized-hims-and-hers-float
  - DeFiPrime: https://defiprime.com/tokenized-stock-float-squeeze

**DefiLlama**
- Adapters: https://github.com/DefiLlama/dimension-adapters
  - fees: `bankr.ts`, `pools-trade.ts`, `ponsdotfamily*`, `clanker.ts`, `flaunch.ts`, `mosh`, `o1-launchpad/config.ts`, `launch-on-bags`, `stonkbrokers-*`
  - dexs: `noxa-fun`, `flap.ts`, `letscash.ts`, `four-meme`, `nad-fun.ts`
- API: https://api.llama.fi/overview/fees/Robinhood · https://api.llama.fi/overview/fees · https://api.llama.fi/overview/dexs

**BSC**
- Flap docs:
  - Contract addresses: https://docs.flap.sh/flap/developers/deployed-contract-addresses.md
  - DEX migration: https://docs.flap.sh/flap/developers/basic-and-mechanism/list-on-dex.md
  - Tax Token V3: https://docs.flap.sh/flap/developers/basic-and-mechanism/flap-tax-token/tax-token-v3.md
  - Inspect a token: https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/inspect-a-token.md
- four.meme:
  - Codex: https://docs.codex.io/launchpads/four-meme
  - LP burn: https://grenade.tw/blog/four-meme-pancakeswap/
- Genius.fun: https://www.theblock.co/press-releases/genius-fun-launches-on-bnb-chain-to-bring-hostile-takeovers-on-chain-415415

**Base**
- Clanker SDK: https://github.com/clanker-devco/clanker-sdk (`src/utils/clankers.ts`, `src/utils/chains/robinhood.ts`)
- Zora factory and coin selectors: on-chain [V]

**Arc**
- The Block on the Arc mainnet launch: https://www.theblock.co/news/ecosystems/2026-09-16-circle-launches-arc-mainnet-with-blackrock-and-visa-among-validators-mints-10-billion-arc-tokens-415250
- Argus README: https://raw.githubusercontent.com/arguspad/argus-world/main/README.md
- BeInCrypto (day-one volume): https://beincrypto.com/arc-mainnet-meme-coin-launchpad-volume/

**Tooling and data providers**
- viem chain definitions: https://unpkg.com/viem@2.57.4/_esm/chains/definitions/robinhood.js and `arc.js` (`robinhood` first in viem 2.55.0, `arc` in 2.49.3)
- Etherscan chain list: https://api.etherscan.io/v2/chainlist
- Etherscan paywall: https://finance.yahoo.com/news/ethereum-explorer-etherscan-locks-avalanche-143215634.html
- GoPlus supported chains: https://api.gopluslabs.io/api/v1/supported_chains
- Alchemy: https://www.alchemy.com/blog/robinhood-chain-mainnet-is-live-on-alchemy · https://www.alchemy.com/rpc/robinhood
- GoldRush: https://goldrush.dev/docs/changelog/20260708-robinhood-chain-now-live-on-goldrush
- Zerion: https://zerion.io/blog/zerion-api-supports-robinhood-chain-from-day-one/
- Phantom:
  - Robinhood Chain: https://solanacompass.com/news/phantom-adds-robinhood-chain-support-bringing-tokenized-stock-defi-to-solanas-biggest-wallet
  - BNB Chain: https://solanacompass.com/news/phantom-wallet-adds-bnb-chain-support-making-it-the-apps-ninth-network
  - Arc: https://solanacompass.com/news/phantom-joins-circles-arc-blockchain-on-mainnet-launch-day
  - Monad exit: https://thedefiant.io/news/infrastructure/phantom-to-end-monad-support-on-aug-26
- LI.FI quote probe: https://li.quest/v1/quote and https://li.quest/v1/chains (2026-10-08)
- DexScreener API: https://api.dexscreener.com/latest/dex/search and `/token-pairs/v1/{chain}/{token}`

**Internal cross-references**
- `research/tg-bots.md`: GMGN, fomo and Axiom fee shares on Robinhood Chain and BSC.
- `research/competitors.md`: StockRip, StonkBrokers and Card Wall on Robinhood Chain.
- `research/launchpads.md`: Solana counterpart (pump.fun, LaunchLab, DBC).

---

## Independent fact-check (2026-10-08)

**Scope.** A second, independent pass on the 15 claims above that most affect the build: route providers, fees, factory addresses, template safety, wallets and data costs. It ran 12:50–13:35 UTC on 2026-10-08. Nothing was copied from the report's own [V] work; every check was redone from scratch:
- **On-chain reads:** `eth_call`, `eth_getCode`, `eth_getLogs` and `eth_getStorageAt` against the public RPCs of RH, BSC (publicnode and bsc-dataseed), Base and Arc.
- **Live quotes** from LI.FI, Relay, Across and deBridge. Requests came from a throwaway EVM address with no funds and a freshly generated Solana address.
- **Simulations:** `eth_simulateV1` of the exact approve and swap/deposit transactions the APIs returned. A storage override credited the throwaway address with the token. This is read-only: nothing was signed or broadcast.
- **Primary docs and source:** Doppler, Flap, clanker-sdk, Pons GitHub, Phantom help center, Etherscan and LI.FI.

**Verdicts:**
- **Confirmed.**
- **Corrected:** right in substance, but a detail is wrong or missing.
- **Wrong.**
- **Unverifiable.**

### Verdicts at a glance

| # | Claim | Verdict |
|---|---|---|
| 1 | LI.FI supports RH and routes graduated RH bags → SOL through Relay in one tx | Confirmed (plus a 0.25% LI.FI fee and a Relay-only dependency) |
| 2 | Fast RH→Solana routes are Relay, Across and LI.FI | **Corrected**: Across has no RH→Solana route; deBridge has one; Relay also works without LI.FI |
| 3 | Graduated BSC/Base bags route to SOL via Mayan | Confirmed |
| 4 | Curve (pre-graduation) bags have no route and need custom curve-sell adapters | **Corrected** (partly wrong): Pons V2 and four.meme curve bags route today |
| 5 | Pons V2 registry, fee policy and token template | Confirmed |
| 6 | Pons V2 launches are whitelist-only | **Wrong** on-chain: `canLaunch` is open to anyone |
| 7 | The second "UBIK" is a non-Pons clone | Confirmed |
| 8 | The Pons V2 LP is locked forever; the Pons V1/Noxa lockers are unknown | Confirmed; Pons V1/Noxa now partly resolved |
| 9 | Doppler RH addresses and token template | Confirmed (the Base initializer address differs) |
| 10 | Clanker v4 addresses and token template | Confirmed |
| 11 | four.meme and Flap origin proofs on BSC | Confirmed (four.meme `maxFunds` is now 13.1–13.2 BNB) |
| 12 | The stock token exposes `isBlocked(address)` | **Corrected**: call it on the registry, not on the token |
| 13 | Phantom supports RH, Arc, Base and BNB Chain | Confirmed (dates come from secondary sources) |
| 14 | Etherscan V2's free tier covers RH | **Corrected**: free only until 2026-10-15 |
| 15 | DefiLlama chain ranking | Confirmed (RH's #2 DEX rank is a thin margin) |

### Details

1. **Claim (Summary 9, §7):** LI.FI lists Robinhood Chain (id 4663, key `out`) and Solana. It quotes graduated RH bags → native SOL in one source-chain transaction (~1 s), through an RH aggregator ("nordstern" or fly) plus Relay (`relaydepository`).
   - **Verdict:** Confirmed, with three additions.
   - **Evidence:**
     - `/v1/chains` lists 4663 `out` (native ETH), 5042 `arc`, 56, 8453, 143, 196, 999, and Solana 1151111081099710.
     - Quotes for CASHCAT, PONS, BUN, BONER, AI, UBIK, FRONG and native ETH all returned `relaydepository` with `executionDuration` 1 s.
     - The CASHCAT LI.FI transaction succeeded under `eth_simulateV1`: approve, then a call to the LI.FI diamond `0xB477751B76CF82d00a686A1232f5fCD772414Af3` (≈404k gas).
   - **Additions:**
     - The RH aggregator varies by request. Most quotes used nordstern; CASHCAT and PONS went through KyberSwap. `/v1/tools?chains=4663` lists bitget, openocean, kyberswap, fly, nordstern, lifiIntentsDex, smartDeposits and rialto.
     - Every LI.FI quote carries LI.FI's own **0.25% service fee** ("LIFI Fixed Fee 0.0025"). Relay's service fee comes on top: 0.13–0.16% on $45–120 bags, and 0.34–0.60% on $4–14 bags. The small-bag figures are consistent with a minimum fee of about $0.025.
     - **LI.FI's RH→SOL coverage depends entirely on Relay.** With `denyBridges=relaydepository`, `allowBridges=across` or `allowBridges=mayan`, LI.FI returns no quote. If Relay goes down, LI.FI has no route out of RH.
   - **Sources:** https://li.quest/v1/chains · https://li.quest/v1/tools?chains=4663 · https://li.quest/v1/quote (probes on 2026-10-08) · https://docs.li.fi/faqs/fees-monetization.md ("LI.FI charges a 0.25% service fee on each transaction")

2. **Claim (§2.1):** "Fast routes to Solana are Relay, Across and LI.FI (Jumper)."
   - **Verdict:** Corrected. Across does not route RH→Solana today; deBridge does, and Relay works directly.
   - **Relay:** `/chains` lists Robinhood Chain 4663 (`tokenSupport: All`, deposits enabled) and Solana 792703809. Relay's own `/quote` routes RH memecoins to native SOL with one approve and one deposit to `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be` (~1 s):

     | Bag | Size | Received | Total impact | Notes |
     |---|---|---|---|---|
     | CASHCAT | $119 | 1.0531 SOL | −0.65% | Relayer fee $0.26. LI.FI's quote for the same bag was 1.0545 SOL (within ~0.15%). |
     | BUN | $63 | — | −1.24% | — |

     The deposits for BUN and for a fresh Pons V2 curve token simulated OK. Relay's `app` fee defaults to 0.
   - **Across:** it lists Robinhood (4663) and Solana (34268394551451) as chains, but `/available-routes?originChainId=4663` returns 39 routes, all ETH/WETH/USDG to EVM chains, and none to Solana. `/swap/approval` from RH WETH to SOL or USDC on Solana answers "Destination swaps are not supported yet for routes involving Solana."
   - **deBridge DLN:** `supported-chains-info` lists Robinhood 4663, Arc, BSC, Base and Solana (7565164). A CASHCAT → SOL order quote worked, with the source swap going through USDG: $118.79 in, $116.12 out (−2.25%). Most of that loss is a fixed 0.001 ETH fee, which makes deBridge expensive for small bags, but it is an independent fallback.
   - **Mayan:** not available from RH. LI.FI's RH tool list has no `mayan`, and `allowBridges=mayan` returns no quote.
   - **Sources:** https://api.relay.link/chains · https://api.relay.link/quote · https://app.across.to/api/available-routes?originChainId=4663 · https://app.across.to/api/swap/chains · https://dln.debridge.finance/v1.0/supported-chains-info

3. **Claim (§7):** Graduated BSC and Base samples (币安人生, CLANKER, BNKR) route to SOL through nordstern or KyberSwap, plus Mayan.
   - **Verdict:** Confirmed. The aggregator varies from quote to quote:

     | Chain | Bag | Aggregator | Bridge |
     |---|---|---|---|
     | BSC | 币安人生 `0x924fa68a0FC644485b8df8AbfA0A41C2e7744444` | bitget | Mayan |
     | Base | BNKR `0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b` | nordstern | Mayan |
     | Base | CLANKER `0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb` | KyberSwap | Mayan |
     | BSC | native BNB | 1inch | Mayan |
     | Base | native ETH | none | Mayan (direct) |

     Every route had `executionDuration` ≈3 s and carried the 0.25% LI.FI fee.
   - **Source:** https://li.quest/v1/quote (2026-10-08)

4. **Claim (Summary 9, §7, §8 step 6):** Most "-80%" bags never graduated. Pre-graduation tokens have no aggregator route ("four.meme curve tokens: no route"), so they need direct curve-sell adapters (four.meme TM2, Flap Portal, Bags AMM, Pons V2 curve) or must be excluded.
   - **Verdict:** Corrected (partly wrong). Coverage varies by launchpad and by token; it is not "none".

     | Launchpad (curve tokens) | LI.FI | Relay direct | Simulation |
     |---|---|---|---|
     | Pons V2: 3 fresh tokens in phase 0 | Routes, 3/3 (nordstern or KyberSwap → Relay) | Routes (1 token tested) | Relay approve + deposit OK for `0x0276f1d839bfe3dcedf808795789fd83d8c7009c` |
     | four.meme: 2 USDT-quoted `…4444` tokens, 67% and 83% of `maxFunds` | No route (422 "None of the available routes could successfully generate a tx") | Routes: $27.7 → SOL (−1.98%) and $37.3 → SOL | **OK** for `0xe3db791c5d25f9d13e8bb4befac8f6ad77c14444` (~506k gas). Relay is in practice a working four.meme curve-sell route. |
     | Flap BSC (Tax-V3 clones): `0xbd85…7777`, 1% buy tax, 0% sell tax | OKX → Mayan, 3/3 attempts | Quoted 2 of 3 attempts | LI.FI route OK, 2/2 |
     | Flap BSC (Tax-V3 clones): `0x5c28…7777`, 1% sell tax | 1 of 4 attempts | No route | — |
     | Flap RH: `0x0b92…7777`, `0x370f…7777` | No route | No route | — |
     | Base, fresh coins: Clanker v4 `0xa5f4…1b07`, Zora `0x439a…4851` | No route | No route | — |

     - On Flap BSC, tokens with a sell tax look fragile on aggregators.
     - The Flap-RH and fresh Base results agree with the report.
     - LI.FI's `fromAmountUSD` is unreliable on fresh tokens: one quote showed $0.0001 in for $13.70 out. Value bags from `toAmount`.
   - **Implication:**
     - At intake, query **both** LI.FI and Relay, then simulate.
     - Curve-sell adapters become a fallback, needed only where both providers fail: Flap-RH curve, sell-tax Flap curve tokens, Bags, LetsCash and o1.
   - **Sources:** https://li.quest/v1/quote · https://api.relay.link/quote · `eth_simulateV1` on rpc.mainnet.chain.robinhood.com and bsc-rpc.publicnode.com (read-only state override)

5. **Claim (§2.4 Pons V2):**
   - The Pons V2 factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` proves origin with `getLaunchedToken(t).exists`.
   - Its fee policy is hookFeeBps 100, protocol share 3000, buyback-burn 5000 and max impact 300.
   - Creator tax ranges from 0 to 10%: UBIK 1%, AUR 0.55%, BUN 0%.
   - `PonsV2LauncherToken` has no owner, mint, blacklist or tax.

   - **Verdict:** Confirmed.
   - **Evidence:**

     | Token | Pair | Graduation threshold | Creator tax | Other fields |
     |---|---|---|---|---|
     | UBIK | GLD `0xc9a981fe…fc4e` | 24.94 GLD | 100 bps | tickSpacing 200, phase 2 |
     | AUR | — | — | 55 bps | — |
     | BUN | ETH | 4.2 ETH | 0 bps | — |

     - `getLaunchFeePolicy(UBIK)` = (`0x263ed295…19dd`, 3000, 5000, 100, 300).
     - Factory settings: `maxCreatorTaxBps()` = 1000 and `launchFee()` = 0.0005 ETH. Its owner is `0x263ed295…19dd`, the same as Pons V1.
     - The UBIK token: 3,248-byte runtime. `owner()` reverts, there is no `mint` selector, and `burnFrom` is present.
   - **Sources:** `eth_call` on RH · https://github.com/ponsdotdev/pons-labs

6. **Claim (§2.2):** "The docs say public launches are currently closed to whitelisted launchers, checked with `canLaunch(address)`."
   - **Verdict:** Wrong on-chain. The docs do say this, but the chain disagrees.
   - **Evidence:**
     - docs.ponsfamily.com/v2 still reads "Public launches are closed…".
     - `canLaunch(<random throwaway address>)` returned **true** at about 13:30 UTC.
     - The last 200 `TokenLaunched` events came from 185 distinct deployers. Thirteen of the last 15 went through the LaunchAndBuy router `0xe33e9e479df8802cb0866d5d05258bec4cf62948`.
   - **Implication:** treat Pons V2 as permissionless. Anyone can self-launch for 0.0005 ETH, so the anti-farming rules in §2.5 and §8 are mandatory, not optional.
   - **Sources:** https://docs.ponsfamily.com/v2 · `eth_call` `canLaunch(address)` and `eth_getLogs` on RH

7. **Claim (Summary 3, §2.3):** the second "UBIK" (`0xe1243842E091f073841Fc1Ac9527eA7E64F168Bd`) is not a Pons launch. It is an EIP-1167 clone with an EOA owner, and it minted exactly the original's supply.
   - **Verdict:** Confirmed.
   - **Evidence:**
     - The Pons V2 registry returns all zeros for it.
     - It is a 45-byte EIP-1167 proxy to `0x5bebcf09…9bde`. That implementation has `owner`, `transferOwnership` and `renounceOwnership`, and no `mint` selector.
     - `owner()` = `0x3f5d6d4a…7dbe`, whose code size is 0 (an EOA).
     - Its `totalSupply` equals UBIK's: 999,977,831.61.
   - **Source:** `eth_call` / `eth_getCode` on RH

8. **Claim (Summary 7, §2.4, open Q1):** the Pons V2 LP NFT sits permanently in `PonsV2LaunchLocker`, which has no withdraw. The Pons V1 and Noxa lockers are Ownable, with unreviewed source [U].
   - **Verdict:** Confirmed for Pons V2. Pons V1 and Noxa are partly resolved, at bytecode level.
   - **Pons V2:**
     - `ownerOf(1534854)` on the v4 PositionManager is the locker, and `lockedPositions(BUN)` = 1534854.
     - The GitHub source (123 lines) has no withdraw and no arbitrary call. The owner can only `setFactory` once, which is already done (set to the V2 factory). `renounceOwnership` reverts by design.
     - The deployed selectors match the source.
   - **Pons V1 and Noxa:**
     - `ownerOf(109216)` (PONS) is the legacy locker; `ownerOf(100)` (CASHCAT) is the Noxa locker.
     - Their dispatchers expose only fee and ownership functions: `collectFees`, `setFeeRedirect`, `setFeeCollector`, `setProtocolFeeRecipient/Share`, `lockPosition` and `getLaunchedToken`.
     - The bytecode has no PUSH4 for NPM `transferFrom`, `safeTransferFrom`, `decreaseLiquidity`, `approve` or `setApprovalForAll`, and no DELEGATECALL or CALLDATACOPY opcode.
     - So the owner can redirect fees, but we found no path to move the LP NFT.
     - Still open: one selector in the legacy Pons V1 locker (`0xd86828d6`) is unidentified, and the source is still unpublished.
   - **Sources:** `eth_call` / `eth_getCode` on RH · https://github.com/ponsdotdev/pons-labs/blob/main/contractsV2/src/v2/PonsV2LaunchLocker.sol · https://api.openchain.xyz (selector lookup)

9. **Claim (§2.4 Doppler):**
   - Doppler's official RH addresses are as listed in §2.4: Airlock `0xeb7c…0862`, DopplerERC20V1 `0x3be8…c599`, DopplerHookInitializer `0x4e34…a544`, NoOpMigrator `0xba2f…5a0e`, and so on.
   - `getAssetData` proves origin.
   - Sampled tokens are owned by the Airlock, with governance and timelock set to 0xdead and the NoOp migrator.
   - There is no mint after initialization.

   - **Verdict:** Confirmed, with one caveat.
   - **Evidence:**
     - The docs page lists exactly these 8 RH addresses.
     - `getAssetData` for BONER and AI:

       | Token | Numeraire | Timelock = governance | Migrator | Initializer | Integrator | Supply |
       |---|---|---|---|---|---|---|
       | BONER | HIMS `0xccee82fe…3d09` | 0xdead | NoOp | `0x4e34…` | Long `0x92d4…f765` | 1B |
       | AI | NVDA `0xd0601ce1…9eec` | 0xdead | NoOp | `0x4e34…` | Long `0x92d4…f765` | 1B |

     - Token state on both: `owner()` = Airlock, `vestedTotalAmount()` = 0, `pool()` = `0xdead…dead` with `isPoolLocked` = 1.
     - Each token is a 44-byte clone of `0x3be8…`.
     - In the source, `_mint` appears only in `initialize`. `lockPool` makes transfers *to* the locked pool revert, which is harmless here because the locked pool is the dead address.
   - **Caveat:** on Base the DopplerHookInitializer is `0xbdf938149ac6a781f94faa0ed45e6a0e984c6544`, not the RH address. The Rehype initializer `0x5f9e…3215` is the same on both chains. Keep a separate initializer allowlist per chain.
   - **Sources:** https://docs.doppler.lol/resources/contract-addresses · https://github.com/whetstoneresearch/doppler/blob/main/src/tokens/DopplerERC20V1.sol · `eth_call` on RH

10. **Claim (§2.4, §3.2, §4.2):** the Clanker v4 factories (Base `0xE85A59c628F7d27878ACeB4bf3b35733630083a9`, RH `0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94`, BSC `0xea30438E0B5f99096cb05A8Da63be55A6A298F6a`) prove origin with `deploymentInfoForToken`. v4 tokens have a 100B supply and no owner or mint.
    - **Verdict:** Confirmed.
    - **Evidence:**
      - clanker-sdk `clankers.ts` lists exactly these factories, lockers and hooks, plus the Base v0–v3.1 factories.
      - On Base, live v4 tokens return (token, hook `0xb429…28CC`, locker `0xffA3…0762`); WETH returns zeros.
      - Token template: `owner()` reverts, `admin()` is set, and `totalSupply` = 100,000,000,000e18.
      - There were 21 TokenCreated events in 6,000 blocks.
    - **Sources:** https://raw.githubusercontent.com/clanker-devco/clanker-sdk/main/src/utils/clankers.ts · `eth_call` on Base

11. **Claim (§3.2):** on-chain origin proofs work on BSC.
    - four.meme: `Helper3.getTokenInfo(t).tokenManager` ∈ {TM1 `0xEC45…`, TM2 `0x5c95…`}. The 2025 template has `owner()=0` and `_mode()=0`, and FOURMEME's `maxFunds` is 18 BNB.
    - Flap: Portal `0xe2cE…9De0` `getTokenV8Safe` reverts with `0xde6137d1` for unknown tokens.

    - **Verdict:** Confirmed, with one detail updated.
    - **four.meme:**
      - 币安人生 returns version 2, TM2, quote BNB, `liquidityAdded` = 1 and `maxFunds` 18 BNB. Its `owner()` = 0 and `_mode()` = 0, with a 3,822-byte runtime. WBNB returns zeros.
      - **Update:** BNB-quoted launches created on 2026-10-08 show `maxFunds` of 13.1–13.2 BNB, not 18. New tokens end in `…ffff` or `…4444`.
      - Four.meme's own developer docs listing TM2 and Helper3 were not found, so these addresses rest on on-chain behaviour only.
    - **Flap:**
      - `getTokenV8Safe(WBNB)` reverts with `0xde6137d1…`, while live `…7777` tokens return status 1.
      - docs.flap.sh lists the same BSC Portal, token implementations, registry and locker.
      - It also lists the same Portals elsewhere: RH `0x26605f32…EB09`, Base `0x0000BC1c…0000`, X Layer `0xb30D8c42…8678` and Monad `0x30e8ee7b…8b23`.
    - **Sources:** `eth_call` on BSC · https://docs.flap.sh/flap/developers/deployed-contract-addresses.md

12. **Claim (§2.1, §2.6 step 5, §8 step 3):** the Robinhood Stock Token implementation exposes `isBlocked(address)`, so the gate is `isBlocked(user)==false` on the stock token.
    - **Verdict:** Corrected.
    - **Evidence:**
      - `isBlocked(addr)` called on the HIMS token (`0xCceE82fE024c36FA15E1005eDe3e9E4787e23d09`) **reverts**.
      - The implementation (`0xb35490d6…5ae2`, 11,614 bytes) sends blocklist checks to `ACCESS_CONTROLLED_REGISTRY()`. That returns `0xe10b6f6b275de231345c20d14ab812db62151b00`, the same contract as the beacon. `isBlocked(addr)` must be called there; it returned false.
      - The implementation also has `adminBurn(address,uint256)`, so the issuer can burn from any holder. It also has `tokenPaused()` and `oraclePaused()`. `paused()` is currently false.
      - `/rhj/assets` still returns 194 assets, all with a chain-4663 deployment. The status enum is literally `ASSET_STATUS_ACTIVE` (all 194 are active), so the §2.6 check should compare against that string, not `ACTIVE`.
    - **Fix:** call `isBlocked(user)` on `ACCESS_CONTROLLED_REGISTRY()`, also require `!tokenPaused()`, and list `adminBurn` among the stock-quote risks.
    - **Sources:** `eth_call` / `eth_getStorageAt` on RH · https://api.robinhood.com/rhj/assets · https://api.openchain.xyz

13. **Claim (Summary 11, §2.1):** Phantom supports Robinhood Chain (since 2026-07-23), Arc (since 2026-09-16), Base and BNB Chain (since 2026-10-01). Monad was dropped on 2026-08-26. One Phantom wallet can sign the EVM sell and receive the SOL.
    - **Verdict:** Confirmed. The network list comes from a primary source; the dates come from secondary sources.
    - **Evidence:**
      - Phantom's help-center "Supported networks" page lists Solana, Ethereum, Robinhood Chain, Arc, HyperEVM, Bitcoin, Base, Polygon and BNB Chain.
      - Monad is absent. Arbitrum, Optimism, Avalanche, Unichain and Linea are named as unsupported.
      - The RH help page confirms receiving, swapping and connecting to apps on RH, and says ETH on RH is needed for gas.
      - The launch dates come from Solana Compass and the press. One report places the RH launch around 07-24 rather than 07-23.
    - **Sources:** https://help.phantom.com/hc/en-us/articles/41372840389651-Supported-networks-chains-in-Phantom · https://help.phantom.com/hc/en-us/articles/53628774801683-Get-started-with-Robinhood-Chain-in-Phantom · https://solanacompass.com/news/phantom-wallet-adds-bnb-chain-support-making-it-the-apps-ninth-network

14. **Claim (§9, open Q11):** Etherscan V2 covers `chainid=4663` (robin.etherscan.io), "free tier presumably". BSC and Base need a paid plan (Lite at $49/month).
    - **Verdict:** Corrected, and it matters for the launch window.
    - **Evidence:**
      - The chainlist includes 4663, and Arc 5042 at arc.etherscan.io.
      - The supported-chains page says RH and Arc "community endpoints are free until October 15, 2026". It adds: "Effective October 16, 2026, they require a Lite plan or above." Only the source-code and ABI endpoints stay free.
      - BSC and Base are marked "Paid Tier Only".
      - Lite costs $49/month for 5 calls/s and 100k calls/day.
    - **Implication:** the launch (~2026-10-29) falls after the free window. Budget for Lite, or use Blockscout or GoldRush for RH.
    - **Sources:** https://api.etherscan.io/v2/chainlist · https://docs.etherscan.io/supported-chains · https://etherscan.io/apis

15. **Claim (Summary 1, §1):** DefiLlama 30-day launchpad fees are Solana $111.6M, RH $94.9M (Pons V2 $86.5M), BSC $42.9M (Flap $37.1M), Arc $5.67M and Base $2.12M. On DEX volume, RH is #2 at $47.4B.
    - **Verdict:** Confirmed, with a caveat on method.
    - **Launchpad fees (chain-filtered fees endpoints):**

      | Chain | 30d launchpad fees | Leading pads |
      |---|---|---|
      | Solana | $111.59M | — |
      | Robinhood Chain | $94.94M | Pons V2 $86.54M, Pons V1 $2.78M, NOXA $1.93M, Pools $0.75M |
      | BSC | $42.86M | Flap $37.13M, Genius.fun $3.79M, four.meme $0.26M |
      | Arc | $5.67M | Argus $4.81M |
      | Base | $2.12M | — |

    - **DEX volume (30d, $B):** the two DefiLlama methods disagree.

      | Method | Solana | RH | Ethereum | BSC | Base | Arc |
      |---|---|---|---|---|---|---|
      | Sum of `breakdown30d` from `/overview/dexs` (matches the report exactly) | 87.56 | 47.36 | 44.13 | 34.01 | 30.55 | 1.41 |
      | Per-chain `/overview/dexs/{chain}` | 76.4 | 45.25 | 44.01 | — | — | — |

      RH stays #2 either way, but on the per-chain method it is only about 3% ahead of Ethereum.
    - **Sources:** https://api.llama.fi/overview/fees/Robinhood (also `/BSC`, `/Base`, `/Arc`, `/Solana`) · https://api.llama.fi/overview/dexs

### Other spot checks (confirmed unless stated)

- **RH chain and RPC:** `eth_chainId` = `0x1237` (4663). `eth_simulateV1` works on the RH, BSC (publicnode) and Base (publicnode) public RPCs. Arc returns "method not supported: eth_simulateV1".
- **viem (corrected):**
  - `robinhood` first appears in 2.55.0 (2026-07-08) and `arc` in 2.49.3 (2026-05-16).
  - But `arc.rpcUrls.default.http` was **empty** until 2.57.0 (2026-09-29), and `rpc.ordofi.network` was added to `robinhood` only in 2.57.0.
  - The newest release that is at least two weeks old today is 2.56.0 (2026-08-26), which still has the empty Arc RPC list.
  - So when pinning 2.56.0 or earlier, always pass `ARC_RPC` explicitly (or use `defineChain`).
  - Sources: https://registry.npmjs.org/viem and https://unpkg.com/viem@2.56.0/_esm/chains/definitions/arc.js
- **GoPlus:** 4663 and 5042 are in `supported_chains`. `token_security/4663` for CASHCAT returns `is_honeypot 0`, open source and 113,147 holders, but its `buy_tax` and `sell_tax` fields are **empty**. Do not use GoPlus as the tax gate on RH.
- **Zora:** `getVersionForDeployedCoin` returns 4 for a new coin and 0 for ZORA and WETH. There were 121 `CoinCreatedV4` events in 1,500 blocks.
- **Argus (Arc):** `tokenCount()` = 179,303, `MAX_TAX_BPS` 1000, `POOL_FEE` 10000, `TICK_SPACING` 200, `treasuryBps` 1000. The Portal is not an EIP-1967 proxy.
- **Pools.trade:** `ownerOf(409801)` = `0x7198c32a…4b8f`. Its dispatcher resolves to `onERC721Received`, `getSplits`, `collectFees(uint256[])`, `increaseLiquidity(...)`, `poolManager`, `positionManager` and constants. There is no withdraw function, no owner and no proxy.
- **v4 hook flag bits** in §8 match v4-core `Hooks.sol` (bits 9, 7, 6, 3, 2 and 0).
  - Pons MemeHook = beforeInitialize + afterSwap + afterSwapReturnsDelta.
  - DopplerHookInitializer adds afterAddLiquidity and afterRemoveLiquidity to those.
- **Not re-checked (unverified here):**
  - Noxa and Pons V1 timeline percentages.
  - Doppler launch counts per integrator.
  - The BONER/HIMS squeeze figures.
  - Relay's blocking of malicious contracts.
  - GMGN, fomo and Axiom fee shares.
  - The Genius.fun contracts.

### What this changes for the build

- **Use two route providers at intake: Relay's own `/quote` plus LI.FI.** Simulate both and take the better `toAmount`.
  - LI.FI alone misses four.meme curve bags, and on RH it depends entirely on Relay.
  - Relay alone misses some Flap-BSC curve bags that LI.FI routes through OKX.
  - Keep deBridge DLN as a paid fallback for RH.
  - Drop Across from the RH→SOL list.
- **Treat curve-sell adapters as a fallback, not a launch requirement.** Build them only for Flap-RH, sell-tax Flap curve tokens, Bags, LetsCash and o1.
- **Pons V2 is permissionless today**, so the anti-farming rules are mandatory.
- **Fix the stock-token gate:** call `isBlocked` on the registry, check `tokenPaused`, and flag the `adminBurn` risk.
- **Budget Etherscan Lite from 2026-10-16**, or use Blockscout or GoldRush instead.
- **Pass explicit RPC URLs when pinning viem 2.56.0 or earlier.**
