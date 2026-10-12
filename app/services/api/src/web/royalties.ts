import type { ServiceRuntime } from "@onepercent/service-kit";
import { RoyaltiesResponse, U64String } from "@onepercent/web-api";
import { z } from "zod";

// Page complete Pull sequences: a seq cursor must never omit sibling cards.
export const ROYALTIES_PAGE_SEQUENCES = 25;
const editionIds = [
  "original",
  "blue_shift",
  "signature",
  "after_hours",
] as const;
const rowSchema = z.object({
  seq: U64String,
  pack: z.number().int().nonnegative(),
  lamports: U64String,
  refund: U64String,
  paid: U64String,
  edition: z
    .number()
    .int()
    .min(0)
    .max(editionIds.length - 1),
  mint: z.string(),
  sig: z.string(),
  ts: z.number().int().nonnegative().safe(),
  redirected: z.boolean(),
});

export class WebRoyalties {
  constructor(private readonly pool?: ServiceRuntime["pool"]) {}

  async get(wallet: string, before?: bigint) {
    if (!this.pool) throw new Error("Royalties unavailable");
    const result = await this.pool.query(
      `WITH page AS (
        SELECT DISTINCT r.seq
        FROM royalties r
        JOIN chain_txs t ON t.signature = r.settle_sig
          AND t.err IS NULL AND t.commitment IN ('confirmed', 'finalized')
        WHERE r.depositor = $1 AND ($2::numeric IS NULL OR r.seq < $2::numeric)
        ORDER BY r.seq DESC LIMIT $3
      )
      SELECT r.seq::text, r.pack, r.amount::text AS lamports,
        r.refund::text, r.paid::text, p.edition, d.mint,
        r.settle_sig AS sig,
        EXTRACT(EPOCH FROM t.block_time)::double precision AS ts, r.redirected
      FROM page
      JOIN royalties r ON r.seq = page.seq AND r.depositor = $1
      JOIN pulls p ON p.seq = r.seq
      LEFT JOIN dust_picks d ON d.seq = r.seq AND d.pack = r.pack AND d.k = r.k
      JOIN chain_txs t ON t.signature = r.settle_sig
        AND t.err IS NULL AND t.commitment IN ('confirmed', 'finalized')
      ORDER BY r.seq DESC, r.pack DESC, r.k DESC`,
      [wallet, before?.toString() ?? null, ROYALTIES_PAGE_SEQUENCES],
    );
    const rows = z.array(rowSchema).parse(result.rows);
    // A partial transfer combines royalty and deposit without an allocation order.
    // The current wire contract cannot represent an unknown royalty amount.
    if (
      rows.some(
        (row) => !row.redirected && row.paid < row.lamports + row.refund,
      )
    )
      throw new Error("Royalty allocation unavailable");
    const body = rows.map((row) => ({
      seq: row.seq.toString(),
      pack: row.pack,
      lamports: row.lamports.toString(),
      edition: editionIds[row.edition],
      mint: row.mint,
      sig: row.sig,
      ts: row.ts,
      redirected: row.redirected,
    }));
    return RoyaltiesResponse.parse(body);
  }
}
