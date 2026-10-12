import { describe, expect, it, vi } from "vitest";
import { InMemoryLinkRateLimiter } from "../ratelimit.js";
import {
  CLOSED_NONCE_GRACE_MS,
  InMemoryLinkStore,
  SESSION_TTL_SECONDS,
} from "../store.js";

describe("bounded link rate counters", () => {
  it("refuses unknown clients at capacity without resetting active limits", () => {
    let now = 0;
    const limiter = new InMemoryLinkRateLimiter(() => now, 1);
    const rule = { limit: 2, windowMs: 60_000 };
    expect(limiter.consume("a", rule)).toEqual({ ok: true });
    expect(limiter.consume("b", rule)).toEqual({ ok: false, retryAfterS: 1 });
    expect(limiter.consume("a", rule)).toEqual({ ok: true });
    expect(limiter.consume("a", rule)).toEqual({ ok: false, retryAfterS: 60 });
    now = 60_000;
    expect(limiter.consume("b", rule)).toEqual({ ok: true });
  });

  it("scans once per second and expires a touched counter at its boundary", () => {
    let now = 0;
    const limiter = new InMemoryLinkRateLimiter(() => now, 1);
    const records = Reflect.get(limiter, "windows") as Map<string, unknown>;
    const scan = vi.spyOn(records, Symbol.iterator);
    const rule = { limit: 1, windowMs: 500 };
    expect(limiter.consume("a", rule)).toEqual({ ok: true });
    for (let i = 0; i < 100; i++) limiter.consume("a", rule);
    expect(scan).toHaveBeenCalledTimes(1);
    now = 500;
    expect(limiter.consume("a", rule)).toEqual({ ok: true });
    expect(scan).toHaveBeenCalledTimes(1);
    now = 1_000;
    expect(limiter.consume("b", rule)).toEqual({ ok: true });
    expect(scan).toHaveBeenCalledTimes(2);
  });
});

describe("bounded link storage", () => {
  const username = "onepercent_bot";
  const ttl = SESSION_TTL_SECONDS * 1_000;

  it("retains used and expired identifiers only through original expiry plus grace", async () => {
    let now = 0;
    const store = new InMemoryLinkStore(() => now);
    const used = await store.createNonce(1, username);
    const expired = await store.createNonce(2, username);
    now = 1_000;
    expect((await store.takeNonce(used.nonce)).status).toBe("open");
    now = ttl;
    expect((await store.peekNonce(used.nonce)).status).toBe("gone");
    expect((await store.peekNonce(expired.nonce)).status).toBe("gone");
    now = ttl + CLOSED_NONCE_GRACE_MS - 1;
    expect((await store.peekNonce(used.nonce)).status).toBe("gone");
    now++;
    expect((await store.peekNonce(used.nonce)).status).toBe("missing");
    expect((await store.peekNonce(expired.nonce)).status).toBe("missing");
  });

  it("preserves an active nonce when tracked capacity prevents replacement", async () => {
    let now = 0;
    const store = new InMemoryLinkStore(() => now, {
      liveNonces: 1,
      nonceEntries: 2,
      bindings: 1,
    });
    const first = await store.createNonce(1, username);
    const second = await store.createNonce(1, username);
    expect((await store.peekNonce(first.nonce)).status).toBe("gone");
    await expect(store.createNonce(1, username)).rejects.toThrow(
      "Link capacity reached",
    );
    await expect(store.createNonce(2, username)).rejects.toThrow(
      "Link capacity reached",
    );
    expect((await store.peekNonce(second.nonce)).status).toBe("open");
    expect((await store.takeNonce(second.nonce)).status).toBe("open");
    expect((await store.takeNonce(second.nonce)).status).toBe("gone");
    now = ttl + CLOSED_NONCE_GRACE_MS;
    await expect(store.createNonce(2, username)).resolves.toHaveProperty(
      "nonce",
    );
  });

  it("bounds bindings without evicting existing pairs and permits replacement", async () => {
    const store = new InMemoryLinkStore(() => 0, {
      liveNonces: 1,
      nonceEntries: 2,
      bindings: 1,
    });
    await store.bind(1, "wallet-a");
    await expect(store.bind(2, "wallet-b")).rejects.toThrow("capacity");
    expect(await store.walletOf(1)).toMatchObject({ wallet: "wallet-a" });
    expect(await store.telegramOf("wallet-a")).toBe(1);
    await store.bind(2, "wallet-a");
    expect(await store.walletOf(1)).toBeNull();
    expect(await store.telegramOf("wallet-a")).toBe(2);
    await store.bind(2, "wallet-b");
    expect(await store.telegramOf("wallet-a")).toBeNull();
    expect(await store.telegramOf("wallet-b")).toBe(2);
  });

  it("scans nonce records no more than once per second", async () => {
    let now = 0;
    const store = new InMemoryLinkStore(() => now);
    const open = Reflect.get(store, "open") as Map<string, unknown>;
    const closed = Reflect.get(store, "closed") as Map<string, unknown>;
    const openScan = vi.spyOn(open, Symbol.iterator);
    const closedScan = vi.spyOn(closed, Symbol.iterator);
    const session = await store.createNonce(1, username);
    for (let i = 0; i < 100; i++) await store.peekNonce(session.nonce);
    expect(openScan).toHaveBeenCalledTimes(1);
    expect(closedScan).toHaveBeenCalledTimes(1);
    now = 1_000;
    await store.peekNonce(session.nonce);
    expect(openScan).toHaveBeenCalledTimes(2);
    expect(closedScan).toHaveBeenCalledTimes(2);
  });
});
