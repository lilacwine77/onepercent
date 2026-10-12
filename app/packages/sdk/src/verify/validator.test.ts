import { describe, expect, it, vi } from "vitest";
import capture from "./fixtures/validator-pulls.json" with { type: "json" };
import { verifyPull } from "./index.js";
import type { VerifyPack, VerifyPullHeader } from "./index.js";

vi.mock("@onepercent/config", () => import("./fixtures/m1-config.js"));

function input(row: (typeof capture.pulls)[number]): {
  pull: VerifyPullHeader;
  packs: VerifyPack[];
  programId: string;
} {
  const event = row.events.find((event) => event.name === "PackRevealed");
  if (!event || !("pack" in event.data) || event.data.pack === undefined) {
    throw new Error("Recorded callback must contain its PackRevealed event");
  }
  const data = event.data;
  return {
    programId: capture.provenance.programId,
    pull: {
      seq: row.header.seq,
      buyer: row.header.buyer,
      edition: row.header.edition,
      qty: row.header.qty,
      liveFlags: row.header.live_flags,
      holder: row.header.holder === 1,
      randomness: row.header.randomness,
    },
    packs: [
      {
        seq: data.seq,
        pack: data.pack!,
        edition: data.edition!,
        liveFlags: data.live_flags!,
        holder: data.holder!,
        t: data.t!,
        widths: data.widths!,
        tier: data.tier!,
        hitBucket: data.hit_bucket!,
        dust: data.dust!.map((pick) => ({
          deckLenBefore: pick.deck_len_before,
          index: pick.index,
        })),
      },
    ],
  };
}

describe("100 recorded Pulls on the production v3 artifact", () => {
  it("has confirmed validator provenance and distinct real transaction pairs", () => {
    expect(capture.provenance.validator).toContain("4.3.0");
    expect(capture.provenance.pulls).toBe(100);
    expect(capture.pulls).toHaveLength(100);
    expect(new Set(capture.pulls.map((row) => row.requestSignature)).size).toBe(
      100,
    );
    expect(
      new Set(capture.pulls.map((row) => row.callbackSignature)).size,
    ).toBe(100);
    expect(new Set(capture.pulls.map((row) => row.header.edition)).size).toBe(
      4,
    );
    for (const row of capture.pulls) {
      expect(row.header.status).toBe(2);
      expect(row.callback.slot).toBeGreaterThanOrEqual(row.request.slot);
      expect(row.callback.logs).toContain(
        `Program ${capture.provenance.programId} invoke [2]`,
      );
      expect(row.callback.logs.at(-1)).toMatch(/ success$/);
      expect(row.events.map((event) => event.name)).toEqual([
        "PackRevealed",
        "PullRevealed",
      ]);
    }
  });

  it("recomputes every recorded sample, width, tier and dust pick exactly", async () => {
    for (const row of capture.pulls) {
      const args = input(row);
      const result = await verifyPull(args);
      expect(result.ok, `Pull seq ${row.header.seq}`).toBe(true);
      expect(result.complete).toBe(true);
      expect(result.packs[0]?.tier.computed).toBe(row.header.packs[0]?.tier);
      expect(result.packs[0]?.hitBucket.recorded).toBe(
        row.header.packs[0]?.carved_bucket,
      );
      expect(result.packs[0]?.hitBucket.verified).toBe(false);
    }
  });

  it("rejects a flipped randomness byte for every recorded Pull", async () => {
    for (const row of capture.pulls) {
      const args = input(row);
      const randomness = Uint8Array.from(row.header.randomness);
      randomness[0] = randomness[0]! ^ 1;
      const result = await verifyPull({
        ...args,
        pull: { ...args.pull, randomness },
      });
      expect(result.ok, `Changed Pull seq ${row.header.seq}`).toBe(false);
      expect(result.packs[0]?.t.matches).toBe(false);
    }
  });
});
