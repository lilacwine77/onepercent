import { ACCOUNT_SIZES } from "@onepercent/config";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Commitment } from "@solana/web3.js";
import { U64_MAX } from "./bytes.js";
import { EXTERNAL_IDS } from "./constants.js";
import { binderPda, configPda, deckPda, ledgerPda, machinePda } from "./pda.js";
import {
  decodeBinder,
  decodeConfig,
  decodeMachine,
  decodeMintLedger,
  decodePull,
  deckEntryLayout,
  deckHeaderLayout,
} from "./layouts.js";

async function readAccount<T>(
  programId: PublicKey,
  connection: Connection,
  address: PublicKey,
  decode: (data: Uint8Array) => T,
  commitment: Commitment = "confirmed",
): Promise<T | null> {
  const info = await connection.getAccountInfo(address, commitment);
  if (!info) return null;
  if (!info.owner.equals(programId) || info.executable)
    throw new Error("Unexpected program account owner");
  return decode(info.data);
}
export const fetchConfig = (
  programId: PublicKey,
  connection: Connection,
  commitment?: Commitment,
) =>
  readAccount(
    programId,
    connection,
    configPda(programId)[0],
    decodeConfig,
    commitment,
  );
export const fetchMachine = (
  programId: PublicKey,
  connection: Connection,
  commitment?: Commitment,
) =>
  readAccount(
    programId,
    connection,
    machinePda(programId)[0],
    decodeMachine,
    commitment,
  );
export const fetchBinder = (
  programId: PublicKey,
  connection: Connection,
  owner: PublicKey,
  commitment?: Commitment,
) =>
  readAccount(
    programId,
    connection,
    binderPda(programId, owner)[0],
    decodeBinder,
    commitment,
  );
export const fetchPull = (
  programId: PublicKey,
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment,
) => readAccount(programId, connection, address, decodePull, commitment);
export const fetchMintLedger = (
  programId: PublicKey,
  connection: Connection,
  mint: PublicKey,
  commitment?: Commitment,
) =>
  readAccount(
    programId,
    connection,
    ledgerPda(programId, mint)[0],
    decodeMintLedger,
    commitment,
  );
export async function fetchAccountExists(
  connection: Connection,
  address: PublicKey,
): Promise<boolean> {
  return (await connection.getAccountInfo(address, "confirmed")) !== null;
}
export async function fetchMintDecimals(
  connection: Connection,
  mint: PublicKey,
): Promise<{ decimals: number; tokenProgram: PublicKey }> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (
    !info ||
    info.data.length < 82 ||
    (!info.owner.equals(EXTERNAL_IDS.splToken) &&
      !info.owner.equals(EXTERNAL_IDS.token2022))
  )
    throw new Error("Invalid mint account");
  return { decimals: info.data[44] as number, tokenProgram: info.owner };
}
export async function fetchBinderNonces(
  programId: PublicKey,
  connection: Connection,
  owner: PublicKey,
) {
  const binder = await fetchBinder(programId, connection, owner);
  return {
    feedNonceBase: binder?.feed_nonce_base ?? 0,
    feedNonceBits: binder?.feed_nonce_bits ?? 0,
    pullNonce: binder?.pull_nonce ?? 0,
    sbNonce: binder?.sb_nonce ?? 0,
  };
}
export async function fetchPayees(
  connection: Connection,
  addresses: readonly PublicKey[],
) {
  const infos = await connection.getMultipleAccountsInfo(
    [...addresses],
    "confirmed",
  );
  return addresses.map((address, i) => ({
    address,
    executable: infos[i]?.executable ?? false,
  }));
}
/** Two bounded reads; callers retry if swap-removal changes the Deck between them. */
export async function fetchDeckRange(
  programId: PublicKey,
  connection: Connection,
  start: number,
  count: number,
) {
  const headerInfo = await connection.getAccountInfoAndContext(
    deckPda(programId)[0],
    {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
    },
  );
  if (!headerInfo.value) return null;
  if (!headerInfo.value.owner.equals(programId))
    throw new Error("Unexpected Deck owner");
  const header = deckHeaderLayout.decode(headerInfo.value.data);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    start < 0 ||
    count < 0 ||
    start + count > header.len
  )
    throw new RangeError("Invalid Deck range");
  const result = await connection.getAccountInfoAndContext(
    deckPda(programId)[0],
    {
      commitment: "confirmed",
      minContextSlot: headerInfo.context.slot,
      dataSlice: {
        offset: ACCOUNT_SIZES.deckHeader + start * ACCOUNT_SIZES.deckEntry,
        length: count * ACCOUNT_SIZES.deckEntry,
      },
    },
  );
  if (
    !result.value ||
    result.value.data.length !== count * ACCOUNT_SIZES.deckEntry ||
    !result.value.owner.equals(programId)
  )
    throw new Error("Deck changed during range read");
  return {
    header,
    start,
    slot: result.context.slot,
    entries: Array.from({ length: count }, (_, i) =>
      deckEntryLayout.read(result.value!.data, i * ACCOUNT_SIZES.deckEntry),
    ),
  };
}

