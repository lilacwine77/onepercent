import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { WEB } from "@onepercent/config";
import { confirm } from "../../src/tx/engine/confirm";
import { simulate } from "../../src/tx/engine/simulate";
import { blockHeight } from "../../src/tx/engine/blockhash";

afterEach(() => vi.useRealTimers());
const validity = {
  blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 150,
};

describe("confirmed status and RPC validity", () => {
  it("waits past a processed failure and accepts a later confirmed outcome", async () => {
    vi.useFakeTimers();
    const statuses = vi
      .fn()
      .mockResolvedValueOnce({
        value: [
          {
            err: { InstructionError: [0, "InvalidArgument"] },
            confirmationStatus: "processed",
          },
        ],
      })
      .mockResolvedValueOnce({
        value: [{ err: null, confirmationStatus: "confirmed" }],
      });
    const rpc = {
      getSignatureStatuses: statuses,
      getBlockHeight: vi.fn(async () => 150),
    } as unknown as Connection;
    const pending = confirm(rpc, "sig", validity);
    await vi.advanceTimersByTimeAsync(WEB.confirmPollMs);
    expect(await pending).toBe("confirmed");
    expect(statuses).toHaveBeenCalledTimes(2);
  });
  it("recognizes finalized failure and success without another height read", async () => {
    const rpc = {
      getSignatureStatuses: vi
        .fn()
        .mockResolvedValueOnce({
          value: [{ err: "failure", confirmationStatus: "finalized" }],
        })
        .mockResolvedValueOnce({
          value: [{ err: null, confirmationStatus: "finalized" }],
        }),
      getBlockHeight: vi.fn(),
    };
    expect(
      await confirm(rpc as unknown as Connection, "sig", validity),
    ).toEqual({ status: "failed", error: "failure" });
    expect(await confirm(rpc as unknown as Connection, "sig", validity)).toBe(
      "confirmed",
    );
    expect(rpc.getBlockHeight).not.toHaveBeenCalled();
  });
  it("expires only beyond the exact block height validity boundary", async () => {
    vi.useFakeTimers();
    const rpc = {
      getSignatureStatuses: vi.fn(async () => ({ value: [null] })),
      getBlockHeight: vi
        .fn()
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(151),
    };
    const pending = confirm(rpc as unknown as Connection, "sig", validity);
    await vi.advanceTimersByTimeAsync(WEB.confirmPollMs);
    expect(await pending).toBe("expired");
    expect(rpc.getBlockHeight).toHaveBeenCalledTimes(2);
    expect(rpc.getBlockHeight).toHaveBeenCalledWith("finalized");
  });
  it("propagates block height failures instead of inferring height from another blockhash", async () => {
    const error = new Error("Method not available");
    const rpc = {
      getSignatureStatuses: vi.fn(async () => ({ value: [null] })),
      getBlockHeight: vi.fn().mockRejectedValue(error),
      getLatestBlockhash: vi.fn().mockResolvedValue(validity),
    };
    await expect(blockHeight(rpc as unknown as Connection)).rejects.toBe(error);
    await expect(
      confirm(rpc as unknown as Connection, "sig", validity),
    ).rejects.toBe(error);
    expect(rpc.getLatestBlockhash).not.toHaveBeenCalled();
  });
  it.each([NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid RPC block height %s",
    async (height) => {
      const rpc = { getBlockHeight: vi.fn().mockResolvedValue(height) };
      await expect(blockHeight(rpc as unknown as Connection)).rejects.toThrow(
        "Invalid block height",
      );
    },
  );
  it("simulates unsigned exact instructions at confirmed and rejects an instruction error", async () => {
    const payer = Keypair.generate();
    const transaction = new Transaction({
      feePayer: payer.publicKey,
      ...validity,
    }).add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1n,
      }),
    );
    const simulateTransaction = vi.fn().mockResolvedValue({
      value: { err: { InstructionError: [0, "InsufficientFunds"] } },
    });
    await expect(
      simulate({ simulateTransaction } as unknown as Connection, transaction),
    ).rejects.toMatchObject({ copyKey: "errors.simulation" });
    expect(simulateTransaction).toHaveBeenCalledWith(expect.anything(), {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    expect(
      Buffer.from(simulateTransaction.mock.calls[0]![0].message.serialize()),
    ).toEqual(transaction.serializeMessage());
  });
});
