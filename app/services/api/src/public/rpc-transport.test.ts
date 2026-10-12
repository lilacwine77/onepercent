import { JsonRpcClient, RpcUnavailable } from "@onepercent/service-kit";
import { MachineResponse } from "@onepercent/sdk/api";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { settings } from "./__fixtures__/settings.js";
import * as fixtures from "./__fixtures__/responses.js";
import { createPublicRouter } from "./router.js";
import {
  createPublicRpcClient,
  RpcHeavyRequestTimeout,
  RpcProxySaturated,
  RpcRequestCancelled,
  RpcResponseTooLarge,
} from "./rpc-transport.js";
import { proxyRpc, validateRpcRequest } from "./rpc.js";

const options = {
  url: "https://rpc.example.test",
  transport: settings.transport,
  api: settings.api,
};
function response(init: RequestInit | undefined, result: unknown) {
  const { id } = JSON.parse(String(init?.body)) as { id: number };
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
function waitForAbort(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing transport abort signal");
    if (signal.aborted) reject(signal.reason);
    else
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
  });
}
const timeoutOptions = {
  ...options,
  transport: { ...settings.transport, rpcTimeoutMs: 5 },
};
const body = validateRpcRequest(
  { jsonrpc: "2.0", id: "caller", method: "getSlot" },
  fixtures.otherKey,
  settings.api.rpcMaxDataSliceBytes,
);

