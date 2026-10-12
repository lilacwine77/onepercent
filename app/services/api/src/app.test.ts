import { describe, expect, it } from "vitest";
import { createApi } from "./app.js";
import { parseEnv } from "./env.js";
import { parseXrayEnv } from "./xray/env.js";

const env = parseEnv({ APP_VERSION: "0.0.0", GIT_COMMIT: "test-commit" });

describe("API", () => {
  it("returns a healthy response with build metadata", async () => {
    const response = await createApi(env).request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      version: "0.0.0",
      commit: "test-commit",
    });
  });

  it("allows only the configured web origin", async () => {
    const app = createApi(env);
    const allowed = await app.request("/health", {
      headers: { Origin: env.WEB_ORIGIN },
    });
    const denied = await app.request("/health", {
      headers: { Origin: "https://example.invalid" },
    });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      env.WEB_ORIGIN,
    );
    expect(denied.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("preserves X1 cross-origin verifier preflights", async () => {
    const response = await createApi(env).request("/api/xray/example", {
      method: "OPTIONS",
      headers: {
        Origin: env.WEB_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "cf-turnstile-response",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      env.WEB_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "cf-turnstile-response",
    );
  });

  it("fails fast with the names of invalid environment variables", () => {
    expect(() => parseEnv({ PORT: "not-a-port" })).toThrow(
      /Invalid API environment:[\s\S]*PORT/,
    );
    expect(() => parseEnv({ WEB_ORIGIN: "*" })).toThrow(/WEB_ORIGIN/);
    expect(() => parseEnv({ WEB_ORIGIN: "https://example.test/path" })).toThrow(
      /WEB_ORIGIN/,
    );
  });

  it("uses the same 32-character bot secret rule and proxy setting as X1", () => {
    for (const parse of [parseEnv, parseXrayEnv]) {
      expect(() => parse({ BOT_API_SECRET: "x".repeat(31) })).toThrow(
        /BOT_API_SECRET/,
      );
      expect(
        parse({
          BOT_API_SECRET: "x".repeat(32),
          TRUST_PROXY_HEADER: "X-Real-IP",
        }),
      ).toMatchObject({
        BOT_API_SECRET: "x".repeat(32),
        TRUST_PROXY_HEADER: "X-Real-IP",
      });
      expect(() => parse({ TRUST_PROXY_HEADER: "invalid header" })).toThrow(
        /TRUST_PROXY_HEADER/,
      );
      expect(
        parse({ BOT_API_SECRET: "", TRUST_PROXY_HEADER: "" }),
      ).toMatchObject({
        BOT_API_SECRET: undefined,
        TRUST_PROXY_HEADER: undefined,
      });
    }
  });

  it("uses local defaults when the example environment contains empty values", () => {
    expect(parseEnv({ PORT: "", WEB_ORIGIN: "", LOG_LEVEL: "" })).toMatchObject(
      {
        PORT: 3000,
        WEB_ORIGIN: "http://localhost:5173",
        LOG_LEVEL: "info",
      },
    );
  });
});
