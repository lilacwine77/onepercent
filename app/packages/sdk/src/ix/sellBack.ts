import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import type { SellBackCard } from "../attest.js";
import { i64, u8, u32, u64 } from "../bytes.js";
import { MAX_SELL_BACK_CARDS } from "../constants.js";
import {
  binderPda,
  configPda,
  ledgerPda,
  machinePda,
  vaultAta,
} from "../pda.js";
import {
  descendingCardIndices,
  readonly,
  writable,
  writableSigner,
} from "./m2.js";
import { instruction } from "./encoding.js";

export interface SellBackInput {
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  cards: readonly SellBackCard[];
  quoteLamports: bigint;
  expiry: bigint;
  nonce: number;
  attIx: number;
}

export function sellBackIx(programId: PublicKey, input: SellBackInput) {
  descendingCardIndices(
    input.cards.map((card) => card.index),
    MAX_SELL_BACK_CARDS,
  );
  for (const card of input.cards) u64(card.amount);
  u64(input.quoteLamports);
  i64(input.expiry);
  u32(input.nonce);
  u8(input.attIx);
  return instruction(
    programId,
    "sell_back",
    {
      cards: input.cards,
      quote_lamports: input.quoteLamports,
      expiry: input.expiry,
      nonce: input.nonce,
      att_ix: input.attIx,
    },
    [
      writableSigner(input.owner),
      readonly(configPda(programId)[0]),
      writable(machinePda(programId)[0]),
      writable(binderPda(programId, input.owner)[0]),
      readonly(input.mint),
      readonly(ledgerPda(programId, input.mint)[0]),
      readonly(vaultAta(programId, input.mint, input.tokenProgram)),
      readonly(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  );
}
