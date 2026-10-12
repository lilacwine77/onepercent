import { Buffer } from "buffer";
import { TOKEN_1PCT, TX_LIMITS } from "@onepercent/config";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { U64_MAX } from "../bytes.js";
import type { ClusterDeployment } from "../deployment.js";
import { powerOnIx } from "../ix/powerOn.js";
import { dbcPool, dbcSwap2Ix, initializeDbcPoolIx } from "../meteora/index.js";
import { serializedSize } from "./index.js";

export interface LaunchIdentity {
  wallet: PublicKey;
  mint: PublicKey;
  deployment: ClusterDeployment;
}
export function launchAddresses(input: LaunchIdentity) {
  const programId = input.deployment.programId;
  const dbcConfig = new PublicKey(input.deployment.meteora.dbcConfig);
  const pda = (seed: string, ...keys: Uint8Array[]) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(seed), ...keys],
      programId,
    )[0];
  const vaultAuth = pda("vault_auth");
  return {
    programId,
    wallet: input.wallet,
    mint: input.mint,
    config: pda("config"),
    machine: pda("machine"),
    feeIn: pda("fee_in"),
    ledger: pda("ledger", input.mint.toBytes()),
    vaultAuth,
    vault: getAssociatedTokenAddressSync(input.mint, vaultAuth, true),
    launchAta: getAssociatedTokenAddressSync(input.mint, input.wallet, true),
    launchQuoteAta: getAssociatedTokenAddressSync(
      NATIVE_MINT,
      input.wallet,
      true,
    ),
    dbcConfig,
    launchPool: dbcPool(dbcConfig, input.mint),
  };
}
export interface LaunchTip {
  recipient: PublicKey;
  lamports: bigint;
}
export interface LaunchTransactionOptions extends LaunchIdentity {
  name: string;
  symbol: string;
  uri: string;
  blockhash: string;
  maxSolCost: bigint;
  lookupTable?: AddressLookupTableAccount;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: bigint;
  tip: LaunchTip;
}
function validateOptions(input: LaunchTransactionOptions): void {
  if (input.wallet.equals(input.mint))
    throw new Error("The mint and launch wallet must be distinct signers");
  if (
    !Number.isInteger(input.computeUnitLimit) ||
    input.computeUnitLimit <= 0 ||
    input.computeUnitLimit > 0xffffffff
  )
    throw new RangeError("Invalid launch compute unit limit");
  for (const value of [
    input.computeUnitPriceMicroLamports,
    input.tip.lamports,
    input.maxSolCost,
  ])
    if (value < 0n || value > U64_MAX)
      throw new RangeError("Invalid launch fee amount");
}
const budget = (input: LaunchTransactionOptions) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnitLimit }),
  ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: input.computeUnitPriceMicroLamports,
  }),
];
const tipInstruction = (wallet: PublicKey, tip: LaunchTip) =>
  SystemProgram.transfer({
    fromPubkey: wallet,
    toPubkey: tip.recipient,
    lamports: tip.lamports,
  });
