import { createHash } from "node:crypto";
import { TX_LIMITS } from "@onepercent/config";
import { sellBackMessage } from "@onepercent/sdk";
import { PublicKey } from "@solana/web3.js";

export type SellBackMessageInput = Parameters<typeof sellBackMessage>[0];
export type SellBackMessageEncoder = (
  input: SellBackMessageInput,
) => Uint8Array;
export const sellBackMessageVectors = [
  {
    cards: [{ index: 3, amount: 1000n }],
    totalAmount: 1000n,
    nonce: 0,
    length: 145,
    sha256: "edf53101d7a0071b005cdae28d29e6ddbe17c9e9ab59d57efa7df9455d8b501c",
  },
  {
    cards: Array.from({ length: 8 }, (_, k) => ({
      index: 7 - k,
      amount: BigInt(1000 + k),
    })),
    totalAmount: 8028n,
    nonce: 7,
    length: 215,
    sha256: "53fec985a265aeaa8eeeecc3d254da20f4d224c6c9cb3d63c87c4ca439676c76",
  },
] as const;

/** Check the canonical SDK encoder against M2 §7.1 before signing. */
export function checkedSellBackEncoder(
  encode: SellBackMessageEncoder = sellBackMessage,
): SellBackMessageEncoder {
  for (const vector of sellBackMessageVectors) {
    const message = encode({
      programId: new PublicKey(Buffer.alloc(32)),
      owner: new PublicKey(Buffer.alloc(32, 1)),
      mint: new PublicKey(Buffer.alloc(32, 2)),
      cards: vector.cards,
      totalAmount: vector.totalAmount,
      quoteLamports: 5_000_000n,
      expiry: 1_800_000_000n,
      nonce: vector.nonce,
    });
    if (
      message.length !== vector.length ||
      createHash("sha256").update(message).digest("hex") !== vector.sha256
    )
      throw new Error("sb_encoder_vector_mismatch");
  }
  return (input) => {
    if (
      input.cards.length < 1 ||
      input.cards.length > TX_LIMITS.redeemPerTx ||
      input.cards.some(
        (card, index) =>
          index > 0 && card.index >= input.cards[index - 1]!.index,
      )
    )
      throw new Error("sb_encoder_invalid_cards");
    const message = encode(input);
    if (message.length !== 135 + 10 * input.cards.length)
      throw new Error("sb_encoder_invalid_length");
    return message;
  };
}
