import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  decodeInstructionData,
  feedMessageHash,
  resolveConsumption,
} from "./consumption.js";
import type { IndexedEvent, IndexedTransaction, SqlExecutor } from "./store.js";

export function encodeInstructionData(bytes: Buffer): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let result = "";
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}
export const feedEvent: IndexedEvent = {
  name: "BagFed",
  ixIndex: 1n,
  eventIndex: 0n,
  data: {
    depositor: "wallet",
    mint: "mint",
    amount: "12",
    deck_index: 0,
    deposit: "10",
    fresh_in_deck: 1,
  },
};
export function feedTransaction(): IndexedTransaction {
  const message = Buffer.from("signed-feed-message");
  const ed = Buffer.alloc(16 + 64 + 32 + message.length);
  ed[0] = 1;
  ed.writeUInt16LE(16, 2);
  ed.writeUInt16LE(65535, 4);
  ed.writeUInt16LE(80, 6);
  ed.writeUInt16LE(65535, 8);
  ed.writeUInt16LE(112, 10);
  ed.writeUInt16LE(message.length, 12);
  ed.writeUInt16LE(65535, 14);
  message.copy(ed, 112);
  const feed = Buffer.alloc(33);
  Buffer.from([46, 213, 237, 176, 190, 113, 182, 94]).copy(feed);
  feed.writeUInt32LE(1, 8);
  feed.writeBigUInt64LE(12n, 12);
  feed[32] = 0;
  return {
    signature: "tx",
    slot: 1n,
    txIndex: 0n,
    blockTime: 1,
    err: null,
    truncated: false,
    accountKeys: [],
    events: [structuredClone(feedEvent)],
    instructions: [
      {
        programId: "Ed25519SigVerify111111111111111111111111111",
        data: encodeInstructionData(ed),
        accounts: [],
      },
      { programId: "program", data: encodeInstructionData(feed), accounts: [] },
    ],
  };
}
const sql = (rows: Record<string, unknown>[]): SqlExecutor => ({
  query: vi.fn().mockResolvedValue({ rows }),
});

describe("landed Feed provenance", () => {
  it("reads the exact att_ix message and preserves leading base58 zero bytes", () => {
    const tx = feedTransaction();
    expect(feedMessageHash(tx, feedEvent, "program")).toBe(
      createHash("sha256").update("signed-feed-message").digest("hex"),
    );
    expect(
      decodeInstructionData(encodeInstructionData(Buffer.from([0, 0, 1, 255]))),
    ).toEqual(Buffer.from([0, 0, 1, 255]));
  });
  it("does not join another instruction or a cross-instruction offset", () => {
    const tx = feedTransaction();
    tx.instructions[1]!.programId = "foreign";
    expect(feedMessageHash(tx, feedEvent, "program")).toBeNull();
    tx.instructions[1]!.programId = "program";
    const bytes = decodeInstructionData(tx.instructions[0]!.data);
    bytes.writeUInt16LE(1, 14);
    tx.instructions[0]!.data = encodeInstructionData(bytes);
    expect(feedMessageHash(tx, feedEvent, "program")).toBeNull();
  });
  it("joins the signed bag amount and depositor to one-hop evidence", async () => {
    const result = await resolveConsumption(
      sql([
        {
          wallet: "wallet",
          bags: [{ mint: "mint", amount: "12", path: "hop", via: "original" }],
        },
      ]),
      feedTransaction(),
      feedEvent,
      { programId: "program" },
    );
    expect(result).toMatchObject({
      missing: false,
      provenance: { holder: "original", path: "hop" },
    });
  });
  it("falls back on an absent or mismatched signer row, never borrowing another bag", async () => {
    const recomputeProvenance = vi
      .fn()
      .mockResolvedValue({ path: "self", via: null });
    const result = await resolveConsumption(
      sql([
        {
          wallet: "other",
          bags: [{ mint: "mint", amount: "12", path: "hop", via: "other" }],
        },
      ]),
      feedTransaction(),
      feedEvent,
      { programId: "program", recomputeProvenance },
    );
    expect(recomputeProvenance).toHaveBeenCalledWith({
      depositor: "wallet",
      mint: "mint",
      amount: "12",
      slot: 1n,
      signature: "tx",
    });
    expect(result).toMatchObject({
      missing: true,
      provenance: { holder: "wallet", path: "self" },
    });
  });
  it("records unknown when S2 evidence is unavailable", async () => {
    const result = await resolveConsumption(
      sql([]),
      feedTransaction(),
      feedEvent,
      {
        programId: "program",
        recomputeProvenance: async () => {
          throw new Error("unavailable");
        },
      },
    );
    expect(result).toMatchObject({
      missing: true,
      provenance: { holder: "wallet", path: "unknown" },
    });
  });
});
