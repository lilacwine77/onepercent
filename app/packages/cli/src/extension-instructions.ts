import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { OpsError } from "./input.js";
import { decodeDraftInstruction, pda } from "./m1-adapter.js";

export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const TOKEN_PROGRAMS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
] as const;

/** The only external instruction allowed in an extension is a vault ATA create. */
export function decodeExtensionInstruction(
  instruction: TransactionInstruction,
  programId: PublicKey,
): ReturnType<typeof decodeDraftInstruction> {
  if (instruction.programId.equals(programId))
    return decodeDraftInstruction(instruction);
  if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM))
    throw new OpsError("extension_program_forbidden");
  if (!instruction.data.equals(Buffer.from([1])))
    throw new OpsError("extension_ata_instruction_forbidden");
  const keys = instruction.keys;
  if (
    keys.length !== 6 ||
    keys.some(
      (key, index) =>
        key.isSigner !== (index === 0) || key.isWritable !== index < 2,
    )
  )
    throw new OpsError("extension_ata_accounts_mismatch");
  const [payer, account, owner, mint, systemProgram, tokenProgram] = keys;
  if (
    !owner!.pubkey.equals(pda("vault_auth", programId)) ||
    !systemProgram!.pubkey.equals(SystemProgram.programId) ||
    !TOKEN_PROGRAMS.some((allowed) => allowed.equals(tokenProgram!.pubkey))
  )
    throw new OpsError("extension_ata_accounts_mismatch");
  const [canonical] = PublicKey.findProgramAddressSync(
    [
      owner!.pubkey.toBuffer(),
      tokenProgram!.pubkey.toBuffer(),
      mint!.pubkey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM,
  );
  if (!account!.pubkey.equals(canonical))
    throw new OpsError("extension_ata_noncanonical");
  return {
    instruction: "create_idempotent",
    action: null,
    args: {
      payer: payer!.pubkey.toBase58(),
      account: account!.pubkey.toBase58(),
      owner: owner!.pubkey.toBase58(),
      mint: mint!.pubkey.toBase58(),
      tokenProgram: tokenProgram!.pubkey.toBase58(),
    },
    accountNames: [
      "payer",
      "account",
      "owner",
      "mint",
      "system_program",
      "token_program",
    ],
  };
}

/** Bind a single ATA creation to its later admin_list_mint in the same plan. */
export function verifyExtensionInstructions(
  instructions: readonly TransactionInstruction[],
  programId: PublicKey,
  authority: PublicKey,
) {
  const ataIndices = instructions.flatMap((instruction, index) =>
    instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM) ? [index] : [],
  );
  if (ataIndices.length > 1) throw new OpsError("extension_ata_count_exceeded");
  const decoded = instructions.map((instruction) =>
    decodeExtensionInstruction(instruction, programId),
  );
  for (const index of ataIndices) {
    const ata = instructions[index]!;
    if (!ata.keys[0]!.pubkey.equals(authority))
      throw new OpsError("extension_ata_payer_mismatch");
    const matchesListing = instructions.some((instruction, listingIndex) => {
      const listing = decoded[listingIndex]!;
      if (listingIndex <= index || listing.instruction !== "admin_list_mint")
        return false;
      const account = (name: string) =>
        instruction.keys[listing.accountNames.indexOf(name)]?.pubkey;
      return (
        account("admin")?.equals(authority) &&
        account("mint")?.equals(ata.keys[3]!.pubkey) &&
        account("vault")?.equals(ata.keys[1]!.pubkey) &&
        account("vault_auth")?.equals(ata.keys[2]!.pubkey) &&
        account("token_program")?.equals(ata.keys[5]!.pubkey)
      );
    });
    if (!matchesListing) throw new OpsError("extension_ata_listing_mismatch");
  }
  return decoded;
}
