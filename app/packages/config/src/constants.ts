// Shared literal values only. Keep validation and service configuration in index.ts.
// Both entry points use these objects; do not duplicate parameter values.

// ── Editions ─────────────────────────────────────────────────────── [CONST]
// M0 values unchanged; index, code, maxPerRip added.
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
export type EditionId = (typeof PACK_EDITIONS)[number]["id"];
// Split of every pack price, in bps. Sums to 10_000. On-chain, stock = price − all other lines.
export const PACK_SPLIT_BPS = {
  stock: 7_200,
  royaltyPerDustCard: 200, // ×4; a House Card's 2% goes to the stock [C10]
  jackpot: 500, // → jackpot_sol, converted continuously into the $1PCT pot [C12, J-B]
  burn1pct: 500,
  referral: 200, // to the team if absent; non-creditable referrals go to stock [D20]
  team: 800,
} as const;

// Shared MARKET / WEB transport timeout; no economics.
export const HTTP_TIMEOUT_MS = 5_000;

// ===== BEGIN M3 WEB SECTION — owner: M3 (03-M3-BRIEF.md §5.3). [OFF] [A] PARAMS issue 3 §26.2; [EXT] verified 2026-10-08
// Time unit for transport pacing, independent of polling intervals.
export const MILLISECONDS_PER_MINUTE = 60_000;

export const WEB = {
  configRefreshMs: 60_000,
  machinePollMs: 5_000,
  machinePollHiddenMs: 30_000,
  liveStaleAfterMs: 45_000,
  sseFailuresBeforePoll: 3,
  streamDedupeMax: 1_024,
  streamFrameMaxBytes: 262_144,
  eventsPollMs: 5_000,
  pullPollFastMs: 400,
  pullPollFastForMs: 10_000,
  pullPollSlowMs: 2_000,
  rpcSignaturePageSize: 10,
  rpcConcurrency: 4,
  rpcCapacityMaxAttempts: 3,
  rpcCapacityBackoffBaseMs: 250,
  rpcCapacityBackoffMaxMs: 2_000,
  revealDataDeadlineMs: 1_200,
  confirmPollMs: 800,
  settlePrependAfterSeconds: 30,
  priorityFeeCapMicroLamports: 500_000,
  walletDetectMs: 1_000,
  valuesBatchMax: 50,
  valuesNowPerMinutePerIp: 240,
  logoMaxBytes: 262_144,
  logoTimeoutMs: 3_000,
  logoHosts: [
    "ipfs.io",
    "arweave.net",
    "cf-ipfs.com",
    "gateway.pinata.cloud",
    "*.mypinata.cloud",
    "*.arweave.net",
    "ipfs.filebase.io",
  ],
  sellMaxAccounts: 24,
  jupiterProgramIds: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
  beaconPerMinutePerIp: 60,
  // Additional transport units: copied from MARKET / M3 Turnstile; no economics.
  millisecondsPerSecond: 1_000,
  httpTimeoutMs: HTTP_TIMEOUT_MS,
  turnstileTimeoutMs: 3_000,
  turnstileTokenMaxLength: 2_048,
} as const;
// ===== END M3 WEB SECTION =====

// Values the browser renders (home, demo): shared with index.ts, defined once here.
// ── Cards per pack ───────────────────────────────────────────────── [CONST]
export const CARDS_PER_PACK = { dust: 4, hit: 1 } as const;

// ── Hits ──────────────────────────────────────────────────────────── [CONST]
export const HIT_TIERS = [
  {
    id: "silver",
    label: "Silver Foil",
    valueBps: 5_000,
    majorOnly: false,
    sellBack: true,
  },
  {
    id: "blue",
    label: "Blue Foil",
    valueBps: 15_000,
    majorOnly: false,
    sellBack: true,
  },
  {
    id: "holo",
    label: "Holo Foil",
    valueBps: 40_000,
    majorOnly: true,
    sellBack: true,
  }, // [C5]
  {
    id: "black",
    label: "Black Foil",
    valueBps: 150_000,
    majorOnly: true,
    sellBack: true,
  }, // [C5]
] as const;

// ── Sell back ─────────────────────────────────────────────────────── [CONST] / [OFF]
export const SELL_BACK = {
  payoutBps: 8_700, // [C2] of min(Σ card.value, quote)
  quoteTtlSeconds: { major: 60, trending: 20 }, // [C26] was quoteTtlSeconds: 60
  solFloorLamports: 1_000_000_000n, // [C2]
  hourlyBudgetMinLamports: 5_000_000_000n, // [C2]
  hourlyBudgetBpsOfStockSol: 2_500, // [C2] of stock_sol at the start of the clock hour
  eligibleKinds: ["silver", "blue", "holo", "black"], // [C3]
} as const;

// ── Token $1PCT and The 1% ───────────────────────────────────────── [CONST] unless tagged
export const TOKEN_1PCT = {
  name: "Onepercent", // [OFF] D29 Meteora DBC metadata
  symbol: "1PCT", // [OFF]
  tokenProgram: "spl-token", // [OFF] D29 Meteora DBC
  decimals: 6,
  totalSupply: 1_000_000_000_000_000n, // [OFF] 1B × 10^6
  devBuyBps: 400, // [OFF]
  devBuyAmount: 40_000_000_000_000n, // 40M × 10^6, all to The 1% cards
  onePctCardAmount: 10_000_000_000_000n, // 10M × 10^6
  onePctCardCount: 4,
  onePctReleaseOffsetsSeconds: [0, 151_200, 302_400, 453_600], // [C14] after on_air_ts: 0 / 42 / 84 / 126 h
  teamAllocation: 0n, // [OFF]
  holderTier: {
    minBalance: 1_000_000_000_000n, // [OFF] attester: ≥ 1M $1PCT
    continuousHoldSeconds: 86_400, // [OFF] [C15] attester: held continuously for 24 h
    onePctOddsMultiplierBps: 15_000, // ×1.5 on the The 1% segment
  },
} as const;
