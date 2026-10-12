import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  DBC_INSTRUCTION_CODER,
  DAMM_V2_INSTRUCTION_CODER,
  toMeteoraWire,
} from "./codec.js";
import { buildDbcLaunchConfig } from "./math.js";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DAMM_V2_CUSTOM_CONFIG,
  METEORA_METADATA_PROGRAM,
  dbcPool,
  dbcBaseVault,
  dbcQuoteVault,
  dbcPoolAuthority,
  dbcEventAuthority,
  dbcMetadata,
  dammV2Pool,
  dammV2Vault,
  dammV2PoolAuthority,
  dammV2EventAuthority,
  dammV2Position,
  dammV2PositionNft,
} from "./ids.js";
const key = (
  pubkey: PublicKey,
  isWritable = false,
  isSigner = false,
): AccountMeta => ({ pubkey, isWritable, isSigner });
const dbcIx = (name: string, keys: AccountMeta[], args: object = {}) =>
  new TransactionInstruction({
    programId: DBC_PROGRAM_ID,
    keys,
    data: DBC_INSTRUCTION_CODER.encode(name, toMeteoraWire(args) as object),
  });
export interface DbcMetadata {
  name: string;
  symbol: string;
  uri: string;
}
export function validateDbcMetadata(input: DbcMetadata): void {
  for (const [name, limit] of [
    ["name", 32],
    ["symbol", 10],
    ["uri", 200],
  ] as const)
    if (!input[name].length || Buffer.byteLength(input[name], "utf8") > limit)
      throw new RangeError(`Invalid Meteora ${name} length`);
  const uri = new URL(input.uri);
  if (uri.protocol !== "https:" || uri.username || uri.password)
    throw new Error("Metadata URI must use HTTPS without credentials");
}
export function createDbcConfigIx(input: {
  config: PublicKey;
  payer: PublicKey;
  feeIn: PublicKey;
  migrationQuoteThreshold?: bigint;
}): TransactionInstruction {
  return dbcIx(
    "create_config",
    [
      key(input.config, true, true),
      key(input.feeIn),
      key(input.feeIn),
      key(NATIVE_MINT),
      key(input.payer, true, true),
      key(SystemProgram.programId),
      key(dbcEventAuthority()),
      key(DBC_PROGRAM_ID),
    ],
    { configParameters: buildDbcLaunchConfig(input.migrationQuoteThreshold) },
  );
}
export function initializeDbcPoolIx(
  input: DbcMetadata & {
    config: PublicKey;
    mint: PublicKey;
    payer: PublicKey;
    creator?: PublicKey;
  },
): TransactionInstruction {
  validateDbcMetadata(input);
  const pool = dbcPool(input.config, input.mint);
  return dbcIx(
    "initialize_virtual_pool_with_spl_token",
    [
      key(input.config),
      key(dbcPoolAuthority()),
      key(input.creator ?? input.payer, false, true),
      key(input.mint, true, true),
      key(NATIVE_MINT),
      key(pool, true),
      key(dbcBaseVault(pool, input.mint), true),
      key(dbcQuoteVault(pool), true),
      key(dbcMetadata(input.mint), true),
      key(METEORA_METADATA_PROGRAM),
      key(input.payer, true, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(SystemProgram.programId),
      key(dbcEventAuthority()),
      key(DBC_PROGRAM_ID),
    ],
    { params: { name: input.name, symbol: input.symbol, uri: input.uri } },
  );
}
function swapKeys(input: {
  config: PublicKey;
  mint: PublicKey;
  user: PublicKey;
  direction?: "buy" | "sell";
}) {
  const pool = dbcPool(input.config, input.mint),
    base = getAssociatedTokenAddressSync(input.mint, input.user, true),
    quote = getAssociatedTokenAddressSync(NATIVE_MINT, input.user, true);
  return [
    key(dbcPoolAuthority()),
    key(input.config),
    key(pool, true),
    key(input.direction === "sell" ? base : quote, true),
    key(input.direction === "sell" ? quote : base, true),
    key(dbcBaseVault(pool, input.mint), true),
    key(dbcQuoteVault(pool), true),
    key(input.mint),
    key(NATIVE_MINT),
    key(input.user, false, true),
    key(TOKEN_PROGRAM_ID),
    key(TOKEN_PROGRAM_ID),
    key(DBC_PROGRAM_ID),
    key(dbcEventAuthority()),
    key(DBC_PROGRAM_ID),
  ];
}
export function dbcSwap2Ix(input: {
  config: PublicKey;
  mint: PublicKey;
  user: PublicKey;
  amountOut: bigint;
  maxQuoteIn: bigint;
}): TransactionInstruction {
  if (input.amountOut <= 0n || input.maxQuoteIn <= 0n)
    throw new RangeError("Swap amounts must be positive");
  return dbcIx("swap2", swapKeys(input), {
    params: {
      amount0: input.amountOut,
      amount1: input.maxQuoteIn,
      swapMode: 2,
    },
  });
}
export function dbcPartialFillIx(input: {
  config: PublicKey;
  mint: PublicKey;
  user: PublicKey;
  amountIn: bigint;
  minAmountOut?: bigint;
  direction?: "buy" | "sell";
}): TransactionInstruction {
  if (input.amountIn <= 0n)
    throw new RangeError("Swap amount must be positive");
  return dbcIx("swap2", swapKeys(input), {
    params: {
      amount0: input.amountIn,
      amount1: input.minAmountOut ?? 0n,
      swapMode: 1,
    },
  });
}
export function migrateDbcDammV2Ix(input: {
  config: PublicKey;
  mint: PublicKey;
  payer: PublicKey;
  positionNftMint: PublicKey;
}): TransactionInstruction {
  const pool = dbcPool(input.config, input.mint),
    damm = dammV2Pool(input.mint),
    nft = input.positionNftMint;
  return dbcIx("migration_damm_v2", [
    key(pool, true),
    key(pool),
    key(input.config),
    key(dbcPoolAuthority(), true),
    key(damm, true),
    key(nft, true, true),
    key(dammV2PositionNft(nft), true),
    key(dammV2Position(nft), true),
    key(DBC_PROGRAM_ID),
    key(DBC_PROGRAM_ID),
    key(DBC_PROGRAM_ID),
    key(dammV2PoolAuthority()),
    key(DAMM_V2_PROGRAM_ID),
    key(input.mint, true),
    key(NATIVE_MINT, true),
    key(dammV2Vault(damm, input.mint), true),
    key(dammV2Vault(damm, NATIVE_MINT), true),
    key(dbcBaseVault(pool, input.mint), true),
    key(dbcQuoteVault(pool), true),
    key(input.payer, true, true),
    key(TOKEN_PROGRAM_ID),
    key(TOKEN_PROGRAM_ID),
    key(TOKEN_2022_PROGRAM_ID),
    key(dammV2EventAuthority()),
    key(SystemProgram.programId),
    key(DAMM_V2_CUSTOM_CONFIG),
  ]);
}
export function dbcClaimTradingFeeIx(input: {
  config: PublicKey;
  mint: PublicKey;
  feeClaimer: PublicKey;
  baseAccount: PublicKey;
  quoteAccount: PublicKey;
  maxBaseAmount: bigint;
  maxQuoteAmount: bigint;
}): TransactionInstruction {
  const pool = dbcPool(input.config, input.mint);
  return dbcIx(
    "claim_trading_fee",
    [
      key(dbcPoolAuthority()),
      key(input.config),
      key(pool, true),
      key(input.baseAccount, true),
      key(input.quoteAccount, true),
      key(dbcBaseVault(pool, input.mint), true),
      key(dbcQuoteVault(pool), true),
      key(input.mint),
      key(NATIVE_MINT),
      key(input.feeClaimer, false, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(dbcEventAuthority()),
      key(DBC_PROGRAM_ID),
    ],
    { maxAmountA: input.maxBaseAmount, maxAmountB: input.maxQuoteAmount },
  );
}
export function dbcPartnerWithdrawSurplusIx(input: {
  config: PublicKey;
  mint: PublicKey;
  feeClaimer: PublicKey;
  quoteAccount: PublicKey;
}): TransactionInstruction {
  const pool = dbcPool(input.config, input.mint);
  return dbcIx("partner_withdraw_surplus", [
    key(dbcPoolAuthority()),
    key(input.config),
    key(pool, true),
    key(input.quoteAccount, true),
    key(dbcQuoteVault(pool), true),
    key(NATIVE_MINT),
    key(input.feeClaimer, false, true),
    key(TOKEN_PROGRAM_ID),
    key(dbcEventAuthority()),
    key(DBC_PROGRAM_ID),
  ]);
}
export function dammV2ClaimPositionFeeIx(input: {
  mint: PublicKey;
  positionNftMint: PublicKey;
  owner: PublicKey;
  baseAccount: PublicKey;
  quoteAccount: PublicKey;
}): TransactionInstruction {
  const pool = dammV2Pool(input.mint),
    nft = input.positionNftMint;
  return new TransactionInstruction({
    programId: DAMM_V2_PROGRAM_ID,
    data: DAMM_V2_INSTRUCTION_CODER.encode("claim_position_fee", {}),
    keys: [
      key(dammV2PoolAuthority()),
      key(pool),
      key(dammV2Position(nft), true),
      key(input.baseAccount, true),
      key(input.quoteAccount, true),
      key(dammV2Vault(pool, input.mint), true),
      key(dammV2Vault(pool, NATIVE_MINT), true),
      key(input.mint),
      key(NATIVE_MINT),
      key(dammV2PositionNft(nft)),
      key(input.owner, false, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(dammV2EventAuthority()),
      key(DAMM_V2_PROGRAM_ID),
    ],
  });
}
/** Exact-output SOL buy on the canonical migrated SPL pool, without referral. */
export function dammV2Swap2Ix(input: {
  mint: PublicKey;
  user: PublicKey;
  amountOut: bigint;
  maxQuoteIn: bigint;
}): TransactionInstruction {
  if (input.amountOut <= 0n || input.maxQuoteIn <= 0n)
    throw new RangeError("Swap amounts must be positive");
  const pool = dammV2Pool(input.mint),
    base = getAssociatedTokenAddressSync(input.mint, input.user, true),
    quote = getAssociatedTokenAddressSync(NATIVE_MINT, input.user, true);
  return new TransactionInstruction({
    programId: DAMM_V2_PROGRAM_ID,
    data: DAMM_V2_INSTRUCTION_CODER.encode(
      "swap2",
      toMeteoraWire({
        _params: {
          amount0: input.amountOut,
          amount1: input.maxQuoteIn,
          swapMode: 2,
        },
      }) as object,
    ),
    keys: [
      key(dammV2PoolAuthority()),
      key(pool, true),
      key(quote, true),
      key(base, true),
      key(dammV2Vault(pool, input.mint), true),
      key(dammV2Vault(pool, NATIVE_MINT), true),
      key(input.mint),
      key(NATIVE_MINT),
      key(input.user, false, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(DAMM_V2_PROGRAM_ID),
      key(dammV2EventAuthority()),
      key(DAMM_V2_PROGRAM_ID),
    ],
  });
}
