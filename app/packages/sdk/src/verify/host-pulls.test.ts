import { describe, expect, it, vi } from "vitest";
import { RevealedPack } from "../api/responses.js";
import host from "./fixtures/m1-host-pulls.json" with { type: "json" };
import { verifyPull } from "./index.js";

vi.mock("@onepercent/config", () => import("./fixtures/m1-config.js"));

const named = (name: string) => {
  const found = host.cases.find((row) => row.name === name);
  if (!found) throw new Error(`Missing Rust host case ${name}`);
  return found;
};

describe("independent Rust host Pull math, without validator execution", () => {
  it("keeps host vectors distinct from the 100 recorded validator Pulls", () => {
    expect(host.provenance.validatorPulls).toBe(0);
    expect(host.cases).toHaveLength(host.provenance.cases);
    expect(host.cases.reduce((sum, row) => sum + row.packs.length, 0)).toBe(
      host.provenance.packs,
    );
    expect(host.provenance.pendingG1Captures).not.toHaveLength(0);
  });

  it.each(host.cases)(
    "$name matches Rust samples, widths, tiers, dust picks and caller seed",
    async (row) => {
      const result = await verifyPull(row);
      expect(result.ok).toBe(true);
      expect(result.complete).toBe(true);
      expect(result.packs).toHaveLength(row.pull.qty);
      expect(result.callerSeed).toEqual({
        computed: row.pull.callerSeed,
        matches: true,
      });
      expect(result.packs.every((pack) => pack.metadataMatches)).toBe(true);
    },
  );

  it("covers legal x5/x10 Rips and After Hours at its x5 limit", () => {
    expect(named("original_ten").pull.qty).toBe(10);
    expect(named("blue_shift_ten").pull.qty).toBe(10);
    expect(named("signature_five").pull.qty).toBe(5);
    expect(named("after_hours_five").pull).toMatchObject({
      edition: 3,
      qty: 5,
    });
  });

  it("checks the short-Deck transition to zero-valued House picks", async () => {
    const row = named("short_deck_house_five");
    expect(row.initialDeckLen).toBe(3);
    expect(row.packs[0]?.dust.map((pick) => pick.deckLenBefore)).toEqual([
      3, 2, 1, 0,
    ]);
    expect(row.packs.map((pack) => pack.houseMask)).toEqual([
      8, 15, 15, 15, 15,
    ]);
    const result = await verifyPull(row);
    expect(result.ok).toBe(true);
    expect(result.packs.slice(1).flatMap((pack) => pack.dust)).toHaveLength(16);
    expect(
      result.packs
        .slice(1)
        .flatMap((pack) => pack.dust)
        .every((pick) => pick.computed === 0 && pick.matches),
    ).toBe(true);
  });

  it.each(host.cases)(
    "$name rejects a changed Rust caller seed",
    async (row) => {
      const callerSeed =
        (row.pull.callerSeed.startsWith("00") ? "01" : "00") +
        row.pull.callerSeed.slice(2);
      const result = await verifyPull({
        ...row,
        pull: { ...row.pull, callerSeed },
      });
      expect(result.callerSeed.matches).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.packs.every((pack) => pack.ok)).toBe(true);
    },
  );
});

describe("M4-A2 per-pack live flags", () => {
  it("verifies [4, 0] against Pull OR 4 after the first-pack Jackpot", async () => {
    const row = named("jackpot_flags_change");
    expect(row.pull.liveFlags).toBe(4);
    expect(row.packs.map((pack) => pack.liveFlags)).toEqual([4, 0]);
    expect(row.packs[0]?.tier).toBe(5);
    const result = await verifyPull(row);
    expect(result.ok).toBe(true);
    expect(result.packs.every((pack) => pack.metadataMatches)).toBe(true);
    expect(result.packs[0]?.widths.computed[2]).toBeGreaterThan(0);
    expect(result.packs[1]?.widths.computed[2]).toBe(0);
  });

  it("rejects a pack flag absent from the Pull mask even when its draw matches", async () => {
    const row = named("jackpot_flags_change");
    const result = await verifyPull({
      ...row,
      pull: { ...row.pull, liveFlags: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.packs[0]?.metadataMatches).toBe(false);
    expect(result.packs[0]?.widths.matches).toBe(true);
    expect(result.packs[0]?.tier.matches).toBe(true);
    expect(result.packs[1]?.ok).toBe(true);
  });

  it("uses Pull flags for a legacy response without per-pack flags", async () => {
    const row = named("original_ten");
    const result = await verifyPull({
      ...row,
      packs: row.packs.map((pack) => ({ ...pack, liveFlags: undefined })),
    });
    expect(result.ok).toBe(true);
  });

  it("validates Pull flags before performing the bitmask comparison", async () => {
    const row = named("original_ten");
    await expect(
      verifyPull({ ...row, pull: { ...row.pull, liveFlags: 256 } }),
    ).rejects.toThrow(RangeError);
  });

  it("preserves optional per-pack flags in the public wire schema", () => {
    const source = named("jackpot_flags_change").packs[0]!;
    const pack = {
      pack: source.pack,
      t: source.t,
      widths: source.widths,
      tier: source.tier,
      hitBucket: source.hitBucket,
      hitMint: "11111111111111111111111111111111",
      hitAmount: "0",
      hitValue: "0",
      houseMask: source.houseMask,
      dust: source.dust.map((pick) => ({
        ...pick,
        movedFrom: 0,
        mint: "11111111111111111111111111111111",
        amount: "0",
        depositor: "11111111111111111111111111111111",
        refund: "0",
      })),
    };
    expect(RevealedPack.parse(pack).liveFlags).toBeUndefined();
    expect(RevealedPack.parse({ ...pack, liveFlags: 4 }).liveFlags).toBe(4);
    expect(RevealedPack.parse({ ...pack, liveFlags: 0 }).liveFlags).toBe(0);
    expect(RevealedPack.safeParse({ ...pack, liveFlags: 256 }).success).toBe(
      false,
    );
  });
});
