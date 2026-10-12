import { expect, it, vi } from "vitest";
import { z } from "zod";
import { JsonRpcClient, RpcError } from "../src/rpc.js";

function errorClient(transactionError: unknown, code = -32002) {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { id } = JSON.parse(init!.body as string) as { id: number };
    return Response.json({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message: "provider-secret http://private.example/path?api-key=secret",
        data: { err: transactionError, logs: ["another-provider-secret"] },
      },
    });
  });
  return {
    fetcher,
    client: new JsonRpcClient({
      url: "http://localhost:8899?api-key=secret",
      timeoutMs: 100,
      failureThreshold: 2,
      recoverMs: 1_000,
      fetch: fetcher,
    }),
  };
}

it("valid JSON-RPC errors expose a numeric code without provider content or breaker failures", async () => {
  const { client, fetcher } = errorClient({ InstructionError: [0, 1] });
  for (let i = 0; i < 5; i += 1) {
    try {
      await client.request("sendTransaction", [], z.string());
      expect.unreachable("must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError);
      expect(error).toMatchObject({
        code: -32002,
        kind: "preflight_rejected",
        message: "rpc_error:-32002",
      });
      expect(JSON.stringify(error)).not.toMatch(
        /provider|api-key|private\.example|logs/,
      );
      expect(String(error)).not.toContain("secret");
    }
  }
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it("uses structured AlreadyProcessed for its sole preflight exception", async () => {
  await expect(
    errorClient("AlreadyProcessed").client.request(
      "sendTransaction",
      [],
      z.string(),
    ),
  ).rejects.toMatchObject({ code: -32002, kind: "already_processed" });
  await expect(
    errorClient("AlreadyProcessed", -32602).client.request(
      "sendTransaction",
      [],
      z.string(),
    ),
  ).rejects.toMatchObject({ code: -32602, kind: "rpc_error" });
});

it("a valid logical rejection resets a previous transport failure", async () => {
  let calls = 0;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) throw new Error("transport_failed");
    const { id } = JSON.parse(init!.body as string) as { id: number };
    if (calls === 2)
      return Response.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "invalid parameter" },
      });
    return Response.json({ jsonrpc: "2.0", id, result: 7 });
  });
  const client = new JsonRpcClient({
    url: "http://localhost:8899",
    timeoutMs: 100,
    failureThreshold: 2,
    recoverMs: 1_000,
    fetch: fetcher,
  });
  await expect(client.request("getSlot", [], z.number())).rejects.toThrow(
    "rpc_unavailable",
  );
  await expect(client.request("getSlot", [], z.number())).rejects.toMatchObject(
    { code: -32602 },
  );
  await expect(client.request("getSlot", [], z.number())).resolves.toBe(7);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("malformed envelopes remain transport failures and cannot spoof a logical rejection", async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { id } = JSON.parse(init!.body as string) as { id: number };
    return Response.json({
      jsonrpc: "2.0",
      id,
      result: 7,
      error: { code: -32002, message: "AlreadyProcessed" },
    });
  });
  const client = new JsonRpcClient({
    url: "http://localhost:8899",
    timeoutMs: 100,
    failureThreshold: 2,
    recoverMs: 1_000,
    fetch: fetcher,
  });
  for (let i = 0; i < 3; i += 1)
    await expect(client.request("getSlot", [], z.number())).rejects.toThrow(
      "rpc_unavailable",
    );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