export interface PayeeRentPlan {
  address: PublicKey;
  /** TakeBack with no SOL credit does not increase a rent-paying account's balance. Omit for the strict check. */
  instruction?: "takeBack" | "closeVault";
  /** The amount this exit will actually transfer, after any shrink/rent accounting. */
  incomingLamports: bigint;
  /** Debits before the exit, including transaction fees when this wallet is fee payer. */
  debitLamports: bigint;
}
export interface PayeeRentCheck extends PayeeRentPlan {
  balanceLamports: bigint;
  rentBytes: number;
  minimumLamports: bigint;
  postBalanceLamports: bigint;
  /** Minimum topup atomically combined with the exit; alone it may remain below rent. */
  shortfallLamports: bigint;
  /** Minimum for a separate topup transaction, also covering the subsequent exit. */
  standaloneTopUpLamports: bigint;
  ready: boolean;
  copyKey: "payeeBelowRent" | null;
}
interface PayeeRentRpc {
  getAccountInfo(
    address: PublicKey,
    commitment?: Commitment,
  ): Promise<{ lamports: number; data: Uint8Array } | null>;
  getMinimumBalanceForRentExemption(
    dataLength: number,
    commitment?: Commitment,
  ): Promise<number>;
}
function rpcLamports(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("RPC lamports must be a non-negative safe integer");
  return BigInt(value);
}
/** D17 client hint. The on-chain check remains authoritative if state changes before signing. */
export async function precheckPayeeRent(
  connection: PayeeRentRpc,
  plan: PayeeRentPlan,
  commitment: Commitment = "confirmed",
): Promise<PayeeRentCheck> {
  for (const value of [plan.incomingLamports, plan.debitLamports])
    if (value < 0n || value > U64_MAX)
      throw new RangeError("Planned lamports outside u64");
  const account = await connection.getAccountInfo(plan.address, commitment);
  const balanceLamports = rpcLamports(account?.lamports ?? 0);
  const rentBytes = account?.data.length ?? 0;
  const minimumLamports = rpcLamports(
    await connection.getMinimumBalanceForRentExemption(rentBytes, commitment),
  );
  const postBalanceLamports =
    balanceLamports - plan.debitLamports + plan.incomingLamports;
  if (postBalanceLamports > U64_MAX)
    throw new RangeError("Planned balance exceeds u64");
  const requiresRent = !(
    plan.instruction === "takeBack" && plan.incomingLamports === 0n
  );
  const gaps = [
    0n,
    requiresRent ? minimumLamports - postBalanceLamports : 0n,
    plan.debitLamports - balanceLamports,
  ];
  const shortfallLamports = gaps.reduce(
    (maximum, value) => (value > maximum ? value : maximum),
    0n,
  );
  const standaloneTopUpLamports = [
    shortfallLamports,
    requiresRent || shortfallLamports > 0n
      ? minimumLamports - balanceLamports
      : 0n,
    requiresRent || shortfallLamports > 0n
      ? minimumLamports - postBalanceLamports
      : 0n,
  ].reduce((maximum, value) => (value > maximum ? value : maximum), 0n);
  const ready = shortfallLamports === 0n;
  return {
    ...plan,
    balanceLamports,
    rentBytes,
    minimumLamports,
    postBalanceLamports,
    shortfallLamports,
    standaloneTopUpLamports,
    ready,
    copyKey: ready ? null : "payeeBelowRent",
  };
}
