import { JACKPOT, TOKEN_1PCT } from "@onepercent/config";
import { LIVE_FLAGS } from "@onepercent/sdk/constants";
import type { Config, Machine } from "@onepercent/sdk/layouts";

/** M4 §7.1: a later slot waits for every earlier slot to be pulled. */
export function onePctLiveIndex(
  machine: Pick<Machine, "on_air_ts" | "onepct">,
  nowSeconds: bigint,
): number | null {
  if (machine.on_air_ts === 0n) return null;
  for (const [index, slot] of machine.onepct.entries()) {
    if (slot.state === 2) continue;
    if (slot.state !== 0 && slot.state !== 1) return null;
    const offset = TOKEN_1PCT.onePctReleaseOffsetsSeconds[index];
    return slot.amount > 0n &&
      offset !== undefined &&
      nowSeconds >= machine.on_air_ts + BigInt(offset)
      ? index
      : null;
  }
  return null;
}

/** Pending season draws retain special widths until the actual final snapshot. */
export function specialLiveFlags(
  machine: Pick<
    Machine,
    "on_air_ts" | "onepct" | "jackpot_tokens" | "jackpot_cost"
  >,
  priceLamports: bigint,
  nowSeconds: bigint,
): number {
  return (
    (onePctLiveIndex(machine, nowSeconds) === null ? 0 : LIVE_FLAGS.onePct) |
    (machine.jackpot_tokens > 0n &&
    machine.jackpot_cost >= priceLamports * BigInt(JACKPOT.minPotPriceMultiple)
      ? LIVE_FLAGS.jackpot
      : 0)
  );
}

export function tokenModel(
  config: Pick<Config, "token_mint">,
  machine: Machine,
  nowSeconds: bigint,
) {
  const mint = config.token_mint.toBytes().every((byte) => byte === 0)
    ? null
    : config.token_mint.toBase58();
  const liveIndex = onePctLiveIndex(machine, nowSeconds);
  return {
    mint,
    burnedTokens: machine.burned_total,
    jackpot: {
      tokens: machine.jackpot_tokens,
      costLamports: machine.jackpot_cost,
      conversionLamports: machine.jackpot_sol,
    },
    onePct: machine.onepct.map((slot, index) => ({
      index,
      amount: slot.amount,
      state: slot.state,
      live: index === liveIndex,
      releaseTs:
        machine.on_air_ts === 0n
          ? null
          : machine.on_air_ts +
            BigInt(TOKEN_1PCT.onePctReleaseOffsetsSeconds[index]!),
    })),
  };
}
