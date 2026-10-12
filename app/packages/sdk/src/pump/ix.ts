import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { u32, u64 } from "../bytes.js";
import {
  MAYHEM_PROGRAM_ID,
  PUMP_AMM_GLOBAL,
  PUMP_AMM_PROGRAM_ID,
  PUMP_DISCRIMINATORS,
  PUMP_GLOBAL,
  PUMP_METADATA_LIMITS,
  PUMP_PROGRAM_ID,
} from "./ids.js";
import {
  ammCreatorVaultAuthority,
  associatedBondingCurve,
  bondingCurve,
  creatorVault,
  curveFeeConfig,
  globalParams,
  mayhemState,
  mayhemTokenVault,
  mintAuthority,
  pumpAta,
  pumpEventAuthority,
  solVault,
  userVolumeAccumulator,
  wsolAta,
} from "./pdas.js";

const ro = (pubkey: PublicKey): AccountMeta => ({
  pubkey,
  isSigner: false,
  isWritable: false,
});
const rw = (pubkey: PublicKey): AccountMeta => ({
  ...ro(pubkey),
  isWritable: true,
});
const signer = (pubkey: PublicKey): AccountMeta => ({
  ...rw(pubkey),
  isSigner: true,
});
const text = (value: string) => {
  const bytes = Buffer.from(value);
  return Buffer.concat([u32(bytes.length), bytes]);
};
const ix = (
  programId: PublicKey,
  discriminator: string,
  keys: AccountMeta[],
  data = Buffer.alloc(0),
) =>
  new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([Buffer.from(discriminator, "hex"), data]),
  });