describe("isolated public RPC transport", () => {
  it("keeps machine reads working after five upstream proxy 429s open only the proxy breaker", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    const proxy = createPublicRpcClient({ ...options, fetch: fetcher });
    const internalFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        response(init, fixtures.machine),
    );
    const internal = new JsonRpcClient({
      url: options.url,
      timeoutMs: settings.transport.rpcTimeoutMs,
      failureThreshold: settings.transport.breakerFailureThreshold,
      recoverMs: settings.transport.breakerOpenSeconds * 1000,
      fetch: internalFetch,
    });
    const app = createPublicRouter({
      settings,
      webOrigin: "https://onepercent.test",
      version: "test",
      commit: "test",
      ipSalt: "test",
      cacheNamespace: "test",
      deck: fixtures.otherKey,
      clientIp: () => "127.0.0.1",
      rpc: proxy,
      limiter: { limit: async () => ({ ok: true, retryAfterS: 0 }) },
      cache: { get: async () => null, set: async () => "OK" },
      events: {
        replayAfter: async () => [],
        confirmed: async (events) => [...events],
      },
      signer: async () => {
        throw new Error("unexpected signer call");
      },
      value: async () => {
        throw new Error("unexpected value call");
      },
      data: {
        machine: () => internal.request("getAccountInfo", [], MachineResponse),
        config: async () => fixtures.config,
        me: async () => fixtures.me,
        verify: async () => fixtures.verify,
        status: async () => null,
      },
    });
    for (
      let count = 0;
      count <= settings.transport.breakerFailureThreshold;
      count += 1
    ) {
      const proxied = await app.request("/api/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(await proxied.json()).toEqual({
        jsonrpc: "2.0",
        id: "caller",
        error: { code: -32000, message: "RPC request failed" },
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(
      settings.transport.breakerFailureThreshold,
    );
    expect(await (await app.request("/api/machine")).json()).toEqual(
      fixtures.machine,
    );
    expect(internalFetch).toHaveBeenCalledOnce();
  });

  it("rejects five declared or streamed oversized responses without blocking an honest read", async () => {
    for (const declared of [true, false]) {
      const cancel = vi.fn();
      const json = vi.fn(() => {
        throw new Error("Oversized JSON must not be parsed");
      });
      let oversizedRequests = 0;
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (oversizedRequests++ >= settings.transport.breakerFailureThreshold)
            return response(init, 123);
          const oversized = new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(
                  new Uint8Array(settings.api.rpcMaxResponseBytes / 2 + 1),
                );
              },
              cancel,
            }),
            {
              headers: declared
                ? {
                    "content-length": String(
                      settings.api.rpcMaxResponseBytes + 1,
                    ),
                  }
                : {},
            },
          );
          oversized.json = json;
          return oversized;
        },
      );
      const client = createPublicRpcClient({
        ...options,
        fetch: fetcher,
      });
      for (
        let count = 0;
        count < settings.transport.breakerFailureThreshold;
        count += 1
      )
        await expect(
          client.request("getAccountInfo", [], z.json()),
        ).rejects.toBeInstanceOf(RpcResponseTooLarge);
      expect(await proxyRpc(client, body)).toEqual({
        jsonrpc: "2.0",
        id: "caller",
        result: 123,
      });
      expect(fetcher).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold + 1,
      );
      expect(cancel).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold,
      );
      expect(json).not.toHaveBeenCalled();
    }
  });

  it("bounds active upstream requests and admits another only after a slot is released", async () => {
    const pending: {
      init: RequestInit | undefined;
      release(value: Response): void;
    }[] = [];
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((release) => pending.push({ init, release })),
    );
    const api = {
      ...settings.api,
      rpcMaxConcurrent: 3,
      rpcCapacityRetryAfterSeconds: 2,
    };
    const client = createPublicRpcClient({ ...options, api, fetch: fetcher });
    const active = Array.from({ length: api.rpcMaxConcurrent }, () =>
      client.request("getSlot", [], z.number()),
    );
    expect(fetcher).toHaveBeenCalledTimes(api.rpcMaxConcurrent);
    await expect(
      client.request("getSlot", [], z.number()),
    ).rejects.toMatchObject({
      retryAfterS: 2,
    });
    await expect(
      client.request("getSlot", [], z.number()),
    ).rejects.toBeInstanceOf(RpcProxySaturated);
    expect(fetcher).toHaveBeenCalledTimes(api.rpcMaxConcurrent);
    pending[0]!.release(response(pending[0]!.init, 1));
    expect(await active[0]).toBe(1);
    const next = client.request("getSlot", [], z.number());
    expect(fetcher).toHaveBeenCalledTimes(api.rpcMaxConcurrent + 1);
    for (const item of pending.slice(1)) item.release(response(item.init, 1));
    expect(await Promise.all([...active, next])).toEqual(
      Array.from({ length: api.rpcMaxConcurrent + 1 }, () => 1),
    );
  });

  it.each([
    ["getAccountInfo", []],
    ["getMultipleAccounts", []],
    ["getTokenAccountsByOwner", []],
    ["getSignaturesForAddress", []],
    ["getTransaction", []],
    ["getBlockTime", []],
    ["simulateTransaction", []],
    ["getSignatureStatuses", [[], { searchTransactionHistory: true }]],
  ] as const)(
    "does not let %s timeouts open the proxy breaker",
    async (method, params) => {
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { method: string };
        return request.method === "getSlot"
          ? Promise.resolve(response(init, 123))
          : waitForAbort(init);
      });
      const client = createPublicRpcClient({
        ...timeoutOptions,
        fetch: fetcher,
      });
      for (
        let count = 0;
        count < settings.transport.breakerFailureThreshold;
        count += 1
      )
        await expect(
          client.request(method, [...params], z.json()),
        ).rejects.toBeInstanceOf(RpcHeavyRequestTimeout);
      expect(await proxyRpc(client, body)).toEqual({
        jsonrpc: "2.0",
        id: "caller",
        result: 123,
      });
      expect(fetcher).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold + 1,
      );
    },
  );

  it("does not let caller cancellations open the proxy breaker", async () => {
    let requests = 0;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return requests++ < settings.transport.breakerFailureThreshold
        ? waitForAbort(init)
        : Promise.resolve(response(init, 123));
    });
    const client = createPublicRpcClient({ ...options, fetch: fetcher });
    for (
      let count = 0;
      count < settings.transport.breakerFailureThreshold;
      count += 1
    ) {
      const caller = new AbortController();
      const pending = client.request("getSlot", [], z.number(), caller.signal);
      caller.abort(new Error("caller cancelled"));
      await expect(pending).rejects.toBeInstanceOf(RpcRequestCancelled);
    }
    expect(await client.request("getSlot", [], z.number())).toBe(123);
    expect(fetcher).toHaveBeenCalledTimes(
      settings.transport.breakerFailureThreshold + 1,
    );
  });

  it.each([408, 504])(
    "does not let five heavy HTTP %s deadlines block an honest read",
    async (status) => {
      const cancel = vi.fn(async () => {
        throw new Error("body cancellation failed");
      });
      let requests = 0;
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (requests++ >= settings.transport.breakerFailureThreshold)
            return response(init, 123);
          return new Response(new ReadableStream({ cancel }), { status });
        },
      );
      const client = createPublicRpcClient({ ...options, fetch: fetcher });
      for (
        let count = 0;
        count < settings.transport.breakerFailureThreshold;
        count += 1
      )
        await expect(
          client.request("getTransaction", [], z.json()),
        ).rejects.toBeInstanceOf(RpcHeavyRequestTimeout);
      expect(await client.request("getSlot", [], z.number())).toBe(123);
      expect(fetcher).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold + 1,
      );
      expect(cancel).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold,
      );
    },
  );

  it.each([
    { method: "getSlot", status: 408 },
    { method: "getSlot", status: 504 },
    { method: "getTransaction", status: 429 },
    { method: "getTransaction", status: 500 },
    { method: "getTransaction", status: 503 },
  ])(
    "still opens the breaker for $method HTTP $status failures",
    async ({ method, status }) => {
      const fetcher = vi.fn(async () => new Response(null, { status }));
      const client = createPublicRpcClient({ ...options, fetch: fetcher });
      for (
        let count = 0;
        count < settings.transport.breakerFailureThreshold;
        count += 1
      )
        await expect(
          client.request(method, [], z.json()),
        ).rejects.toBeInstanceOf(RpcUnavailable);
      await expect(
        client.request("getSlot", [], z.number()),
      ).rejects.toBeInstanceOf(RpcUnavailable);
      expect(fetcher).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold,
      );
    },
  );

  it.each(["network", "light_timeout", "recent_status_timeout"])(
    "still opens the breaker for genuine %s outages",
    async (failure) => {
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (failure === "network")
          return Promise.reject(new Error("upstream unavailable"));
        return waitForAbort(init);
      });
      const client = createPublicRpcClient({
        ...timeoutOptions,
        fetch: fetcher,
      });
      const method =
        failure === "recent_status_timeout"
          ? "getSignatureStatuses"
          : failure === "network"
            ? "getTransaction"
            : "getSlot";
      const params =
        failure === "recent_status_timeout"
          ? [[], { searchTransactionHistory: false }]
          : [];
      for (
        let count = 0;
        count < settings.transport.breakerFailureThreshold;
        count += 1
      )
        await expect(
          client.request(method, params, z.json()),
        ).rejects.toBeInstanceOf(RpcUnavailable);
      await expect(
        client.request("getSlot", [], z.number()),
      ).rejects.toBeInstanceOf(RpcUnavailable);
      expect(fetcher).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold,
      );
    },
  );

  it("forwards the caller abort signal and disallows provider redirects", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        expect(init?.signal?.aborted).toBe(true);
        throw new Error("aborted");
      },
    );
    const client = createPublicRpcClient({ ...options, fetch: fetcher });
    expect(await proxyRpc(client, body, aborted.signal)).toHaveProperty(
      "error.code",
      -32000,
    );
  });
});
