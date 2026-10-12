import { describe, expect, it, vi } from "vitest";
import { count, createTranslator, t } from "../src/index.js";

describe("typed copy resolution", () => {
  it("resolves placeholders and plural forms", () => {
    expect(t("common.loading")).toBe("Loading…");
    expect(t("count.bags", { n: count(1) })).toBe("1 bag");
    expect(t("count.bags", { n: count(1200) })).toBe("1,200 bags");
    expect(t("count.bags", { n: count(0) })).toBe("0 bags");
    expect(t("feed.group.feed", { n: count(12) })).toBe("12 bags to feed");
    expect(t("xray.share.intent", { n: count(1), title: "Dust Bunny" })).toBe(
      "X-ray ✳ 1 bag ✳ Dust Bunny",
    );
  });
  it("does not reinterpret substitution text as a template", () => {
    expect(t("xray.head", { who: "{sol}" })).toBe("X-ray ✳ {sol}");
  });
  it("throws for missing and unformatted variables in tests", () => {
    // @ts-expect-error The key requires a formatted SOL amount.
    expect(() => t("common.sol")).toThrow("Missing copy variables");
    // @ts-expect-error Numeric copy values must pass through a formatter.
    expect(() => t("common.sol", { sol: 12 })).toThrow(
      "Missing copy variables",
    );
    // @ts-expect-error A plural base requires the formatted count even for its singular form.
    expect(() => t("count.bags", {})).toThrow("Missing copy variables");
    // @ts-expect-error A different variable does not satisfy this key.
    expect(() => t("wallet.connected", { who: "1111…1111" })).toThrow(
      "Missing copy variables",
    );
  });
  it("returns the key in production and logs each bad key once without values", () => {
    const reportMissing = vi.fn();
    const production = createTranslator({ production: true, reportMissing });
    // @ts-expect-error Exercises a malformed boundary.
    expect(production("common.sol")).toBe("common.sol");
    // @ts-expect-error Exercises the same malformed boundary again.
    expect(production("common.sol")).toBe("common.sol");
    expect(reportMissing).toHaveBeenCalledExactlyOnceWith("common.sol");
  });
});
