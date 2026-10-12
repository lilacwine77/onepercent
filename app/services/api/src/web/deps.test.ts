import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDependencies } from "./deps.js";
import { createWebRouter } from "./router.js";

const settings = vi.hoisted(() => ({ loads: 0, unavailable: false }));
vi.mock("../public/settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../public/settings.js")>();
  return {
    ...actual,
    loadPublicSettings() {
      settings.loads++;
      if (settings.unavailable)
        throw new Error("public_parameters_unavailable");
      return actual.loadPublicSettings();
    },
  };
});
beforeEach(() => {
  settings.loads = 0;
  settings.unavailable = false;
});
const dependencies = () =>
  createWebDependencies({ XRAY_SOURCE: "fixtures", LOG_LEVEL: "silent" });
const request = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tx: "AQ==" }),
};

describe("lazy signed transport dependencies", () => {
  it("keeps bootstrap available without G1/P0 parameters", async () => {
    settings.unavailable = true;
    const app = createWebRouter(dependencies());
    expect((await app.request("/api/web/config")).status).toBe(200);
    expect(settings.loads).toBe(0);
    expect((await app.request("/api/send", request)).status).toBe(503);
    expect(settings.loads).toBe(1);
    expect((await app.request("/api/web/config")).status).toBe(200);
  });
  it("initializes both cached send dependencies only on the first send request", async () => {
    const deps = dependencies();
    const app = createWebRouter(deps);
    expect(settings.loads).toBe(0);
    expect((await app.request("/api/send", request)).status).toBe(400);
    expect(settings.loads).toBe(1);
    const sender = deps.sender;
    const limiter = deps.sendLimiter;
    expect((await app.request("/api/send", request)).status).toBe(400);
    expect(deps.sender).toBe(sender);
    expect(deps.sendLimiter).toBe(limiter);
    expect(settings.loads).toBe(1);
  });
});
