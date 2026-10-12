import { describe, expect, it, vi } from "vitest";
import { createVrfMonitor, type VrfMonitorOptions } from "./monitoring.js";

const QUEUE = "11111111111111111111111111111111";
const OTHER = "Vote111111111111111111111111111111111111111";
const PROGRAM = "BPFLoaderUpgradeab1e11111111111111111111111";
const BUYER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const now = 200_000n;
function fixture(rows: unknown[] = []) {
  const request = vi.fn(async () => ({
    context: { slot: 99 },
    value: {
      owner: PROGRAM,
      executable: false,
      data: [Buffer.from([1]).toString("base64"), "base64"],
    },
  }));
  const query = vi.fn<
    (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows }));
  const options: VrfMonitorOptions = {
    rpc: { request: request as VrfMonitorOptions["rpc"]["request"] },
    pool: { query: query as unknown as VrfMonitorOptions["pool"]["query"] },
    metrics: {
      vrfLatencySeconds: { observe: vi.fn() },
      vrfExpiriesTotal: { inc: vi.fn() },
      vrfQueueOccupancyBps: { set: vi.fn() },
      vrfQueueOldestItemSeconds: { set: vi.fn() },
    } as unknown as VrfMonitorOptions["metrics"],
    alerts: { alert: vi.fn(async () => ({ recorded: true, delivered: true })) },
    decodeVrfQueue: vi.fn(() => ({
      capacityBytes: 100,
      usedBytes: 80,
      items: 1,
      oldestItemSlot: null,
      oldestItemTs: 199_970n,
    })),
    vrfProgramId: PROGRAM,
    occupancyAlertBps: 5000,
    expiriesPerThousandRipsAlert: 10,
    expiryClusterPerWallet24h: 3,
  };
  return { options, request, query, monitor: createVrfMonitor(options) };
}
const event = (identity: string, name: string, eventTime = 199_990) => ({
  identity,
  name,
  buyer: BUYER,
  eventTime: new Date(eventTime * 1000),
  openedTime: new Date((eventTime - 7) * 1000),
});

