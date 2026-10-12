import "../test/setup";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { WEB } from "@onepercent/config/web";
import { api } from "./api";

const schema = z.object({ count: z.number() }).strict();
afterEach(() => vi.useRealTimers());
it("validates successful bodies and preserves stable API error codes", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ count: 2 }), { status: 200 }),
  );
  await expect(api("/api/test", schema)).resolves.toEqual({ count: 2 });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ count: "invalid" }), { status: 200 }),
  );
  await expect(api("/api/test", schema)).rejects.toMatchObject({
    code: "invalid_response",
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error: "turnstile_required",
        message: "Untrusted text",
      }),
      { status: 403 },
    ),
  );
  await expect(api("/api/test", schema)).rejects.toMatchObject({
    code: "turnstile_required",
    status: 403,
  });
});
it("reports TimeoutError even when aborting the transport produces AbortError", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementationOnce(
    (_input, options) =>
      new Promise((_resolve, reject) => {
        signal = options?.signal ?? undefined;
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const result = api("/api/test", schema);
  const assertion = expect(result).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
  await assertion;
  expect(signal?.aborted).toBe(true);
  expect(signal?.reason).toMatchObject({ name: "TimeoutError" });
  expect(vi.getTimerCount()).toBe(0);
});
it("preserves the S4 reason envelope and never treats arbitrary error text as a code", async () => {
  for (const [body, code] of [
    [{ error: "service_down", reason: "role_disabled" }, "service_down"],
    [{ reason: "quote_unavailable" }, "quote_unavailable"],
    [{ reason: 42, message: "Untrusted text" }, "unavailable"],
    [{ message: "Untrusted text" }, "unavailable"],
    [null, "unavailable"],
  ] as const) {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 503 }),
    );
    await expect(api("/api/quote/sell-back", schema)).rejects.toMatchObject({
      code,
      status: 503,
    });
  }
});
it("propagates caller cancellation without waiting for the timeout", async () => {
  const controller = new AbortController();
  vi.mocked(fetch).mockImplementationOnce(
    (_input, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const result = api("/api/test", schema, { signal: controller.signal });
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
it("settles at the timeout even when an adapter ignores cancellation", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
  const assertion = expect(api("/api/test", schema)).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
  await assertion;
});

it("times out while reading a stalled response body", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(new ReadableStream(), { status: 200 }),
  );
  const assertion = expect(api("/api/test", schema)).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps an already-cancelled request as AbortError without calling fetch", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  controller.abort();
  await expect(
    api("/api/test", schema, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
