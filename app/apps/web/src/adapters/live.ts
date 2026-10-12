import { SEASON } from "@onepercent/config";
import { PHASE } from "@onepercent/sdk/constants";
import type { MachineResponse } from "@onepercent/sdk/api";
import type { Machine } from "@onepercent/sdk/layouts";
import type { LiveSnapshot } from "../data/stream";
import { tvEvents } from "./tv-events";

export function liveModel(
  machine: MachineResponse,
  chain: Pick<Machine, "on_air_ts" | "end_ts" | "phase">,
  nowSeconds: bigint,
  live: Pick<LiveSnapshot, "onAir">,
  events: readonly unknown[],
) {
  const phase = chain.phase;
  const state:
    | "sealed"
    | "finalPull"
    | "buysClosed"
    | "lastCall"
    | "onAir"
    | "countdown"
    | "idle" =
    phase === PHASE.done
      ? "sealed"
      : phase === PHASE.buysClosed ||
          (phase === PHASE.onAir &&
            chain.end_ts > 0n &&
            nowSeconds >= chain.end_ts)
        ? "buysClosed"
        : phase === PHASE.finalPull
          ? "finalPull"
          : phase === PHASE.onAir &&
              nowSeconds >= chain.end_ts - BigInt(SEASON.lastCallSeconds)
            ? "lastCall"
            : phase === PHASE.onAir
              ? "onAir"
              : phase === PHASE.poweredOn
                ? "countdown"
                : "idle";
  return {
    asOfSlot: machine.asOfSlot,
    stockLamports: BigInt(machine.stock.book),
    deckCards: machine.deck.len,
    pendingPulls: BigInt(machine.pendingPulls),
    jackpotTokens: BigInt(machine.jackpot.tokens),
    tv: {
      state,
      onAir: live.onAir,
      countdownTo: state === "countdown" ? chain.on_air_ts : null,
      events: tvEvents(events),
    },
  };
}
