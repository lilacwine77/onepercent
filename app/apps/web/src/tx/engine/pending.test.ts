// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Connection, SignatureStatus } from "@solana/web3.js";
import { resolvePending } from "./pending";
import { executePlan } from "./engine";
import type { EnginePort, PendingItem } from "./progress";

function fixture(signature: string | undefined = "signature") {
  const entry: PendingItem<string> = {
    item: {
      id: "feed:1",
      phase: 0,
      build: () => "transaction",
      landed: vi.fn(async () => false),
    },
    validity: { blockhash: "blockhash", lastValidBlockHeight: 100 },
    signature,
  };
  const getBlockHeight = vi.fn(async () => 101);
  const getSignatureStatuses = vi.fn(async () => ({
    context: { slot: 200 },
    value: [null as SignatureStatus | null],
  }));
  const rpc = { getBlockHeight, getSignatureStatuses } as unknown as Connection;
  return { entry, rpc, getBlockHeight, getSignatureStatuses };
}
describe("pending submission recovery", () => {
  it("retains the exact signed validity when signature tracking becomes unavailable", async () => {
    const f = fixture();
    const port: EnginePort<string> = {
      blockhash: async () => f.entry.validity,
      blockHeight: async () => 90,
      check: () => {},
      simulate: async () => {},
      send: async () => ["signature"],
      confirm: async () => {
        throw new Error("status offline");
      },
    };
    const result = await executePlan([f.entry.item], port, {
      batchSize: 1,
      current: () => true,
      progress: () => {},
    });
    expect(result.pending).toEqual([f.entry]);
    expect(result.retry).toEqual([]);
  });
  it("allows a dropped transaction to rebuild only after finalized expiry and history", async () => {
    const f = fixture();
    expect(
      (await resolvePending([f.entry], f.rpc)).retry.has(f.entry.item.id),
    ).toBe(true);
    expect(f.getBlockHeight).toHaveBeenCalledWith("finalized");
    expect(f.getSignatureStatuses).toHaveBeenCalledWith(["signature"], {
      searchTransactionHistory: true,
    });
    expect(f.getBlockHeight.mock.invocationCallOrder[0]).toBeLessThan(
      f.getSignatureStatuses.mock.invocationCallOrder[0]!,
    );
    f.getBlockHeight.mockResolvedValue(100);
    expect((await resolvePending([f.entry], f.rpc)).pending).toEqual([f.entry]);
  });
  it("retains a pending status after expiry and accepts a confirmed landing", async () => {
    const f = fixture();
    f.getSignatureStatuses.mockResolvedValue({
      context: { slot: 200 },
      value: [
        {
          slot: 200,
          confirmations: 0,
          confirmationStatus: "processed",
          err: null,
        },
      ],
    });
    expect((await resolvePending([f.entry], f.rpc)).pending).toEqual([f.entry]);
    f.getSignatureStatuses.mockResolvedValue({
      context: { slot: 200 },
      value: [
        {
          slot: 200,
          confirmations: 1,
          confirmationStatus: "confirmed",
          err: null,
        },
      ],
    });
    expect(
      (await resolvePending([f.entry], f.rpc)).landed.has(f.entry.item.id),
    ).toBe(true);
  });
  it("supports lost signature responses without treating absence as proof before expiry", async () => {
    const f = fixture();
    delete f.entry.signature;
    f.getBlockHeight.mockResolvedValue(100);
    expect((await resolvePending([f.entry], f.rpc)).pending).toEqual([f.entry]);
    f.getBlockHeight.mockResolvedValue(101);
    expect(
      (await resolvePending([f.entry], f.rpc)).retry.has(f.entry.item.id),
    ).toBe(true);
    expect(f.getSignatureStatuses).not.toHaveBeenCalled();
  });
  it("releases finalized expiry without requiring a Deck read", async () => {
    const f = fixture();
    vi.mocked(f.entry.item.landed).mockRejectedValue(new Error("offline"));
    const result = await resolvePending([f.entry], f.rpc);
    expect(result.pending).toEqual([]);
    expect([...result.retry]).toEqual([f.entry.item.id]);
    expect(f.entry.item.landed).not.toHaveBeenCalled();
    f.getSignatureStatuses.mockResolvedValue({
      context: { slot: 200 },
      value: [],
    });
    await expect(resolvePending([f.entry], f.rpc)).rejects.toThrow(
      "Incomplete",
    );
  });
  it("keeps finalized failure definitive before expiry while the Deck is active", async () => {
    const f = fixture();
    f.getBlockHeight.mockResolvedValue(99);
    vi.mocked(f.entry.item.landed).mockRejectedValue(
      new Error("Deck entry absence unavailable"),
    );
    f.getSignatureStatuses.mockResolvedValue({
      context: { slot: 200 },
      value: [
        {
          slot: 200,
          confirmations: null,
          confirmationStatus: "finalized",
          err: { InstructionError: [2, { Custom: 6025 }] },
        },
      ],
    });
    const result = await resolvePending([f.entry], f.rpc);
    expect(result.pending).toEqual([]);
    expect([...result.retry]).toEqual([f.entry.item.id]);
    expect(result.landed.size).toBe(0);
    expect(f.entry.item.landed).not.toHaveBeenCalled();
  });
});
