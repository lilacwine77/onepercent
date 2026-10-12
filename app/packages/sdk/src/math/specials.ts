import { JACKPOT, PACK_EDITIONS, TOKEN_1PCT } from "@onepercent/config";
import { LIVE_FLAGS, ONE_PCT_STATE } from "../constants.js";
import type { Machine } from "../layouts.js";

type SpecialMachine = Pick<
  Machine,
  "on_air_ts" | "onepct" | "jackpot_tokens" | "jackpot_cost"
>;
const I64_MAX = (1n << 63n) - 1n;
const releaseAt = (onAir: bigint, offset: number): bigint => {
  const time = onAir + BigInt(offset);
  return time > I64_MAX ? I64_MAX : time;
};

export function releaseTimes(machine: Pick<Machine, "on_air_ts">): bigint[] {
  return TOKEN_1PCT.onePctReleaseOffsetsSeconds.map((offset) =>
    releaseAt(machine.on_air_ts, offset),
  );
}

export function onePctLiveIndex(
  machine: Pick<SpecialMachine, "on_air_ts" | "onepct">,
  nowTs: bigint,
): number | null {
  if (machine.on_air_ts === 0n) return null;
  for (let index = 0; index < TOKEN_1PCT.onePctCardCount; index++) {
    const state = machine.onepct[index]?.state;
    if (state === ONE_PCT_STATE.pulled) continue;
    if (state !== ONE_PCT_STATE.locked && state !== ONE_PCT_STATE.live)
      return null;
    return nowTs >=
      releaseAt(
        machine.on_air_ts,
        TOKEN_1PCT.onePctReleaseOffsetsSeconds[index]!,
      )
      ? index
      : null;
  }
  return null;
}

export function jackpotLive(
  machine: Pick<SpecialMachine, "jackpot_tokens" | "jackpot_cost">,
  price: bigint,
): boolean {
  return (
    machine.jackpot_tokens > 0n &&
    machine.jackpot_cost >= BigInt(JACKPOT.minPotPriceMultiple) * price
  );
}

export function liveFlags(
  machine: SpecialMachine,
  edition: number,
  nowTs: bigint,
): { flags: number; onePctIndex: number | null } {
  const item = PACK_EDITIONS[edition];
  if (!item) throw new RangeError("Invalid edition");
  const onePctIndex = onePctLiveIndex(machine, nowTs);
  return {
    flags:
      (onePctIndex === null ? 0 : LIVE_FLAGS.onePct) |
      (jackpotLive(machine, item.priceLamports) ? LIVE_FLAGS.jackpot : 0),
    onePctIndex,
  };
}
