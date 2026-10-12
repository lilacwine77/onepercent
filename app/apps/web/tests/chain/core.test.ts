import { describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/tx/engine/engine";
import { EngineError, SubmittedBatchError } from "../../src/tx/engine/errors";
import type { EnginePort, PlanItem } from "../../src/tx/engine/progress";

function harness() {
  const seen: string[] = [];
  let hash = 0;
  const port: EnginePort<string> = {
    blockhash: vi.fn(async () => ({
      blockhash: `${++hash}`,
      lastValidBlockHeight: 150,
    })),
    blockHeight: vi.fn(async () => 100),
    check: vi.fn(),
    simulate: vi.fn(async () => undefined),
    send: vi.fn(async (values: readonly string[]) =>
      values.map((value) => `sig-${value}`),
    ),
    confirm: vi.fn(async (signature) => {
      seen.push(signature);
      return "confirmed" as const;
    }),
  };
  const item = (id: string, phase = 0): PlanItem<string> => ({
    id,
    phase,
    build: vi.fn((blockhash) => `${id}:${blockhash.blockhash}`),
    landed: vi.fn(async () => false),
  });
  return {
    port,
    item,
    seen,
    options: { batchSize: 8, current: () => true, progress: vi.fn() },
  };
}

describe("Node transaction engine safety", () => {
  it("rejects duplicate IDs and invalid phases before any prompt", async () => {
    for (const plan of [
      [
        { id: "same", phase: 0 },
        { id: "same", phase: 1 },
      ],
      [{ id: "bad", phase: NaN }],
    ]) {
      const h = harness();
      const result = await executePlan(
        plan.map(({ id, phase }) => h.item(id, phase)),
        h.port,
        h.options,
      );
      expect(result.phase).toBe("failed");
      expect(h.port.send).not.toHaveBeenCalled();
    }
  });
  it("simulates rebuilt messages and rejects a builder changing after the fresh hash", async () => {
    const h = harness();
    vi.mocked(h.port.simulate)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new EngineError("errors.simulation"));
    const result = await executePlan([h.item("a")], h.port, h.options);
    expect(h.port.simulate).toHaveBeenNthCalledWith(1, "a:1");
    expect(h.port.simulate).toHaveBeenNthCalledWith(2, "a:2");
    expect(result.copyKey).toBe("errors.simulation");
    expect(h.port.send).not.toHaveBeenCalled();
  });
  it("rejects an expired final blockhash before opening the wallet; equality is valid", async () => {
    const h = harness();
    vi.mocked(h.port.blockHeight).mockResolvedValue(151);
    const expired = await executePlan([h.item("a")], h.port, h.options);
    expect(expired.phase).toBe("expired");
    expect(expired.copyKey).toBe("errors.tooLong");
    expect(h.port.send).not.toHaveBeenCalled();
    vi.mocked(h.port.blockHeight).mockResolvedValue(150);
    expect((await executePlan([h.item("a")], h.port, h.options)).phase).toBe(
      "done",
    );
  });
  it("keeps signatures from a partial wallet rejection and follows them to completion", async () => {
    const h = harness();
    vi.mocked(h.port.send).mockRejectedValue(
      new SubmittedBatchError({ code: 4001 }, ["sig-a"], null),
    );
    const result = await executePlan(
      [h.item("a"), h.item("b")],
      h.port,
      h.options,
    );
    expect(h.port.confirm).toHaveBeenCalledWith("sig-a", expect.anything());
    expect(result.phase).toBe("partial");
    expect(result.copyKey).toBe("errors.generic");
    expect(result.landed.has("a")).toBe(true);
    expect(result.retry.map((item) => item.id)).toEqual(["b"]);
  });
  it("does not retry uncertain submissions or dependent phases after a lost send response", async () => {
    const h = harness();
    vi.mocked(h.port.send).mockRejectedValue(
      new Error("connection lost after submission"),
    );
    const result = await executePlan(
      [h.item("first"), h.item("dependent", 1)],
      h.port,
      h.options,
    );
    expect(result.unknown.has("first")).toBe(true);
    expect(result.retry).toEqual([]);
    expect(h.port.send).toHaveBeenCalledTimes(1);
  });
  it("continues tracking later signatures when confirmation transport fails for an earlier one", async () => {
    const h = harness();
    vi.mocked(h.port.confirm)
      .mockRejectedValueOnce(new Error("RPC offline"))
      .mockResolvedValueOnce("confirmed");
    const result = await executePlan(
      [h.item("a"), h.item("b")],
      h.port,
      h.options,
    );
    expect(h.port.confirm).toHaveBeenCalledTimes(2);
    expect(result.unknown.has("a")).toBe(true);
    expect(result.landed.has("b")).toBe(true);
    expect(result.retry).toEqual([]);
  });
  it("holds later phases until the preceding effect is confirmed", async () => {
    const h = harness();
    const first = h.item("first");
    const second = h.item("dependent", 1);
    vi.mocked(h.port.confirm).mockResolvedValue({
      status: "failed",
      error: "finalized failure",
    });
    const result = await executePlan([first, second], h.port, h.options);
    expect(second.build).not.toHaveBeenCalled();
    expect(result.retry.map((item) => item.id)).toEqual(["first", "dependent"]);
  });
});
