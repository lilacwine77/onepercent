// Economic and provider settings are sourced exclusively from config.
import { MARKET } from "@onepercent/config";
export {
  MARKET,
  marketParamsSchema,
  validateMarketParams,
  LAMPORTS_PER_SOL,
  BPS_DENOMINATOR,
  WSOL_MINT,
  PROGRAM_IDS,
  PUMP_LAYOUTS,
  STOCK,
  HIT_LIST,
  XRAY,
  FEED_RULES,
  TX_LIMITS,
  SELL_BACK,
} from "@onepercent/config";
// Technical units and representation bounds; these are not economic policy.
export const MILLISECONDS_PER_SECOND = 1_000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;
export const CACHE_MAX_ENTRIES = 10_000;
export const DECIMAL_RADIX = 10;
export const U16_MAX = 65_535;
export const U32_MAX = 4_294_967_295;
export const U64_MAX = 18_446_744_073_709_551_615n;
export const JUPITER_BUILD_MAX_ACCOUNTS = 64;
export const RPC_JSON_VERSION = "2.0";
// Published Pump Fees IDL program address; observed protocol identity, not policy.
export const PUMP_FEES_PROGRAM_ID =
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
// Keep config reachable in generated declarations without alternate imports.
export type MarketSettings = typeof MARKET;
// Public Pump IDL byte offsets and SPL representation widths; no economic policy.
export const CHAIN_LAYOUT = {
  curveMinimumBytes: 49,
  discriminatorBytes: 8,
  publicKeyBytes: 32,
  u64Bytes: 8,
  u64Bits: 64n,
  curve: {
    virtualTokenReserves: 8,
    virtualQuoteReserves: 16,
    realTokenReserves: 24,
    realQuoteReserves: 32,
    tokenTotalSupply: 40,
    complete: 48,
    creator: 49,
    mayhem: 81,
    cashback: 82,
    quoteMint: 83,
    creatorFeeBps: 115,
  },
  pool: {
    index: 9,
    creator: 11,
    baseMint: 43,
    quoteMint: 75,
    baseTokenAccount: 139,
    quoteTokenAccount: 171,
    lpSupply: 203,
    coinCreator: 211,
    mayhem: 243,
    cashback: 244,
    virtualQuoteReserves: 245,
    creatorFeeBps: 261,
    protocolFees: 271,
    creatorFees: 279,
  },
  poolMinimumBytes: 243,
  u16Bytes: 2,
  u32Bytes: 4,
  i128Bytes: 16,
  topHolderCount: 10,
  incinerator: "1nc1nerator11111111111111111111111111111111",
} as const;

// Bounded reserve RPC work and public binary layout offsets; no economic policy.
export const RESERVE_READS = {
  ACCOUNTS_PER_BATCH: 100, // RPC bound, matching XRAY.accountsPerBatch.
  CPU_BATCH_SIZE: 16,
  BATCH_CONCURRENCY: 4,
  TOKEN_ACCOUNT_BYTES: 165,
  TOKEN_AMOUNT_OFFSET: 64,
  TOKEN_STATE_OFFSET: 108,
  KEY_BYTES: 32,
  FEE_TIERS_LENGTH_OFFSET: 65,
  FEE_TIER_BYTES: 40,
  FEE_TIER_THRESHOLD_BYTES: 16,
  FEE_COMPONENT_BYTES: 8,
} as const;

// Full PriceUpdateV2 wire layout and integer exponent bound used by the stock SDK.
// Protocol representation only; freshness and confidence still come from STOCK.
export const PYTH_PUSH_LAYOUT = {
  discriminatorHex: "22f123639d7ef4cd",
  minimumBytes: 133,
  verificationLevel: 40,
  feedId: 41,
  price: 73,
  conf: 81,
  exponent: 89,
  publishTime: 93,
  minimumExponent: -18,
} as const;

// Public history endpoints, API bounds and token identities; no economic policy.
export const LISTING_HISTORY = {
  pythBenchmarksUrl: "https://benchmarks.pyth.network",
  geckoTerminalUrl: "https://api.geckoterminal.com/api/v2",
  geckoMaxPoolPages: 10,
  geckoPoolsPerPage: 20,
  geckoRequestsPerMinute: 10,
  ohlcvCloseIndex: 4,
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  usdtMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
} as const;
