import "../../link/tests/setup.js";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../app.js";
import { InMemoryLinkRateLimiter } from "../../link/ratelimit.js";
import { InMemoryGoStore } from "../store.js";
import { goTarget, type GoInput } from "../schema.js";
const origin = "https://onepercent.test";
const secret = "offline-go-secret";
function harness() {
  let now = Date.parse("2026-10-08T12:00:00Z");
  const logger = { info: vi.fn() };
  const app = createApi(
    {
      WEB_ORIGIN: origin,
      APP_VERSION: "test",
      GIT_COMMIT: "offline",
      BOT_API_SECRET: secret,
    },
    {
      clock: () => now,
      linkRateLimiter: new InMemoryLinkRateLimiter(() => now),
      goStore: new InMemoryGoStore(),
      logger,
    },
  );
  const post = (
    path: string,
    body: unknown,
    authorization: string | undefined = `Bearer ${secret}`,
    requestOrigin = origin,
  ) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: requestOrigin,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
    });
  const create = (
    body: unknown = { telegramUserId: 1, action: "feed", count: 2 },
  ) => post("/api/go", body);
  return {
    app,
    post,
    create,
    logger,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("single-use browser sessions", () => {
  it("requires a configured bearer and a strict request", async () => {
    const h = harness();
    expect((await h.post("/api/go", {}, "bad")).status).toBe(401);
    const off = createApi(
      { WEB_ORIGIN: origin, APP_VERSION: "test", GIT_COMMIT: "offline" },
      { logger: { info: vi.fn() } },
    );
    expect(
      (await off.request("/api/go", { method: "POST", body: "{}" })).status,
    ).toBe(503);
    for (const change of [
      { telegramUserId: 0 },
      { telegramUserId: "1" },
      { action: "other" },
      { count: 0 },
      { count: 4 },
      { action: "feed", edition: "original" },
      { action: "rip", n: 2 },
      { action: "rip", edition: "after_hours", n: 6 },
      { action: "rip", edition: "original", n: 11 },
      { action: "rip", edition: "unknown" },
      { ref: "bad-ref" },
      { extra: true },
    ]) {
      expect(
        (
          await h.create({
            telegramUserId: 1,
            action: "feed",
            count: 2,
            ...change,
          })
        ).status,
      ).toBe(400);
    }
    for (const count of [1, 2, 3]) {
      const result = await h.create({
        telegramUserId: count,
        action: "rip",
        edition: "after_hours",
        n: 5,
        count,
      });
      expect(result.status).toBe(201);
      const body = await result.json();
      expect(body.sessions).toHaveLength(count);
      expect(
        new Set(body.sessions.map((entry: { id: string }) => entry.id)).size,
      ).toBe(count);
      expect(body.sessions[0]).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{32}$/),
        expiresAt: "2026-10-08T12:10:00.000Z",
      });
    }
  });
  it("allows one of ten concurrent POST redeems; GET never consumes", async () => {
    const h = harness();
    const { sessions } = await (await h.create()).json();
    const id = sessions[0].id;
    expect((await h.app.request(`/api/go/redeem?id=${id}`)).status).toBe(404);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => h.post("/api/go/redeem", { id })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      200,
      ...Array<number>(9).fill(410),
    ]);
    expect(await results.find((r) => r.status === 200)!.json()).toEqual({
      target: "/feed",
    });
    expect(
      (await h.post("/api/go/redeem", { id: sessions[1].id })).status,
    ).toBe(200);
  });
  it("retains used and expired ids for grace then answers 404", async () => {
    const h = harness();
    const { sessions } = await (await h.create()).json();
    h.advance(601_000);
    expect(
      (await h.post("/api/go/redeem", { id: sessions[0].id })).status,
    ).toBe(410);
    h.advance(60_000);
    expect(
      (await h.post("/api/go/redeem", { id: sessions[0].id })).status,
    ).toBe(404);
    expect(
      (await h.post("/api/go/redeem", { id: "f".repeat(32) })).status,
    ).toBe(404);
  });
  it("counts ids, limits public redeems and pins retry headers", async () => {
    const h = harness();
    for (let n = 0; n < 10; n++)
      expect(
        (await h.create({ telegramUserId: 1, action: "feed", count: 3 }))
          .status,
      ).toBe(201);
    const create = await h.create();
    expect(create.status).toBe(429);
    expect(create.headers.get("Retry-After")).toBe("600");
    for (let n = 0; n < 30; n++)
      expect(
        (await h.post("/api/go/redeem", { id: "f".repeat(32) })).status,
      ).toBe(404);
    const redeem = await h.post("/api/go/redeem", { id: "f".repeat(32) });
    expect(redeem.status).toBe(429);
    expect(redeem.headers.get("Retry-After")).toBe("60");
  });
  it("keeps restricted CORS, no-store and logs without identifiers", async () => {
    const h = harness();
    const response = await h.create({
      telegramUserId: 918273,
      action: "feed",
      ref: "unique_alias",
      count: 1,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    const { sessions } = await response.json();
    const redeemed = await h.post("/api/go/redeem", { id: sessions[0].id });
    expect(await redeemed.json()).toEqual({ target: "/feed?ref=unique_alias" });
    expect(redeemed.headers.get("Cache-Control")).toBe("no-store");
    const denied = await h.post(
      "/api/go/redeem",
      { id: sessions[0].id },
      undefined,
      "https://external.test",
    );
    expect(denied.headers.has("Access-Control-Allow-Origin")).toBe(false);
    const logs = JSON.stringify(h.logger.info.mock.calls);
    for (const value of [sessions[0].id, "unique_alias", "918273", "/feed"])
      expect(logs).not.toContain(value);
  });
});
it("pins every allowed target combination and query order", () => {
  const user = { telegramUserId: 1 };
  expect(goTarget({ ...user, action: "feed" })).toBe("/feed");
  expect(goTarget({ ...user, action: "feed", ref: "alice" })).toBe(
    "/feed?ref=alice",
  );
  expect(goTarget({ ...user, action: "cards", ref: "alice" })).toBe("/cards");
  for (const edition of [
    undefined,
    "original",
    "blue_shift",
    "signature",
    "after_hours",
  ] as const) {
    for (const n of edition ? [undefined, 1, 5] : [undefined])
      for (const ref of [undefined, "alice"]) {
        const input: GoInput = { ...user, action: "rip", edition, n, ref };
        const entries = [
          edition && `edition=${edition}`,
          n && `n=${n}`,
          ref && `ref=${ref}`,
        ].filter(Boolean);
        expect(goTarget(input)).toBe(
          `/rip${entries.length ? `?${entries.join("&")}` : ""}`,
        );
      }
  }
});
