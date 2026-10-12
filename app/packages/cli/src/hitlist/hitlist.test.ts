import { expect, it } from "vitest";
import { HIT_LIST, SERVICES } from "@onepercent/config";
import { listingOracle, validateReport } from "./index.js";
import type { ListingReport } from "@onepercent/market";
const mint = HIT_LIST.launchMajors[0]!.mint;
const report: ListingReport = {
  version: "x2-listing-v1",
  mint,
  class: "MAJOR",
  checkedAt: 1000,
  pass: true,
  criteria: [
    {
      id: "never_listed",
      pass: true,
      observed: "WIF",
      threshold: ["PUMP", "1PCT"],
      source: "test",
    },
  ],
  info: {
    capLamports: "1000000000",
    excludedHolders: null,
    jupiterTopHoldersPercentage: null,
  },
};
it("binds a fresh report to the mint and class and refuses failure, future and stale reports", () => {
  expect(validateReport(report, mint, "major", 1000)).toBe(1000000000n);
  for (const bad of [
    { ...report, pass: false },
    { ...report, criteria: [] },
    { ...report, checkedAt: 1001 },
  ])
    expect(() => validateReport(bad, mint, "major", 1000)).toThrow();
  expect(() => validateReport(report, mint, "trending", 1000)).toThrow();
  expect(() =>
    validateReport(
      report,
      mint,
      "major",
      1001 + SERVICES.stock.hitlistReportMaxAgeSeconds * 1000,
    ),
  ).toThrow();
  expect(listingOracle(mint, "major").toBuffer().toString("hex")).toBe(
    HIT_LIST.launchMajors[0]!.pythFeedId,
  );
  expect(() =>
    listingOracle("11111111111111111111111111111111", "major"),
  ).toThrow();
});
