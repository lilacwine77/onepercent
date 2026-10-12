import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  MAYHEM_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
} from "./ids.js";

// Seeds and program owners: pump-public-docs 2293f9a6 IDLs and COIN_CREATION.md.
const derive = (program: PublicKey, seed: string, ...keys: Uint8Array[]) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...keys], program)[0];
export const pumpGlobal = () => derive(PUMP_PROGRAM_ID, "global");
export const mintAuthority = () => derive(PUMP_PROGRAM_ID, "mint-authority");
export const bondingCurve = (mint: PublicKey) =>
  derive(PUMP_PROGRAM_ID, "bonding-curve", mint.toBytes());
export const pumpAta = (
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
) => getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
export const associatedBondingCurve = (mint: PublicKey) =>
  pumpAta(bondingCurve(mint), mint);
export const creatorVault = (creator: PublicKey) =>
  derive(PUMP_PROGRAM_ID, "creator-vault", creator.toBytes());
export const ammCreatorVaultAuthority = (creator: PublicKey) =>
  derive(PUMP_AMM_PROGRAM_ID, "creator_vault", creator.toBytes());
export const pumpEventAuthority = (program = PUMP_PROGRAM_ID) =>
  derive(program, "__event_authority");
export const userVolumeAccumulator = (wallet: PublicKey) =>
  derive(PUMP_PROGRAM_ID, "user_volume_accumulator", wallet.toBytes());
export const curveFeeConfig = () =>
  derive(PUMP_FEE_PROGRAM_ID, "fee_config", PUMP_PROGRAM_ID.toBytes());
export const globalParams = () => derive(MAYHEM_PROGRAM_ID, "global-params");
export const solVault = () => derive(MAYHEM_PROGRAM_ID, "sol-vault");
export const mayhemState = (mint: PublicKey) =>
  derive(MAYHEM_PROGRAM_ID, "mayhem-state", mint.toBytes());
export const mayhemTokenVault = (mint: PublicKey) => pumpAta(solVault(), mint);
export const poolAuthority = (mint: PublicKey) =>
  derive(PUMP_PROGRAM_ID, "pool-authority", mint.toBytes());
export const canonicalPool = (mint: PublicKey) =>
  derive(
    PUMP_AMM_PROGRAM_ID,
    "pool",
    Buffer.alloc(2),
    poolAuthority(mint).toBytes(),
    mint.toBytes(),
    NATIVE_MINT.toBytes(),
  );
export const wsolAta = (owner: PublicKey) =>
  pumpAta(owner, NATIVE_MINT, TOKEN_PROGRAM_ID);
