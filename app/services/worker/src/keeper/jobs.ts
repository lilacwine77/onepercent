import { SEASON } from "@onepercent/config";
import { warnCause } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { KeeperPull, KeeperSnapshot } from "./adapter.js";

const address = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("keeper_address_invalid", error);
    return false;
  }
});
const u64 = z
  .string()
  .regex(/^\d{1,20}$/)
  .refine((x) => BigInt(x) <= (1n << 64n) - 1n);
export const intentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fee-chain"),
      season: u64,
      reason: z.enum(["periodic", "last-minute", "buys-closed"]),
      window: u64,
    })
    .strict(),
  z.object({ kind: z.literal("launch-migration"), season: u64 }).strict(),
  z
    .object({
      kind: z.literal("settle"),
      address,
      seq: u64,
      packs: z.array(z.number().int().min(0).max(9)).min(1).max(2),
      revealedTs: u64,
    })
    .strict(),
  z.object({ kind: z.literal("refund"), address, seq: u64 }).strict(),
  z.object({ kind: z.literal("final-sol"), address, owner: address }).strict(),
  z
    .object({
      kind: z.literal("start-final-pull"),
      endTs: u64,
      window: u64,
    })
    .strict(),
  z
    .object({
      kind: z.literal("advance"),
      from: z.number().int().min(0).max(5),
      to: z.number().int().min(1).max(6),
      // Earlier persisted jobs have no window; keep their signed records readable.
      window: u64.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("close-vault"),
      mint: address,
      payer: address,
      window: u64,
    })
    .strict(),
  z.object({ kind: z.literal("team-withdraw"), window: u64 }).strict(),
]);
export type KeeperIntent = z.infer<typeof intentSchema>;
export function jobId(intent: KeeperIntent): string {
  switch (intent.kind) {
    case "fee-chain":
      return `fee-chain:${intent.season}:${intent.reason}:${intent.window}`;
    case "launch-migration":
      return `launch-migration:${intent.season}`;
    case "settle":
      return `settle:${intent.seq}:${intent.packs.join(",")}`;
    case "refund":
      return `refund:${intent.seq}`;
    case "final-sol":
      return `final_sol:${intent.address}`;
    case "start-final-pull":
      return `start-final-pull:${intent.endTs}:${intent.window}`;
    case "advance":
      return `advance:${intent.from}:${intent.to}${intent.window === undefined ? "" : `:${intent.window}`}`;
    case "close-vault":
      return `close-vault:${intent.mint}:${intent.payer}:${intent.window}`;
    case "team-withdraw":
      return `team-withdraw:${intent.window}`;
  }
}
/** Stable groups include already-paid pack bits, so a restart keeps the job key. */
export function settleIntents(
  pull: KeeperPull,
  packsPerTx: number,
): KeeperIntent[] {
  const result: KeeperIntent[] = [];
  for (let start = 0; start < pull.qty; start += packsPerTx) {
    const packs = Array.from(
      { length: Math.min(packsPerTx, pull.qty - start) },
      (_, i) => start + i,
    );
    if (packs.some((pack) => (pull.settledMask & (1 << pack)) === 0))
      result.push({
        kind: "settle",
        address: pull.address.toBase58(),
        seq: pull.seq.toString(),
        packs,
        revealedTs: pull.revealedTs.toString(),
      });
  }
  return result;
}
export function nextPhase(
  snapshot: KeeperSnapshot,
  now: bigint,
): number | null {
  const { config, machine } = snapshot;
  if (machine.phase === 0 && config.seasonSet && now >= config.stockUpTs)
    return 1;
  if (machine.phase === 2 && machine.onAirTs !== 0n && now >= machine.onAirTs)
    return 3;
  if (machine.phase === 3 && machine.endTs !== 0n && now >= machine.endTs)
    return 4;
  if (
    machine.phase === 5 &&
    machine.finalTs !== 0n &&
    now >= machine.finalTs + BigInt(SEASON.sealDelaySeconds)
  )
    return 6;
  return null;
}

export function finalPullDue(snapshot: KeeperSnapshot, now: bigint): boolean {
  const { machine } = snapshot;
  return (
    (machine.phase === 3 || machine.phase === 4) &&
    machine.endTs !== 0n &&
    now >= machine.endTs + BigInt(SEASON.finalPullDelaySeconds) &&
    machine.pendingPulls === 0n &&
    machine.execKind === 0
  );
}
