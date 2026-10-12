import type { SnapshotEvidence } from "./types.js";
export type SnapshotStatus = "unchecked" | "not_held" | "unknown" | "held";
export function evaluateSnapshot(
  slotS?: number | null,
  evidence?: SnapshotEvidence,
): SnapshotStatus {
  if (!slotS) return "unchecked";
  if (
    evidence?.mintFirstSeenSlot !== undefined &&
    evidence.mintFirstSeenSlot > slotS
  )
    return "not_held";
  if (evidence?.balanceAtS == null) return "unknown";
  return evidence.balanceAtS > 0n ? "held" : "not_held";
}
