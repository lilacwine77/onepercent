import { EventStream } from "@onepercent/service-kit";
import { onepercentEventStreamName } from "@onepercent/sdk/events";
import { jsonObjectSchema } from "@onepercent/db";
import { z } from "zod";
import type { SqlExecutor } from "./store.js";
import { BLOCK0_READY_EVENT } from "./season/block0.js";

const rowSchema = z.object({
  signature: z.string(),
  slot: z.coerce.bigint(),
  tx_index: z.coerce.bigint(),
  ix_index: z.coerce.bigint(),
  event_index: z.coerce.bigint(),
  name: z.string(),
  data: jsonObjectSchema,
});

/** The existing cursors table is the durable outbox checkpoint; no schema change. */
export class EventPublisher {
  constructor(
    private readonly pool: SqlExecutor,
    private readonly stream: Pick<EventStream, "publish">,
    private readonly pageSize: number,
    private readonly recovery: {
      clear(): Promise<void>;
      exists(): Promise<boolean>;
    },
  ) {}
  async flush() {
    const reset = await this.pool.query(
      "SELECT name FROM cursors WHERE name='indexer:stream-reset'",
    );
    const rebuilding = reset.rows.length > 0 || !(await this.recovery.exists());
    if (rebuilding) {
      // The marker survives partial publication, DB failures and Redis data loss.
      await this.pool.query(
        "INSERT INTO cursors(name,last_slot) VALUES('indexer:stream-reset',0) ON CONFLICT(name) DO NOTHING",
      );
      await this.recovery.clear();
      await this.pool.query(
        "DELETE FROM cursors WHERE name='indexer:published'",
      );
      // Seed from the predecessor of the bounded replay window. The normal
      // ascending outbox loop then publishes only its latest retained events.
      const predecessor = await this.pool.query(
        `SELECT e.slot,e.tx_index,e.ix_index,e.event_index FROM chain_events e JOIN chain_txs t USING(signature)
         WHERE t.err IS NULL AND NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:'||e.signature)
         ORDER BY e.slot DESC,e.tx_index DESC,e.ix_index DESC,e.event_index DESC OFFSET $1 LIMIT 1`,
        [this.pageSize],
      );
      const before = predecessor.rows[0];
      if (before)
        await this.pool.query(
          `INSERT INTO cursors(name,last_signature,last_slot) VALUES('indexer:published',$1,$2)
         ON CONFLICT(name) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot`,
          [
            [
              before.slot,
              before.tx_index,
              before.ix_index,
              before.event_index,
            ].join(":"),
            String(before.slot),
          ],
        );
    }
    for (;;) {
      // last_signature stores the complete four-part order key for this named cursor.
      const cursor = await this.pool.query(
        "SELECT last_signature FROM cursors WHERE name = 'indexer:published'",
      );
      const key = cursor.rows[0]?.last_signature;
      const after =
        typeof key === "string"
          ? key.split(":").map((x) => BigInt(x))
          : [-1n, -1n, -1n, -1n];
      if (after.length !== 4) throw new Error("invalid_publish_cursor");
      const result = await this.pool.query(
        `SELECT e.* FROM chain_events e JOIN chain_txs t USING(signature)
         WHERE t.err IS NULL AND NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:'||e.signature) AND (e.slot,e.tx_index,e.ix_index,e.event_index) > ($1,$2,$3,$4)
         ORDER BY e.slot,e.tx_index,e.ix_index,e.event_index LIMIT $5`,
        [...after.map(String), this.pageSize],
      );
      for (const raw of result.rows) {
        const row = rowSchema.parse(raw);
        const event =
          row.name === BLOCK0_READY_EVENT
            ? "block0"
            : onepercentEventStreamName(row.name, row.data);
        if (event) {
          const data = { ...row.data };
          delete data._indexer;
          await this.stream.publish({
            id: `${row.slot}-${row.tx_index}-${row.event_index}`,
            event,
            data: {
              ...data,
              name: row.name,
              signature: row.signature,
              asOfSlot: row.slot.toString(),
            },
          });
        }
        // If Redis accepted XADD but this write failed, EventStream tolerates the retry.
        await this.pool.query(
          `INSERT INTO cursors(name,last_signature,last_slot) VALUES('indexer:published',$1,$2)
          ON CONFLICT(name) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot`,
          [
            [row.slot, row.tx_index, row.ix_index, row.event_index].join(":"),
            row.slot.toString(),
          ],
        );
      }
      if (result.rows.length < this.pageSize) {
        if (rebuilding)
          await this.pool.query(
            "DELETE FROM cursors WHERE name='indexer:stream-reset'",
          );
        return;
      }
    }
  }
}
