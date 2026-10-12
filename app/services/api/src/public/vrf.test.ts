import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
import type { DraftConfig } from "./data/index.js";
import type { ServiceRuntime } from "@onepercent/service-kit";

vi.mock("@onepercent/config", async (original) => ({
  ...(await original<typeof import("@onepercent/config")>()),
  BPS_DENOMINATOR: 10000,
  VRF: { busyOccupancyBps: 8000, busyOldestItemSeconds: 20 },
  MONITOR: { vrfQueueOccupancyAlertBps: 5000 },
}));
const { createPublicVrf } = await import("./vrf.js");
const readFixture = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../../packages/sdk/src/vrf/fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    source: { address: string };
    response: {
      result: {
        context: { slot: number };
        value: { owner: string; data: [string, string] };
      };
    };
  };
function setup(owner: string, data: Buffer, slot: number) {
  const runtime = {
    rpc: {
      account: vi.fn().mockResolvedValue({
        owner: new PublicKey(owner),
        data,
        slot,
        executable: false,
      }),
      chainNow: vi.fn().mockResolvedValue(2000n),
      request: vi.fn().mockResolvedValue(1900),
    },
    alerts: { alert: vi.fn().mockResolvedValue(undefined) },
    metrics: {
      vrfQueueOccupancyBps: { set: vi.fn() },
      vrfQueueOldestItemSeconds: { set: vi.fn() },
    },
  };
  return {
    runtime,
    read: createPublicVrf(
      runtime as unknown as Pick<ServiceRuntime, "rpc" | "alerts" | "metrics">,
    ),
  };
}
describe("public VRF chain age", () => {
  it("resolves the oldest active slot via block time and publishes busy without any write", async () => {
    const fixture = await readFixture("devnet");
    const account = fixture.response.result;
    const { runtime, read } = setup(
      account.value.owner,
      Buffer.from(account.value.data[0], "base64"),
      account.context.slot,
    );
    const state = {
      vrf: { queues: [fixture.source.address], activeIndex: 0 },
      vrfProgram: account.value.owner,
    } as DraftConfig;
    const result = await read(state);
    expect(result.busy).toBe(true);
    expect(result.oldestItemAgeSeconds).toBe(100);
    expect(runtime.rpc.request.mock.calls[0]![0]).toBe("getBlockTime");
    expect(runtime.metrics.vrfQueueOccupancyBps.set).toHaveBeenCalledWith(
      result.occupancyBps,
    );
  });
  it("does not fetch block time for an empty queue", async () => {
    const fixture = await readFixture("mainnet-beta");
    const account = fixture.response.result;
    const { runtime, read } = setup(
      account.value.owner,
      Buffer.from(account.value.data[0], "base64"),
      account.context.slot,
    );
    const result = await read({
      vrf: { queues: [fixture.source.address], activeIndex: 0 },
      vrfProgram: account.value.owner,
    } as DraftConfig);
    expect(result).toEqual({
      queue: fixture.source.address,
      occupancyBps: 0,
      oldestItemAgeSeconds: 0,
      busy: false,
    });
    expect(runtime.rpc.request).not.toHaveBeenCalled();
  });
  it("reports unknown fields and alerts when owner or block time cannot be validated", async () => {
    const fixture = await readFixture("devnet");
    const account = fixture.response.result;
    const { runtime, read } = setup(
      account.value.owner,
      Buffer.from(account.value.data[0], "base64"),
      account.context.slot,
    );
    const state = {
      vrf: { queues: [fixture.source.address], activeIndex: 0 },
      vrfProgram: "11111111111111111111111111111111",
    } as DraftConfig;
    expect(await read(state)).toEqual({
      queue: null,
      occupancyBps: null,
      oldestItemAgeSeconds: null,
      busy: false,
    });
    expect(runtime.alerts.alert).toHaveBeenCalledWith(
      "vrf_queue_unavailable",
      "warning",
      { queue: fixture.source.address },
    );
  });
});
