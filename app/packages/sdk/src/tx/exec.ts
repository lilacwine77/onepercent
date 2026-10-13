import { CU_LIMITS, TX_LIMITS } from "@onepercent/config";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  AddressLookupTableAccount,
  TransactionInstruction,
} from "@solana/web3.js";
import { discriminator, U64_MAX } from "../bytes.js";
import { EXEC_KIND, EXTERNAL_IDS } from "../constants.js";
import { userAta, vaultAta, vaultAuthPda } from "../pda.js";
import { serializedSize } from "./index.js";
import type { ClusterDeployment } from "../deployment.js";

const MAX_COMPUTE_UNITS = 1_400_000;

export interface ComposeExecInput {
  deployment: ClusterDeployment;
  payer: PublicKey;
  beginIx: TransactionInstruction;
  swap: {
    setup: readonly TransactionInstruction[];
    swap: TransactionInstruction | readonly TransactionInstruction[];
    cleanup: readonly TransactionInstruction[];
    lookupTables: readonly AddressLookupTableAccount[];
  };
  endIx: TransactionInstruction;
  computeBudget: readonly TransactionInstruction[];
  extraIxs?: readonly TransactionInstruction[];
  /**
   * Restore a closed canonical token vault for Done Burn. Requires an explicit
   * compute unit limit; the measured restoration allowance is added once.
   */
  restoreTokenVault?: boolean;
  protocolLut: AddressLookupTableAccount;
  blockhash: string;
}
/** Build the atomic v0 pair; the caller signs and sends the returned transaction. */
export function composeExecTransaction(input: ComposeExecInput): {
  transaction: VersionedTransaction;
  serializedSize: number;
} {
  const { beginIx, endIx } = input;
  const { programId } = input.deployment;
  if (
    !beginIx.programId.equals(programId) ||
    !endIx.programId.equals(programId) ||
    beginIx.data.length !== 18 ||
    endIx.data.length !== 9 ||
    !beginIx.data
      .subarray(0, 8)
      .equals(discriminator("global", "exec_begin")) ||
    !endIx.data.subarray(0, 8).equals(discriminator("global", "exec_end")) ||
    beginIx.data[8] !== endIx.data[8]
  )
    throw new Error("ExecPairing");
  const kind = beginIx.data[8]!;
  if (
    kind < EXEC_KIND.stockBuy ||
    kind > EXEC_KIND.jackpotBuy ||
    beginIx.keys.length !== 16 ||
    endIx.keys.length !== 11
  )
    throw new Error("ExecPairing");
  // Both instructions must operate on the same signer, machine, mint and vault.
  for (const [beginIndex, endIndex] of [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
    [8, 7],
    [13, 8],
    [14, 9],
  ] as const)
    if (!beginIx.keys[beginIndex]!.pubkey.equals(endIx.keys[endIndex]!.pubkey))
      throw new Error("AccountMismatch");
  const signer = beginIx.keys[0]!.pubkey;
  if (!beginIx.keys[0]!.isSigner || !endIx.keys[0]!.isSigner)
    throw new Error("Unauthorized");
  const sell = kind === EXEC_KIND.stockSell;
  if (
    beginIx.keys[8]!.isWritable !== sell ||
    endIx.keys[7]!.isWritable !== sell
  )
    throw new Error("Invalid sol_dest writability");
  const sourceMint = sell ? beginIx.keys[3]!.pubkey : NATIVE_MINT;
  const sourceProgram = sell ? beginIx.keys[13]!.pubkey : EXTERNAL_IDS.splToken;
  if (
    !beginIx.keys[7]!.pubkey.equals(userAta(signer, sourceMint, sourceProgram))
  )
    throw new Error("AccountMismatch");
  const prep = [
    createAssociatedTokenAccountIdempotentInstruction(
      input.payer,
      beginIx.keys[7]!.pubkey,
      signer,
      sourceMint,
      sourceProgram,
    ),
  ];
  if (sell)
    prep.push(
      createAssociatedTokenAccountIdempotentInstruction(
        input.payer,
        vaultAta(programId, NATIVE_MINT, EXTERNAL_IDS.splToken),
        vaultAuthPda(programId)[0],
        NATIVE_MINT,
        EXTERNAL_IDS.splToken,
      ),
    );
  // A completed season may have closed its empty token vault. Any Burn caller can restore it.
  if (input.restoreTokenVault) {
    if (kind !== EXEC_KIND.burn)
      throw new Error("Token vault restoration requires Burn");
    if (
      !beginIx.keys[5]!.pubkey.equals(
        vaultAta(programId, beginIx.keys[3]!.pubkey, beginIx.keys[13]!.pubkey),
      )
    )
      throw new Error("AccountMismatch");
    prep.push(
      createAssociatedTokenAccountIdempotentInstruction(
        input.payer,
        beginIx.keys[5]!.pubkey,
        vaultAuthPda(programId)[0],
        beginIx.keys[3]!.pubkey,
        beginIx.keys[13]!.pubkey,
      ),
    );
  }
  const swap = Array.isArray(input.swap.swap)
    ? input.swap.swap
    : [input.swap.swap];
  const external = [
    ...(input.extraIxs ?? []),
    ...input.swap.setup,
    ...swap,
    ...input.swap.cleanup,
  ];
  if (external.some((ix) => ix.programId.equals(programId)))
    throw new Error("ExecPairing");
  if (
    external.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId))
  )
    throw new Error("Compute budget must precede the exec pair");
  const seen = new Set<number>();
  for (const ix of input.computeBudget) {
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
      throw new Error("Invalid exec compute budget");
    seen.add(tag);
  }
  if (input.restoreTokenVault && !seen.has(2))
    throw new Error("Token vault restoration requires a compute unit limit");
  const computeBudget = input.restoreTokenVault
    ? input.computeBudget.map((ix) =>
        ix.data[0] === 2
          ? ComputeBudgetProgram.setComputeUnitLimit({
              units: Math.min(
                ix.data.readUInt32LE(1) + CU_LIMITS.restoreBurnVault,
                MAX_COMPUTE_UNITS,
              ),
            })
          : ix,
      )
    : input.computeBudget;
  if (
    input.protocolLut.state.authority !== undefined ||
    input.protocolLut.state.deactivationSlot !== U64_MAX
  )
    throw new Error("Protocol lookup table must be active and frozen");
  const tables = [input.protocolLut, ...input.swap.lookupTables];
  const unique = new Map<string, AddressLookupTableAccount>();
  for (const table of tables) {
    const existing = unique.get(table.key.toBase58());
    if (
      existing &&
      (existing.state.addresses.length !== table.state.addresses.length ||
        existing.state.addresses.some(
          (key, index) => !key.equals(table.state.addresses[index]!),
        ))
    )
      throw new Error("Conflicting lookup table contents");
    unique.set(table.key.toBase58(), table);
  }
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: input.payer,
      recentBlockhash: input.blockhash,
      instructions: [
        ...computeBudget,
        ...(input.extraIxs ?? []),
        ...prep,
        beginIx,
        ...input.swap.setup,
        ...swap,
        ...input.swap.cleanup,
        endIx,
      ],
    }).compileToV0Message([...unique.values()]),
  );
  const size = serializedSize(transaction);
  if (size > TX_LIMITS.maxTxBytes)
    throw new RangeError(
      `Transaction exceeds ${TX_LIMITS.maxTxBytes}-byte budget`,
    );
  return { transaction, serializedSize: size };
}
