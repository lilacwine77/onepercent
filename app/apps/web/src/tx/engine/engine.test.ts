import "../../test/setup";
import { describe, expect, it, vi } from "vitest";
import { executePlan } from "./engine";
import { EngineError } from "./errors";
import type { EnginePort, PlanItem } from "./progress";
function harness() {
  let height = 0;
  const port: EnginePort<string> = {
    blockhash: vi.fn(async () => ({
      blockhash: String(++height),
      lastValidBlockHeight: height + 150,
    })),
    blockHeight: vi.fn(async () => height),
    check: vi.fn(),
    simulate: vi.fn(async () => {}),
    send: vi.fn(async (values: readonly string[]) =>
      values.map((value) => `sig-${value}`),
    ),
    confirm: vi.fn(async () => "confirmed" as const),
  };
  const item = (id: string, phase = 0): PlanItem<string> => ({
    id,
    phase,
    build: (hash) => `${id}-${hash.blockhash}`,
    landed: vi.fn(async () => false),
  });
  return {
    port,
    item,
    options: { batchSize: 8, current: () => true, progress: vi.fn() },
  };
}
describe("transaction engine core", () => {
  it("simulation failure cannot reach a wallet prompt", async () => {
    const h = harness();
    vi.mocked(h.port.simulate).mockRejectedValue(
      new EngineError("errors.simulation"),
    );
    expect((await executePlan([h.item("a")], h.port, h.options)).phase).toBe(
      "failed",
    );
    expect(h.port.send).not.toHaveBeenCalled();
  });
  it("gets a fresh blockhash and waits for earlier phases to land", async () => {
    const h = harness();
    const result = await executePlan(
      [h.item("merge"), h.item("feed", 1)],
      h.port,
      h.options,
    );
    expect(result.phase).toBe("done");
    expect(vi.mocked(h.port.send).mock.calls.map((call) => call[0])).toEqual([
      ["merge-2"],
      ["feed-4"],
    ]);
  });
  it("expired partial batch reconciles and retries only proven unlanded items", async () => {
    const h = harness();
    const a = h.item("a");
    const b = h.item("b");
    vi.mocked(h.port.confirm)
      .mockResolvedValueOnce("confirmed")
      .mockResolvedValueOnce("expired");
    const result = await executePlan([a, b], h.port, h.options);
    expect(result.phase).toBe("partial");
    expect(result.retry.map((item) => item.id)).toEqual(["b"]);
    expect(result.landed.has("a")).toBe(true);
  });
  it("unknown chain reconciliation never authorizes a retry", async () => {
    const h = harness();
    const a = h.item("a");
    vi.mocked(a.landed).mockRejectedValue(new Error("offline"));
    vi.mocked(h.port.send).mockRejectedValue(new Error("lost transport"));
    const result = await executePlan([a], h.port, h.options);
    expect(result.retry).toEqual([]);
    expect(result.unknown.has("a")).toBe(true);
  });
  it("preserves a finalized CardMoved for the bounded take-back rebuild", async () => {
    const h = harness();
    const item = h.item("a");
    vi.mocked(item.landed).mockRejectedValue(
      new Error("Deck entry absence unavailable"),
    );
    vi.mocked(h.port.confirm).mockResolvedValue({
      status: "failed",
      error: new EngineError("errors.cardMoved"),
    });
    const result = await executePlan([item], h.port, h.options);
    expect(result.phase).toBe("failed");
    expect(result.copyKey).toBe("errors.cardMoved");
    expect(result.retry).toEqual([item]);
    expect(result.unknown.size).toBe(0);
    expect(result.pending).toEqual([]);
    expect(item.landed).not.toHaveBeenCalled();
  });
  it("keeps finalized expiry terminal even when state reads fail", async () => {
    const h = harness();
    const item = h.item("expired");
    vi.mocked(item.landed).mockRejectedValue(new Error("Deck changed"));
    vi.mocked(h.port.confirm).mockResolvedValue("expired");
    const result = await executePlan([item], h.port, h.options);
    expect(result.phase).toBe("expired");
    expect(result.retry).toEqual([item]);
    expect(result.unknown.size).toBe(0);
    expect(result.pending).toEqual([]);
    expect(item.landed).not.toHaveBeenCalled();
  });
  it("does not authorize a CardMoved rebuild while another signature is ambiguous", async () => {
    const h = harness();
    const first = h.item("a");
    const second = h.item("b");
    vi.mocked(h.port.confirm)
      .mockResolvedValueOnce({
        status: "failed",
        error: new EngineError("errors.cardMoved"),
      })
      .mockRejectedValueOnce(new Error("offline"));
    const result = await executePlan([first, second], h.port, h.options);
    expect(result.copyKey).toBe("errors.cardMoved");
    expect([...result.unknown]).toEqual(["b"]);
    expect(result.pending.map((entry) => entry.item.id)).toEqual(["b"]);
  });
  it("wallet switch before prompt cancels the stale plan", async () => {
    const h = harness();
    let current = true;
    vi.mocked(h.port.simulate).mockImplementation(async () => {
      current = false;
    });
    await executePlan([h.item("a")], h.port, {
      ...h.options,
      current: () => current,
    });
    expect(h.port.send).not.toHaveBeenCalled();
  });
});
