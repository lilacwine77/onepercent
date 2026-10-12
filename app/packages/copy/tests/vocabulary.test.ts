import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../src/index.js";

const appRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
);
const instructions = readFileSync(resolve(appRoot, "../AGENTS.md"), "utf8");
// M1's canonical vocabulary module is absent on this branch; read its authority directly.
const prohibited = [1, 2, 3].flatMap((number) => {
  const line = instructions
    .split("\n")
    .find((item) => item.trimStart().startsWith(`${number}. `));
  const words = line?.split(": ").at(-1)?.split(". ")[0];
  if (!words) throw new Error(`Missing vocabulary list ${number}`);
  return words
    .replace(/\s*\(say [^)]*\)/g, "")
    .replace(/\.$/, "")
    .split(", ")
    .map((word) => word.replaceAll('"', "").trim());
});
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("public copy vocabulary", () => {
  it("checks all three authoritative lists with case-insensitive whole-word matching", () => {
    expect(prohibited.length).toBeGreaterThan(40);
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])(?:${prohibited.map(escape).join("|")})(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    for (const word of prohibited) {
      expect(pattern.test(word.toUpperCase())).toBe(true);
      expect(pattern.test(`prefix${word}suffix`)).toBe(false);
    }
    for (const [key, value] of Object.entries(en)) {
      expect(pattern.test(value), key).toBe(false);
    }
  });
});
