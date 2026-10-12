import { webDeployment } from "../../data/deployment";
import { ATTESTATIONS } from "@onepercent/config";
import {
  bagsHash,
  feedMessage,
  feedNonces,
  type PlannedFeedBag,
} from "@onepercent/sdk/browser";
import { FeedAttestResponse } from "@onepercent/sdk/api";
import { PublicKey, SIGNATURE_LENGTH_IN_BYTES } from "@solana/web3.js";
import { api } from "../../data/api";
import { equalBytes, fromBase64 } from "../../util/bytes";
import { EngineError } from "../engine/errors";

export type AttestedChunk = {
  nonce: number;
  expiry: bigint;
  signature: Uint8Array;
  bags: PlannedFeedBag[];
};
export async function requestAttest(
  wallet: PublicKey,
  chunks: readonly (readonly PlannedFeedBag[])[],
) {
  return api("/api/feed/attest", FeedAttestResponse, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: wallet.toBase58(),
      chunks: chunks.map((bags) =>
        bags.map((bag) => ({ mint: bag.mint.toBase58() })),
      ),
    }),
  });
}
/** Reject extra, omitted, reordered, stale or changed bags before any wallet prompt. */
export function validateAttest(input: {
  response: FeedAttestResponse;
  wallet: PublicKey;
  signer: PublicKey;
  snapshotSlot: bigint;
  minSlot: number;
  now: bigint;
  nonceBase: number;
  nonceBits: number;
  chunks: readonly (readonly PlannedFeedBag[])[];
}): AttestedChunk[] {
  const { response, chunks } = input;
  const invalid = () => {
    throw new EngineError("feed.refusal.not_whole_bag");
  };
  if (
    response.wallet !== input.wallet.toBase58() ||
    response.signer !== input.signer.toBase58() ||
    BigInt(response.snapshotSlot) !== input.snapshotSlot ||
    response.asOfSlot < input.minSlot
  )
    invalid();
  const requested = new Map(
    chunks.flatMap((bags) =>
      bags.map((bag) => [bag.mint.toBase58(), bag] as const),
    ),
  );
  if (requested.size !== chunks.flat().length) invalid();
  const refused = new Set<string>();
  for (const bag of response.refused) {
    if (!requested.has(bag.mint) || refused.has(bag.mint)) invalid();
    refused.add(bag.mint);
  }
  const nonces = feedNonces(
    input.nonceBase,
    input.nonceBits,
    response.attestations.length,
  );
  const seen = new Set<string>();
  const seenChunks = new Set<number>();
  let previousChunk = -1;
  const output = response.attestations.map((att, index): AttestedChunk => {
    const original = chunks[att.chunk];
    if (
      !original ||
      seenChunks.has(att.chunk) ||
      att.chunk <= previousChunk ||
      att.nonce !== nonces[index]
    )
      invalid();
    previousChunk = att.chunk;
    seenChunks.add(att.chunk);
    const expected = original!.filter(
      (bag) => !refused.has(bag.mint.toBase58()),
    );
    if (expected.length !== att.bags.length) invalid();
    const bags = att.bags.map((bag, bagIndex) => {
      const planned = expected[bagIndex];
      if (
        !planned ||
        planned.mint.toBase58() !== bag.mint ||
        refused.has(bag.mint) ||
        seen.has(bag.mint) ||
        bag.mergeFrom.length ||
        planned.amount !== BigInt(bag.amount) ||
        planned.decimals !== bag.decimals ||
        planned.tokenProgram.toBase58() !== bag.tokenProgram ||
        planned.source.toBase58() !== bag.source
      )
        invalid();
      seen.add(bag.mint);
      return {
        ...planned!,
        amount: BigInt(bag.amount),
        source: new PublicKey(bag.source),
      };
    });
    const expiry = BigInt(att.expiry);
    // The signer already applies the SDK margin to its TTL.
    if (
      expiry <= input.now ||
      expiry > input.now + BigInt(ATTESTATIONS.feedTtlSeconds)
    )
      throw new EngineError("errors.tooLong");
    const message = feedMessage({
      programId: webDeployment().programId,
      wallet: input.wallet,
      nonce: att.nonce,
      expiry,
      bags,
    });
    const signature = fromBase64(att.signature);
    if (
      !equalBytes(fromBase64(att.message), message) ||
      bagsHash(bags).toString("hex") !== att.bagsHash ||
      signature.length !== SIGNATURE_LENGTH_IN_BYTES ||
      signature.every((byte) => byte === 0)
    )
      invalid();
    return { nonce: att.nonce, expiry, signature, bags };
  });
  if (seen.size + refused.size !== requested.size) invalid();
  return output;
}
