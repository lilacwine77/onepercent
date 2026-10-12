/**
 * PREVIEW builds only (VITE_PREVIEW=1): the demo adapters' data. Every token is a
 * real Solana mint (symbol, name and mint checked against Jupiter's token list on
 * 2026-10-09), and every logo is the API's own /api/logo/:mint, as in production.
 * Amounts, values, quotes and the other trenchers are demo values.
 */
/**
 * A real trencher wallet holding pump.fun dust (11 bags at the 2026-10-09 scan);
 * any address can replace it from the Demo panel.
 */
export const DEFAULT_DEMO_WALLET =
  "J4aGiHemVzcxxjcwMKm77A9uUpB4Yf32KbEBrwtKG31a";
export const DEMO_START_LAMPORTS = 3_200_000_000n;
export const logoUrl = (mint: string) => `/api/logo/${mint}`;

export interface DemoToken {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
}
const token = (symbol: string, name: string, mint: string): DemoToken => ({
  mint,
  symbol,
  name,
  logo: logoUrl(mint),
});
export type BagKind = "feedable" | "checkAtFeed" | "bid" | "notInSet";
export interface DemoBag extends DemoToken {
  amountUi: string;
  decimals: number;
  /** Executable quote in the demo ("≈ … if sold now"); 0 = no bid. */
  valueLamports: bigint;
  drawdownPct: number | null;
  kind: BagKind;
  /** COPY key of the X-ray reason when the bag cannot be fed. */
  reasonKey?: string;
}
const bag = (
  t: DemoToken,
  amountUi: string,
  valueLamports: bigint,
  drawdownPct: number,
  kind: BagKind,
): DemoBag => ({
  ...t,
  amountUi,
  decimals: 6,
  valueLamports,
  drawdownPct,
  kind,
});

// Real pump.fun mints (Dust Cards) and liquid coins (hits), each with a logo the
// API's /api/logo/:mint serves (checked through the logo proxy on 2026-10-09).
const ACT = token(
  "ACT",
  "Act I : The AI Prophecy",
  "GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump",
);
const PIPPIN = token(
  "PIPPIN",
  "Pippin",
  "Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump",
);
const CHILLGUY = token(
  "CHILLGUY",
  "Just a chill guy",
  "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump",
);
const FWOG = token(
  "FWOG",
  "FWOG",
  "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump",
);
const LUCE = token(
  "LUCE",
  "Official Mascot of the Holy Year",
  "CBdCxKo9QavR9hfShgpEBG3zekorAeD7W1jfq2o3pump",
);
const SIGMA = token(
  "SIGMA",
  "SIGMA",
  "5SVG3T9CNQsm2kEwzbRq6hASqh1oGfjqTtLXYUibpump",
);
const MICHI = token(
  "MICHI",
  "michi",
  "AywAYdNJnSLSXwKWYxDciPjqGRnwp4iZdQptuuQTpump",
);
const VINE = token(
  "VINE",
  "Vine Coin",
  "6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump",
);
const ALCH = token(
  "ALCH",
  "Alchemist AI",
  "HNg5PYJmtqcmzXrv6S9zP1CDKk5BgDuyFBxbvNApump",
);
const BAN = token(
  "BAN",
  "Comedian",
  "9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump",
);
const TROLL = token(
  "TROLL",
  "TROLL",
  "5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2",
);

/**
 * Bags for a wallet whose X-ray cannot be read (a preview without the API, or a
 * scan that failed). A live X-ray of the demo wallet replaces them.
 */
export const SAMPLE_BAGS: DemoBag[] = [
  bag(CHILLGUY, "11", 1_100_000n, 98.4, "feedable"),
  bag(ACT, "29", 2_600_000n, 94.1, "feedable"),
  bag(PIPPIN, "12", 1_900_000n, 96.6, "feedable"),
  bag(FWOG, "33", 1_500_000n, 99.2, "feedable"),
  bag(SIGMA, "300", 3_400_000n, 97.8, "feedable"),
  bag(LUCE, "2100", 700_000n, 96.3, "checkAtFeed"),
  bag(MICHI, "3400", 84_000_000n, 62.4, "bid"),
  {
    ...bag(TROLL, "349", 120_000_000n, 41.8, "notInSet"),
    reasonKey: "xray.reason.not_pump_fun",
  },
];
export const SAMPLE_EMPTIES = [
  {
    address: "5tv2xT7xnrjtngycWeMQpy5pzh1Ejpkr2onmuFo2PvmT",
    lamports: 2_039_280n,
  },
  {
    address: "Fx2JZEkC9Lxc2RbYHfBsnujBTAqevrJqQ5WGqzxrDDBA",
    lamports: 2_039_280n,
  },
  {
    address: "CBype4yknsSPxyJVFR92GSN7FM3HPrwPohqqLBgJ2Abs",
    lamports: 2_039_280n,
  },
];

