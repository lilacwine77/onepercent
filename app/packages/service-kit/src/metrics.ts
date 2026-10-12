import { Counter, Gauge, Histogram, Registry } from "prom-client";

/** A private registry per runtime avoids global cross-service state in tests. */
export function createMetrics() {
  const registry = new Registry();
  const registers = [registry];
  return {
    registry,
    indexerLagSlots: new Gauge({
      name: "onepct_indexer_lag_slots",
      help: "Confirmed slots pending indexing",
      registers,
    }),
    indexerTxsTotal: new Counter({
      name: "onepct_indexer_txs_total",
      help: "Transactions indexed",
      registers,
    }),
    indexerDeckDrift: new Gauge({
      name: "onepct_indexer_deck_drift",
      help: "Deck entries differing from chain",
      registers,
    }),
    keeperIsLeader: new Gauge({
      name: "onepct_keeper_is_leader",
      help: "Whether this keeper owns the leader session",
      registers,
    }),
    keeperJobsTotal: new Counter({
      name: "onepct_keeper_jobs_total",
      help: "Keeper job results",
      labelNames: ["kind", "status"] as const,
      registers,
    }),
    executorTradesTotal: new Counter({
      name: "onepct_executor_trades_total",
      help: "Executor transaction results",
      labelNames: ["kind", "result"] as const,
      registers,
    }),
    executorSlippageBps: new Gauge({
      name: "onepct_executor_slippage_bps",
      help: "Confirmed executor output difference from its quote in basis points",
      labelNames: ["kind"] as const,
      registers,
    }),
    feeChainRunsTotal: new Counter({
      name: "onepct_fee_chain_runs_total",
      help: "Atomic Meteora fee chain results",
      labelNames: ["result"] as const,
      registers,
    }),
    creatorFeesLamportsTotal: new Counter({
      name: "onepct_creator_fees_lamports_total",
      help: "Observed confirmed trading fee collections in lamports",
      labelNames: ["regime"] as const,
      registers,
    }),
    settleLatencySeconds: new Histogram({
      name: "onepct_settle_latency_seconds",
      help: "Reveal to settlement latency in seconds",
      registers,
    }),
    vrfLatencySeconds: new Histogram({
      name: "onepct_vrf_latency_seconds",
      help: "VRF request to callback latency in seconds",
      registers,
    }),
    vrfExpiriesTotal: new Counter({
      name: "onepct_vrf_expiries_total",
      help: "Expired VRF requests",
      registers,
    }),
    vrfQueueOccupancyBps: new Gauge({
      name: "onepct_vrf_queue_occupancy_bps",
      help: "Shared VRF queue occupancy in basis points",
      registers,
    }),
    vrfQueueOldestItemSeconds: new Gauge({
      name: "onepct_vrf_queue_oldest_item_seconds",
      help: "Age of the oldest shared queue item in seconds",
      registers,
    }),
    signerRequestsTotal: new Counter({
      name: "onepct_signer_requests_total",
      help: "Signer request results",
      labelNames: ["role", "result"] as const,
      registers,
    }),
    signerRefusalsTotal: new Counter({
      name: "onepct_signer_refusals_total",
      help: "Signer refusal reasons",
      labelNames: ["role", "reason"] as const,
      registers,
    }),
    rateLimitedTotal: new Counter({
      name: "onepct_rate_limited_total",
      help: "Requests refused by rate limits",
      labelNames: ["route"] as const,
      registers,
    }),
    stockTradesTotal: new Counter({
      name: "onepct_stock_trades_total",
      help: "Stock trade results",
      labelNames: ["kind", "class", "result"] as const,
      registers,
    }),
    stockSlippageBps: new Gauge({
      name: "onepct_stock_slippage_bps",
      help: "Landed stock slippage versus quote in basis points",
      labelNames: ["kind"] as const,
      registers,
    }),
    stockHourlyUsageBps: new Gauge({
      name: "onepct_stock_hourly_usage_bps",
      help: "Stock hourly cap usage in basis points",
      labelNames: ["side"] as const,
      registers,
    }),
  };
}

export type ServiceMetrics = ReturnType<typeof createMetrics>;