export function launchInstructionGroups(input: LaunchTransactionOptions) {
  validateOptions(input);
  const a = launchAddresses(input);
  const createAndBuy = [
    initializeDbcPoolIx({
      config: a.dbcConfig,
      mint: input.mint,
      payer: input.wallet,
      creator: input.wallet,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
    }),
    createAssociatedTokenAccountIdempotentInstruction(
      input.wallet,
      a.launchAta,
      input.wallet,
      input.mint,
      TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      input.wallet,
      a.launchQuoteAta,
      input.wallet,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
    ),
    SystemProgram.transfer({
      fromPubkey: input.wallet,
      toPubkey: a.launchQuoteAta,
      lamports: input.maxSolCost,
    }),
    createSyncNativeInstruction(a.launchQuoteAta, TOKEN_PROGRAM_ID),
    dbcSwap2Ix({
      config: a.dbcConfig,
      mint: input.mint,
      user: input.wallet,
      amountOut: TOKEN_1PCT.devBuyAmount,
      maxQuoteIn: input.maxSolCost,
    }),
    createCloseAccountInstruction(
      a.launchQuoteAta,
      input.wallet,
      input.wallet,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];
  const depositAndPowerOn = [
    createAssociatedTokenAccountIdempotentInstruction(
      input.wallet,
      a.vault,
      a.vaultAuth,
      input.mint,
      TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      a.launchAta,
      input.mint,
      a.vault,
      input.wallet,
      TOKEN_1PCT.devBuyAmount,
      TOKEN_1PCT.decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
    powerOnIx(input.deployment, {
      launchWallet: input.wallet,
      mint: input.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
    createCloseAccountInstruction(
      a.launchAta,
      input.wallet,
      input.wallet,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];
  return { createAndBuy, depositAndPowerOn };
}
export function launchLookupAddresses(
  input: LaunchTransactionOptions,
): PublicKey[] {
  const groups = launchInstructionGroups(input);
  const instructions = [
    ...budget(input),
    ...groups.createAndBuy,
    ...groups.depositAndPowerOn,
    ...(input.deployment.cluster === "devnet" && input.tip.lamports === 0n
      ? []
      : [tipInstruction(input.wallet, input.tip)]),
  ];
  const excluded = new Set(
    [
      input.wallet,
      input.mint,
      input.tip.recipient,
      ...instructions.map((ix) => ix.programId),
    ].map((key) => key.toBase58()),
  );
  const addresses = new Map<string, PublicKey>();
  for (const instruction of instructions)
    for (const meta of instruction.keys)
      if (!meta.isSigner && !excluded.has(meta.pubkey.toBase58()))
        addresses.set(meta.pubkey.toBase58(), meta.pubkey);
  return [...addresses.values()];
}
export function validateLaunchLookupTable(
  table: AddressLookupTableAccount,
  expected: readonly PublicKey[],
  currentSlot?: number,
): void {
  if (
    table.state.authority !== undefined ||
    table.state.deactivationSlot !== U64_MAX
  )
    throw new Error("Launch lookup table must be active and frozen");
  if (currentSlot !== undefined && currentSlot <= table.state.lastExtendedSlot)
    throw new Error(
      "Launch lookup table needs one completed slot after extension",
    );
  const actual = new Set(
    table.state.addresses.map((address) => address.toBase58()),
  );
  if (
    actual.size !== table.state.addresses.length ||
    actual.size !== expected.length ||
    expected.some((address) => !actual.has(address.toBase58()))
  )
    throw new Error(
      "Launch lookup table does not contain exactly the expected addresses",
    );
}
function compile(
  input: LaunchTransactionOptions,
  instructions: TransactionInstruction[],
): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: input.wallet,
      recentBlockhash: input.blockhash,
      instructions,
    }).compileToV0Message(input.lookupTable ? [input.lookupTable] : []),
  );
}
export function buildLaunchCandidates(input: LaunchTransactionOptions) {
  const groups = launchInstructionGroups(input);
  if (input.lookupTable)
    validateLaunchLookupTable(input.lookupTable, launchLookupAddresses(input));
  const single = compile(input, [
    ...budget(input),
    ...groups.createAndBuy,
    ...groups.depositAndPowerOn,
    ...(input.deployment.cluster === "devnet" && input.tip.lamports === 0n
      ? []
      : [tipInstruction(input.wallet, input.tip)]),
  ]);
  const singleSize = serializedSize(single);
  return {
    single,
    singleSize,
    singleFits: singleSize <= TX_LIMITS.maxTxBytes,
    addresses: launchAddresses(input),
  };
}
export function buildLaunchTransaction(
  input: LaunchTransactionOptions,
): VersionedTransaction {
  const result = buildLaunchCandidates(input);
  if (!result.singleFits)
    throw new RangeError(
      `Launch transaction exceeds ${TX_LIMITS.maxTxBytes} bytes`,
    );
  return result.single;
}
