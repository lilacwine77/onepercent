import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import drawVectors from "./fixtures/m1-rust-draw.json" with { type: "json" };
import dustVectors from "./fixtures/m1-rust-dust.json" with { type: "json" };
import provenance from "./fixtures/provenance.json" with { type: "json" };
import * as fixtureConfig from "./fixtures/m1-config.js";
import { verifyPull } from "./index.js";
import type { VerifyPack, VerifyPullHeader } from "./index.js";
import {
  bytes32,
  callerSeed,
  drawTier,
  dustIndex,
  readDrawConfig,
  VerifyUnavailableError,
} from "./math.js";

vi.mock("@onepercent/config", () => import("./fixtures/m1-config.js"));

const params = readDrawConfig(fixtureConfig);
const programId = "11111111111111111111111111111111";
const buyer = "So11111111111111111111111111111111111111112";
const golden = drawVectors[0]!;
const pull: VerifyPullHeader = {
  seq: golden.input.seq,
  buyer,
  edition: golden.input.edition,
  qty: 1,
  liveFlags: golden.input.live,
  holder: golden.input.holder,
  randomness: golden.input.randomness,
};
const pack: VerifyPack = {
  pack: golden.input.pack,
  ...golden.output,
  hitBucket: 2,
  dust: dustVectors.slice(0, 4).map((vector) => ({
    deckLenBefore: vector.input.len,
    index: vector.output,
  })),
};

describe("M1 Rust host vectors (not recorded validator Pulls)", () => {
  it("uses the same economics and domains as the final M1 config", async () => {
    const finalConfig =
      await vi.importActual<typeof import("@onepercent/config")>(
        "@onepercent/config",
      );
    expect(readDrawConfig(finalConfig)).toEqual(params);
  });
  it("records accurate provenance and at least 100 draw vectors", () => {
    expect(drawVectors.length).toBeGreaterThanOrEqual(100);
    expect(provenance.validatorPulls).toBe(0);
    expect(provenance.drawVectors).toBe(drawVectors.length);
    expect(provenance.dustVectors).toBe(dustVectors.length);
  });

  it("matches every exact Rust tier/width/sample vector", async () => {
    for (const vector of drawVectors) {
      const input = vector.input;
      expect(
        await drawTier(
          params,
          input.randomness,
          input.seq,
          input.pack,
          input.edition,
          input.live,
          input.holder,
        ),
      ).toEqual(vector.output);
    }
  });

  it("matches every exact Rust multiply-high dust vector", async () => {
    for (const { input, output } of dustVectors) {
      expect(
        await dustIndex(
          params,
          input.randomness,
          input.seq,
          input.pack,
          input.k,
          input.len,
        ),
      ).toBe(output);
    }
  });

  it("matches the independently concatenated caller seed", async () => {
    const seq = Buffer.alloc(8);
    seq.writeBigUInt64LE(BigInt(pull.seq));
    const expected = createHash("sha256")
      .update(fixtureConfig.DRAW_TAGS.vrfSeed)
      .update(new PublicKey(programId).toBytes())
      .update(seq)
      .update(new PublicKey(buyer).toBytes())
      .digest("hex");
    expect(await callerSeed(params, programId, pull.seq, buyer)).toBe(expected);
  });

  it("never supplies missing economics from local defaults", () => {
    expect(() => readDrawConfig({})).toThrow(VerifyUnavailableError);
    expect(() => readDrawConfig({ ...fixtureConfig, HIT_ODDS: null })).toThrow(
      VerifyUnavailableError,
    );
    expect(() =>
      readDrawConfig({ ...fixtureConfig, PPB_DENOMINATOR: Number.NaN }),
    ).toThrow(VerifyUnavailableError);
  });
});

