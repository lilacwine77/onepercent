import {
  attestationLog,
  attestationBagsSchema,
  type Database,
} from "@onepercent/db";
import { z } from "zod";
import type { ServiceRuntime } from "@onepercent/service-kit";
import type { FeedLogRow } from "./service.js";
import { ipHashSchema, publicKeySchema } from "./schema.js";

const rowSchema = z
  .object({
    messageSha256: ipHashSchema,
    wallet: publicKeySchema,
    nonce: z.number().int().min(0).max(0xffffffff),
    expiry: z.number().int().safe().nonnegative(),
    bags: attestationBagsSchema.min(1),
    signer: publicKeySchema,
    ipHash: ipHashSchema,
  })
  .strict();
export function createFeedLogWriter(db: Database) {
  return async (rows: FeedLogRow[]): Promise<void> => {
    const values = z.array(rowSchema).min(1).parse(rows);
    await db.transaction(async (transaction) => {
      // Identical messages are immutable audit records; retries cannot consume eligibility.
      await transaction
        .insert(attestationLog)
        .values(
          values.map((row) => ({
            ...row,
            kind: "FEED" as const,
            nonce: BigInt(row.nonce),
            expiry: new Date(row.expiry * 1000),
          })),
        )
        .onConflictDoNothing({ target: attestationLog.messageSha256 });
    });
  };
}
const consumptionSchema = z.array(
  z.object({
    holder: publicKeySchema,
    mint: publicKeySchema,
    used_by: publicKeySchema,
    date: z.coerce.date().nullable(),
  }),
);
/** Reads only the indexer's mirrors, never signer logs. */
export function createIntakeLiveReader(
  pool: Pick<ServiceRuntime["pool"], "query">,
) {
  return async (wallet: string, mint: string, holders: string[]) => {
    const consumption = await pool.query(
      "SELECT c.holder, c.mint, c.used_by, t.block_time AS date FROM intake_consumption c LEFT JOIN chain_txs t ON t.signature=c.first_feed_sig WHERE c.mint=$1 AND c.holder=ANY($2::text[])",
      [mint, holders],
    );
    const live = await pool.query(
      "SELECT t.block_time AS date FROM deck_entries d LEFT JOIN chain_txs t ON t.slot=d.slot AND t.tx_index=d.tx_index WHERE d.depositor=$1 AND d.mint=$2 AND (d.flags & 1)<>0 LIMIT 1",
      [wallet, mint],
    );
    const liveRows = z
      .array(z.object({ date: z.coerce.date().nullable() }))
      .max(1)
      .parse(live.rows);
    return {
      consumption: consumptionSchema.parse(consumption.rows).map((r) => ({
        holder: r.holder,
        mint: r.mint,
        usedBy: r.used_by,
        date: r.date?.toISOString() ?? null,
      })),
      liveCard: liveRows.length
        ? { date: liveRows[0]!.date?.toISOString() ?? null }
        : null,
    };
  };
}

/** S1 supplies its completed polling boundary, including quiet slots. A cursor
 * pointing only to the last program transaction does not establish freshness. */
export function createIndexerTimeReader(options: {
  rpc: Pick<ServiceRuntime["rpc"], "request">;
  readIndexedSlot(): Promise<number>;
}) {
  return async () => {
    const slot = z
      .number()
      .int()
      .nonnegative()
      .safe()
      .parse(await options.readIndexedSlot());
    return options.rpc.request(
      "getBlockTime",
      [slot],
      z.number().int().nonnegative().safe(),
    );
  };
}
