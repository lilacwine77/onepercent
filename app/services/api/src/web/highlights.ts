import {
  CARD_KINDS,
  HIT_TIERS,
  PACK_EDITIONS,
  SERVICES,
} from "@onepercent/config";
import { HighlightsResponse } from "@onepercent/web-api";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { z } from "zod";

const rows = z.array(
  z.object({
    seq: z.string(),
    edition: z.number().int(),
    tier: z.number().int(),
    who: z.string(),
    hit_value: z.string(),
    sig: z.string(),
    ts: z.coerce.number().int().safe().nonnegative(),
  }),
);

export function createHighlights(
  pool: Pick<ServiceRuntime["pool"], "query">,
  now: () => Date = () => new Date(),
) {
  return async (window: "today" | "season") => {
    const date = now();
    const since =
      window === "today"
        ? new Date(
            Date.UTC(
              date.getUTCFullYear(),
              date.getUTCMonth(),
              date.getUTCDate(),
            ),
          )
        : null;
    const prices = PACK_EDITIONS.map((edition) => ({
      edition: edition.index,
      price: edition.priceLamports.toString(),
    }));
    const tiers = HIT_TIERS.map(({ id }) => CARD_KINDS.indexOf(id));
    const result = await pool.query(
      `SELECT p.seq::text, p.edition, k.tier, p.buyer AS who,
        k.hit_value::text, p.revealed_sig AS sig,
        floor(extract(epoch from t.block_time))::bigint::text AS ts
       FROM packs k JOIN pulls p ON p.seq=k.seq
       JOIN chain_txs t ON t.signature=p.revealed_sig
       JOIN jsonb_to_recordset($1::jsonb) AS prices(edition integer,price numeric) ON prices.edition=p.edition
       WHERE t.commitment IN ('confirmed','finalized') AND t.err IS NULL
         AND t.block_time IS NOT NULL AND k.tier=ANY($2::integer[])
         AND ($3::timestamptz IS NULL OR t.block_time >= $3::timestamptz)
       ORDER BY k.hit_value DESC, k.hit_value/prices.price DESC, p.seq DESC, k.pack ASC
       LIMIT $4`,
      [JSON.stringify(prices), tiers, since, SERVICES.api.sseReplayEvents],
    );
    return HighlightsResponse.parse(
      rows.parse(result.rows).map((row) => ({
        seq: row.seq,
        tier: CARD_KINDS[row.tier],
        edition: PACK_EDITIONS[row.edition]?.id,
        who: row.who,
        hitValueLamports: row.hit_value,
        sig: row.sig,
        ts: row.ts,
      })),
    );
  };
}
