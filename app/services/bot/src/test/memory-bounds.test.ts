import { describe, expect, it, vi } from "vitest";
import { ExpiringMap } from "../memory.js";
import { InMemoryRateLimiter, type Clock } from "../ratelimit.js";
import { parseReferral } from "../referral.js";
import { InMemoryBotStore } from "../store.js";
import { createNotificationSender } from "../notify/sender.js";

class TestClock implements Clock {
  value = 0;
  now = () => this.value;
  sleep = async (ms: number) => {
    this.value += ms;
  };
}

describe("bounded bot memory", () => {
  it("refuses new entries without evicting active records", () => {
    const clock = new TestClock();
    const entries = new ExpiringMap<string, number>(clock.now, 2);
    expect(entries.set("a", 1, 10_000)).toBe(true);
    expect(entries.set("b", 2, 10_000)).toBe(true);
    expect(entries.set("c", 3, 10_000)).toBe(false);
    expect(entries.get("a")).toBe(1);
    expect(entries.set("a", 4, 10_000)).toBe(true);
    expect(entries.get("a")).toBe(4);
    clock.value = 10_000;
    expect(entries.set("c", 3, 20_000)).toBe(true);
    expect(entries.get("a")).toBeUndefined();
  });

  it("scans at most once per second while touched entries expire exactly", () => {
    const clock = new TestClock();
    const entries = new ExpiringMap<string, number>(clock.now, 2);
    const records = Reflect.get(entries, "entries") as Map<string, unknown>;
    const scan = vi.spyOn(records, Symbol.iterator);
    entries.set("a", 1, 500);
    for (let i = 0; i < 100; i++) entries.get("a");
    expect(scan).toHaveBeenCalledTimes(1);
    clock.value = 500;
    expect(entries.get("a")).toBeUndefined();
    expect(scan).toHaveBeenCalledTimes(1);
    clock.value = 1_000;
    entries.get("unknown");
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("keeps rate windows intact at capacity and resumes after expiry", () => {
    const clock = new TestClock();
    const limiter = new InMemoryRateLimiter(clock, 1);
    const rule = { name: "test", limit: 2, windowMs: 60_000 };
    expect(limiter.consume("a", rule)).toEqual({ ok: true });
    expect(limiter.consume("b", rule)).toEqual({ ok: false, retryAfterS: 1 });
    expect(limiter.consume("a", rule)).toEqual({ ok: true });
    expect(limiter.consume("a", rule)).toEqual({ ok: false, retryAfterS: 60 });
    clock.value = 60_000;
    expect(limiter.consume("b", rule)).toEqual({ ok: true });
  });

  it("preserves the first referral when storage fills", async () => {
    const store = new InMemoryBotStore(1);
    const first = parseReferral("ref_first")!;
    const second = parseReferral("ref_second")!;
    expect(await store.setPendingReferral(1, first)).toBe(true);
    await expect(store.setPendingReferral(2, second)).rejects.toThrow(
      "Bot storage capacity reached",
    );
    expect(await store.setPendingReferral(1, second)).toBe(false);
    expect(await store.getPendingReferral(1)).toBe(first);
    expect(await store.getPendingReferral(2)).toBeNull();
  });

  it("bounds subscriptions and frees opt-outs without blocking them", async () => {
    const store = new InMemoryBotStore(1);
    await store.recordStart(1, 1);
    await store.setAlerts(1, "live");
    await store.setGroupHits(-1, true);
    await expect(store.recordStart(2, 2)).rejects.toThrow("capacity");
    await expect(store.setAlerts(2, "live")).rejects.toThrow("capacity");
    await expect(store.setGroupHits(-2, true)).rejects.toThrow("capacity");
    await store.setAlerts(999, "off");
    await store.setGroupHits(-999, false);
    await store.markBlocked(1);
    expect(await store.hasStarted(1)).toBe(false);
    expect(await store.getAlerts(1)).toBe("off");
    await store.recordStart(2, 2);
    await store.setAlerts(2, "live");
    await store.setGroupHits(-1, false);
    await store.setGroupHits(-2, true);
    expect(await store.getGroupHits(-1)).toBe(false);
    expect(await store.getGroupHits(-2)).toBe(true);
  });
});

describe("bounded notification state", () => {
  const royalty = {
    wallet: "11111111111111111111111111111111",
    ticker: "COIN",
    lamports: 1n,
  };
  const hit = {
    tier: "holo" as const,
    buyer: royalty.wallet,
    edition: "original" as const,
    stockedLamports: 1n,
  };

  it("rejects a full pending queue and releases capacity after delivery", async () => {
    const clock = new TestClock();
    const store = new InMemoryBotStore();
    await store.recordStart(1, 1);
    await store.setAlerts(1, "live");
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const api = { sendMessage: vi.fn(async () => pending) };
    const sender = createNotificationSender({
      api,
      store,
      clock,
      webUrl: "https://onepercent.test",
      maxEntries: 2,
    });
    const first = sender.royalty(1, royalty);
    const second = sender.royalty(1, royalty);
    expect(await sender.royalty(1, royalty)).toBe("failed");
    finish();
    expect(await Promise.all([first, second])).toEqual(["sent", "sent"]);
    expect(await sender.royalty(1, royalty)).toBe("sent");
    expect(api.sendMessage).toHaveBeenCalledTimes(3);
  });

  it("retains active group limits at capacity and retires them after a minute", async () => {
    const clock = new TestClock();
    const store = new InMemoryBotStore();
    await store.setGroupHits(-1, true);
    await store.setGroupHits(-2, true);
    const api = { sendMessage: vi.fn(async () => undefined) };
    const sender = createNotificationSender({
      api,
      store,
      clock,
      webUrl: "https://onepercent.test",
      maxEntries: 1,
    });
    expect(await sender.hit(-1, hit)).toBe("sent");
    clock.value = 1_000;
    expect(await sender.hit(-2, hit)).toBe("failed");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    clock.value = 60_000;
    expect(await sender.hit(-2, hit)).toBe("sent");
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });
});
