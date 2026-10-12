import { PublicKey } from "@solana/web3.js";
import { MarketError } from "../errors.js";
import {
  CACHE_MAX_ENTRIES,
  CHAIN_LAYOUT,
  PROGRAM_IDS,
  PUMP_LAYOUTS,
  WSOL_MINT,
} from "../params.js";

const zeroKey = PublicKey.default.toBase58();
const curveAddresses = new Map<string, string>();
const poolAddresses = new Map<string, string>();
function cachedAddress(
  cache: Map<string, string>,
  mint: string,
  derive: () => string,
): string {
  const present = cache.get(mint);
  if (present !== undefined) return present;
  const address = derive();
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(mint, address);
  return address;
}
function invalid(): never {
  throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
}
function optionalField<T>(
  data: Buffer,
  offset: number,
  size: number,
  read: () => T,
  fallback: T,
): T {
  if (data.length <= offset) return fallback;
  if (data.length < offset + size) return invalid();
  return read();
}
function publicKey(data: Buffer, offset: number, optional = false): string {
  const read = () =>
    new PublicKey(
      data.subarray(offset, offset + CHAIN_LAYOUT.publicKeyBytes),
    ).toBase58();
  return optional
    ? optionalField(data, offset, CHAIN_LAYOUT.publicKeyBytes, read, zeroKey)
    : read();
}
function flag(data: Buffer, offset: number, optional = false): boolean {
  if (optional && data.length <= offset) return false;
  const value = data[offset];
  if (value !== 0 && value !== 1) return invalid();
  return value === 1;
}
export function deriveBondingCurve(mint: string): string {
  try {
    return cachedAddress(curveAddresses, mint, () =>
      PublicKey.findProgramAddressSync(
        [
          Buffer.from(PUMP_LAYOUTS.bondingCurveSeed),
          new PublicKey(mint).toBuffer(),
        ],
        new PublicKey(PROGRAM_IDS.pumpFun),
      )[0].toBase58(),
    );
  } catch {
    throw new MarketError("INVALID_INPUT");
  }
}
export function deriveCanonicalPool(mint: string): string {
  try {
    return cachedAddress(poolAddresses, mint, () => {
      const key = new PublicKey(mint);
      const authority = PublicKey.findProgramAddressSync(
        [Buffer.from("pool-authority"), key.toBuffer()],
        new PublicKey(PROGRAM_IDS.pumpFun),
      )[0];
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from(PUMP_LAYOUTS.poolSeed),
          Buffer.alloc(CHAIN_LAYOUT.u16Bytes),
          authority.toBuffer(),
          key.toBuffer(),
          new PublicKey(WSOL_MINT).toBuffer(),
        ],
        new PublicKey(PROGRAM_IDS.pumpSwap),
      )[0].toBase58();
    });
  } catch {
    throw new MarketError("INVALID_INPUT");
  }
}
export function hasDiscriminator(data: Buffer, hex: string): boolean {
  return (
    data.subarray(0, CHAIN_LAYOUT.discriminatorBytes).toString("hex") === hex
  );
}
export interface BondingCurveFields {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
  mayhem: boolean;
  cashback: boolean;
  quoteMint: string;
  creatorFeeBps: bigint;
}
export function decodeBondingCurve(data: Buffer): BondingCurveFields {
  if (
    data.length < CHAIN_LAYOUT.curveMinimumBytes ||
    !hasDiscriminator(data, PUMP_LAYOUTS.bondingCurveDiscriminatorHex)
  )
    return invalid();
  const p = CHAIN_LAYOUT.curve;
  return {
    virtualTokenReserves: data.readBigUInt64LE(p.virtualTokenReserves),
    virtualQuoteReserves: data.readBigUInt64LE(p.virtualQuoteReserves),
    realTokenReserves: data.readBigUInt64LE(p.realTokenReserves),
    realQuoteReserves: data.readBigUInt64LE(p.realQuoteReserves),
    tokenTotalSupply: data.readBigUInt64LE(p.tokenTotalSupply),
    complete: flag(data, p.complete),
    creator: publicKey(data, p.creator, true),
    mayhem: flag(data, p.mayhem, true),
    cashback: flag(data, p.cashback, true),
    quoteMint: publicKey(data, p.quoteMint, true),
    creatorFeeBps: optionalField(
      data,
      p.creatorFeeBps,
      CHAIN_LAYOUT.u64Bytes,
      () => data.readBigUInt64LE(p.creatorFeeBps),
      0n,
    ),
  };
}
export interface PumpPoolFields {
  index: number;
  creator: string;
  baseMint: string;
  quoteMint: string;
  baseTokenAccount: string;
  quoteTokenAccount: string;
  lpSupply: bigint;
  coinCreator: string;
  mayhem: boolean;
  cashback: boolean;
  virtualQuoteReserves: bigint;
  creatorFeeBps: bigint;
  protocolFees: bigint;
  creatorFees: bigint;
}
export function decodePumpPool(data: Buffer): PumpPoolFields {
  if (
    data.length < CHAIN_LAYOUT.poolMinimumBytes ||
    !hasDiscriminator(data, PUMP_LAYOUTS.poolDiscriminatorHex)
  )
    return invalid();
  const p = CHAIN_LAYOUT.pool;
  return {
    index: data.readUInt16LE(p.index),
    creator: publicKey(data, p.creator),
    baseMint: publicKey(data, p.baseMint),
    quoteMint: publicKey(data, p.quoteMint),
    baseTokenAccount: publicKey(data, p.baseTokenAccount),
    quoteTokenAccount: publicKey(data, p.quoteTokenAccount),
    lpSupply: data.readBigUInt64LE(p.lpSupply),
    coinCreator: publicKey(data, p.coinCreator),
    mayhem: flag(data, p.mayhem, true),
    cashback: flag(data, p.cashback, true),
    virtualQuoteReserves: optionalField(
      data,
      p.virtualQuoteReserves,
      CHAIN_LAYOUT.i128Bytes,
      () =>
        data.readBigUInt64LE(p.virtualQuoteReserves) +
        (data.readBigInt64LE(p.virtualQuoteReserves + CHAIN_LAYOUT.u64Bytes) <<
          CHAIN_LAYOUT.u64Bits),
      0n,
    ),
    creatorFeeBps: optionalField(
      data,
      p.creatorFeeBps,
      CHAIN_LAYOUT.u64Bytes,
      () => data.readBigUInt64LE(p.creatorFeeBps),
      0n,
    ),
    protocolFees: optionalField(
      data,
      p.protocolFees,
      CHAIN_LAYOUT.u64Bytes,
      () => data.readBigUInt64LE(p.protocolFees),
      0n,
    ),
    creatorFees: optionalField(
      data,
      p.creatorFees,
      CHAIN_LAYOUT.u64Bytes,
      () => data.readBigUInt64LE(p.creatorFees),
      0n,
    ),
  };
}
