import { PublicKey } from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { u16 } from "../bytes.js";

export const readonly = (pubkey: PublicKey): AccountMeta => ({
  pubkey,
  isSigner: false,
  isWritable: false,
});
export const writable = (pubkey: PublicKey): AccountMeta => ({
  ...readonly(pubkey),
  isWritable: true,
});
export const writableSigner = (pubkey: PublicKey): AccountMeta => ({
  ...writable(pubkey),
  isSigner: true,
});

export function descendingCardIndices(
  indices: readonly number[],
  max: number,
): void {
  if (indices.length < 1 || indices.length > max)
    throw new RangeError("Invalid card count");
  indices.forEach((index, position) => {
    if (position > 0 && index >= indices[position - 1]!)
      throw new RangeError("Card indices must be strictly descending");
    u16(index);
  });
}
