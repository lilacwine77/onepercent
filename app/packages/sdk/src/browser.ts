import type { Idl } from "@anchor-lang/core";
import idl from "./idl/onepercent.json" with { type: "json" };

/** User-facing reads and transaction builders, without keeper/executor modules.
 * Keep these exports explicit: the root SDK also serves operational services.
 */
export const IDL: Idl = idl as Idl;
export { bytesEqual, bytesToHex, bytesView } from "./bytes.js";
export {
  EXTERNAL_IDS,
  DECK_FLAGS,
  LIVE_FLAGS,
  FINAL_CLAIM_FLAGS,
  MEMO_PROGRAM_ID,
  PHASE,
  PULL_STATUS,
  SIZES,
  TOKEN_2022_NATIVE_MINT,
} from "./constants.js";
export { createDeploymentSelector } from "./deployment.js";
export type { ClusterDeployment } from "./deployment.js";
export {
  binderPda,
  bondingCurvePda,
  configPda,
  deckPda,
  machinePda,
  ledgerPda,
  pullPda,
  userAta,
  vaultAta,
  vaultAuthPda,
} from "./pda.js";
export {
  decodeBinder,
  decodeConfig,
  decodeMachine,
  decodeMintLedger,
  deckEntryLayout,
  deckHeaderLayout,
} from "./layouts.js";
export type {
  Binder,
  Card,
  Config,
  DeckEntry,
  Machine,
  MintLedger,
  Pull,
} from "./layouts.js";
export { fetchPull } from "./fetch.js";
export { feedNonces, maxQty, segments } from "./math/index.js";
export { programError } from "./errors.js";
export {
  bagsHash,
  ed25519Instruction,
  feedMessage,
  sellBackMessage,
} from "./attest.js";
export { closeBinderIx } from "./ix/closeBinder.js";
export { feedBackIx } from "./ix/feedBack.js";
export { sellBackIx } from "./ix/sellBack.js";
export { withdrawOwedIx } from "./ix/withdrawOwed.js";
export {
  buildBuyPacksTransaction,
  buildRedeemTransactions,
  buildRefundTransaction,
  buildSettleTransaction,
  buildTakeBackTransactions,
  FEED_BYTE_BUDGET,
  planFeedTransactions,
  serializedSize,
  transaction,
} from "./tx/index.js";
export type {
  BuiltTransaction,
  PlannedFeedBag,
  TransactionOptions,
} from "./tx/index.js";
export { buildMergeTransactions } from "./tx/merge.js";
export { precheckPayeeRent } from "./fetch.js";
export type { PayeeRentCheck } from "./fetch.js";

export { finalShare, finalShares } from "./math/finalPull.js";
export { claimFinalSolIx, claimFinalTokensIx } from "./ix/finalPull.js";
export {
  buildFinalClaimsTransaction,
  buildClaimFinalSolTransaction,
  buildClaimFinalTokensTransaction,
} from "./tx/finalClaims.js";
