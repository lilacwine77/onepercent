import { warnCause } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import type { ServiceMetrics, ServiceRuntime } from "@onepercent/service-kit";
import { z } from "zod";

const integer = z.number().int().nonnegative().safe();
const address = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("keeper_address_invalid", error);
    return false;
  }
}, "invalid_public_key");
const queueSchema = z
  .object({
    capacityBytes: integer.positive(),
    usedBytes: integer,
    items: integer,
    oldestItemSlot: z.bigint().nonnegative().nullable(),
    oldestItemTs: z.union([integer, z.bigint().nonnegative()]).nullable(),
  })
  .refine((queue) => queue.usedBytes <= queue.capacityBytes);
const eventSchema = z.object({
  identity: z.string().min(1),
  name: z.enum(["PullOpened", "PullRevealed", "PullRefunded"]),
  buyer: address,
  eventTime: z.coerce.date(),
  openedTime: z.coerce.date().nullable(),
});
const accountSchema = z.object({
  context: z.object({ slot: integer }),
  value: z
    .object({
      owner: address,
      executable: z.boolean(),
      data: z.tuple([z.string().base64(), z.literal("base64")]),
    })
    .nullable(),
});
const WINDOW_SECONDS = 24 * 60 * 60;

export interface VrfMonitorOptions {
  rpc: Pick<ServiceRuntime["rpc"], "request">;
  pool: Pick<ServiceRuntime["pool"], "query">;
  metrics: Pick<
    ServiceMetrics,
    | "vrfLatencySeconds"
    | "vrfExpiriesTotal"
    | "vrfQueueOccupancyBps"
    | "vrfQueueOldestItemSeconds"
  >;
  alerts: Pick<ServiceRuntime["alerts"], "alert">;
  // Injected from @onepercent/sdk/verify by bootstrap; tests supply the same contract.
  decodeVrfQueue(
    data: Uint8Array,
    options?: { oldestItemTs?: number | null },
  ): {
    capacityBytes: number;
    usedBytes: number;
    items: number;
    oldestItemSlot: bigint | null;
    oldestItemTs: number | bigint | null;
  };
  vrfProgramId: string;
  occupancyAlertBps: number;
  expiriesPerThousandRipsAlert: number;
  expiryClusterPerWallet24h: number;
}

export interface VrfMonitorReport {
  queues: {
    queue: string;
    occupancyBps: number;
    oldestItemAgeSeconds: number | null;
  }[];
  aggregates: {
    rips: number;
    expiries: number;
    expiriesPerThousandRips: number | null;
    byWallet: Record<string, number>;
  } | null;
  failures: ("queue_read" | "indexer_read" | "alert_delivery")[];
}

