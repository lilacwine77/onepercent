import { PROGRAM_ID } from "./program-id.js";
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  configPda,
  feedMessage,
  encodeBinder,
  decodeBinder,
  advancePhaseInstruction,
} from "../src/index.js";

describe("browser byte helpers", () => {
  it("does not depend on a global Buffer polyfill", () => {
    const global = globalThis as unknown as { Buffer: unknown };
    const saved = global.Buffer;
    let result: unknown;
    try {
      global.Buffer = undefined;
      result = {
        pda: configPda(PROGRAM_ID)[0].toBase58(),
        messageLength: feedMessage({
          programId: PROGRAM_ID,
          wallet: PublicKey.default,
          bags: [{ mint: PROGRAM_ID, amount: 1n }],
          nonce: 0,
          expiry: 1n,
        }).length,
        binder: decodeBinder(
          encodeBinder({ owner: PROGRAM_ID, cap: 0, len: 0 }),
        ).owner.toBase58(),
        instruction: advancePhaseInstruction(PROGRAM_ID).data.length,
      };
    } finally {
      global.Buffer = saved;
    }
    expect(result).toEqual({
      pda: configPda(PROGRAM_ID)[0].toBase58(),
      messageLength: feedMessage({
        programId: PROGRAM_ID,
        wallet: PublicKey.default,
        bags: [{ mint: PROGRAM_ID, amount: 1n }],
        nonce: 0,
        expiry: 1n,
      }).length,
      binder: PROGRAM_ID.toBase58(),
      instruction: 8,
    });
  });
});
