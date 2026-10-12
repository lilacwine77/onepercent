import { randomUUID } from "node:crypto";
import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAlert } from "../src/alerts.js";
import { createDatabase } from "../src/client.js";
import { applyMigrations, migrationsFolder } from "../src/migrate.js";
import {
  alerts,
  attestationLog,
  chainEvents,
  chainTxs,
  mintLedgers,
  quoteLog,
  pulls,
  sellBacks,
} from "../src/schema.js";
import { U64_MAX } from "../src/types.js";

const enabled = process.env.SERVICES_INTEGRATION === "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  enabled &&
  (!databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    ))
) {
  throw new Error("SERVICES_INTEGRATION requires a local TEST_DATABASE_URL");
}

describe.skipIf(!enabled)("Postgres 17 integration", () => {
  let admin: Pool;
  let database: ReturnType<typeof createDatabase>;
  const name = `onepct_test_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE DATABASE "${name}"`);
    const isolated = new URL(databaseUrl!);
    isolated.pathname = `/${name}`;
    database = createDatabase({ connectionString: isolated.href });
    await applyMigrations(database.pool);
  }, 30_000);

  afterAll(async () => {
    await database?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });

  it("applies the journal on an empty database and serializes repeated pre-deploy runs", async () => {
    const committedJournal = JSON.parse(
      await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number }[] };
    expect(committedJournal.entries.length).toBeGreaterThan(0);
    const latest = committedJournal.entries.at(-1)!;
    const snapshot = JSON.parse(
      await readFile(
        join(
          migrationsFolder,
          "meta",
          `${String(latest.idx).padStart(4, "0")}_snapshot.json`,
        ),
        "utf8",
      ),
    ) as { tables: Record<string, { schema: string }> };
    const tableCount = Object.values(snapshot.tables).filter(
      (table) => table.schema === "" || table.schema === "public",
    ).length;
    const result = await database.pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(result.rows[0]?.count).toBe(String(tableCount));
    await Promise.all([
      applyMigrations(database.pool),
      applyMigrations(database.pool),
    ]);
    const journal = await database.pool.query(
      "SELECT * FROM drizzle.__drizzle_migrations",
    );
    expect(journal.rows).toHaveLength(committedJournal.entries.length);
  });

  it("rejects modification of an applied migration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onepct-migrations-"));
    try {
      await cp(migrationsFolder, directory, { recursive: true });
      await appendFile(join(directory, "0000_m2_core.sql"), "\n");
      await expect(applyMigrations(database.pool, directory)).rejects.toThrow(
        "applied migration was modified",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("round-trips max u64 and rejects out-of-range amounts through SQL", async () => {
    const row = {
      mint: "mint-max",
      ledger: "ledger",
      payer: "payer",
      accounted: U64_MAX,
      vault: "vault",
      tokenProgram: "token",
      vaultExists: true,
    };
    await database.db.insert(mintLedgers).values(row);
    const [stored] = await database.db
      .select()
      .from(mintLedgers)
      .where(eq(mintLedgers.mint, row.mint));
    expect(stored?.accounted).toBe(U64_MAX);
    await expect(
      database.pool.query(
        "UPDATE mint_ledgers SET accounted = $1 WHERE mint = $2",
        [(U64_MAX + 1n).toString(), row.mint],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        "UPDATE mint_ledgers SET accounted = -1 WHERE mint = $1",
        [row.mint],
      ),
    ).rejects.toThrow();
  });

  it("keeps chain ordering exact and removes raw events with a rolled-back transaction", async () => {
    const slot = 9007199254740993n;
    await database.db.insert(chainTxs).values({
      signature: "tx-rollback",
      slot,
      txIndex: 1n,
      commitment: "confirmed",
    });
    await database.db.insert(chainEvents).values({
      signature: "tx-rollback",
      slot,
      txIndex: 1n,
      ixIndex: 2n,
      eventIndex: 3n,
      name: "BagFed",
      data: { amount: U64_MAX.toString() },
    });
    const [event] = await database.db.select().from(chainEvents);
    expect(event?.slot).toBe(slot);
    expect(event?.data).toEqual({ amount: U64_MAX.toString() });
    await database.db
      .delete(chainTxs)
      .where(eq(chainTxs.signature, "tx-rollback"));
    expect(await database.db.select().from(chainEvents)).toEqual([]);
  });

  it("round-trips a scalar JSONB transaction error", async () => {
    await database.db.insert(chainTxs).values({
      signature: "failed-tx",
      slot: 1n,
      txIndex: 0n,
      commitment: "confirmed",
      err: "AccountInUse",
    });
    const [failed] = await database.db
      .select()
      .from(chainTxs)
      .where(eq(chainTxs.signature, "failed-tx"));
    expect(failed?.err).toBe("AccountInUse");
  });

  it("enforces season amount bounds and removes dependent rows with their launch", async () => {
    await database.pool.query(
      "INSERT INTO chain_txs(signature,slot,tx_index,commitment) VALUES('season-schema',10,0,'confirmed')",
    );
    await database.pool.query(
      "INSERT INTO season_launches(signature,slot,mint,launch_pool,dev_buy_tokens,as_of_slot) VALUES('season-schema',10,'mint','pool',$1,10)",
      [U64_MAX.toString()],
    );
    await database.pool.query(
      "INSERT INTO block0_buys(signature,owner,launch_signature,slot,tokens,lamports_spent,team) VALUES('external-schema','owner','season-schema',11,$1,NULL,false)",
      [U64_MAX.toString()],
    );
    await database.pool.query(
      "INSERT INTO creator_fee_collections(signature,slot,tx_index,ix_index,event_index,regime,amount,from_fee_in,from_wsol,to_stock,to_burn,to_team,book,target,ts) VALUES('season-schema',10,0,0,0,'season',$1,$1,0,$1,0,0,0,0,now())",
      [U64_MAX.toString()],
    );
    expect(
      (
        await database.pool.query(
          "SELECT tokens,lamports_spent FROM block0_buys WHERE launch_signature='season-schema'",
        )
      ).rows,
    ).toEqual([{ tokens: U64_MAX.toString(), lamports_spent: null }]);
    for (const [table, column] of [
      ["block0_buys", "tokens"],
      ["season_launches", "dev_buy_tokens"],
      ["creator_fee_collections", "to_stock"],
    ]) {
      await expect(
        database.pool.query(`UPDATE ${table} SET ${column}=-1`),
      ).rejects.toThrow();
      await expect(
        database.pool.query(`UPDATE ${table} SET ${column}=$1`, [
          (U64_MAX + 1n).toString(),
        ]),
      ).rejects.toThrow();
    }
    await database.pool.query(
      "DELETE FROM chain_txs WHERE signature='season-schema'",
    );
    for (const table of [
      "season_launches",
      "block0_buys",
      "creator_fee_collections",
    ])
      expect(
        (await database.pool.query(`SELECT 1 FROM ${table}`)).rows,
      ).toEqual([]);
  });

  it("allows a reused Pull address after a Binder is recreated with a new seq", async () => {
    const row = {
      address: "reused-pull",
      buyer: "buyer",
      buyerNonce: 0n,
      edition: 0,
      qty: 1,
      price: 1n,
      holder: false,
      status: "pending" as const,
      createdTs: new Date(),
      openedSig: "pull-open",
      liveFlags: 0,
      settledMask: 0,
    };
    await database.db.insert(pulls).values([
      { ...row, seq: 1n },
      { ...row, seq: 2n },
    ]);
    const stored = await database.db
      .select()
      .from(pulls)
      .where(eq(pulls.address, row.address));
    expect(stored.map((pull) => pull.seq).sort()).toEqual([1n, 2n]);
    await expect(
      database.db.insert(pulls).values({ ...row, seq: 1n }),
    ).rejects.toThrow();
  });

  it("stores multiple Sell back events in one signature and rejects replayed event indices", async () => {
    const signature = "multiple-sell-backs";
    await database.db
      .insert(chainTxs)
      .values({ signature, slot: 2n, txIndex: 0n, commitment: "confirmed" });
    const row = {
      signature,
      slot: 2n,
      txIndex: 0n,
      ixIndex: 0n,
      owner: "owner",
      mint: "mint",
      bucket: 0,
      n: 1,
      totalAmount: 1n,
      stockedValue: 1n,
      quoteLamports: 1n,
      value: 1n,
      payout: 1n,
      toTeam: 0n,
      nonce: 0n,
      sbPaidHour: 1n,
      slotRefund: 0n,
    };
    await database.db.insert(sellBacks).values([
      { ...row, eventIndex: 0n },
      { ...row, eventIndex: 1n },
    ]);
    expect(
      await database.db
        .select()
        .from(sellBacks)
        .where(eq(sellBacks.signature, signature)),
    ).toHaveLength(2);
    await expect(
      database.db.insert(sellBacks).values({ ...row, eventIndex: 0n }),
    ).rejects.toThrow();
  });

  it("keeps signer logs unique and insert-only, including u64 arrays", async () => {
    const attestation = {
      messageSha256: "a".repeat(64),
      kind: "FEED" as const,
      wallet: "wallet",
      nonce: 4294967295n,
      expiry: new Date("2026-10-08T20:00:00Z"),
      bags: [
        {
          mint: "mint",
          amount: U64_MAX.toString(),
          path: "self" as const,
          via: null,
        },
      ],
      signer: "signer",
      ipHash: "b".repeat(64),
    };
    await database.db.insert(attestationLog).values(attestation);
    await expect(
      database.db.insert(attestationLog).values(attestation),
    ).rejects.toThrow();
    await expect(
      database.db.update(attestationLog).set({ wallet: "changed" }),
    ).rejects.toThrow();
    await expect(
      database.pool.query("TRUNCATE attestation_log"),
    ).rejects.toThrow();
    const quote = {
      messageSha256: "c".repeat(64),
      owner: "wallet",
      mint: "mint",
      cardIndices: [2, 1],
      amounts: [U64_MAX - 1n, 1n],
      totalAmount: U64_MAX,
      quoteLamports: 1n,
      valueLamports: 1n,
      payoutLamports: 1n,
      expiry: attestation.expiry,
      nonce: 4294967295n,
      router: "router",
      requestId: "request",
      signer: "signer",
      ipHash: attestation.ipHash,
    };
    await database.db.insert(quoteLog).values(quote);
    const [stored] = await database.db.select().from(quoteLog);
    expect(stored?.amounts).toEqual(quote.amounts);
    await expect(database.db.delete(quoteLog)).rejects.toThrow();
    await expect(
      database.pool.query(
        "UPDATE quote_log SET amounts = ARRAY[-1]::numeric[]",
      ),
    ).rejects.toThrow();
  });

  it("grants one alert notification to concurrent replicas and records every occurrence", async () => {
    const input = {
      key: "concurrent-test",
      severity: "warning" as const,
      payload: { lag: 10 },
      dedupeSeconds: 60,
    };
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => recordAlert(database.db, input)),
    );
    expect(decisions.filter(Boolean)).toHaveLength(1);
    const [stored] = await database.db
      .select()
      .from(alerts)
      .where(eq(alerts.key, input.key));
    expect(stored?.count).toBe(20n);
    await database.db
      .update(alerts)
      .set({ notifiedAt: sql`clock_timestamp() - interval '61 seconds'` })
      .where(eq(alerts.key, input.key));
    expect(await recordAlert(database.db, input)).toBe(true);
    expect(await recordAlert(database.db, input)).toBe(false);
    const [repeated] = await database.db
      .select()
      .from(alerts)
      .where(eq(alerts.key, input.key));
    expect(repeated?.count).toBe(22n);
    expect(repeated?.firstAt).toEqual(stored?.firstAt);
  });
});
