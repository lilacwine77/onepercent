import { Buffer } from "buffer";
import { utils } from "../anchor.js";
import {
  BPS_DENOMINATOR,
  CU_LIMITS,
  DRAW_TAGS,
  TX_LIMITS,
} from "@onepercent/config";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AddressLookupTableAccount } from "@solana/web3.js";
import { ed25519Instruction, feedMessage, holdMessage } from "../attest.js";
import { MEMO_PROGRAM_ID } from "../constants.js";
import {
  buyPacksInstruction,
  feedInstruction,
  redeemInstruction,
  refundPullInstruction,
  settleInstruction,
  takeBackInstruction,
} from "../ix/index.js";
import type { ExitItem, FeedBag, Payee, SettleInput } from "../ix/index.js";
import { feedNonces } from "../math/index.js";
import { userAta, vaultAta, vaultAuthPda } from "../pda.js";

export type BuiltTransaction = Transaction | VersionedTransaction;
export interface TransactionOptions {
  wallet: PublicKey;
  blockhash: string;
  lut?: AddressLookupTableAccount;
  priorityFeeMicroLamports?: bigint;
  computeBudget?: boolean;
}
export function transaction(
  options: TransactionOptions,
  instructions: TransactionInstruction[],
): BuiltTransaction {
  if (options.lut)
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: options.wallet,
        recentBlockhash: options.blockhash,
        instructions,
      }).compileToV0Message([options.lut]),
    );
  return new Transaction({
    feePayer: options.wallet,
    recentBlockhash: options.blockhash,
  }).add(...instructions);
}
const shortSize = (n: number) => {
  let bytes = 1;
  while (n >= 128) {
    n = Math.floor(n / 128);
    bytes++;
  }
  return bytes;
};
/** Exact wire length, including all 64-byte signature slots, even for oversized candidates. */
export function serializedSize(tx: BuiltTransaction): number {
  const message = tx instanceof Transaction ? tx.compileMessage() : tx.message;
  let size =
    shortSize(message.header.numRequiredSignatures) +
    64 * message.header.numRequiredSignatures +
    3 +
    32;
  if (message.version !== "legacy") {
    size +=
      1 +
      shortSize(message.staticAccountKeys.length) +
      message.staticAccountKeys.length * 32;
    size += shortSize(message.compiledInstructions.length);
    for (const ix of message.compiledInstructions)
      size +=
        1 +
        shortSize(ix.accountKeyIndexes.length) +
        ix.accountKeyIndexes.length +
        shortSize(ix.data.length) +
        ix.data.length;
    size += shortSize(message.addressTableLookups.length);
    for (const lookup of message.addressTableLookups)
      size +=
        32 +
        shortSize(lookup.writableIndexes.length) +
        lookup.writableIndexes.length +
        shortSize(lookup.readonlyIndexes.length) +
        lookup.readonlyIndexes.length;
  } else {
    size +=
      shortSize(message.accountKeys.length) +
      message.accountKeys.length * 32 +
      shortSize(message.instructions.length);
    for (const ix of message.instructions) {
      const bytes = utils.bytes.bs58.decode(ix.data).length;
      size +=
        1 +
        shortSize(ix.accounts.length) +
        ix.accounts.length +
        shortSize(bytes) +
        bytes;
    }
  }
  return size;
}
function budget(
  options: TransactionOptions,
  units: number,
): TransactionInstruction[] {
  if (options.computeBudget === false) return [];
  const out = [ComputeBudgetProgram.setComputeUnitLimit({ units })];
  if (options.priorityFeeMicroLamports !== undefined)
    out.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: options.priorityFeeMicroLamports,
      }),
    );
  return out;
}
function checked(
  options: TransactionOptions,
  instructions: TransactionInstruction[],
  limit: number = TX_LIMITS.maxTxBytes,
): BuiltTransaction {
  const tx = transaction(options, instructions);
  if (serializedSize(tx) > limit)
    throw new RangeError(`Transaction exceeds ${limit}-byte budget`);
  return tx;
}
export interface PlannedFeedBag extends FeedBag {
  source: PublicKey;
  decimals: number;
  vaultExists: boolean;
  closeSource: boolean;
}
export interface FeedAttestation {
  expiry: bigint;
  signature: Uint8Array;
}
export interface FeedPlanOptions extends TransactionOptions {
  bags: readonly PlannedFeedBag[];
  intakeSigner: PublicKey;
  nonceBase: number;
  nonceBits: number;
  attest: (chunk: {
    bags: readonly PlannedFeedBag[];
    nonce: number;
    wallet: PublicKey;
  }) => FeedAttestation | Promise<FeedAttestation>;
}
export const FEED_BYTE_BUDGET = Math.floor(
  (TX_LIMITS.maxTxBytes * (BPS_DENOMINATOR - TX_LIMITS.byteHeadroomBps)) /
    BPS_DENOMINATOR,
);
export function feedTransactionInstructions(
  programId: PublicKey,
  options: TransactionOptions & {
    bags: readonly PlannedFeedBag[];
    intakeSigner: PublicKey;
    nonce: number;
    attestation: FeedAttestation;
  },
): TransactionInstruction[] {
  const units = CU_LIMITS.feed[options.bags.length - 1];
  if (!units) throw new RangeError("Unsupported Feed bag count");
  const out = budget(options, units);
  const attIx = out.length;
  out.push(
    ed25519Instruction({
      publicKey: options.intakeSigner,
      signature: options.attestation.signature,
      message: feedMessage({
        programId,
        wallet: options.wallet,
        nonce: options.nonce,
        expiry: options.attestation.expiry,
        bags: options.bags,
      }),
    }),
  );
  for (const bag of options.bags) {
    const vault = vaultAta(programId, bag.mint, bag.tokenProgram);
    if (!bag.vaultExists)
      out.push(
        createAssociatedTokenAccountIdempotentInstruction(
          options.wallet,
          vault,
          vaultAuthPda(programId)[0],
          bag.mint,
          bag.tokenProgram,
        ),
      );
    out.push(
      createTransferCheckedInstruction(
        bag.source,
        bag.mint,
        vault,
        options.wallet,
        bag.amount,
        bag.decimals,
        [],
        bag.tokenProgram,
      ),
    );
  }
  out.push(
    feedInstruction(programId, {
      depositor: options.wallet,
      bags: options.bags,
      expiry: options.attestation.expiry,
      nonce: options.nonce,
      attIx,
    }),
  );
  for (const bag of options.bags)
    if (bag.closeSource)
      out.push(
        createCloseAccountInstruction(
          bag.source,
          options.wallet,
          options.wallet,
          [],
          bag.tokenProgram,
        ),
      );
  return out;
}
export async function planFeedTransactions(
  programId: PublicKey,
  options: FeedPlanOptions,
): Promise<
  {
    transaction: BuiltTransaction;
    bags: readonly PlannedFeedBag[];
    nonce: number;
  }[]