describe("verifyPull", () => {
  it("M4-A2 verifies each pack with its own live flags after a special win", async () => {
    const header = { ...pull, qty: 2, liveFlags: 5 };
    const packs = await Promise.all(
      [5, 1].map(async (liveFlags, packIndex) => ({
        pack: packIndex,
        liveFlags,
        ...(await drawTier(
          params,
          header.randomness,
          header.seq,
          packIndex,
          header.edition,
          liveFlags,
          header.holder,
        )),
        hitBucket: 255,
        dust: await Promise.all(
          Array.from({ length: 4 }, async (_, slot) => ({
            deckLenBefore: 1000,
            index: await dustIndex(
              params,
              header.randomness,
              header.seq,
              packIndex,
              slot,
              1000,
            ),
          })),
        ),
      })),
    );
    expect((await verifyPull({ pull: header, packs, programId })).ok).toBe(
      true,
    );
    const wrong = packs.map((item) => ({
      ...item,
      liveFlags: header.liveFlags,
    }));
    expect(
      (await verifyPull({ pull: header, packs: wrong, programId })).packs[1]
        ?.widths.matches,
    ).toBe(false);
  });

  it("returns exact checks, and identifies the bucket as recorded", async () => {
    const result = await verifyPull({ pull, packs: [pack], programId });
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.callerSeed.matches).toBe(null);
    expect(result.packs[0]?.hitBucket).toEqual({
      recorded: 2,
      verified: false,
    });
    expect(result.packs[0]?.dust.every((pick) => pick.matches)).toBe(true);
  });

  it("fails when one randomness byte is flipped", async () => {
    const randomness = bytes32(pull.randomness);
    randomness[0] = randomness[0]! ^ 1;
    const result = await verifyPull({
      pull: { ...pull, randomness },
      packs: [pack],
      programId,
    });
    expect(result.ok).toBe(false);
    expect(result.packs[0]?.t.matches).toBe(false);
  });

  it.each([
    ["sample", { t: pack.t + 1 }],
    ["widths", { widths: [1, ...pack.widths.slice(1)] }],
    ["tier", { tier: pack.tier + 1 }],
    ["sequence", { seq: "2" }],
    ["edition", { edition: pull.edition + 1 }],
    ["live flags", { liveFlags: pull.liveFlags + 1 }],
    ["holder", { holder: !pull.holder }],
    ["dust count", { dust: pack.dust.slice(1) }],
    [
      "dust index",
      { dust: [{ ...pack.dust[0]!, index: 0 }, ...pack.dust.slice(1)] },
    ],
  ])("rejects changed %s", async (_name, changed) => {
    expect(
      (await verifyPull({ pull, packs: [{ ...pack, ...changed }], programId }))
        .ok,
    ).toBe(false);
  });

  it("rejects missing and duplicate packs even when their samples match", async () => {
    expect((await verifyPull({ pull, packs: [], programId })).ok).toBe(false);
    const result = await verifyPull({
      pull: { ...pull, qty: 2 },
      packs: [pack, pack],
      programId,
    });
    expect(result.complete).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("checks an available caller seed and keeps unavailable distinct", async () => {
    const callerSeed = (await verifyPull({ pull, packs: [pack], programId }))
      .callerSeed.computed;
    expect(
      (
        await verifyPull({
          pull: { ...pull, callerSeed },
          packs: [pack],
          programId,
        })
      ).callerSeed.matches,
    ).toBe(true);
    expect(
      (
        await verifyPull({
          pull: { ...pull, callerSeed: new Uint8Array(32) },
          packs: [pack],
          programId,
        })
      ).ok,
    ).toBe(false);
  });

  it("handles empty Deck picks as the M1 zero-valued House records", async () => {
    const result = await verifyPull({
      pull,
      packs: [
        {
          ...pack,
          dust: pack.dust.map(() => ({ deckLenBefore: 0, index: 0 })),
        },
      ],
      programId,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects truncated bytes, invalid integers and invalid addresses", async () => {
    for (const changed of [
      { randomness: new Uint8Array(31) },
      { randomness: Array(32).fill(256) },
      { seq: "18446744073709551616" },
      { seq: "-1" },
      { buyer: "not-a-public-address" },
      { qty: 0 },
    ]) {
      await expect(
        verifyPull({ pull: { ...pull, ...changed }, packs: [pack], programId }),
      ).rejects.toThrow();
    }
  });
});
