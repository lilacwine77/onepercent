import { describe, expect, it, vi } from "vitest";
import { priorityPrice } from "@onepercent/service-kit";
import {
  createFeeMeasurementCollector,
  FEE_SAMPLE_INTERVAL_MS,
  MAINNET_GENESIS_HASH,
  readFeeMeasurementJsonl,
  summarizeFeeMeasurement,
  type FeeMeasurementHeader,
  type FeeMeasurementSample,
} from "./fee-measurement.js";
import type { ServiceRuntime } from "@onepercent/service-kit";

const ACCOUNT = "11111111111111111111111111111111";
const OTHER = "Vote111111111111111111111111111111111111111";
const header: FeeMeasurementHeader = {
  kind: "header",
  version: 1,
  cluster: "mainnet-beta",
  genesisHash: MAINNET_GENESIS_HASH,
  groups: [
    { name: "unfiltered", accounts: [] },
    { name: "major", accounts: [ACCOUNT] },
  ],
};
const values = [0, 100, 500, 10_001].map((prioritizationFee, slot) => ({
  slot,
  prioritizationFee,
}));
const sample = (minute: number): FeeMeasurementSample => ({
  kind: "sample",
  timestampMs: 1_800_000_000_000 + minute * FEE_SAMPLE_INTERVAL_MS,
  verifiedAccountsSlot: 100,
  groups: header.groups.map((group) => ({
    ...group,
    fees: values,
    p75MicroLamports: "500",
  })),
});
function fixture() {
  const appendJsonl = vi.fn<(line: string) => Promise<void>>(async () => {});
  const request = vi.fn<
    (method: string, params: unknown[]) => Promise<unknown>
  >(async (method) => {
    if (method === "getGenesisHash") return MAINNET_GENESIS_HASH;
    if (method === "getMultipleAccounts")
      return {
        context: { slot: 100 },
        value: [{ owner: OTHER, executable: false }],
      };
    if (method === "getRecentPrioritizationFees") return values;
    throw new Error("unexpected_rpc_method");
  });
  return {
    appendJsonl,
    request,
    options: {
      rpc: { request: request as ServiceRuntime["rpc"]["request"] },
      groups: [{ name: "major", accounts: [ACCOUNT] }],
      appendJsonl,
      now: () => sample(0).timestampMs,
    },
  };
}

describe("priority fee evidence", () => {
  it("only reads mainnet and retains raw unfiltered and existing-account fee samples with TxSender's p75", async () => {
    const { options, request, appendJsonl } = fixture();
    const collector = createFeeMeasurementCollector(options);
    const row = await collector.sample();
    expect(row.groups.map((group) => group.p75MicroLamports)).toEqual([
      "500",
      "500",
    ]);
    expect(row.groups[0]?.p75MicroLamports).toBe(
      priorityPrice(values, 2n ** 64n - 1n).toString(),
    );
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "getGenesisHash",
      "getMultipleAccounts",
      "getRecentPrioritizationFees",
      "getRecentPrioritizationFees",
    ]);
    expect(request.mock.calls[2]?.[1]).toEqual([]);
    expect(request.mock.calls[3]?.[1]).toEqual([[ACCOUNT]]);
    expect(appendJsonl).toHaveBeenCalledTimes(2);
    expect(
      readFeeMeasurementJsonl(
        appendJsonl.mock.calls.map((call) => call[0]).join(""),
      ),
    ).toEqual(collector.records());
  });

  it("refuses a cap before a complete contiguous 24h window and rounds p99 up", () => {
    const short = summarizeFeeMeasurement([header, sample(0), sample(1)]);
    expect(short.complete).toBe(false);
    expect(short.maxComputeUnitPriceMicroLamports).toBeNull();
    const rows = Array.from({ length: 1441 }, (_, index) => sample(index));
    const full = summarizeFeeMeasurement([header, ...rows]);
    expect(full.complete).toBe(true);
    expect(full.p99OfP75MicroLamports).toBe("500");
    expect(full.maxComputeUnitPriceMicroLamports).toBe("10000");
    expect(
      summarizeFeeMeasurement([header, ...rows.filter((_, i) => i !== 100)])
        .maxComputeUnitPriceMicroLamports,
    ).toBeNull();
  });

  it("uses nearest rank p99 across every group's sample p75, with exact integer rounding", () => {
    const rows = Array.from({ length: 1441 }, (_, minute) => ({
      ...sample(minute),
      groups: header.groups.map((group) => ({
        ...group,
        fees: [{ slot: minute, prioritizationFee: 10001 }],
        p75MicroLamports: "10001",
      })),
    }));
    expect(
      summarizeFeeMeasurement([header, ...rows])
        .maxComputeUnitPriceMicroLamports,
    ).toBe("20000");
  });

  it("rejects devnet, absent pool accounts, and incomplete RPC samples before persisting", async () => {
    for (const badMethod of [
      "getGenesisHash",
      "getMultipleAccounts",
      "getRecentPrioritizationFees",
    ]) {
      const { options, request, appendJsonl } = fixture();
      const original = request.getMockImplementation()!;
      request.mockImplementation(async (method) =>
        method === badMethod
          ? method === "getGenesisHash"
            ? "devnet"
            : method === "getMultipleAccounts"
              ? { context: { slot: 100 }, value: [null] }
              : []
          : original(method, []),
      );
      await expect(
        createFeeMeasurementCollector(options).sample(),
      ).rejects.toThrow();
      expect(appendJsonl).not.toHaveBeenCalled();
    }
  });

  it("resumes only the same exact account groups and preserves once per minute", async () => {
    const { options, appendJsonl } = fixture();
    const collector = createFeeMeasurementCollector({
      ...options,
      previous: [header, sample(0)],
      now: () => sample(1).timestampMs,
    });
    await collector.sample();
    expect(appendJsonl).toHaveBeenCalledTimes(1);
    await expect(collector.sample()).rejects.toThrow("too_frequent");
    expect(() =>
      createFeeMeasurementCollector({
        ...options,
        previous: [header],
        groups: [{ name: "major", accounts: [OTHER] }],
      }),
    ).toThrow("resume_mismatch");
  });

  it("rejects tampering, missing groups, duplicate slots, duplicate header and wrong genesis", () => {
    const mutations = [
      [header, { ...sample(0), groups: sample(0).groups.slice(0, 1) }],
      [
        header,
        {
          ...sample(0),
          groups: sample(0).groups.map((group) => ({
            ...group,
            p75MicroLamports: "1",
          })),
        },
      ],
      [
        header,
        {
          ...sample(0),
          groups: sample(0).groups.map((group) => ({
            ...group,
            fees: [...group.fees, group.fees[0]!],
          })),
        },
      ],
      [header, header],
      [{ ...header, genesisHash: "devnet" }, sample(0)],
    ];
    for (const records of mutations)
      expect(() =>
        readFeeMeasurementJsonl(
          records.map((record) => JSON.stringify(record)).join("\n"),
        ),
      ).toThrow();
  });
});

it("retains old evidence but resumes completeness from the newest full contiguous window", () => {
  const rows = Array.from({ length: 1441 }, (_, index) => sample(index + 100));
  const report = summarizeFeeMeasurement([header, sample(0), ...rows]);
  expect(report.complete).toBe(true);
  expect(report.sampleCount).toBe(1441);
  expect(report.totalRecordedSamples).toBe(1442);
  expect(report.excludedEarlierSamples).toBe(1);
});

it("uses the full RPC genesis hash rather than the shortened Actions chain id", () => {
  expect(MAINNET_GENESIS_HASH).toBe(
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  );
});