/** Other trenchers' Dust Cards already in the machine (they land in demo packs). */
export const DECK_DUST: (DemoToken & {
  amountUi: string;
  valueLamports: bigint;
  fedBy: string;
})[] = [
  {
    ...SIGMA,
    amountUi: "300",
    valueLamports: 3_400_000n,
    fedBy: "EnpvntHdDfpq9gTpbp4bgS3CMcj4QWpmCJ9MBBrVhB53",
  },
  {
    ...MICHI,
    amountUi: "110",
    valueLamports: 2_700_000n,
    fedBy: "2ScYsA9ekFrBh6RRGzWnNQtc8MrsSsaGLjwHZ1HvE4og",
  },
  {
    ...VINE,
    amountUi: "130",
    valueLamports: 8_800_000n,
    fedBy: "5CyKP7NWLxNrwVd2VFAm9V3XAYgMUWSEoECwCJcYLXUb",
  },
  {
    ...ALCH,
    amountUi: "21",
    valueLamports: 8_300_000n,
    fedBy: "7W7w4VN1DQhuveyZxXNxL6MhdJL1wzEz9DKsRuiQoL5L",
  },
  {
    ...BAN,
    amountUi: "9",
    valueLamports: 5_000_000n,
    fedBy: "EjLZpFWWLSztdvkjcMaRDvNjyfeheseG8NETpxWy6YKm",
  },
  {
    ...ACT,
    amountUi: "29",
    valueLamports: 2_600_000n,
    fedBy: "5jXGhmS6emP1p7pkXtGVPPe7CrYCe89BYqAwmyhWTWbz",
  },
  {
    ...LUCE,
    amountUi: "2100",
    valueLamports: 700_000n,
    fedBy: "FGbxYadRseWzjy8jmSBFy1r6JeGTGHeBQiz8T2uAUBUX",
  },
  {
    ...FWOG,
    amountUi: "220",
    valueLamports: 9_900_000n,
    fedBy: "5Vy29ch6yeEe61A9891eTYgKVaq8nKSfZZTWY2PhGtLW",
  },
];

/**
 * Hits come from the machine's public list (MODEL §3): liquid coins. unitLamports
 * is the price of one whole token at the 2026-10-09 Jupiter quote (SOL at $110).
 */
export const HIT_POOL: (DemoToken & { unitLamports: bigint })[] = [
  {
    ...token(
      "WIF",
      "dogwifhat",
      "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    ),
    unitLamports: 1_940_000n,
  },
  {
    ...token(
      "PNUT",
      "Peanut the Squirrel",
      "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
    ),
    unitLamports: 445_000n,
  },
  {
    ...token(
      "FARTCOIN",
      "Fartcoin",
      "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
    ),
    unitLamports: 1_504_000n,
  },
  {
    ...token(
      "USELESS",
      "USELESS COIN",
      "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk",
    ),
    unitLamports: 1_767_000n,
  },
  { ...TROLL, unitLamports: 343_400n },
  { ...PIPPIN, unitLamports: 155_000n },
];
/** $1PCT is not minted yet: a placeholder address, drawn as the brand coin. */
export const ONE_PCT: DemoToken = {
  mint: "4PmtUq695XbiJoCoVtiPTgpJV4Krq99jStZjHBvQdjTF",
  symbol: "1PCT",
  name: "Onepercent",
  logo: null,
};
/** Display-only pot of the demo Jackpot (in $1PCT) and its quote. */
export const JACKPOT_POT = {
  amountUi: "48250000",
  valueLamports: 52_300_000_000n,
};
export const ONE_PCT_VALUE = 41_200_000_000n;
