import { expect, it } from "vitest";
import { createMetrics } from "./metrics.js";

it("exposes every M2 metric and bounded dimensions in its own registry", async () => {
  const metrics = createMetrics();
  metrics.keeperIsLeader.set(1);
  metrics.keeperJobsTotal.inc({ kind: "settle", status: "confirmed" });
  metrics.signerRequestsTotal.inc({ role: "quote-signer", result: "ok" });
  metrics.signerRefusalsTotal.inc({
    role: "intake-signer",
    reason: "indexer_lag",
  });
  metrics.rateLimitedTotal.inc({ route: "feed" });
  metrics.stockTradesTotal.inc({
    kind: "buy",
    class: "major",
    result: "confirmed",
  });
  metrics.stockSlippageBps.set({ kind: "buy" }, 10);
  metrics.stockHourlyUsageBps.set({ side: "buy" }, 100);
  const text = await metrics.registry.metrics();
  for (const suffix of [
    "indexer_lag_slots",
    "indexer_txs_total",
    "indexer_deck_drift",
    "keeper_is_leader",
    "keeper_jobs_total",
    "settle_latency_seconds",
    "vrf_latency_seconds",
    "vrf_expiries_total",
    "vrf_queue_occupancy_bps",
    "vrf_queue_oldest_item_seconds",
    "signer_requests_total",
    "signer_refusals_total",
    "rate_limited_total",
    "stock_trades_total",
    "stock_slippage_bps",
    "stock_hourly_usage_bps",
  ]) {
    expect(text).toContain(`onepct_${suffix}`);
  }
  expect(text).toContain(
    'onepct_keeper_jobs_total{kind="settle",status="confirmed"} 1',
  );
  expect(await createMetrics().registry.metrics()).toContain(
    "onepct_keeper_is_leader 0",
  );
});
