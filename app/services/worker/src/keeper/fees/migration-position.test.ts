import { readFileSync } from "node:fs";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { EXTERNAL_IDS } from "@onepercent/sdk/constants";
import capture from "../../../../../fixtures/meteora/migration-history.json" with { type: "json" };
import { readMigrationPosition } from "./migration-position.js";

const pinned = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../packages/sdk/src/meteora/dbc.idl.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  instructions: {
    name: string;
    discriminator: number[];
    accounts: { name: string }[];
  }[];
};
describe("DBC migration provenance from a real local validator transaction", () => {
  it("matches the pinned IDL discriminator and account indexes to the actual pool history", async () => {
    const migration = pinned.instructions.find(
      (ix) => ix.name === "migration_damm_v2",
    )!;
    const data = new Transaction({
      feePayer: PublicKey.default,
      recentBlockhash: PublicKey.default.toBase58(),
    })
      .add(
        new TransactionInstruction({
          programId: EXTERNAL_IDS.meteoraDbc,
          keys: [],
          data: Buffer.from(migration.discriminator),
        }),
      )
      .compileMessage().instructions[0]!.data;
    expect(data).toBe("TCqN7bA2Pd9");
    expect(
      [0, 2, 4, 5, 6, 7].map((index) => migration.accounts[index]!.name),
    ).toEqual([
      "virtual_pool",
      "config",
      "pool",
      "first_position_nft_mint",
      "first_position_nft_account",
      "first_position",
    ]);
    const keys = capture.tx.transaction.message.accountKeys;
    const actual = capture.tx.transaction.message.instructions.find(
      (ix) =>
        keys[ix.programIdIndex] === EXTERNAL_IDS.meteoraDbc.toBase58() &&
        ix.data === data,
    )!;
    expect(actual).toBeDefined();
    expect(actual.accounts.slice(0, 8).map((index) => keys[index])).toEqual([
      capture.curve,
      expect.any(String),
      capture.config,
      expect.any(String),
      capture.pool,
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    const request = vi.fn(
      async (method: string, params: unknown[], schema: z.ZodType) => {
        if (method === "getSignaturesForAddress") {
          expect(params).toEqual([
            capture.pool,
            { commitment: "finalized", limit: 1000 },
          ]);
          return schema.parse([capture.row]);
        }
        expect(method).toBe("getTransaction");
        expect(params).toEqual([
          capture.row.signature,
          {
            commitment: "finalized",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        return schema.parse(capture.tx);
      },
    );
    const result = await readMigrationPosition(
      { request } as unknown as JsonRpcClient,
      new PublicKey(capture.pool),
      new PublicKey(capture.curve),
      new PublicKey(capture.config),
    );
    expect(result.mint.toBase58()).toBe(keys[actual.accounts[5]!]);
    expect(result.nft.toBase58()).toBe(keys[actual.accounts[6]!]);
    expect(result.address.toBase58()).toBe(keys[actual.accounts[7]!]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
