import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { applyMigrations, createDatabase } from "@onepercent/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMeMirror, readStatusMirror, readVerifyMirror } from "./mirror.js";

const enabled = process.env.SERVICES_INTEGRATION === "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  enabled &&
  (!databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    ))
)
  throw new Error("SERVICES_INTEGRATION requires a local TEST_DATABASE_URL");

describe.skipIf(!enabled)("S4 public Postgres confirmed snapshots", () => {
  let admin: ReturnType<typeof createDatabase>;
  let database: ReturnType<typeof createDatabase>;
  const name = `onepct_api_${randomUUID().replaceAll("-", "")}`;
  const wallet = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
  const buyer = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
  const opened = "1".repeat(64),
    revealed = "1".repeat(63) + "2";

  beforeAll(async () => {
    admin = createDatabase({ connectionString: databaseUrl });
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    const isolated = new URL(databaseUrl!);
    isolated.pathname = `/${name}`;
    database = createDatabase({ connectionString: isolated.href });
    await applyMigrations(database.pool);
    await database.pool.query(
      `INSERT INTO chain_txs(signature,slot,block_time,tx_index,commitment) VALUES ($1,10,CURRENT_TIMESTAMP,0,'confirmed'),($2,11,CURRENT_TIMESTAMP,0,'confirmed')`,
      [opened, revealed],
    );
    await database.pool.query(
      `INSERT INTO pulls(seq,address,buyer,buyer_nonce,edition,qty,price,holder,status,created_ts,opened_sig,revealed_sig,revealed_slot,reveal_order,live_flags,randomness,settled_mask) VALUES (1,$1,$2,0,0,1,1,false,'revealed',CURRENT_TIMESTAMP,$3,$4,11,0,0,$5,0)`,
      [buyer, buyer, opened, revealed, "ab".repeat(32)],
    );
    await database.pool.query(
      `INSERT INTO packs(seq,pack,t,widths,tier,hit_bucket,hit_mint,hit_amount,hit_value,house_mask,fresh_mask) VALUES (1,0,0,ARRAY[1,1,1,1,1,1],1,0,$1,1,1,0,0)`,
      [wallet],
    );
    await database.pool.query(
      `INSERT INTO dust_picks(seq,pack,k,deck_len_before,deck_index,moved_from,mint,amount,depositor,royalty,refund,paid,redirected) VALUES (1,0,0,10,0,9,$1,1,$1,1,0,0,false)`,
      [wallet],
    );
    await database.pool.query(
      `INSERT INTO royalties(seq,pack,k,depositor,amount,refund,paid,redirected,settle_sig) VALUES (1,0,0,$1,18446744073709551615,0,18446744073709551615,false,$2)`,
      [wallet, revealed],
    );
  }, 30_000);
  afterAll(async () => {
    await database?.close();
    if (admin) {
      await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.close();
    }
  });

  it("withholds outcome rows until their corresponding confirmed events exist", async () => {
    expect(await readVerifyMirror(database.pool, "1")).toMatchObject({
      randomness: null,
      packs: [],
    });
    await database.pool.query(
      `INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES ($1,11,0,0,0,'PullRevealed','{"seq":"1"}'),($1,11,0,0,1,'PackRevealed','{"seq":"1","pack":0,"live_flags":4}')`,
      [revealed],
    );
    const result = await readVerifyMirror(database.pool, "1");
    expect(result?.randomness).toBe("ab".repeat(32));
    expect(result?.packs).toHaveLength(1);
    expect(result?.packs[0]?.liveFlags).toBe(4);
    expect(result?.packs[0]?.dust[0]?.deckIndex).toBe(0);
  });
  it("reads depositor settlement and max-u64 royalty amounts without rounding", async () => {
    const result = await readMeMirror(database.pool, wallet);
    expect(result.pulls.settleable).toEqual([
      { seq: "1", pull: buyer, packs: [0] },
    ]);
    expect(result.royalties).toEqual({
      count24h: 1,
      lamports24h: "18446744073709551615",
      total: "18446744073709551615",
      settlementReceipts: {
        lamports24h: "18446744073709551615",
        total: "18446744073709551615",
      },
    });
  });
  it("keeps a partial combined receipt exact without inventing royalty attribution", async () => {
    await database.pool.query(
      "UPDATE royalties SET amount = 3, refund = 2, paid = 4 WHERE seq = 1",
    );
    expect((await readMeMirror(database.pool, wallet)).royalties).toEqual({
      count24h: 1,
      lamports24h: null,
      total: null,
      settlementReceipts: { lamports24h: "4", total: "4" },
    });
    await database.pool.query("UPDATE royalties SET paid = 5 WHERE seq = 1");
    expect((await readMeMirror(database.pool, wallet)).royalties).toEqual({
      count24h: 1,
      lamports24h: "3",
      total: "3",
      settlementReceipts: { lamports24h: "5", total: "5" },
    });
  });
  it("reads only the keeper lock in the current database", async () => {
    expect((await readStatusMirror(database.pool)).keeper.leader).toBe(false);
    const client = await database.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('onepct:keeper'))");
      expect((await readStatusMirror(database.pool)).keeper.leader).toBe(true);
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('onepct:keeper'))",
      );
      client.release();
    }
  });
  it("suppresses a previously visible outcome when its confirmed transaction disappears", async () => {
    await database.pool.query("DELETE FROM chain_txs WHERE signature = $1", [
      revealed,
    ]);
    const result = await readVerifyMirror(database.pool, "1");
    expect(result).toMatchObject({
      randomness: null,
      revealedSlot: null,
      packs: [],
    });
  });
});
