import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { RpcError } from "@onepercent/service-kit";
import {
  ACCOUNT_BYTES,
  accountDiscriminator,
  singletonAddress,
} from "./accounts.js";
import { M1_EVENT_IDL } from "@onepercent/sdk/events";
import { FailoverRpc, SolanaTxSource, type RpcReader } from "./source.js";

const EVENT_PROGRAM_ID = M1_EVENT_IDL.address;
const sig = (character: string) => character.repeat(88);
const programId = EVENT_PROGRAM_ID;
const event = Buffer.concat([
  createHash("sha256").update("event:Pong").digest().subarray(0, 8),
  Buffer.from([1, 0]),
]).toString("base64");
function transaction(signature: string, slot = 20, err: unknown = null) {
  return {
    slot,
    blockTime: 1000,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [programId],
        instructions: [{ programIdIndex: 0, accounts: [], data: "" }],
      },
    },
    meta: {
      err,
      logMessages: [
        `Program ${programId} invoke [1]`,
        `Program data: ${event}`,
        `Program ${programId} success`,
      ],
    },
  };
}
function rpc(
  handler: (method: string, params: unknown[]) => unknown,
): RpcReader {
  return {
    request: vi.fn(
      async <T>(method: string, params: unknown[], schema: z.ZodType<T>) =>
        schema.parse(handler(method, params)),
    ) as RpcReader["request"],
  };
}

describe("durable standard RPC source", () => {
  it.each([-32004, -32016, -32007, -32009])(
    "leaves block time unknown until a lagging node has slot data (%s)",
    async (code) => {
      let available = false;
      const source = new SolanaTxSource(
        rpc(() => {
          if (!available) throw new RpcError(code);
          return 1000;
        }),
        programId,
      );
      expect(await source.blockTime(20n)).toBeNull();
      available = true;
      expect(await source.blockTime(20n)).toBe(1000);
    },
  );
  it("does not hide unrelated block-time failures", async () => {
    const failure = new RpcError(-32602);
    const source = new SolanaTxSource(
      rpc(() => {
        throw failure;
      }),
      programId,
    );
    await expect(source.blockTime(20n)).rejects.toBe(failure);
  });
  it("reads a current Config signer without claiming historical authority", async () => {
    const data = Buffer.alloc(ACCOUNT_BYTES.Config);
    accountDiscriminator("Config").copy(data);
    const signer = new PublicKey(Buffer.alloc(32, 7));
    signer.toBuffer().copy(data, 168);
    const value = {
      owner: programId,
      executable: false,
      data: [data.toString("base64"), "base64"],
    };
    const response = { context: { slot: 20 }, value };
    const sourceRpc = rpc(() => response);
    const source = new SolanaTxSource(sourceRpc, programId);
    expect(await source.currentIntakeSigner(20n)).toEqual({
      address: signer.toBase58(),
      source: "current",
    });
    expect(vi.mocked(sourceRpc.request).mock.calls[0]?.[1]).toEqual([
      singletonAddress(programId, "config"),
      { commitment: "confirmed", encoding: "base64", minContextSlot: 20 },
    ]);
    response.context.slot = 19;
    await expect(source.currentIntakeSigner(20n)).rejects.toThrow(
      "feed_config_unavailable",
    );
    response.context.slot = 20;
    value.owner = signer.toBase58();
    await expect(source.currentIntakeSigner(20n)).rejects.toThrow(
      "feed_config_unavailable",
    );
    value.owner = programId;
    value.executable = true;
    await expect(source.currentIntakeSigner(20n)).rejects.toThrow(
      "feed_config_unavailable",
    );
  });
  it("sorts same-slot signatures by canonical block order and reads a block once", async () => {
    const sourceRpc = rpc((method, params) => {
      if (method === "getSignaturesForAddress")
        return [sig("2"), sig("3")].map((signature) => ({
          signature,
          slot: 20,
          err: null,
          blockTime: 1000,
        }));
      if (method === "getBlock") return { signatures: [sig("3"), sig("2")] };
      if (method === "getTransaction") return transaction(String(params[0]));
      throw new Error(method);
    });
    const source = new SolanaTxSource(sourceRpc, programId);
    const result = await source.transactions(null, 20n);
    expect(result.map((tx) => tx.signature)).toEqual([sig("3"), sig("2")]);
    expect(result.map((tx) => tx.txIndex)).toEqual([0n, 1n]);
    expect(result[0]?.events[0]).toMatchObject({
      name: "Pong",
      ixIndex: 0n,
      eventIndex: 0n,
    });
    expect(
      vi
        .mocked(sourceRpc.request)
        .mock.calls.filter(([method]) => method === "getBlock"),
    ).toHaveLength(1);
    expect(vi.mocked(sourceRpc.request).mock.calls[0]?.[1]).toEqual([
      programId,
      { commitment: "confirmed", minContextSlot: 20, limit: 1000 },
    ]);
  });
  it("does not index an unconfirmed hint, missing transaction, or mismatching block", async () => {
    for (const mode of ["processed", "missing", "mismatch"]) {
      const source = new SolanaTxSource(
        rpc((method) => {
          if (method === "getSignaturesForAddress")
            return [
              {
                signature: sig("2"),
                slot: 20,
                err: null,
                blockTime: 1000,
                confirmationStatus:
                  mode === "processed" ? "processed" : "confirmed",
              },
            ];
          if (method === "getBlock")
            return { signatures: mode === "mismatch" ? [] : [sig("2")] };
          return null;
        }),
        programId,
      );
      await expect(source.transactions(null, 20n)).rejects.toThrow();
    }
  });
  it("skips failed outcomes and reconciles truncated or unknown own logs", async () => {
    const sourceRpc = rpc((method, params) => {
      if (method === "getSignaturesForAddress")
        return [sig("2"), sig("3")].map((signature) => ({
          signature,
          slot: 20,
          err: null,
          blockTime: 1000,
        }));
      if (method === "getBlock") return { signatures: [sig("2"), sig("3")] };
      const tx = transaction(
        String(params[0]),
        20,
        params[0] === sig("2")
          ? { InstructionError: [0, "InvalidArgument"] }
          : null,
      );
      if (params[0] === sig("3")) tx.meta.logMessages.push("Log truncated");
      return tx;
    });
    const txs = await new SolanaTxSource(sourceRpc, programId).transactions(
      null,
      20n,
    );
    expect(txs[0]?.events).toEqual([]);
    expect(txs[1]?.truncated).toBe(true);
  });
  it("a null finalized block cannot authorize deletion; finalized blocks are cached per poll", async () => {
    const sourceRpc = rpc(() => null);
    await expect(
      new SolanaTxSource(sourceRpc, programId).canonical(sig("2"), 20n),
    ).rejects.toThrow("finalized_block_unavailable");
    const reader = rpc(() => ({ signatures: [sig("2")] }));
    const source = new SolanaTxSource(reader, programId);
    expect(await source.canonical(sig("2"), 20n)).toBe(true);
    expect(await source.canonical(sig("3"), 20n)).toBe(false);
    expect(reader.request).toHaveBeenCalledTimes(1);
  });
  it("paginates to the durable cursor without indexing beyond the scan watermark", async () => {
    let pages = 0;
    const reader = rpc((method) => {
      if (method === "getSignaturesForAddress") {
        pages++;
        return pages === 1
          ? Array.from({ length: 1000 }, () => ({
              signature: sig("2"),
              slot: 21,
              err: null,
              blockTime: 1001,
            }))
          : [];
      }
      throw new Error("unneeded_request");
    });
    expect(
      await new SolanaTxSource(reader, programId).transactions(sig("3"), 20n),
    ).toEqual([]);
    expect(pages).toBe(2);
    expect(vi.mocked(reader.request).mock.calls[1]?.[1]).toEqual([
      programId,
      {
        commitment: "confirmed",
        minContextSlot: 20,
        limit: 1000,
        until: sig("3"),
        before: sig("2"),
      },
    ]);
  });
});