/** Read-only monitoring; failures are reported and never block the keeper's exits. */
export function createVrfMonitor(options: VrfMonitorOptions) {
  address.parse(options.vrfProgramId);
  integer.max(10_000).parse(options.occupancyAlertBps);
  z.number().nonnegative().finite().parse(options.expiriesPerThousandRipsAlert);
  integer.positive().parse(options.expiryClusterPerWallet24h);
  const observed = new Map<string, number>();
  let running: Promise<VrfMonitorReport> | undefined;

  async function run(input: {
    chainNow: bigint;
    queues: readonly string[];
    signal?: AbortSignal;
  }): Promise<VrfMonitorReport> {
    const now = Number(input.chainNow);
    integer.parse(now);
    const cutoff = now - WINDOW_SECONDS;
    const report: VrfMonitorReport = {
      queues: [],
      aggregates: null,
      failures: [],
    };
    const fail = (reason: VrfMonitorReport["failures"][number]) => {
      if (!report.failures.includes(reason)) report.failures.push(reason);
    };
    const alert = async (key: string, payload: Record<string, unknown>) => {
      try {
        await options.alerts.alert(key, "warning", payload);
      } catch (error) {
        warnCause("keeper_monitor_alert_failed", error);
        fail("alert_delivery");
      }
    };
    for (const [identity, timestamp] of observed) {
      if (timestamp < cutoff) observed.delete(identity);
    }
    for (const queue of new Set(input.queues)) {
      if (input.signal?.aborted) break;
      try {
        address.parse(queue);
        const account = await options.rpc.request(
          "getAccountInfo",
          [queue, { commitment: "confirmed", encoding: "base64" }],
          accountSchema,
          input.signal,
        );
        if (
          !account.value ||
          account.value.executable ||
          account.value.owner !== options.vrfProgramId
        )
          throw new Error("invalid_queue_owner");
        const bytes = Buffer.from(account.value.data[0], "base64");
        let decoded = queueSchema.parse(options.decodeVrfQueue(bytes));
        if (decoded.oldestItemSlot !== null) {
          let oldestItemTs: number | null = null;
          try {
            const slot = integer.parse(Number(decoded.oldestItemSlot));
            oldestItemTs = await options.rpc.request(
              "getBlockTime",
              [slot],
              integer.nullable(),
              input.signal,
            );
          } catch (error) {
            warnCause("keeper_queue_time_unavailable", error);
            // Missing block time never hides an otherwise readable occupancy.
          }
          decoded = queueSchema.parse(
            options.decodeVrfQueue(bytes, { oldestItemTs }),
          );
        }
        const oldest =
          decoded.oldestItemTs === null ? null : Number(decoded.oldestItemTs);
        if (oldest !== null) integer.parse(oldest);
        if (decoded.items > 0 && oldest !== null && oldest > now)
          throw new Error("invalid_queue_time");
        const occupancyBps =
          (decoded.usedBytes / decoded.capacityBytes) * 10_000;
        const oldestItemAgeSeconds =
          decoded.items === 0 ? 0 : oldest === null ? null : now - oldest;
        report.queues.push({ queue, occupancyBps, oldestItemAgeSeconds });
        if (
          BigInt(decoded.usedBytes) * 10_000n >
          BigInt(decoded.capacityBytes) * BigInt(options.occupancyAlertBps)
        )
          await alert(`vrf_queue_occupancy:${queue}`, { queue, occupancyBps });
      } catch (error) {
        warnCause("keeper_queue_unavailable", error);
        fail("queue_read");
        // Queue addresses originate from the on-chain allow-list, never RPC URLs.
        await alert("vrf_queue_unavailable", {
          queue: address.safeParse(queue).success ? queue : null,
        });
      }
    }
    // S0's gauges have no labels. Maxima represent every queue only after a full read.
    if (
      report.queues.length > 0 &&
      report.queues.length === new Set(input.queues).size &&
      !report.failures.includes("queue_read") &&
      !input.signal?.aborted
    ) {
      options.metrics.vrfQueueOccupancyBps.set(
        Math.max(...report.queues.map((queue) => queue.occupancyBps)),
      );
      options.metrics.vrfQueueOldestItemSeconds.set(
        Math.max(
          ...report.queues.map(
            (queue) => queue.oldestItemAgeSeconds ?? Number.NaN,
          ),
        ),
      );
    } else {
      options.metrics.vrfQueueOccupancyBps.set(Number.NaN);
      options.metrics.vrfQueueOldestItemSeconds.set(Number.NaN);
    }
    if (input.signal?.aborted) return report;
    try {
      const result = await options.pool.query(
        `SELECT e.signature || ':' || e.ix_index || ':' || e.event_index AS identity,
          e.name, p.buyer, t.block_time AS "eventTime", opened.block_time AS "openedTime"
         FROM chain_events e JOIN chain_txs t ON t.signature = e.signature
         JOIN pulls p ON p.seq::text = e.data->>'seq'
         LEFT JOIN chain_txs opened ON opened.signature = p.opened_sig AND opened.err IS NULL
           AND opened.commitment IN ('confirmed', 'finalized')
         WHERE e.name IN ('PullOpened', 'PullRevealed', 'PullRefunded')
           AND t.commitment IN ('confirmed', 'finalized') AND t.err IS NULL
           AND t.block_time >= $1 AND t.block_time <= $2
         ORDER BY e.slot, e.tx_index, e.ix_index, e.event_index`,
        [new Date(cutoff * 1000), new Date(now * 1000)],
      );
      if (input.signal?.aborted) return report;
      const rows = z.array(eventSchema).parse(result.rows);
      const unique = new Map(rows.map((row) => [row.identity, row]));
      const aggregate = {
        rips: 0,
        expiries: 0,
        expiriesPerThousandRips: null as number | null,
        byWallet: {} as Record<string, number>,
      };
      for (const row of unique.values()) {
        const timestamp = row.eventTime.getTime() / 1000;
        if (timestamp < cutoff || timestamp > now)
          throw new Error("invalid_event_window");
        if (row.name === "PullOpened") aggregate.rips += 1;
        if (row.name === "PullRefunded") {
          aggregate.expiries += 1;
          aggregate.byWallet[row.buyer] =
            (aggregate.byWallet[row.buyer] ?? 0) + 1;
        }
        if (observed.has(row.identity)) continue;
        if (row.name === "PullRefunded") options.metrics.vrfExpiriesTotal.inc();
        if (row.name === "PullRevealed" && row.openedTime !== null) {
          const latency =
            (row.eventTime.getTime() - row.openedTime.getTime()) / 1000;
          if (latency >= 0) options.metrics.vrfLatencySeconds.observe(latency);
          else throw new Error("invalid_vrf_latency");
        }
        // Missing opener block time may be filled later; do not lose its histogram.
        if (row.name !== "PullRevealed" || row.openedTime !== null)
          observed.set(row.identity, timestamp);
      }
      aggregate.expiriesPerThousandRips =
        aggregate.rips === 0
          ? null
          : (aggregate.expiries * 1000) / aggregate.rips;
      report.aggregates = aggregate;
      if (
        aggregate.expiriesPerThousandRips !== null &&
        aggregate.expiriesPerThousandRips > options.expiriesPerThousandRipsAlert
      )
        await alert("vrf_expiry_rate", aggregate);
      for (const [wallet, expiries] of Object.entries(aggregate.byWallet)) {
        if (expiries >= options.expiryClusterPerWallet24h)
          await alert(`vrf_expiry_cluster:${wallet}`, {
            wallet,
            expiries,
            windowSeconds: WINDOW_SECONDS,
          });
      }
    } catch (error) {
      warnCause("keeper_monitor_indexer_unavailable", error);
      fail("indexer_read");
      await alert("vrf_indexer_unavailable", {});
    }
    return report;
  }
  return {
    poll(input: {
      chainNow: bigint;
      queues: readonly string[];
      signal?: AbortSignal;
    }): Promise<VrfMonitorReport> {
      // A slow polling pass cannot multiply counter observations on overlapping ticks.
      running ??= run(input).finally(() => {
        running = undefined;
      });
      return running;
    },
  };
}
