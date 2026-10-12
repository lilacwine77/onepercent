import { PublicKey, SystemProgram } from "@solana/web3.js";
import { MAX_FEED_BACK_CARDS } from "../constants.js";
import { binderPda, configPda, deckPda, machinePda } from "../pda.js";
import {
  descendingCardIndices,
  readonly,
  writable,
  writableSigner,
} from "./m2.js";
import { instruction } from "./encoding.js";

export interface FeedBackInput {
  owner: PublicKey;
  cardIndices: readonly number[];
}

export function feedBackIx(programId: PublicKey, input: FeedBackInput) {
  descendingCardIndices(input.cardIndices, MAX_FEED_BACK_CARDS);
  return instruction(
    programId,
    "feed_back",
    { card_indices: input.cardIndices },
    [
      writableSigner(input.owner),
      readonly(configPda(programId)[0]),
      readonly(machinePda(programId)[0]),
      writable(deckPda(programId)[0]),
      writable(binderPda(programId, input.owner)[0]),
      readonly(SystemProgram.programId),
    ],
  );
}
