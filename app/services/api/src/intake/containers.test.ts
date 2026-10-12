import { randomUUID } from "node:crypto";
import { createDatabase } from "@onepercent/db";
import { createRedis, SlidingWindowLimiter } from "@onepercent/service-kit";
import { describe, expect, it } from "vitest";
import { createFeedLogWriter, createIntakeLiveReader } from "./store.js";
import { createIntakeService } from "./service.js";
import { intakeFixture, ipHash } from "./test-fixtures.js";

const postgres = process.env.SERVICES_INTEGRATION === "1";
const redisEnabled = postgres || process.env.S2_REDIS_INTEGRATION === "1";
function localUrl(name: string): string {
  const value = process.env[name];
  if (
    !value ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)
  )
    throw new Error(`${name} must target local services`);
  return value;
}
describe.skipIf(!postgres)("FEED Postgres integration", () => {
  it("deduplicates repeated attestations without consuming eligibility or changing the Deck", async () => {
    const database = createDatabase({
      connectionString: localUrl("TEST_DATABASE_URL"),
    });
    const f = intakeFixture();
    f.options.live = createIntakeLiveReader(database.pool);
    f.options.appendLogs = createFeedLogWriter(database.db);
    const service = createIntakeService(f.options);
    try {
      const before = await database.pool.query(
        "SELECT (SELECT count(*) FROM intake_consumption)::text AS consumption, (SELECT count(*) FROM deck_entries)::text AS deck",
      );
      const [first, second] = await Promise.all([
        service.handle(f.request, ipHash),
        service.handle(f.request, ipHash),
      ]);
      expect(first.attestations).toEqual(second.attestations);
      const after = await database.pool.query(
        "SELECT (SELECT count(*) FROM intake_consumption)::text AS consumption, (SELECT count(*) FROM deck_entries)::text AS deck",
      );
      expect(after.rows).toEqual(before.rows);
      const logs = await database.pool.query(
        "SELECT message_sha256 FROM attestation_log WHERE wallet=$1 AND nonce=$2",
        [f.request.wallet, 4],
      );
      expect(logs.rows).toHaveLength(1);
    } finally {
      await database.close();
    }
  });
});
describe.skipIf(!redisEnabled)("FEED Redis integration", () => {
  it("enforces 30 wallet and 60 IP requests atomically with separate proxy/private namespaces", async () => {
    const redis = createRedis(localUrl("TEST_REDIS_URL"));
    const id = `onepct:s2:${randomUUID()}`;
    const keys = [`${id}:wallet`, `${id}:ip`, `${id}:private`];
    try {
      await redis.connect();
      const limiter = new SlidingWindowLimiter(redis);
      const wallet = await Promise.all(
        Array.from({ length: 31 }, () => limiter.limit(keys[0]!, 30, 60)),
      );
      const ip = await Promise.all(
        Array.from({ length: 61 }, () => limiter.limit(keys[1]!, 60, 60)),
      );
      expect(wallet.filter((r) => r.ok)).toHaveLength(30);
      expect(ip.filter((r) => r.ok)).toHaveLength(60);
      expect(wallet.find((r) => !r.ok)?.retryAfterS).toBeGreaterThan(0);
      expect((await limiter.limit(keys[2]!, 30, 60)).ok).toBe(true);
    } finally {
      await redis.del(...keys);
      await redis.quit();
    }
  });
});