describe("VRF monitoring", () => {
  it("uses confirmed indexer block times, observes each event once, and queries chain time's 24h window", async () => {
    const { monitor, options, query } = fixture([
      event("1", "PullOpened"),
      event("2", "PullRevealed"),
      event("3", "PullRefunded"),
      event("3", "PullRefunded"),
    ]);
    await monitor.poll({ queues: [QUEUE], chainNow: now });
    const result = await monitor.poll({ queues: [QUEUE], chainNow: now });
    expect(
      options.metrics.vrfLatencySeconds.observe,
    ).toHaveBeenCalledExactlyOnceWith(7);
    expect(options.metrics.vrfExpiriesTotal.inc).toHaveBeenCalledTimes(1);
    expect(result.aggregates).toMatchObject({
      rips: 1,
      expiries: 1,
      expiriesPerThousandRips: 1000,
    });
    expect(query.mock.calls[0]?.[1]).toEqual([
      new Date((Number(now) - 86400) * 1000),
      new Date(Number(now) * 1000),
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("t.err IS NULL");
  });

  it("guards zero Rips but still alerts wallet expiry clusters", async () => {
    const { monitor, options } = fixture([
      event("1", "PullRefunded"),
      event("2", "PullRefunded"),
      event("3", "PullRefunded"),
    ]);
    const result = await monitor.poll({ queues: [], chainNow: now });
    expect(result.aggregates?.expiriesPerThousandRips).toBeNull();
    expect(options.alerts.alert).toHaveBeenCalledWith(
      `vrf_expiry_cluster:${BUYER}`,
      "warning",
      expect.objectContaining({ expiries: 3 }),
    );
    expect(options.alerts.alert).not.toHaveBeenCalledWith(
      "vrf_expiry_rate",
      expect.anything(),
      expect.anything(),
    );
  });

  it("reads every allowlisted queue and publishes maxima without a pause capability", async () => {
    const { monitor, options, request } = fixture();
    vi.mocked(options.decodeVrfQueue)
      .mockReturnValueOnce({
        capacityBytes: 100,
        usedBytes: 51,
        items: 1,
        oldestItemSlot: null,
        oldestItemTs: 199_980,
      })
      .mockReturnValueOnce({
        capacityBytes: 100,
        usedBytes: 91,
        items: 1,
        oldestItemSlot: null,
        oldestItemTs: 199_990,
      });
    const result = await monitor.poll({
      queues: [QUEUE, OTHER, QUEUE],
      chainNow: now,
    });
    expect(result.queues).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(options.metrics.vrfQueueOccupancyBps.set).toHaveBeenCalledWith(9100);
    expect(options.metrics.vrfQueueOldestItemSeconds.set).toHaveBeenCalledWith(
      20,
    );
    expect(options.alerts.alert).toHaveBeenCalledWith(
      `vrf_queue_occupancy:${QUEUE}`,
      "warning",
      expect.anything(),
    );
    expect(options.alerts.alert).toHaveBeenCalledWith(
      `vrf_queue_occupancy:${OTHER}`,
      "warning",
      expect.anything(),
    );
  });

  it("contains queue, database and alert failures instead of rejecting exits", async () => {
    const { monitor, options, query } = fixture();
    vi.mocked(options.decodeVrfQueue).mockImplementation(() => {
      throw new Error("bad_fixture");
    });
    query.mockRejectedValue(new Error("database_offline"));
    vi.mocked(options.alerts.alert).mockRejectedValue(
      new Error("alert_offline"),
    );
    const result = await monitor.poll({ queues: [QUEUE], chainNow: now });
    expect(result.failures).toEqual([
      "queue_read",
      "alert_delivery",
      "indexer_read",
    ]);
    expect(options.metrics.vrfQueueOccupancyBps.set).toHaveBeenCalledWith(
      Number.NaN,
    );
  });

  it("validates queue ownership and future item times before publishing", async () => {
    const { monitor, request, options } = fixture();
    request.mockResolvedValueOnce({
      context: { slot: 1 },
      value: { owner: OTHER, executable: false, data: ["AQ==", "base64"] },
    });
    expect(
      (await monitor.poll({ queues: [QUEUE], chainNow: now })).failures,
    ).toContain("queue_read");
    expect(options.decodeVrfQueue).not.toHaveBeenCalled();
    vi.mocked(options.decodeVrfQueue).mockReturnValue({
      capacityBytes: 10,
      usedBytes: 1,
      items: 1,
      oldestItemSlot: null,
      oldestItemTs: now + 1n,
    });
    expect(
      (await monitor.poll({ queues: [QUEUE], chainNow: now })).queues,
    ).toHaveLength(0);
  });

  it("coalesces concurrent polls and waits for a missing opener before observing latency", async () => {
    const row = {
      ...event("1", "PullRevealed"),
      openedTime: null as Date | null,
    };
    const { monitor, options } = fixture([row]);
    const first = monitor.poll({ queues: [], chainNow: now });
    const second = monitor.poll({ queues: [], chainNow: now });
    expect(second).toBe(first);
    await first;
    expect(options.metrics.vrfLatencySeconds.observe).not.toHaveBeenCalled();
    row.openedTime = new Date(199_980_000);
    await monitor.poll({ queues: [], chainNow: now });
    expect(
      options.metrics.vrfLatencySeconds.observe,
    ).toHaveBeenCalledExactlyOnceWith(10);
  });
});

it("alerts on fractional occupancy above the threshold without rounding it away", async () => {
  const { monitor, options } = fixture();
  vi.mocked(options.decodeVrfQueue).mockReturnValue({
    capacityBytes: 30000,
    usedBytes: 15001,
    items: 1,
    oldestItemSlot: null,
    oldestItemTs: now,
  });
  const report = await monitor.poll({ queues: [QUEUE], chainNow: now });
  expect(report.queues[0]!.occupancyBps).toBeGreaterThan(5000);
  expect(options.alerts.alert).toHaveBeenCalledWith(
    `vrf_queue_occupancy:${QUEUE}`,
    "warning",
    expect.anything(),
  );
});

it("marks unlabeled gauges unknown when any listed queue is unreadable", async () => {
  const { monitor, options, request } = fixture();
  request.mockRejectedValueOnce(new Error("rpc_unavailable"));
  const report = await monitor.poll({ queues: [QUEUE, OTHER], chainNow: now });
  expect(report.queues).toHaveLength(1);
  expect(report.aggregates).not.toBeNull();
  expect(options.metrics.vrfQueueOccupancyBps.set).toHaveBeenCalledWith(
    Number.NaN,
  );
  expect(options.metrics.vrfQueueOldestItemSeconds.set).toHaveBeenCalledWith(
    Number.NaN,
  );
});

// Test-only snapshot of S4's verified decoder until its SDK subpath is merged.
// These RPC bytes are copied unchanged from origin/feat/m2.2-api.
import mainnetQueue from "./fixtures/mainnet-beta.json" with { type: "json" };
import devnetQueue from "./fixtures/vrf-devnet.json" with { type: "json" };
import { decodeVrfQueue } from "./fixtures/s4-vrf-decoder.js";

it.each(["known", "unknown", "unavailable"])(
  "reads S4 mainnet fixture and resolves an active queue's %s block time",
  async (time) => {
    const { options } = fixture();
    const decode = vi.fn(decodeVrfQueue);
    const request = vi.fn(async (method: string, args: unknown[]) => {
      if (method === "getAccountInfo")
        return args[0] === mainnetQueue.source.address
          ? mainnetQueue.response.result
          : devnetQueue.response.result;
      if (method === "getBlockTime") {
        expect(args).toEqual([468400336]);
        if (time === "unavailable") throw new Error("rpc_unavailable");
        return time === "known" ? 199970 : null;
      }
      throw new Error("unexpected_rpc");
    });
    const monitor = createVrfMonitor({
      ...options,
      rpc: { request: request as VrfMonitorOptions["rpc"]["request"] },
      vrfProgramId: mainnetQueue.response.result.value.owner,
      decodeVrfQueue: decode,
    });
    const report = await monitor.poll({
      chainNow: now,
      queues: [mainnetQueue.source.address, devnetQueue.source.address],
    });
    expect(report.failures).toEqual([]);
    expect(report.queues[0]).toMatchObject({
      occupancyBps: 0,
      oldestItemAgeSeconds: 0,
    });
    expect(report.queues[1]).toMatchObject({
      occupancyBps: (9340 / 9476) * 10000,
      oldestItemAgeSeconds: time === "known" ? 30 : null,
    });
    expect(decode).toHaveBeenCalledTimes(3);
    expect(decode).toHaveBeenLastCalledWith(
      Buffer.from(devnetQueue.response.result.value.data[0]!, "base64"),
      { oldestItemTs: time === "known" ? 199970 : null },
    );
    expect(options.metrics.vrfQueueOccupancyBps.set).toHaveBeenCalledWith(
      (9340 / 9476) * 10000,
    );
    expect(options.metrics.vrfQueueOldestItemSeconds.set).toHaveBeenCalledWith(
      time === "known" ? 30 : Number.NaN,
    );
    expect(
      request.mock.calls.filter(([method]) => method === "getBlockTime"),
    ).toHaveLength(1);
  },
);
