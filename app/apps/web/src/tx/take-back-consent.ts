import { EngineError } from "./engine/errors";

/** Prompted costs remain reserved through a silent rebuild or uncertain send. */
export function takeBackConsent(caps: {
  maxAtaRentLamports?: bigint;
  maxTransactions?: number;
}) {
  let rent = 0n;
  let transactions = 0;
  const check = (nextRent: bigint, nextTransactions: number) => {
    if (
      (caps.maxAtaRentLamports !== undefined &&
        rent + nextRent > caps.maxAtaRentLamports) ||
      (caps.maxTransactions !== undefined &&
        transactions + nextTransactions > caps.maxTransactions)
    )
      throw new EngineError("errors.cardMoved");
  };
  return {
    check,
    reserve(nextRent: bigint, nextTransactions: number) {
      check(nextRent, nextTransactions);
      rent += nextRent;
      transactions += nextTransactions;
    },
  };
}
