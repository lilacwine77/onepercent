import { MAINNET_RELEASE, ONEPERCENT_PROGRAM_IDS } from "./mainnet-release.js";
export { MAINNET_RELEASE, ONEPERCENT_PROGRAM_IDS } from "./mainnet-release.js";
import {
  CARDS_PER_PACK,
  HIT_TIERS,
  HTTP_TIMEOUT_MS,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  SELL_BACK,
  TOKEN_1PCT,
  WEB,
} from "./constants.js";
export {
  CARDS_PER_PACK,
  HIT_TIERS,
  MILLISECONDS_PER_MINUTE,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  SELL_BACK,
  TOKEN_1PCT,
  WEB,
} from "./constants.js";
export type { EditionId } from "./constants.js";
export {
  MAINNET_GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  SOLANA_GENESIS_HASHES,
} from "./genesis.js";
export {
  FEED_BACK_DEFAULT_MIX,
  FEED_BACK_RANGE,
  feedBackEstimate,
  feedOutlook,
  feedUpTo,
} from "./feed-back.js";
import { z } from "zod";
export {
  DEVNET_MAJOR_PROFILE,
  devnetMajorFixtureProfile,
} from "./devnet-major.js";
import { SERVICES, servicesSchema } from "./services.js";
export { SERVICES, serviceTransportSchema } from "./services.js";
export {
  serviceIndexerSchema,
  serviceApiSchema,
  serviceSignersSchema,
  serviceQuoteSchema,
  servicesSchema,
} from "./services.js";
export { BANNED_COPY, BANNED_EVERYWHERE } from "./vocabulary.js";

// CALIBRATED — docs/codex/PARAMS.md (2026-10-08). Tags: [CONST] compiled into the program
// (generated params.rs) · [CONFIG] on-chain Config field · [STATE] on-chain Machine state
// · [OFF] off-chain only · [EXT] external fact. Untagged keys inherit their block's tag.

// ── Units ─────────────────────────────────────────────────────────── [CONST]
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BPS_DENOMINATOR = 10_000;
export const PPB_DENOMINATOR = 1_000_000_000;
// [OFF] examples and tests only. Code reads the Rent sysvar / getMinimumBalanceForRentExemption.
export const RENT_EXAMPLE_LAMPORTS_PER_BYTE = 5_080;
export const RENT_TEST_RATES_LAMPORTS_PER_BYTE = [
  5_080, 2_575, 1_322, 696, 6_960,
] as const;

export const MAX_LIST_PER_RIP_LAMPORTS = 5_000_000_000n; // maxPerRip × price ≤ this (one VRF request)

// CARDS_PER_PACK, HIT_TIERS, SELL_BACK and TOKEN_1PCT live in constants.ts (browser entry).

// ── Card kinds ───────────────────────────────────────────────────── [CONST]
// On-chain card kind = index in this array (u8).
export const CARD_KINDS = [
  "dust",
  "silver",
  "blue",
  "holo",
  "black",
  "jackpot",
  "one_pct",
  "spotlight",
  "final",
] as const;

// ── Odds (ppb of t ∈ [0, 1e9)) ───────────────────────────────────── [CONST]
export const HIT_ODDS = {
  blackPpb: 2_500_000, // 1 in 400, every edition
  holoPpb: 20_000_000, // 1 in 50, every edition
  bluePpb: {
    original: 113_925_000,
    blue_shift: 114_187_500,
    signature: 114_625_000,
    after_hours: 115_500_000,
  },
  jackpotPriceDivisor: 400, // jackpot_ppb = priceLamports / 400, only while live [C13]
  onePctPriceDivisor: 1_000, // onepct_ppb = priceLamports / 1_000, only while a card is live [C13]
  spotlightPriceDivisor: 500, // spotlight_ppb = priceLamports / 500, only during a live drop [C20]
  // Walk order; Silver = 1e9 − Σ live segments.
  walkOrder: ["one_pct", "spotlight", "jackpot", "black", "holo", "blue"],
  calibratedStockEvBps: 7_200, // Σ valueBps·ppb == 7_200·1e9 with Jackpot and The 1% live, non-holder
} as const;

export const DRAW_TAGS = {
  tier: "1pct:tier:v1",
  dust: "1pct:dust:v1",
  bucket: "1pct:bucket:v1",
  vrfSeed: "1pct:vrf:v1",
  royaltyMemoPrefix: "1pct:roy:",
} as const;

// ── Coverage and Deck ────────────────────────────────────────────── [CONST]
export const COVERAGE = {
  perPackValueBps: 150_000, // free MAJOR book reserved per pending pack = 15 × price (Black Foil) [C8]
  dustBuffer: 50, // buy_packs needs deck.len − reserved_dust ≥ 4·qty + 50 [C10]
  deckMax: 120_000, // Deck entries
} as const;

// ── Feed ─────────────────────────────────────────────────────────── [CONST] unless tagged
export const FEED_RULES = {
  launchpads: ["pump.fun"],
  holdRule: "snapshot", // [C1] was minHoldSeconds: 72 * 3600 — snapshot slot S lives in Config (PARAMS §6–§7)
  oneCardPerWalletPerMint: true, // fresh cards only; re-fed cards are exempt
  freshCapPerWallet: 25, // [C1] was maxCardsPerWallet: null
  maxMintDecimals: 9,
  allowedToken2022Extensions: ["MetadataPointer", "TokenMetadata"],
  sellDefaultAboveLamports: 2_000_000n, // [OFF] Sell is the default above 0.002 SOL
  confirmAboveLamports: 20_000_000n, // [OFF] explicit confirmation above 0.02 SOL (bags and hits)
} as const;

export const ATTESTATIONS = {
  feedTtlSeconds: 120,
  holdTtlSeconds: 600, // [C15]
  feedDomain: "1PCT-FEED-v1",
  holdDomain: "1PCT-HOLD-v1",
  sellBackDomain: "1PCT-SB-v1",
} as const;

// ── Stock (on-chain bounds) ──────────────────────────────────────── [CONST]
export const STOCK = {
  maxBuckets: 16,
  targetBaseLamports: 30_000_000_000n, // [C7] Sell back target = this + hit_out_last_hour
  creatorFeeFloorLamports: 2_000_000_000n, // [D27] creator-fee floor, independent of the target
  majorTrancheMaxLamports: 5_000_000_000n,
  majorMinOutSlipBps: 150, // vs Pyth
  trendingTrancheMaxLamports: 1_500_000_000n,
  trendingHourlyMaxLamports: 10_000_000_000n, // per mint per clock hour; buys and sells counted separately [C25]
  trendingShareMaxBps: 1_500, // [C5] of stock book value, after the buy
  trendingMaxCount: 4, // [C5]
  trendingPoolFeeAllowanceBps: 125,
  trendingMinOutSlipBps: 100, // after the fee allowance
  pythMaxAgeSeconds: 60,
  pythMaxConfBps: 100,
  tradeMinSpacingSeconds: 20, // [C25] one last_stock_trade_ts shared by StockBuy and StockSell
  hourlyFloorLamports: 30_000_000_000n, // [C25] per clock hour, StockBuy and StockSell each: cap = max(this, multiple × carved)
  hourlyHitOutMultiple: 2, // [C25] carved = max(hit_out_last_hour, hit_out_this_hour); MAJOR sells skip the cap in BuysClosed
} as const;

// ── Jackpot: continuous pre-buy ──────────────────────────────────── [CONST] [C12, J-B]
export const JACKPOT = {
  minPotPriceMultiple: 15, // live in edition E iff jackpot_cost ≥ 15 × price(E)
  trancheMaxLamports: 2_000_000_000n, // JackpotBuy tranche ≤ min(jackpot_sol, this, 1% of quote reserves)
  trancheMaxBpsOfQuoteReserves: 100,
  trancheMinSpacingSeconds: 20,
  minOutSlipBps: 100,
} as const;

// ── Spotlight (flag) ─────────────────────────────────────────────── [CONST] unless tagged [C20]
export const SPOTLIGHT = {
  enabledAtLaunch: false, // [OFF] D1: absent throughout Season 1
  windowSeconds: 86_400,
  minDepositBpsOfSupply: 100, // ≥ 1% of the mint's supply, measured as a vault delta
  lineupNoticeSeconds: 86_400, // [OFF]
} as const;

