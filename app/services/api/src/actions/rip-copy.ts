import { t, solCost, sol } from "@onepercent/copy";
import { BPS_DENOMINATOR, HIT_TIERS, PACK_EDITIONS } from "@onepercent/config";
import type { MachineResponse } from "@onepercent/sdk/api";

// M5 amendment 1 is the local binding copy until the central Blinks keys ship.
export const RIP_COPY = {
  off: "This Blink is off right now.",
  badRequest: "That request isn’t valid.",
  genericTitle: "Rip a pack",
  title: (edition: string, price: string) => `${edition} ✳ ${price} SOL`,
  edition: (edition: string) => `Rip ${edition}`,
  label: (n: number) => `Rip ${n} ${n === 1 ? "pack" : "packs"}`,
  upTo: (n: number) => `Rip up to ${n} now`,
  contents: (dust: number, hit: number) =>
    `${dust} Dust Cards + ${hit} hit per pack`,
  verifiable: "every draw can be verified",
  beforeOnAir: "Packs are not open yet.",
  done: (host: string) =>
    `Ripped. The draw is on-chain: see your pack in My cards on ${host}.`,
  hungry: "Machine hungry ✳ Feed bags or feed back your dust",
  busy: "Machine busy ✳ try again in a few seconds.",
  machineChanged:
    "The machine changed while you were signing. No pack was bought, and the pack price stayed in your wallet.",
  myCardsFull: "My cards is full ✳ Redeem, sell or feed some cards",
  refilling: (index: number, machine: MachineResponse | null) => {
    const edition = PACK_EDITIONS[index]!;
    const largest = HIT_TIERS.reduce(
      (value, tier) => Math.max(value, tier.valueBps),
      0,
    );
    const required =
      (edition.priceLamports * BigInt(largest)) / BigInt(BPS_DENOMINATOR);
    const free = (machine?.stock.buckets ?? [])
      .filter((bucket) => bucket.class === "MAJOR" && bucket.enabled)
      .reduce(
        (value, bucket) =>
          BigInt(bucket.free) > value ? BigInt(bucket.free) : value,
        0n,
      );
    return `${edition.name} opens when one major holds ${solCost(required)} SOL free ✳ now ${sol(free)}`;
  },
  notFound: () => t("common.notFound"),
  unavailable: () => t("common.networkError"),
  paused: () => t("errors.paused"),
  seasonOver: () => t("errors.seasonOver"),
  invalidAddress: () => t("xray.error.invalid_address"),
  limited: (seconds: number) => t("errors.rateLimited", { s: String(seconds) }),
  simulation: () => t("errors.simulation"),
  insufficientSol: (sol: string) => t("errors.insufficientSol", { sol }),
} as const;
