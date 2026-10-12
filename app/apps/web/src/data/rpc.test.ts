import "../test/setup";
import { afterEach, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config/web";
import { createRpc } from "./rpc";
import { fixtureRpcResult } from "../../e2e/helpers/w3-rpc";

afterEach(() => vi.useRealTimers());
it.each(["headers", "body"])(
  "bounds RPC %s stalls, including an ignored abort",
  async (stage) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, options) => {
      signal = options?.signal as AbortSignal;
      return stage === "headers"
        ? new Promise(() => {})
        : Promise.resolve({ text: () => new Promise(() => {}) } as Response);
    });
    const assertion = expect(createRpc().getLatestBlockhash()).rejects.toThrow(
      /timed out/,
    );
    await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("uses the strict W3 replies through the actual RPC client", async () => {
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const { method, params, id } = JSON.parse(String(options?.body));
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: fixtureRpcResult(method, params, new Map()),
      }),
    );
  });
  const rpc = createRpc();
  expect((await rpc.getLatestBlockhash()).lastValidBlockHeight).toBe(1000);
  expect(await rpc.getMinimumBalanceForRentExemption(112)).toBe(1112);
});
it("fails on an unrecorded RPC or account instead of returning silent null", () => {
  expect(() => fixtureRpcResult("simulateTransaction", [], new Map())).toThrow(
    "Unrecorded RPC",
  );
  expect(() =>
    fixtureRpcResult("getAccountInfo", ["missing"], new Map()),
  ).toThrow("Unrecorded account");
  expect(
    fixtureRpcResult("getAccountInfo", ["absent"], new Map([["absent", null]])),
  ).toMatchObject({ value: null });
});
