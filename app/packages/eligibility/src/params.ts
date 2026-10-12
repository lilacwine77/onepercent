// MIRROR of PARAMS.md — switch to @onepercent/config after M1
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BPS_DENOMINATOR = 10_000;
export const PACK_EDITIONS = [
  { priceLamports: 100_000_000n },
  { priceLamports: 250_000_000n },
  { priceLamports: 500_000_000n },
  { priceLamports: 1_000_000_000n },
] as const;
export const PACK_SPLIT_BPS = { royaltyPerDustCard: 200 } as const;
export const FEED_RULES = {
  maxMintDecimals: 9,
  allowedToken2022Extensions: ["MetadataPointer", "TokenMetadata"],
} as const;
export const XRAY = {
  cacheSeconds: 86_400,
  rateLimitPerMinutePerIp: 60,
  turnstileAfterRequests: 10,
  accountsPerBatch: 100,
  priceIdsPerCall: 50,
  sellMinLamports: 2_000_000n,
  // DECISIONS.md D7: X-ray display estimates only; executable values keep their bound.
  priceMaxAgeSlots: 54_000,
  maxTokenAccounts: 2_000,
  cacheMaxEntries: 5_000,
} as const;
export const UI = { tickerMaxChars: 10 } as const;
export const PROGRAM_IDS = {
  pumpFun: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
} as const;
export const PUMP_LAYOUTS = {
  bondingCurveSeed: "bonding-curve",
  bondingCurveDiscriminatorHex: "17b7f83760d8ac60",
} as const;
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const XRAY_PRICE_MAX_AGE_SLOTS = XRAY.priceMaxAgeSlots;
export const XRAY_MAX_TOKEN_ACCOUNTS = XRAY.maxTokenAccounts;
export const XRAY_CACHE_MAX_ENTRIES = XRAY.cacheMaxEntries;
