import "./setup.js";
import { expect, it } from "vitest";
import { BANNED_COPY, BANNED_EVERYWHERE } from "@onepercent/config";
import { RIP_COPY } from "../rip-copy.js";
import { IMAGE_COPY } from "../image-copy.js";
import { checkBlinks } from "../check.js";
import { createCheckFixture, fixtureSnapshot } from "./validation-fixtures.js";

it("C2.03 scans every Rip/image copy key and the registration text", async () => {
  const argumentsByKey: Record<string, unknown[][]> = {
    title: [["The Original", "0.1"]],
    edition: [["The Original"]],
    label: [[1], [5]],
    upTo: [[5]],
    contents: [[4, 1]],
    done: [["onepercent.fun"]],
    refilling: [
      [0, null],
      [0, fixtureSnapshot("covered5").machine],
    ],
    limited: [[60]],
    insufficientSol: [["0.11"]],
    asOf: [["12:34 UTC"]],
    jackpot: [
      ["12", null],
      ["12", "0.1"],
    ],
    onePct: [[1, 100]],
    feedTitle: [["TOKEN"]],
    feedDescription: [["0.001", "0.002"]],
  };
  function strings(value: unknown, key = ""): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "function") {
      const args =
        argumentsByKey[key] ?? (value.length === 0 ? [[]] : undefined);
      expect(args, `Missing copy arguments for ${key}`).toBeDefined();
      return args!.flatMap((input) => strings(value(...input), key));
    }
    if (value && typeof value === "object")
      return Object.entries(value).flatMap(([name, item]) =>
        strings(item, name),
      );
    throw new Error("Unsupported copy value");
  }
  const app = createCheckFixture("covered5");
  const { sheet } = await checkBlinks({
    origin: "https://onepercent.test",
    cluster: "devnet",
    samples: [],
    fetcher: async (url, init) => app.request(url, init),
  });
  for (const text of [...strings(RIP_COPY), ...strings(IMAGE_COPY), sheet]) {
    expect(text).not.toContain("\u2014");
    expect(text).not.toMatch(
      /\b(?:coming soon|on air soon|from on air|(?:start|live|launch|available)s? (?:at|by|from) (?:on air|launch))\b/i,
    );
    for (const word of [...BANNED_EVERYWHERE, ...BANNED_COPY])
      expect(text).not.toMatch(new RegExp("\\b" + word + "\\b", "i"));
  }
});

it("keeps the pre-OnAir state factual in Rip responses and images", () => {
  expect(RIP_COPY.beforeOnAir).toBe("Packs are not open yet.");
  expect(IMAGE_COPY.state.beforeOnAir).toBe(RIP_COPY.beforeOnAir);
});
