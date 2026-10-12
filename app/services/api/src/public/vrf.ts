import * as config from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import { decodeVrfQueue } from "@onepercent/sdk/verify";
import { VrfStatus } from "@onepercent/sdk/api";
import { type ServiceRuntime, warnCause } from "@onepercent/service-kit";
import { z } from "zod";
import type { DraftConfig } from "./data/index.js";

/** Slot-derived age also handles pre-timestamp queue entries and timestamp wrap. */
export function createPublicVrf(
  runtime: Pick<ServiceRuntime, "rpc" | "alerts" | "metrics">,
) {
  return async (state: DraftConfig): Promise<VrfStatus> => {
    const queue = state.vrf.queues[state.vrf.activeIndex];
    try {
      if (!queue) throw new Error("vrf_queue_missing");
      const params = z
        .object({
          busyOccupancyBps: z.number().int().nonnegative(),
          busyOldestItemSeconds: z.number().int().positive(),
        })
        .parse((config as Record<string, unknown>).VRF);
      const [account, now] = await Promise.all([
        runtime.rpc.account(new PublicKey(queue)),
        runtime.rpc.chainNow(),
      ]);
      if (account.executable || account.owner.toBase58() !== state.vrfProgram)
        throw new Error("vrf_queue_owner");
      const decoded = decodeVrfQueue(account.data);
      let oldestItemAgeSeconds = 0;
      if (decoded.oldestItemSlot !== null) {
        const slot = z
          .number()
          .int()
          .nonnegative()
          .safe()
          .parse(Number(decoded.oldestItemSlot));
        const timestamp = await runtime.rpc.request(
          "getBlockTime",
          [slot],
          z.number().int().safe().nonnegative(),
        );
        oldestItemAgeSeconds = z
          .number()
          .int()
          .safe()
          .nonnegative()
          .parse(
            Number(now > BigInt(timestamp) ? now - BigInt(timestamp) : 0n),
          );
      }
      if (decoded.capacityBytes <= 0) throw new Error("vrf_capacity_invalid");
      const denominator = z
        .number()
        .int()
        .positive()
        .parse(config.BPS_DENOMINATOR);
      const occupancyBps = Math.floor(
        (decoded.usedBytes * denominator) / decoded.capacityBytes,
      );
      runtime.metrics.vrfQueueOccupancyBps.set(occupancyBps);
      runtime.metrics.vrfQueueOldestItemSeconds.set(oldestItemAgeSeconds);
      const monitor = z
        .object({ vrfQueueOccupancyAlertBps: z.number().int().nonnegative() })
        .parse((config as Record<string, unknown>).MONITOR);
      if (occupancyBps > monitor.vrfQueueOccupancyAlertBps)
        await runtime.alerts
          .alert("vrf_queue_occupancy", "warning", { queue, occupancyBps })
          .catch((error) => {
            warnCause("vrf_alert_failed", error);
          });
      return VrfStatus.parse({
        queue,
        occupancyBps,
        oldestItemAgeSeconds,
        busy:
          occupancyBps > params.busyOccupancyBps ||
          oldestItemAgeSeconds > params.busyOldestItemSeconds,
      });
    } catch (error) {
      warnCause("vrf_queue_unavailable", error);
      await runtime.alerts
        .alert("vrf_queue_unavailable", "warning", { queue: queue ?? null })
        .catch((error) => {
          warnCause("vrf_alert_failed", error);
        });
      return {
        queue: null,
        occupancyBps: null,
        oldestItemAgeSeconds: null,
        busy: false,
      };
    }
  };
}
