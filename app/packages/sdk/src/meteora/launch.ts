import { PublicKey } from "@solana/web3.js";
import { WSOL_MINT } from "@onepercent/config";

// DBC source f552f20: account discriminator plus the zero-copy structure.
export const DBC_LAUNCH_LAYOUT = {
  pool: {
    minLength: 424,
    discriminator: [213, 224, 5, 209, 98, 69, 119, 92],
    config: 72,
    baseMint: 136,
    baseVault: 168,
    quoteVault: 200,
  },
  config: {
    minLength: 1048,
    discriminator: [26, 108, 14, 123, 116, 230, 129, 43],
    quoteMint: 8,
    feeClaimer: 40,
    creatorTradingFeePercentage: 245,
  },
} as const;

function checkedData(
  data: Uint8Array,
  layout: { minLength: number; discriminator: readonly number[] },
): void {
  if (
    data.length < layout.minLength ||
    !layout.discriminator.every((value, index) => data[index] === value)
  ) {
    throw new Error("Invalid Meteora account layout");
  }
}
const keyAt = (data: Uint8Array, offset: number): PublicKey =>
  new PublicKey(data.slice(offset, offset + 32));

export function decodeDbcLaunchPool(data: Uint8Array) {
  const layout = DBC_LAUNCH_LAYOUT.pool;
  checkedData(data, layout);
  return {
    config: keyAt(data, layout.config),
    baseMint: keyAt(data, layout.baseMint),
    baseVault: keyAt(data, layout.baseVault),
    quoteVault: keyAt(data, layout.quoteVault),
  };
}

export function decodeDbcLaunchConfig(data: Uint8Array) {
  const layout = DBC_LAUNCH_LAYOUT.config;
  checkedData(data, layout);
  return {
    quoteMint: keyAt(data, layout.quoteMint),
    feeClaimer: keyAt(data, layout.feeClaimer),
    creatorTradingFeePercentage: data[layout.creatorTradingFeePercentage]!,
  };
}

/** Mirrors the program's field checks; callers still verify owners and PDA keys. */
export function dbcLaunchDataIsValid(input: {
  pool: Uint8Array;
  config: Uint8Array;
  mint: PublicKey;
  dbcConfig: PublicKey;
  feeIn: PublicKey;
}): boolean {
  try {
    const pool = decodeDbcLaunchPool(input.pool);
    const config = decodeDbcLaunchConfig(input.config);
    return (
      pool.baseMint.equals(input.mint) &&
      pool.config.equals(input.dbcConfig) &&
      config.quoteMint.equals(new PublicKey(WSOL_MINT)) &&
      config.feeClaimer.equals(input.feeIn) &&
      config.creatorTradingFeePercentage === 0
    );
  } catch {
    return false;
  }
}

export const DAMM_CLAIM_LAYOUT = {
  pool: {
    minLength: 1112,
    discriminator: [241, 154, 109, 4, 17, 177, 109, 188],
    baseMint: 168,
    quoteMint: 200,
    baseVault: 232,
    quoteVault: 264,
  },
  position: {
    minLength: 408,
    discriminator: [170, 188, 143, 228, 122, 64, 247, 208],
    pool: 8,
    nftMint: 40,
  },
} as const;

export function decodeDammClaimPool(data: Uint8Array) {
  const layout = DAMM_CLAIM_LAYOUT.pool;
  checkedData(data, layout);
  return {
    baseMint: keyAt(data, layout.baseMint),
    quoteMint: keyAt(data, layout.quoteMint),
    baseVault: keyAt(data, layout.baseVault),
    quoteVault: keyAt(data, layout.quoteVault),
  };
}
export function decodeDammClaimPosition(data: Uint8Array) {
  const layout = DAMM_CLAIM_LAYOUT.position;
  checkedData(data, layout);
  return {
    pool: keyAt(data, layout.pool),
    nftMint: keyAt(data, layout.nftMint),
  };
}
