import { expect, it } from "vitest";
import { devnetMajorFixtureProfile } from "./devnet-major.js";
import { HIT_LIST } from "./index.js";

it("selects the explicit fictitious devnet inventory without changing production hit lists", () => {
  const before = structuredClone(HIT_LIST);
  const profile = devnetMajorFixtureProfile("devnet");
  expect(profile.name).toBe("devnet-major-sol-fixture-v1");
  expect(profile.coverageLamports).toBe(1_500_000_000n);
  expect(profile.deliveredBaseUnits).toBe(1_500_000n);
  expect(profile.bucketCapLamports).toBe(5_000_000_000n);
  expect(profile.bucketCapLamports >= 3n * profile.coverageLamports).toBe(true);
  expect(HIT_LIST).toEqual(before);
  expect(
    JSON.stringify(HIT_LIST, (_, value: unknown) =>
      typeof value === "bigint" ? String(value) : value,
    ),
  ).not.toContain(profile.mint);
});

it.each(["mainnet", "mainnet-beta", "localnet", ""])(
  "refuses the MAJOR fixture on %s",
  (cluster) => {
    expect(() => devnetMajorFixtureProfile(cluster)).toThrow(
      "devnet_major_fixture_requires_devnet",
    );
  },
);
