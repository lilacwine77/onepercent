import { describe, expect, it, vi } from "vitest";
import { sendLaunch } from "./send.js";
import type { LaunchAttempt, SendDependencies } from "./send.js";

const mint = "12345678example";
const input = { mint, confirm: mint.slice(0, 8), maxPasses: 3, maxBuilds: 2 };
const attempt: LaunchAttempt = {
  form: "single",
  signatures: ["s1"],
  encodedTransactions: ["signed-bytes"],
  lastValidBlockHeight: 100,
};
function setup(overrides: Partial<SendDependencies> = {}) {
  return {
    preflight: vi.fn(async () => {}),
    chainNow: vi.fn(async () => 1234),
    observe: vi.fn(async () => "absent" as const),
    prepare: vi.fn(async () => attempt),
    persist: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    send: vi.fn(async () => {}),
    finalizedHeight: vi.fn(async () => 99),
    history: vi.fn(async () => ["absent" as const]),
    sleep: vi.fn(async () => {}),
    emit: vi.fn(),
    ...overrides,
  };
}
describe("launch send reconciliation", () => {
  it("refuses confirmation before reading or signing", async () => {
    const deps = setup();
    await expect(
      sendLaunch({ ...input, confirm: "bad" }, deps),
    ).rejects.toThrow("confirmation");
    expect(deps.preflight).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
  });
  it("stops on an unsigned preflight NO-GO before waiting or signing", async () => {
    const deps = setup({
      preflight: vi.fn(async () => {
        throw new Error("launch_preflight_no_go");
      }),
    });
    await expect(sendLaunch({ ...input, at: 1235 }, deps)).rejects.toThrow(
      "launch_preflight_no_go",
    );
    expect(deps.chainNow).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.load).toHaveBeenCalledTimes(1);
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("runs preflight before waiting and prepares the final quote and hash at T0", async () => {
    const clock = vi.fn().mockResolvedValueOnce(9).mockResolvedValue(10);
    const deps = setup({ chainNow: clock });
    await sendLaunch({ ...input, at: 10 }, deps);
    expect(clock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.preflight).mock.invocationCallOrder[0]).toBeLessThan(
      clock.mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(deps.sleep).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.prepare).mock.invocationCallOrder[0]!,
    );
  });
  it("persists before submission and resends identical bytes on timeout", async () => {
    const deps = setup({
      send: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    const result = await sendLaunch(input, deps);
    expect(result.status).toBe("pending_reconciliation");
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledTimes(3);
    expect(deps.send).toHaveBeenNthCalledWith(3, attempt);
    expect(vi.mocked(deps.persist).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.send).mock.invocationCallOrder[0]!,
    );
  });
  it("a persistence failure sends nothing", async () => {
    const deps = setup({
      persist: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await expect(sendLaunch(input, deps)).rejects.toThrow("disk full");
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("reloads signed bytes after restart without rebuilding", async () => {
    const deps = setup({ load: vi.fn(async () => attempt) });
    await sendLaunch(input, deps);
    expect(deps.preflight).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.send).toHaveBeenCalledWith(attempt);
  });
  it("only rebuilds after finalized expiry, history, and a second absent-mint read", async () => {
    const deps = setup({
      load: vi.fn(async () => attempt),
      finalizedHeight: vi.fn(async () => 101),
    });
    await sendLaunch({ ...input, maxPasses: 1 }, deps);
    expect(deps.history).toHaveBeenCalledWith(["s1"]);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.observe).toHaveBeenCalledTimes(5);
  });
  it.each(["ambiguous", "finalized"] as const)(
    "refuses rebuilding after expiry if history is %s",
    async (status) => {
      const deps = setup({
        load: vi.fn(async () => attempt),
        finalizedHeight: vi.fn(async () => 101),
        history: vi.fn(async () => [status]),
      });
      await expect(sendLaunch(input, deps)).rejects.toThrow(
        "reconciliation_required",
      );
      expect(deps.prepare).not.toHaveBeenCalled();
      expect(deps.send).not.toHaveBeenCalled();
    },
  );
  it("stops successfully if the mint and PoweredOn state appear before resend", async () => {
    const deps = setup({
      observe: vi
        .fn()
        .mockResolvedValueOnce("absent")
        .mockResolvedValue("powered-on"),
    });
    expect((await sendLaunch(input, deps)).ok).toBe(true);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("alerts for an existing mint without Power-On", async () => {
    const deps = setup({
      observe: vi.fn(async () => "mint-without-power-on" as const),
    });
    await expect(sendLaunch(input, deps)).rejects.toThrow(
      "mint_exists_without_power_on",
    );
    expect(deps.prepare).not.toHaveBeenCalled();
  });
  it("reconciles a completed launch before a fresh-mint preflight or scheduled wait", async () => {
    const deps = setup({
      load: vi.fn(async () => attempt),
      observe: vi.fn(async () => "powered-on" as const),
    });
    expect(await sendLaunch({ ...input, at: 1235 }, deps)).toMatchObject({
      ok: true,
      signatures: attempt.signatures,
      reconciled: true,
    });
    expect(deps.preflight).not.toHaveBeenCalled();
    expect(deps.chainNow).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
  for (const kind of ["mint", "pool"] as const) {
    it.each([
      "initial",
      "before-pass",
      "after-history",
      "before-send",
      "final",
    ] as const)(
      `alerts for a foreign ${kind} account during the %s observation`,
      async (stage) => {
        const observe = vi.fn();
        if (stage !== "initial") observe.mockResolvedValueOnce("absent");
        if (stage === "after-history" || stage === "before-send")
          observe.mockResolvedValueOnce("absent");
        if (stage === "final")
          observe
            .mockResolvedValueOnce("absent")
            .mockResolvedValueOnce("absent");
        observe.mockResolvedValue(`foreign-${kind}-account`);
        const deps = setup({
          observe,
          ...(stage === "after-history"
            ? {
                load: vi.fn(async () => attempt),
                finalizedHeight: vi.fn(async () => 101),
              }
            : {}),
        });
        await expect(
          sendLaunch({ ...input, maxPasses: 1 }, deps),
        ).rejects.toThrow(`launch_${kind}_account_foreign`);
        expect(deps.send).toHaveBeenCalledTimes(stage === "final" ? 1 : 0);
        if (["initial", "before-pass", "after-history"].includes(stage))
          expect(deps.prepare).not.toHaveBeenCalled();
      },
    );
  }
  it("allows rebuilding only while this run has a remaining attempt budget", async () => {
    for (let run = 0; run < 2; run++) {
      const deps = setup({ finalizedHeight: vi.fn(async () => 101) });
      await expect(
        sendLaunch({ ...input, maxBuilds: 1 }, deps),
      ).rejects.toThrow("launch_attempt_budget_exhausted");
      expect(deps.prepare).toHaveBeenCalledTimes(1);
    }
  });
});
