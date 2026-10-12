import { describe, expect, it, vi } from "vitest";
import { IndexerMaintenance } from "./maintenance.js";

describe("independent indexer reconciliation", () => {
  it("counts Deck contention and respects exponential backoff despite new transactions", async () => {
    let now = 0;
    const deck = vi
      .fn()
      .mockRejectedValueOnce(new Error("deck_changed_during_read"))
      .mockRejectedValueOnce(new Error("deck_changed_during_read"))
      .mockResolvedValue(undefined);
    const accounts = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const maintenance = new IndexerMaintenance({
      confirmedSlot: async () => 100n,
      accounts,
      deck,
      accountSeconds: 300,
      deckSeconds: 600,
      retryMs: 2000,
      now: () => now,
      onFailure,
    });
    await expect(maintenance.run()).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith("deck", expect.any(Error), 1);
    now = 100;
    maintenance.request(101n);
    await maintenance.run();
    expect(deck).toHaveBeenCalledOnce();
    now = 2000;
    await maintenance.run();
    expect(onFailure).toHaveBeenLastCalledWith("deck", expect.any(Error), 2);
    now = 5999;
    await maintenance.run();
    expect(deck).toHaveBeenCalledTimes(2);
    now = 6000;
    await maintenance.run();
    expect(deck).toHaveBeenCalledTimes(3);
    expect(deck).toHaveBeenLastCalledWith(101n);
    expect(accounts).toHaveBeenCalledOnce();
  });
  it("coalesces overlapping repair requests and drains before shutdown", async () => {
    let release!: () => void;
    const accounts = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const deck = vi.fn().mockResolvedValue(undefined);
    const maintenance = new IndexerMaintenance({
      confirmedSlot: async () => 100n,
      accounts,
      deck,
      accountSeconds: 300,
      deckSeconds: 600,
      retryMs: 2000,
    });
    const first = maintenance.run();
    await vi.waitFor(() => expect(accounts).toHaveBeenCalledOnce());
    expect(maintenance.run()).toBe(first);
    const stopped = maintenance.stop();
    release();
    await stopped;
    expect(deck).not.toHaveBeenCalled();
    await maintenance.run();
    expect(accounts).toHaveBeenCalledOnce();
  });
  it("starts and reschedules on its own timer without ingestion hints", async () => {
    vi.useFakeTimers();
    try {
      const accounts = vi.fn().mockResolvedValue(undefined),
        deck = vi.fn().mockResolvedValue(undefined);
      const maintenance = new IndexerMaintenance({
        confirmedSlot: async () => 100n,
        accounts,
        deck,
        accountSeconds: 300,
        deckSeconds: 600,
        retryMs: 2000,
      });
      maintenance.start();
      await vi.advanceTimersByTimeAsync(1);
      expect(accounts).toHaveBeenCalledOnce();
      expect(deck).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(300000);
      expect(accounts).toHaveBeenCalledTimes(2);
      expect(deck).toHaveBeenCalledOnce();
      await maintenance.stop();
      await vi.advanceTimersByTimeAsync(600000);
      expect(accounts).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
