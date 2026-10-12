import { z } from "zod";
import type { ServiceRuntime } from "@onepercent/service-kit";
import type { SqlPool, IndexedTransaction } from "./store.js";
import type { VrfAlertThresholds } from "./settings.js";

export class IndexerTelemetry {
  constructor(
    private readonly runtime: Pick<
      ServiceRuntime,
      "metrics" | "alerts" | "redis"
    >,
    private readonly pool: SqlPool,
    private readonly settings: {
      lagAlertSeconds: number;
      vrfAlerts?: VrfAlertThresholds;
    },
  ) {}
  async applied(tx: IndexedTransaction) {
    this.runtime.metrics.indexerTxsTotal.inc();
    for (const event of tx.events) {
      if (event.name === "CreatorFeesCollected") {
        const regime = ["belowFloor", "season", "afterEnd"][
          Number(event.data.regime)
        ];
        if (regime)
          this.runtime.metrics.creatorFeesLamportsTotal.inc(
            { regime },
            Number(event.data.amount),
          );
      }
      if (event.name === "PullRefunded")
        this.runtime.metrics.vrfExpiriesTotal.inc();
      if (event.name === "PullRevealed" && tx.blockTime !== null) {
        const result = await this.pool.query(
          "SELECT created_ts FROM pulls WHERE seq=$1",
          [String(event.data.seq)],
        );
        const created = result.rows[0]?.created_ts;
        if (created instanceof Date)
          this.runtime.metrics.vrfLatencySeconds.observe(
            Math.max(0, tx.blockTime - created.getTime() / 1000),
          );
      }
    }
  }
  async healthy(
    confirmedSlot: bigint,
    lastEventSlot: bigint,
    confirmedTime: number | null,
    scanTime: number | null,
    scanSlot: bigint,
  ) {
    const lagSlots = confirmedSlot > scanSlot ? confirmedSlot - scanSlot : 0n;
    const lagSeconds =
      confirmedTime === null || scanTime === null
        ? null
        : Math.max(0, confirmedTime - scanTime);
    this.runtime.metrics.indexerLagSlots.set(Number(lagSlots));
    await this.runtime.redis.set(
      "onepct:indexer:status",
      JSON.stringify({
        asOfSlot: scanSlot.toString(),
        scanSlot: scanSlot.toString(),
        confirmedSlot: confirmedSlot.toString(),
        lastEventSlot: lastEventSlot.toString(),
        lagSlots: lagSlots.toString(),
        lagSeconds,
        checkedAt: new Date().toISOString(),
        chainTime: scanTime,
        confirmedTime,
      }),
    );
    await this.runtime.redis.set(
      "onepct:indexer:lag_slots",
      lagSlots.toString(),
    );
    await this.alertLag(lagSeconds, lagSlots);
    const chainTime = confirmedTime;
    if (chainTime === null) return;
    const result = await this.pool.query(
      `SELECT p.buyer,
      count(*) FILTER(WHERE e.name='PullRefunded')::text AS refunds,
      count(*) FILTER(WHERE e.name='PullOpened')::text AS opened
      FROM chain_events e JOIN chain_txs t USING(signature)
      JOIN pulls p ON p.seq=(e.data->>'seq')::numeric
      WHERE e.name IN ('PullOpened','PullRefunded') AND t.block_time >= $1
      GROUP BY p.buyer`,
      [new Date((chainTime - 24 * 60 * 60) * 1000)],
    );
    let refunds = 0n,
      opened = 0n;
    const schema = z.object({
      buyer: z.string(),
      refunds: z.coerce.bigint(),
      opened: z.coerce.bigint(),
    });
    for (const raw of result.rows) {
      const row = schema.parse(raw);
      refunds += row.refunds;
      opened += row.opened;
      if (
        this.settings.vrfAlerts &&
        row.refunds >= BigInt(this.settings.vrfAlerts.expiryCluster)
      )
        await this.runtime.alerts.alert(
          `vrf_expiry_cluster:${row.buyer}`,
          "warning",
          { buyer: row.buyer, refunds: row.refunds.toString() },
        );
    }
    await this.runtime.redis.set(
      "onepct:indexer:vrf",
      JSON.stringify({
        opened: opened.toString(),
        refunds: refunds.toString(),
        expiriesPerThousand:
          opened === 0n ? null : ((refunds * 1000n) / opened).toString(),
        asOfSlot: scanSlot.toString(),
      }),
    );
    if (
      this.settings.vrfAlerts &&
      opened > 0n &&
      refunds * 1000n >
        opened * BigInt(this.settings.vrfAlerts.expiriesPerThousand)
    )
      await this.runtime.alerts.alert("vrf_expiry_rate", "warning", {
        opened: opened.toString(),
        refunds: refunds.toString(),
      });
  }
  async stale(
    confirmedSlot: bigint | null,
    confirmedTime: number | null,
    reason: "poll_failed" | "rpc_node_lag" = "poll_failed",
  ) {
    const raw = await this.runtime.redis.get("onepct:indexer:status");
    if (!raw) {
      await this.runtime.redis.set(
        "onepct:indexer:status",
        JSON.stringify({ available: false, reason: "not_caught_up" }),
      );
      return;
    }
    const parsed = z
      .object({
        asOfSlot: z.string().regex(/^\d+$/),
        scanSlot: z.string().regex(/^\d+$/).optional(),
        lastEventSlot: z.string().regex(/^\d+$/).optional(),
        chainTime: z.number().nullable(),
        checkedAt: z.string(),
      })
      .safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    const scannedSlot = BigInt(parsed.data.scanSlot ?? parsed.data.asOfSlot);
    const lagSlots =
      confirmedSlot === null
        ? null
        : confirmedSlot > scannedSlot
          ? confirmedSlot - scannedSlot
          : 0n;
    const lagSeconds =
      confirmedTime === null || parsed.data.chainTime === null
        ? null
        : Math.max(0, confirmedTime - parsed.data.chainTime);
    if (lagSlots !== null) {
      this.runtime.metrics.indexerLagSlots.set(Number(lagSlots));
      await this.runtime.redis.set(
        "onepct:indexer:lag_slots",
        lagSlots.toString(),
      );
    } else {
      await this.runtime.redis.del("onepct:indexer:lag_slots");
    }
    await this.runtime.redis.set(
      "onepct:indexer:status",
      JSON.stringify({
        ...parsed.data,
        confirmedSlot: confirmedSlot?.toString() ?? null,
        confirmedTime,
        available: false,
        reason,
        lagSlots: lagSlots?.toString() ?? null,
        lagSeconds,
      }),
    );
    await this.alertLag(lagSeconds, lagSlots);
  }
  private async alertLag(lagSeconds: number | null, lagSlots: bigint | null) {
    if (lagSeconds !== null && lagSeconds >= this.settings.lagAlertSeconds)
      await this.runtime.alerts.alert("indexer_lag", "warning", {
        lagSeconds,
        lagSlots: lagSlots?.toString() ?? null,
      });
  }
}
