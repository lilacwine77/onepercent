import {
  EventStream,
  type ServiceRuntime,
  type StreamEvent,
} from "@onepercent/service-kit";
import { StreamEvent as PublicStreamEvent } from "@onepercent/sdk/api";
import { onepercentEventStreamName } from "@onepercent/sdk/events";
import { z } from "zod";
import type { PublicSettings } from "./settings.js";

const confirmedRow = z.object({
  slot: z.coerce.bigint(),
  tx_index: z.coerce.bigint(),
  event_index: z.coerce.bigint(),
  name: z.string(),
  signature: z.string(),
  data: z.record(z.string(), z.json()),
});
export function createPublicEvents(
  runtime: Pick<ServiceRuntime, "redis" | "pool">,
  settings: PublicSettings,
) {
  const stream = new EventStream(runtime.redis, {
    key: "onepct:events",
    maxLength: settings.api.sseReplayEvents,
  });
  return {
    replayAfter: (id?: string) => stream.replayAfter(id),
    /** One batched DB confirmation per shared poll, independent of client count. */
    async confirmed(events: readonly StreamEvent[]): Promise<StreamEvent[]> {
      if (events.length === 0) return [];
      const positions = events.map((event) => {
        const [slot, tx_index, event_index] = event.id.split("-");
        return { slot, tx_index, event_index };
      });
      const result = await runtime.pool.query(
        `SELECT e.slot,e.tx_index,e.event_index,e.name,e.signature,e.data
        FROM jsonb_to_recordset($1::jsonb) AS wanted(slot bigint,tx_index bigint,event_index bigint)
        JOIN chain_events e USING(slot,tx_index,event_index)
        JOIN chain_txs t ON t.signature=e.signature
        WHERE t.commitment IN ('confirmed','finalized') AND t.err IS NULL`,
        [JSON.stringify(positions)],
      );
      const rows = new Map(
        z
          .array(confirmedRow)
          .parse(result.rows)
          .map((row) => [
            `${row.slot}-${row.tx_index}-${row.event_index}`,
            row,
          ]),
      );
      const confirmed: StreamEvent[] = [];
      for (const event of events) {
        const row = rows.get(event.id);
        if (
          !row ||
          row.signature !== event.data.signature ||
          row.name !== event.data.name
        )
          continue;
        const category = onepercentEventStreamName(row.name, row.data);
        if (category == null || category !== event.event) continue;
        const data = { ...row.data };
        delete data._indexer;
        // Return canonical DB bytes, never trust Redis contents merely sharing an ID.
        const parsed = PublicStreamEvent.safeParse({
          id: event.id,
          event: category,
          data: {
            ...data,
            name: row.name,
            signature: row.signature,
            asOfSlot: row.slot.toString(),
          },
        });
        if (parsed.success) confirmed.push(parsed.data);
      }
      return confirmed;
    },
  };
}
