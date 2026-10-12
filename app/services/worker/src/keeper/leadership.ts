import { warnCause } from "@onepercent/service-kit";
import { setTimeout as delay } from "node:timers/promises";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { z } from "zod";

export interface KeeperLeadershipWatchdogOptions {
  pool: Pick<ServiceRuntime["pool"], "query">;
  rpc: Pick<ServiceRuntime["rpc"], "chainNow">;
  alerts: Pick<ServiceRuntime["alerts"], "alert">;
  intervalMs: number;
  leaderFailoverSeconds: number;
  signal: AbortSignal;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export type KeeperLeadershipObservation =
  | { status: "present" }
  | { status: "absent"; missingForSeconds: bigint }
  | { status: "unknown" };

/** Observes S0's global lock, including another replica; never acquires it. */
export function createKeeperLeadershipWatchdog(
  options: KeeperLeadershipWatchdogOptions,
) {
  z.number().int().positive().safe().parse(options.intervalMs);
  z.number().int().positive().safe().parse(options.leaderFailoverSeconds);
  let absentSince: bigint | undefined;
  let running: Promise<KeeperLeadershipObservation> | undefined;
  async function poll(): Promise<KeeperLeadershipObservation> {
    if (options.signal.aborted) return { status: "unknown" };
    try {
      const [result, now] = await Promise.all([
        options.pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_locks l
             WHERE l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND l.granted
               AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
               AND l.classid::bigint = ((hashtext('onepct:keeper')::bigint >> 32) & 4294967295)
               AND l.objid::bigint = (hashtext('onepct:keeper')::bigint & 4294967295)
               AND l.objsubid = 1
           ) AS present`,
        ),
        options.rpc.chainNow(),
      ]);
      if (options.signal.aborted) return { status: "unknown" };
      z.bigint().nonnegative().parse(now);
      const rows = z
        .array(z.object({ present: z.boolean() }))
        .length(1)
        .parse(result.rows);
      if (rows[0]!.present) {
        absentSince = undefined;
        return { status: "present" };
      }
      absentSince ??= now;
      const missingForSeconds = now > absentSince ? now - absentSince : 0n;
      if (missingForSeconds > BigInt(options.leaderFailoverSeconds)) {
        try {
          await options.alerts.alert("keeper_leader_missing", "warning", {
            missingForSeconds: missingForSeconds.toString(),
          });
        } catch (error) {
          warnCause("keeper_leader_alert_failed", error);
          /* Alert delivery cannot stop observation or affect any exit. */
        }
      }
      return { status: "absent", missingForSeconds };
    } catch (error) {
      warnCause("keeper_leader_observation_failed", error);
      // An unknown read never manufactures an absence or clears an unresolved one.
      return { status: "unknown" };
    }
  }
  return {
    poll(): Promise<KeeperLeadershipObservation> {
      running ??= poll().finally(() => {
        running = undefined;
      });
      return running;
    },
  };
}

/** Start alongside the runtime with its lifetime signal, never inside onLeader. */
export async function runKeeperLeadershipWatchdog(
  options: KeeperLeadershipWatchdogOptions,
): Promise<void> {
  const watchdog = createKeeperLeadershipWatchdog(options);
  const sleep =
    options.sleep ??
    ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
  while (!options.signal.aborted) {
    await watchdog.poll();
    if (options.signal.aborted) break;
    try {
      await sleep(options.intervalMs, options.signal);
    } catch (error) {
      warnCause("keeper_watchdog_wait_failed", error);
      if (!options.signal.aborted)
        // eslint-disable-next-line preserve-caught-error -- Original cause is logged; preserve the public error contract.
        throw new Error("keeper_watchdog_wait_failed");
    }
  }
}
