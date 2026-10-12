import { Buffer } from "buffer";
import { BPS_DENOMINATOR, TX_LIMITS } from "@onepercent/config";
import { EXTERNAL_IDS } from "../constants.js";
import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const TOKEN_PROGRAM = EXTERNAL_IDS.splToken;
const TOKEN_2022_PROGRAM = EXTERNAL_IDS.token2022;
const ASSOCIATED_TOKEN_PROGRAM = EXTERNAL_IDS.associatedToken;
const U64_MAX = (1n << 64n) - 1n;

/** Mint information read at confirmed commitment by the caller. */
export interface MergeMint {
  address: PublicKey;
  decimals: number;
  tokenProgram: PublicKey;
}

/** Full balances, never the client-requested portion of a token account. */
export interface MergeSource {
  address: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  amount: bigint;
  closeAuthority?: PublicKey | null;
}

export interface MergeTransactionOptions {
  /** Defaults to the canonical compiled @onepercent/config exports. */
  config?: {
    BPS_DENOMINATOR: number;
    TX_LIMITS: { maxTxBytes: number; byteHeadroomBps: number };
  };
  /** Caller supplies measured/simulated settings, never guessed merge CU values. */
  computeBudget?: readonly TransactionInstruction[];
}

function defaultConfig(): NonNullable<MergeTransactionOptions["config"]> {
  const limits = TX_LIMITS;
  if (
    typeof BPS_DENOMINATOR !== "number" ||
    !limits ||
    typeof limits !== "object" ||
    !("maxTxBytes" in limits) ||
    typeof limits.maxTxBytes !== "number" ||
    !("byteHeadroomBps" in limits) ||
    typeof limits.byteHeadroomBps !== "number"
  )
    throw new Error("Merge transaction config unavailable");
  return {
    BPS_DENOMINATOR,
    TX_LIMITS: {
      maxTxBytes: limits.maxTxBytes,
      byteHeadroomBps: limits.byteHeadroomBps,
    },
  };
}

function transactionBudget(options: MergeTransactionOptions | undefined) {
  const { BPS_DENOMINATOR, TX_LIMITS } = options?.config ?? defaultConfig();
  if (!TX_LIMITS) throw new Error("Merge transaction config unavailable");
  if (
    !Number.isSafeInteger(BPS_DENOMINATOR) ||
    BPS_DENOMINATOR <= 0 ||
    !Number.isSafeInteger(TX_LIMITS.maxTxBytes) ||
    TX_LIMITS.maxTxBytes <= 0 ||
    TX_LIMITS.maxTxBytes > PACKET_DATA_SIZE ||
    !Number.isSafeInteger(TX_LIMITS.byteHeadroomBps) ||
    TX_LIMITS.byteHeadroomBps < 0 ||
    TX_LIMITS.byteHeadroomBps >= BPS_DENOMINATOR
  )
    throw new RangeError("Invalid merge transaction budget");
  const bytes = Number(
    (BigInt(TX_LIMITS.maxTxBytes) *
      BigInt(BPS_DENOMINATOR - TX_LIMITS.byteHeadroomBps)) /
      BigInt(BPS_DENOMINATOR),
  );
  const compute = [...(options?.computeBudget ?? [])];
  const seen = new Set<number>();
  for (const ix of compute) {
    const tag = ix.data[0];
    if (
      !ix.programId.equals(ComputeBudgetProgram.programId) ||
      ix.keys.length !== 0 ||
      !(
        (tag === 2 && ix.data.length === 5) ||
        (tag === 3 && ix.data.length === 9)
      ) ||
      seen.has(tag)
    )
      throw new Error("Invalid merge compute budget instructions");
    seen.add(tag);
  }
  // Size-only placeholders reserve both standard instructions even when the
  // caller sets them after simulation. They are never emitted into a result.
  const reserved = [...compute];
  if (!seen.has(2))
    reserved.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 0 }));
  if (!seen.has(3))
    reserved.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0n }),
    );
  return { bytes, compute, reserved };
}

