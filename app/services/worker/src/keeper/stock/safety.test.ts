import { expect, it, vi } from "vitest";
import { SERVICES } from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import { freshSponsored, PersistentConditions } from "./safety.js";
import { fixture } from "./testing.js";
import { measuredTip, WINDOW_MS } from "./tip-measurement.js";
import { privateLanding } from "./landing.js";
import type { TxRpc } from "@onepercent/service-kit";
it("only a fresh Full price clears persistent staleness", () => {
  const f = fixture(),
    account = f.readings.oracles[0],
    feed = f.state.machine.buckets[0]!.oracle.toBytes();
  expect(freshSponsored(account, feed, f.now)).toBe(true);
  expect(freshSponsored(account, feed, f.now + 46n)).toBe(false);
  const conditions = new PersistentConditions();
  expect(conditions.observe("feed", true, f.now)).toBe(false);
  expect(
    conditions.observe(
      "feed",
      null,
      f.now + BigInt(SERVICES.monitor.stockConditionAlertSeconds),
    ),
  ).toBe(true);
  expect(conditions.observe("feed", false, f.now + 1000n)).toBe(false);
  (account.data as Buffer)[40] = 0;
  expect(freshSponsored(account, feed, f.now)).toBe(false);
  expect(
    freshSponsored({ ...account, owner: PublicKey.default }, feed, f.now),
  ).toBe(false);
});
it("requires 24 hours of distinct tip observations, rounds upward and preserves the floor", () => {
  const start = Date.parse("2026-10-10T00:00:00Z");
  const samples = Array.from({ length: 1441 }, (_, i) => ({
    time: new Date(start + i * 60000).toISOString(),
    landed_tips_25th_percentile: 0,
    landed_tips_50th_percentile: 0.001001,
    landed_tips_75th_percentile: 0.002,
    landed_tips_95th_percentile: 0.003,
    landed_tips_99th_percentile: 0.004,
  }));
  expect(Date.parse(samples.at(-1)!.time) - start).toBe(WINDOW_MS);
  expect(measuredTip(samples).tipLamports).toBe(1_010_000);
  expect(
    measuredTip(
      samples.map((s) => ({ ...s, time: s.time.replace("Z", "+00:00") })),
    ).tipLamports,
  ).toBe(1_010_000);
  expect(() => measuredTip(samples.slice(1))).toThrow("tip_window_incomplete");
  expect(() => measuredTip([...samples, samples[0]!])).toThrow(
    "tip_window_gap",
  );
  expect(
    measuredTip(samples.map((s) => ({ ...s, landed_tips_50th_percentile: 0 })))
      .tipLamports,
  ).toBe(SERVICES.landing.tipLamports);
});
it("ambiguous Sender failure falls back only with identical bytes and respects cancellation", async () => {
  const bytes = new Uint8Array([1, 2]),
    send = vi.fn(async () => "same-signature"),
    fallback = vi.fn(),
    active = vi.fn();
  const rpc = privateLanding(
    { sendRawTransaction: send } as unknown as TxRpc,
    "https://sender.helius-rpc.com/fast",
    active,
    fallback,
    vi.fn(async () => {
      throw new Error("network");
    }),
  );
  expect(await rpc.sendRawTransaction(bytes)).toBe("same-signature");
  expect(send).toHaveBeenCalledWith(bytes, undefined);
  expect(fallback).toHaveBeenCalledOnce();
  const controller = new AbortController();
  controller.abort();
  await expect(
    rpc.sendRawTransaction(bytes, controller.signal),
  ).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  expect(() =>
    privateLanding(
      {} as TxRpc,
      "https://evilhelius-rpc.com/fast",
      active,
      fallback,
    ),
  ).toThrow();
});