// ── Buy & burn ───────────────────────────────────────────────────── [CONST]
export const BURN = {
  trancheMaxLamports: 1_000_000_000n,
  trancheMaxBpsOfQuoteReserves: 25,
  minSpacingSeconds: 20,
  hourlyMaxLamports: 10_000_000_000n, // per clock hour
  minOutSlipBps: 150,
} as const;

// Creator fees (bps of each collection), D27, compiled constants.
export const CREATOR_FEE_SPLIT_BPS = {
  belowFloor: { stock: 10_000, burn: 0, team: 0 },
  season: { stock: 5_000, burn: 0, team: 5_000 },
  afterEnd: { stock: 0, burn: 0, team: 10_000 },
} as const;

// ── Season ───────────────────────────────────────────────────────── [CONST] unless tagged
export const SEASON = {
  durationDays: 7, // [OFF]
  durationSeconds: 604_800,
  onAirDelaySeconds: 900, // [C18]
  lastCallSeconds: 86_400, // [OFF] countdown only
  finalPullDelaySeconds: 600,
  sealDelaySeconds: 259_200, // [C23]
} as const;

// ── VRF ──────────────────────────────────────────────────────────── tagged per key
export const VRF = {
  timeoutSeconds: 300, // [CONST] [C22]
  feeLamports: 500_000n, // [EXT] MagicBlock base-layer fee; buyer pays once per Rip; not refunded
  maxQueues: 4, // [CONFIG] allow-list length
  busyOccupancyBps: 8_000, // [OFF] client disables Rip above 80% occupancy
  busyOldestItemSeconds: 20, // [OFF] or when the oldest item is older than this
} as const;

// ── Accounts (data bytes; rent = (128 + n) × Rent sysvar rate) ───── [CONST]
export const ACCOUNT_SIZES = {
  deckHeader: 64,
  deckEntry: 80,
  binderHeader: 112,
  cardSlot: 56,
  pullHeader: 176,
  pullPerPack: 200,
  mintLedger: 80,
  accountOverhead: 128, // [EXT] added to every account for rent
  vaultSpl: 165, // [EXT] SPL token account
  vaultToken2022: 170, // [EXT] Token-2022 ATA (ImmutableOwner)
} as const;

// ── Governance ───────────────────────────────────────────────────── [CONST] encodings, [CONFIG] values [C23]
// stockBuy pauses StockBuy and StockSell; burn pauses Burn and JackpotBuy. No exit reads a bit.
export const PAUSE_BITS = {
  rip: 1,
  feed: 2,
  sellBack: 4,
  stockBuy: 8,
  burn: 16,
} as const;
export const GOVERNANCE = {
  maxTeamWallets: 8, // [CONFIG] Config.team_wallets length
  guardianCount: 2, // [CONFIG]
  multisigThreshold: 1, // [OFF] D31: one founder wallet
  multisigMembers: 1, // [OFF] D31
  timelockSeconds: 0, // [OFF] D31: no timelock
  opsWalletMaxLamports: 5_000_000_000n, // [OFF] D18: ops wallet capped at 5 SOL.
  initRentBufferMaxLamports: 50_000_000n, // [OFF] M1 A8: initialize rent buffer bound.
} as const;

// ── Off-chain policy ─────────────────────────────────────────────── [OFF]
export const POST_REVEAL_BUY_DELAY = 30;
export const KEEPER_POLICY = {
  cycleSecondsMin: 60,
  cycleSecondsMax: 120,
  anchorMultipleOfTopBlack: 2, // largest-free MAJOR keeps ≥ 2 × 15 × price(largest edition the stock can open)
  inventoryTargetMinutes: 30,
  solReserveExtraMinutes: 15, // stock_sol ≥ SELL_BACK.solFloorLamports + 15 min of recent Sell back outflow
  revealDelaySecondsMin: POST_REVEAL_BUY_DELAY,
  revealDelaySecondsMax: 120,
  maxQuotedImpactBps: 50,
  creatorFeeCollectSecondsMin: 120, // also right before PoweredOn→OnAir and in the last minute before end_ts
  creatorFeeCollectSecondsMax: 300,
  // PARAMS issue 4 (pending), 04-M4-BRIEF.md §4.3.
  creatorFeeFinalCollectLeadSeconds: 60,
} as const;
export const EXECUTOR_POLICY = {
  jackpotTrancheSpacingSecondsMin: 20,
  jackpotTrancheSpacingSecondsMax: 60,
  // PARAMS issue 4 (pending), 04-M4-BRIEF.md §4.3; minimum decided by D16.
  burnTrancheSpacingSecondsMin: 20,
  burnTrancheSpacingSecondsMax: 60,
  minTrancheLamports: 50_000_000n,
} as const;
// [OFF] PARAMS issue 4 (pending), 04-M4-BRIEF.md §4.3.
export const BLOCK0 = { slots: 20 } as const;

export const TX_LIMITS = {
  feedBagsPerTx: 1, // M1 signed legacy measurement with 15% byte headroom
  feedBagsPerTxWithLookupTable: 2, // M1 signed v0 maximum; builder narrows for first-vault + budgets
  redeemPerTx: 8,
  takeBackPerTx: 8,
  settlePacksPerTx: 2,
  txPerSignAll: 8,
  byteHeadroomBps: 1_500,
  maxTxBytes: 1_232,
} as const;

// [OFF] Max of cu.json and real-vrf.json measurements; 25% headroom, rounded up to 1,000 CU.
export const CU_LIMITS = {
  powerOn: 51000,
  collectCreatorFees: 22000,
  claimLaunchFees: {
    curve: 144000,
    pool: 143000,
    surplus: 84000,
  },
  feeChainTx: {
    curve: 153000,
    pool: 168000,
    surplus: 102000,
  },
  buyPacks: {
    x1: 107000,
    x10: 109000,
  },
  feed: [96000, 175000, 230000, 313000, 363000, 419000],
  redeem: {
    x1: 92000,
    x8: 502000,
  },
  refundPull: 13000,
  settle: [50000, 83000],
  takeBack: 89000,
  // P2 fixtures/reports/mycards.json: complete transactions, 25% headroom.
  sellBack: { x1: 41000, x8: 56000 },
  feedBack: { x1: 86000, x8: 105000 },
  closeBinder: 17000,
  withdrawOwed: 17000,
  // m2-exec.json: T12.16 + validator maxima, 25% headroom, rounded up to 1,000.
  execBegin: 77000,
  execEnd: 55000,
} as const;

// [CONST] Shared by every cluster; only the launch config pin varies.
const METEORA_EXEC = {
  feeAllowBps: 300,
  dammV2Config: "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck",
} as const;

export const HIT_LIST = {
  launchMajors: [
    {
      symbol: "WIF",
      mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
      decimals: 6,
      pythFeedId:
        "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
    },
    {
      symbol: "BONK",
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      decimals: 5,
      pythFeedId:
        "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
    },
    {
      symbol: "POPCAT",
      mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
      decimals: 9,
      pythFeedId:
        "b9312a7ee50e189ef045aa3c7842e099b061bd9bdc99ac645956c3b660dc8cce",
    },
    {
      symbol: "FARTCOIN",
      mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
      decimals: 6,
      pythFeedId:
        "58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608",
    },
    {
      symbol: "PNUT",
      mint: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
      decimals: 6,
      pythFeedId:
        "116da895807f81f6b5c5f01b109376e7f6834dc8b51365ab7cdfa66634340e54",
    },
  ],
  solUsdPythFeedId:
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  neverListed: ["PUMP", "1PCT"], // [C4]
  majorBar: {
    minAgeDays: 90,
    minLiquidityUsd: 1_000_000,
    sell150SolMinRecoveryBps: 9_700,
    maxDailySigmaBps: 1_500,
  },
  trendingBar: {
    minGraduatedDays: 7,
    minPoolQuoteLamports: 300_000_000_000n,
    minHolders: 5_000,
    maxTop10Bps: 2_500,
    minOrganicScore: 50,
  }, // [C5]
  dailyRecheckUtc: "12:00",
  trendingNoticeSeconds: 86_400,
  capMaxPriceImpactBps: 200,
} as const;

