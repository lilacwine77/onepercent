import { MarketError } from "../errors.js";
import { BPS_DENOMINATOR, MARKET } from "../params.js";
import type { ValueNow, ValueUnavailableReason } from "./value-now.js";

export interface LadderRung {
  amount: bigint;
  lamports: bigint;
  rawLamports: bigint;
  rawRecoveryBps: bigint;
  recoveryBps: bigint;
  nonMonotone: boolean;
}

export interface Ladder {
  mint: string;
  baseAmount: bigint;
  rungs: LadderRung[];
  stopReason: "MAX_RUNGS" | "UNAVAILABLE" | "LOW_RECOVERY" | "ZERO_BASE_VALUE";
  unavailableReason?: ValueUnavailableReason;
}

export async function buildLadder(
  mint: string,
  baseAmount: bigint,
  valueNow: ValueNow,
): Promise<Ladder> {
  if (typeof baseAmount !== "bigint" || baseAmount <= 0n) {
    throw new MarketError("INVALID_INPUT", {
      message: "Ladder base amount must be positive",
    });
  }
  const ladder: Ladder = {
    mint,
    baseAmount,
    rungs: [],
    stopReason: "MAX_RUNGS",
  };
  let amount = baseAmount;
  for (let index = 0; index < MARKET.ladder.maxRungs; index += 1) {
    const value = await valueNow(mint, amount);
    if (value.status === "unavailable") {
      ladder.stopReason = "UNAVAILABLE";
      ladder.unavailableReason = value.reason;
      break;
    }
    const baseValue = ladder.rungs[0]?.lamports ?? value.lamports;
    const previous = ladder.rungs.at(-1);
    const recovery = (out: bigint) =>
      baseValue === 0n
        ? 0n
        : (out * baseAmount * BigInt(BPS_DENOMINATOR)) / (baseValue * amount);
    const rawRecoveryBps = recovery(value.lamports);
    let lamports =
      previous && value.lamports > previous.lamports * 2n
        ? previous.lamports * 2n
        : value.lamports;
    const nonMonotone = previous !== undefined && lamports < previous.lamports;
    if (previous && nonMonotone) lamports = previous.lamports;
    ladder.rungs.push({
      amount,
      lamports,
      rawLamports: value.lamports,
      rawRecoveryBps,
      recoveryBps: recovery(lamports),
      nonMonotone,
    });
    if (baseValue === 0n) {
      ladder.stopReason = "ZERO_BASE_VALUE";
      break;
    }
    // The stop decision uses the original quote; caps use the clamped output.
    if (rawRecoveryBps < BigInt(MARKET.ladder.stopBelowRecoveryBps)) {
      ladder.stopReason = "LOW_RECOVERY";
      break;
    }
    amount *= 2n;
  }
  return ladder;
}

export function valueAt(ladder: Ladder, amount: bigint): bigint | undefined {
  if (typeof amount !== "bigint" || amount < 0n) {
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid ladder amount",
    });
  }
  const first = ladder.rungs[0];
  if (!first) return undefined;
  if (amount <= first.amount) return (amount * first.lamports) / first.amount;
  for (let index = 1; index < ladder.rungs.length; index += 1) {
    const current = ladder.rungs[index]!;
    const previous = ladder.rungs[index - 1]!;
    if (amount <= current.amount) {
      return (
        previous.lamports +
        ((amount - previous.amount) * (current.lamports - previous.lamports)) /
          (current.amount - previous.amount)
      );
    }
  }
  return undefined;
}

export function marginalValue(
  ladder: Ladder,
  held: bigint,
  add: bigint,
): bigint | undefined {
  if (
    typeof held !== "bigint" ||
    typeof add !== "bigint" ||
    held < 0n ||
    add < 0n
  ) {
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid marginal amount",
    });
  }
  const before = valueAt(ladder, held);
  const after = valueAt(ladder, held + add);
  return before === undefined || after === undefined
    ? undefined
    : after - before;
}

export function capLamportsAtImpact(
  ladder: Ladder,
  impactBps: number,
): bigint | undefined {
  if (
    !Number.isSafeInteger(impactBps) ||
    impactBps < 0 ||
    impactBps > BPS_DENOMINATOR
  ) {
    throw new MarketError("INVALID_INPUT", { message: "Invalid impact bound" });
  }
  const threshold = BigInt(BPS_DENOMINATOR - impactBps);
  for (let index = ladder.rungs.length - 1; index >= 0; index -= 1) {
    const rung = ladder.rungs[index]!;
    if (rung.recoveryBps >= threshold) return rung.lamports;
  }
  return undefined;
}
