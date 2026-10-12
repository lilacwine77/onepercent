import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import vectors from "./fixtures/m1-feed-attest.json" with { type: "json" };
import {
  attestationExpiry,
  bagsHash,
  feedMessage,
  feedNonces,
} from "./sdk-adapter.js";

// Copied byte-for-byte from the read-only M1 draft fixtures/vectors/attest.json.
describe("M1 Feed attestation adapter", () => {
  it.each(vectors)(
    "matches the M1 golden vector for nonce $nonce",
    (vector) => {
      const bags = vector.bags.map(({ mint, amount }) => ({
        mint: new PublicKey(mint),
        amount: BigInt(amount),
      }));
      expect(bagsHash(bags).toString("hex")).toBe(vector.bagsHash);
      const encoded = feedMessage(
        {
          programId: new PublicKey(vector.programId),
          wallet: new PublicKey(vector.wallet),
          nonce: vector.nonce,
          expiry: BigInt(vector.expiry),
          bags,
        },
        "1PCT-FEED-v1",
      );
      expect(encoded.toString("hex")).toBe(vector.message);
      expect(encoded.length).toBe(121);
    },
  );

  it("preserves bag order and encodes full u64 values without Number conversion", () => {
    const first = {
      mint: new PublicKey(vectors[0]!.bags[0]!.mint),
      amount: (1n << 64n) - 1n,
    };
    const second = {
      mint: new PublicKey(vectors[1]!.bags[1]!.mint),
      amount: 9_007_199_254_740_993n,
    };
    expect(bagsHash([first, second])).not.toEqual(bagsHash([second, first]));
    expect(bagsHash([first, second])).not.toEqual(
      bagsHash([first, { ...second, amount: second.amount - 1n }]),
    );
    expect(() => bagsHash([{ ...first, amount: 1n << 64n }])).toThrow();
    expect(() => bagsHash([{ ...first, amount: -1n }])).toThrow();
  });

  it("uses confirmed block time even with the local clock thirty seconds ahead", () => {
    const blockTime = 1_800_000_000n;
    const local = vi
      .spyOn(Date, "now")
      .mockReturnValue(Number(blockTime + 30n) * 1000);
    try {
      expect(attestationExpiry(blockTime, 120)).toBe(1_800_000_110n);
      expect(local).not.toHaveBeenCalled();
      expect(() => attestationExpiry(blockTime, 9)).toThrow();
      expect(() => attestationExpiry(blockTime, 10.5)).toThrow();
    } finally {
      local.mockRestore();
    }
  });

  it("allocates only unset nonce bits and refuses exhausted or overflowing windows", () => {
    expect(feedNonces(0, 0, 0)).toEqual([]);
    expect(feedNonces(100, 0b1011, 3)).toEqual([102, 104, 105]);
    expect(feedNonces(100, 0x7fff, 1)).toEqual([115]);
    expect(feedNonces(0xffffffff, 0, 1)).toEqual([0xffffffff]);
    expect(() => feedNonces(0xffffffff, 0, 2)).toThrow(/exhausted/);
    expect(() => feedNonces(0, 0xffff, 1)).toThrow(/exhausted/);
    expect(() => feedNonces(-1, 0, 1)).toThrow();
    expect(() => feedNonces(0, 0x10000, 1)).toThrow();
    expect(() => feedNonces(0, 0, 17)).toThrow();
  });
});
