import "./test-setup.js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { solToLamports } from "@onepercent/eligibility/format";
import { createFixtureSources } from "./fixture-source.js";
import { XrayService } from "./service.js";

async function fixtureService() {
  const sources = await createFixtureSources();
  return {
    sources,
    service: new XrayService({
      ...sources,
      snsEnabled: true,
      publicWebUrl: "http://localhost:5173",
      publicApiUrl: "http://localhost:3000",
      now: () => Date.parse("2026-10-08T12:00:00.000Z"),
      allowedAddresses: new Set(Object.values(sources.owners)),
    }),
  };
}
describe("recorded synthetic-wallet scans", () => {
  it("matches the golden result shared with web and checks every result invariant", async () => {
    const { sources, service } = await fixtureService();
    const result = await service.get(sources.owners.trencher!);
    const golden = XrayResultSchema.parse(
      JSON.parse(
        await readFile(
          new URL("./__fixtures__/result.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const web = XrayResultSchema.parse(
      JSON.parse(
        await readFile(
          new URL(
            "../../../../apps/web/src/xray/__fixtures__/result.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    expect(result).toEqual(golden);
    expect(web).toEqual(golden);
    const { counts, bags, emptyAccounts, totals } = result;
    expect(counts.bags).toBe(
      counts.feedable + counts.checkAtFeed + counts.notFeedable,
    );
    expect(bags.length).toBe(counts.bags + counts.notInSet);
    expect(counts.sellable).toBe(
      bags.filter((bag) => bag.buckets.includes("sell")).length,
    );
    expect(counts.empty).toBe(emptyAccounts.length);
    expect(solToLamports(totals.sellValueSol)).toBe(
      bags
        .filter((bag) => bag.buckets.includes("sell"))
        .reduce((sum, bag) => sum + solToLamports(bag.valueSol!), 0n),
    );
    expect(solToLamports(totals.rentBackSol)).toBe(
      emptyAccounts.reduce(
        (sum, account) => sum + BigInt(account.rentLamports),
        0n,
      ),
    );
    expect(bags.every((bag) => !bag.buckets.includes("close"))).toBe(true);
    expect(result.worst).toBeNull();
    expect(await service.get("trencher.sns")).toEqual({
      ...golden,
      cached: true,
    });
  });
  it("resolves fixture names only and keeps clean/mixed bags distinct", async () => {
    const { service } = await fixtureService();
    const clean = await service.get("clean.sns");
    expect(clean.counts.bags).toBe(0);
    expect(clean.bags).toHaveLength(0);
    const mixed = await service.get("mixed.sns");
    expect(mixed.counts.bags).toBe(0);
    expect(mixed.counts.notInSet).toBeGreaterThan(0);
    expect(mixed.counts.sellable).toBe(0);
    expect(mixed.bags.every((bag) => bag.valueSol === undefined)).toBe(true);
    await expect(service.get("other.sns")).rejects.toMatchObject({
      code: "not_in_fixtures",
    });
  });
});
