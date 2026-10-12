import { warnCause } from "../safe-cause.js";
import {
  evaluateFeedProvenance,
  type FeedProvenanceInput,
} from "./provenance.js";

/** Matches S1's landed BagFed callback. Evidence must describe the state before this Feed. */
export interface LandedFeedProvenanceInput {
  depositor: string;
  mint: string;
  amount: string;
  slot: bigint;
  signature: string;
}
export interface BeforeFeedEvidence extends FeedProvenanceInput {
  beforeFeed: { slot: bigint; signature: string };
}
export type BeforeFeedEvidenceReader = (
  input: LandedFeedProvenanceInput,
) => Promise<BeforeFeedEvidence | null>;

/** Missing or unavailable historical proof becomes S1's explicit unknown result. */
export async function recomputeProvenance(
  input: LandedFeedProvenanceInput,
  readBeforeFeed: BeforeFeedEvidenceReader,
): Promise<{ path: "self" | "hop"; via: string | null } | null> {
  try {
    if (
      !/^\d{1,20}$/.test(input.amount) ||
      BigInt(input.amount) <= 0n ||
      BigInt(input.amount) > (1n << 64n) - 1n ||
      input.slot < 0n ||
      !input.signature
    )
      return null;
    const evidence = await readBeforeFeed(input);
    if (
      !evidence ||
      evidence.wallet !== input.depositor ||
      evidence.mint !== input.mint ||
      evidence.balanceNow !== BigInt(input.amount) ||
      BigInt(evidence.snapshotSlot) > input.slot ||
      evidence.beforeFeed.slot !== input.slot ||
      evidence.beforeFeed.signature !== input.signature
    )
      return null;
    const result = evaluateFeedProvenance(evidence);
    return result.eligible ? { path: result.path, via: result.via } : null;
  } catch (error) {
    warnCause("provenance_unavailable", error);
    return null;
  }
}

/** Inject this callback directly into the S1 indexer's recomputeProvenance option. */
export function createProvenanceRecomputer(
  readBeforeFeed: BeforeFeedEvidenceReader,
) {
  return (input: LandedFeedProvenanceInput) =>
    recomputeProvenance(input, readBeforeFeed);
}
