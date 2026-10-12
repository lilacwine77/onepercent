import { safeCause } from "@onepercent/service-kit";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { TransactionInstruction } from "@solana/web3.js";
import { serviceParams } from "@onepercent/service-kit";
import type { ServiceRuntime } from "@onepercent/service-kit";
import type { KeeperIntent } from "../jobs.js";
import type { KeeperStore } from "../store.js";
import { chainDate, keeperResumableSql } from "../store.js";
import { FeeChainReader, type FeeSnapshot } from "./chain.js";

const positive = z.number().int().positive().safe();
export const feeKeeperParamsSchema = z
  .object({
    KEEPER_POLICY: z.object({
      creatorFeeCollectSecondsMin: positive,
      creatorFeeCollectSecondsMax: positive,
      creatorFeeFinalCollectLeadSeconds: positive,
    }),
    MONITOR: z.object({ feeInSilenceAlertSeconds: positive }),
  })
  .superRefine((value, ctx) => {
    const p = value.KEEPER_POLICY;
    if (
      p.creatorFeeCollectSecondsMax < p.creatorFeeCollectSecondsMin ||
      p.creatorFeeFinalCollectLeadSeconds >= p.creatorFeeCollectSecondsMin
    )
      ctx.addIssue({ code: "custom", message: "fee_schedule_invalid" });
  });
