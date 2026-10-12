import { Ed25519Program, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ATTESTATIONS } from "@onepercent/config";
import {
  attestationExpiry,
  bagsHash,
  callerSeed,
  ed25519Instruction,
  feedMessage,
  holdMessage,
  sellBackMessage,
} from "../src/attest.js";
import { vectors } from "./vectors.js";
interface WalletSample {
  kind: "feed" | "hold";
  programId: string;
  wallet: string;
  nonce?: number;
  expiry: string;
  bags?: { mint: string; amount: string }[];
  message: string;
  bagsHash?: string;
}
interface SellBackSample {
  kind: "sell_back";
  programId: string;
  owner: string;
  mint: string;
  cards: { index: number; amount: string }[];
  totalAmount: string;
  quoteLamports: string;
  expiry: string;
  nonce: number;
  message: string;
  sha256: string;
}
type Sample = WalletSample | SellBackSample;
describe("attestations", () => {
  it("is byte-exact with Rust FEED, HOLD and SB messages", () => {
    const samples = vectors<Sample[]>("attest");
    expect(
      samples.filter((v) => v.kind === "feed").length,
    ).toBeGreaterThanOrEqual(20);
    expect(
      samples.filter((v) => v.kind === "hold").length,
    ).toBeGreaterThanOrEqual(20);
    expect(
      samples.filter((v) => v.kind === "sell_back").length,
    ).toBeGreaterThanOrEqual(20);
    for (const v of samples) {
      if (v.kind === "sell_back") {
        const message = sellBackMessage({
          programId: new PublicKey(v.programId),
          owner: new PublicKey(v.owner),
          mint: new PublicKey(v.mint),
          cards: v.cards.map((card) => ({
            index: card.index,
            amount: BigInt(card.amount),
          })),
          totalAmount: BigInt(v.totalAmount),
          quoteLamports: BigInt(v.quoteLamports),
          expiry: BigInt(v.expiry),
          nonce: v.nonce,
        });
        expect(message.toString("hex")).toBe(v.message);
        expect(message.length).toBe(135 + 10 * v.cards.length);
        expect(createHash("sha256").update(message).digest("hex")).toBe(
          v.sha256,
        );
        continue;
      }
      const input = {
        programId: new PublicKey(v.programId),
        wallet: new PublicKey(v.wallet),
        expiry: BigInt(v.expiry),
      };
      const bags = (v.bags ?? []).map((b) => ({
        mint: new PublicKey(b.mint),
        amount: BigInt(b.amount),
      }));
      const message =
        v.kind === "feed"
          ? feedMessage({ ...input, bags, nonce: v.nonce ?? 0 })
          : holdMessage(input);
      expect(message.toString("hex")).toBe(v.message);
      if (v.bagsHash) expect(bagsHash(bags).toString("hex")).toBe(v.bagsHash);
    }
  });
  it("matches independently published hash sanity examples", () => {
    expect(
      bagsHash([
        { mint: new PublicKey(new Uint8Array(32).fill(2)), amount: 1000n },
      ]).toString("hex"),
    ).toBe("7a380214e4ff5226d75c80fd9125c5cc6906632a09683438e381e6b1af096af7");
    expect(
      callerSeed(
        PublicKey.default,
        1n,
        new PublicKey(new Uint8Array(32).fill(1)),
      ).toString("hex"),
    ).toBe("293bd9158352a1106604a846a4b37cea22303eb6c4b1bcdab7b287d7500dcd1a");
  });
  it("constructs the runtime Ed25519 layout byte for byte", () => {
    const publicKey = new PublicKey(new Uint8Array(32).fill(5));
    const signature = new Uint8Array(64).fill(3);
    const message = Buffer.from("binary\u0000attestation");
    const ix = ed25519Instruction({ publicKey, signature, message });
    expect(ix.programId.equals(Ed25519Program.programId)).toBe(true);
    expect(ix.data).toEqual(
      Ed25519Program.createInstructionWithPublicKey({
        publicKey: publicKey.toBytes(),
        signature,
        message,
      }).data,
    );
    expect(ix.data.subarray(0, 16)).toEqual(
      Buffer.from([
        1,
        0,
        48,
        0,
        255,
        255,
        16,
        0,
        255,
        255,
        112,
        0,
        message.length,
        0,
        255,
        255,
      ]),
    );
  });
  it("takes cluster time even when local time is 30 seconds ahead", () => {
    const blockTime = 1700000000n;
    vi.useFakeTimers();
    vi.setSystemTime(Number(blockTime + 30n) * 1000);
    try {
      expect(attestationExpiry(blockTime, ATTESTATIONS.feedTtlSeconds)).toBe(
        blockTime + BigInt(ATTESTATIONS.feedTtlSeconds) - 10n,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
