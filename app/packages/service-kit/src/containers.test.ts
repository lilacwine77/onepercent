import { randomUUID } from "node:crypto";
import { createDatabase } from "@onepercent/db";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { AlertService } from "./alert.js";
import { KeeperLeader } from "./leader.js";
import { createRedis, EventStream, SlidingWindowLimiter } from "./redis.js";

const enabled = process.env["SERVICES_INTEGRATION"] === "1";
const databaseUrl = process.env["TEST_DATABASE_URL"];
const redisUrl = process.env["TEST_REDIS_URL"];
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

describe.skipIf(!enabled)("Postgres 17 and Redis 7 integration", () => {
  it("limits simultaneous requests atomically and replays after a public SSE ID", async () => {
    const redis = createRedis(redisUrl!);
    const prefix = `onepct:test:${randomUUID()}`;
    try {
      await redis.connect();
      const limiter = new SlidingWindowLimiter(redis);
      const results = await Promise.all(
        Array.from({ length: 31 }, () =>
          limiter.limit(`${prefix}:rate`, 30, 60),
        ),
      );
      expect(results.filter(({ ok }) => ok)).toHaveLength(30);
      expect(results.filter(({ ok }) => !ok)).toEqual([
        { ok: false, retryAfterS: expect.any(Number) },
      ]);
      await redis.pexpire(`${prefix}:rate`, 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect((await limiter.limit(`${prefix}:rate`, 30, 60)).ok).toBe(true);
      const stream = new EventStream(redis, {
        key: `${prefix}:events`,
        maxLength: 500,
      });
      await stream.publish({
        id: "10-0-0",
        event: "feed",
        data: { amount: "10" },
      });
      await stream.publish({
        id: "10-1-0",
        event: "reveal",
        data: { seq: "2" },
      });
      await stream.publish({
        id: "11-0-0",
        event: "settle",
        data: { seq: "2" },
      });
      const firstReplay = await stream.replayAfter();
      for (const event of firstReplay) await stream.publish(event);
      expect(await stream.replayAfter()).toEqual(firstReplay);
      expect((await stream.replayAfter("10-1-0")).map(({ id }) => id)).toEqual([
        "11-0-0",
      ]);
    } finally {
      await redis.del(`${prefix}:rate`, `${prefix}:events`);
      await redis.quit();
    }
  });

  it("deduplicates concurrent alerts across service instances without postponing the next interval", async () => {
    const database = createDatabase({ connectionString: databaseUrl! });
    const key = `integration:${randomUUID()}`;
    const options = {
      db: database.db,
      dedupeSeconds: 600,
      timeoutMs: 100,
      ipSalt: "integration-salt",
    };
    try {
      const instances = [new AlertService(options), new AlertService(options)];
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          instances[i % 2]!.alert(key, "warning", { count: i }),
        ),
      );
      expect(results.filter(({ recorded }) => recorded)).toHaveLength(1);
      expect(
        (
          await database.pool.query("SELECT count FROM alerts WHERE key = $1", [
            key,
          ])
        ).rows[0].count,
      ).toBe("20");
      await database.pool.query(
        "UPDATE alerts SET notified_at = clock_timestamp() - interval '601 seconds' WHERE key = $1",
        [key],
      );
      expect(await instances[0]!.alert(key, "warning", {})).toEqual({
        recorded: true,
        delivered: false,
      });
    } finally {
      await database.pool.query("DELETE FROM alerts WHERE key = $1", [key]);
      await database.close();
    }
  });

  it("aborts a terminated keeper session and hands over within the failover budget", async () => {
    const options = {
      connectionString: databaseUrl!,
      tickMs: 100,
      followerRetrySeconds: 0.1,
      leaderFailoverSeconds: 2,
    };
    const first = new KeeperLeader(options);
    const second = new KeeperLeader(options);
    const pool = new Pool({ connectionString: databaseUrl! });
    try {
      await first.start();
      await second.start();
      expect(first.isLeader).toBe(true);
      expect(second.isLeader).toBe(false);
      const firstSignal = first.signal;
      await pool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND locktype = 'advisory' AND granted AND objid = hashtext('onepct:keeper')::oid",
      );
      const started = Date.now();
      while (!firstSignal.aborted && Date.now() - started < 2_000)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(firstSignal.aborted).toBe(true);
      await first.stop();
      while (!second.isLeader && Date.now() - started < 2_000)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(second.isLeader).toBe(true);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await first.stop();
      await second.stop();
      await pool.end();
    }
  });

  it.each(["onepct:keeper", "onepct:executor"] as const)(
    "hands %s to a standby after its business task rejects while Postgres stays healthy",
    async (lockKey) => {
      const options = {
        lockKey,
        connectionString: databaseUrl!,
        tickMs: 1_000,
        followerRetrySeconds: 0.1,
        leaderFailoverSeconds: 4,
      };
      let rejectJob!: (error: Error) => void;
      const job = new Promise<void>((_resolve, reject) => {
        rejectJob = reject;
      });
      const first = new KeeperLeader({ ...options, onLeader: () => job });
      const second = new KeeperLeader(options);
      try {
        await first.start();
        await second.start();
        expect(first.isLeader).toBe(true);
        expect(second.isLeader).toBe(false);
        const failedSignal = first.signal;
        rejectJob(new Error("rpc_unavailable"));
        const started = Date.now();
        while (!second.isLeader && Date.now() - started < 4_000)
          await new Promise((resolve) => setTimeout(resolve, 10));
        expect(failedSignal.aborted).toBe(true);
        expect(second.isLeader).toBe(true);
        expect(first.isLeader).toBe(false);
        expect(Date.now() - started).toBeLessThan(4_000);
        // Five successful PostgreSQL probes cannot renew the failed term.
        await new Promise((resolve) =>
          setTimeout(resolve, (5 * options.tickMs) / 2),
        );
        expect(first.isLeader).toBe(false);
        expect(failedSignal.aborted).toBe(true);
        expect(second.isLeader).toBe(true);
      } finally {
        await first.stop();
        await second.stop();
      }
    },
    10_000,
  );
});
