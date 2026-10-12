import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Clock } from "../src/clock.js";
import { MarketError, type MarketLogger } from "../src/errors.js";
import { createHttpClient } from "../src/http/fetch-json.js";
import { redact } from "../src/http/redact.js";
import { MARKET } from "../src/params.js";
import { fixtureFetch } from "../src/testing.js";

// Transport boundaries replay documented synthetic variants of a recorded
// Jupiter response. Timeout/network wrappers preserve that fixture's payload.
function retryClock(timeout = false) {
  let now = 0;
  const delays: number[] = [];
  const clock: Clock = {
    nowMs: () => now,
    random: () => 0.5,
    sleep: (ms) => {
      if (ms === MARKET.http.timeoutMs && !timeout)
        return new Promise<void>(() => {});
      delays.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
  return { clock, delays };
}

const fixture = (name: string) =>
  new URL(`./fixtures/jupiter/${name}.json`, import.meta.url);
const recorded = JSON.parse(readFileSync(fixture("prices-wsol"), "utf8")) as {
  request: { method: string; url: string };
  response: { body: unknown };
};
const schema = z.record(
  z.string(),
  z.object({ usdPrice: z.number() }).passthrough(),
);
const request = recorded.request;
const replay = (...names: string[]) => vi.fn(fixtureFetch(names.map(fixture)));

describe("HTTP boundary handling", () => {
  it("validates data while retaining unknown fields", async () => {
    const { clock } = retryClock();
    const fetch = replay("prices-wsol");
    const http = createHttpClient({ fetch, clock, provider: "test" });
    await expect(http.fetchJson(schema, request)).resolves.toEqual(
      recorded.response.body,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries server failures exactly maxAttempts with injected full jitter", async () => {
    const { clock, delays } = retryClock();
    const fetch = replay("http-server-error");
    const http = createHttpClient({ fetch, clock, provider: "test" });
    await expect(http.fetchJson(schema, request)).rejects.toMatchObject({
      code: "PROVIDER_HTTP",
      status: 503,
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(MARKET.http.maxAttempts);
    expect(delays).toEqual([125, 250, 500]);
  });

  it("uses the reset timestamp for 429, capped at the configured wait", async () => {
    const { clock, delays } = retryClock();
    const fetch = replay("http-rate-limited-capped", "prices-wsol");
    const http = createHttpClient({ fetch, clock, provider: "test" });
    await expect(http.fetchJson(schema, request)).resolves.toEqual(
      recorded.response.body,
    );
    expect(delays).toEqual([MARKET.http.rateLimitWaitMaxMs]);
  });

  it("waits only until an uncapped 429 reset", async () => {
    const { clock, delays } = retryClock();
    const fetch = replay("http-rate-limited-reset", "prices-wsol");
    await createHttpClient({ fetch, clock, provider: "test" }).fetchJson(
      schema,
      request,
    );
    expect(delays).toEqual([2000]);
  });

  it.each([
    [400, "PROVIDER_HTTP", "http-bad-request"],
    [401, "PROVIDER_AUTH", "http-unauthorized"],
  ] as const)("does not retry HTTP %s", async (status, code, name) => {
    const { clock, delays } = retryClock();
    const fetch = replay(name);
    const http = createHttpClient({ fetch, clock, provider: "test" });
    await expect(http.fetchJson(schema, request)).rejects.toMatchObject({
      code,
      status,
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(delays).toEqual([]);
  });

  it("extracts only a route flag from a no-quote response", async () => {
    const { clock } = retryClock();
    const fetch = replay("http-bad-request");
    const result = await createHttpClient({ fetch, clock, provider: "test" })
      .fetchJson(schema, request)
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ routeUnavailable: true });
    expect(String(result)).not.toContain("sensitive-value");
  });

  it("times out stalled fetches and aborts each attempt", async () => {
    const { clock } = retryClock(true);
    const signals: AbortSignal[] = [];
    const transport = fixtureFetch(fixture("http-timeout"));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url, init) => {
        await transport(url, init);
        signals.push(init?.signal as AbortSignal);
        return new Promise<Response>(() => {});
      });
    const http = createHttpClient({ fetch, clock, provider: "test" });
    await expect(http.fetchJson(schema, request)).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(fetch).toHaveBeenCalledTimes(MARKET.http.maxAttempts);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("classifies the fetch AbortError race as a timeout", async () => {
    const { clock } = retryClock(true);
    const transport = fixtureFetch(fixture("http-timeout"));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url, init) => {
        const result = new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
        await transport(url, init);
        return result;
      });
    await expect(
      createHttpClient({ fetch, clock, provider: "test" }).fetchJson(
        schema,
        request,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("cancels native timeout waits after a successful attempt", async () => {
    vi.useFakeTimers();
    try {
      const fetch = replay("prices-wsol");
      await createHttpClient({ fetch, provider: "test" }).fetchJson(
        schema,
        request,
      );
      expect(vi.getTimerCount()).toBe(0);
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out stalled response bodies too", async () => {
    const waits: Array<() => void> = [];
    const clock: Clock = {
      nowMs: () => 0,
      random: () => 0,
      sleep: (ms) =>
        ms === MARKET.http.timeoutMs
          ? new Promise<void>((resolve) => waits.push(resolve))
          : Promise.resolve(),
    };
    const transport = fixtureFetch(fixture("http-timeout"));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url, init) => {
        const response = await transport(url, init);
        response.json = async () => {
          waits.shift()?.();
          return new Promise<never>(() => {});
        };
        return response;
      });
    await expect(
      createHttpClient({ fetch, clock, provider: "test" }).fetchJson(
        schema,
        request,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(fetch).toHaveBeenCalledTimes(MARKET.http.maxAttempts);
  });

  it("discards invalid provider data instead of logging schema payloads", async () => {
    const { clock } = retryClock();
    const fetch = replay("http-schema-invalid");
    await expect(
      createHttpClient({ fetch, clock, provider: "test" }).fetchJson(
        schema,
        request,
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_SCHEMA",
      message: "PROVIDER_SCHEMA",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps raw network errors, headers and RPC paths out of logs and errors", async () => {
    const { clock } = retryClock();
    const entries: unknown[] = [];
    const logger: MarketLogger = {
      debug: (...args) => entries.push(args),
      info: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
    };
    const secret = "synthetic-sensitive-value";
    const transport = fixtureFetch(fixture("http-network-error"));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url, init) => {
        await transport(url, init);
        throw new Error(
          `Bearer ${secret} https://rpc.example.test/private-path?api-key=${secret}`,
        );
      });
    const result = await createHttpClient({
      fetch,
      clock,
      logger,
      provider: "rpc",
      secrets: [secret],
    })
      .fetchJson(schema, request)
      .catch((error: unknown) => error);
    const captured = JSON.stringify(entries) + String(result);
    expect(captured).not.toContain(secret);
    expect(captured).not.toContain("private-path");
  });

  it("redacts explicit secrets, authorization fields and URL credentials", () => {
    const redacted = redact(
      "synthetic-sensitive Bearer token-value x-api-key=header-value https://user:pass@rpc.example.test/private?secret=value",
      ["synthetic-sensitive"],
    );
    expect(redacted).toBe("[REDACTED] [REDACTED] [REDACTED] rpc.example.test");
    expect(
      new MarketError("PROVIDER_HTTP", { message: "Bearer token-value" })
        .message,
    ).toBe("[REDACTED]");
    expect(redact('{"apiKey":"synthetic-sensitive-value"}')).not.toContain(
      "synthetic-sensitive-value",
    );
  });

  it("acquires provider capacity for every attempt", async () => {
    const { clock } = retryClock();
    const limiter = { acquire: vi.fn(async () => {}) };
    const fetch = replay("http-server-error", "prices-wsol");
    await createHttpClient({
      fetch,
      clock,
      limiter,
      provider: "test",
    }).fetchJson(schema, request);
    expect(limiter.acquire).toHaveBeenCalledTimes(2);
  });
});
