import { warnCause } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import { ledgerAddress, ZERO_ADDRESS } from "./accounts.js";
import type { IndexedTransaction } from "./store.js";

/** Event-named program accounts only; transaction fee payers and token accounts are not scanned. */
export function dirtyAccountAddresses(
  tx: IndexedTransaction,
  programId: string,
): string[] {
  const result = new Set<string>();
  const valid = (key: unknown): key is string => {
    if (typeof key !== "string" || key === ZERO_ADDRESS) return false;
    try {
      return new PublicKey(key).toBase58() === key;
    } catch (error) {
      warnCause("indexer_address_invalid", error);
      return false;
    }
  };
  const mint = (key: unknown) => {
    if (valid(key)) result.add(ledgerAddress(programId, key));
  };
  for (const event of tx.events) {
    const d = event.data;
    if (
      [
        "PullOpened",
        "PullRevealed",
        "PullRefunded",
        "PullClosed",
        "PackSettled",
        "CallbackSkipped",
      ].includes(event.name) &&
      valid(d.pull)
    )
      result.add(d.pull);
    if (
      [
        "BagFed",
        "BagTakenBack",
        "CardFedBack",
        "CardRedeemed",
        "VaultClosed",
        "VaultShortfall",
        "ExecBegun",
        "ExecEnded",
        "SoldBack",
      ].includes(event.name)
    )
      mint(d.mint);
    if (event.name === "PackRevealed") {
      mint(d.hit_mint);
      if (Array.isArray(d.dust))
        for (const entry of d.dust) {
          if (entry && typeof entry === "object" && !Array.isArray(entry))
            mint(entry.mint);
        }
    }
  }
  return [...result];
}
