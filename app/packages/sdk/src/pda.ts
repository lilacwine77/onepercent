import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PUMP_LAYOUTS, WSOL_MINT } from "@onepercent/config";
import { EXTERNAL_IDS, SEEDS } from "./constants.js";
import { u32 } from "./bytes.js";

const pda = (
  program: PublicKey,
  seed: string,
  args: Uint8Array[] = [],
): [PublicKey, number] =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...args], program);
export const configPda = (programId: PublicKey) => pda(programId, SEEDS.config);
export const machinePda = (programId: PublicKey) =>
  pda(programId, SEEDS.machine);
export const deckPda = (programId: PublicKey) => pda(programId, SEEDS.deck);
export const vaultAuthPda = (programId: PublicKey) =>
  pda(programId, SEEDS.vaultAuth);
export const feeInPda = (programId: PublicKey) => pda(programId, SEEDS.feeIn);
export const programIdentityPda = (programId: PublicKey) =>
  pda(programId, SEEDS.identity);
export const binderPda = (programId: PublicKey, owner: PublicKey) =>
  pda(programId, SEEDS.binder, [owner.toBuffer()]);
export const pullPda = (
  programId: PublicKey,
  buyer: PublicKey,
  nonce: number,
) => pda(programId, SEEDS.pull, [buyer.toBuffer(), u32(nonce)]);
export const ledgerPda = (programId: PublicKey, mint: PublicKey) =>
  pda(programId, SEEDS.ledger, [mint.toBuffer()]);
export const vaultAta = (
  programId: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
) =>
  getAssociatedTokenAddressSync(
    mint,
    vaultAuthPda(programId)[0],
    true,
    tokenProgram,
  );
export const userAta = (
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
) => getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
export const bondingCurvePda = (mint: PublicKey) =>
  pda(EXTERNAL_IDS.pumpFun, PUMP_LAYOUTS.bondingCurveSeed, [mint.toBuffer()]);
export const scopedVrfIdentity = (programId: PublicKey) =>
  pda(EXTERNAL_IDS.magicblockVrf, SEEDS.identity, [programId.toBuffer()]);

/** DBC orders mints by their 32-byte public keys, descending. */
export const dbcPoolPda = (
  mint: PublicKey,
  config: PublicKey,
): [PublicKey, number] => {
  const quote = new PublicKey(WSOL_MINT);
  const [maximum, minimum] =
    Buffer.compare(mint.toBuffer(), quote.toBuffer()) > 0
      ? [mint, quote]
      : [quote, mint];
  return pda(EXTERNAL_IDS.meteoraDbc, "pool", [
    config.toBuffer(),
    maximum.toBuffer(),
    minimum.toBuffer(),
  ]);
};
