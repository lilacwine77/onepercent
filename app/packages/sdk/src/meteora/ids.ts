import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
export const DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
);
export const DAMM_V2_PROGRAM_ID = new PublicKey(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
);
export const DAMM_V2_CUSTOM_CONFIG = new PublicKey(
  "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck",
);
export const METEORA_METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
const pda = (program: PublicKey, seeds: (string | PublicKey)[]) =>
  PublicKey.findProgramAddressSync(
    seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : s.toBuffer())),
    program,
  )[0];
const sorted = (a: PublicKey, b: PublicKey) =>
  a.toBuffer().compare(b.toBuffer()) > 0 ? [a, b] : [b, a];
export const dbcPool = (config: PublicKey, mint: PublicKey) =>
  pda(DBC_PROGRAM_ID, ["pool", config, ...sorted(mint, NATIVE_MINT)]);
export const dbcBaseVault = (pool: PublicKey, mint: PublicKey) =>
  pda(DBC_PROGRAM_ID, ["token_vault", mint, pool]);
export const dbcQuoteVault = (pool: PublicKey) =>
  dbcBaseVault(pool, NATIVE_MINT);
export const dbcPoolAuthority = () => pda(DBC_PROGRAM_ID, ["pool_authority"]);
export const dbcEventAuthority = () =>
  pda(DBC_PROGRAM_ID, ["__event_authority"]);
export const dbcMetadata = (mint: PublicKey) =>
  pda(METEORA_METADATA_PROGRAM, ["metadata", METEORA_METADATA_PROGRAM, mint]);
export const dammV2Pool = (mint: PublicKey) =>
  pda(DAMM_V2_PROGRAM_ID, [
    "pool",
    DAMM_V2_CUSTOM_CONFIG,
    ...sorted(mint, NATIVE_MINT),
  ]);
export const dammV2Vault = (pool: PublicKey, mint: PublicKey) =>
  pda(DAMM_V2_PROGRAM_ID, ["token_vault", mint, pool]);
export const dammV2PoolAuthority = () =>
  pda(DAMM_V2_PROGRAM_ID, ["pool_authority"]);
export const dammV2EventAuthority = () =>
  pda(DAMM_V2_PROGRAM_ID, ["__event_authority"]);
export const dammV2Position = (mint: PublicKey) =>
  pda(DAMM_V2_PROGRAM_ID, ["position", mint]);
export const dammV2PositionNft = (mint: PublicKey) =>
  pda(DAMM_V2_PROGRAM_ID, ["position_nft_account", mint]);
