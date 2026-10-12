import {
  CARDS_PER_PACK,
  COVERAGE,
  JACKPOT,
  PACK_EDITIONS,
  PAUSE_BITS,
  TOKEN_1PCT,
  VRF,
} from "@onepercent/config";
import { count } from "@onepercent/copy";
import {
  LIVE_FLAGS,
  PHASE,
  maxQty,
  type Config,
  type Machine,
} from "@onepercent/sdk/browser";
import type { VrfStatus } from "@onepercent/sdk/api";
import type { EditionModel, Value } from "../bridge/contracts.pending";

/** M4's lazy promotion: a stored Live byte alone never establishes liveness. */
export function onePctLiveIndex(
  machine: Machine,
  nowTs: bigint,
): number | null {
  if (machine.on_air_ts === 0n) return null;
  for (const [index, slot] of machine.onepct.entries()) {
    if (slot.state === 2) continue;
    const offset = TOKEN_1PCT.onePctReleaseOffsetsSeconds[index];
    return (slot.state === 0 || slot.state === 1) &&
      slot.amount > 0n &&
      offset !== undefined &&
      nowTs >= machine.on_air_ts + BigInt(offset)
      ? index
      : null;
  }
  return null;
}

export function editionModels(input: {
  config: Config;
  machine: Machine;
  deckLen: number;
  nowTs: bigint;
  vrf: VrfStatus | null;
  qty?: number;
  jackpotValue?: Value;
}): EditionModel[] {
  const { machine, config, nowTs, vrf } = input;
  const onePct = onePctLiveIndex(machine, nowTs);
  return PACK_EDITIONS.map((edition) => {
    const available = maxQty(
      edition.index,
      input.deckLen,
      machine.reserved_dust,
      machine.buckets,
    );
    const qty = input.qty ?? 1;
    const state: EditionModel["state"] =
      machine.phase >= PHASE.buysClosed ||
      (machine.end_ts > 0n && nowTs >= machine.end_ts)
        ? "seasonOver"
        : machine.phase !== PHASE.onAir
          ? "beforeOnAir"
          : ((config.admin_paused | config.guardian_paused) &
                PAUSE_BITS.rip) !==
              0
            ? "paused"
            : !vrf ||
                vrf.busy ||
                vrf.occupancyBps === null ||
                vrf.occupancyBps > VRF.busyOccupancyBps ||
                (vrf.oldestItemAgeSeconds !== null &&
                  vrf.oldestItemAgeSeconds > VRF.busyOldestItemSeconds)
              ? "busy"
              : BigInt(input.deckLen) <
                  machine.reserved_dust +
                    BigInt(CARDS_PER_PACK.dust * qty + COVERAGE.dustBuffer)
                ? "hungry"
                : available < qty
                  ? "refilling"
                  : "covered";
    const liveFromLamports =
      BigInt(JACKPOT.minPotPriceMultiple) * edition.priceLamports;
    return {
      id: edition.id,
      priceLamports: edition.priceLamports,
      maxQty: available,
      maxPerRip: edition.maxPerRip,
      state,
      stateLine:
        state === "covered"
          ? { key: "rip.state.covered", vars: { n: count(available) } }
          : state === "seasonOver"
            ? { key: "errors.seasonOver" }
            : state === "paused"
              ? { key: "errors.paused" }
              : state === "refilling"
                ? { key: "rip.state.refilling" }
                : state === "hungry"
                  ? { key: "rip.state.hungry" }
                  : state === "beforeOnAir"
                    ? { key: "rip.state.beforeOnAir" }
                    : { key: "rip.state.busy" },
      jackpot: {
        tokens: machine.jackpot_tokens,
        value: input.jackpotValue ?? { kind: "none" },
        live:
          machine.jackpot_tokens > 0n &&
          machine.jackpot_cost >= liveFromLamports,
        liveFromLamports,
      },
      onePct: {
        live: onePct !== null,
        card: onePct === null ? null : onePct + 1,
        of: TOKEN_1PCT.onePctCardCount,
      },
    };
  });
}

export const editionLiveFlags = (edition: EditionModel) =>
  (edition.jackpot.live ? LIVE_FLAGS.jackpot : 0) |
  (edition.onePct.live ? LIVE_FLAGS.onePct : 0);

/** A malformed or oversized deep link can never increase the chain allowance. */
export function clampQuantity(value: string | number | null, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Math.min(
    maximum,
    Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1,
  );
}
