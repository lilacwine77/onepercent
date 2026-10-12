import { afterEach, describe, expect, it, vi } from "vitest";
import { safeCause, warnCause } from "./safe-cause.js";
import { reportStartupFailure } from "./runtime.js";

const originalExitCode = process.exitCode;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

describe("safeCause", () => {
  it("preserves stable application, Node, pg, and class codes", () => {
    expect(safeCause(new Error("quote_jupiter_key_unavailable"))).toEqual({
      code: "quote_jupiter_key_unavailable",
      detail: "quote_jupiter_key_unavailable",
    });
    expect(
      safeCause(
        Object.assign(new Error('relation "events" does not exist'), {
          code: "42P01",
        }),
      ),
    ).toEqual({
      code: "42P01",
      detail: 'relation "events" does not exist',
    });
    expect(
      safeCause(
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:55432"), {
          code: "ECONNREFUSED",
        }),
      ).code,
    ).toBe("ECONNREFUSED");
    expect(safeCause(new TypeError("fetch failed"))).toEqual({
      code: "TypeError",
      detail: "fetch failed",
    });
  });

  it.each([
    [
      "request https://devnet.helius-rpc.com/?api-key=helius-secret failed",
      "request <redacted> failed",
    ],
    ["api-key=helius-secret", "<redacted>"],
    ["https%3A%2F%2Frpc.invalid%2F%3Fapi-key%3Dsecret", "<redacted>"],
    [
      "wss://rpc.example.invalid/path postgresql://user:password@localhost/db",
      "<redacted> <redacted>",
    ],
    [
      `keypair ${JSON.stringify(Array.from({ length: 64 }, (_, i) => i))}`,
      "keypair <redacted>",
    ],
    [
      `keypair [\n${Array.from({ length: 64 }, (_, i) => i).join(",\n")}\n]`,
      "keypair <redacted>",
    ],
    [`key ${"A".repeat(81)}`, "key <redacted>"],
    ["Authorization: Bearer token-value", "<redacted>"],
    ["Bearer token-value", "<redacted>"],
    ["token secret-value", "<redacted>"],
    ["accessToken=secret-value", "<redacted>"],
    ["a".repeat(40), "<redacted>"],
    ["token=token-value access_token: token-value", "<redacted> <redacted>"],
    ['{"refresh_token":"token-value"}', '{"<redacted>}'],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb28ifQ.fakeSignature", "<redacted>"],
    ["123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk", "<redacted>"],
    ["ghp_abcdefghijklmnopqrstuv123456", "<redacted>"],
    ["opaque AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "opaque <redacted>"],
  ])("redacts credentials in %s", (message, detail) => {
    expect(safeCause(new Error(message)).detail).toBe(detail);
  });

  it("redacts bare environment credentials from details and codes", () => {
    vi.stubEnv("INTERNAL_TOKEN", "private_token_value");
    expect(safeCause(new Error("private_token_value"))).toEqual({
      code: "Error",
      detail: "<redacted>",
    });
    expect(
      safeCause({
        code: "private_token_value",
        message: "request failed",
        name: "Error",
      }),
    ).toEqual({ code: "Error", detail: "request failed" });
  });

  it("redacts before truncating and never includes a stack or arbitrary fields", () => {
    const prefix = "x ".repeat(93);
    const error = Object.assign(
      new Error(`${prefix}https://rpc.invalid/${"secret".repeat(100)}`),
      { request: "never-print", cause: "never-print" },
    );
    const cause = safeCause(error);
    expect(cause.detail).toBe(`${prefix}<redacted>`);
    expect(safeCause(new Error("x ".repeat(500))).detail).toHaveLength(200);
    expect(JSON.stringify(cause)).not.toContain("never-print");
    expect(Object.keys(cause)).toEqual(["code", "detail"]);
  });

  it("omits the request or credential preview embedded by JSON.parse", () => {
    let error: unknown;
    try {
      JSON.parse("user-private-note");
    } catch (caught) {
      error = caught;
    }
    expect(safeCause(error)).toEqual({
      code: "SyntaxError",
      detail: "Unexpected token <redacted> in JSON",
    });
  });

  it("handles non-Error values and hostile objects without running getters", () => {
    expect(safeCause("rpc_unavailable").code).toBe("rpc_unavailable");
    for (const value of [
      undefined,
      null,
      4,
      {},
      {
        get message() {
          throw new Error("must not run");
        },
      },
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error("must not run");
          },
        },
      ),
    ]) {
      expect(safeCause(value)).toEqual({ code: "unknown_error", detail: "" });
    }
  });

  it("writes safe warnings and startup causes without changing the failure exit code", () => {
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const error = new Error("quote_jupiter_key_unavailable");
    warnCause("quote_failed", error);
    expect(JSON.parse(String(output.mock.calls[0]![0]))).toEqual({
      level: "warn",
      reason: "quote_failed",
      cause: safeCause(error),
    });
    reportStartupFailure(error);
    expect(JSON.parse(String(output.mock.calls[1]![0]))).toEqual({
      level: "warn",
      variable: "startup_failed",
      cause: safeCause(error),
    });
    expect(process.exitCode).toBe(1);
  });

  it("keeps diagnostics from replacing the original failure when the sink throws", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("write_failed");
    });
    expect(() =>
      warnCause("request_failed", new Error("original_failure")),
    ).not.toThrow();
  });
});
