import { createHash } from "node:crypto";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { FeatureFlags } from "@onepercent/sdk/api";
import { SystemProgram } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { createPublicData, readIndexerStatus } from "./index.js";
import { me, publicKey, flags } from "../__fixtures__/responses.js";
import { settings } from "../__fixtures__/settings.js";
import { readStatusMirror } from "./mirror.js";

vi.mock("./mirror.js", () => ({
  readMeMirror: async () => ({ ...me, asOfSlot: 100 }),
  readStatusMirror: vi.fn(),
  readVerifyMirror: vi.fn(),
}));
vi.mock("../settings.js", async (original) => {
  const { settings: fixture } = await import("../__fixtures__/settings.js");
  return {
    ...(await original<typeof import("../settings.js")>()),
    loadPublicSettings: () => fixture,
  };
});
function setup(
  len: number,
  cap: number,
  mode: "stable" | "advancing" | "mutating" = "stable",
) {
  const data = Buffer.alloc(112 + cap * 56);
  createHash("sha256").update("account:Binder").digest().copy(data, 0, 0, 8);
  data.writeUInt16LE(len, 104);
  data.writeUInt16LE(cap, 106);
  for (let i = 0; i < len; i++)
    data.writeBigUInt64LE(BigInt(i + 1), 112 + i * 56 + 32);
  let calls = 0;
  const request = vi.fn(async (_method: string, params: unknown[]) => {
    const config = params[1] as {
      dataSlice: { offset: number; length: number };
      minContextSlot?: number;
    };
    const { offset, length } = config.dataSlice;
    expect(length).toBeLessThanOrEqual(65536);
    if (offset > 0) expect(config.minContextSlot).toBeGreaterThanOrEqual(100);
    const slot = mode === "advancing" ? 100 + calls : 100;
    if (mode === "mutating" && offset === 0) data.writeUInt32LE(calls, 88);
    calls++;
    return {
      context: { slot },
      value: {
        owner: publicKey,
        executable: false,
        data: [
          data.subarray(offset, offset + length).toString("base64"),
          "base64",
        ],
      },
    };
  });
  const runtime = {
    rpc: { request },
    env: { PROGRAM_ID: publicKey },
  } as unknown as ServiceRuntime;
  return {
    request,
    reader: createPublicData({ runtime, flags: FeatureFlags.parse(flags) }),
  };
}
describe("bounded Binder reads", () => {
  it("treats a pre-funded System-owned empty address as no Binder", async () => {
    const { reader, request } = setup(0, 0);
    request.mockResolvedValue({
      context: { slot: 100 },
      value: {
        owner: SystemProgram.programId.toBase58(),
        executable: false,
        data: ["", "base64"],
      },
    });
    expect((await reader.me(publicKey)).binder).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { owner: "So11111111111111111111111111111111111111112", executable: false },
    { owner: SystemProgram.programId.toBase58(), executable: true },
  ])(
    "refuses a foreign or executable empty Binder address %j",
    async (account) => {
      const { reader, request } = setup(0, 0);
      request.mockResolvedValue({
        context: { slot: 100 },
        value: { ...account, data: ["", "base64"] },
      });
      await expect(reader.me(publicKey)).rejects.toThrow(
        "account_owner_mismatch",
      );
    },
  );
  it("reads active cards in slices without downloading reserved capacity", async () => {
    const { request, reader } = setup(1200, 65535);
    const result = await reader.me(publicKey);
    expect(result.binder?.cards).toHaveLength(1200);
    expect(result.binder?.cards[1199]).toMatchObject({
      index: 1199,
      amount: "1200",
    });
    expect(request).toHaveBeenCalledTimes(4);
    const lengths = request.mock.calls.map(
      ([, params]) =>
        (params[1] as { dataSlice: { length: number } }).dataSlice.length,
    );
    expect(lengths.reduce((a, b) => a + b, 0)).toBe(224 + 1200 * 56);
  });
  it("reads only the header for an empty Binder", async () => {
    const { reader, request } = setup(0, 1000);
    expect((await reader.me(publicKey)).binder?.cards).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("retries once when the Binder header changes during slice reads", async () => {
    const { reader, request } = setup(1, 1, "mutating");
    await expect(reader.me(publicKey)).rejects.toThrow("inconsistent_snapshot");
    expect(request).toHaveBeenCalledTimes(6);
  });
  it("allows confirmed slots to advance while the Binder header stays stable", async () => {
    const { reader, request } = setup(2400, 65535, "advancing");
    expect((await reader.me(publicKey)).binder?.cards).toHaveLength(2400);
    expect(request).toHaveBeenCalledTimes(5);
  });
});
describe("indexer scan telemetry", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const maxAgeMs =
    settings.indexer.pollMs +
    settings.transport.rpcTimeoutMs +
    settings.transport.dbStatementTimeoutMs +
    settings.transport.redisCommandTimeoutMs;
  const heartbeat = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      asOfSlot: "1000",
      scanSlot: "1000",
      lastEventSlot: "100",
      confirmedSlot: "1000",
      lagSlots: "0",
      checkedAt: new Date(now).toISOString(),
      ...overrides,
    });
  const read = (raw: string | null, currentSlot = 1012) =>
    readIndexerStatus(
      { get: async () => raw },
      currentSlot,
      settings,
      () => now,
    );

  it("recomputes lag from the current core slot and scan watermark, ignoring a cached zero", async () => {
    const get = vi.fn(async () => heartbeat());
    expect(await readIndexerStatus({ get }, 1012, settings, () => now)).toEqual(
      { lagSlots: 12 },
    );
    expect(get).toHaveBeenCalledWith("onepct:indexer:status");
    expect(await read(heartbeat(), 1000)).toEqual({ lagSlots: 0 });
    // Redis may advance after the API's confirmed account read.
    expect(await read(heartbeat({ scanSlot: "1013" }))).toEqual({
      lagSlots: 0,
    });
  });

  it("treats a stopped indexer's old successful heartbeat as unknown", async () => {
    expect(
      await read(
        heartbeat({ checkedAt: new Date(now - maxAgeMs + 1).toISOString() }),
      ),
    ).toEqual({ lagSlots: 12 });
    for (const elapsed of [maxAgeMs, maxAgeMs + 1, maxAgeMs * 10]) {
      expect(
        await read(
          heartbeat({ checkedAt: new Date(now - elapsed).toISOString() }),
        ),
      ).toEqual({ lagSlots: null });
    }
    // S1 stale() preserves the last successful checkedAt on poll_failed.
    expect(
      await read(
        heartbeat({
          available: false,
          reason: "poll_failed",
          checkedAt: new Date(now - maxAgeMs).toISOString(),
        }),
      ),
    ).toEqual({ lagSlots: null });
  });

  it("includes the Redis read duration in heartbeat freshness", async () => {
    let time = now;
    const get = async () => {
      time += maxAgeMs;
      return heartbeat();
    };
    expect(
      await readIndexerStatus({ get }, 1012, settings, () => time),
    ).toEqual({ lagSlots: null });
  });

  it.each([
    null,
    "invalid",
    '{"available":false}',
    heartbeat({ scanSlot: "9007199254740993" }),
    heartbeat({ scanSlot: null }),
    heartbeat({ scanSlot: undefined }),
    heartbeat({ checkedAt: undefined }),
    heartbeat({ checkedAt: "invalid" }),
    heartbeat({ checkedAt: new Date(now + 1).toISOString() }),
  ])(
    "does not manufacture healthy lag from malformed or future telemetry: %s",
    async (raw) => {
      expect(await read(raw)).toEqual({ lagSlots: null });
    },
  );

  it("status uses fresh account context even when both S1's old tip and mirror are behind", async () => {
    const config = Buffer.alloc(872),
      machine = Buffer.alloc(3808);
    for (const [name, data] of [
      ["Config", config],
      ["Machine", machine],
    ] as const)
      createHash("sha256")
        .update(`account:${name}`)
        .digest()
        .copy(data, 0, 0, 8);
    config.writeUInt8(1, 736);
    machine.writeUInt8(1, 8);
    let coreSlot = 1012;
    const request = vi.fn(async () => ({
      context: { slot: coreSlot },
      value: [config, machine].map((data) => ({
        owner: publicKey,
        executable: false,
        data: [data.toString("base64"), "base64"],
      })),
    }));
    vi.mocked(readStatusMirror).mockResolvedValue({
      asOfSlot: 100,
      keeper: { leader: true, lastSettleAgeSeconds: 2 },
    });
    const runtime = {
      env: { PROGRAM_ID: publicKey },
      rpc: { request },
      redis: {
        get: async () => heartbeat({ checkedAt: new Date().toISOString() }),
      },
      pool: {},
    } as unknown as ServiceRuntime;
    const reader = createPublicData({
      runtime,
      flags: FeatureFlags.parse(flags),
    });
    const result = await reader.status();
    expect(result.indexer).toEqual({ lagSlots: 12 });
    expect(result.asOfSlot).toBe(100);
    coreSlot = 1025;
    expect((await reader.status()).indexer).toEqual({ lagSlots: 25 });
    expect(request).toHaveBeenCalledWith(
      "getMultipleAccounts",
      expect.any(Array),
      expect.anything(),
    );
  });
});
