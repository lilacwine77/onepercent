import "./setup.js";
import { Hono } from "hono";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { hashClientIp } from "@onepercent/service-kit";
import { ConfigResponse, MachineResponse } from "@onepercent/sdk/api";
import { PACK_EDITIONS } from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import { config, machine } from "../../public/__fixtures__/responses.js";

const PROGRAM_ID = new PublicKey(new Uint8Array(32).fill(42));
const snapshots = vi.hoisted(() => ({
  config: vi.fn(),
  machine: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../../public/data/index.js", () => ({
  createPublicData: (options: unknown) => {
    snapshots.create(options);
    return { config: snapshots.config, machine: snapshots.machine };
  },
}));
vi.mock("../../public/vrf.js", () => ({ createPublicVrf: () => vi.fn() }));
vi.mock("../../public/index.js", () => ({ registerPublic: vi.fn() }));
import { createRipDependencies } from "../runtime.js";
import { createApi } from "../../app.js";
import { createRipService, registerRip } from "../rip.js";
import { registerBlinkImages } from "../images.js";
import { resolveActionCluster } from "../cluster.js";

function runtime() {
  return {
    role: "public",
    key: null,
    env: {
      CLUSTER: "devnet",
      PROGRAM_ID: PROGRAM_ID.toBase58(),
      LOG_IP_SALT: "offline-ip-salt",
    },
    rpc: { chainNow: vi.fn(async () => 42n), request: vi.fn() },
    redis: { eval: vi.fn(async () => [1, 0]) },
    pool: {},
    logger: { info: vi.fn() },
  };
}
function onAir() {
  snapshots.config.mockResolvedValue(
    ConfigResponse.parse({
      ...config,
      programId: PROGRAM_ID.toBase58(),
      phase: 3,
      flags: { ...config.flags, PACKS: true, BLINKS_RIP: true },
      season: { ...config.season, endTs: 99 },
    }),
  );
  snapshots.machine.mockResolvedValue(
    MachineResponse.parse({
      ...machine,
      phase: 3,
      deck: { len: 100, free: 100, reservedDust: "0" },
      coverage: { maxQty: [10, 10, 10, 5] },
    }),
  );
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Rip public runtime composition", () => {
  it("falls back from empty PUBLIC_API_URL and rejects invalid URLs at startup", () => {
    expect(
      createRipDependencies(undefined, "https://onepercent.test", {
        PUBLIC_API_URL: "",
      }).publicApiOrigin,
    ).toBe("https://onepercent.test");
    for (const value of [
      "invalid",
      "file:///tmp/icon",
      "https://user:pass@onepercent.test",
    ])
      expect(() =>
        createRipDependencies(undefined, "https://onepercent.test", {
          PUBLIC_API_URL: value,
        }),
      ).toThrow("Invalid API environment: PUBLIC_API_URL");
  });
  it("resolves one shared cluster precedence", () => {
    expect(resolveActionCluster(undefined, "devnet", "localnet")).toBe(
      "devnet",
    );
    expect(resolveActionCluster("mainnet-beta", "devnet")).toBe("mainnet-beta");
    expect(resolveActionCluster(undefined, "invalid")).toBe("mainnet-beta");
  });
  it("shares one in-flight snapshot across concurrent distinct GETs and images", async () => {
    onAir();
    const current = runtime();
    const deps = createRipDependencies(
      current as unknown as ServiceRuntime,
      "https://onepercent.test",
      { FLAG_BLINKS_RIP: "on", FLAG_PACKS: "on" },
    );
    const app = new Hono();
    const service = createRipService(deps);
    registerRip(app, deps, service);
    registerBlinkImages(app, deps, service, async () => new Uint8Array([1]));
    const paths = [
      ...Array.from({ length: 20 }, (_, i) => `/api/actions/rip?ref=user_${i}`),
      ...PACK_EDITIONS.map((edition) => `/api/actions/rip/${edition.id}`),
      ...PACK_EDITIONS.map((edition) => `/api/og/blink/rip/${edition.id}.png`),
      "/api/og/blink/rip.png",
    ];
    const responses = await Promise.all(paths.map((path) => app.request(path)));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(snapshots.config).toHaveBeenCalledOnce();
    expect(snapshots.machine).toHaveBeenCalledOnce();
    expect(current.rpc.chainNow).toHaveBeenCalledOnce();
  });
  it("reuses snapshots for at most two seconds while fresh reads always bypass them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    onAir();
    const current = runtime();
    const deps = createRipDependencies(
      current as unknown as ServiceRuntime,
      "https://onepercent.test",
      { FLAG_BLINKS_RIP: "on", FLAG_PACKS: "on" },
    );
    const first = await deps.snapshot();
    vi.setSystemTime(11_999);
    expect(await deps.snapshot()).toBe(first);
    expect(snapshots.config).toHaveBeenCalledOnce();
    expect(await deps.snapshot({ fresh: true })).not.toBe(first);
    expect(snapshots.config).toHaveBeenCalledTimes(2);
    vi.setSystemTime(12_000);
    expect(await deps.snapshot()).not.toBe(first);
    expect(snapshots.config).toHaveBeenCalledTimes(3);
    vi.setSystemTime(14_000);
    snapshots.config.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(deps.snapshot()).rejects.toThrow("Unavailable");
    expect((await deps.snapshot()).machine).not.toBeNull();
    expect(snapshots.config).toHaveBeenCalledTimes(5);
  });
  it("keeps flag-off and predeploy GET independent of machine/RPC availability", async () => {
    const current = runtime();
    const deps = createRipDependencies(
      current as unknown as ServiceRuntime,
      "https://onepercent.test",
      {},
    );
    const off = await deps.snapshot();
    expect(off.config.flags.BLINKS_RIP).toBe(false);
    expect(off.config.programId).toBe(current.env.PROGRAM_ID);
    expect(off.machine).toBeNull();
    expect(snapshots.config).not.toHaveBeenCalled();
    expect(current.rpc.chainNow).not.toHaveBeenCalled();
    const missing = createRipDependencies(
      undefined,
      "https://onepercent.test",
      {
        FLAG_BLINKS_RIP: "on",
        FLAG_PACKS: "on",
        CLUSTER: "localnet",
        PROGRAM_ID: PROGRAM_ID.toBase58(),
      },
    );
    const predeploy = await missing.snapshot();
    expect(predeploy.config.phase).toBeNull();
    expect(predeploy.machine).toBeNull();
    expect(predeploy.config.cluster).toBe("localnet");
    expect(predeploy.config.programId).toBe(PROGRAM_ID.toBase58());
  });
  it("never substitutes an IDL address for missing runtime configuration", async () => {
    const deps = createRipDependencies(
      undefined,
      "https://onepercent.test",
      {},
    );
    await expect(deps.snapshot()).rejects.toThrow();
    expect(snapshots.create).not.toHaveBeenCalled();
  });
  it("uses S4 in-process snapshots and confirmed chain time, never the host time for gates", async () => {
    onAir();
    const current = runtime();
    const deps = createRipDependencies(
      current as unknown as ServiceRuntime,
      "https://onepercent.test",
      {
        FLAG_BLINKS_RIP: "on",
        FLAG_PACKS: "on",
        PUBLIC_API_URL: "https://api.onepercent.test",
      },
    );
    const before = Date.now();
    const snapshot = await deps.snapshot();
    expect(snapshot.nowTs).toBe(42);
    expect(snapshot.asOfMs).toBeGreaterThanOrEqual(before);
    expect(snapshot.machine!.coverage.maxQty).toEqual([10, 10, 10, 5]);
    expect(snapshots.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: current,
        flags: expect.objectContaining({ BLINKS_RIP: true, PACKS: true }),
      }),
    );
    expect(current.rpc.chainNow).toHaveBeenCalledOnce();
    current.rpc.request.mockResolvedValueOnce("read");
    expect(await deps.rpc.request("test", [], z.string())).toBe("read");
    expect(current.rpc.request).toHaveBeenCalledWith(
      "test",
      [],
      expect.anything(),
      undefined,
    );
    expect(deps.publicApiOrigin).toBe("https://api.onepercent.test");
  });
  it("keeps null phase independent of the machine read", async () => {
    snapshots.config.mockResolvedValue(
      ConfigResponse.parse({
        ...config,
        phase: null,
        flags: { ...config.flags, PACKS: true, BLINKS_RIP: true },
      }),
    );
    const current = runtime();
    const deps = createRipDependencies(
      current as unknown as ServiceRuntime,
      "https://onepercent.test",
      { FLAG_BLINKS_RIP: "on", FLAG_PACKS: "on" },
    );
    expect((await deps.snapshot()).machine).toBeNull();
    expect(snapshots.machine).not.toHaveBeenCalled();
    expect(current.rpc.chainNow).not.toHaveBeenCalled();
  });
  it("uses salted client identity and the shared Redis window", async () => {
    const current = runtime();
    const deps = createRipDependencies(
      current as unknown as ServiceRuntime,
      "https://onepercent.test",
      { TRUST_PROXY_HEADER: "x-real-ip" },
    );
    const app = new Hono();
    app.get("/", (context) => context.text(deps.clientIp(context)));
    const identity = await (
      await app.request("/", { headers: { "x-real-ip": "192.0.2.5" } })
    ).text();
    expect(identity).toBe(hashClientIp(current.env.LOG_IP_SALT, "192.0.2.5"));
    expect(identity).not.toContain("192.0.2.5");
    expect(
      await deps.limiter.consume("blink:rip:hashed", {
        limit: 6,
        windowMs: 60_000,
      }),
    ).toEqual({ ok: true, retryAfterS: 0 });
    expect(current.redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `devnet:${PROGRAM_ID.toBase58()}:blink:rip:hashed`,
      6,
      60_000,
      expect.any(String),
    );
  });
  it.each(["keeper", "intake-signer"])(
    "refuses the %s runtime when Rip uses it",
    async (role) => {
      const current = { ...runtime(), role };
      const deps = createRipDependencies(
        current as unknown as ServiceRuntime,
        "https://onepercent.test",
        { FLAG_BLINKS_RIP: "on", FLAG_PACKS: "on" },
      );
      await expect(deps.snapshot()).rejects.toThrow("public_role_required");
      await expect(deps.rpc.request("test", [], z.unknown())).rejects.toThrow(
        "public_role_required",
      );
      expect(() =>
        deps.limiter.consume("test", { limit: 1, windowMs: 1_000 }),
      ).toThrow("public_role_required");
      expect(snapshots.create).not.toHaveBeenCalled();
    },
  );
  it("defers dormant dependencies for an enclosing service with a partial runtime", async () => {
    const partial = { logger: { info: vi.fn() } } as unknown as ServiceRuntime;
    const deps = createRipDependencies(partial, "https://onepercent.test", {
      PROGRAM_ID: PROGRAM_ID.toBase58(),
    });
    expect((await deps.snapshot()).config.flags.BLINKS_RIP).toBe(false);
    expect(snapshots.create).not.toHaveBeenCalled();
    await expect(deps.rpc.request("test", [], z.unknown())).rejects.toThrow(
      "public_role_required",
    );
  });
  it("refuses a public runtime carrying signing material at first active use", async () => {
    const current = { ...runtime(), key: {} } as unknown as ServiceRuntime;
    const deps = createRipDependencies(current, "https://onepercent.test", {
      FLAG_BLINKS_RIP: "on",
      FLAG_PACKS: "on",
    });
    await expect(deps.snapshot()).rejects.toThrow("public_role_required");
  });
  it("wires createApi publicRuntime to live Rip and logs only route, outcome and latency", async () => {
    onAir();
    vi.stubEnv("FLAG_BLINKS_RIP", "on");
    vi.stubEnv("FLAG_PACKS", "on");
    const current = runtime();
    const app = createApi(
      {
        WEB_ORIGIN: "https://onepercent.test",
        APP_VERSION: "test",
        GIT_COMMIT: "offline",
      },
      {
        publicRuntime: current as unknown as ServiceRuntime,
        logger: { info: vi.fn() },
      },
    );
    const response = await app.request("/api/actions/rip/original?ref=alice_1");
    expect(response.status).toBe(200);
    expect((await response.json()).links.actions).toHaveLength(2);
    expect(response.headers.get("X-Blockchain-Ids")).toBe(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    );
    expect(snapshots.create).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: current }),
    );
    expect(current.logger.info).toHaveBeenCalledWith(
      { route: "rip-edition", outcome: "ok", latencyMs: expect.any(Number) },
      "blink request",
    );
    expect(JSON.stringify(current.logger.info.mock.calls)).not.toContain(
      "alice_1",
    );
  });
});
