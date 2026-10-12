import { RpcError } from "@onepercent/service-kit";
import { M1_EVENT_IDL } from "@onepercent/sdk/events";
import { SolanaJSONRPCErrorCode } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FailoverRpc, SolanaTxSource, type RpcReader } from "./source.js";

const EVENT_PROGRAM_ID = M1_EVENT_IDL.address;
const sig = (character: string) => character.repeat(88);
const skipped = SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_SLOT_SKIPPED;
const archivedSkipped =
  SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_LONG_TERM_STORAGE_SLOT_SKIPPED;

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

describe("finalized canonical evidence", () => {
  it("detects a retained signature whose transaction order changed", async () => {
    const reader = rpc(() => ({ signatures: [sig("3"), sig("2")] }));
    const source = new SolanaTxSource(reader, EVENT_PROGRAM_ID);
    expect(await source.canonical(sig("2"), 20n, undefined, 0n)).toBe(false);
    expect(await source.canonical(sig("2"), 20n, undefined, 1n)).toBe(true);
    expect(reader.request).toHaveBeenCalledTimes(1);
  });

  it.each([skipped, archivedSkipped])(
    "requires rooted range absence and retained history after error %s",
    async (code) => {
      const reader = rpc((method) => {
        if (method === "getBlock") throw new RpcError(code);
        if (method === "getBlocks") return [];
        if (method === "getFirstAvailableBlock") return 10;
        throw new Error("unexpected_method");
      });
      const source = new SolanaTxSource(reader, EVENT_PROGRAM_ID);
      expect(await source.canonical(sig("2"), 20n)).toBe(false);
      expect(await source.canonical(sig("3"), 20n)).toBe(false);
      expect(reader.request).toHaveBeenCalledTimes(3);
      expect(vi.mocked(reader.request).mock.calls[1]?.[1]).toEqual([
        20,
        20,
        { commitment: "finalized", minContextSlot: 20 },
      ]);
    },
  );

  it.each([
    { blocks: [20], first: 10 },
    { blocks: [], first: 21 },
  ])("cannot infer a fork from a storage gap %j", async ({ blocks, first }) => {
    const source = new SolanaTxSource(
      rpc((method) => {
        if (method === "getBlock") throw new RpcError(skipped);
        return method === "getBlocks" ? blocks : first;
      }),
      EVENT_PROGRAM_ID,
    );
    await expect(source.canonical(sig("2"), 20n)).rejects.toThrow(
      `rpc_error:${skipped}`,
    );
  });

  it("requires the rooted range probe to succeed", async () => {
    const source = new SolanaTxSource(
      rpc((method) => {
        if (method === "getBlock") throw new RpcError(skipped);
        throw new RpcError(
          SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED,
        );
      }),
      EVENT_PROGRAM_ID,
    );
    await expect(source.canonical(sig("2"), 20n)).rejects.toBeInstanceOf(
      RpcError,
    );
  });

  it.each([
    SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_BLOCK_NOT_AVAILABLE,
    SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_BLOCK_CLEANED_UP,
    SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_TRANSACTION_HISTORY_NOT_AVAILABLE,
  ])("does not turn availability error %s into deletion", async (code) => {
    const reader = rpc(() => {
      throw new RpcError(code);
    });
    await expect(
      new SolanaTxSource(reader, EVENT_PROGRAM_ID).canonical(sig("2"), 20n),
    ).rejects.toBeInstanceOf(RpcError);
    expect(reader.request).toHaveBeenCalledTimes(1);
  });
});

const settings = {
  fallbackAfterFailures: 2,
  fallbackRecoverSeconds: 10,
  pollMs: 1,
  accountReconcileSeconds: 1,
  deckReconcileSeconds: 1,
  deckChunkBytes: 100,
  maxLagSecondsForIntake: 1,
  lagAlertSeconds: 2,
};

