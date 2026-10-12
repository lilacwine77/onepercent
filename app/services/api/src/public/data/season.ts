import { BLOCK0 } from "@onepercent/config";
import { Block0Response, CreatorFeesResponse } from "@onepercent/sdk/api";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { z } from "zod";
import { readSnapshot } from "./mirror.js";
import { safeNumber } from "./draft-layouts.js";

const number = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform(safeNumber);

export function readBlock0(pool: ServiceRuntime["pool"]) {
  return readSnapshot(pool, async (client, asOfSlot) => {
    const launches = await client.query(`SELECT s.signature, s.slot, s.mint,
      s.launch_pool AS "launchPool", s.dev_buy_tokens::text AS "devBuyTokens",
      s.status, s.as_of_slot AS "asOfSlot"
      FROM season_launches s JOIN chain_txs t ON t.signature = s.signature
      WHERE t.err IS NULL AND t.commitment IN ('confirmed','finalized')
      ORDER BY s.slot DESC LIMIT 1`);
    const launch = z
      .object({
        signature: z.string(),
        slot: number,
        mint: z.string(),
        launchPool: z.string(),
        devBuyTokens: z.string(),
        status: z.enum(["pending", "ready"]),
        asOfSlot: number,
      })
      .optional()
      .parse(launches.rows[0]);
    if (!launch || launch.status === "pending")
      return Block0Response.parse({ status: "pending", asOfSlot });
    const rows = await client.query(
      `SELECT signature, owner, slot, tokens::text,
      lamports_spent::text AS "lamportsSpent", team, role
      FROM block0_buys WHERE launch_signature = $1 ORDER BY slot, signature, owner`,
      [launch.signature],
    );
    return Block0Response.parse({
      status: "ready",
      asOfSlot: launch.asOfSlot,
      slots: BLOCK0.slots,
      launch: {
        signature: launch.signature,
        slot: launch.slot,
        mint: launch.mint,
        launchPool: launch.launchPool,
        devBuyTokens: launch.devBuyTokens,
      },
      buys: rows.rows.map((value) => {
        const row = z.object({ slot: number }).passthrough().parse(value);
        return row;
      }),
    });
  });
}

export function readCreatorFees(pool: ServiceRuntime["pool"], limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("invalid_limit");
  return readSnapshot(pool, async (client, asOfSlot) => {
    const rows = await client.query(
      `SELECT c.signature, FLOOR(EXTRACT(EPOCH FROM c.ts))::bigint AS ts,
      c.regime, c.amount::text, c.to_stock::text AS "toStock",
      c.to_burn::text AS "toBurn", c.to_team::text AS "toTeam"
      FROM creator_fee_collections c JOIN chain_txs t ON t.signature = c.signature
      WHERE t.err IS NULL AND t.commitment IN ('confirmed','finalized')
      ORDER BY c.slot DESC, c.tx_index DESC, c.ix_index DESC, c.event_index DESC LIMIT $1`,
      [limit],
    );
    return CreatorFeesResponse.parse({
      asOfSlot,
      items: rows.rows.map((value) =>
        z.object({ ts: number }).passthrough().parse(value),
      ),
    });
  });
}
