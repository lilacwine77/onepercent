// Recorded M1 draw inputs; release schedule updated by D37. Tests only.
export const BPS_DENOMINATOR = 10_000;

export const PPB_DENOMINATOR = 1_000_000_000;

export const PACK_EDITIONS = [
  {
    index: 0,
    id: "original",
    code: "OG",
    name: "The Original",
    priceLamports: 100_000_000n,
    maxPerRip: 10,
  },
  {
    index: 1,
    id: "blue_shift",
    code: "BS",
    name: "Blue Shift",
    priceLamports: 250_000_000n,
    maxPerRip: 10,
  },
  {
    index: 2,
    id: "signature",
    code: "SG",
    name: "Signature",
    priceLamports: 500_000_000n,
    maxPerRip: 10,
  },
  {
    index: 3,
    id: "after_hours",
    code: "AH",
    name: "After Hours",
    priceLamports: 1_000_000_000n,
    maxPerRip: 5,
  },
] as const;

export const CARDS_PER_PACK = { dust: 4, hit: 1 } as const;

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

export const TOKEN_1PCT = {
  name: "Onepercent", // [OFF] pump create_v2 metadata
  symbol: "1PCT", // [OFF]
  tokenProgram: "token-2022", // [OFF]
  decimals: 6,
  totalSupply: 1_000_000_000_000_000n, // [OFF] 1B × 10^6
  devBuyBps: 400, // [OFF]
  devBuyAmount: 40_000_000_000_000n, // 40M × 10^6, all to The 1% cards
  onePctCardAmount: 10_000_000_000_000n, // 10M × 10^6
  onePctCardCount: 4,
  onePctReleaseOffsetsSeconds: [0, 43_200, 86_400, 129_600], // [D37] after on_air_ts: 0 / 12 / 24 / 36 h
  teamAllocation: 0n, // [OFF]
  holderTier: {
    minBalance: 1_000_000_000_000n, // [OFF] attester: ≥ 1M $1PCT
    continuousHoldSeconds: 86_400, // [OFF] [C15] attester: held continuously for 24 h
    onePctOddsMultiplierBps: 15_000, // ×1.5 on the The 1% segment
  },
} as const;