describe("durable-method provider health", () => {
  it("successful slot reads cannot hide history outages or authorize recovery", async () => {
    let historyUnavailable = true;
    let now = 0;
    const primary = rpc((method) => {
      if (method === "getSlot") return 20;
      if (historyUnavailable) throw new Error("history_unavailable");
      return { signatures: [sig("2")] };
    });
    const secondary = rpc(() => ({ signatures: [sig("2")] }));
    const alert = vi.fn(async () => ({ recorded: true, delivered: true }));
    const router = new FailoverRpc({
      primary,
      secondary,
      settings,
      alert,
      now: () => now,
    });
    const schema = z.object({ signatures: z.array(z.string()) });
    for (let i = 0; i < settings.fallbackAfterFailures; i++) {
      expect(await router.request("getSlot", [], z.number())).toBe(20);
      await expect(router.request("getBlock", [10], schema)).rejects.toThrow();
    }
    expect(router.usingFallback).toBe(true);
    await router.request("getBlock", [20], schema);
    await router.probe();
    now = 20_000;
    await router.probe();
    expect(router.usingFallback).toBe(true);
    historyUnavailable = false;
    await router.probe();
    now = 29_000;
    await router.probe();
    expect(router.usingFallback).toBe(true);
    now = 30_000;
    await router.probe();
    expect(router.usingFallback).toBe(false);
    expect(vi.mocked(primary.request).mock.calls.at(-1)?.[1]).toEqual([20]);
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("resets a method's consecutive failures after that method succeeds", async () => {
    let failing = true;
    const router = new FailoverRpc({
      primary: rpc(() => {
        if (failing) throw new Error("unavailable");
        return 20;
      }),
      secondary: rpc(() => 21),
      settings,
      alert: async () => ({ recorded: true, delivered: true }),
    });
    await expect(router.request("getSlot", [], z.number())).rejects.toThrow();
    failing = false;
    await router.request("getSlot", [], z.number());
    failing = true;
    await expect(router.request("getSlot", [], z.number())).rejects.toThrow();
    expect(router.usingFallback).toBe(false);
  });

  it.each([-32004, -32016, -32007, -32009])(
    "uses the fallback immediately after exhausted primary node lag %s",
    async (code) => {
      const secondary = rpc(() => ({ signatures: [sig("2")] }));
      const alert = vi.fn(async () => ({ recorded: true, delivered: true }));
      const router = new FailoverRpc({
        primary: rpc(() => {
          throw new RpcError(code);
        }),
        secondary,
        settings,
        alert,
      });
      const schema = z.object({ signatures: z.array(z.string()) });
      expect(await router.request("getBlock", [20], schema)).toEqual({
        signatures: [sig("2")],
      });
      expect(router.usingFallback).toBe(true);
      expect(secondary.request).toHaveBeenCalledExactlyOnceWith(
        "getBlock",
        [20],
        schema,
        undefined,
      );
      expect(alert).toHaveBeenCalledWith("indexer_rpc_fallback", "warning", {
        reason: "primary_node_lag",
      });
    },
  );

  it("preserves node-lag classification without a configured fallback", async () => {
    const router = new FailoverRpc({
      primary: rpc(() => {
        throw new RpcError(skipped);
      }),
      settings,
      alert: async () => ({ recorded: true, delivered: true }),
    });
    for (let i = 0; i < settings.fallbackAfterFailures; i++) {
      await expect(
        router.request("getBlock", [], z.unknown()),
      ).rejects.toThrow();
    }
    expect(router.usingFallback).toBe(false);
  });

  it("routes every concurrent exhausted primary read through the fallback", async () => {
    const alert = vi.fn(async () => ({ recorded: true, delivered: true }));
    const secondary = rpc(() => 20);
    const router = new FailoverRpc({
      primary: rpc(() => {
        throw new RpcError(-32004);
      }),
      secondary,
      settings,
      alert,
    });
    expect(
      await Promise.all([
        router.request("getBlockTime", [20], z.number()),
        router.request("getBlockTime", [21], z.number()),
      ]),
    ).toEqual([20, 20]);
    expect(secondary.request).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledOnce();
  });

  it("cannot recover while a primary history probe still reports node lag", async () => {
    let now = 0;
    const router = new FailoverRpc({
      primary: rpc((method) => {
        if (method === "getSlot") return 20;
        throw new RpcError(skipped);
      }),
      secondary: rpc(() => ({ signatures: [sig("2")] })),
      settings,
      alert: async () => ({ recorded: true, delivered: true }),
      now: () => now,
    });
    await router.request("getBlock", [20], z.unknown());
    await router.probe();
    now = 20_000;
    await router.probe();
    expect(router.usingFallback).toBe(true);
  });
});