export const XRAY = {
  cacheSeconds: 86_400,
  rateLimitPerMinutePerIp: 60,
  turnstileAfterRequests: 10,
  accountsPerBatch: 100,
  priceIdsPerCall: 50,
  sellMinLamports: 2_000_000n,
  priceMaxAgeSlots: 54_000, // D7: X-ray display estimates only; executable quotes keep their own limit
  maxTokenAccounts: 2_000, // more → wallet_too_large
  cacheMaxEntries: 5_000, // in-memory scan results
} as const;

// FEED and HOLD attestation requests, Feed Blink included. Signing has no side effect (PARAMS §6.2).
export const INTAKE = {
  rateLimitPerMinutePerWallet: 30,
  rateLimitPerMinutePerIp: 60,
} as const;

export const BOT = {
  sessionTtlSeconds: 600,
  maxMessagesPerSecond: 25,
  hitPostMinKind: "holo",
  maxMessageLines: 6,
} as const;
export const BLINKS = {
  liveNumbersMaxAgeSeconds: 60,
  ripQuantities: [1, 5],
  imagePx: 1_080,
} as const;
export const UI = {
  keepBalanceWarningLamports: 10_000_000n,
  stillCrankingAfterSeconds: 5,
  tickerMaxChars: 10,
} as const;
export const MONITOR = {
  feeInSilenceAlertSeconds: 600,
  vrfExpiriesPerThousandRipsAlert: 1,
  vrfQueueOccupancyAlertBps: 5_000, // alert above 50%, before the client's 80% "Machine busy"
} as const;

// ── Addresses (verified on mainnet 2026-10-08) ───────────────────── [CONST]/[EXT]
export const PROGRAM_IDS = {
  meteoraDbc: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  meteoraDammV2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  pumpFun: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpSwap: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  magicblockVrf: "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
  splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  ed25519: "Ed25519SigVerify111111111111111111111111111",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  squadsV4: "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf",
  pythReceiver: "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp",
  // PARAMS issue 3 §21: off-chain only, excluded from ONCHAIN_KEYS.
  pythPushOracle: "pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou",
  pythWormholeReceiver: "HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL",
} as const;
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
// D29: the localnet/devnet signer is public test material, never a mainnet key.
export const METEORA_BY_CLUSTER = {
  localnet: { dbcConfig: "AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k" },
  devnet: { dbcConfig: "AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k" },
  mainnet: { dbcConfig: MAINNET_RELEASE.dbcConfig ?? "PENDING" },
} as const;
export type ProgramCluster = keyof typeof METEORA_BY_CLUSTER;

export function parseProgramCluster(value = "localnet"): ProgramCluster {
  if (value === "mainnet-beta") return "mainnet";
  if (value === "localnet" || value === "devnet" || value === "mainnet")
    return value;
  throw new Error(`Unknown program cluster: ${value}`);
}

/** Explicit cluster selection for launch builders and compiled constants. */
export function meteoraForCluster(cluster: ProgramCluster): {
  readonly dbcConfig: string;
} & typeof METEORA_EXEC {
  const meteora: { readonly dbcConfig: string } = METEORA_BY_CLUSTER[cluster];
  if (meteora.dbcConfig === "PENDING")
    throw new Error(`METEORA_DBC_CONFIG is PENDING for ${cluster}`);
  if (
    cluster === "mainnet" &&
    (meteora.dbcConfig === METEORA_BY_CLUSTER.localnet.dbcConfig ||
      meteora.dbcConfig === METEORA_BY_CLUSTER.devnet.dbcConfig)
  )
    throw new Error("METEORA_DBC_CONFIG cannot use a test key on mainnet");
  return { ...meteora, ...METEORA_EXEC };
}

// Tests and checked-in generated artifacts use localnet. Production callers
// must select their cluster through meteoraForCluster; there is no RPC guess.
export const METEORA = meteoraForCluster("localnet");
export const VRF_QUEUES = {
  mainnetShared: "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
  devnetTest: "GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb",
} as const;
export const PUMP_LAYOUTS = {
  bondingCurveSeed: "bonding-curve",
  bondingCurveDiscriminatorHex: "17b7f83760d8ac60",
  poolSeed: "pool",
  poolDiscriminatorHex: "f19a6d0411b16dbc",
} as const;