describe("provider failover", () => {
  it("switches at the configured failure threshold and requires uninterrupted primary health", async () => {
    let failing = true,
      now = 0;
    const primary = rpc(() => {
      if (failing) throw new Error("provider_error");
      return 20;
    });
    const secondary = rpc(() => 21);
    const alert = vi.fn(async () => ({ recorded: true, delivered: true }));
    const router = new FailoverRpc({
      primary,
      secondary,
      alert,
      now: () => now,
      settings: {
        fallbackAfterFailures: 2,
        fallbackRecoverSeconds: 10,
        pollMs: 1,
        accountReconcileSeconds: 1,
        deckReconcileSeconds: 1,
        deckChunkBytes: 100,
        maxLagSecondsForIntake: 1,
        lagAlertSeconds: 2,
      },
    });
    await expect(router.request("getSlot", [], z.number())).rejects.toThrow();
    expect(router.usingFallback).toBe(false);
    await expect(router.request("getSlot", [], z.number())).rejects.toThrow();
    expect(await router.request("getSlot", [], z.number())).toBe(21);
    failing = false;
    await router.probe();
    now = 9000;
    await router.probe();
    expect(router.usingFallback).toBe(true);
    failing = true;
    await router.probe();
    failing = false;
    now = 10000;
    await router.probe();
    now = 20000;
    await router.probe();
    expect(router.usingFallback).toBe(false);
    expect(await router.request("getSlot", [], z.number())).toBe(20);
    expect(alert).toHaveBeenCalledTimes(2);
  });
});
