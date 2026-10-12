import "./setup.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, createDatabase } from "@onepercent/db";
import { InMemoryBotStore, type BotStore } from "../store.js";
import { PgBotStore } from "../store-pg.js";
import { parseReferral } from "../referral.js";
import { BotLock, botDatabaseOptions, databaseReady } from "../runtime.js";

function contract(make: () => BotStore) {
  let store: BotStore;
  beforeEach(() => {
    store = make();
  });
  it("first referral wins and is kept after block and restart", async () => {
    expect(
      await store.setPendingReferral(41, parseReferral("ref_first")!),
    ).toBe(true);
    expect(
      await store.setPendingReferral(41, parseReferral("ref_second")!),
    ).toBe(false);
    await store.markBlocked(41);
    expect(await store.getPendingReferral(41)).toBe("first");
  });
  it("persists all modes and block clears private opt-in without clearing the referral", async () => {
    await store.recordStart(42, 42);
    expect(await store.hasStarted(42)).toBe(true);
    for (const mode of ["off", "live", "daily"] as const) {
      await store.setAlerts(42, mode);
      expect(await store.getAlerts(42)).toBe(mode);
    }
    await store.markBlocked(42);
    expect(await store.hasStarted(42)).toBe(false);
    expect(await store.getAlerts(42)).toBe("off");
    await store.recordStart(42, 42);
    expect(await store.hasStarted(42)).toBe(true);
    expect(await store.getAlerts(42)).toBe("off");
  });
  it("clears group opt-in on block and moves it on Telegram migration", async () => {
    await store.setGroupHits(-100, true);
    await store.markBlocked(-100);
    expect(await store.getGroupHits(-100)).toBe(false);
    await store.setGroupHits(-100, true);
    expect(await store.getGroupHits(-100)).toBe(true);
    await store.migrateChat(-100, -200);
    expect(await store.getGroupHits(-100)).toBe(false);
    expect(await store.getGroupHits(-200)).toBe(true);
    await store.migrateChat(-200, -200);
    expect(await store.getGroupHits(-200)).toBe(true);
    await store.setGroupHits(-200, false);
    expect(await store.getGroupHits(-200)).toBe(false);
  });
}
describe("BotStore memory contract", () => {
  contract(() => new InMemoryBotStore());
});
const enabled = process.env.SERVICES_INTEGRATION === "1";
const url = process.env.TEST_DATABASE_URL;
if (
  enabled &&
  (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
)
  throw new Error("SERVICES_INTEGRATION requires a local TEST_DATABASE_URL");
describe.skipIf(!enabled)("BotStore Postgres contract and lock", () => {
  let admin: ReturnType<typeof createDatabase>;
  let database: ReturnType<typeof createDatabase>;
  const name = `onepct_bot_${randomUUID().replaceAll("-", "")}`;
  const now = Date.parse("2026-10-09T00:00:00Z");
  beforeAll(async () => {
    admin = createDatabase(botDatabaseOptions(url!));
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    const isolated = new URL(url!);
    isolated.pathname = `/${name}`;
    database = createDatabase(botDatabaseOptions(isolated.href));
    await applyMigrations(database.pool);
  }, 30_000);
  beforeEach(async () => {
    await database.pool.query(
      "TRUNCATE tg_chats,tg_referrals,notify_jobs RESTART IDENTITY",
    );
  });
  afterAll(async () => {
    await database?.close();
    if (admin) {
      await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.close();
    }
  });
  contract(() => new PgBotStore(database.pool, () => now));
  it("survives new store instances and writes only the injected timestamp", async () => {
    const first = new PgBotStore(database.pool, () => now);
    await first.recordStart(42, 42);
    await first.setAlerts(42, "live");
    await first.setPendingReferral(42, parseReferral("ref_first")!);
    const second = new PgBotStore(database.pool, () => now + 1);
    expect(await second.hasStarted(42)).toBe(true);
    expect(await second.getAlerts(42)).toBe("live");
    expect(await second.getPendingReferral(42)).toBe("first");
    const rows = await database.pool.query(
      "SELECT started_at,updated_at FROM tg_chats WHERE chat_id=42",
    );
    expect(rows.rows[0].started_at.getTime()).toBe(now);
    expect(rows.rows[0].updated_at.getTime()).toBe(now);
  });
  it("opt-out skips only that user's queued royalty and digest jobs", async () => {
    await database.pool.query(
      `INSERT INTO notify_jobs(dedupe_key,chat_id,kind,priority,payload,not_before,expires_at,created_at) VALUES ('a',42,'royalty',1,'{}',$1,$1,$1),('b',42,'digest',3,'{}',$1,$1,$1),('c',42,'hit',2,'{}',$1,$1,$1),('d',43,'royalty',1,'{}',$1,$1,$1)`,
      [new Date(now)],
    );
    await new PgBotStore(database.pool, () => now).setAlerts(42, "off");
    const rows = await database.pool.query(
      "SELECT dedupe_key,status FROM notify_jobs ORDER BY dedupe_key",
    );
    expect(rows.rows.map((r) => r.status)).toEqual([
      "skipped",
      "skipped",
      "queued",
      "queued",
    ]);
  });
  it("holds one poller lock until release and detects missing readiness tables", async () => {
    const first = new BotLock(database.pool, () => {}),
      second = new BotLock(database.pool, () => {});
    const controller = new AbortController();
    expect(await first.acquire(controller.signal)).toBe(true);
    let polled = false;
    const waiting = second.acquire(controller.signal).then((acquired) => {
      polled = acquired;
      return acquired;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(polled).toBe(false);
    controller.abort();
    expect(await waiting).toBe(false);
    await second.release();
    await first.release();
    expect(await databaseReady(database.pool)).toBe(true);
    await database.pool.query(
      "ALTER TABLE tg_chats RENAME TO tg_chats_missing",
    );
    expect(await databaseReady(database.pool)).toBe(false);
    await database.pool.query(
      "ALTER TABLE tg_chats_missing RENAME TO tg_chats",
    );
  });
});
