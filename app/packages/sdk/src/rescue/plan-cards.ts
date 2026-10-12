import { Transaction } from "@solana/web3.js";
import { buildRedeemTransactions } from "../tx/index.js";
import type { Card } from "../layouts.js";
import { readBinder, readMints } from "./discover.js";
import {
  selectionIndices,
  type RescuePlan,
  type RescuePlanOptions,
} from "./compose.js";

/** An explicit selection keeps its identity across a refresh or partial landing. */
export interface CardSelection extends Card {
  cardIndex: number;
}

export async function planRedeem(
  options: RescuePlanOptions & {
    indices?: readonly number[];
    expected?: readonly CardSelection[];
  },
): Promise<RescuePlan> {
  const binder = await readBinder(
    options.rpc,
    options.programId,
    options.wallet,
  );
  const indices = selectionIndices(options.indices, binder?.cards.length ?? 0);
  const remaining: RescuePlan["remaining"] = [];
  const cards = indices.flatMap((cardIndex) => {
    const card = binder?.cards[cardIndex];
    const expected = options.expected?.find(
      (item) => item.cardIndex === cardIndex,
    );
    if (
      !card ||
      (options.expected !== undefined && !expected) ||
      (expected &&
        (!expected.mint.equals(card.mint) ||
          expected.amount !== card.amount ||
          expected.kind !== card.kind ||
          expected.value !== card.value ||
          expected.edition !== card.edition ||
          expected.flags !== card.flags ||
          expected.seq_lo !== card.seq_lo ||
          expected._pad !== card._pad))
    ) {
      remaining.push({
        action: "redeem",
        address: String(cardIndex),
        reason:
          "CardMoved: the selected card changed; select it again from a fresh scan",
      });
      return [];
    }
    if (card.kind > 8) {
      remaining.push({
        action: "redeem",
        address: String(cardIndex),
        reason:
          "CardNotRedeemable: the program does not support this card kind",
      });
      return [];
    }
    return [{ ...card, cardIndex }];
  });
  const mints = await readMints(
    options.rpc,
    cards.map((card) => card.mint),
  );
  const transactions = buildRedeemTransactions(options.programId, {
    wallet: options.wallet,
    blockhash: options.blockhash,
    cards: cards.map((card) => ({
      ...card,
      tokenProgram: mints.find((mint) => mint.address.equals(card.mint))!
        .tokenProgram,
    })),
  });
  return {
    transactions: transactions.map((built) => {
      if (!(built instanceof Transaction))
        throw new Error("Unexpected versioned rescue transaction");
      const exits = built.instructions.filter((ix) =>
        ix.programId.equals(options.programId),
      );
      const selected = exits.map((ix) =>
        cards.find((card) => card.cardIndex === ix.data.readUInt16LE(8))!,
      );
      return {
        transaction: built,
        action: "redeem",
        addresses: [options.wallet.toBase58()],
        slot: Math.max(binder!.slot, ...mints.map((mint) => mint.slot)),
        indices: exits.map((ix) => ix.data.readUInt16LE(8)),
        details: selected.map((card) => ({
          index: card.cardIndex,
          mint: card.mint,
          amount: card.amount,
          kind: card.kind,
          recipient: options.wallet,
        })),
      };
    }),
    remaining,
  };
}