function validate(
  wallet: PublicKey,
  mint: MergeMint,
  sources: readonly MergeSource[],
  canonicalAta: PublicKey,
): void {
  if (
    !mint.tokenProgram.equals(TOKEN_PROGRAM) &&
    !mint.tokenProgram.equals(TOKEN_2022_PROGRAM)
  )
    throw new Error("Unsupported token program");
  if (
    !Number.isInteger(mint.decimals) ||
    mint.decimals < 0 ||
    mint.decimals > 255
  )
    throw new RangeError("Invalid mint decimals");
  const [expectedAta] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), mint.tokenProgram.toBuffer(), mint.address.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  );
  if (!canonicalAta.equals(expectedAta))
    throw new Error("Destination is not the wallet's canonical ATA");
  const seen = new Set<string>();
  let total = 0n;
  for (const source of sources) {
    if (seen.has(source.address.toBase58()))
      throw new Error("Duplicate merge source");
    seen.add(source.address.toBase58());
    if (!source.owner.equals(wallet))
      throw new Error("Merge source is not owned by the wallet");
    if (!source.mint.equals(mint.address))
      throw new Error("Merge source has a different mint");
    if (!source.tokenProgram.equals(mint.tokenProgram))
      throw new Error("Merge source has a different token program");
    if (
      !source.address.equals(canonicalAta) &&
      source.closeAuthority &&
      !source.closeAuthority.equals(wallet)
    )
      throw new Error("Wallet cannot close the merge source");
    if (
      typeof source.amount !== "bigint" ||
      source.amount < 0n ||
      source.amount > U64_MAX
    )
      throw new RangeError("Merge source amount is outside u64");
    total += source.amount;
    if (total > U64_MAX) throw new RangeError("Merged amount is outside u64");
  }
}

// M1 exposes no equivalent merge builder with injectable packing and compute
// settings. Keep S2's wire encoding and instruction order checked by its vectors.
function instructions(
  wallet: PublicKey,
  mint: MergeMint,
  sources: readonly MergeSource[],
  canonicalAta: PublicKey,
): TransactionInstruction[] {
  const readonly = (pubkey: PublicKey) => ({
    pubkey,
    isSigner: false,
    isWritable: false,
  });
  const writable = (pubkey: PublicKey) => ({
    ...readonly(pubkey),
    isWritable: true,
  });
  const signer = { ...readonly(wallet), isSigner: true };
  const create = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { ...writable(wallet), isSigner: true },
      writable(canonicalAta),
      readonly(wallet),
      readonly(mint.address),
      readonly(SystemProgram.programId),
      readonly(mint.tokenProgram),
    ],
    data: Buffer.from([1]),
  });
  const transfers = sources.map((source) => {
    const data = Buffer.alloc(10);
    data[0] = 12;
    data.writeBigUInt64LE(source.amount, 1);
    data[9] = mint.decimals;
    return new TransactionInstruction({
      programId: mint.tokenProgram,
      keys: [
        writable(source.address),
        readonly(mint.address),
        writable(canonicalAta),
        signer,
      ],
      data,
    });
  });
  const closes = sources.map(
    (source) =>
      new TransactionInstruction({
        programId: mint.tokenProgram,
        keys: [writable(source.address), writable(wallet), signer],
        data: Buffer.from([9]),
      }),
  );
  return [create, ...transfers, ...closes];
}

function wireSize(wallet: PublicKey, ixs: TransactionInstruction[]): number {
  const tx = new Transaction({
    feePayer: wallet,
    recentBlockhash: PublicKey.default.toBase58(),
  }).add(...ixs);
  // A merge has exactly one signer, so its shortvec signature count is one byte.
  return 1 + 64 + tx.serializeMessage().length;
}

/**
 * Pure, unsigned wallet transactions that consolidate the whole bag.
 * The caller reads token accounts first, sets a fresh blockhash on each result,
 * asks the wallet to sign, and confirms every merge before submitting Feed.
 * The default reads M1's compiled config and refuses missing values. Packing
 * preserves its byte headroom, including both compute-budget instructions.
 * Each transaction creates the ATA idempotently and keeps transfers and closes
 * atomic. No transaction is emitted when only the canonical ATA is present.
 */
export function buildMergeTransactions(
  wallet: PublicKey,
  mint: MergeMint,
  sources: readonly MergeSource[],
  canonicalAta: PublicKey,
  options?: MergeTransactionOptions,
): Transaction[] {
  const budget = transactionBudget(options);
  validate(wallet, mint, sources, canonicalAta);
  const others = sources.filter(
    (source) => !source.address.equals(canonicalAta),
  );
  const result: Transaction[] = [];
  let batch: MergeSource[] = [];
  const emit = () => {
    if (!batch.length) return;
    const mergeInstructions = instructions(wallet, mint, batch, canonicalAta);
    if (
      wireSize(wallet, [...budget.reserved, ...mergeInstructions]) >
      budget.bytes
    )
      throw new RangeError("Merge exceeds the transaction byte limit");
    result.push(
      new Transaction({ feePayer: wallet }).add(
        ...budget.compute,
        ...mergeInstructions,
      ),
    );
  };
  for (const source of others) {
    const candidate = [...batch, source];
    if (
      wireSize(wallet, [
        ...budget.reserved,
        ...instructions(wallet, mint, candidate, canonicalAta),
      ]) > budget.bytes
    ) {
      if (!batch.length)
        throw new RangeError("Merge exceeds the transaction byte limit");
      emit();
      batch = [source];
    } else batch = candidate;
  }
  emit();
  return result;
}
