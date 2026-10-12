import "../test/setup";
import { afterEach, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config/web";
import { createRpcFetch } from "./rpc-fetch";
import { createRpc } from "./rpc";

const origin = "https://capacity.example";
const endpoint = `${origin}/api/rpc`;
const options = (method = "getSlot", signal?: AbortSignal) => ({
  method: "POST",
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  signal,
});
const capacity = (retryAfter: string | null = "1") =>
  new Response("busy", {
    status: 503,
    headers: retryAfter === null ? {} : { "retry-after": retryAfter },
  });
const success = () => new Response("ready");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["getLatestBlockhash", "simulateTransaction"])(
  "retries %s capacity refusals after Retry-After using identical request bytes",
  async (method) => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(capacity())
      .mockResolvedValueOnce(success());
    const pending = createRpcFetch(origin)(endpoint, options(method));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WEB.rpcCapacityBackoffBaseMs + 1);
    expect(await (await pending).text()).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.body).toBe(
      vi.mocked(fetch).mock.calls[0]?.[1]?.body,
    );
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("honors an HTTP-date Retry-After without retrying early", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T00:00:00Z"));
  vi.mocked(fetch)
    .mockResolvedValueOnce(capacity(new Date(Date.now() + 2_000).toUTCString()))
    .mockResolvedValueOnce(success());
  const pending = createRpcFetch(origin)(endpoint, options());
  await vi.advanceTimersByTimeAsync(1_999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(WEB.rpcCapacityBackoffBaseMs + 1);
  expect((await pending).status).toBe(200);
});

it("bounds persistent capacity refusals by the configured attempt budget", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(async () => capacity());
  const pending = createRpcFetch(origin)(endpoint, options());
  await vi.advanceTimersByTimeAsync(3_000);
  expect((await pending).status).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(WEB.rpcCapacityMaxAttempts);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([null, "", "later", "-1", "0.5"])(
  "does not retry a generic 503 with Retry-After %j",
  async (retryAfter) => {
    vi.mocked(fetch).mockResolvedValueOnce(capacity(retryAfter));
    expect((await createRpcFetch(origin)(endpoint, options())).status).toBe(
      503,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it("never retries sends or ambiguous network failures", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(capacity());
  expect(
    (await createRpcFetch(origin)(endpoint, options("sendTransaction"))).status,
  ).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("connection lost"));
  await expect(createRpcFetch(origin)(endpoint, options())).rejects.toThrow(
    "connection lost",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not shorten a Retry-After that cannot fit the total deadline", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValueOnce(capacity("999999999999"));
  expect((await createRpcFetch(origin)(endpoint, options())).status).toBe(503);
  await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs * 2);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("uses jittered short backoff even when Retry-After is zero", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.mocked(fetch)
    .mockResolvedValueOnce(capacity("0"))
    .mockResolvedValueOnce(success());
  const pending = createRpcFetch(origin)(endpoint, options());
  const shortestBackoff = WEB.rpcCapacityBackoffBaseMs / 2;
  await vi.advanceTimersByTimeAsync(shortestBackoff - 1);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await pending).status).toBe(200);
});

it("bounds actual Connection instances together until each response body finishes", async () => {
  vi.useFakeTimers();
  let active = 0;
  let maximum = 0;
  vi.mocked(fetch).mockImplementation(async (_url, request) => {
    active += 1;
    maximum = Math.max(maximum, active);
    const { id } = JSON.parse(String(request?.body));
    return {
      status: 200,
      headers: new Headers(),
      text: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            active -= 1;
            resolve(JSON.stringify({ jsonrpc: "2.0", id, result: 100 }));
          }, 50);
        }),
    } as Response;
  });
  const reads = Array.from({ length: WEB.rpcConcurrency * 3 }, () =>
    createRpc(origin).getSlot(),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(WEB.rpcConcurrency);
  await vi.advanceTimersByTimeAsync(150);
  expect(await Promise.all(reads)).toEqual(reads.map(() => 100));
  expect(maximum).toBe(WEB.rpcConcurrency);
  expect(active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("expires queued calls without starting them and releases ignored aborted fetches", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const reads = Array.from({ length: WEB.rpcConcurrency + 2 }, () =>
    createRpcFetch(origin)(endpoint, options()),
  );
  const settled = Promise.allSettled(reads);
  await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
  expect((await settled).every((result) => result.status === "rejected")).toBe(
    true,
  );
  expect(fetch).toHaveBeenCalledTimes(WEB.rpcConcurrency);
  vi.mocked(fetch).mockResolvedValueOnce(success());
  expect((await createRpcFetch(origin)(endpoint, options())).status).toBe(200);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["queue", "backoff", "fetch"])(
  "cancels %s promptly without a later retry or leaked queue slot",
  async (stage) => {
    vi.useFakeTimers();
    const transport = createRpcFetch(origin);
    const controller = new AbortController();
    let held: Promise<unknown> | undefined;
    if (stage === "queue") {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
      held = Promise.allSettled(
        Array.from({ length: WEB.rpcConcurrency }, () =>
          transport(endpoint, options()),
        ),
      );
    } else if (stage === "backoff") {
      vi.mocked(fetch).mockImplementation(async () => capacity());
    } else {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    }
    const rejected = expect(
      transport(endpoint, options("getSlot", controller.signal)),
    ).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(0);
    const sent = vi.mocked(fetch).mock.calls.length;
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
    await held;
    expect(fetch).toHaveBeenCalledTimes(sent);
    vi.mocked(fetch).mockResolvedValueOnce(success());
    expect((await transport(endpoint, options())).status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("counts the first attempt and retry body against one original deadline", async () => {
  vi.useFakeTimers();
  let retrySignal: AbortSignal | undefined;
  vi.mocked(fetch)
    .mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return capacity();
    })
    .mockImplementationOnce(async (_url, request) => {
      retrySignal = request?.signal as AbortSignal;
      return { text: () => new Promise(() => {}) } as Response;
    });
  const pending = expect(
    createRpcFetch(origin)(endpoint, options()),
  ).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(retrySignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
