import { webDeployment } from "./deployment";
import { BPS_DENOMINATOR } from "@onepercent/config";
import { PACK_EDITIONS, PACK_SPLIT_BPS } from "@onepercent/config/web";
import { deckPda } from "@onepercent/sdk/browser";
import { parseOnepercentLogs } from "@onepercent/sdk/events";
import type { Connection, PublicKey } from "@solana/web3.js";
import type { ChainDeckEntry } from "./deck";

type OutcomeRpc = Pick<
  Connection,
  "getSignaturesForAddress" | "getTransaction"
>;
type MissingEntry = Pick<ChainDeckEntry, "mint" | "amount" | "depositor">;

/** An absent Deck entry is not proof of a Pull. Read at most two recent receipts. */
export async function readPulledRoyalty(
  rpc: OutcomeRpc,
  wallet: PublicKey,
  entries: readonly MissingEntry[],
  observedSlot: number,
  limit: 1 | 2 = 2,
): Promise<bigint | null> {
  if (
    !entries.length ||
    (limit !== 1 && limit !== 2) ||
    !Number.isSafeInteger(observedSlot) ||
    observedSlot < 0 ||
    entries.some((entry) => !entry.depositor.equals(wallet))
  )
    return null;
  try {
    const signatures = await rpc.getSignaturesForAddress(
      deckPda(webDeployment().programId)[0],
      { limit, minContextSlot: observedSlot },
      "confirmed",
    );
    const remaining = [...entries];
    const receipts = new Set<string>();
    const picks = new Set<string>();
    let total = 0n;
    for (const row of signatures.slice(0, limit)) {
      if (
        row.err !== null ||
        row.slot <= observedSlot ||
        receipts.has(row.signature)
      )
        continue;
      receipts.add(row.signature);
      const transaction = await rpc.getTransaction(row.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (
        !transaction ||
        transaction.meta?.err !== null ||
        transaction.slot !== row.slot ||
        transaction.transaction.signatures[0] !== row.signature
      )
        continue;
      const message = transaction.transaction.message;
      const keys = message.getAccountKeys({
        accountKeysFromLookups: transaction.meta.loadedAddresses,
      });
      const programIds = message.compiledInstructions.map((instruction) => {
        const key = keys.get(instruction.programIdIndex);
        if (!key) throw new Error("Invalid program account index");
        return key.toBase58();
      });
      const parsed = parseOnepercentLogs({
        logs: transaction.meta.logMessages ?? null,
        err: transaction.meta.err,
        programId: webDeployment().programId.toBase58(),
        topLevelProgramIds: programIds,
      });
      if (parsed.truncated || parsed.malformed || parsed.unknownEvent) continue;
      for (const event of parsed.events) {
        if (event.name !== "PackRevealed") continue;
        const edition = PACK_EDITIONS.find(
          (item) => item.index === event.data.edition,
        );
        if (!edition) continue;
        for (const [index, pick] of event.data.dust.entries()) {
          const id = `${event.data.seq}:${event.data.pack}:${index}`;
          if (picks.has(id) || pick.depositor !== wallet.toBase58()) continue;
          const match = remaining.findIndex(
            (entry) =>
              entry.mint.toBase58() === pick.mint &&
              entry.amount === pick.amount,
          );
          if (match < 0) continue;
          picks.add(id);
          remaining.splice(match, 1);
          total +=
            (edition.priceLamports *
              BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) /
            BigInt(BPS_DENOMINATOR);
        }
      }
    }
    return remaining.length ? null : total;
  } catch {
    return null;
  }
}