export type FeeKeeperParams = z.infer<typeof feeKeeperParamsSchema>;
export interface KeeperFees {
  discover(now: bigint, signal: AbortSignal): Promise<void>;
  instructions(
    intent: KeeperIntent,
    now: bigint,
    signal: AbortSignal,
  ): Promise<readonly TransactionInstruction[] | null>;
  complete(
    intent: KeeperIntent,
    commitment: "confirmed" | "finalized",
    signal: AbortSignal,
  ): Promise<boolean>;
}
/** Reproducible uniform cadence survives a restart and never adds another pending send. */
export function feeDelay(
  season: string,
  window: string,
  params: FeeKeeperParams,
): bigint {
  const { creatorFeeCollectSecondsMin: min, creatorFeeCollectSecondsMax: max } =
    params.KEEPER_POLICY;
  const width = BigInt(max - min + 1);
  const entropy = createHash("sha256")
    .update(`fees:${season}:${window}`)
    .digest()
    .readBigUInt64LE(0);
  return BigInt(min) + (entropy % width);
}
const observationSchema = z.object({
  season: z.string(),
  fingerprint: z.string(),
  lastTrade: z.string().regex(/^\d+$/),
  observed: z.string().regex(/^\d+$/),
});
export function feeSilenceSeverity(
  now: bigint,
  baseline: bigint,
  lastTrade: bigint,
  seconds: number,
): "warning" | "critical" | null {
  const window = BigInt(seconds);
  const silence = now - baseline;
  if (lastTrade < now - window || silence < window) return null;
  return silence >= 2n * window ? "critical" : "warning";
}
export function createFeeKeeper(options: {
  reader: FeeChainReader;
  store: KeeperStore;
  runtime: ServiceRuntime;
  params: FeeKeeperParams;
  sendMaxAttempts?: number;
  assertActive(): void;
}): KeeperFees {
  const { reader, store, runtime, params } = options;
  const maxAttempts = positive.parse(
    options.sendMaxAttempts ?? serviceParams.keeper.sendMaxAttempts,
  );
  const query = runtime.pool.query.bind(runtime.pool);
  const checked = async (
    commitment: "confirmed" | "finalized",
    signal: AbortSignal,
  ) => {
    options.assertActive();
    try {
      return await reader.read(commitment, signal);
    } catch (error) {
      if (error instanceof Error && error.message === "fee_in_creator_changed")
        await runtime.alerts.alert("fee_in_creator_changed", "critical", {
          reason: "launch_fee_authority_changed",
        });
      throw error;
    }
  };
  const observe = async (snapshot: FeeSnapshot, now: bigint) => {
    if (snapshot.baseFees > 0n)
      await runtime.alerts.alert("launch_base_fees", "warning", {
        amount: snapshot.baseFees.toString(),
        reason: "base_fees_retained_in_fee_in",
      });
    const key = `onepct:fee-observation:${runtime.env.PROGRAM_ID}`;
    const previousValue = await runtime.redis.get(key);
    let decoded: unknown;
    try {
      decoded = previousValue ? JSON.parse(previousValue) : undefined;
    } catch (error) {
      runtime.logger.warn(
        { reason: "fee_observation_invalid", cause: safeCause(error) },
        "fee observation invalid",
      );
      decoded = undefined;
    }
    const parsed = observationSchema.safeParse(decoded);
    const previous =
      parsed?.success && parsed.data.season === snapshot.season
        ? parsed.data
        : null;
    const lastTrade =
      previous && previous.fingerprint !== snapshot.reserveFingerprint
        ? now
        : BigInt(previous?.lastTrade ?? "0");
    const rows = await query(
      "SELECT floor(extract(epoch FROM max(ts)))::text AS ts FROM creator_fee_collections WHERE amount > 0 AND ts >= to_timestamp($1::bigint)",
      [snapshot.season],
    );
    const baseline = BigInt(
      z.object({ ts: z.string().regex(/^\d+$/).nullable() }).parse(rows.rows[0])
        .ts ?? snapshot.season,
    );
    const severity = feeSilenceSeverity(
      now,
      baseline,
      lastTrade,
      params.MONITOR.feeInSilenceAlertSeconds,
    );
    if (severity)
      await runtime.alerts.alert("fee_in_silent", severity, {
        lastPositiveTs: baseline.toString(),
        lastTradeTs: lastTrade.toString(),
      });
    options.assertActive();
    await runtime.redis.set(
      key,
      JSON.stringify({
        season: snapshot.season,
        fingerprint: snapshot.reserveFingerprint,
        lastTrade: lastTrade.toString(),
        observed: now.toString(),
      }),
    );
  };
  return {
    async discover(now, signal) {
      const snapshot = await checked("confirmed", signal);
      if (!snapshot) return;
      try {
        await observe(snapshot, now);
      } catch (error) {
        runtime.logger.warn(
          { reason: "fee_monitor_unavailable", cause: safeCause(error) },
          "fee monitor unavailable",
        );
      }
      options.assertActive();
      const date = chainDate(now);
      if (snapshot.migrationDue)
        await store.ensure(
          { kind: "launch-migration", season: snapshot.season },
          date,
        );
      if (
        snapshot.phase === 3 &&
        now >=
          snapshot.endTs -
            BigInt(params.KEEPER_POLICY.creatorFeeFinalCollectLeadSeconds) &&
        now < snapshot.endTs
      ) {
        await store.ensure(
          {
            kind: "fee-chain",
            season: snapshot.season,
            reason: "last-minute",
            window: snapshot.endTs.toString(),
          },
          date,
        );
        return;
      }
      if (snapshot.phase >= 4)
        await store.ensure(
          {
            kind: "fee-chain",
            season: snapshot.season,
            reason: "buys-closed",
            window: snapshot.endTs.toString(),
          },
          date,
        );
      if (
        !snapshot.waiting ||
        (snapshot.phase === 2 && now >= snapshot.onAirTs)
      )
        return;
      // A newer special collection must not hide an older ambiguous signature.
      // The completion time also anchors the cadence after delayed confirmation.
      const result = await query(
        `SELECT GREATEST((payload->'intent'->>'window')::numeric, floor(extract(epoch FROM next_attempt_at)))::text AS window,
        bool_or(${keeperResumableSql("$2")}) OVER () AS unresolved
        FROM keeper_jobs WHERE kind='fee-chain' AND payload->'intent'->>'season'=$1
        ORDER BY (payload->'intent'->>'window')::numeric DESC, id DESC LIMIT 1`,
        [snapshot.season, maxAttempts],
      );
      const latest = result.rows[0]
        ? z
            .object({
              window: z.string().regex(/^\d+$/),
              unresolved: z.boolean(),
            })
            .parse(result.rows[0])
        : null;
      if (latest?.unresolved) return;
      if (
        latest &&
        now <
          BigInt(latest.window) +
            feeDelay(snapshot.season, latest.window, params)
      )
        return;
      options.assertActive();
      await store.ensure(
        {
          kind: "fee-chain",
          season: snapshot.season,
          reason: "periodic",
          window: now.toString(),
        },
        date,
      );
    },
    async instructions(intent, now, signal) {
      const snapshot = await checked("confirmed", signal);
      if (!snapshot) return null;
      if (intent.kind === "advance")
        return intent.from === 2 && intent.to === 3
          ? reader.collection(snapshot, true)
          : null;
      if (intent.kind !== "fee-chain" && intent.kind !== "launch-migration")
        return null;
      if (snapshot.season !== intent.season) return null;
      if (intent.kind === "launch-migration")
        return snapshot.migrationDue ? reader.migration(snapshot) : null;
      // Discovery drains existing jobs before discovering phase transitions.
      // Let BuysClosed advance first when a fresh collection reaches end_ts.
      // An already signed transaction still follows TxSender reconciliation.
      if (snapshot.phase === 3 && now >= snapshot.endTs) return null;
      if (
        intent.reason === "last-minute" &&
        (snapshot.phase !== 3 || now >= snapshot.endTs)
      )
        return null;
      if (intent.reason === "buys-closed" && snapshot.phase < 4) return null;
      if (!snapshot.waiting) return null;
      return reader.collection(snapshot);
    },
    async complete(intent, commitment, signal) {
      if (intent.kind === "launch-migration")
        return (await checked(commitment, signal))?.migrated ?? false;
      // A fresh zero fee amount cannot prove this specific collection landed.
      // The durable signature is the authority for completion, including empty collections.
      return false;
    },
  };
}
