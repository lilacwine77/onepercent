import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { discriminator } from "../bytes.js";
import { PUMP_DISCRIMINATORS } from "./ids.js";

// Byte positions: pump-public-docs 2293f9a6. Missing complete trailing fields read as zero.
function account(bytes: Uint8Array, hex: string, minimum: number): Buffer {
  const data = Buffer.from(bytes);
  if (data.length < minimum || data.subarray(0, 8).toString("hex") !== hex)
    throw new Error("Invalid pump account layout");
  return data;
}
function optional<T>(
  data: Buffer,
  offset: number,
  size: number,
  read: () => T,
  fallback: T,
): T {
  if (data.length <= offset) return fallback;
  if (data.length < offset + size)
    throw new Error("Truncated pump account field");
  return read();
}
const key = (data: Buffer, offset: number) =>
  optional(
    data,
    offset,
    32,
    () => new PublicKey(data.subarray(offset, offset + 32)),
    PublicKey.default,
  );
const word = (data: Buffer, offset: number) =>
  optional(data, offset, 8, () => data.readBigUInt64LE(offset), 0n);
function flag(data: Buffer, offset: number): boolean {
  return optional(
    data,
    offset,
    1,
    () => {
      if (data[offset] !== 0 && data[offset] !== 1)
        throw new Error("Invalid pump flag");
      return data[offset] === 1;
    },
    false,
  );
}
export function decodeBondingCurve(bytes: Uint8Array) {
  const data = account(bytes, PUMP_DISCRIMINATORS.bondingCurve, 49);
  return {
    virtualTokenReserves: word(data, 8),
    virtualQuoteReserves: word(data, 16),
    realTokenReserves: word(data, 24),
    realQuoteReserves: word(data, 32),
    tokenTotalSupply: word(data, 40),
    complete: flag(data, 48),
    creator: key(data, 49),
    isMayhemMode: flag(data, 81),
    isCashbackCoin: flag(data, 82),
    quoteMint: key(data, 83),
    creatorFeeBps: word(data, 115),
    canEditCreatorFee: flag(data, 123),
    isHolderReward: flag(data, 124),
    creatorFee: word(data, 125),
    protocolFees: word(data, 133),
    depth: data[141] ?? 0,
    initialVirtualQuoteReserves: word(data, 142),
    postCompleteBaseOut: data.length === 151 ? 0n : word(data, 150),
    postCompleteQuoteIn: word(data, 158),
  };
}
export type PumpBondingCurve = ReturnType<typeof decodeBondingCurve>;
export function decodePool(bytes: Uint8Array) {
  const data = account(bytes, PUMP_DISCRIMINATORS.pool, 243);
  return {
    index: data.readUInt16LE(9),
    creator: key(data, 11),
    baseMint: key(data, 43),
    quoteMint: key(data, 75),
    lpMint: key(data, 107),
    baseTokenAccount: key(data, 139),
    quoteTokenAccount: key(data, 171),
    lpSupply: word(data, 203),
    coinCreator: key(data, 211),
    isMayhemMode: flag(data, 243),
    isCashbackCoin: flag(data, 244),
    virtualQuoteReserves: optional(
      data,
      245,
      16,
      () => data.readBigUInt64LE(245) + (data.readBigInt64LE(253) << 64n),
      0n,
    ),
    creatorFeeBps: word(data, 261),
    canEditCreatorFee: flag(data, 269),
    isHolderReward: flag(data, 270),
    protocolFees: word(data, 271),
    creatorFees: word(data, 279),
  };
}
export type PumpPool = ReturnType<typeof decodePool>;
export function decodeGlobal(bytes: Uint8Array) {
  const data = account(
    bytes,
    discriminator("account", "Global").toString("hex"),
    1088,
  );
  return {
    initialized: flag(data, 8),
    authority: key(data, 9),
    feeRecipient: key(data, 41),
    initialVirtualTokenReserves: word(data, 73),
    initialVirtualSolReserves: word(data, 81),
    initialRealTokenReserves: word(data, 89),
    tokenTotalSupply: word(data, 97),
    feeBasisPoints: word(data, 105),
    creatorFeeBasisPoints: word(data, 154),
    createV2Enabled: flag(data, 450),
    buybackFeeRecipients: Array.from({ length: 8 }, (_, i) =>
      key(data, 741 + 32 * i),
    ),
    buybackBasisPoints: word(data, 997),
    initialVirtualQuoteReserves: word(data, 1005),
    creatorFeeConfigurable: flag(data, 1045),
    maxConfigurableCreatorFeeBps: word(data, 1046),
    isHolderRewardEnabled: flag(data, 1086),
    maxCurveDepth: data[1087]!,
  };
}
export type PumpGlobal = ReturnType<typeof decodeGlobal>;
export interface PumpFees {
  lpFeeBps: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
}
export interface PumpFeeTier {
  marketCapLamportsThreshold: bigint;
  fees: PumpFees;
}
export function decodeFeeConfig(bytes: Uint8Array) {
  const data = account(
    bytes,
    discriminator("account", "FeeConfig").toString("hex"),
    69,
  );
  let cursor = 41;
  const need = (length: number) => {
    if (cursor + length > data.length)
      throw new Error("Truncated pump fee config");
  };
  const fees = (): PumpFees => {
    need(24);
    const out = {
      lpFeeBps: word(data, cursor),
      protocolFeeBps: word(data, cursor + 8),
      creatorFeeBps: word(data, cursor + 16),
    };
    cursor += 24;
    return out;
  };
  const tiers = (): PumpFeeTier[] => {
    need(4);
    const count = data.readUInt32LE(cursor);
    cursor += 4;
    need(count * 40);
    return Array.from({ length: count }, () => {
      const marketCapLamportsThreshold =
        data.readBigUInt64LE(cursor) +
        (data.readBigUInt64LE(cursor + 8) << 64n);
      cursor += 16;
      return { marketCapLamportsThreshold, fees: fees() };
    });
  };
  const flatFees = fees(),
    feeTiers = tiers();
  const stableFeeTiers = cursor < data.length ? tiers() : [];
  const exoticFlatFees = cursor < data.length ? fees() : null;
  return {
    bump: data[8]!,
    admin: key(data, 9),
    flatFees,
    feeTiers,
    stableFeeTiers,
    exoticFlatFees,
  };
}
export type PumpFeeConfig = ReturnType<typeof decodeFeeConfig>;
