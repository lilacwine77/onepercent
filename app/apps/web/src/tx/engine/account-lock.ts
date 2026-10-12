import { webDeployment } from "../../data/deployment";
import type { DeckEntry } from "@onepercent/sdk/browser";
import { enterSubmission } from "../submission-guard";

export const accountIdentity = (chain: string, wallet: string) =>
  `${chain}:${webDeployment().programId}:${wallet}`;

/** A swap-remove changes the index, not the deposited card's identity. */
export const cardIdentity = (entry: DeckEntry) =>
  [
    entry.depositor.toBase58(),
    entry.mint.toBase58(),
    entry.amount,
    entry.flags,
    entry.deposit,
  ].join(":");

// Share the existing Rip/Cards guard across routes and confirmation waits.
export async function withAccountLock<T>(
  chain: string,
  wallet: string,
  action: () => Promise<T>,
  height: () => Promise<number>,
  scope?: readonly string[],
): Promise<T> {
  const leave = await enterSubmission(
    accountIdentity(chain, wallet),
    height,
    scope,
  );
  try {
    return await action();
  } finally {
    leave();
  }
}
