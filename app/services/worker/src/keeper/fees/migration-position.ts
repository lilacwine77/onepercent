import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { EXTERNAL_IDS } from "@onepercent/sdk/constants";
import type { JsonRpcClient } from "@onepercent/service-kit";

const integer = z.number().int().nonnegative().safe();
const instruction = z.object({
  programIdIndex: integer,
  accounts: z.array(integer),
  data: z.string(),
});
const historySchema = z.array(
  z.object({
    signature: z.string(),
    slot: integer,
    err: z.unknown().nullable(),
  }),
);
const transactionSchema = z
  .object({
    slot: integer,
    transaction: z.object({
      signatures: z.array(z.string()),
      message: z.object({
        accountKeys: z.array(z.string()),
        instructions: z.array(instruction),
      }),
    }),
    meta: z
      .object({
        err: z.unknown().nullable(),
        loadedAddresses: z
          .object({
            writable: z.array(z.string()),
            readonly: z.array(z.string()),
          })
          .optional(),
        innerInstructions: z
          .array(z.object({ instructions: z.array(instruction) }))
          .nullable()
          .optional(),
      })
      .nullable(),
  })
  .nullable();

export interface MigrationPosition {
  address: PublicKey;
  nft: PublicKey;
  mint: PublicKey;
}
/** DBC f552f20 migration initializes first_position for the 100% partner
 * allocation. Its deprecated metadata does not store the position identity.
 * Only successful finalized instructions, including CPI and v0 loaded keys,
 * establish provenance. Missing/pruned history defers collection safely. */
export async function readMigrationPosition(
  rpc: Pick<JsonRpcClient, "request">,
  pool: PublicKey,
  curve: PublicKey,
  config: PublicKey,
  signal?: AbortSignal,
): Promise<MigrationPosition> {
  let before: string | undefined;
  const cursors = new Set<string>();
  for (;;) {
    signal?.throwIfAborted();
    const history = await rpc.request(
      "getSignaturesForAddress",
      [
        pool.toBase58(),
        { commitment: "finalized", limit: 1000, ...(before ? { before } : {}) },
      ],
      historySchema,
      signal,
    );
    for (const row of history) {
      if (row.err !== null) continue;
      const tx = await rpc.request(
        "getTransaction",
        [
          row.signature,
          {
            commitment: "finalized",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          },
        ],
        transactionSchema,
        signal,
      );
      if (
        !tx ||
        tx.slot !== row.slot ||
        tx.transaction.signatures[0] !== row.signature
      )
        throw new Error("fee_migration_history_unavailable");
      if (!tx.meta || tx.meta.err !== null) continue;
      const keys = [
        ...tx.transaction.message.accountKeys,
        ...(tx.meta.loadedAddresses?.writable ?? []),
        ...(tx.meta.loadedAddresses?.readonly ?? []),
      ];
      for (const ix of [
        ...tx.transaction.message.instructions,
        ...(tx.meta.innerInstructions ?? []).flatMap(
          (item) => item.instructions,
        ),
      ]) {
        // Base58 of the pinned migration_damm_v2 discriminator, no arguments.
        if (
          keys[ix.programIdIndex] !== EXTERNAL_IDS.meteoraDbc.toBase58() ||
          ix.data !== "TCqN7bA2Pd9"
        )
          continue;
        const account = (index: number) => keys[ix.accounts[index] ?? -1];
        if (
          account(0) !== curve.toBase58() ||
          account(2) !== config.toBase58() ||
          account(4) !== pool.toBase58()
        )
          continue;
        const mint = account(5),
          nft = account(6),
          address = account(7);
        if (!mint || !nft || !address)
          throw new Error("fee_migration_position_invalid");
        return {
          mint: new PublicKey(mint),
          nft: new PublicKey(nft),
          address: new PublicKey(address),
        };
      }
    }
    if (history.length < 1000)
      throw new Error("fee_migration_history_unavailable");
    before = history.at(-1)!.signature;
    if (cursors.has(before))
      throw new Error("fee_migration_history_unavailable");
    cursors.add(before);
  }
}
