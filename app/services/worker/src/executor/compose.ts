import { BURN, JACKPOT, TOKEN_1PCT, WSOL_MINT } from "@onepercent/config";
import {
  execBeginIx,
  execEndIx,
  EXTERNAL_IDS,
  type ClusterDeployment,
  userAta,
  vaultAta,
} from "@onepercent/sdk";
import { minOutMeteoraBuy, type ExecReadings } from "@onepercent/sdk/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  DONT_FRONT,
  SENDER_TIP_ACCOUNT,
  senderTip,
  type TxInstructionPlan,
} from "@onepercent/service-kit";
import type { ExecutorPlan } from "./policy.js";
import type { P1ExecutorPort } from "./p1.js";

export interface ExecutorSwap {
  minOut: bigint;
  outAmount: bigint;
  setup: TransactionInstruction[];
  swap: TransactionInstruction;
  cleanup: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}
export function assertSwapMode(
  cluster: string,
  mode: string,
): asserts mode is "stub" | "jupiter" {
  if (!["stub", "jupiter"].includes(mode))
    throw new Error("executor_swap_invalid");
  if (mode === "stub" && cluster !== "localnet" && cluster !== "devnet")
    throw new Error("executor_stub_forbidden");
}
export function createWsolAta(signer: PublicKey): TransactionInstruction {
  const mint = new PublicKey(WSOL_MINT);
  return new TransactionInstruction({
    programId: EXTERNAL_IDS.associatedToken,
    data: Buffer.from([1]),
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      {
        pubkey: userAta(signer, mint, EXTERNAL_IDS.splToken),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: signer, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: EXTERNAL_IDS.splToken, isSigner: false, isWritable: false },
    ],
  });
}
/** Unwrap only previously reconciled outside credits, atomically with the pair. */
export function closeWsolAta(signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: EXTERNAL_IDS.splToken,
    data: Buffer.from([9]),
    keys: [
      {
        pubkey: userAta(
          signer,
          new PublicKey(WSOL_MINT),
          EXTERNAL_IDS.splToken,
        ),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: signer, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
    ],
  });
}
/** Test tokens are supplied by the rehearsal, never by a user wallet. */
export function stubSwap(
  deployment: ClusterDeployment,
  signer: PublicKey,
  mint: PublicKey,
  expected: bigint,
  amount: bigint,
  quoteSink: PublicKey,
): ExecutorSwap {
  assertSwapMode(deployment.cluster, "stub");
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(expected, 1);
  data[9] = TOKEN_1PCT.decimals;
  const swap = new TransactionInstruction({
    programId: EXTERNAL_IDS.splToken,
    data,
    keys: [
      {
        pubkey: userAta(signer, mint, EXTERNAL_IDS.splToken),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: mint, isSigner: false, isWritable: false },
      {
        pubkey: vaultAta(deployment.programId, mint, EXTERNAL_IDS.splToken),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: signer, isSigner: true, isWritable: false },
    ],
  });
  const quote = Buffer.alloc(10);
  quote[0] = 12;
  quote.writeBigUInt64LE(amount, 1);
  quote[9] = 9;
  const consumeInput = new TransactionInstruction({
    programId: EXTERNAL_IDS.splToken,
    data: quote,
    keys: [
      {
        pubkey: userAta(
          signer,
          new PublicKey(WSOL_MINT),
          EXTERNAL_IDS.splToken,
        ),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: new PublicKey(WSOL_MINT), isSigner: false, isWritable: false },
      { pubkey: quoteSink, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
    ],
  });
  return {
    minOut: expected,
    outAmount: expected,
    setup: [consumeInput],
    swap,
    cleanup: [],
    lookupTables: [],
  };
}
export function checkPlan(
  p1: P1ExecutorPort,
  plan: ExecutorPlan,
  signer: PublicKey,
  instructions?: ExecReadings["execution"]["instructions"],
) {
  const args = execArgs(plan, signer);
  const programId = plan.snapshot.deployment.programId;
  const execution = instructions ?? [
    execBeginIx(programId, args),
    execEndIx(programId, args),
  ];
  const currentIndex = execution.findIndex((ix) =>
    ix.programId.equals(programId),
  );
  const result = p1.checkExecBegin(
    {
      machine: plan.snapshot.machine,
      config: plan.snapshot.config,
      deployment: plan.snapshot.deployment,
    },
    args,
    {
      ...plan.reference.readings,
      execution: { stackHeight: 1, currentIndex, instructions: execution },
    },
    plan.snapshot.now,
  );
  if (!result.ok) throw new Error(`executor_refused:${result.error}`);
  if (result.minOut <= 0n) throw new Error("executor_min_out_invalid");
  const { expected } = minOutMeteoraBuy({
    amount: plan.amount,
    sqrtPrice: plan.reference.sqrtPrice,
    slipBps: executorSlippage(plan.kind),
  });
  return { ...result, expected };
}
function execArgs(plan: ExecutorPlan, signer: PublicKey) {
  return {
    signer,
    kind: plan.code,
    bucket: 255,
    amount: plan.amount,
    mint: plan.snapshot.config.token_mint,
    tokenProgram: EXTERNAL_IDS.splToken,
    oracles: plan.reference.oracles,
  };
}

export function composeExecutor(input: {
  plan: ExecutorPlan;
  p1: P1ExecutorPort;
  signer: PublicKey;
  swap: ExecutorSwap;
  protocolLut: AddressLookupTableAccount;
  blockhash: string;
  tipLamports: bigint | null;
  computeUnitLimit: number;
}): TxInstructionPlan {
  const { plan, signer, swap } = input;
  const checked = checkPlan(input.p1, plan, signer);
  if (swap.minOut < checked.minOut || swap.outAmount < swap.minOut)
    throw new Error("executor_quote_below_min_out");
  if (input.protocolLut.state.authority)
    throw new Error("executor_lut_not_frozen");
  if (!input.protocolLut.isActive())
    throw new Error("executor_lut_deactivated");
  const mint = plan.snapshot.config.token_mint;
  const deployment = plan.snapshot.deployment;
  const beginIx = execBeginIx(deployment.programId, {
    signer,
    kind: plan.code,
    bucket: 255,
    amount: plan.amount,
    mint,
    tokenProgram: EXTERNAL_IDS.splToken,
    oracles: plan.reference.oracles,
  });
  const endIx = execEndIx(deployment.programId, {
    signer,
    kind: plan.code,
    mint,
    tokenProgram: EXTERNAL_IDS.splToken,
  });
  if (deployment.cluster === "devnet" && input.tipLamports !== 0n)
    throw new Error("executor_devnet_tip_forbidden");
  const prefix = [
    ...(deployment.cluster === "devnet"
      ? []
      : [senderTip(signer, input.tipLamports)]),
    // A native ATA can be closed with a nonzero balance. Create first so an
    // absent ATA is safe too; P1 recreates it immediately before exec_begin.
    // All three instructions roll back if any part of the trade fails.
    createWsolAta(signer),
    closeWsolAta(signer),
  ];
  const result = input.p1.composeExecTransaction({
    deployment,
    payer: signer,
    beginIx,
    swap,
    endIx,
    computeBudget: [],
    extraIxs: prefix,
    protocolLut: input.protocolLut,
    blockhash: input.blockhash,
  });
  if (
    result.serializedSize !== result.transaction.serialize().length ||
    result.serializedSize > 1232
  )
    throw new Error("executor_transaction_size");
  const tables = [input.protocolLut, ...swap.lookupTables];
  // Compare whole compiled messages, including key bindings and order. Solana
  // promotes account privileges across instructions, so raw meta comparison is
  // not sufficient after decompiling.
  const expected = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: input.blockhash,
    instructions: [
      ...prefix,
      createWsolAta(signer),
      beginIx,
      ...swap.setup,
      swap.swap,
      ...swap.cleanup,
      endIx,
    ],
  }).compileToV0Message(tables);
  if (
    !Buffer.from(expected.serialize()).equals(
      Buffer.from(result.transaction.message.serialize()),
    )
  )
    throw new Error("executor_composition_invalid");
  if (
    result.transaction.message.header.numRequiredSignatures !== 1 ||
    !result.transaction.message.staticAccountKeys[0]?.equals(signer)
  )
    throw new Error("executor_signer_invalid");
  // Sender tips must use a static key, never an address loaded from a LUT.
  // https://docs.jito.wtf/lowlatencytxnsend/#tips
  if (
    deployment.cluster !== "devnet" &&
    !result.transaction.message.staticAccountKeys.some((key) =>
      key.equals(SENDER_TIP_ACCOUNT),
    )
  )
    throw new Error("executor_tip_lookup_forbidden");
  const message = TransactionMessage.decompile(result.transaction.message, {
    addressLookupTableAccounts: tables,
  });
  if (
    message.instructions.some((ix) =>
      ix.keys.some(
        (meta) =>
          meta.pubkey.equals(DONT_FRONT) && (meta.isSigner || meta.isWritable),
      ),
    )
  )
    throw new Error("executor_protection_invalid");
  const own = message.instructions.filter((ix) =>
    ix.programId.equals(deployment.programId),
  );
  if (
    own.length !== 2 ||
    !own[0]!.data.equals(beginIx.data) ||
    !own[1]!.data.equals(endIx.data) ||
    message.instructions.some((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    )
  )
    throw new Error("executor_pairing_invalid");
  checkPlan(input.p1, plan, signer, message.instructions);
  return {
    instructions: message.instructions,
    lookupTables: tables,
    computeUnitLimit: input.computeUnitLimit,
  };
}
export const executorSlippage = (kind: ExecutorPlan["kind"]) =>
  kind === "burn" ? BURN.minOutSlipBps : JACKPOT.minOutSlipBps;
