import { randomUUID } from "node:crypto";
import { applyMigrations, createDatabase } from "@onepercent/db";
import {
  createRedis,
  EventStream,
  type StreamEvent,
} from "@onepercent/service-kit";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { settings } from "./__fixtures__/settings.js";
import { createPublicEvents } from "./events.js";
import { confirmedReplay, PublicStreamHub } from "./stream.js";
import { feedEvent, revealEvent, settleEvent } from "./__fixtures__/stream.js";

const enabled = process.env.SERVICES_INTEGRATION === "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (enabled) {
  for (const [name, value] of [
    ["TEST_DATABASE_URL", databaseUrl],
    ["TEST_REDIS_URL", redisUrl],
  ]) {
    if (
      !value ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)
    ) {
      throw new Error(`${name} must target a local CI/dev container`);
    }
  }
}

describe.skipIf(!enabled)("S4 public Postgres/Redis event integration", () => {
  const token = randomUUID().replaceAll("-", "");
  const databaseName = `onepct_public_events_${token}`;
  const redisPrefix = `onepct:test:public-events:${token}:`;
  let admin: ReturnType<typeof createDatabase>;
  let database: ReturnType<typeof createDatabase>;
  let redis: ReturnType<typeof createRedis>;
  let publisher: EventStream;
  let source: ReturnType<typeof createPublicEvents>;

  beforeAll(async () => {
    admin = createDatabase({ connectionString: databaseUrl });
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
    const isolated = new URL(databaseUrl!);
    isolated.pathname = `/${databaseName}`;
    database = createDatabase({ connectionString: isolated.href });
    await applyMigrations(database.pool);
    // ioredis prefixes both production XADD/XRANGE and this test's cleanup.
    redis = createRedis(redisUrl!, { keyPrefix: redisPrefix });
    await redis.connect();
    publisher = new EventStream(redis, {
      key: "onepct:events",
      maxLength: settings.api.sseReplayEvents,
    });
    source = createPublicEvents({ redis, pool: database.pool }, settings);
  }, 30_000);

  beforeEach(async () => {
    await redis.del("onepct:events");
    await database.pool.query("DELETE FROM chain_txs");
  });

  afterAll(async () => {
    try {
      if (redis) {
        await redis.del("onepct:events");
        await redis.quit();
      }
    } finally {
      await database?.close();
      if (admin) {
        try {
          await admin.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
        } finally {
          await admin.close();
        }
      }
    }
  });

  async function insertEvent(
    event: StreamEvent,
    signature: string,
    name: string,
    commitment: "confirmed" | "finalized" = "confirmed",
    err: string | null = null,
    query: typeof database.pool.query = database.pool.query.bind(database.pool),
  ) {
    const [slot, txIndex, eventIndex] = event.id.split("-");
    await query(
      `INSERT INTO chain_txs(signature,slot,tx_index,commitment,err)
       VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT(signature) DO NOTHING`,
      [
        signature,
        slot,
        txIndex,
        commitment,
        err === null ? null : JSON.stringify(err),
      ],
    );
    await query(
      `INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data)
       VALUES ($1,$2,$3,0,$4,$5,$6::jsonb)`,
      [signature, slot, txIndex, eventIndex, name, JSON.stringify(event.data)],
    );
  }

  const sig = (suffix: string) => "1".repeat(63) + suffix;
  it("withholds Redis outcomes until their confirmed DB transaction commits", async () => {
    const reveal = revealEvent("10-0-0", "1", sig("2"));
    await publisher.publish(reveal);
    expect(await source.confirmed([reveal])).toEqual([]);
    expect(await confirmedReplay(source)).toEqual({
      rows: [reveal],
      confirmed: [],
    });
    const writer = await database.pool.connect();
    try {
      await writer.query("BEGIN");
      await insertEvent(
        reveal,
        reveal.data.signature,
        "PackRevealed",
        "confirmed",
        null,
        writer.query.bind(writer),
      );
      expect(await source.confirmed([reveal])).toEqual([]);
      await writer.query("COMMIT");
      expect(await source.confirmed([reveal])).toEqual([reveal]);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });

  it("accepts confirmed/finalized events and suppresses failed or mismatched events", async () => {
    const confirmed = feedEvent("11-0-0", "1", sig("2"));
    const finalized = settleEvent("11-1-0", "1", sig("3"));
    const failed = revealEvent("11-2-0", "2", sig("4"));
    const mismatched = revealEvent("11-3-0", "3", sig("5"));
    await insertEvent(confirmed, confirmed.data.signature, "BagFed");
    await insertEvent(
      finalized,
      finalized.data.signature,
      "PackSettled",
      "finalized",
    );
    await insertEvent(
      failed,
      failed.data.signature,
      "PackRevealed",
      "confirmed",
      "AccountInUse",
    );
    await insertEvent(mismatched, mismatched.data.signature, "BagFed");
    for (const event of [confirmed, finalized, failed, mismatched])
      await publisher.publish(event);
    expect((await confirmedReplay(source)).confirmed).toEqual([
      confirmed,
      finalized,
    ]);
  });

  it("resumes strictly after the public three-part ID without duplicates", async () => {
    const events = [
      feedEvent("12-0-0", "1", sig("2")),
      feedEvent("12-0-1", "2", sig("2")),
      feedEvent("12-1-0", "3", sig("3")),
      feedEvent("13-0-0", "4", sig("4")),
    ];
    for (const event of events) {
      await insertEvent(event, event.data.signature, "BagFed");
      await publisher.publish(event);
    }
    for (const event of events) await publisher.publish(event);
    expect(await source.replayAfter()).toEqual(events);
    expect(await confirmedReplay(source, "12-0-1")).toEqual({
      rows: events.slice(2),
      confirmed: events.slice(2),
    });
    expect(await source.replayAfter("13-0-0")).toEqual([]);
  });

  it("suppresses stale Redis outcomes after a confirmed transaction is removed", async () => {
    const reveal = revealEvent("14-0-0", "4", sig("2"));
    const next = feedEvent("15-0-0", "1", sig("3"));
    await insertEvent(reveal, reveal.data.signature, "PackRevealed");
    await insertEvent(next, next.data.signature, "BagFed");
    await publisher.publish(reveal);
    await publisher.publish(next);
    expect((await confirmedReplay(source)).confirmed).toEqual([reveal, next]);
    await database.pool.query("DELETE FROM chain_txs WHERE signature = $1", [
      reveal.data.signature,
    ]);
    expect(await confirmedReplay(source)).toEqual({
      rows: [reveal, next],
      confirmed: [next],
    });
  });

  it("shares one SQL confirmation per tick across connected clients", async () => {
    const event = feedEvent("16-0-0", "1", sig("2"));
    await insertEvent(event, event.data.signature, "BagFed");
    await publisher.publish(event);
    const query = vi.spyOn(database.pool, "query");
    const hub = new PublicStreamHub(source, settings, { autoPoll: false });
    const clients = await Promise.all(
      Array.from({ length: 10 }, (_, i) => hub.open(`ip-${i}`)),
    );
    expect(query).toHaveBeenCalledTimes(1);
    await hub.poll();
    expect(query).toHaveBeenCalledTimes(2);
    for (const client of clients) client.close();
    query.mockRestore();
  });
});
