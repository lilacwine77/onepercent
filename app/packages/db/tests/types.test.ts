import { readFile } from "node:fs/promises";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema.js";
import {
  attestationBagsSchema,
  decodeU64,
  encodeU64,
  jsonObjectSchema,
  U64_MAX,
  u64StringSchema,
} from "../src/types.js";

const tableNames = [
  "alerts",
  "attestation_log",
  "buckets",
  "chain_events",
  "chain_txs",
  "cursors",
  "deck_entries",
  "dust_picks",
  "exec_trades",
  "feeds",
  "hitlist_reports",
  "intake_consumption",
  "keeper_jobs",
  "machine_state",
  "mint_ledgers",
  "packs",
  "pulls",
  "quote_log",
  "royalties",
  "sell_backs",
  "stock_plans",
  "stock_trades",
];

describe("database representation boundaries", () => {
  it("round-trips the entire u64 range without number conversion", () => {
    for (const value of [0n, 1n, (1n << 53n) + 1n, U64_MAX]) {
      expect(decodeU64(encodeU64(value))).toBe(value);
    }
    for (const value of [-1n, U64_MAX + 1n])
      expect(() => encodeU64(value)).toThrow();
    for (const value of [
      "-1",
      "1.5",
      "1e6",
      "no-value",
      "18446744073709551616",
    ]) {
      expect(u64StringSchema.safeParse(value).success).toBe(false);
      expect(() => decodeU64(value)).toThrow();
    }
  });

  it("accepts JSON decimal strings and rejects bigints, non-finite and unsafe numbers", () => {
    expect(
      jsonObjectSchema.parse({ nested: { amount: U64_MAX.toString() } }),
    ).toEqual({ nested: { amount: U64_MAX.toString() } });
    for (const value of [
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      undefined,
    ]) {
      expect(jsonObjectSchema.safeParse({ nested: { value } }).success).toBe(
        false,
      );
    }
    expect(
      attestationBagsSchema.safeParse([
        { mint: "mint", amount: "-1", path: "hop", via: "holder" },
      ]).success,
    ).toBe(false);
  });

  it("decodes node-postgres JSONB primitives without parsing them twice", () => {
    expect(schema.chainTxs.err.mapFromDriverValue("BlockhashNotFound")).toBe(
      "BlockhashNotFound",
    );
    expect(schema.chainEvents.data.mapFromDriverValue({ amount: "1" })).toEqual(
      { amount: "1" },
    );
  });

  it("matches the current migration snapshot, timezone timestamps and four-part ordered indexes", async () => {
    const journal = JSON.parse(
      await readFile(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: { idx: number }[] };
    expect(journal.entries.length).toBeGreaterThan(0);
    const latest = journal.entries.at(-1)!;
    const snapshot = JSON.parse(
      await readFile(
        new URL(
          `../drizzle/meta/${String(latest.idx).padStart(4, "0")}_snapshot.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { tables: Record<string, { name: string; schema: string }> };
    const currentTables = Object.values(snapshot.tables)
      .filter((table) => table.schema === "" || table.schema === "public")
      .map((table) => table.name)
      .sort();
    expect(Object.values(schema).map(getTableName).sort()).toEqual(
      currentTables,
    );
    for (const table of Object.values(schema)) {
      const columns = Object.values(getTableColumns(table));
      for (const column of columns) {
        if (column.getSQLType() === "numeric(20,0)") {
          expect(column.mapFromDriverValue(U64_MAX.toString())).toBe(U64_MAX);
          expect(column.mapToDriverValue(U64_MAX)).toBe(U64_MAX.toString());
        }
        if (column.getSQLType() === "numeric(20,0)[]") {
          expect(column.mapFromDriverValue([U64_MAX.toString(), "1"])).toEqual([
            U64_MAX,
            1n,
          ]);
        }
        if (column.dataType === "date")
          expect(column.getSQLType()).toBe("timestamp with time zone");
      }
      if (columns.some((column) => column.name === "ix_index")) {
        const order = getTableConfig(table).indexes.find((entry) =>
          entry.config.name?.endsWith("_order_idx"),
        );
        expect(
          order?.config.columns.map((column) =>
            "name" in column ? column.name : null,
          ),
        ).toEqual(["slot", "tx_index", "ix_index", "event_index"]);
      }
    }
  });

  it("commits all tables and the insert-only signer guards in migration 0000", async () => {
    const migration = await readFile(
      new URL("../drizzle/0000_m2_core.sql", import.meta.url),
      "utf8",
    );
    expect(
      [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)]
        .map((entry) => entry[1])
        .sort(),
    ).toEqual(tableNames);
    expect(migration).toContain('CREATE TRIGGER "attestation_log_insert_only"');
    expect(migration).toContain('CREATE TRIGGER "quote_log_insert_only"');
    expect(migration).toContain("BEFORE UPDATE OR DELETE OR TRUNCATE");
  });

  it("keeps launch mirrors bounded and preserves unknown historical pack flags", async () => {
    const migration = await readFile(
      new URL("../drizzle/0002_m4_season_services.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(
      'ALTER TABLE "packs" ADD COLUMN "live_flags" integer;',
    );
    expect(getTableColumns(schema.packs).liveFlags.notNull).toBe(false);
    for (const table of [
      schema.creatorFeeCollections,
      schema.seasonLaunches,
      schema.block0Buys,
      schema.executorTrades,
    ]) {
      const config = getTableConfig(table);
      for (const column of Object.values(getTableColumns(table))) {
        if (column.getSQLType() !== "numeric(20,0)") continue;
        expect(
          config.checks.some((check) => check.name === `${column.name}_u64`),
        ).toBe(true);
        expect(migration).toContain(
          `"${getTableName(table)}"."${column.name}" <= 18446744073709551615`,
        );
      }
    }
    for (const table of [
      schema.creatorFeeCollections,
      schema.seasonLaunches,
      schema.block0Buys,
    ]) {
      expect(getTableConfig(table).foreignKeys).toHaveLength(1);
      expect(getTableConfig(table).foreignKeys[0]?.onDelete).toBe("cascade");
    }
    expect(migration).not.toMatch(/CREATE TABLE "(?:hold_log|final_claims)"/);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
  });
});