> {
  if (
    new Set(options.bags.map((b) => b.mint.toBase58())).size !==
    options.bags.length
  )
    throw new Error("Duplicate Feed mint");
  const chunks: PlannedFeedBag[][] = [];
  let current: PlannedFeedBag[] = [];
  for (const bag of options.bags) {
    const candidate = [...current, bag];
    const fits =
      candidate.length <= CU_LIMITS.feed.length &&
      serializedSize(
        transaction(
          options,
          feedTransactionInstructions(programId, {
            ...options,
            bags: candidate,
            nonce: 0,
            attestation: { expiry: 0n, signature: new Uint8Array(64) },
          }),
        ),
      ) <= FEED_BYTE_BUDGET;
    if (fits) {
      current = candidate;
      continue;
    }
    if (current.length === 0)
      throw new RangeError("A Feed bag exceeds the transaction budget");
    chunks.push(current);
    current = [bag];
    checked(
      options,
      feedTransactionInstructions(programId, {
        ...options,
        bags: current,
        nonce: 0,
        attestation: { expiry: 0n, signature: new Uint8Array(64) },
      }),
      FEED_BYTE_BUDGET,
    );
  }
  if (current.length) chunks.push(current);
  const nonces = feedNonces(
    options.nonceBase,
    options.nonceBits,
    chunks.length,
  );
  const result = [];
  for (const [index, bags] of chunks.entries()) {
    const nonce = nonces[index] as number;
    const attestation = await options.attest({
      bags,
      nonce,
      wallet: options.wallet,
    });
    result.push({
      transaction: checked(
        options,
        feedTransactionInstructions(programId, {
          ...options,
          bags,
          nonce,
          attestation,
        }),
        FEED_BYTE_BUDGET,
      ),
      bags,
      nonce,
    });
  }
  return result;
}
export interface RedeemItem extends ExitItem {
  cardIndex: number;
}
export interface TakeBackItem extends ExitItem {
  deckIndex: number;
}
function exits(
  programId: PublicKey,
  options: TransactionOptions,
  items: readonly (ExitItem & { index: number })[],
  kind: "redeem" | "takeBack",
): BuiltTransaction[] {
  if (new Set(items.map((item) => item.index)).size !== items.length)
    throw new Error("Duplicate exit index");
  const sorted = [...items].sort((a, b) => b.index - a.index);
  const instructionsFor = (batch: typeof sorted) => {
    const units =
      kind === "redeem"
        ? batch.length === 1
          ? CU_LIMITS.redeem.x1
          : CU_LIMITS.redeem.x8
        : CU_LIMITS.takeBack * batch.length;
    const out = budget(options, units);
    const created = new Set<string>();
    for (const item of batch) {
      const destination = userAta(options.wallet, item.mint, item.tokenProgram);
      if (!created.has(destination.toBase58())) {
        created.add(destination.toBase58());
        out.push(
          createAssociatedTokenAccountIdempotentInstruction(
            options.wallet,
            destination,
            options.wallet,
            item.mint,
            item.tokenProgram,
          ),
        );
      }
      out.push(
        kind === "redeem"
          ? redeemInstruction(programId, {
              ...item,
              owner: options.wallet,
              cardIndex: item.index,
            })
          : takeBackInstruction(programId, {
              ...item,
              depositor: options.wallet,
              deckIndex: item.index,
            }),
      );
    }
    return out;
  };
  const result: BuiltTransaction[] = [];
  let current: typeof sorted = [];
  const max =
    kind === "redeem" ? TX_LIMITS.redeemPerTx : TX_LIMITS.takeBackPerTx;
  for (const item of sorted) {
    const candidate = [...current, item];
    if (
      candidate.length <= max &&
      serializedSize(transaction(options, instructionsFor(candidate))) <=
        TX_LIMITS.maxTxBytes
    )
      current = candidate;
    else {
      if (current.length === 0)
        throw new RangeError("Exit exceeds transaction byte limit");
      result.push(checked(options, instructionsFor(current)));
      current = [item];
    }
  }
  if (current.length) result.push(checked(options, instructionsFor(current)));
  return result;
}
export function buildRedeemTransactions(
  programId: PublicKey,
  options: TransactionOptions & { cards: readonly RedeemItem[] },
): BuiltTransaction[] {
  return exits(
    programId,
    options,
    options.cards.map((card) => ({ ...card, index: card.cardIndex })),
    "redeem",
  );
}
export function buildTakeBackTransactions(
  programId: PublicKey,
  options: TransactionOptions & { entries: readonly TakeBackItem[] },
): BuiltTransaction[] {
  return exits(
    programId,
    options,
    options.entries.map((entry) => ({ ...entry, index: entry.deckIndex })),
    "takeBack",
  );
}
export function buildSettleTransaction(
  programId: PublicKey,
  options: TransactionOptions & { packs: readonly SettleInput[] },
): BuiltTransaction {
  if (
    !options.packs.length ||
    options.packs.length > TX_LIMITS.settlePacksPerTx
  )
    throw new RangeError("Invalid settle pack count");
  const units = CU_LIMITS.settle[options.packs.length - 1];
  if (!units) throw new RangeError("Missing settle compute limit");
  const out = [
    ...budget(options, units),
    ...options.packs.map((pack) => settleInstruction(programId, pack)),
  ];
  for (const seq of new Set(options.packs.map((pack) => pack.seq)))
    out.push(
      new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        data: Buffer.from(`${DRAW_TAGS.royaltyMemoPrefix}${seq}`),
      }),
    );
  return checked(options, out);
}
export function buildRefundTransaction(
  programId: PublicKey,
  options: TransactionOptions & { pull: PublicKey; seq: bigint; buyer: Payee },
): BuiltTransaction {
  return checked(options, [
    ...budget(options, CU_LIMITS.refundPull),
    refundPullInstruction(programId, options),
  ]);
}
export function buildBuyPacksTransaction(
  programId: PublicKey,
  options: TransactionOptions & {
    edition: number;
    qty: number;
    pullNonce: number;
    minLiveFlags?: number;
    referrer?: PublicKey;
    oracleQueue: PublicKey;
    hold?: FeedAttestation & { signer: PublicKey };
  },
): BuiltTransaction {
  const out = budget(
    options,
    options.qty === 1 ? CU_LIMITS.buyPacks.x1 : CU_LIMITS.buyPacks.x10,
  );
  const attIx = out.length;
  if (options.hold)
    out.push(
      ed25519Instruction({
        publicKey: options.hold.signer,
        signature: options.hold.signature,
        message: holdMessage({
          programId,
          wallet: options.wallet,
          expiry: options.hold.expiry,
        }),
      }),
    );
  out.push(
    buyPacksInstruction(programId, {
      ...options,
      buyer: options.wallet,
      minLiveFlags: options.minLiveFlags ?? 0,
      hold: options.hold
        ? { expiry: options.hold.expiry, att_ix: attIx }
        : undefined,
    }),
  );
  return checked(options, out);
}
