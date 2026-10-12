import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { ATTESTATIONS } from "@onepercent/config";
import {
  binderPda,
  configPda,
  encodeConfig,
  fetchConfig,
  buildBuyPacksTransaction,
  feedMessage,
  holdMessage,
  sellBackMessage,
  parseOnepercentLogs,
} from "../src/index.js";
import { PROGRAM_ID } from "./program-id.js";

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const programs = [PROGRAM_ID, key(100), key(101)];

// Prune generated and dependency trees before traversal on shared machines.
const excludedDirectories = new Set([
  "node_modules",
  "dist",
  ".next",
  "tests",
  "fixtures",
  "__fixtures__",
]);
function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) yield* sourceFiles(file);
    } else if (entry.isFile() && /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      yield file;
    }
  }
}

describe("caller-selected program deployment", () => {
  it("keeps interleaved transaction builders and attestation domains isolated", () => {
    const wallet = key(1);
    const builds = [...programs, programs[0]!].map((programId) => {
      const tx = buildBuyPacksTransaction(programId, {
        wallet,
        blockhash: key(2).toBase58(),
        edition: 0,
        qty: 1,
        pullNonce: 0,
        oracleQueue: key(3),
        computeBudget: false,
        hold: { expiry: 100n, signature: new Uint8Array(64), signer: key(4) },
      }) as Transaction;
      const buy = tx.instructions.at(-1)!;
      expect(buy.programId.equals(programId)).toBe(true);
      expect(buy.keys[1]!.pubkey.equals(configPda(programId)[0])).toBe(true);
      expect(buy.keys[4]!.pubkey.equals(binderPda(programId, wallet)[0])).toBe(
        true,
      );
      const messages = [
        [
          feedMessage({ programId, wallet, nonce: 0, expiry: 100n, bags: [] }),
          ATTESTATIONS.feedDomain,
        ],
        [
          holdMessage({ programId, wallet, expiry: 100n }),
          ATTESTATIONS.holdDomain,
        ],
        [
          sellBackMessage({
            programId,
            owner: wallet,
            mint: key(5),
            cards: [{ index: 0, amount: 1n }],
            totalAmount: 1n,
            quoteLamports: 1n,
            expiry: 100n,
            nonce: 0,
          }),
          ATTESTATIONS.sellBackDomain,
        ],
      ] as const;
      for (const [message, domain] of messages)
        expect(message.subarray(domain.length, domain.length + 32)).toEqual(
          programId.toBuffer(),
        );
      const hold = messages[1][0];
      expect(tx.instructions[0]!.data.subarray(-hold.length)).toEqual(hold);
      return buy.keys[1]!.pubkey.toBase58();
    });
    expect(new Set(builds.slice(0, 3)).size).toBe(3);
    expect(builds[3]).toBe(builds[0]);
  });

  it("fetches the selected PDA and rejects an account owned by another deployment", async () => {
    const selected = programs[1]!;
    const getAccountInfo = vi.fn().mockResolvedValue({
      owner: selected,
      executable: false,
      data: encodeConfig({}),
    });
    const rpc = { getAccountInfo } as unknown as Connection;
    await expect(fetchConfig(selected, rpc)).resolves.not.toBeNull();
    expect(getAccountInfo).toHaveBeenCalledWith(
      configPda(selected)[0],
      "confirmed",
    );
    getAccountInfo.mockResolvedValue({
      owner: PROGRAM_ID,
      executable: false,
      data: encodeConfig({}),
    });
    await expect(fetchConfig(selected, rpc)).rejects.toThrow(
      "Unexpected program account owner",
    );
  });

  it("only accepts event invocation frames for the selected program", () => {
    const logs = [
      `Program ${programs[1]!} invoke [1]`,
      "Program data: AAAAAAAA",
      `Program ${programs[1]!} success`,
    ];
    expect(
      parseOnepercentLogs({ logs, err: null, programId: PROGRAM_ID.toBase58() })
        .unknownEvent,
    ).toBe(false);
    expect(
      parseOnepercentLogs({
        logs,
        err: null,
        programId: programs[1]!.toBase58(),
      }).unknownEvent,
    ).toBe(true);
  });

  it("does not read an IDL address in SDK runtime code or application callers", () => {
    const app = fileURLToPath(new URL("../../../", import.meta.url));
    for (const directory of [
      "packages/sdk/src",
      "services",
      "apps",
      "packages/cli/src",
    ]) {
      for (const file of sourceFiles(resolve(app, directory))) {
        const name = relative(app, file);
        if (
          /\.(?:test|spec)\./.test(name) ||
          /capture-validator\.mjs$/.test(name)
        )
          continue;
        expect(readFileSync(file, "utf8"), name).not.toMatch(
          /\b(?:idl|IDL|m1|M1_EVENT_IDL)\s*(?:\.address|\[\s*["']address["']\s*\])/,
        );
      }
    }
  });
});
