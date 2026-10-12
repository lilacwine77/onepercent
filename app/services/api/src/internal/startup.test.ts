import { Hono } from "hono";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignerErrorResponse } from "@onepercent/sdk/api";
import { SignerError } from "./error.js";
import {
  createIndexerStatusTimeReader,
  mountPrivateSigner,
} from "./startup.js";

const build = vi.hoisted(() => vi.fn());
vi.mock("./runtime.js", () => ({ createRuntimeSignerApp: build }));
beforeEach(() => {
  build.mockReset();
});

describe("D22 private startup", () => {
  it.each(["intake-signer", "quote-signer"] as const)(
    "mounts %s on the existing health app",
    async (role) => {
      const path =
        role === "intake-signer"
          ? "/internal/feed/attest"
          : "/internal/sellback/quote";
      const health = new Hono().get("/health", (c) => c.json({ ok: true }));
      const runtime = { role, health } as ServiceRuntime;
      const privateApp = new Hono().post(path, (c) =>
        c.json({ mounted: role }),
      );
      build.mockReturnValue(privateApp);
      const indexerTime = async () => 100;
      mountPrivateSigner(runtime, {
        indexerTime,
        marketEnv: { pythHermesUrl: "https://provider.example" },
      });
      expect(build).toHaveBeenLastCalledWith(
        runtime,
        expect.objectContaining({ indexerTime }),
      );
      expect((await health.request("/health")).status).toBe(200);
      expect(
        await (await health.request(path, { method: "POST" })).json(),
      ).toEqual({ mounted: role });
      expect(
        (await health.request("/api/feed/attest", { method: "POST" })).status,
      ).toBe(404);
    },
  );

  it.each(["intake-signer", "quote-signer"] as const)(
    "keeps %s observable and unavailable while compiled parameters are missing",
    async (role) => {
      const token = "p".repeat(32);
      const health = new Hono()
        .get("/health", (c) => c.json({ ok: true }))
        .get("/ready", (c) => c.json({ ok: true }))
        .get("/metrics", (c) => c.text("metric 1"));
      const stop = vi.fn();
      const log = vi.fn();
      const runtime = {
        role,
        health,
        stop,
        env: {
          INTERNAL_TOKEN: token,
          APP_VERSION: "test",
          GIT_COMMIT: "commit",
        },
        guard: { status: () => ({ ok: true }) },
        logger: { warn: log },
      } as unknown as ServiceRuntime;
      build.mockImplementation(() => {
        throw new SignerError(503, "params_unavailable");
      });
      expect(() => mountPrivateSigner(runtime)).not.toThrow();
      for (const path of ["/health", "/ready"]) {
        const response = await runtime.health.request(path);
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
          ok: false,
          reason: "params_unavailable",
        });
      }
      expect(await (await runtime.health.request("/metrics")).text()).toBe(
        "metric 1",
      );
      const path =
        role === "intake-signer"
          ? "/internal/feed/attest"
          : "/internal/sellback/quote";
      expect(
        (await runtime.health.request(path, { method: "POST" })).status,
      ).toBe(401);
      const response = await runtime.health.request(path, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(503);
      expect(SignerErrorResponse.parse(await response.json())).toEqual({
        reason: "evidence_unavailable",
      });
      expect(log).toHaveBeenCalledExactlyOnceWith(
        {
          reason: "params_unavailable",
          role,
          cause: { code: "params_unavailable", detail: "params_unavailable" },
        },
        "signer parameters unavailable",
      );
      expect(stop).not.toHaveBeenCalled();
    },
  );

  it("does not suppress key, credential or unexpected startup failures", () => {
    for (const error of [
      new Error("signer_runtime_unavailable"),
      new Error("quote_jupiter_key_unavailable"),
      new SignerError(503, "role_disabled"),
    ]) {
      const health = new Hono();
      const runtime = { health } as ServiceRuntime;
      build.mockImplementation(() => {
        throw error;
      });
      expect(() => mountPrivateSigner(runtime)).toThrow(error);
      expect(runtime.health).toBe(health);
    }
  });

  it("uses S1 completed scanSlot and exact cluster time, including quiet polls", async () => {
    const get = vi.fn(async () =>
      JSON.stringify({
        asOfSlot: "3",
        scanSlot: "99",
        checkedAt: "2030-01-01T00:00:00Z",
      }),
    );
    const request = vi.fn(async () => 1234);
    const read = createIndexerStatusTimeReader({
      redis: { get },
      rpc: { request },
    } as unknown as Pick<ServiceRuntime, "rpc" | "redis">);
    expect(await read()).toBe(1234);
    expect(get).toHaveBeenCalledWith("onepct:indexer:status");
    expect(request).toHaveBeenCalledWith(
      "getBlockTime",
      [99],
      expect.anything(),
    );
  });

  it.each([
    null,
    "{",
    JSON.stringify({ asOfSlot: "99" }),
    JSON.stringify({ scanSlot: "99", available: false }),
    JSON.stringify({ scanSlot: "9007199254740992" }),
  ])(
    "fails closed for missing, stale or malformed status %s",
    async (value) => {
      const request = vi.fn();
      const read = createIndexerStatusTimeReader({
        redis: { get: async () => value },
        rpc: { request },
      } as unknown as Pick<ServiceRuntime, "rpc" | "redis">);
      await expect(read()).rejects.toMatchObject({ reason: "indexer_lag" });
      expect(request).not.toHaveBeenCalled();
    },
  );
});
