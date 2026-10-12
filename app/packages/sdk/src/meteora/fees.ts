import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { WSOL_MINT, METEORA } from "@onepercent/config";
import { EXTERNAL_IDS } from "../constants.js";
import {
  decodeDbcLaunchPool,
  decodeDbcLaunchConfig,
  decodeDammClaimPool,
  decodeDammClaimPosition,
} from "./launch.js";

// D29: pinned DBC f552f20 and DAMM v2 a85c926 account layouts, including discriminator.
export const METEORA_FEE_LAYOUT = {
  curve: {
    baseReserve: 232,
    quoteReserve: 240,
    baseFee: 264,
    quoteFee: 272,
    migrated: 305,
    surplus: 306,
    migrationProgress: 308,
  },
  config: {
    collectFeeMode: 232,
    partnerLockedPercent: 239,
    migrationThreshold: 264,
  },
  pool: {
    feeA: 488,
    feeB: 520,
    baseReserve: 680,
    quoteReserve: 688,
    collectFeeMode: 484,
  },
  position: {
    checkpointA: 72,
    checkpointB: 104,
    pendingA: 136,
    pendingB: 144,
    locked: 184,
  },
} as const;
export const DAMM_MIGRATION_CONFIG = new PublicKey(METEORA.dammV2Config);
export const meteoraPda = (
  program: PublicKey,
  seed: string,
  keys: readonly PublicKey[] = [],
) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...keys.map((key) => key.toBuffer())],
    program,
  )[0];
export function dammLaunchPoolPda(mint: PublicKey) {
  const quote = new PublicKey(WSOL_MINT);
  const sorted = [mint, quote].sort((a, b) =>
    Buffer.compare(b.toBuffer(), a.toBuffer()),
  );
  return meteoraPda(EXTERNAL_IDS.meteoraDammV2, "pool", [
    DAMM_MIGRATION_CONFIG,
    ...sorted,
  ]);
}
const u128 = (data: Uint8Array, offset: number) =>
  u64(data, offset) | (u64(data, offset + 8) << 64n);
const u64 = (data: Uint8Array, offset: number) =>
  Buffer.from(data).readBigUInt64LE(offset);
export function decodeDbcFeePool(data: Uint8Array) {
  const pool = decodeDbcLaunchPool(data);
  const l = METEORA_FEE_LAYOUT.curve;
  if (data[l.migrated]! > 1 || data[l.surplus]! > 1)
    throw new Error("meteora_invalid_flags");
  return {
    ...pool,
    sqrtPrice: u128(data, 280),
    baseReserve: u64(data, l.baseReserve),
    quoteReserve: u64(data, l.quoteReserve),
    baseFee: u64(data, l.baseFee),
    quoteFee: u64(data, l.quoteFee),
    migrated: data[l.migrated] === 1,
    surplusClaimed: data[l.surplus] === 1,
    migrationProgress: data[l.migrationProgress]!,
  };
}
export function decodeDbcFeeConfig(data: Uint8Array) {
  const config = decodeDbcLaunchConfig(data);
  const l = METEORA_FEE_LAYOUT.config;
  return {
    ...config,
    collectFeeMode: data[l.collectFeeMode]!,
    partnerLockedPercent: data[l.partnerLockedPercent]!,
    migrationThreshold: u64(data, l.migrationThreshold),
  };
}
export function decodeDammFeePool(data: Uint8Array) {
  const pool = decodeDammClaimPool(data);
  const l = METEORA_FEE_LAYOUT.pool;
  return {
    ...pool,
    sqrtPrice: u128(data, 456),
    baseReserve: u64(data, l.baseReserve),
    quoteReserve: u64(data, l.quoteReserve),
    feeA: Buffer.from(data.slice(l.feeA, l.feeA + 32)),
    feeB: Buffer.from(data.slice(l.feeB, l.feeB + 32)),
    collectFeeMode: data[l.collectFeeMode]!,
  };
}
export function decodeDammFeePosition(data: Uint8Array) {
  const position = decodeDammClaimPosition(data);
  const l = METEORA_FEE_LAYOUT.position;
  return {
    ...position,
    pendingA: u64(data, l.pendingA),
    pendingB: u64(data, l.pendingB),
    checkpointA: Buffer.from(data.slice(l.checkpointA, l.checkpointA + 32)),
    checkpointB: Buffer.from(data.slice(l.checkpointB, l.checkpointB + 32)),
  };
}
/** Account order and discriminator match fixtures/meteora/dbc.json migration_damm_v2. */
export function migrationDammV2Ix(input: {
  payer: PublicKey;
  mint: PublicKey;
  dbcConfig: PublicKey;
  curve: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  positionMint: PublicKey;
}) {
  const dbc = EXTERNAL_IDS.meteoraDbc;
  const damm = EXTERNAL_IDS.meteoraDammV2;
  const pool = dammLaunchPoolPda(input.mint);
  const quote = new PublicKey(WSOL_MINT);
  const entries: [PublicKey, boolean?, boolean?][] = [
    [input.curve, true],
    [meteoraPda(dbc, "damm_v2", [input.curve])],
    [input.dbcConfig],
    [meteoraPda(dbc, "pool_authority"), true],
    [pool, true],
    [input.positionMint, true, true],
    [meteoraPda(damm, "position_nft_account", [input.positionMint]), true],
    [meteoraPda(damm, "position", [input.positionMint]), true],
    [dbc],
    [dbc],
    [dbc],
    [meteoraPda(damm, "pool_authority")],
    [damm],
    [input.mint, true],
    [quote, true],
    [meteoraPda(damm, "token_vault", [input.mint, pool]), true],
    [meteoraPda(damm, "token_vault", [quote, pool]), true],
    [input.baseVault, true],
    [input.quoteVault, true],
    [input.payer, true, true],
    [EXTERNAL_IDS.splToken],
    [EXTERNAL_IDS.splToken],
    [EXTERNAL_IDS.token2022],
    [meteoraPda(damm, "__event_authority")],
    [SystemProgram.programId],
    [DAMM_MIGRATION_CONFIG],
  ];
  return new TransactionInstruction({
    programId: dbc,
    data: Buffer.from([156, 169, 230, 103, 53, 228, 80, 64]),
    keys: entries.map(([pubkey, isWritable = false, isSigner = false]) => ({
      pubkey,
      isWritable,
      isSigner,
    })),
  });
}
