import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en, placeholderFormatters } from "../src/index.js";

// Resolve the workspace itself because the test runner aliases paths containing percent signs.
const root = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
);
const source = readFileSync(resolve(root, "../docs/codex/COPY.md"), "utf8");
const sections = source.split("## 1. Shell and common")[1]!;
const deck = Object.fromEntries(
  [...sections.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gm)].map((match) => [
    match[1]!,
    match[2]!.replaceAll("\\n", "\n"),
  ]),
);
describe("COPY.md issued sections parity", () => {
  it("matches every key and byte, D9 and D30 corrections included", () => {
    expect(Object.keys(deck).length).toBeGreaterThan(300);
    expect(deck["cards.figure.sell"]).toBe("+{sol} SOL · instant");
    expect(en).toEqual(deck);
    expect(Object.values(en).some((value) => value.includes(".sol"))).toBe(
      false,
    );
  });
  it("keeps the exact placeholder sets and gives every one a formatter", () => {
    const names = (text: string) =>
      [
        ...new Set(
          [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!),
        ),
      ].sort();
    for (const [key, value] of Object.entries(en)) {
      expect(names(value), key).toEqual(names(deck[key]!));
      for (const name of names(value))
        expect(name in placeholderFormatters, `${key}: ${name}`).toBe(true);
    }
  });
  it("keeps every plural pair complete", () => {
    for (const key of Object.keys(en)) {
      if (key.endsWith(".one"))
        expect(`${key.slice(0, -4)}.other` in en, key).toBe(true);
      if (key.endsWith(".other"))
        expect(`${key.slice(0, -6)}.one` in en, key).toBe(true);
    }
  });
});
