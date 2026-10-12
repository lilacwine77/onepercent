import { describe, expect, it } from "vitest";
import { en, t } from "../src/index.js";
import { en as initial, t as initialT, type CopyKey } from "../src/initial.js";
import { routes } from "../src/catalog-routes.js";

describe("initial copy boundary", () => {
  it("partitions the complete COPY deck without duplicate keys", () => {
    expect(Object.keys(initial).filter((key) => key in routes)).toEqual([]);
    expect({ ...initial, ...routes }).toEqual(en);
    for (const prefix of [
      "rip.",
      "cards.",
      "fairness.",
      "verify.",
      "live.",
      "token.",
    ]) {
      expect(Object.keys(initial).some((key) => key.startsWith(prefix))).toBe(
        false,
      );
    }
  });
  it("preserves every initial template, placeholder and plural", () => {
    const translate = initialT as (
      key: CopyKey,
      vars: Record<string, string>,
    ) => string;
    const full = t as typeof translate;
    for (const [key, value] of Object.entries(initial)) {
      const vars = Object.fromEntries(
        [...value.matchAll(/\{([^}]+)\}/g)].map((match) => [match[1]!, "123"]),
      );
      expect(translate(key as CopyKey, vars)).toBe(full(key as CopyKey, vars));
      if (key.endsWith(".one")) {
        for (const n of ["1", "2"]) {
          const base = key.slice(0, -4) as CopyKey;
          const other = en[`${base}.other` as keyof typeof en];
          const pluralVars = Object.fromEntries(
            [...other.matchAll(/\{([^}]+)\}/g)].map((match) => [
              match[1]!,
              "123",
            ]),
          );
          expect(translate(base, { ...pluralVars, n })).toBe(
            full(base, { ...pluralVars, n }),
          );
        }
      }
    }
  });
  it("rejects route-only keys at the initial import boundary", () => {
    // @ts-expect-error Route copy must use the lazy catalog entry.
    expect(() => initialT("rip.title")).toThrow("Missing copy variables");
  });
});