// Exact M1 compiled-key contract (01-M1-BRIEF.md §4.3).
export const ONCHAIN_KEYS = [
  { path: "LAMPORTS_PER_SOL", type: "u64" },
  { path: "BPS_DENOMINATOR", type: "u32" },
  { path: "PPB_DENOMINATOR", type: "u32" },
  { path: "PACK_EDITIONS[].priceLamports", type: "[u64; 4]" },
  { path: "PACK_EDITIONS[].maxPerRip", type: "[u32; 4]" },
  { path: "MAX_LIST_PER_RIP_LAMPORTS", type: "u64" },
  { path: "CARDS_PER_PACK.dust", type: "u32" },
  { path: "CARDS_PER_PACK.hit", type: "u32" },
  { path: "PACK_SPLIT_BPS.stock", type: "u32" },
  { path: "PACK_SPLIT_BPS.royaltyPerDustCard", type: "u32" },
  { path: "PACK_SPLIT_BPS.jackpot", type: "u32" },
  { path: "PACK_SPLIT_BPS.burn1pct", type: "u32" },
  { path: "PACK_SPLIT_BPS.referral", type: "u32" },
  { path: "PACK_SPLIT_BPS.team", type: "u32" },
  { path: "HIT_TIERS[].valueBps", type: "[u32; 4]" },
  { path: "HIT_TIERS[].majorOnly", type: "[bool; 4]" },
  { path: "HIT_TIERS[].sellBack", type: "[bool; 4]" },
  { path: "HIT_ODDS.blackPpb", type: "u32" },
  { path: "HIT_ODDS.holoPpb", type: "u32" },
  { path: "HIT_ODDS.jackpotPriceDivisor", type: "u32" },
  { path: "HIT_ODDS.onePctPriceDivisor", type: "u32" },
  { path: "HIT_ODDS.spotlightPriceDivisor", type: "u32" },
  { path: "HIT_ODDS.calibratedStockEvBps", type: "u32" },
  { path: "HIT_ODDS.bluePpb.{edition}", type: "[u32; 4]" },
  { path: "DRAW_TAGS.tier", type: "&[u8]" },
  { path: "DRAW_TAGS.dust", type: "&[u8]" },
  { path: "DRAW_TAGS.bucket", type: "&[u8]" },
  { path: "DRAW_TAGS.vrfSeed", type: "&[u8]" },
  { path: "DRAW_TAGS.royaltyMemoPrefix", type: "&[u8]" },
  { path: "COVERAGE.perPackValueBps", type: "u32" },
  { path: "COVERAGE.dustBuffer", type: "u32" },
  { path: "COVERAGE.deckMax", type: "u32" },
  { path: "FEED_RULES.freshCapPerWallet", type: "u32" },
  { path: "FEED_RULES.maxMintDecimals", type: "u32" },
  { path: "ATTESTATIONS.feedTtlSeconds", type: "i64" },
  { path: "ATTESTATIONS.holdTtlSeconds", type: "i64" },
  { path: "ATTESTATIONS.feedDomain", type: "&[u8]" },
  { path: "ATTESTATIONS.holdDomain", type: "&[u8]" },
  { path: "ATTESTATIONS.sellBackDomain", type: "&[u8]" },
  { path: "STOCK.maxBuckets", type: "u32" },
  { path: "STOCK.trendingMaxCount", type: "u32" },
  { path: "STOCK.majorMinOutSlipBps", type: "u32" },
  { path: "STOCK.trendingShareMaxBps", type: "u32" },
  { path: "STOCK.trendingPoolFeeAllowanceBps", type: "u32" },
  { path: "STOCK.trendingMinOutSlipBps", type: "u32" },
  { path: "STOCK.pythMaxConfBps", type: "u32" },
  { path: "STOCK.targetBaseLamports", type: "u64" },
  { path: "STOCK.creatorFeeFloorLamports", type: "u64" },
  { path: "STOCK.majorTrancheMaxLamports", type: "u64" },
  { path: "STOCK.trendingTrancheMaxLamports", type: "u64" },
  { path: "STOCK.trendingHourlyMaxLamports", type: "u64" },
  { path: "STOCK.pythMaxAgeSeconds", type: "i64" },
  { path: "SELL_BACK.payoutBps", type: "u32" },
  { path: "SELL_BACK.hourlyBudgetBpsOfStockSol", type: "u32" },
  { path: "SELL_BACK.solFloorLamports", type: "u64" },
  { path: "POST_REVEAL_BUY_DELAY", type: "i64" },
  { path: "HIT_LIST.trendingNoticeSeconds", type: "i64" },
  { path: "KEEPER_POLICY.solReserveExtraMinutes", type: "i64" },
  { path: "SELL_BACK.hourlyBudgetMinLamports", type: "u64" },
  { path: "SELL_BACK.quoteTtlSeconds.major", type: "i64" },
  { path: "SELL_BACK.quoteTtlSeconds.trending", type: "i64" },
  { path: "JACKPOT.minPotPriceMultiple", type: "u32" },
  { path: "JACKPOT.trancheMaxBpsOfQuoteReserves", type: "u32" },
  { path: "JACKPOT.minOutSlipBps", type: "u32" },
  { path: "JACKPOT.trancheMaxLamports", type: "u64" },
  { path: "JACKPOT.trancheMinSpacingSeconds", type: "i64" },
  { path: "TOKEN_1PCT.decimals", type: "u32" },
  { path: "TOKEN_1PCT.onePctCardCount", type: "u32" },
  { path: "TOKEN_1PCT.holderTier.onePctOddsMultiplierBps", type: "u32" },
  { path: "TOKEN_1PCT.devBuyAmount", type: "u64" },
  { path: "TOKEN_1PCT.onePctCardAmount", type: "u64" },
  { path: "TOKEN_1PCT.onePctReleaseOffsetsSeconds", type: "[i64; 4]" },
  { path: "SPOTLIGHT.windowSeconds", type: "i64" },
  { path: "SPOTLIGHT.minDepositBpsOfSupply", type: "u32" },
  { path: "BURN.trancheMaxBpsOfQuoteReserves", type: "u32" },
  { path: "BURN.minOutSlipBps", type: "u32" },
  { path: "BURN.trancheMaxLamports", type: "u64" },
  { path: "BURN.hourlyMaxLamports", type: "u64" },
  { path: "BURN.minSpacingSeconds", type: "i64" },
  { path: "CREATOR_FEE_SPLIT_BPS.belowFloor.stock", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.belowFloor.burn", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.belowFloor.team", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.season.stock", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.season.burn", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.season.team", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.afterEnd.stock", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.afterEnd.burn", type: "u32" },
  { path: "CREATOR_FEE_SPLIT_BPS.afterEnd.team", type: "u32" },
  { path: "SEASON.durationSeconds", type: "i64" },
  { path: "SEASON.onAirDelaySeconds", type: "i64" },
  { path: "SEASON.finalPullDelaySeconds", type: "i64" },
  { path: "SEASON.sealDelaySeconds", type: "i64" },
  { path: "VRF.timeoutSeconds", type: "i64" },
  { path: "VRF.maxQueues", type: "u32" },
  { path: "ACCOUNT_SIZES.deckHeader", type: "u32" },
  { path: "ACCOUNT_SIZES.deckEntry", type: "u32" },
  { path: "ACCOUNT_SIZES.binderHeader", type: "u32" },
  { path: "ACCOUNT_SIZES.cardSlot", type: "u32" },
  { path: "ACCOUNT_SIZES.pullHeader", type: "u32" },
  { path: "ACCOUNT_SIZES.pullPerPack", type: "u32" },
  { path: "ACCOUNT_SIZES.mintLedger", type: "u32" },
  { path: "PAUSE_BITS.rip", type: "u8" },
  { path: "PAUSE_BITS.feed", type: "u8" },
  { path: "PAUSE_BITS.sellBack", type: "u8" },
  { path: "PAUSE_BITS.stockBuy", type: "u8" },
  { path: "PAUSE_BITS.burn", type: "u8" },
  { path: "GOVERNANCE.maxTeamWallets", type: "u32" },
  { path: "GOVERNANCE.guardianCount", type: "u32" },
  { path: "PROGRAM_IDS.pumpFun", type: "Pubkey" },
  { path: "PROGRAM_IDS.pumpSwap", type: "Pubkey" },
  { path: "PROGRAM_IDS.magicblockVrf", type: "Pubkey" },
  { path: "PROGRAM_IDS.splToken", type: "Pubkey" },
  { path: "PROGRAM_IDS.token2022", type: "Pubkey" },
  { path: "PROGRAM_IDS.associatedToken", type: "Pubkey" },
  { path: "PROGRAM_IDS.ed25519", type: "Pubkey" },
  { path: "PROGRAM_IDS.memo", type: "Pubkey" },
  { path: "PROGRAM_IDS.computeBudget", type: "Pubkey" },
  { path: "PROGRAM_IDS.squadsV4", type: "Pubkey" },
  { path: "WSOL_MINT", type: "Pubkey" },
  { path: "PUMP_LAYOUTS.bondingCurveSeed", type: "&[u8]" },
  { path: "PUMP_LAYOUTS.poolSeed", type: "&[u8]" },
  { path: "PUMP_LAYOUTS.bondingCurveDiscriminatorHex", type: "[u8; 8]" },
  { path: "PUMP_LAYOUTS.poolDiscriminatorHex", type: "[u8; 8]" },
  // M2 B10: append without changing the M1 compiled-key contract.
  { path: "STOCK.tradeMinSpacingSeconds", type: "i64" },
  { path: "STOCK.hourlyFloorLamports", type: "u64" },
  { path: "STOCK.hourlyHitOutMultiple", type: "u32" },
  { path: "HIT_LIST.solUsdPythFeedId", type: "hex32" },
  { path: "PROGRAM_IDS.pythReceiver", type: "Pubkey" },
  { path: "PROGRAM_IDS.meteoraDbc", type: "Pubkey" },
  { path: "PROGRAM_IDS.meteoraDammV2", type: "Pubkey" },
  { path: "METEORA.dbcConfig", type: "Pubkey" },
  { path: "METEORA.feeAllowBps", type: "u32" },
  { path: "METEORA.dammV2Config", type: "Pubkey" },
] as const;

export const PARAMS = {
  POST_REVEAL_BUY_DELAY,
  SERVICES,
  LAMPORTS_PER_SOL,
  BPS_DENOMINATOR,
  PPB_DENOMINATOR,
  RENT_EXAMPLE_LAMPORTS_PER_BYTE,
  RENT_TEST_RATES_LAMPORTS_PER_BYTE,
  PACK_EDITIONS,
  MAX_LIST_PER_RIP_LAMPORTS,
  CARDS_PER_PACK,
  PACK_SPLIT_BPS,
  HIT_TIERS,
  CARD_KINDS,
  HIT_ODDS,
  DRAW_TAGS,
  COVERAGE,
  FEED_RULES,
  ATTESTATIONS,
  STOCK,
  SELL_BACK,
  JACKPOT,
  TOKEN_1PCT,
  SPOTLIGHT,
  BURN,
  CREATOR_FEE_SPLIT_BPS,
  SEASON,
  VRF,
  ACCOUNT_SIZES,
  PAUSE_BITS,
  GOVERNANCE,
  KEEPER_POLICY,
  EXECUTOR_POLICY,
  BLOCK0,
  TX_LIMITS,
  CU_LIMITS,
  HIT_LIST,
  XRAY,
  INTAKE,
  BOT,
  BLINKS,
  UI,
  MONITOR,
  PROGRAM_IDS,
  METEORA,
  WSOL_MINT,
  VRF_QUEUES,
  PUMP_LAYOUTS,
} as const;

export type Params = typeof PARAMS;
export type PackEdition = (typeof PACK_EDITIONS)[number];
export type HitTier = (typeof HIT_TIERS)[number];

/** Resolve one explicit compiled-key path; arrays retain edition/tier ordering. */
export function resolveOnchainKey(
  path: string,
  root: unknown = PARAMS,
): unknown {
  const segments = path.split(".");
  function visit(value: unknown, index: number): unknown {
    if (index === segments.length) return value;
    const segment = segments[index];
    if (!segment || value === null || typeof value !== "object") {
      throw new Error(`Unresolved parameter path: ${path}`);
    }
    if (segment === "{edition}") {
      return PACK_EDITIONS.map((edition) =>
        visit((value as Record<string, unknown>)[edition.id], index + 1),
      );
    }
    const array = segment.endsWith("[]");
    const key = array ? segment.slice(0, -2) : segment;
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined)
      throw new Error(`Unresolved parameter path: ${path}`);
    if (array) {
      if (!Array.isArray(child)) throw new Error(`Expected array: ${path}`);
      return child.map((item: unknown) => visit(item, index + 1));
    }
    return visit(child, index + 1);
  }
  return visit(root, 0);
}

