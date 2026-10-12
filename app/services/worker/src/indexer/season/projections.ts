import { u64StringSchema } from "@onepercent/db";
import type {
  IndexedEvent,
  IndexedTransaction,
  SqlExecutor,
} from "../store.js";

export const SEASON_EVENT_MIRRORS = ["creator_fee_collections"] as const;
// These contain finalized external DBC history, which Onepercent logs cannot
// reproduce. Keep it during offline replay; the launch FK removes orphaned rows.
export const SEASON_RETAINED_MIRRORS = [
  "season_launches",
  "block0_buys",
] as const;
const amount = (value: unknown) => u64StringSchema.parse(String(value));

export async function projectSeasonEvent(
  sql: SqlExecutor,
  tx: IndexedTransaction,
  event: IndexedEvent,
): Promise<void> {
  const d = event.data;
  if (event.name === "PoweredOn") {
    await sql.query(
      "INSERT INTO season_launches(signature,slot,mint,launch_pool,dev_buy_tokens,as_of_slot) VALUES($1,$2,$3,$4,$5,$2) ON CONFLICT(signature) DO NOTHING",
      [tx.signature, String(tx.slot), d.mint, d.launch_pool, amount(d.dev_buy)],
    );
  }
  if (event.name === "CreatorFeesCollected") {
    const regime = ["belowFloor", "season", "afterEnd"][Number(d.regime)];
    if (!regime) throw new Error("invalid_event_integer");
    const ts = Number(d.ts);
    if (!Number.isSafeInteger(ts)) throw new Error("unsafe_event_integer");
    await sql.query(
      `INSERT INTO creator_fee_collections(signature,slot,tx_index,ix_index,event_index,regime,amount,from_fee_in,from_wsol,to_stock,to_burn,to_team,book,target,ts)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(signature,event_index) DO UPDATE SET slot=EXCLUDED.slot,tx_index=EXCLUDED.tx_index,ix_index=EXCLUDED.ix_index,regime=EXCLUDED.regime,amount=EXCLUDED.amount,from_fee_in=EXCLUDED.from_fee_in,from_wsol=EXCLUDED.from_wsol,to_stock=EXCLUDED.to_stock,to_burn=EXCLUDED.to_burn,to_team=EXCLUDED.to_team,book=EXCLUDED.book,target=EXCLUDED.target,ts=EXCLUDED.ts`,
      [
        tx.signature,
        String(tx.slot),
        String(tx.txIndex),
        String(event.ixIndex),
        String(event.eventIndex),
        regime,
        ...[
          "amount",
          "from_fee_in",
          "from_wsol",
          "to_stock",
          "to_burn",
          "to_team",
          "book",
          "target",
        ].map((key) => amount(d[key])),
        new Date(ts * 1000),
      ],
    );
  }
}
