import { CU_LIMITS } from "@onepercent/config";
import type { PublicKey } from "@solana/web3.js";
import { ed25519Instruction, sellBackMessage } from "../attest.js";
import type { SellBackCard } from "../attest.js";
import { sellBackIx } from "../ix/index.js";
import { myCardsTransaction } from "./binder.js";
import type { BuiltTransaction, TransactionOptions } from "./index.js";

export interface SellBackTransactionOptions extends TransactionOptions {
  mint: PublicKey;
  tokenProgram: PublicKey;
  cards: readonly SellBackCard[];
  quoteLamports: bigint;
  expiry: bigint;
  nonce: number;
  quoteSigner: PublicKey;
  signature: Uint8Array;
}

/** Preserves the signed order; a quote is never sorted, split or re-used for another batch. */
export function buildSellBackTransaction(
  programId: PublicKey,
  options: SellBackTransactionOptions,
): BuiltTransaction {
  const totalAmount = options.cards.reduce(
    (sum, card) => sum + card.amount,
    0n,
  );
  const attIx =
    options.computeBudget === false
      ? 0
      : options.priorityFeeMicroLamports === undefined
        ? 1
        : 2;
  return myCardsTransaction(
    options,
    [
      ed25519Instruction({
        publicKey: options.quoteSigner,
        signature: options.signature,
        message: sellBackMessage({
          programId: programId,
          ...options,
          owner: options.wallet,
          totalAmount,
        }),
      }),
      sellBackIx(programId, { ...options, owner: options.wallet, attIx }),
    ],
    options.cards.length === 1 ? CU_LIMITS.sellBack.x1 : CU_LIMITS.sellBack.x8,
  );
}
