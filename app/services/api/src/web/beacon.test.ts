import { SERVICES } from "@onepercent/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const connection = vi.hoisted(() => ({ createRedis: vi.fn() }));
vi.mock("@onepercent/service-kit", async (original) => ({
  ...(await original<typeof import("@onepercent/service-kit")>()),
  createRedis: connection.createRedis,
}));
import { BeaconCounters, RedisCounterStore } from "./beacon.js";
function client() {
  const fake = {
    connect: vi.fn(async () => undefined),
    hincrby: vi.fn(async () => 1),
    disconnect: vi.fn(),
    on: vi.fn(),
  };
  connection.createRedis.mockReturnValue(fake);
  return fake;
}
beforeEach(() => vi.clearAllMocks());
describe("Redis analytics counter", () => {
  it("uses the service transport timeouts and writes only a bounded hourly counter", async () => {
    const fake = client();
    await new BeaconCounters(
      new RedisCounterStore("redis://user:pass@redis.test/2"),
      () => Date.UTC(2026, 9, 8, 12),
    ).record({ event: "page_view", route: "home" });
    expect(connection.createRedis).toHaveBeenCalledWith(
      "redis://user:pass@redis.test/2",
      {
        connectTimeout: SERVICES.transport.redisCommandTimeoutMs,
        commandTimeout: SERVICES.transport.redisCommandTimeoutMs,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: expect.any(Function),
      },
    );
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.hincrby).toHaveBeenCalledWith(
      "onepct:web:hour:2026-10-08T12",
      "event=page_view:route=home",
      1,
    );
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });
  it.each(["connect", "hincrby"] as const)(
    "reports %s failures without input and always disconnects",
    async (method) => {
      const fake = client();
      fake[method].mockRejectedValue(
        new Error("redis://user:secret@redis.test/2"),
      );
      await expect(
        new RedisCounterStore("redis://redis.test").increment(
          "2026-10-08T12",
          "page_view",
        ),
      ).rejects.toThrow(/^Analytics store unavailable$/);
      expect(fake.disconnect).toHaveBeenCalledTimes(1);
    },
  );
  it("logs a safe cause for Redis error events", async () => {
    const fake = client();
    const logger = { warn: vi.fn() };
    await new RedisCounterStore("redis://redis.test", logger).increment(
      "2026-10-08T12",
      "page_view",
    );
    const onError = fake.on.mock.calls[0]?.[1] as unknown as (
      error: Error,
    ) => void;
    onError(
      new Error("connection failed https://redis.test/private?api-key=secret"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      {
        reason: "redis_unavailable",
        cause: { code: "Error", detail: "connection failed <redacted>" },
      },
      "Web analytics unavailable",
    );
  });
  it("rejects invalid Redis URLs without echoing input", () => {
    for (const url of [
      "bad secret input",
      "https://redis.test/0",
      "redis://redis.test/private",
    ])
      expect(() => new RedisCounterStore(url)).toThrow(/^Invalid REDIS_URL$/);
  });
});
