import type { PublicKey } from "@solana/web3.js";
import { CU_LIMITS } from "@onepercent/config";
import { integer } from "../bytes.js";
import { MAX_FEED_BACK_CARDS } from "../constants.js";
import { feedBackIx } from "../ix/index.js";
import { myCardsTransaction } from "./binder.js";
import type { BuiltTransaction, TransactionOptions } from "./index.js";

export interface FeedBackTransactionOptions extends TransactionOptions {
  cardIndices: readonly number[];
}

/** Submit batches in the returned order so swap removal preserves later indices. */
export function buildFeedBackTransactions(
  programId: PublicKey,
  options: FeedBackTransactionOptions,
): BuiltTransaction[] {
  for (const index of options.cardIndices) integer(index, 0xffff, "Card index");
  if (new Set(options.cardIndices).size !== options.cardIndices.length)
    throw new RangeError("Duplicate Feed back card index");
  const sorted = [...options.cardIndices].sort((a, b) => b - a);
  const result: BuiltTransaction[] = [];
  for (let start = 0; start < sorted.length; start += MAX_FEED_BACK_CARDS) {
    const cardIndices = sorted.slice(start, start + MAX_FEED_BACK_CARDS);
    result.push(
      myCardsTransaction(
        options,
        [feedBackIx(programId, { owner: options.wallet, cardIndices })],
        cardIndices.length === 1
          ? CU_LIMITS.feedBack.x1
          : CU_LIMITS.feedBack.x8,
      ),
    );
  }
  return result;
}
