import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { senderTip, withSender } from "./landing.js";
import { RpcError } from "./rpc.js";
import type { TxRpc } from "./tx.js";

describe("shared Sender transport", () => {
  it("fails closed until the configured tip is measured", () => {
    expect(() => senderTip(PublicKey.default, null)).toThrow("pending");
    expect(() => senderTip(PublicKey.default, 1n)).toThrow("below_minimum");
  });
  it("falls back with exactly the same signed bytes after an ambiguous reply", async () => {
    const sendRawTransaction = vi.fn(async () => "signature");
    const rpc = withSender({ sendRawTransaction } as unknown as TxRpc, {
      timeoutMs: 100,
      assertActive: vi.fn(),
      fetch: vi.fn(async () => {
        throw new Error("connection_lost");
      }),
    });
    const bytes = Uint8Array.from([1, 2, 3]);
    await expect(rpc.sendRawTransaction(bytes)).resolves.toBe("signature");
    expect(sendRawTransaction).toHaveBeenCalledWith(bytes, undefined);
  });
  it("does not expose a fallback preflight rejection as proof after an ambiguous Sender submission", async () => {
    const rpc = withSender(
      {
        sendRawTransaction: vi.fn(async () => {
          throw new RpcError(-32002, "BlockhashNotFound");
        }),
      } as unknown as TxRpc,
      {
        timeoutMs: 100,
        assertActive: () => undefined,
        fetch: vi.fn(async () => {
          throw new Error("response_lost");
        }),
      },
    );
    await expect(rpc.sendRawTransaction(Uint8Array.from([1]))).rejects.toThrow(
      "sender_submission_ambiguous",
    );
  });
  it("does not fall back after role or leadership loss", async () => {
    let active = true;
    const fallback = vi.fn(async () => "signature");
    const rpc = withSender(
      { sendRawTransaction: fallback } as unknown as TxRpc,
      {
        timeoutMs: 100,
        assertActive() {
          if (!active) throw new Error("not_authorized");
        },
        fetch: vi.fn(async () => {
          active = false;
          throw new Error("lost");
        }),
      },
    );
    await expect(rpc.sendRawTransaction(Uint8Array.from([1]))).rejects.toThrow(
      "not_authorized",
    );
    expect(fallback).not.toHaveBeenCalled();
  });
});