/** Build a strict schema for every parameter block, including off-chain policy. */
function schemaFor(value: unknown): z.ZodType {
  if (value === SERVICES) return servicesSchema;
  if (typeof value === "bigint")
    return z
      .bigint()
      .nonnegative()
      .max((1n << 64n) - 1n);
  if (typeof value === "number")
    return z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  if (typeof value === "string") return z.string().min(1);
  if (typeof value === "boolean") return z.boolean();
  if (Array.isArray(value)) {
    return z
      .array(z.unknown())
      .length(value.length)
      .superRefine((items, context) => {
        items.forEach((item, index) => {
          const result = schemaFor(value[index]).safeParse(item);
          if (!result.success) {
            for (const issue of result.error.issues) {
              context.addIssue({
                code: "custom",
                path: [index, ...issue.path],
                message: issue.message,
              });
            }
          }
        });
      });
  }
  if (value !== null && typeof value === "object") {
    return z.strictObject(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, schemaFor(child)]),
      ),
    );
  }
  throw new Error("Unsupported parameter schema value");
}

function isPythProgramId(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let decoded = 0n;
  for (const char of value)
    decoded = decoded * 58n + BigInt(alphabet.indexOf(char));
  let bytes = value.match(/^1*/)?.[0].length ?? 0;
  for (; decoded > 0n; decoded >>= 8n) bytes += 1;
  return bytes === 32;
}

