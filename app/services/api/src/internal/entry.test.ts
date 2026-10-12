import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  role: "intake-signer" as "intake-signer" | "quote-signer",
  mounted: false,
  listenedAfterMount: false,
  mount: vi.fn(),
  fail: vi.fn(),
  shutdown: vi.fn(),
}));
vi.mock("../roles.js", () => ({
  loadApiRole: () => ({ role: boundary.role, env: {} }),
}));
vi.mock("./startup.js", () => ({
  mountPrivateSigner: (runtime: unknown) => {
    boundary.mounted = true;
    boundary.mount(runtime);
  },
}));
vi.mock("@onepercent/service-kit", () => ({
  createRuntime: async () => ({
    role: boundary.role,
    health: new Hono(),
    logger: { info: vi.fn() },
    stop: vi.fn(async () => undefined),
  }),
  listenRuntime: () => {
    boundary.listenedAfterMount = boundary.mounted;
    return { close: vi.fn() };
  },
  installShutdown: boundary.shutdown,
  reportStartupFailure: boundary.fail,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  boundary.mounted = false;
  boundary.listenedAfterMount = false;
});

describe("D22 API private entrypoint", () => {
  it.each(["intake-signer", "quote-signer"] as const)(
    "mounts %s before its private listener starts",
    async (role) => {
      boundary.role = role;
      await import("../index.js");
      expect(boundary.fail).not.toHaveBeenCalled();
      expect(boundary.mount).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ role }),
      );
      expect(boundary.listenedAfterMount).toBe(true);
      expect(boundary.shutdown).toHaveBeenCalledOnce();
    },
  );
});