export interface PumpMetadata {
  name: string;
  symbol: string;
  uri: string;
}
export function validatePumpMetadata(input: PumpMetadata): void {
  for (const [name, limit] of Object.entries(PUMP_METADATA_LIMITS)) {
    const value = input[name as keyof PumpMetadata];
    if (!value.length || Buffer.byteLength(value, "utf8") > limit)
      throw new RangeError(`Invalid pump ${name} length`);
  }
  const uri = new URL(input.uri);
  if (uri.protocol !== "https:" || uri.username || uri.password)
    throw new Error("Metadata URI must use HTTPS without credentials");
}
export function createV2Ix(
  input: PumpMetadata & {
    mint: PublicKey;
    wallet: PublicKey;
    creator: PublicKey;
    creatorFeeBps: bigint;
  },
): TransactionInstruction {
  validatePumpMetadata(input);
  return ix(
    PUMP_PROGRAM_ID,
    PUMP_DISCRIMINATORS.createV2,
    [
      signer(input.mint),
      ro(mintAuthority()),
      rw(bondingCurve(input.mint)),
      rw(associatedBondingCurve(input.mint)),
      ro(PUMP_GLOBAL),
      signer(input.wallet),
      ro(SystemProgram.programId),
      ro(TOKEN_2022_PROGRAM_ID),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      rw(MAYHEM_PROGRAM_ID),
      ro(globalParams()),
      rw(solVault()),
      rw(mayhemState(input.mint)),
      rw(mayhemTokenVault(input.mint)),
      ro(pumpEventAuthority()),
      ro(PUMP_PROGRAM_ID),
    ],
    Buffer.concat([
      text(input.name),
      text(input.symbol),
      text(input.uri),
      input.creator.toBuffer(),
      Buffer.alloc(2),
      u64(input.creatorFeeBps),
      Buffer.alloc(1),
    ]),
  );
}
export function buyV3Ix(input: {
  mint: PublicKey;
  wallet: PublicKey;
  amount: bigint;
  maxSolCost: bigint;
  buybackFeeRecipient: PublicKey;
}): TransactionInstruction {
  if (input.amount <= 0n || input.maxSolCost <= 0n)
    throw new RangeError("Buy amount and cost must be positive");
  const curve = bondingCurve(input.mint);
  return ix(
    PUMP_PROGRAM_ID,
    PUMP_DISCRIMINATORS.buyV3,
    [
      ro(PUMP_GLOBAL),
      ro(input.mint),
      ro(NATIVE_MINT),
      ro(TOKEN_2022_PROGRAM_ID),
      ro(TOKEN_PROGRAM_ID),
      rw(curve),
      rw(associatedBondingCurve(input.mint)),
      rw(wsolAta(curve)),
      signer(input.wallet),
      rw(pumpAta(input.wallet, input.mint)),
      rw(wsolAta(input.wallet)),
      rw(userVolumeAccumulator(input.wallet)),
      ro(curveFeeConfig()),
      rw(input.buybackFeeRecipient),
      ro(SystemProgram.programId),
      ro(pumpEventAuthority()),
      ro(PUMP_PROGRAM_ID),
    ],
    Buffer.concat([u64(input.amount), u64(input.maxSolCost)]),
  );
}
export function curveCollectStepIx(input: {
  payer: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
}): TransactionInstruction {
  const curve = bondingCurve(input.mint),
    vault = creatorVault(input.creator);
  return ix(PUMP_PROGRAM_ID, PUMP_DISCRIMINATORS.curveCollectStep, [
    signer(input.payer),
    ro(PUMP_GLOBAL),
    ro(input.mint),
    ro(NATIVE_MINT),
    ro(TOKEN_PROGRAM_ID),
    ro(ASSOCIATED_TOKEN_PROGRAM_ID),
    ro(SystemProgram.programId),
    rw(curve),
    rw(wsolAta(curve)),
    rw(vault),
    rw(wsolAta(vault)),
    ro(pumpEventAuthority()),
    ro(PUMP_PROGRAM_ID),
  ]);
}
export function collectCreatorFeeV2Ix(input: {
  creator: PublicKey;
}): TransactionInstruction {
  const vault = creatorVault(input.creator);
  return ix(PUMP_PROGRAM_ID, PUMP_DISCRIMINATORS.collectCreatorFeeV2, [
    rw(input.creator),
    rw(wsolAta(input.creator)),
    rw(vault),
    rw(wsolAta(vault)),
    ro(NATIVE_MINT),
    ro(TOKEN_PROGRAM_ID),
    ro(ASSOCIATED_TOKEN_PROGRAM_ID),
    ro(SystemProgram.programId),
    ro(pumpEventAuthority()),
    ro(PUMP_PROGRAM_ID),
  ]);
}
export function poolCollectStepIx(input: {
  payer: PublicKey;
  pool: PublicKey;
  creator: PublicKey;
  poolQuoteTokenAccount: PublicKey;
}): TransactionInstruction {
  const vault = ammCreatorVaultAuthority(input.creator);
  return ix(PUMP_AMM_PROGRAM_ID, PUMP_DISCRIMINATORS.poolCollectStep, [
    signer(input.payer),
    ro(PUMP_AMM_GLOBAL),
    rw(input.pool),
    ro(NATIVE_MINT),
    ro(TOKEN_PROGRAM_ID),
    rw(input.poolQuoteTokenAccount),
    ro(vault),
    rw(wsolAta(vault)),
    ro(SystemProgram.programId),
    ro(ASSOCIATED_TOKEN_PROGRAM_ID),
    ro(pumpEventAuthority(PUMP_AMM_PROGRAM_ID)),
    ro(PUMP_AMM_PROGRAM_ID),
  ]);
}
export function transferCreatorFeesToPumpIx(input: {
  creator: PublicKey;
}): TransactionInstruction {
  const vault = ammCreatorVaultAuthority(input.creator);
  return ix(
    PUMP_AMM_PROGRAM_ID,
    PUMP_DISCRIMINATORS.transferCreatorFeesToPump,
    [
      ro(NATIVE_MINT),
      ro(TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(input.creator),
      rw(vault),
      rw(wsolAta(vault)),
      rw(creatorVault(input.creator)),
      ro(pumpEventAuthority(PUMP_AMM_PROGRAM_ID)),
      ro(PUMP_AMM_PROGRAM_ID),
    ],
  );
}
export function collectCoinCreatorFeeIx(input: {
  creator: PublicKey;
}): TransactionInstruction {
  const vault = ammCreatorVaultAuthority(input.creator);
  return ix(PUMP_AMM_PROGRAM_ID, PUMP_DISCRIMINATORS.collectCoinCreatorFee, [
    ro(NATIVE_MINT),
    ro(TOKEN_PROGRAM_ID),
    ro(input.creator),
    ro(vault),
    rw(wsolAta(vault)),
    rw(wsolAta(input.creator)),
    ro(pumpEventAuthority(PUMP_AMM_PROGRAM_ID)),
    ro(PUMP_AMM_PROGRAM_ID),
  ]);
}
