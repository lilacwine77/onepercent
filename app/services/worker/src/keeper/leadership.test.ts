import { createDatabase } from "@onepercent/db";
import { expect, it, vi } from "vitest";
import {
  createKeeperLeadershipWatchdog,
  runKeeperLeadershipWatchdog,
  type KeeperLeadershipWatchdogOptions,
} from "./leadership.js";

function fixture() {
  const controller = new AbortController();
  const query = vi.fn<
    (sql: string) => Promise<{ rows: { present: boolean }[] }>
  >(async () => ({ rows: [{ present: false }] }));
  const chainNow = vi.fn(async () => 100n);
  const alert = vi.fn(async () => ({ recorded: true, delivered: true }));
  const options: KeeperLeadershipWatchdogOptions = {
    pool: {
      query:
        query as unknown as KeeperLeadershipWatchdogOptions["pool"]["query"],
    },
    rpc: { chainNow },
    alerts: { alert },
    intervalMs: 10_000,
    leaderFailoverSeconds: 60,
    signal: controller.signal,
  };
  return {
    controller,
    query,
    chainNow,
    alert,
    options,
    watchdog: createKeeperLeadershipWatchdog(options),
  };
}

it("observes the global current-database bigint advisory lock without acquiring one", async () => {
  const { watchdog, query, alert } = fixture();
  query.mockResolvedValue({ rows: [{ present: true }] });
  expect(await watchdog.poll()).toEqual({ status: "present" });
  const sql = query.mock.calls[0]![0];
  expect(sql).toContain("current_database()");
  expect(sql).toContain("hashtext('onepct:keeper')::bigint >> 32");
  expect(sql).toContain("l.objsubid = 1");
  expect(sql).not.toContain("pg_try_advisory_lock");
  expect(alert).not.toHaveBeenCalled();
});

it("uses chain time, alerts only beyond the threshold, and resets on fresh presence", async () => {
  const { watchdog, query, chainNow, alert } = fixture();
  expect(await watchdog.poll()).toEqual({
    status: "absent",
    missingForSeconds: 0n,
  });
  chainNow.mockResolvedValue(160n);
  await watchdog.poll();
  expect(alert).not.toHaveBeenCalled();
  chainNow.mockResolvedValue(161n);
  await watchdog.poll();
  expect(alert).toHaveBeenCalledExactlyOnceWith(
    "keeper_leader_missing",
    "warning",
    { missingForSeconds: "61" },
  );
  query.mockResolvedValueOnce({ rows: [{ present: true }] });
  await watchdog.poll();
  chainNow.mockResolvedValue(200n);
  expect(await watchdog.poll()).toEqual({
    status: "absent",
    missingForSeconds: 0n,
  });
});

it("does not interpret DB or clock failures as absence or recovery", async () => {
  const { watchdog, query, chainNow, alert } = fixture();
  query.mockRejectedValueOnce(new Error("db_unavailable"));
  expect(await watchdog.poll()).toEqual({ status: "unknown" });
  await watchdog.poll();
  chainNow.mockRejectedValueOnce(new Error("rpc_unavailable"));
  expect(await watchdog.poll()).toEqual({ status: "unknown" });
  expect(alert).not.toHaveBeenCalled();
  chainNow.mockResolvedValue(161n);
  await watchdog.poll();
  expect(alert).toHaveBeenCalledTimes(1);
});

it("contains alert failures and exits cleanly with its lifetime signal", async () => {
  const { options, controller, watchdog, chainNow, alert } = fixture();
  await watchdog.poll();
  chainNow.mockResolvedValue(161n);
  alert.mockRejectedValue(new Error("notification_unavailable"));
  expect(await watchdog.poll()).toEqual({
    status: "absent",
    missingForSeconds: 61n,
  });
  const sleep = vi.fn(async () => {
    controller.abort();
  });
  await runKeeperLeadershipWatchdog({ ...options, sleep });
  expect(sleep).toHaveBeenCalledExactlyOnceWith(10_000, controller.signal);
  expect(await watchdog.poll()).toEqual({ status: "unknown" });
});

const integrationEnabled = process.env["SERVICES_INTEGRATION"] === "1";
const integrationUrl = process.env["TEST_DATABASE_URL"];
if (
  integrationEnabled &&
  (!integrationUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(integrationUrl).hostname,
    ))
)
  throw new Error("TEST_DATABASE_URL must target a local CI/dev container");

it.skipIf(!integrationEnabled)(
  "finds S0's real advisory lock from a separate Postgres session",
  async () => {
    const database = createDatabase({
      connectionString: integrationUrl,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
    });
    const holder = await database.pool.connect();
    let acquired = false;
    try {
      const result = await holder.query(
        "SELECT pg_try_advisory_lock(hashtext('onepct:keeper')) AS acquired",
      );
      acquired = result.rows[0].acquired === true;
      const { options } = fixture();
      const watchdog = createKeeperLeadershipWatchdog({
        ...options,
        pool: database.pool,
      });
      expect(await watchdog.poll()).toEqual({ status: "present" });
    } finally {
      if (acquired)
        await holder.query(
          "SELECT pg_advisory_unlock(hashtext('onepct:keeper'))",
        );
      holder.release();
      await database.close();
    }
  },
);
