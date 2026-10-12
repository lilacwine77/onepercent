import { LAMPORTS_PER_SOL, XRAY_PRICE_MAX_AGE_SLOTS } from "./params.js";
export interface EstimateValueInput {
  amountRaw: bigint;
  decimals: number | null;
  usdPrice?: number;
  ageSlots?: number;
  solUsd: number;
  /** Readable real curve or canonical pool reserves, already adjusted for fees. */
  exitCapLamports?: bigint | null;
  skip?: boolean;
}
export function estimateValueLamports({
  amountRaw,
  decimals,
  usdPrice,
  ageSlots,
  solUsd,
  exitCapLamports,
  skip,
}: EstimateValueInput): bigint | undefined {
  if (
    skip ||
    decimals === null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    amountRaw < 0n ||
    exitCapLamports == null ||
    exitCapLamports < 0n ||
    ageSlots === undefined ||
    !Number.isSafeInteger(ageSlots) ||
    ageSlots < 0 ||
    usdPrice === undefined ||
    !Number.isFinite(usdPrice) ||
    usdPrice < 0 ||
    !Number.isFinite(solUsd) ||
    solUsd <= 0 ||
    ageSlots > XRAY_PRICE_MAX_AGE_SLOTS
  )
    return undefined;
  const amount = Math.floor(
    (((Number(amountRaw) / 10 ** decimals) * usdPrice) / solUsd) *
      Number(LAMPORTS_PER_SOL),
  );
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const estimated = BigInt(amount);
  return exitCapLamports < estimated ? exitCapLamports : estimated;
}
