import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSignerProxy, createSignerReadiness } from "./signer.js";
import { settings } from "./__fixtures__/settings.js";

const targets = {
  intake: { url: "https://intake.test", token: "a".repeat(32) },
  quote: { url: "https://quote.test", token: "b".repeat(32) },
  settings,
};
describe("signer availability", () => {
  it.each(["intake", "quote"] as const)(
    "keeps the other signer available when %s is not configured",
    async (missing) => {
      const present = missing === "intake" ? "quote" : "intake";
      const request = vi.fn(async () => Response.json({ ok: true }));
      const options = { ...targets, [missing]: undefined, fetch: request };
      const proxy = createSignerProxy(options);
      await expect(
        proxy(missing, {}, "hash", z.unknown()),
      ).rejects.toMatchObject({ status: 503, code: "signer_unavailable" });
      expect(request).not.toHaveBeenCalled();
      await expect(
        proxy(present, {}, "hash", z.object({ ok: z.boolean() })),
      ).resolves.toEqual({ ok: true });
      request.mockResolvedValue(Response.json({ ok: true, key: { ok: true } }));
      expect(await createSignerReadiness(options)()).toEqual({
        [missing]: "unavailable",
        [present]: "ready",
      });
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it("reports both unconfigured signers without making a request", async () => {
    const request = vi.fn();
    const options = {
      intake: undefined,
      quote: undefined,
      settings,
      fetch: request,
    };
    const proxy = createSignerProxy(options);
    for (const role of ["intake", "quote"] as const)
      await expect(proxy(role, {}, "hash", z.unknown())).rejects.toMatchObject({
        status: 503,
        code: "signer_unavailable",
      });
    expect(await createSignerReadiness(options)()).toEqual({
      intake: "unavailable",
      quote: "unavailable",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([429, 503])(
    "preserves parsed %i refusals without opening the circuit",
    async (status) => {
      const request = vi.fn(async () =>
        Response.json(
          { reason: "indexer_lag" },
          { status, headers: { "retry-after": "2" } },
        ),
      );
      const proxy = createSignerProxy({ ...targets, fetch: request });
      for (let i = 0; i < settings.transport.breakerFailureThreshold + 1; i++)
        await expect(
          proxy("intake", {}, "hash", z.object({ ok: z.boolean() })),
        ).rejects.toMatchObject({
          status,
          code: "indexer_lag",
          retryAfterS: 2,
        });
      expect(request).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold + 1,
      );
    },
  );
  it.each(["transport", "timeout", "invalid_5xx"])(
    "opens only on infrastructure failure: %s",
    async (kind) => {
      const request = vi.fn(async () => {
        if (kind === "transport") throw new TypeError("offline");
        if (kind === "timeout")
          throw new DOMException("timeout", "TimeoutError");
        return new Response("not json", { status: 502 });
      });
      const proxy = createSignerProxy({ ...targets, fetch: request });
      for (let i = 0; i < settings.transport.breakerFailureThreshold + 1; i++)
        await expect(
          proxy("intake", {}, "hash", z.unknown()),
        ).rejects.toMatchObject({ code: "signer_unavailable" });
      expect(request).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold,
      );
    },
  );
  it.each([200, 400])(
    "does not count invalid %i bodies as infrastructure outages",
    async (status) => {
      const request = vi.fn(async () => new Response("invalid", { status }));
      const proxy = createSignerProxy({ ...targets, fetch: request });
      for (let i = 0; i < settings.transport.breakerFailureThreshold + 1; i++)
        await expect(
          proxy("quote", {}, "hash", z.unknown()),
        ).rejects.toMatchObject({ code: "signer_unavailable" });
      expect(request).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold + 1,
      );
    },
  );
  it("logs the original transport cause while preserving the signer refusal", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const proxy = createSignerProxy({
        ...targets,
        fetch: async () => {
          throw Object.assign(
            new Error(
              "connect failed https://intake.test/private?api-key=secret",
            ),
            { code: "ECONNREFUSED" },
          );
        },
      });
      await expect(
        proxy("intake", {}, "hash", z.unknown()),
      ).rejects.toMatchObject({
        status: 503,
        code: "signer_unavailable",
      });
      expect(write).toHaveBeenCalledWith(
        `${JSON.stringify({
          level: "warn",
          reason: "signer_request_failed",
          cause: { code: "ECONNREFUSED", detail: "connect failed <redacted>" },
        })}\n`,
      );
    } finally {
      write.mockRestore();
    }
  });
  it("coalesces both readiness probes and caches for five seconds", async () => {
    let now = 0;
    const request = vi.fn(async () =>
      Response.json(
        { ok: false, key: { ok: false, reason: "role_disabled" } },
        { status: 503 },
      ),
    );
    const ready = createSignerReadiness({
      ...targets,
      fetch: request,
      now: () => now,
    });
    const replies = await Promise.all(
      Array.from({ length: 20 }, () => ready()),
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(replies[0]).toEqual({
      intake: "role_disabled",
      quote: "role_disabled",
    });
    now = 4999;
    await ready();
    expect(request).toHaveBeenCalledTimes(2);
    now = 5000;
    await ready();
    expect(request).toHaveBeenCalledTimes(4);
  });
});