const refineParams: Parameters<z.ZodType["superRefine"]>[0] = (
  input,
  context,
) => {
  const p = input as Params;
  const check = (condition: boolean, path: string, message: string) => {
    if (!condition)
      context.addIssue({ code: "custom", path: path.split("."), message });
  };
  const bps = BigInt(p.BPS_DENOMINATOR);
  check(
    p.EXECUTOR_POLICY.burnTrancheSpacingSecondsMin >=
      p.BURN.minSpacingSeconds &&
      p.EXECUTOR_POLICY.burnTrancheSpacingSecondsMin <=
        p.EXECUTOR_POLICY.burnTrancheSpacingSecondsMax &&
      p.EXECUTOR_POLICY.jackpotTrancheSpacingSecondsMin >=
        p.JACKPOT.trancheMinSpacingSeconds &&
      p.EXECUTOR_POLICY.jackpotTrancheSpacingSecondsMin <=
        p.EXECUTOR_POLICY.jackpotTrancheSpacingSecondsMax,
    "EXECUTOR_POLICY",
    "Executor spacing must respect on-chain minima and ordered windows.",
  );
  check(
    p.EXECUTOR_POLICY.minTrancheLamports > 0n &&
      p.EXECUTOR_POLICY.minTrancheLamports <= p.BURN.trancheMaxLamports &&
      p.EXECUTOR_POLICY.minTrancheLamports <= p.JACKPOT.trancheMaxLamports,
    "EXECUTOR_POLICY.minTrancheLamports",
    "The minimum executor tranche must fit both on-chain caps.",
  );
  check(
    p.KEEPER_POLICY.creatorFeeFinalCollectLeadSeconds > 0 &&
      p.KEEPER_POLICY.creatorFeeFinalCollectLeadSeconds <
        p.KEEPER_POLICY.creatorFeeCollectSecondsMin,
    "KEEPER_POLICY.creatorFeeFinalCollectLeadSeconds",
    "The final collection lead must precede the normal cadence.",
  );
  check(
    p.BLOCK0.slots > 0,
    "BLOCK0.slots",
    "The Block-0 window must be positive.",
  );
  // PARAMS issue 3 §26.5, check 22; P0 completes M1's config handoff.
  check(
    p.XRAY.priceMaxAgeSlots >= MARKET.price.maxAgeSlots,
    "XRAY.priceMaxAgeSlots",
    "The X-ray display age must cover the stricter market estimate age.",
  );
  const pythProgramIds = [
    p.PROGRAM_IDS.pythReceiver,
    p.PROGRAM_IDS.pythPushOracle,
    p.PROGRAM_IDS.pythWormholeReceiver,
  ];
  for (const name of [
    "pythReceiver",
    "pythPushOracle",
    "pythWormholeReceiver",
  ] as const) {
    check(
      isPythProgramId(p.PROGRAM_IDS[name]),
      `PROGRAM_IDS.${name}`,
      "Pyth program ID must decode to 32 bytes.",
    );
  }
  check(
    new Set(pythProgramIds).size === pythProgramIds.length,
    "PROGRAM_IDS",
    "Pyth program IDs must be distinct.",
  );
  check(
    p.SERVICES.stock.pythSkipAgeSeconds < p.STOCK.pythMaxAgeSeconds,
    "SERVICES.stock.pythSkipAgeSeconds",
    "The sponsored-price reuse age must precede the on-chain age limit.",
  );
  const ppb = BigInt(p.PPB_DENOMINATOR);
  if (bps === 0n || ppb === 0n) {
    check(false, "BPS_DENOMINATOR", "Unit denominators must be positive");
    return;
  }
  const split = p.PACK_SPLIT_BPS;
  const royaltyBps = p.CARDS_PER_PACK.dust * split.royaltyPerDustCard;
  check(
    Object.entries(split).reduce(
      (sum, [key, value]) =>
        sum + (key === "royaltyPerDustCard" ? royaltyBps : value),
      0,
    ) === p.BPS_DENOMINATOR,
    "PACK_SPLIT_BPS",
    "The pack split, including each dust royalty, must total 10,000 bps.",
  );
  check(
    royaltyBps === 800,
    "PACK_SPLIT_BPS.royaltyPerDustCard",
    "Four dust royalties must total 800 bps.",
  );
  check(
    p.CARDS_PER_PACK.dust === 4 && p.CARDS_PER_PACK.hit === 1,
    "CARDS_PER_PACK",
    "Each pack contains four dust cards and one hit.",
  );
  p.HIT_TIERS.forEach((tier, index) => {
    const previous = p.HIT_TIERS[index - 1];
    check(
      !previous || tier.valueBps > previous.valueBps,
      "HIT_TIERS",
      "Hit tier values must be strictly increasing.",
    );
  });
  const odds = p.HIT_ODDS;
  const divisors = [
    odds.jackpotPriceDivisor,
    odds.onePctPriceDivisor,
    odds.spotlightPriceDivisor,
  ];
  if (divisors.some((divisor) => divisor <= 0)) {
    check(false, "HIT_ODDS", "Special-segment divisors must be positive.");
    return;
  }
  p.PACK_EDITIONS.forEach((edition, index) => {
    const price = edition.priceLamports;
    const previous = p.PACK_EDITIONS[index - 1];
    check(
      edition.index === index,
      "PACK_EDITIONS",
      "Edition indexes must match array order.",
    );
    check(
      price > 0n && (!previous || price > previous.priceLamports),
      "PACK_EDITIONS",
      "Pack prices must be strictly increasing.",
    );
    check(
      edition.maxPerRip > 0 &&
        BigInt(edition.maxPerRip) * price <= p.MAX_LIST_PER_RIP_LAMPORTS,
      "PACK_EDITIONS",
      "Rip quantity must fit the list-price limit.",
    );
    const jp = price / BigInt(odds.jackpotPriceDivisor);
    const onePct = price / BigInt(odds.onePctPriceDivisor);
    const spotlight = price / BigInt(odds.spotlightPriceDivisor);
    check(
      divisors.every((divisor) => price % BigInt(divisor) === 0n) &&
        (onePct * BigInt(p.TOKEN_1PCT.holderTier.onePctOddsMultiplierBps)) %
          bps ===
          0n,
      "HIT_ODDS",
      "Every special segment must be an exact integer.",
    );
    const blue = BigInt(odds.bluePpb[edition.id]);
    check(
      (jp + onePct) % 2n === 0n && blue === 113_750_000n + (jp + onePct) / 2n,
      "HIT_ODDS.bluePpb",
      "Blue must follow the calibrated formula.",
    );
    const black = BigInt(odds.blackPpb);
    const holo = BigInt(odds.holoPpb);
    const silver = ppb - onePct - jp - black - holo - blue;
    const values = p.HIT_TIERS.map((tier) => BigInt(tier.valueBps));
    check(
      (values[0] ?? 0n) * silver +
        (values[1] ?? 0n) * blue +
        (values[2] ?? 0n) * holo +
        (values[3] ?? 0n) * black ===
        BigInt(odds.calibratedStockEvBps) * ppb,
      "HIT_ODDS",
      "Stock EV must equal the calibrated integer identity.",
    );
    check(
      ppb -
        (onePct * BigInt(p.TOKEN_1PCT.holderTier.onePctOddsMultiplierBps)) /
          bps -
        spotlight -
        jp -
        black -
        holo -
        blue >
        0n,
      "HIT_ODDS",
      "Silver must remain positive with all segments present.",
    );
    check(
      [
        ...p.HIT_TIERS.map((tier) => tier.valueBps),
        ...Object.values(split),
      ].every((value) => (price * BigInt(value)) % bps === 0n),
      "PACK_EDITIONS",
      "Every tier and split must be an exact lamport amount.",
    );
  });
  const black = p.HIT_TIERS[3].valueBps;
  check(
    p.COVERAGE.perPackValueBps === black &&
      p.JACKPOT.minPotPriceMultiple * p.BPS_DENOMINATOR >= black,
    "COVERAGE",
    "Coverage and the Jackpot minimum must cover Black Foil.",
  );
  check(
    p.STOCK.targetBaseLamports ===
      (2n * p.PACK_EDITIONS[3].priceLamports * BigInt(black)) / bps,
    "STOCK.targetBaseLamports",
    "Stock target must fund two top Black Foils.",
  );
  for (const row of Object.values(p.CREATOR_FEE_SPLIT_BPS)) {
    check(
      Object.values(row).reduce<number>((a, b) => a + b, 0) ===
        p.BPS_DENOMINATOR,
      "CREATOR_FEE_SPLIT_BPS",
      "Every creator-fee split must total the denominator.",
    );
  }
  const token = p.TOKEN_1PCT;
  const offsets = token.onePctReleaseOffsetsSeconds;
  check(
    offsets.length === 4 &&
      offsets[0] === 0 &&
      offsets.every(
        (offset, index) =>
          index === 0 || offset > (offsets[index - 1] ?? offset),
      ) &&
      offsets[3] < p.SEASON.durationSeconds,
    "TOKEN_1PCT.onePctReleaseOffsetsSeconds",
    "Release offsets must increase within the season.",
  );
  check(
    p.SEASON.durationSeconds === p.SEASON.durationDays * 86_400,
    "SEASON",
    "Season days and seconds must agree.",
  );
  check(
    token.devBuyAmount * bps === token.totalSupply * BigInt(token.devBuyBps) &&
      token.devBuyAmount ===
        BigInt(token.onePctCardCount) * token.onePctCardAmount,
    "TOKEN_1PCT.devBuyAmount",
    "The disclosed dev buy must exactly fund The 1% cards.",
  );
  check(
    token.teamAllocation === 0n,
    "TOKEN_1PCT.teamAllocation",
    "The team token allocation must be zero.",
  );
  const royalty = (edition: number) =>
    ((p.PACK_EDITIONS[edition]?.priceLamports ?? 0n) *
      BigInt(split.royaltyPerDustCard)) /
    bps;
  check(
    p.FEED_RULES.sellDefaultAboveLamports === royalty(0) &&
      p.XRAY.sellMinLamports === royalty(0) &&
      p.FEED_RULES.confirmAboveLamports === royalty(3),
    "FEED_RULES",
    "Display thresholds must equal the designated royalties.",
  );
  check(
    p.COVERAGE.deckMax * p.ACCOUNT_SIZES.deckEntry +
      p.ACCOUNT_SIZES.deckHeader <=
      10_485_760 &&
      p.ACCOUNT_SIZES.pullHeader +
        p.ACCOUNT_SIZES.pullPerPack *
          Math.max(...p.PACK_EDITIONS.map((edition) => edition.maxPerRip)) <=
        10_240,
    "ACCOUNT_SIZES",
    "Account sizes must fit Solana allocation limits.",
  );
  const sellKinds = p.HIT_TIERS.filter((tier) => tier.sellBack).map(
    (tier) => tier.id,
  );
  check(
    p.SELL_BACK.payoutBps < p.BPS_DENOMINATOR &&
      p.SELL_BACK.quoteTtlSeconds.trending <=
        p.SELL_BACK.quoteTtlSeconds.major &&
      p.SELL_BACK.eligibleKinds.length === sellKinds.length &&
      p.SELL_BACK.eligibleKinds.every((kind) => sellKinds.includes(kind)),
    "SELL_BACK",
    "Sell back limits and eligible tiers must match the compiled tiers.",
  );
  const pauses = Object.values(p.PAUSE_BITS);
  check(
    new Set(pauses).size === pauses.length &&
      pauses.every((bit) => bit > 0 && (bit & (bit - 1)) === 0),
    "PAUSE_BITS",
    "Pause bits must be distinct powers of two.",
  );
  check(
    p.HIT_LIST.launchMajors.length <=
      p.STOCK.maxBuckets - p.STOCK.trendingMaxCount,
    "HIT_LIST",
    "The launch list must leave room for Trending.",
  );
  check(
    split.stock + split.jackpot === 7_700 &&
      Math.floor(
        Math.floor((p.SELL_BACK.payoutBps * split.stock) / p.BPS_DENOMINATOR) /
          50,
      ) *
        50 ===
        6_250,
    "PACK_SPLIT_BPS",
    "Public value and cash figures must match the calibrated splits.",
  );
  check(
    p.STOCK.tradeMinSpacingSeconds > 0 &&
      p.STOCK.hourlyHitOutMultiple >= 1 &&
      p.STOCK.hourlyFloorLamports >= p.STOCK.targetBaseLamports &&
      p.STOCK.hourlyFloorLamports >= p.STOCK.majorTrancheMaxLamports &&
      p.STOCK.trendingHourlyMaxLamports >= p.STOCK.trendingTrancheMaxLamports,
    "STOCK",
    "Stock trade bounds must contain their tranches.",
  );
  check(
    p.TX_LIMITS.feedBagsPerTx >= 1 &&
      p.TX_LIMITS.feedBagsPerTx <= p.TX_LIMITS.feedBagsPerTxWithLookupTable &&
      p.INTAKE.rateLimitPerMinutePerWallet >= p.FEED_RULES.freshCapPerWallet &&
      p.INTAKE.rateLimitPerMinutePerIp >=
        p.INTAKE.rateLimitPerMinutePerWallet &&
      p.MONITOR.vrfQueueOccupancyAlertBps < p.VRF.busyOccupancyBps,
    "TX_LIMITS",
    "Off-chain policy bounds must be consistent.",
  );
  check(
    p.CU_LIMITS.feed.length === 6 &&
      p.CU_LIMITS.settle.length === 2 &&
      [
        ...p.CU_LIMITS.feed,
        ...p.CU_LIMITS.settle,
        p.CU_LIMITS.takeBack,
        p.CU_LIMITS.buyPacks.x1,
        p.CU_LIMITS.buyPacks.x10,
        p.CU_LIMITS.refundPull,
        p.CU_LIMITS.redeem.x1,
        p.CU_LIMITS.redeem.x8,
        p.CU_LIMITS.sellBack.x1,
        p.CU_LIMITS.sellBack.x8,
        p.CU_LIMITS.feedBack.x1,
        p.CU_LIMITS.feedBack.x8,
        p.CU_LIMITS.closeBinder,
        p.CU_LIMITS.withdrawOwed,
        p.CU_LIMITS.powerOn,
        p.CU_LIMITS.collectCreatorFees,
        ...Object.values(p.CU_LIMITS.claimLaunchFees),
        ...Object.values(p.CU_LIMITS.feeChainTx),
        p.CU_LIMITS.execBegin,
        p.CU_LIMITS.execEnd,
      ].every(
        (value) => value > 0 && value <= 1_400_000 && value % 1_000 === 0,
      ),
    "CU_LIMITS",
    "Measured limits must be positive, fit the transaction maximum and round to 1,000 CU.",
  );
  for (const field of [
    "opsWalletMaxLamports",
    "initRentBufferMaxLamports",
  ] as const) {
    check(
      p.GOVERNANCE[field] === GOVERNANCE[field],
      `GOVERNANCE.${field}`,
      "Governance operational limits must match the approved values.",
    );
  }
  check(
    !p.SPOTLIGHT.enabledAtLaunch,
    "SPOTLIGHT",
    "Spotlight is absent in Season 1 (D1).",
  );
};

