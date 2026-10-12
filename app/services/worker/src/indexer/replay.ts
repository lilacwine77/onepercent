import { createHash } from "node:crypto";
import { z } from "zod";
import type { IndexerStore } from "./store.js";
import type { Reconciler } from "./engine.js";
import { MIRROR_TABLES } from "./projections.js";

/** Run with the indexer process stopped. Earlier events provide the baseline at fromSlot. */
export async function replayIndexer(options: {
  store: IndexerStore;
  reconciler: Reconciler;
  argv: readonly string[];
}) {
  const args = z
    .tuple([z.literal("--from-slot"), z.string().regex(/^\d+$/)])
    .parse(options.argv);
  const fromSlot = BigInt(args[1]);
  await options.store.replay(fromSlot);
  await options.reconciler.reconcile();
  await options.reconciler.reconcileDeck();
  const hashes: Record<string, string> = {};
  const client = await options.store.pool.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    for (const table of MIRROR_TABLES) {
      const rows = await client.query(
        `SELECT to_jsonb(t)::text AS data FROM ${table} t ORDER BY to_jsonb(t)::text`,
      );
      hashes[table] = createHash("sha256")
        .update(JSON.stringify(rows.rows))
        .digest("hex");
    }
  } finally {
    client.release();
  }
  return { fromSlot: fromSlot.toString(), hashes };
}
