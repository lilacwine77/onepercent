// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection, SignatureStatus } from "@solana/web3.js";
import { WEB } from "@onepercent/config/web";
import { confirm } from "./confirm";

const validity = { blockhash: "unused", lastValidBlockHeight: 100 };
const status = (
  confirmationStatus: SignatureStatus["confirmationStatus"],
  err: SignatureStatus["err"] = null,
): SignatureStatus => ({
  slot: 100,
  confirmations: null,
  confirmationStatus,
  err,
});
function setup(reads: (SignatureStatus | null)[], heights = [101]) {
  const getSignatureStatuses = vi.fn(async () => ({
    context: { slot: 110 },
    value: [reads.shift() ?? null],
  }));
  const getBlockHeight = vi.fn(async () => heights.shift() ?? 101);
  const rpc = { getSignatureStatuses, getBlockHeight } as unknown as Connection;
  return { rpc, getSignatureStatuses, getBlockHeight };
}
afterEach(() => vi.useRealTimers());

describe("confirmation expiry barrier", () => {
  it("rechecks history after finalized expiry, preserving a racing landing", async () => {
    const h = setup([null, status("confirmed")]);
    expect(await confirm(h.rpc, "signature", validity)).toBe("confirmed");
    expect(h.getBlockHeight).toHaveBeenCalledWith("finalized");
    expect(h.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(h.getSignatureStatuses).toHaveBeenLastCalledWith(["signature"], {
      searchTransactionHistory: true,
    });
  });

  it("expires only after a strict finalized height and a final missing-history read", async () => {
    vi.useFakeTimers();
    const h = setup([null, null, null], [100, 101]);
    let finished = false;
    const result = confirm(h.rpc, "signature", validity).then((value) => {
      finished = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(WEB.confirmPollMs);
    expect(await result).toBe("expired");
    expect(h.getSignatureStatuses).toHaveBeenCalledTimes(3);
  });

  it("keeps a confirmed error ambiguous until finality", async () => {
    vi.useFakeTimers();
    const error = { InstructionError: [0, { Custom: 123 }] };
    const h = setup([
      status("confirmed", error),
      status("confirmed", error),
      status("finalized", error),
    ]);
    const result = confirm(h.rpc, "signature", validity);
    await vi.advanceTimersByTimeAsync(WEB.confirmPollMs);
    expect(await result).toEqual({ status: "failed", error });
    expect(h.getSignatureStatuses).toHaveBeenCalledTimes(3);
  });

  it("preserves a finalized instruction error found after the expiry barrier", async () => {
    const error = { InstructionError: [0, "InvalidArgument"] };
    const h = setup([null, status("finalized", error)]);
    expect(await confirm(h.rpc, "signature", validity)).toEqual({
      status: "failed",
      error,
    });
    expect(h.getBlockHeight).toHaveBeenCalledWith("finalized");
  });

  it("does not free a pending signature or one whose history cannot be read", async () => {
    vi.useFakeTimers();
    const h = setup([null, status("processed"), status("confirmed")]);
    const result = confirm(h.rpc, "signature", validity);
    await vi.advanceTimersByTimeAsync(WEB.confirmPollMs);
    expect(await result).toBe("confirmed");
    const unavailable = setup([null]);
    unavailable.getSignatureStatuses.mockRejectedValueOnce(
      new Error("offline"),
    );
    await expect(
      confirm(unavailable.rpc, "signature", validity),
    ).rejects.toThrow("offline");
  });

  it("rejects malformed heights instead of authorizing expiry", async () => {
    for (const height of [NaN, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const h = setup([null], [height]);
      await expect(confirm(h.rpc, "signature", validity)).rejects.toThrow(
        "Invalid block height",
      );
    }
  });
  it("does not interpret a malformed status response as missing history", async () => {
    const rpc = {
      getSignatureStatuses: async () => ({ value: [] }),
      getBlockHeight: async () => 101,
    } as unknown as Connection;
    await expect(confirm(rpc, "signature", validity)).rejects.toThrow(
      "Incomplete signature status response",
    );
  });
});
