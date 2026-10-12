/** PREVIEW builds only: an X-ray result (X1 schema) for the X-ray flow in demo mode. */
import type { XrayResult } from "@onepercent/eligibility/xray-result";
import type { DemoBag } from "./data";

const sol = (lamports: bigint) => {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
};
export function buildXray(
  address: string,
  bags: DemoBag[],
  empties: { address: string; lamports: bigint }[],
  origin: string,
  cardUrl: string,
): XrayResult {
  const inSet = bags.filter((b) => b.kind !== "notInSet");
  const worst = [...inSet]
    .filter((b) => b.drawdownPct !== null)
    .sort((a, b) => (b.drawdownPct ?? 0) - (a.drawdownPct ?? 0))[0];
  const count = inSet.length;
  const condition =
    count === 0
      ? "Mint"
      : count <= 3
        ? "Near Mint"
        : count <= 10
          ? "Lightly Played"
          : count <= 30
            ? "Played"
            : count <= 80
              ? "Heavily Played"
              : "Damaged";
  const pageUrl = `${origin}/x/${address}?ref=${address}`;
  return {
    address,
    chain: "solana",
    scannedAt: new Date().toISOString(),
    cached: false,
    counts: {
      bags: count,
      feedable: bags.filter((b) => b.kind === "feedable").length,
      checkAtFeed: bags.filter((b) => b.kind === "checkAtFeed").length,
      notFeedable: bags.filter((b) => b.kind === "bid").length,
      sellable: bags.filter((b) => b.valueLamports > 0n).length,
      empty: empties.length,
      notInSet: bags.filter((b) => b.kind === "notInSet").length,
    },
    totals: {
      sellValueSol: sol(
        bags
          .filter((b) => b.kind === "bid")
          .reduce((s, b) => s + b.valueLamports, 0n),
      ),
      rentBackSol: sol(empties.reduce((s, e) => s + e.lamports, 0n)),
    },
    worst: worst
      ? {
          symbol: worst.symbol,
          mint: worst.mint,
          drawdownPct: worst.drawdownPct ?? 0,
        }
      : null,
    bags: bags.map((b) => ({
      mint: b.mint,
      symbol: b.symbol,
      name: b.name,
      logoUrl: b.logo ? `${origin}${b.logo}` : null,
      amountUi: b.amountUi,
      decimals: b.decimals,
      tokenProgram: "spl" as const,
      ...(b.kind === "feedable"
        ? {
            buckets:
              b.valueLamports > 0n
                ? (["feedable", "sell"] as const)
                : (["feedable"] as const),
          }
        : b.kind === "checkAtFeed"
          ? {
              buckets: ["feedable"] as const,
              reasonCode: "snapshot_at_feed" as const,
              reason: "Final check when you Feed",
            }
          : b.kind === "bid"
            ? {
                buckets: ["not_feedable_season", "sell"] as const,
                reasonCode: "snapshot_not_held" as const,
                reason: "Not feedable this season",
              }
            : {
                buckets: ["not_in_set"] as const,
                reasonCode: "not_pump_fun" as const,
                reason: "Not from pump.fun",
              }),
      ...(b.valueLamports > 0n
        ? { valueSol: sol(b.valueLamports), priceAgeSlots: 4 }
        : {}),
    })) as XrayResult["bags"],
    emptyAccounts: empties.map((e, i) => ({
      address: e.address,
      mint: bags[i % Math.max(1, bags.length)]?.mint ?? e.address,
      rentLamports: Number(e.lamports),
    })),
    card: {
      title: "Certified Bagholder",
      condition,
      oneLiner: "You didn’t lose money. You collected it.",
    },
    share: {
      landscapeUrl: `${origin}${cardUrl}`,
      squareUrl: `${origin}${cardUrl}`,
      xIntentUrl: `https://x.com/intent/post?text=${encodeURIComponent(`X-ray ✳ ${count} bags ✳ Certified Bagholder`)}&url=${encodeURIComponent(pageUrl)}`,
    },
  };
}
