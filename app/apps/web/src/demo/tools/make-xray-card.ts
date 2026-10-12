/**
 * PREVIEW only: renders the sample bags' X-ray share card with the API's own
 * template (services/api/src/cards), for the X-ray flow in demo mode.
 *   pnpm exec tsx apps/web/src/demo/tools/make-xray-card.ts
 */
import { writeFile } from "node:fs/promises";
import { renderCardPng } from "../../../../../services/api/src/cards/render.js";
import { DEFAULT_DEMO_WALLET, SAMPLE_BAGS, SAMPLE_EMPTIES } from "../data.js";
import { buildXray } from "../xray.js";

const result = buildXray(
  DEFAULT_DEMO_WALLET,
  SAMPLE_BAGS,
  SAMPLE_EMPTIES,
  "https://onepercent.fun",
  "/card.png",
);
const coins = [...result.bags]
  .filter((bag) => bag.buckets.includes("feedable"))
  .slice(0, 3)
  .map((bag) => ({
    ticker: bag.symbol,
    drawdownPct:
      SAMPLE_BAGS.find((b) => b.mint === bag.mint)?.drawdownPct ?? null,
  }));
const png = await renderCardPng({ result, coins }, "landscape");
await writeFile(new URL("../xray-card.png", import.meta.url), png);
console.log(`xray-card.png ${png.length} bytes`);
