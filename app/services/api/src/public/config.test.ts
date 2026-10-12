import { createHash } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { ConfigResponse, FeatureFlags } from "@onepercent/sdk/api";
import { registerPublic } from "./index.js";
import { flags as disabledFlags, publicKey } from "./__fixtures__/responses.js";

// Synthetic hash metadata only; no economic defaults are introduced.
const compiled = vi.hoisted(() => ({
  keys: undefined as unknown,
  value: undefined as unknown,
  validate: vi.fn(),
  settingsLoads: 0,
}));
vi.mock("@onepercent/config", async (original) => ({
  ...(await original<typeof import("@onepercent/config")>()),
  get ONCHAIN_KEYS() {
    return compiled.keys;
  },
  resolveOnchainKey: () => compiled.value,
  validateParams: () => compiled.validate(),
}));
vi.mock("./settings.js", async (original) => ({
  ...(await original<typeof import("./settings.js")>()),
  loadPublicSettings: () => {
    compiled.settingsLoads++;
    throw new Error("public_parameters_unavailable");
  },
}));
vi.mock("./env.js", () => ({
  loadPublicEnv: () => ({
    flags: FeatureFlags.parse({ ...disabledFlags, XRAY: true }),
  }),
}));
function account(name: "Config" | "Machine", malformed = false) {
  const data = Buffer.alloc(malformed ? 8 : name === "Config" ? 872 : 3808);
  createHash("sha256").update(`account:${name}`).digest().copy(data, 0, 0, 8);
  if (!malformed) {
    data[name === "Config" ? 736 : 8] = 1;
    if (name === "Machine") data[10] = 2;
  }
  return {
    owner: publicKey,
    executable: false,
    data: [data.toString("base64"), "base64"],
  };
}
function setup(values: unknown[] = [null, null]) {
  const request = vi.fn(async () => ({
    context: { slot: 123 },
    value: values,
  }));
  const runtime = {
    role: "public",
    key: undefined,
    env: { PROGRAM_ID: publicKey, CLUSTER: "devnet" },
    rpc: { request },
    logger: { warn: vi.fn() },
  } as unknown as ServiceRuntime;
  const app = new Hono();
  registerPublic(app, runtime);
  return { app, request };
}
beforeEach(() => {
  compiled.keys = [{ path: "synthetic" }];
  compiled.value = 1n;
  compiled.validate.mockReset();
  compiled.settingsLoads = 0;
});
describe("D22 / M6 B14 public config", () => {
  it("keeps flags and identity without G1/P0, while other routes remain 503", async () => {
    compiled.keys = undefined;
    const { app, request } = setup();
    const response = await app.request("/api/config");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(ConfigResponse.parse(await response.json())).toEqual({
      cluster: "devnet",
      programId: publicKey,
      flags: { ...disabledFlags, XRAY: true },
      asOfSlot: null,
      paramsHash: null,
      phase: null,
      roles: null,
      vrf: null,
      season: null,
      paused: null,
    });
    expect(compiled.settingsLoads).toBe(0);
    expect(request).not.toHaveBeenCalled();
    for (const path of ["/api/machine", "/api/verify/1", "/api/stream"])
      expect((await app.request(path)).status).toBe(503);
    expect(compiled.settingsLoads).toBe(3);
  });
  it.each([
    [null, null],
    [account("Config"), null],
    [null, account("Machine")],
  ])(
    "returns known slot/hash and null chain sections for absent accounts",
    async (config, machine) => {
      const { app, request } = setup([config, machine]);
      const response = await app.request("/api/config");
      expect(response.status).toBe(200);
      const body = ConfigResponse.parse(await response.json());
      expect(body).toMatchObject({
        asOfSlot: 123,
        phase: null,
        roles: null,
        vrf: null,
        season: null,
        paused: null,
      });
      expect(body.paramsHash).toMatch(/^[a-f0-9]{64}$/);
      expect(request).toHaveBeenCalledOnce();
      expect(compiled.settingsLoads).toBe(0);
    },
  );
  it("serves deployed data independently of P0 service settings", async () => {
    const { app } = setup([account("Config"), account("Machine")]);
    const response = await app.request("/api/config");
    expect(response.status).toBe(200);
    expect(ConfigResponse.parse(await response.json())).toMatchObject({
      asOfSlot: 123,
      phase: 2,
      paused: 0,
      roles: { keeper: publicKey },
    });
    expect(compiled.settingsLoads).toBe(0);
  });
  it.each([
    [null, account("Machine", true)],
    [account("Config", true), null],
    [
      {
        ...account("Config"),
        owner: "So11111111111111111111111111111111111111112",
      },
      null,
    ],
  ])(
    "rejects malformed or foreign-owned accounts even when their peer is missing",
    async (config, machine) => {
      expect(
        (await setup([config, machine]).app.request("/api/config")).status,
      ).toBe(503);
    },
  );
  it("preserves RPC failures as sanitized 503 responses", async () => {
    const { app, request } = setup();
    request.mockRejectedValue(new Error("private provider details"));
    const response = await app.request("/api/config");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      asOfSlot: null,
      error: { code: "service_unavailable" },
    });
  });
  it.each(["invalid_exports", "invalid_parameters", "missing_value"])(
    "rejects invalid published configuration: %s",
    async (kind) => {
      if (kind === "invalid_exports") compiled.keys = [];
      if (kind === "invalid_parameters")
        compiled.validate.mockImplementation(() => {
          throw new Error("invalid parameters");
        });
      if (kind === "missing_value") compiled.value = undefined;
      const { app, request } = setup();
      expect((await app.request("/api/config")).status).toBe(503);
      expect(request).not.toHaveBeenCalled();
    },
  );
});
