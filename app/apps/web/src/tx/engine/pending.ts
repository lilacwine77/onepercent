import type { Connection, SignatureStatus } from "@solana/web3.js";
import type { PendingItem } from "./progress";

/** Recheck a previous ambiguous submission without sending or rebuilding it. */
export async function resolvePending<T>(
  records: readonly PendingItem<T>[],
  rpc: Connection,
) {
  const pending: PendingItem<T>[] = [];
  const landed = new Set<string>();
  const retry = new Set<string>();
  if (!records.length) return { pending, landed, retry };
  const height = await rpc.getBlockHeight("finalized");
  if (!Number.isSafeInteger(height) || height < 0)
    throw new Error("Invalid block height");
  const signatures = records.flatMap((entry) =>
    entry.signature ? [entry.signature] : [],
  );
  // Read history after the finalized height barrier, including signatures whose
  // previous submission call timed out after returning the signed transaction.
  const statuses = signatures.length
    ? (
        await rpc.getSignatureStatuses(signatures, {
          searchTransactionHistory: true,
        })
      ).value
    : [];
  if (statuses.length !== signatures.length)
    throw new Error("Incomplete signature status response");
  const known = new Map<string, SignatureStatus | null>();
  signatures.forEach((signature, index) =>
    known.set(signature, statuses[index] ?? null),
  );
  for (const entry of records) {
    const status = entry.signature ? known.get(entry.signature) : null;
    const completed =
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized";
    if (completed && !status?.err) {
      landed.add(entry.item.id);
      continue;
    }
    // These outcomes are definitive without any Deck or balance read. An
    // active Deck must never turn a finalized failure into a pending exit.
    if (
      (status?.confirmationStatus === "finalized" && status.err) ||
      (status == null && height > entry.validity.lastValidBlockHeight)
    ) {
      retry.add(entry.item.id);
      continue;
    }
    try {
      if (await entry.item.landed()) {
        landed.add(entry.item.id);
      } else {
        pending.push(entry);
      }
    } catch {
      pending.push(entry);
    }
  }
  return { pending, landed, retry };
}
