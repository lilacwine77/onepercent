import {
  BPS_DENOMINATOR,
  CREATOR_FEE_SPLIT_BPS,
  STOCK,
} from "@onepercent/config";
import { u64, U64_MAX } from "../bytes.js";
import { CREATOR_FEE_REGIME, PHASE } from "../constants.js";
import type { CreatorFeeRegime } from "../constants.js";
import type { Machine } from "../layouts.js";
import { rotateHour } from "./index.js";

export function creatorFeeBook(
  machine: Pick<Machine, "stock_sol" | "buckets">,
): bigint {
  const total = machine.buckets
    .slice(0, STOCK.maxBuckets)
    .reduce((value, bucket) => value + bucket.cost, machine.stock_sol);
  return total > U64_MAX ? U64_MAX : total;
}

/** D27: the phase and pre-collection book select one regime for the whole collection. */
export function creatorFeeRegime(
  machine: Machine,
  nowTs: bigint,
): CreatorFeeRegime {
  const rotated = rotateHour(machine, nowTs);
  if (rotated.phase >= PHASE.buysClosed) return CREATOR_FEE_REGIME.afterEnd;
  if (rotated.phase !== PHASE.poweredOn && rotated.phase !== PHASE.onAir)
    throw new RangeError("Trading fees require Power-On");
  return creatorFeeBook(rotated) < STOCK.creatorFeeFloorLamports
    ? CREATOR_FEE_REGIME.belowFloor
    : CREATOR_FEE_REGIME.season;
}

export function splitCreatorFees(
  amount: bigint,
  regime: CreatorFeeRegime,
): { stock: bigint; burn: bigint; team: bigint } {
  u64(amount);
  const name = (
    Object.keys(CREATOR_FEE_REGIME) as (keyof typeof CREATOR_FEE_REGIME)[]
  ).find((key) => CREATOR_FEE_REGIME[key] === regime);
  if (!name) throw new RangeError("Invalid trading fee regime");
  const rates = CREATOR_FEE_SPLIT_BPS[name];
  const burn = (amount * BigInt(rates.burn)) / BigInt(BPS_DENOMINATOR);
  const team = (amount * BigInt(rates.team)) / BigInt(BPS_DENOMINATOR);
  return { stock: amount - burn - team, burn, team };
}
