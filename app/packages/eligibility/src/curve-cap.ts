import { PublicKey } from "@solana/web3.js";
import { PUMP_LAYOUTS, WSOL_MINT } from "./params.js";
import type { RawAccount } from "./types.js";
// Official pump-public-docs idl/pump.json: 5 u64s, bool, pubkey, bool, bool, pubkey.
export const CURVE_OFFSETS = {
  realQuoteReserves: 32,
  complete: 48,
  quoteMint: 83,
} as const;
export interface CurveDisplayState {
  complete: boolean;
  solQuoted: boolean;
  capLamports: bigint | null;
}
export function curveDisplayState(curve: RawAccount): CurveDisplayState | null {
  const data = Buffer.from(curve.data);
  if (
    data.length <= CURVE_OFFSETS.complete ||
    !data
      .subarray(0, 8)
      .equals(Buffer.from(PUMP_LAYOUTS.bondingCurveDiscriminatorHex, "hex"))
  )
    return null;
  const complete = data[CURVE_OFFSETS.complete];
  if (complete !== 0 && complete !== 1) return null;
  if (complete === 1)
    return { complete: true, solQuoted: true, capLamports: null };
  if (
    data.length > CURVE_OFFSETS.quoteMint &&
    data.length < CURVE_OFFSETS.quoteMint + 32
  )
    return null;
  const quote =
    data.length >= CURVE_OFFSETS.quoteMint + 32
      ? data.subarray(CURVE_OFFSETS.quoteMint, CURVE_OFFSETS.quoteMint + 32)
      : null;
  const solQuoted =
    quote === null ||
    quote.every((byte) => byte === 0) ||
    new PublicKey(quote).toBase58() === WSOL_MINT;
  return {
    complete: false,
    solQuoted,
    capLamports: solQuoted
      ? data.readBigUInt64LE(CURVE_OFFSETS.realQuoteReserves)
      : null,
  };
}