// Full validation remains on the service entry; browser consumers use ./web.
export const paramsSchema = /* @__PURE__ */ (() =>
  schemaFor(PARAMS).superRefine(refineParams))();

export function validateParams(params: unknown = PARAMS): Params {
  return paramsSchema.parse(params) as Params;
}

// ===== BEGIN X2 MARKET SECTION — owner: X2 (docs/codex/X2-MARKET-BRIEF.md). [OFF] =====
// Client behaviour and third-party facts only; no economic value. [EXT] verified 2026-10-08; [A] architect default.
export const MARKET = {
  http: {
    timeoutMs: HTTP_TIMEOUT_MS,
    maxAttempts: 4,
    backoffBaseMs: 250,
    backoffMaxMs: 4_000,
    rateLimitWaitMaxMs: 60_000,
  }, // [A]
  jupiter: {
    baseUrl: "https://api.jup.ag", // [EXT]
    planRequestsPerMinute: {
      keyless: 30,
      free: 60,
      developer: 600,
      launch: 3_000,
      pro: 9_000,
    }, // [EXT] per org, 60 s sliding
    plan: "developer", // SPEC §8.7: Developer plan, ≥ 10 RPS
    tokensMintsPerCall: 100, // [EXT]
    buildMaxAccounts: 40, // [A] leaves room for exec_begin / exec_end and compute budget in a v0 tx
    listingProbeExcludeRouters: ["jupiterz", "dflow", "okx"], // [A] Metis only = what /build executes
  },
  pyth: {
    defaultHermesUrl: "https://hermes.pyth.network",
    requestsPerMinute: 60,
  }, // [EXT] / [A]
  rpc: { slotCacheMs: 1_000, requestsPerMinute: 600 }, // [A]
  price: { maxAgeSlots: 13_500, cacheTtlMs: 10_000, missCacheTtlMs: 10_000 }, // [A] 13,500 slots ≈ 1 h at ≈ 0.27 s
  tokenInfo: { cacheTtlMs: 21_600_000 }, // [A] 6 h
  solUsd: { cacheTtlMs: 5_000, fallbackToJupiter: true }, // [A]
  exitCap: { curveFeeBps: 125 }, // [EXT] pump curve 0.95% protocol + 0.30% creator, SOL pairs
  ladder: { maxRungs: 12, stopBelowRecoveryBps: 5_000 }, // [A] research/valuation.md STEP 1
  listing: {
    majorSellProbeLamports: 150_000_000_000n,
    sigmaWindowDays: 7,
    largestAccountsScanned: 20,
  }, // SPEC §3.4
} as const;

const marketPositiveInteger = z.number().int().positive();
const marketBps = z.number().int().min(0).max(10_000);
export const marketParamsSchema = z
  .strictObject({
    http: z.strictObject({
      timeoutMs: marketPositiveInteger,
      maxAttempts: marketPositiveInteger,
      backoffBaseMs: marketPositiveInteger,
      backoffMaxMs: marketPositiveInteger,
      rateLimitWaitMaxMs: marketPositiveInteger,
    }),
    jupiter: z.strictObject({
      baseUrl: z.url(),
      planRequestsPerMinute: z.record(z.string(), marketPositiveInteger),
      plan: z.string(),
      tokensMintsPerCall: marketPositiveInteger.max(100),
      buildMaxAccounts: marketPositiveInteger.max(64),
      listingProbeExcludeRouters: z.array(z.string()),
    }),
    pyth: z.strictObject({
      defaultHermesUrl: z.url(),
      requestsPerMinute: marketPositiveInteger,
    }),
    rpc: z.strictObject({
      slotCacheMs: marketPositiveInteger,
      requestsPerMinute: marketPositiveInteger,
    }),
    price: z.strictObject({
      maxAgeSlots: marketPositiveInteger,
      cacheTtlMs: marketPositiveInteger,
      missCacheTtlMs: marketPositiveInteger,
    }),
    tokenInfo: z.strictObject({ cacheTtlMs: marketPositiveInteger }),
    solUsd: z.strictObject({
      cacheTtlMs: marketPositiveInteger,
      fallbackToJupiter: z.boolean(),
    }),
    exitCap: z.strictObject({ curveFeeBps: marketBps }),
    ladder: z.strictObject({
      maxRungs: marketPositiveInteger,
      stopBelowRecoveryBps: marketBps,
    }),
    listing: z.strictObject({
      majorSellProbeLamports: z.bigint().positive(),
      sigmaWindowDays: marketPositiveInteger,
      largestAccountsScanned: marketPositiveInteger,
    }),
  })
  .superRefine((params, ctx) => {
    if (!(params.jupiter.plan in params.jupiter.planRequestsPerMinute)) {
      ctx.addIssue({
        code: "custom",
        path: ["jupiter", "plan"],
        message: "Plan must be present in the rate table.",
      });
    }
  });
export function validateMarketParams(
  params: unknown = MARKET,
): z.infer<typeof marketParamsSchema> {
  return marketParamsSchema.parse(params);
}
// ===== END X2 MARKET SECTION =====

// ===== BEGIN M3 WEB SECTION — validation of shared constants
const webPositiveInteger = z.number().int().positive();
const webBase58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const webPublicKey = z.string().refine((value) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let decoded = 0n;
  for (const char of value)
    decoded = decoded * 58n + BigInt(webBase58.indexOf(char));
  let bytes = value.match(/^1*/)?.[0].length ?? 0;
  for (; decoded > 0n; decoded >>= 8n) bytes += 1;
  return bytes === 32;
}, "Program ID must decode to 32 bytes");
const webSsePingSeconds = SERVICES.api.ssePingSeconds;
export const webParamsSchema = z
  .strictObject({
    configRefreshMs: webPositiveInteger,
    machinePollMs: webPositiveInteger,
    machinePollHiddenMs: webPositiveInteger,
    liveStaleAfterMs: webPositiveInteger,
    sseFailuresBeforePoll: webPositiveInteger,
    streamDedupeMax: webPositiveInteger,
    streamFrameMaxBytes: webPositiveInteger,
    eventsPollMs: webPositiveInteger,
    pullPollFastMs: webPositiveInteger,
    pullPollFastForMs: webPositiveInteger,
    pullPollSlowMs: webPositiveInteger,
    rpcSignaturePageSize: webPositiveInteger.max(10),
    rpcConcurrency: webPositiveInteger,
    rpcCapacityMaxAttempts: webPositiveInteger,
    rpcCapacityBackoffBaseMs: webPositiveInteger,
    rpcCapacityBackoffMaxMs: webPositiveInteger,
    revealDataDeadlineMs: webPositiveInteger,
    confirmPollMs: webPositiveInteger,
    settlePrependAfterSeconds: webPositiveInteger,
    priorityFeeCapMicroLamports: webPositiveInteger,
    walletDetectMs: webPositiveInteger,
    valuesBatchMax: webPositiveInteger,
    valuesNowPerMinutePerIp: webPositiveInteger,
    logoMaxBytes: webPositiveInteger,
    logoTimeoutMs: webPositiveInteger,
    logoHosts: z
      .array(
        z
          .string()
          .max(253)
          .regex(
            /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
          ),
      )
      .min(1),
    sellMaxAccounts: webPositiveInteger,
    jupiterProgramIds: z.array(webPublicKey).min(1),
    beaconPerMinutePerIp: webPositiveInteger,
    millisecondsPerSecond: webPositiveInteger,
    httpTimeoutMs: webPositiveInteger,
    turnstileTimeoutMs: webPositiveInteger,
    turnstileTokenMaxLength: webPositiveInteger,
  })
  .superRefine((value, ctx) => {
    const relations: [boolean, string, string][] = [
      [
        value.rpcCapacityBackoffBaseMs <= value.rpcCapacityBackoffMaxMs,
        "rpcCapacityBackoffMaxMs",
        "RPC backoff maximum must cover its base delay",
      ],
      [
        value.rpcCapacityBackoffMaxMs < value.httpTimeoutMs,
        "rpcCapacityBackoffMaxMs",
        "RPC backoff must fit within the total HTTP deadline",
      ],
      [
        value.liveStaleAfterMs > 2 * webSsePingSeconds * 1_000,
        "liveStaleAfterMs",
        "Freshness must exceed two SSE ping intervals",
      ],
      [
        value.pullPollFastMs < value.pullPollSlowMs,
        "pullPollFastMs",
        "Fast Pull polling must be faster than slow polling",
      ],
      [
        value.machinePollMs < value.machinePollHiddenMs,
        "machinePollMs",
        "Visible Machine polling must be faster than hidden polling",
      ],
      [
        value.valuesBatchMax <= value.valuesNowPerMinutePerIp,
        "valuesBatchMax",
        "A values batch must fit within the per-minute limit",
      ],
    ];
    for (const [valid, field, message] of relations)
      if (!valid) ctx.addIssue({ code: "custom", path: [field], message });
  });
