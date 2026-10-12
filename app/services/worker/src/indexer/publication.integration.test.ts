import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, applyMigrations } from "@onepercent/db";
import { createRedis, EventStream } from "@onepercent/service-kit";
import { EventPublisher } from "./publication.js";

const enabled = process.env.SERVICES_INTEGRATION === "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (
  enabled &&
  (!databaseUrl ||
    !redisUrl ||
    [databaseUrl, redisUrl].some(
      (url) =>
        !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    ))
)
  throw new Error(
    "SERVICES_INTEGRATION requires local database and Redis URLs",
  );

describe.skipIf(!enabled)("confirmed Redis outbox (services CI)", () => {
  const name = `onepct_outbox_${randomUUID().replaceAll("-", "")}`;
  const key = `onepct:test:events:${name}`;
  let admin: ReturnType<typeof createDatabase>;
  let database: ReturnType<typeof createDatabase>;
  let redis: ReturnType<typeof createRedis>;
  beforeAll(async () => {
    admin = createDatabase({ connectionString: databaseUrl });
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    database = createDatabase({ connectionString: url.href });
    await applyMigrations(database.pool);
    redis = createRedis(redisUrl!);
    await redis.connect();
  }, 30000);
  afterAll(async () => {
    if (redis) {
      await redis.del(key);
      redis.disconnect();
    }
    await database?.close();
    if (admin) {
      await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.close();
    }
  });
  it("publishes only committed rows and resumes lower replacement IDs after rollback and Redis loss", async () => {
    const stream = new EventStream(redis, { key, maxLength: 500 });
    const publisher = new EventPublisher(database.pool, stream, 500, {
      clear: () => redis.del(key).then(() => undefined),
      exists: () => redis.exists(key).then((n) => n > 0),
    });
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO chain_txs(signature,slot,tx_index,commitment) VALUES('a',100,0,'confirmed')",
      );
      await client.query(
        "INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES('a',100,0,0,0,'BagFed','{\"amount\":\"9007199254740993\"}')",
      );
      await publisher.flush();
      expect(await stream.replayAfter()).toEqual([]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await publisher.flush();
    expect((await stream.replayAfter())[0]?.data.amount).toBe(
      "9007199254740993",
    );
    await publisher.flush();
    expect(await stream.replayAfter()).toHaveLength(1);
    await database.pool.query("DELETE FROM chain_txs WHERE signature='a'");
    await database.pool.query(
      "INSERT INTO chain_txs(signature,slot,tx_index,commitment) VALUES('b',100,0,'confirmed')",
    );
    await database.pool.query(
      "INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES('b',100,0,0,0,'BagFed','{\"amount\":\"2\"}')",
    );
    await database.pool.query(
      "INSERT INTO cursors(name,last_slot) VALUES('indexer:stream-reset',100)",
    );
    await publisher.flush();
    expect(
      (await stream.replayAfter()).map((event) => event.data.signature),
    ).toEqual(["b"]);
    await redis.del(key);
    await publisher.flush();
    expect(
      (await stream.replayAfter()).map((event) => event.data.signature),
    ).toEqual(["b"]);
  });
});
