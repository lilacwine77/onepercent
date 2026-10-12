import { MarketError } from "../errors.js";
import { BPS_DENOMINATOR, MARKET } from "../params.js";

/** Sample standard deviation of daily log returns; the result rounds up in bps. */
export function sigmaDailyBps(closes: readonly number[]): number {
  if (
    closes.length !== MARKET.listing.sigmaWindowDays + 1 ||
    closes.some((close) => !Number.isFinite(close) || close <= 0)
  ) {
    throw new MarketError("INVALID_INPUT", {
      message: "A complete positive daily close window is required",
    });
  }
  const returns = closes
    .slice(1)
    .map((close, index) => Math.log(close) - Math.log(closes[index]!));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  return Math.ceil(Math.sqrt(variance) * BPS_DENOMINATOR);
}
