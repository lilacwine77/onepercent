import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client.js";
import { applyMigrations, migrationsFolder } from "../src/migrate.js";
import {
  digestRuns,
  goSessions,
  linkNonces,
  notifyCursors,
  notifyJobs,
  tgChats,
  tgLinks,
  tgReferrals,
} from "../src/schema.js";

const m5Tables = [
  tgChats,
  tgReferrals,
  tgLinks,
  linkNonces,
  goSessions,
  notifyJobs,
  notifyCursors,
  digestRuns,
];
const now = new Date("2026-10-09T00:00:00.000Z");
const wallet = "11111111111111111111111111111111";
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

describe("M5 schema custody boundary", () => {
  it("stores only the eight specified durable structures and no credentials or message contents", () => {
    expect(m5Tables).toHaveLength(8);
    for (const table of m5Tables) {
      for (const column of getTableConfig(table).columns) {
        expect(column.name).not.toMatch(
          /secret|seed|mnemonic|private|keypair|signature|message|start_payload/i,
        );
      }
    }
  });

  it("commits a forward migration for all M5 tables and only the authorized M2 index", async () => {
    const journal = JSON.parse(
      await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"),
    ) as { entries: { tag: string }[] };
    const entry = journal.entries.find((row) => row.tag.endsWith("_m5_bot"));
    expect(entry).toBeDefined();
    const migration = await readFile(
      `${migrationsFolder}/${entry!.tag}.sql`,
      "utf8",
    );
    for (const table of m5Tables)
      expect(migration).toContain(
        `CREATE TABLE "${getTableConfig(table).name}"`,
      );
    expect(migration).toContain('"royalties_settle_sig_idx"');
    expect(migration).not.toMatch(/DROP |ALTER TABLE/i);
  });
});

describe.skipIf(!enabled)("M5 Postgres 17 migration", () => {
  let admin: Pool;
  let database: ReturnType<typeof createDatabase>;
  const name = `onepct_m5_${randomUUID().replaceAll("-", "")}`;
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

  it("applies after S0, retains its tables, and creates the settle signature index", async () => {
    const result = await database.pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    // S0 and M5 create 30 tables; later migrations (M4.2 season services) add more,
    // so this checks the M5 baseline is retained rather than the running total.
    expect(result.rows.length).toBeGreaterThanOrEqual(30);
    const indexes = await database.pool.query(
      "SELECT indexname FROM pg_indexes WHERE indexname = 'royalties_settle_sig_idx'",
    );
    expect(indexes.rows).toHaveLength(1);
    await applyMigrations(database.pool);
    const journal = await database.pool.query(
      "SELECT * FROM drizzle.__drizzle_migrations",
    );
    expect(journal.rows.length).toBeGreaterThanOrEqual(2); // later migrations append
  });

  it("enforces private alerts, group hits and valid alert modes", async () => {
    await database.db
      .insert(tgChats)
      .values({ chatId: 1, kind: "private", alerts: "daily", updatedAt: now });
    await database.db
      .insert(tgChats)
      .values({ chatId: -1, kind: "group", hits: true, updatedAt: now });
    for (const [kind, mode, hits] of [
      ["group", "live", false],
      ["private", "off", true],
      ["private", "invalid", false],
    ]) {
      await expect(
        database.pool.query(
          "INSERT INTO tg_chats (chat_id,kind,alerts,hits,updated_at) VALUES (2,$1,$2,$3,$4)",
          [kind, mode, hits, now],
        ),
      ).rejects.toThrow();
    }
  });

  it("enforces referral formats and the one-to-one wallet pair", async () => {
    await database.db
      .insert(tgReferrals)
      .values({ telegramUserId: 1, code: "example_ref", setAt: now });
    await expect(
      database.db
        .insert(tgReferrals)
        .values({ telegramUserId: 2, code: "bad/ref", setAt: now }),
    ).rejects.toThrow();
    await database.db
      .insert(tgLinks)
      .values({ telegramUserId: 1, wallet, linkedAt: now });
    await expect(
      database.db
        .insert(tgLinks)
        .values({ telegramUserId: 2, wallet, linkedAt: now }),
    ).rejects.toThrow();
    await expect(
      database.db
        .insert(tgLinks)
        .values({ telegramUserId: 3, wallet: "invalid", linkedAt: now }),
    ).rejects.toThrow();
  });

  it("allows only one open nonce per user, with a valid random id format", async () => {
    const row = {
      telegramUserId: 1,
      botUsername: "test_bot",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 600_000),
    };
    await database.db
      .insert(linkNonces)
      .values({ ...row, nonce: "a".repeat(32) });
    await expect(
      database.db.insert(linkNonces).values({ ...row, nonce: "b".repeat(32) }),
    ).rejects.toThrow();
    await database.db
      .insert(linkNonces)
      .values({ ...row, nonce: "c".repeat(32), closedAt: now });
    await expect(
      database.db
        .insert(linkNonces)
        .values({ ...row, telegramUserId: 2, nonce: "not-a-nonce" }),
    ).rejects.toThrow();
  });

  it("rejects session field combinations and accepts the injected timestamps", async () => {
    const input = {
      telegramUserId: 1,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 600_000),
    };
    await database.db.insert(goSessions).values({
      ...input,
      id: "a".repeat(32),
      action: "rip",
      edition: "after_hours",
      n: 5,
    });
    const [stored] = await database.db.select().from(goSessions);
    expect(stored?.createdAt).toEqual(now);
    const cases = [
      ["feed", "original", null],
      ["cards", null, 1],
      ["rip", null, 1],
      ["rip", "invalid", 1],
      ["rip", "original", 0],
      ["rip", "original", 11],
      ["invalid", null, null],
    ];
    for (const [action, edition, n] of cases) {
      await expect(
        database.pool.query(
          "INSERT INTO go_sessions (id,telegram_user_id,action,edition,n,created_at,expires_at) VALUES ($1,1,$2,$3,$4,$5,$6)",
          ["b".repeat(32), action, edition, n, now, input.expiresAt],
        ),
      ).rejects.toThrow();
    }
  });

  it("deduplicates queued jobs and rejects unknown job or cursor kinds", async () => {
    const row = {
      dedupeKey: "roy:1:0:0",
      chatId: 1,
      kind: "royalty" as const,
      priority: 1,
      payload: { lamports: "2000000" },
      notBefore: now,
      expiresAt: now,
      createdAt: now,
    };
    await database.db.insert(notifyJobs).values(row);
    await expect(database.db.insert(notifyJobs).values(row)).rejects.toThrow();
    await expect(
      database.pool.query("UPDATE notify_jobs SET kind = 'invalid'"),
    ).rejects.toThrow();
    await expect(
      database.pool.query("UPDATE notify_jobs SET status = 'invalid'"),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        "INSERT INTO notify_cursors (name,slot,updated_at) VALUES ('invalid',1,$1)",
        [now],
      ),
    ).rejects.toThrow();
  });
});
