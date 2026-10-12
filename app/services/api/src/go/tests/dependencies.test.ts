import "../../link/tests/setup.js";
import { afterEach, expect, it, vi } from "vitest";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { PgLinkStore } from "../../link/store-pg.js";
import { RedisLinkRateLimiter } from "../../link/ratelimit.js";
import { PgGoStore } from "../store-pg.js";
import { createM5Dependencies } from "../dependencies.js";
afterEach(() => vi.useRealTimers());
it("selects persistent stores, shared quotas and exact flags with private runtime configuration", async () => {
  vi.useFakeTimers();
  let now = Date.parse("2026-10-08T12:00:00Z");
  const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
  const stop = vi.fn(async () => undefined);
  const runtime = {
    pool: { query },
    redis: {},
    stop,
    env: { CLUSTER: "devnet", LOG_IP_SALT: "test-salt" },
    logger: { warn: vi.fn() },
  } as unknown as ServiceRuntime;
  const deps = createM5Dependencies(
    runtime,
    { FLAG_BLINKS_XRAY: "on" },
    () => now,
  );
  expect(deps.linkStore).toBeInstanceOf(PgLinkStore);
  expect(deps.goStore).toBeInstanceOf(PgGoStore);
  expect(deps.linkRateLimiter).toBeInstanceOf(RedisLinkRateLimiter);
  expect(deps.cluster).toBe("devnet");
  expect(deps.ipSalt).toBe("test-salt");
  expect(deps.blinksXray).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(query).toHaveBeenCalledTimes(2);
  for (const call of query.mock.calls as unknown as [string, unknown[]][])
    expect(call[1][1]).toEqual(new Date(now));
  now += 3_600_000;
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(query).toHaveBeenCalledTimes(4);
  for (const call of query.mock.calls.slice(2) as unknown as [
    string,
    unknown[],
  ][])
    expect(call[1][1]).toEqual(new Date(now));
  await runtime.stop();
  expect(stop).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(query).toHaveBeenCalledTimes(4);
});
it.each([undefined, "true", "off"])(
  "leaves the X-ray flag off for %s",
  async (flag) => {
    const runtime = {
      pool: { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) },
      redis: {},
      stop: vi.fn(async () => undefined),
      env: { CLUSTER: "mainnet-beta", LOG_IP_SALT: "test-salt" },
      logger: { warn: vi.fn() },
    } as unknown as ServiceRuntime;
    expect(
      createM5Dependencies(runtime, { FLAG_BLINKS_XRAY: flag }).blinksXray,
    ).toBe(false);
    await runtime.stop();
  },
);
