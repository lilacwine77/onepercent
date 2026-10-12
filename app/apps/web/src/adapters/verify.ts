import { CARD_KINDS } from "@onepercent/config";
import { verifyPull } from "@onepercent/sdk/verify";
import type { PullEvidence } from "../data/pull";
import { oddsTableHash } from "./odds";

/** Recomputes locally, including for API fallback. Never trusts the API check field. */
export async function verifyModel(
  evidence: PullEvidence,
  programId: string,
  metadata: {
    revealedSlot: number | null;
    revealOrder: number | null;
    paramsHash: string | null;
  },
) {
  const packs = evidence.packs.map((pack) => ({
    seq: pack.seq,
    pack: pack.pack,
    edition: pack.edition,
    liveFlags: pack.live_flags,
    holder: pack.holder,
    t: pack.t,
    widths: pack.widths,
    tier: pack.tier,
    hitBucket: pack.hit_bucket,
    dust: pack.dust.map((pick) => ({
      deckLenBefore: pick.deck_len_before,
      index: pick.index,
    })),
  }));
  const check = evidence.refunded
    ? null
    : await verifyPull({ pull: evidence.header, packs, programId });
  return {
    seq: evidence.header.seq.toString(),
    source: evidence.source,
    refunded: evidence.refunded,
    check,
    // Recomputing a public draw is not independent verification of the provider proof.
    providerProofVerified: false as const,
    packs: packs.map((pack) => ({
      ...pack,
      kind: CARD_KINDS[pack.tier] ?? null,
    })),
    links: {
      request: evidence.requestSignature,
      callback: evidence.callbackSignature,
      settles: evidence.settleSignatures,
    },
    tableHash: await oddsTableHash(evidence.header.edition),
    ...metadata,
  };
}
export type VerifyModel = Awaited<ReturnType<typeof verifyModel>>;
