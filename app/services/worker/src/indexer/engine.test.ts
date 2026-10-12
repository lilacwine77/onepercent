import { describe, expect, it, vi } from "vitest";
import { RpcError } from "@onepercent/service-kit";
import { IndexerEngine, type EngineStore, type Reconciler } from "./engine.js";
import type { TxSource } from "./source.js";
import type { IndexedTransaction } from "./store.js";
function setup() {
  const tx: IndexedTransaction = {
    signature: "confirmed",
    slot: 20n,
    txIndex: 0n,
    blockTime: 1000,
    err: null,
    truncated: false,
    events: [],
    instructions: [],
    accountKeys: ["touched"],
  };
  const source: TxSource = {
    confirmedSlot: vi.fn(async () => 20n),
    finalizedSlot: vi.fn(async () => 10n),
    transactions: vi.fn(async () => [tx]),
    canonical: vi.fn(async () => true),
    blockTime: vi.fn(async () => 1000),
  };
  const store: EngineStore = {
    cursor: vi.fn(async () => null),
    apply: vi.fn(async () => true),
    recordUnprocessable: vi.fn(async () => undefined),
    advanceCursor: vi.fn(async () => undefined),
    pendingFinality: vi.fn(async () => []),
    finalize: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  };
  const reconciler: Reconciler = {
    reconcile: vi.fn(async () => undefined),
    reconcileDeck: vi.fn(async () => undefined),
  };
  const onNodeLag = vi.fn(async () => undefined);
  const publish = vi.fn(async () => undefined),
    status = vi.fn(async () => undefined);
  const engine = new IndexerEngine({
    source,
    store,
    programId: "11111111111111111111111111111111",
    reconciler,
    publish,
    status,
    onNodeLag,
    accountReconcileSeconds: 300,
    deckReconcileSeconds: 600,
  });
  return { tx, source, store, reconciler, publish, status, onNodeLag, engine };
}
describe("indexer orchestration", () => {
  it.each([-32004, -32016, -32007, -32009])(
    "defers exhausted node lag %s with the same cursor and no quarantined data",
    async (code) => {
      const x = setup();
      const failure = new RpcError(code);
      vi.mocked(x.source.transactions).mockRejectedValueOnce(failure);
      await expect(x.engine.poll()).resolves.toBeUndefined();
      expect(x.onNodeLag).toHaveBeenCalledExactlyOnceWith(failure);
      expect(x.store.advanceCursor).not.toHaveBeenCalled();
      expect(x.store.recordUnprocessable).not.toHaveBeenCalled();
      expect(x.store.apply).not.toHaveBeenCalled();
      expect(x.status).not.toHaveBeenCalled();
      await x.engine.poll();
      expect(x.source.transactions).toHaveBeenNthCalledWith(
        2,
        null,
        20n,
        expect.any(AbortSignal),
      );
      expect(x.store.apply).toHaveBeenCalledExactlyOnceWith(x.tx);
      expect(x.store.advanceCursor).toHaveBeenCalledExactlyOnceWith(
        x.tx.signature,
        x.tx.slot,
      );
    },
  );
  it("defers finality lag without deleting a previously confirmed transaction", async () => {
    const x = setup();
    vi.mocked(x.store.pendingFinality).mockResolvedValue([
      { signature: "known", slot: 9n, txIndex: 0n },
    ]);
    vi.mocked(x.source.canonical).mockRejectedValueOnce(new RpcError(-32004));
    await expect(x.engine.poll()).resolves.toBeUndefined();
    expect(x.store.finalize).not.toHaveBeenCalled();
    expect(x.store.rollback).not.toHaveBeenCalled();
    expect(x.store.advanceCursor).not.toHaveBeenCalled();
    await x.engine.poll();
    expect(x.store.finalize).toHaveBeenCalledExactlyOnceWith("known");
  });
  it("keeps account repair pending after a committed cursor and node lag", async () => {
    const x = setup();
    vi.mocked(x.reconciler.reconcile).mockRejectedValueOnce(
      new RpcError(-32016),
    );
    await expect(x.engine.poll()).resolves.toBeUndefined();
    expect(x.store.advanceCursor).toHaveBeenCalledExactlyOnceWith(
      "confirmed",
      20n,
    );
    expect(x.publish).not.toHaveBeenCalled();
    vi.mocked(x.source.transactions).mockResolvedValue([]);
    await x.engine.poll();
    expect(x.reconciler.reconcile).toHaveBeenCalledTimes(2);
    expect(x.publish).toHaveBeenCalledOnce();
  });
  it("retries malformed RPC account responses without quarantining their transaction", async () => {
    const x = setup();
    const failure = Object.assign(new Error("invalid_rpc_account_response"), {
      name: "ZodError",
    });
    x.reconciler.recoverPullNonces = vi.fn().mockRejectedValue(failure);
    await expect(x.engine.poll()).rejects.toBe(failure);
    expect(x.store.apply).not.toHaveBeenCalled();
    expect(x.store.recordUnprocessable).not.toHaveBeenCalled();
    expect(x.store.advanceCursor).not.toHaveBeenCalled();
  });
  it("commits before publication and records a checked scan watermark", async () => {
    const x = setup();
    await x.engine.poll();
    expect(vi.mocked(x.store.apply).mock.invocationCallOrder[0]).toBeLessThan(
      x.publish.mock.invocationCallOrder[0]!,
    );
    expect(x.status).toHaveBeenCalledWith(20n, 20n, 20n);
  });
  it("samples the confirmed tip again after ingestion instead of reporting zero scan lag", async () => {
    const x = setup();
    vi.mocked(x.source.confirmedSlot)
      .mockResolvedValueOnce(20n)
      .mockResolvedValueOnce(30n);
    await x.engine.poll();
    expect(x.status).toHaveBeenCalledWith(30n, 20n, 20n);
  });
  it("defers full and Deck repair on truncation even on a commit/cursor retry", async () => {
    const x = setup();
    x.tx.truncated = true;
    vi.mocked(x.store.apply).mockResolvedValue(false);
    await x.engine.poll();
    expect(x.reconciler.reconcile).toHaveBeenCalledWith([], 20n);
    expect(x.reconciler.reconcileDeck).not.toHaveBeenCalled();
    await x.engine.maintenance.run();
    expect(x.reconciler.reconcileDeck).toHaveBeenCalledWith(20n);
  });
  it("rolls back only after a canonical finalized block says the transaction is absent", async () => {
    const x = setup();
    vi.mocked(x.store.pendingFinality).mockResolvedValue([
      { signature: "orphan", slot: 9n, txIndex: 0n },
    ]);
    vi.mocked(x.source.canonical).mockResolvedValue(false);
    await x.engine.poll();
    expect(x.store.rollback).toHaveBeenCalledWith("orphan");
    expect(x.store.finalize).not.toHaveBeenCalled();
    expect(
      vi.mocked(x.store.rollback).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(x.source.transactions).mock.invocationCallOrder[0]!,
    );
  });
  it("a finality provider outage does not delete or publish anything", async () => {
    const x = setup();
    vi.mocked(x.store.pendingFinality).mockResolvedValue([
      { signature: "known", slot: 9n, txIndex: 0n },
    ]);
    vi.mocked(x.source.canonical).mockRejectedValue(new Error("unavailable"));
    await expect(x.engine.poll()).rejects.toThrow();
    expect(x.store.rollback).not.toHaveBeenCalled();
    expect(x.publish).not.toHaveBeenCalled();
  });
  it("retries publication after a crash without requiring a new transaction", async () => {
    const x = setup();
    x.publish.mockRejectedValueOnce(new Error("redis"));
    await expect(x.engine.poll()).rejects.toThrow();
    vi.mocked(x.source.transactions).mockResolvedValue([]);
    await x.engine.poll();
    expect(x.publish).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent poll hints and stops before another write", async () => {
    const x = setup();
    let release: () => void = () => {};
    vi.mocked(x.source.transactions).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([x.tx]);
        }),
    );
    const first = x.engine.poll();
    await vi.waitFor(() =>
      expect(x.source.transactions).toHaveBeenCalledOnce(),
    );
    const second = x.engine.poll();
    const stop = x.engine.stop();
    release();
    await Promise.allSettled([first, second, stop]);
    expect(x.store.apply).not.toHaveBeenCalled();
    await x.engine.poll();
    expect(x.source.transactions).toHaveBeenCalledOnce();
  });
  it("retains touched-account repair work after the cursor advanced and a read failed", async () => {
    const x = setup();
    await x.engine.poll();
    x.tx.signature = "second";
    vi.mocked(x.reconciler.reconcile).mockRejectedValueOnce(
      new Error("read_failed"),
    );
    await expect(x.engine.poll()).rejects.toThrow("read_failed");
    expect(x.store.advanceCursor).toHaveBeenLastCalledWith("second", 20n);
    vi.mocked(x.source.transactions).mockResolvedValue([]);
    const publishedBefore = x.publish.mock.calls.length;
    await x.engine.poll();
    expect(x.reconciler.reconcile).toHaveBeenLastCalledWith([], 20n);
    expect(x.publish.mock.calls.length).toBe(publishedBefore + 1);
  });
});
