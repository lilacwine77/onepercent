import { Buffer } from "buffer";
import {
  Ed25519Program,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { ATTESTATIONS, DRAW_TAGS } from "@onepercent/config";
import { MAX_SELL_BACK_CARDS } from "./constants.js";
import { fixedBytes, hash, i64, u8, u16, u32, u64 } from "./bytes.js";
export interface AttestationBag {
  mint: PublicKey;
  amount: bigint;
}
export function bagsHash(bags: readonly AttestationBag[]): Buffer {
  return hash(
    ...bags.flatMap(({ mint, amount }) => [mint.toBuffer(), u64(amount)]),
  );
}
export function feedMessage(input: {
  wallet: PublicKey;
  nonce: number;
  expiry: bigint;
  bags: readonly AttestationBag[];
  programId: PublicKey;
}): Buffer {
  return Buffer.concat([
    Buffer.from(ATTESTATIONS.feedDomain),
    input.programId.toBuffer(),
    input.wallet.toBuffer(),
    u32(input.nonce),
    i64(input.expiry),
    u8(input.bags.length),
    bagsHash(input.bags),
  ]);
}
export function holdMessage(input: {
  wallet: PublicKey;
  expiry: bigint;
  programId: PublicKey;
}): Buffer {
  return Buffer.concat([
    Buffer.from(ATTESTATIONS.holdDomain),
    input.programId.toBuffer(),
    input.wallet.toBuffer(),
    i64(input.expiry),
  ]);
}
export function callerSeed(
  programId: PublicKey,
  seq: bigint,
  buyer: PublicKey,
): Buffer {
  return hash(
    Buffer.from(DRAW_TAGS.vrfSeed),
    programId.toBuffer(),
    u64(seq),
    buyer.toBuffer(),
  );
}
export function ed25519Instruction(input: {
  publicKey: PublicKey;
  signature: Uint8Array;
  message: Uint8Array;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: Ed25519Program.programId,
    keys: [],
    data: Buffer.concat([
      Buffer.from([1, 0]),
      u16(48),
      u16(0xffff),
      u16(16),
      u16(0xffff),
      u16(112),
      u16(input.message.length),
      u16(0xffff),
      input.publicKey.toBuffer(),
      fixedBytes(input.signature, 64),
      input.message,
    ]),
  });
}
/** Cluster block time, never the workstation's clock. */
export function attestationExpiry(
  blockTime: bigint,
  ttlSeconds: number,
): bigint {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 10)
    throw new RangeError("Invalid attestation TTL");
  return blockTime + BigInt(ttlSeconds) - 10n;
}

export interface SellBackCard {
  index: number;
  amount: bigint;
}

/** Encodes the caller's order exactly; indices must already be descending. */
export function sellBackMessage(input: {
  programId: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  cards: readonly SellBackCard[];
  totalAmount: bigint;
  quoteLamports: bigint;
  expiry: bigint;
  nonce: number;
}): Buffer {
  if (input.cards.length < 1 || input.cards.length > MAX_SELL_BACK_CARDS)
    throw new RangeError("Invalid Sell back card count");
  let total = 0n;
  const cards = input.cards.map((card, index) => {
    if (index > 0 && card.index >= input.cards[index - 1]!.index)
      throw new RangeError("Sell back indices must be strictly descending");
    total += card.amount;
    return Buffer.concat([u16(card.index), u64(card.amount)]);
  });
  if (total !== input.totalAmount)
    throw new RangeError("Sell back total does not match card amounts");
  return Buffer.concat([
    Buffer.from(ATTESTATIONS.sellBackDomain),
    input.programId.toBuffer(),
    input.owner.toBuffer(),
    input.mint.toBuffer(),
    u8(input.cards.length),
    ...cards,
    u64(input.totalAmount),
    u64(input.quoteLamports),
    i64(input.expiry),
    u32(input.nonce),
  ]);
}
