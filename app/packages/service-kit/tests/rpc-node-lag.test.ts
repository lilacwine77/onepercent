import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  isRpcNodeLag,
  JsonRpcClient,
  RpcError,
  RpcNodeLag,
  rpcNodeLagDelayMs,
} from "../src/rpc.js";

type Call = { id: number; method: string; params: unknown[] };
const options = {
  url: "https://rpc.example/?api-key=secret",
  timeoutMs: 1_000,
  failureThreshold: 1,
  recoverMs: 30_000,
};
function lag(id: number, code = -32004) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message: "provider-secret https://rpc.example/?api-key=secret",
    },
  });
}
function result(id: number, value: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result: value });
}
function mockRpc(respond: (call: Call, index: number) => Response) {
  let index = 0;
  return vi.fn(async (_url: unknown, init?: RequestInit) =>
    respond(JSON.parse(init!.body as string) as Call, index++),
  );
}

it.each([-32004, -32016, -32007, -32009])(
  "retries lag code %i against an alternating node without changing the read",
  async (code) => {
    const fetcher = mockRpc(({ id }, index) =>
      index % 2 === 0 ? lag(id, code) : result(id, 100),
    );
    const delay = vi.fn(async () => {});
    const client = new JsonRpcClient({
      ...options,
      fetch: fetcher,
      sleep: delay,
      random: () => 0,
    });
    const params = ["account", { minContextSlot: 99 }];
    for (let i = 0; i < 3; i += 1)
      await expect(
        client.request("getAccountInfo", params, z.number()),
      ).resolves.toBe(100);
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (const [, init] of fetcher.mock.calls)
      expect(JSON.parse(init!.body as string)).toMatchObject({
        method: "getAccountInfo",
        params,
      });
    expect(delay.mock.calls).toEqual([
      [50, undefined],
      [50, undefined],
      [50, undefined],
    ]);
    const error = new RpcError(code);
    expect(isRpcNodeLag(error)).toBe(true);
    expect(error).toMatchObject({ kind: "node_lag", code });
    expect(JSON.stringify(error)).not.toMatch(/secret|api-key|rpc\.example/);
  },
);

it("exhausts the configured bound without opening the transport breaker", async () => {
  const fetcher = mockRpc(({ id }, index) =>
    index < 3 ? lag(id) : result(id, 101),
  );
  const delay = vi.fn(async () => {});
  const client = new JsonRpcClient({
    ...options,
    fetch: fetcher,
    sleep: delay,
    random: () => 1,
    nodeLagRetry: { maxAttempts: 3, backoffBaseMs: 100, backoffMaxMs: 150 },
  });
  await expect(client.request("getSlot", [], z.number())).rejects.toMatchObject(
    {
      kind: "node_lag",
      code: -32004,
    },
  );
  expect(delay.mock.calls).toEqual([
    [100, undefined],
    [150, undefined],
  ]);
  await expect(client.request("getSlot", [], z.number())).resolves.toBe(101);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it.each(["sendTransaction", "requestAirdrop", "unknownMethod"])(
  "never automatically repeats %s",
  async (method) => {
    const fetcher = mockRpc(({ id }) => lag(id));
    const delay = vi.fn(async () => {});
    const client = new JsonRpcClient({
      ...options,
      fetch: fetcher,
      sleep: delay,
    });
    await expect(client.request(method, [], z.unknown())).rejects.toMatchObject(
      {
        kind: "node_lag",
      },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  },
);

it("does not classify unrelated failures as node lag", () => {
  expect(isRpcNodeLag(new RpcError(-32602))).toBe(false);
  expect(isRpcNodeLag(new Error("rpc_error:-32004"))).toBe(false);
  expect(isRpcNodeLag({ code: -32004 })).toBe(false);
  expect(isRpcNodeLag(new RpcNodeLag())).toBe(true);
});

it("uses capped exponential equal jitter", () => {
  const policy = { maxAttempts: 5, backoffBaseMs: 100, backoffMaxMs: 400 };
  expect(
    [0, 1, 2, 3].map((retry) => rpcNodeLagDelayMs(retry, () => 0, policy)),
  ).toEqual([50, 100, 200, 200]);
  expect(
    [0, 1, 2, 3].map((retry) => rpcNodeLagDelayMs(retry, () => 1, policy)),
  ).toEqual([100, 200, 400, 400]);
});

it("cancels an in-flight backoff without another request or breaker failure", async () => {
  const controller = new AbortController();
  const fetcher = mockRpc(({ id }, index) =>
    index === 0 ? lag(id) : result(id, 101),
  );
  const delay = vi.fn(async (_ms: number, signal?: AbortSignal) => {
    controller.abort(new Error("read_cancelled"));
    signal!.throwIfAborted();
  });
  const client = new JsonRpcClient({
    ...options,
    fetch: fetcher,
    sleep: delay,
  });
  await expect(
    client.request("getSlot", [], z.number(), controller.signal),
  ).rejects.toThrow("read_cancelled");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(client.request("getSlot", [], z.number())).resolves.toBe(101);
});

it.each(["lag", "null"])(
  "uses the finalized head for block time after confirmed head %s",
  async (unavailable) => {
    const fetcher = mockRpc(({ id, method, params }) => {
      if (method === "getSlot")
        return result(
          id,
          (params[0] as { commitment: string }).commitment === "confirmed"
            ? 110
            : 100,
        );
      if (params[0] === 110)
        return unavailable === "lag" ? lag(id) : result(id, null);
      return result(id, 1_700_000_000);
    });
    const client = new JsonRpcClient({
      ...options,
      fetch: fetcher,
      sleep: async () => {},
    });
    await expect(client.blockTimeNow()).resolves.toBe(1_700_000_000);
    expect(fetcher).toHaveBeenCalledTimes(unavailable === "lag" ? 6 : 4);
  },
);

it("keeps missing block times transient without inventing a timestamp", async () => {
  const fetcher = mockRpc(({ id, method }) =>
    result(id, method === "getSlot" ? 100 : null),
  );
  const client = new JsonRpcClient({ ...options, fetch: fetcher });
  await expect(client.blockTimeNow()).rejects.toBeInstanceOf(RpcNodeLag);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