export function validateWebParams(
  value: unknown = WEB,
): z.infer<typeof webParamsSchema> {
  return webParamsSchema.parse(value);
}
// ===== END M3 WEB SECTION =====

// ===== BEGIN M6 RESCUE BLOCK (RESCUE-A) — 06-M6-BRIEF.md §4.2 [OFF] [A]
export const RESCUE = {
  cardMovedRetries: 3,
  scanConcurrency: 4,
} as const;
export const rescueParamsSchema = z.strictObject({
  cardMovedRetries: z.number().int().positive().safe(),
  scanConcurrency: z.number().int().positive().safe(),
});
export function validateRescueParams(value: unknown = RESCUE) {
  return rescueParamsSchema.parse(value);
}
// ===== END M6 RESCUE BLOCK =====

// ===== BEGIN M6 CLUSTER BLOCK (RC), 06-M6-BRIEF.md §4.2 [OFF]
// Public program ids of our own deployments, never a key file. D18 drops the
// canary. Mainnet stays null (PENDING P6) until the founder's offline-generated
// id is published; tools then refuse mainnet unless an id is passed explicitly.
// ONEPERCENT_PROGRAM_IDS lives in mainnet-release.ts (D32 release flow).
const publishedProgramId = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  .nullable();
export const programIdsSchema = z
  .strictObject({
    localnet: publishedProgramId.optional(),
    mainnet: publishedProgramId,
    devnet: publishedProgramId,
  })
  .refine(
    (ids) => ids.mainnet === null || ids.mainnet !== ids.devnet,
    "Published program ids must differ",
  );
export function validateProgramIds(value: unknown = ONEPERCENT_PROGRAM_IDS) {
  return programIdsSchema.parse(value);
}
// ===== END M6 CLUSTER BLOCK =====

// ===== BEGIN M5 BOT SECTION
// PARAMS issue 4 (pending) — 05-M5-BRIEF.md §4.2
export const BOT_OPS = {
  userLimits: {
    updatesPer60s: 20,
    xraysPer60s: 6,
    linksPer600s: 3,
    deepLinkRepliesPer600s: 10,
  },
  groupLimits: { repliesPer60s: 10 },
  apiLimits: {
    linkNoncesPerUserPer600s: 5,
    linkSessionPerIpPer60s: 30,
    linkVerifyPerIpPer60s: 10,
    goSessionsPerUserPer600s: 30,
    goRedeemPerIpPer60s: 30,
  },
  telegram: { perChatMinIntervalMs: 1_000, groupMaxPerMinute: 20 },
  notify: {
    pollMs: 2_000,
    lookbackSlots: 1_500,
    claimBatch: 200,
    coalesceRoyaltiesMax: 50,
    sendMaxAttempts: 3,
    maxAgeSeconds: { royalty: 3_600, hit: 900, digest: 21_600 },
    priority: { onePct: 0, jackpot: 0, royalty: 1, hit: 2, digest: 3 },
    retentionHours: 48,
  },
  digestHourUtc: 16,
  closedIdGraceSeconds: 60,
  lockRetrySeconds: 5,
  apiTimeoutMs: 12_000,
  machineCacheMs: 5_000,
  valueCacheMs: 60_000,
  symbolCacheSeconds: 86_400,
} as const;
export const BLINKS_OPS = {
  ripPostPerMinutePerAccount: 6,
  postPerMinutePerIp: 120,
  imagesPerMinutePerIp: 120,
  mintInfoCacheSeconds: 60,
  symbolCacheSeconds: 86_400,
  imageCacheEntries: 500,
} as const;

const botPositive = z.number().int().positive();
export const botOpsSchema = z
  .strictObject({
    userLimits: z.strictObject({
      updatesPer60s: botPositive,
      xraysPer60s: botPositive,
      linksPer600s: botPositive,
      deepLinkRepliesPer600s: botPositive,
    }),
    groupLimits: z.strictObject({ repliesPer60s: botPositive }),
    apiLimits: z.strictObject({
      linkNoncesPerUserPer600s: botPositive,
      linkSessionPerIpPer60s: botPositive,
      linkVerifyPerIpPer60s: botPositive,
      goSessionsPerUserPer600s: botPositive,
      goRedeemPerIpPer60s: botPositive,
    }),
    telegram: z.strictObject({
      perChatMinIntervalMs: botPositive,
      groupMaxPerMinute: botPositive.max(20),
    }),
    notify: z.strictObject({
      pollMs: botPositive,
      lookbackSlots: botPositive,
      claimBatch: botPositive,
      coalesceRoyaltiesMax: botPositive,
      sendMaxAttempts: botPositive,
      maxAgeSeconds: z.strictObject({
        royalty: botPositive,
        hit: botPositive,
        digest: botPositive,
      }),
      priority: z.strictObject({
        onePct: z.number().int().nonnegative(),
        jackpot: z.number().int().nonnegative(),
        royalty: botPositive,
        hit: botPositive,
        digest: botPositive,
      }),
      retentionHours: botPositive,
    }),
    digestHourUtc: z.number().int().min(0).max(23),
    closedIdGraceSeconds: botPositive,
    lockRetrySeconds: botPositive,
    apiTimeoutMs: botPositive,
    machineCacheMs: botPositive,
    valueCacheMs: botPositive,
    symbolCacheSeconds: botPositive,
  })
  .superRefine((p, ctx) => {
    const age = p.notify.maxAgeSeconds;
    const priority = p.notify.priority;
    if (!(age.hit <= age.royalty && age.royalty <= age.digest))
      ctx.addIssue({
        code: "custom",
        path: ["notify", "maxAgeSeconds"],
        message: "Notification ages must be ordered.",
      });
    if (!(
      priority.onePct === priority.jackpot &&
      priority.jackpot < priority.royalty &&
      priority.royalty < priority.hit &&
      priority.hit < priority.digest
    ))
      ctx.addIssue({
        code: "custom",
        path: ["notify", "priority"],
        message: "Notification priorities must be ordered.",
      });
    if (
      p.apiLimits.goSessionsPerUserPer600s <
      3 * p.userLimits.deepLinkRepliesPer600s
    )
      ctx.addIssue({
        code: "custom",
        path: ["apiLimits"],
        message: "Session capacity must cover three wallet buttons per reply.",
      });
    if (p.groupLimits.repliesPer60s >= p.telegram.groupMaxPerMinute)
      ctx.addIssue({
        code: "custom",
        path: ["groupLimits"],
        message: "Group replies must leave capacity for posts.",
      });
  });
export const blinksOpsSchema = z.strictObject({
  ripPostPerMinutePerAccount: botPositive,
  postPerMinutePerIp: botPositive,
  imagesPerMinutePerIp: botPositive,
  mintInfoCacheSeconds: botPositive,
  symbolCacheSeconds: botPositive,
  imageCacheEntries: botPositive,
});

// Validation stays inside the owned block; M1 can call this from validateParams.
export function validateBotParams(
  bot: unknown = BOT_OPS,
  blinks: unknown = BLINKS_OPS,
) {
  z.number().int().positive().max(30).parse(BOT.maxMessagesPerSecond);
  return {
    bot: botOpsSchema.parse(bot),
    blinks: blinksOpsSchema.parse(blinks),
  };
}
validateBotParams();
// ===== END M5 BOT SECTION

export {
  DEVNET_RPC_PROFILE,
  devnetTransportProfile,
} from "./devnet-transport.js";

export * from "./meteora-compatibility.js";
