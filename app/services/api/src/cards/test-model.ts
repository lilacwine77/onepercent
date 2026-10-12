import { readFileSync } from "node:fs";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { cardCopy } from "@onepercent/eligibility";
import { cardTicker } from "@onepercent/eligibility/format";
import type { CardModel } from "./xray-card.js";

export function fixtureModel(name: "trencher" | "clean"): CardModel {
  const result = XrayResultSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../xray/__fixtures__/result.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  if (name === "clean") {
    result.counts = {
      bags: 0,
      feedable: 0,
      checkAtFeed: 0,
      notFeedable: 0,
      sellable: 0,
      empty: 0,
      notInSet: 0,
    };
    result.totals = { sellValueSol: "0", rentBackSol: "0" };
    result.bags = [];
    result.emptyAccounts = [];
    result.worst = null;
    result.card = cardCopy({
      address: result.address,
      bags: 0,
      dust: 0,
      empties: 0,
      worst: null,
    });
  }
  return {
    result,
    coins: result.bags
      .filter((bag) => !bag.buckets.includes("not_in_set"))
      .sort((a, b) => a.mint.localeCompare(b.mint))
      .slice(0, 3)
      .map((bag) => ({
        ticker: cardTicker(bag.symbol, bag.mint),
        drawdownPct: null,
      })),
  };
}
