import "./setup.js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRedis, SlidingWindowLimiter } from "@onepercent/service-kit";
import { SERVICES } from "@onepercent/config";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApi } from "../../app.js";
import { RedisLinkRateLimiter } from "../../link/ratelimit.js";
const enabled = process.env.SERVICES_INTEGRATION === "1";
const redisUrl = process.env.TEST_REDIS_URL;
if (
  enabled &&
  (!redisUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(redisUrl).hostname))
)
  throw new Error("Redis integration requires a local TEST_REDIS_URL");
const result = XrayResultSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../__fixtures__/xray-result.json", import.meta.url),
      "utf8",
    ),
  ),
);
describe.skipIf(!enabled)("M5 shared Redis limiters", () => {
  const redis = createRedis(redisUrl ?? "redis://127.0.0.1:6379", {
    connectTimeout: SERVICES.transport.redisCommandTimeoutMs,
    commandTimeout: SERVICES.transport.redisCommandTimeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
  });
  const salt = randomBytes(32).toString("hex");
  const user = Number.parseInt(randomBytes(6).toString("hex"), 16);
  const apps = Array.from({ length: 2 }, () =>
    createApi(
      {
        WEB_ORIGIN: "https://onepercent.test",
        APP_VERSION: "test",
        GIT_COMMIT: "offline",
        BOT_API_SECRET: "test",
      },
      {
        logger: { info: vi.fn() },
        ipSalt: salt,
        blinksXray: true,
        xrayPort: { get: async () => result },
        linkRateLimiter: new RedisLinkRateLimiter(
          new SlidingWindowLimiter(redis),
        ),
      },
    ),
  );
  const post = (i: number, path: string, body: unknown) =>
    apps[i % 2]!.request(path, {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  beforeAll(async () => {
    await redis.connect();
  });
  afterAll(() => redis.disconnect());
  it("shares link, go id, redeem, X-ray and POST limits across replicas", async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await post(i, "/api/link/nonce", {
            telegramUserId: user,
            botUsername: "test_bot",
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await post(1, "/api/link/nonce", {
          telegramUserId: user,
          botUsername: "test_bot",
        })
      ).status,
    ).toBe(429);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await post(i, "/api/go", {
            telegramUserId: user,
            action: "feed",
            count: 3,
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await post(0, "/api/go", {
          telegramUserId: user,
          action: "feed",
          count: 1,
        })
      ).status,
    ).toBe(429);
    for (let i = 0; i < 30; i++)
      expect(
        (await post(i, "/api/go/redeem", { id: "f".repeat(32) })).status,
      ).toBe(404);
    expect(
      (await post(1, "/api/go/redeem", { id: "f".repeat(32) })).status,
    ).toBe(429);
    for (let i = 0; i < 60; i++)
      expect(
        (
          await apps[i % 2]!.request(
            `/api/actions/xray/${result.address}?ref=test_${i}`,
          )
        ).status,
      ).toBe(200);
    expect(
      (await apps[0]!.request(`/api/actions/xray/${result.address}?ref=extra`))
        .status,
    ).toBe(429);
    for (let i = 0; i < 120; i++)
      expect((await post(i, "/api/actions/xray", {})).status).toBe(400);
    expect((await post(1, "/api/actions/xray", {})).status).toBe(429);
  });
});
