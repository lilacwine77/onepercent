import { BPS_DENOMINATOR, BURN, JACKPOT, PAUSE_BITS } from "@onepercent/config";
import {
  PHASE,
  rotateHour,
  type Config,
  type Machine,
  type ClusterDeployment,
} from "@onepercent/sdk";
import { type ExecReadings } from "@onepercent/sdk/server";
import type { PublicKey } from "@solana/web3.js";

export type ExecutorKind = "burn" | "jackpot";
export interface ExecutorPolicy {
  burnTrancheSpacingSecondsMin: number;
  burnTrancheSpacingSecondsMax: number;
  jackpotTrancheSpacingSecondsMin: number;
  jackpotTrancheSpacingSecondsMax: number;
  minTrancheLamports: bigint;
}
export interface ExecutorSnapshot {
  deployment: ClusterDeployment;
  machine: Machine;
  config: Config;
  now: bigint;
  slot: number;
}
export interface ExecutorReference {
  quoteReserve: bigint;
  sqrtPrice: bigint;
  oracles: readonly [PublicKey, PublicKey, PublicKey, PublicKey];
  /** Raw canonical account evidence for P1's complete mirror. */
  readings: Omit<ExecReadings, "execution">;
}
export type ExecutorPlan = {
  kind: ExecutorKind;
  code: 3 | 4;
  amount: bigint;
  previousTradeTs: bigint;
  snapshot: ExecutorSnapshot;
  reference: ExecutorReference;
};
export type PlanResult =
  { ok: true; plan: ExecutorPlan } | { ok: false; reason: string };
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));

/** D18 launch policy deliberately stops Burn when the season is Done. */
export function planExecutor(
  kind: ExecutorKind,
  snapshot: ExecutorSnapshot,
  reference: ExecutorReference,
  policy: ExecutorPolicy,
): PlanResult {
  const { config, now } = snapshot;
  const rotated = rotateHour(snapshot.machine, now);
  const hour = (now > 0n ? now : 0n) / 3600n;
  const machine =
    rotated.burn_hour_index === hour
      ? rotated
      : { ...rotated, burn_hour_index: hour, burn_paid_hour: 0n };
  if ((config.disabled_roles & (1 << 4)) !== 0)
    return { ok: false, reason: "RoleDisabled" };
  if (((config.admin_paused | config.guardian_paused) & PAUSE_BITS.burn) !== 0)
    return { ok: false, reason: "Paused" };
  if (machine.exec.kind !== 0) return { ok: false, reason: "ExecInFlight" };
  if (kind === "jackpot" && machine.phase !== PHASE.onAir)
    return { ok: false, reason: "WrongPhase" };
  if (kind === "jackpot" && now >= machine.end_ts)
    return { ok: false, reason: "SeasonOver" };
  if (
    kind === "burn" &&
    (machine.phase < PHASE.poweredOn || machine.phase >= PHASE.done)
  )
    return { ok: false, reason: "WrongPhase" };
  if (reference.quoteReserve <= 0n || reference.sqrtPrice <= 0n)
    return { ok: false, reason: "OracleInvalid" };
  const previousTradeTs =
    kind === "burn" ? machine.last_burn_ts : machine.last_jackpot_buy_ts;
  const spacing =
    kind === "burn" ? BURN.minSpacingSeconds : JACKPOT.trancheMinSpacingSeconds;
  if (now < previousTradeTs + BigInt(spacing))
    return { ok: false, reason: "TooSoon" };
  const bounds = kind === "burn" ? BURN : JACKPOT;
  const reserveCap =
    (reference.quoteReserve * BigInt(bounds.trancheMaxBpsOfQuoteReserves)) /
    BigInt(BPS_DENOMINATOR);
  const available = kind === "burn" ? machine.burn_sol : machine.jackpot_sol;
  const amount = min(
    bounds.trancheMaxLamports,
    available,
    reserveCap,
    ...(kind === "burn"
      ? [
          BURN.hourlyMaxLamports > machine.burn_paid_hour
            ? BURN.hourlyMaxLamports - machine.burn_paid_hour
            : 0n,
        ]
      : []),
  );
  if (amount < policy.minTrancheLamports)
    return { ok: false, reason: "BelowMinimumTranche" };
  return {
    ok: true,
    plan: {
      kind,
      code: kind === "burn" ? 3 : 4,
      amount,
      previousTradeTs,
      snapshot: { ...snapshot, machine },
      reference,
    },
  };
}
export function executorDelay(
  kind: ExecutorKind,
  policy: ExecutorPolicy,
  random: () => number = Math.random,
): number {
  const lo =
    kind === "burn"
      ? policy.burnTrancheSpacingSecondsMin
      : policy.jackpotTrancheSpacingSecondsMin;
  const hi =
    kind === "burn"
      ? policy.burnTrancheSpacingSecondsMax
      : policy.jackpotTrancheSpacingSecondsMax;
  const value = random();
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value >= 1 ||
    !Number.isSafeInteger(lo) ||
    !Number.isSafeInteger(hi) ||
    lo <= 0 ||
    hi < lo
  )
    throw new Error("executor_spacing_invalid");
  return (lo + Math.floor(value * (hi - lo + 1))) * 1000;
}
