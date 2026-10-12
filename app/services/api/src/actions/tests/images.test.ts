import "./setup.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import satori from "satori";
import { describe, expect, it, vi } from "vitest";
import { BLINKS, BLINKS_OPS, PACK_EDITIONS } from "@onepercent/config";
import { ConfigResponse, MachineResponse } from "@onepercent/sdk/api";
import { PHASE } from "@onepercent/sdk/constants";
import { BlinkRipCard, type BlinkRipCardProps } from "../../cards/blink-rip.js";
import { loadFonts } from "../../cards/render.js";
import * as fixture from "../../public/__fixtures__/responses.js";
import { registerBlinkImages, ripImageProps } from "../images.js";
import {
  createRipService,
  type RipDependencies,
  type RipSnapshot,
} from "../rip.js";

const origin = "https://onepercent.test";
const path = "/api/og/blink/rip/original.png";
const start = Date.parse("2026-10-09T12:34:56.789Z");
const ttl = BLINKS.liveNumbersMaxAgeSeconds * 1_000;
function snapshotAt(asOfMs: number): RipSnapshot {
  return {
    asOfMs,
    nowTs: Math.floor(asOfMs / 1_000),
    config: ConfigResponse.parse({
      ...fixture.config,
      flags: { ...fixture.flags, PACKS: true, BLINKS_RIP: true },
      phase: PHASE.onAir,
      season: {
        ...fixture.config.season,
        endTs: Math.floor(start / 1_000) + 3_600,
      },
    }),
    machine: MachineResponse.parse({
      ...fixture.machine,
      phase: PHASE.onAir,
      coverage: { maxQty: [5, 5, 5, 5] },
      deck: { len: 100, reservedDust: "0", free: 100 },
    }),
  };
}
function harness(realRender = false) {
  let now = start;
  const snapshot = vi.fn(async () => snapshotAt(now));
  const consume = vi.fn<RipDependencies["limiter"]["consume"]>(() => ({
    ok: true,
  }));
  const render = vi.fn<(props: BlinkRipCardProps) => Promise<Uint8Array>>(
    async () => new Uint8Array([1, 2, 3]),
  );
  const deps: RipDependencies = {
    webOrigin: origin,
    publicApiOrigin: origin,
    cluster: "devnet",
    snapshot,
    clock: () => now,
    rpc: {
      request: async () => {
        throw new Error("Images must not request a transaction");
      },
    },
    limiter: { consume },
    clientIp: (context) => context.req.header("x-test-ip") ?? "127.0.0.1",
  };
  const service = createRipService(deps);
  const app = new Hono();
  app.use("*", cors({ origin: [origin] }));
  registerBlinkImages(app, deps, service, realRender ? undefined : render);
  app.get("/health", (context) => context.json({ ok: true }));
  return {
    app,
    deps,
    service,
    snapshot,
    consume,
    render,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
function expectNoStore(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
}

describe("Blink image routes and placeholders", () => {
  it("I2.01 renders a real 1080-square PNG with the bounded public cache header", async () => {
    const h = harness(true);
    const response = await h.app.request(`${path}?m=0`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe(
      `public, max-age=${BLINKS.liveNumbersMaxAgeSeconds}`,
    );
    const png = Buffer.from(await response.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(BLINKS.imagePx);
    expect(png.readUInt32BE(20)).toBe(BLINKS.imagePx);
  });

  it("I2.02 uses the snapshot minute for props and printed SVG, never the m query", async () => {
    const h = harness();
    await h.app.request(`${path}?m=1`);
    const props = h.render.mock.calls[0]![0];
    expect(props).toEqual({
      edition: "original",
      name: PACK_EDITIONS[0].name,
      priceSol: "0.1",
      state: "covered",
      upTo: 5,
      jackpot: null,
      onePct: null,
      asOf: "12:34 UTC",
    });
    const svg = await satori(BlinkRipCard(props), {
      width: BLINKS.imagePx,
      height: BLINKS.imagePx,
      fonts: await loadFonts(),
      embedFont: false,
    });
    expect(svg.replace(/<[^>]*>/g, "")).toContain("as of 12:34 UTC");
    const generic = ripImageProps(snapshotAt(start), null, h.service);
    expect(generic).toMatchObject({
      edition: null,
      name: null,
      priceSol: null,
      upTo: null,
      state: "covered",
      asOf: "12:34 UTC",
    });
  });

  it("I2.03 caches per edition and minute, with remaining age and expiry", async () => {
    const h = harness();
    await h.app.request(`${path}?m=1`);
    h.advance(2_000);
    const cached = await h.app.request(`${path}?m=1`);
    expect(cached.headers.get("Cache-Control")).toBe("public, max-age=58");
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    expect(h.render).toHaveBeenCalledTimes(1);
    await h.app.request(`${path}?m=2`);
    await h.app.request("/api/og/blink/rip/blue_shift.png?m=2");
    await h.app.request("/api/og/blink/rip.png?m=2");
    expect(h.render).toHaveBeenCalledTimes(3);
    h.advance(2_000);
    expect((await h.app.request(`${path}?m=1`)).status).toBe(200);
    expect(h.render).toHaveBeenCalledTimes(4);
    h.advance(ttl);
    const refreshed = await h.app.request(`${path}?m=1`);
    expect(refreshed.headers.get("Cache-Control")).toBe(
      `public, max-age=${BLINKS.liveNumbersMaxAgeSeconds}`,
    );
    expect(h.render).toHaveBeenCalledTimes(5);
  });

  it("I2.03 coalesces concurrent renders for the same image", async () => {
    const h = harness();
    let allowQuota!: () => void;
    const quotaReady = new Promise<void>((resolve) => {
      allowQuota = resolve;
    });
    h.consume.mockImplementation(async () => {
      await quotaReady;
      return { ok: true };
    });
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    h.render.mockImplementation(async () => {
      await ready;
      return new Uint8Array([1]);
    });
    const first = h.app.request(`${path}?m=1`);
    const second = h.app.request(`${path}?m=999`);
    await vi.waitFor(() => expect(h.consume).toHaveBeenCalledTimes(1));
    expect(h.render).not.toHaveBeenCalled();
    allowQuota();
    await vi.waitFor(() => expect(h.render).toHaveBeenCalledTimes(1));
    finish();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    expect(h.consume).toHaveBeenCalledTimes(1);
  });

  it("I2.03 ignores client minute and unknown query values in the image cache key", async () => {
    const h = harness();
    for (let minute = 0; minute <= BLINKS_OPS.imageCacheEntries; minute++)
      expect(
        (await h.app.request(`${path}?m=${minute}&x=${minute}`)).status,
      ).toBe(200);
    expect(h.snapshot).toHaveBeenCalledOnce();
    expect(h.render).toHaveBeenCalledOnce();
    expect(h.consume).toHaveBeenCalledOnce();
  });

  it("I2.04 keeps an in-flight quota denial local to its client", async () => {
    const h = harness();
    let rejectFirstQuota!: () => void;
    const firstQuotaReady = new Promise<void>((resolve) => {
      rejectFirstQuota = resolve;
    });
    h.consume.mockImplementation(async (key) => {
      if (key === "blink:image:127.0.0.1") {
        await firstQuotaReady;
        return { ok: false, retryAfterS: 42 };
      }
      return { ok: true };
    });
    const first = h.app.request(path, {
      headers: { "x-test-ip": "127.0.0.1" },
    });
    const second = h.app.request(path, {
      headers: { "x-test-ip": "127.0.0.2" },
    });
    await vi.waitFor(() => expect(h.consume).toHaveBeenCalledOnce());
    rejectFirstQuota();
    const [denied, allowed] = await Promise.all([first, second]);
    expectNoStore(denied, 429);
    expect(denied.headers.get("Retry-After")).toBe("42");
    expect(allowed.status).toBe(200);
    expect(h.consume.mock.calls.map(([key]) => key)).toEqual([
      "blink:image:127.0.0.1",
      "blink:image:127.0.0.2",
    ]);
    expect(h.snapshot).toHaveBeenCalledOnce();
    expect(h.render).toHaveBeenCalledOnce();
  });

  it("I2.04 serves cached images without charging quota and limits new renders", async () => {
    const h = harness();
    expect((await h.app.request(path)).status).toBe(200);
    h.consume.mockReturnValue({ ok: false, retryAfterS: 42 });
    for (let count = 0; count <= BLINKS_OPS.imagesPerMinutePerIp; count++)
      expect((await h.app.request(path)).status).toBe(200);
    expect(h.consume).toHaveBeenCalledOnce();
    const limited = await h.app.request("/api/og/blink/rip/blue_shift.png");
    expectNoStore(limited, 429);
    expect(limited.headers.get("Retry-After")).toBe("42");
    expect(
      (await h.app.request(path, { headers: { "x-test-ip": "127.0.0.2" } }))
        .status,
    ).toBe(200);
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.consume).toHaveBeenCalledTimes(2);
    expect(h.consume).toHaveBeenLastCalledWith("blink:image:127.0.0.1", {
      limit: BLINKS_OPS.imagesPerMinutePerIp,
      windowMs: 60_000,
    });
  });

  it("preserves the host's restricted CORS for images and other routes", async () => {
    const h = harness();
    for (const target of [path, "/health"]) {
      const external = await h.app.request(target, {
        headers: { Origin: "https://dial.to" },
      });
      expect(external.headers.get("Access-Control-Allow-Origin")).toBeNull();
      const own = await h.app.request(target, { headers: { Origin: origin } });
      expect(own.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
  });

  it("keeps validation, upstream and render failures uncacheable, then retries", async () => {
    const h = harness();
    expectNoStore(await h.app.request("/api/og/blink/rip/unknown.png"), 404);
    expectNoStore(await h.app.request(`${path}?m=invalid`), 400);
    h.snapshot.mockRejectedValueOnce(new Error("Snapshot unavailable"));
    expectNoStore(await h.app.request(path), 503);
    h.render.mockRejectedValueOnce(new Error("Render unavailable"));
    expectNoStore(await h.app.request(path), 503);
    h.consume.mockRejectedValueOnce(new Error("Limiter unavailable"));
    expectNoStore(await h.app.request(path), 503);
    expect((await h.app.request(path)).status).toBe(200);
  });

  it.each([ttl, ttl + 1, -1])(
    "rejects snapshot age %i ms without rendering old or future numbers",
    async (age) => {
      const h = harness();
      h.snapshot.mockResolvedValue(snapshotAt(start - age));
      expectNoStore(await h.app.request(path), 503);
      expect(h.render).not.toHaveBeenCalled();
    },
  );

  it("subtracts rendering time from the public cache lifetime", async () => {
    const h = harness();
    h.render.mockImplementation(async () => {
      h.advance(1_500);
      return new Uint8Array([1]);
    });
    const response = await h.app.request(path);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=58");
  });
});
