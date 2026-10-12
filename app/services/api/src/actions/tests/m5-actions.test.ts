import "./setup.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { createApi } from "../../app.js";
import { InMemoryLinkRateLimiter } from "../../link/ratelimit.js";
import { XrayError } from "../../xray/error.js";
import { ActionGetResponseSchema } from "../spec.js";
const result = XrayResultSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../__fixtures__/xray-result.json", import.meta.url),
      "utf8",
    ),
  ),
);
function harness(
  on = true,
  cluster: "mainnet-beta" | "devnet" | "localnet" = "mainnet-beta",
) {
  let now = 0;
  const get = vi.fn(async () => structuredClone(result));
  const logger = { info: vi.fn() };
  const app = createApi(
    {
      WEB_ORIGIN: "https://onepercent.test",
      APP_VERSION: "test",
      GIT_COMMIT: "offline",
    },
    {
      blinksXray: on,
      cluster,
      xrayPort: { get },
      clock: () => now,
      linkRateLimiter: new InMemoryLinkRateLimiter(() => now),
      logger,
    },
  );
  return {
    app,
    get,
    logger,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("B1 X-ray Actions", () => {
  it("flags X-ray off by default with no links and refuses POST", async () => {
    const { app, get } = harness(false);
    const response = await app.request("/api/actions/xray");
    const body = ActionGetResponseSchema.parse(await response.json());
    expect(body.disabled).toBe(true);
    expect(body.error?.message).toBe("This Blink is off right now.");
    expect(body.links).toBeUndefined();
    const post = await app.request("/api/actions/xray", {
      method: "POST",
      body: JSON.stringify({ account: result.address }),
    });
    expect(post.status).toBe(403);
    expect(post.headers.get("Cache-Control")).toBe("no-store");
    expect(get).not.toHaveBeenCalled();
  });
  it("rejects retired names without scanning and forwards supported names unchanged", async () => {
    const { app, get } = harness();
    expect((await app.request("/api/actions/xray/alice.sol")).status).toBe(400);
    expect(get).not.toHaveBeenCalled();
    const response = await app.request("/api/actions/xray/ALICE.sns");
    expect(get).toHaveBeenCalledWith("ALICE.sns", undefined);
    expect((await response.json()).title).toBe(
      `X-ray: ${result.address.slice(0, 4)}…${result.address.slice(-4)}`,
    );
  });
  it.each([
    ["invalid_address", 400, "That’s not a Solana wallet address."],
    ["name_not_found", 404, "No wallet uses that name. Paste the address."],
  ] as const)(
    "maps X1 %s to copy and status 400",
    async (code, status, message) => {
      const { app, get } = harness();
      get.mockRejectedValue(new XrayError(code, status));
      const response = await app.request("/api/actions/xray/alice.sns");
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message });
    },
  );
  it.each(["mainnet-beta", "devnet", "localnet"] as const)(
    "uses mainnet for X-ray and the %s chain for other Actions",
    async (cluster) => {
      const { app } = harness(true, cluster);
      for (const method of ["GET", "POST", "OPTIONS"]) {
        expect(
          (await app.request("/api/actions/xray", { method })).headers.get(
            "X-Blockchain-Ids",
          ),
        ).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
        for (const route of ["rip/original", "feed", "highlight/1"])
          expect(
            (
              await app.request(`/api/actions/${route}`, { method })
            ).headers.get("X-Blockchain-Ids"),
          ).toBe(
            cluster === "mainnet-beta"
              ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
              : "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          );
      }
    },
  );
  it("charges cache misses only and coalesces concurrent reads", async () => {
    const h = harness();
    const path = `/api/actions/xray/${result.address}`;
    const first = await Promise.all(
      Array.from({ length: 20 }, () => h.app.request(path)),
    );
    expect(first.every((r) => r.status === 200)).toBe(true);
    expect(h.get).toHaveBeenCalledTimes(1);
    for (let i = 1; i < 60; i++)
      expect((await h.app.request(`${path}?ref=alias_${i}`)).status).toBe(200);
    const denied = await h.app.request(`${path}?ref=one_more`);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect((await h.app.request(path)).status).toBe(200);
    expect(h.get).toHaveBeenCalledTimes(60);
    h.advance(60_000);
    expect((await h.app.request(path)).status).toBe(200);
    expect(h.get).toHaveBeenCalledTimes(61);
  });
  it("reports local cache age without extending the 60-second lifetime", async () => {
    const h = harness();
    const path = `/api/actions/xray/${result.address}`;
    await h.app.request(path);
    h.advance(59_000);
    const hit = await h.app.request(path);
    expect(hit.headers.get("Age")).toBe("59");
    expect(hit.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(h.get).toHaveBeenCalledTimes(1);
    h.advance(1_000);
    await h.app.request(path);
    expect(h.get).toHaveBeenCalledTimes(2);
  });
  it("ignores unknown query parameters and Host while sharing GET and HEAD entries", async () => {
    const h = harness();
    const path = `/api/actions/xray/${result.address}`;
    const head = await h.app.request(`https://first.test${path}?x=first`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        h.app.request(`https://host-${i}.test${path}?x=${i}&unused=${i}`),
      ),
    );
    expect(h.get).toHaveBeenCalledOnce();
    for (const response of responses)
      expect(
        ActionGetResponseSchema.parse(await response.json()).title,
      ).toContain("X-ray:");
    expect(
      (await h.app.request(`${path}?x=last`, { method: "HEAD" })).status,
    ).toBe(200);
    expect(h.get).toHaveBeenCalledOnce();
    await h.app.request(`${path}?ref=another_user&x=last`);
    expect(h.get).toHaveBeenCalledTimes(2);
  });
  it("shares a transient X-ray failure only with concurrent readers, then retries", async () => {
    const h = harness();
    const path = `/api/actions/xray/${result.address}`;
    let rejectRead!: (error: Error) => void;
    h.get.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    const pending = Promise.all(
      Array.from({ length: 20 }, (_, i) => h.app.request(`${path}?x=${i}`)),
    );
    await vi.waitFor(() => expect(h.get).toHaveBeenCalledOnce());
    rejectRead(new Error("Unavailable"));
    for (const failed of await pending) {
      expect(failed.status).toBe(200);
      expect(failed.headers.get("Cache-Control")).toBe("no-store");
      expect((await failed.json()).error.message).toBe(
        "The X-ray is busy. Try again in a minute.",
      );
    }
    expect(h.get).toHaveBeenCalledOnce();
    const retried = await h.app.request(path);
    expect(retried.status).toBe(200);
    expect((await retried.json()).error).toBeUndefined();
    expect(retried.headers.get("Cache-Control")).toBe("public, max-age=60");
    await h.app.request(path);
    expect(h.get).toHaveBeenCalledTimes(2);
  });
  it("limits uncached POST responses and keeps errors in copy", async () => {
    const { app } = harness();
    for (let i = 0; i < 120; i++)
      expect(
        (await app.request("/api/actions/xray", { method: "POST", body: "{}" }))
          .status,
      ).toBe(400);
    const limited = await app.request("/api/actions/xray", {
      method: "POST",
      body: "{}",
    });
    expect(limited.status).toBe(429);
    expect(
      (await (await app.request("/api/actions/missing")).json()).message,
    ).toBe("Nothing here. The machine is this way.");
  });
});
