import { webDeployment } from "../data/deployment";
import { ACCOUNT_SIZES } from "@onepercent/config";
import {
  buildTakeBackTransactions,
  EXTERNAL_IDS,
  precheckPayeeRent,
  userAta,
  type BuiltTransaction,
  type PayeeRentCheck,
  type TransactionOptions,
} from "@onepercent/sdk/browser";
import { unpackAccount, unpackMint } from "@solana/spl-token";
import {
  PublicKey,
  Transaction,
  TransactionMessage,
  type Connection,
} from "@solana/web3.js";
import {
  readDeckSelection,
  type LoadDeckHints,
  resolveDeckEntries,
  type ChainDeckEntry,
  type DeckSnapshot,
} from "../data/deck";
import { rpcLamports, uninitializedAccount } from "../data/feed-chain";
import { EngineError } from "./engine/errors";

export type TakeBackRpc = Pick<
  Connection,
  | "getAccountInfo"
  | "getAccountInfoAndContext"
  | "getMinimumBalanceForRentExemption"
  | "getFeeForMessage"
>;
export interface TakeBackBalance {
  address: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  amount: bigint;
}
export interface PreparedTakeBack {
  transaction: BuiltTransaction;
  entries: ChainDeckEntry[];
  balances: TakeBackBalance[];
  ataRentLamports: bigint;
  ataAccounts: number;
  refundLamports: bigint;
  payeeRent: PayeeRentCheck;
}

async function mintProgram(rpc: TakeBackRpc, mint: PublicKey) {
  const info = await rpc.getAccountInfo(mint, "confirmed");
  if (
    !info ||
    info.executable ||
    (!info.owner.equals(EXTERNAL_IDS.splToken) &&
      !info.owner.equals(EXTERNAL_IDS.token2022))
  )
    throw new Error("Invalid exit mint");
  // Exits never apply Feed eligibility or provenance restrictions.
  unpackMint(mint, info, info.owner);
  return info.owner;
}

async function readDestination(
  rpc: TakeBackRpc,
  wallet: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
) {
  const address = userAta(wallet, mint, tokenProgram);
  const info = await rpc.getAccountInfo(address, "confirmed");
  if (uninitializedAccount(info))
    return {
      address,
      amount: 0n,
      exists: false,
      lamports: rpcLamports(info?.lamports ?? 0),
    };
  if (info!.executable) throw new Error("Invalid exit destination");
  const account = unpackAccount(address, info!, tokenProgram);
  if (!account.owner.equals(wallet) || !account.mint.equals(mint))
    throw new Error("Unexpected exit destination identity");
  return {
    address,
    amount: account.amount,
    exists: true,
    lamports: rpcLamports(info!.lamports),
  };
}

/** Exact program shrink/refund rule, evaluated sequentially for descending exits. */
export async function projectedTakeBackRefunds(
  rpc: Pick<Connection, "getMinimumBalanceForRentExemption">,
  snapshot: DeckSnapshot,
  entries: readonly ChainDeckEntry[],
) {
  if (!snapshot.header && entries.length) throw new Error("Deck unavailable");
  let len = snapshot.header?.len ?? 0;
  let cap = snapshot.header?.cap ?? 0;
  let lamports = snapshot.lamports;
  const refunds = new Map<number, bigint>();
  for (const entry of [...entries].sort((a, b) => b.deckIndex - a.deckIndex)) {
    if (len === 0) throw new Error("Empty Deck");
    len--;
    const required = rpcLamports(
      await rpc.getMinimumBalanceForRentExemption(
        ACCOUNT_SIZES.deckHeader + ACCOUNT_SIZES.deckEntry * len,
        "confirmed",
      ),
    );
    if (len < cap && lamports >= required) cap = len;
    const floor =
      cap === len
        ? required
        : rpcLamports(
            await rpc.getMinimumBalanceForRentExemption(
              ACCOUNT_SIZES.deckHeader + ACCOUNT_SIZES.deckEntry * cap,
              "confirmed",
            ),
          );
    const available = lamports > floor ? lamports - floor : 0n;
    const deposit = BigInt(entry.deposit);
    const refund = deposit < available ? deposit : available;
    refunds.set(entry.deckIndex, refund);
    lamports -= refund;
  }
  return refunds;
}

/** Fresh chain resolution, SDK-only construction and D17 precheck. No phase or API gate. */
export async function prepareTakeBack(
  rpc: TakeBackRpc,
  options: TransactionOptions & {
    entries: readonly ChainDeckEntry[];
    loadDeckHints?: LoadDeckHints;
  },
): Promise<{
  batches: PreparedTakeBack[];
  missing: ChainDeckEntry[];
  snapshot: DeckSnapshot;
}> {
  if (
    new Set(options.entries.map((entry) => entry.id)).size !==
    options.entries.length
  )
    throw new EngineError("errors.cardMoved");
  const snapshot = await readDeckSelection(
    rpc,
    options.wallet,
    options.entries,
    options.loadDeckHints,
  );
  const resolved = resolveDeckEntries(options.entries, snapshot.entries);
  const sorted = [...resolved.entries].sort(
    (a, b) => b.deckIndex - a.deckIndex,
  );
  const destinations = new Map<
    string,
    TakeBackBalance & { exists: boolean; rent: bigint }
  >();
  for (const entry of sorted) {
    if (destinations.has(entry.mint.toBase58())) continue;
    const tokenProgram = await mintProgram(rpc, entry.mint);
    const destination = await readDestination(
      rpc,
      options.wallet,
      entry.mint,
      tokenProgram,
    );
    const minimumRent = destination.exists
      ? 0n
      : rpcLamports(
          await rpc.getMinimumBalanceForRentExemption(
            tokenProgram.equals(EXTERNAL_IDS.token2022)
              ? ACCOUNT_SIZES.vaultToken2022
              : ACCOUNT_SIZES.vaultSpl,
            "confirmed",
          ),
        );
    const rent =
      minimumRent > destination.lamports
        ? minimumRent - destination.lamports
        : 0n;
    destinations.set(entry.mint.toBase58(), {
      ...destination,
      mint: entry.mint,
      tokenProgram,
      rent,
    });
  }
  const built = buildTakeBackTransactions(webDeployment().programId, {
    ...options,
    entries: sorted.map((entry) => ({
      ...entry,
      tokenProgram: destinations.get(entry.mint.toBase58())!.tokenProgram,
    })),
  });
  const refunds = await projectedTakeBackRefunds(rpc, snapshot, sorted);
  const batches: PreparedTakeBack[] = [];
  const created = new Set<string>();
  const received = new Map<string, bigint>();
  let offset = 0;
  let previousNet = 0n;
  for (const transaction of built) {
    const instructions =
      transaction instanceof Transaction
        ? transaction.instructions
        : TransactionMessage.decompile(transaction.message, {
            addressLookupTableAccounts: options.lut ? [options.lut] : [],
          }).instructions;
    const count = instructions.filter((ix) =>
      ix.programId.equals(webDeployment().programId),
    ).length;
    const entries = sorted.slice(offset, offset + count);
    offset += count;
    const balances: TakeBackBalance[] = [];
    let ataRentLamports = 0n;
    let ataAccounts = 0;
    let refundLamports = 0n;
    const inBatch = new Set<string>();
    for (const entry of entries) {
      const key = entry.mint.toBase58();
      const destination = destinations.get(key)!;
      if (!inBatch.has(key)) {
        balances.push({
          ...destination,
          amount: destination.amount + (received.get(key) ?? 0n),
        });
        inBatch.add(key);
      }
      if (!created.has(key)) {
        ataRentLamports += destination.rent;
        if (!destination.exists) ataAccounts++;
        created.add(key);
      }
      received.set(key, (received.get(key) ?? 0n) + entry.amount);
      refundLamports += refunds.get(entry.deckIndex) ?? 0n;
    }
    const message =
      transaction instanceof Transaction
        ? transaction.compileMessage()
        : transaction.message;
    const fee = (await rpc.getFeeForMessage(message, "confirmed")).value;
    if (fee === null) throw new Error("Transaction fee unavailable");
    const debit = rpcLamports(fee) + ataRentLamports;
    // Include preceding batches when checking the final balance, without changing
    // the program's per-credit check. A fresh simulation remains authoritative.
    const adjustedDebit = debit - previousNet;
    const payeeRent = await precheckPayeeRent(rpc, {
      address: options.wallet,
      instruction: "takeBack",
      debitLamports: adjustedDebit > 0n ? adjustedDebit : 0n,
      incomingLamports:
        refundLamports + (adjustedDebit < 0n ? -adjustedDebit : 0n),
    });
    if (!payeeRent.ready) throw new EngineError("errors.payeeBelowRent");
    batches.push({
      transaction,
      entries,
      balances,
      ataRentLamports,
      ataAccounts,
      refundLamports,
      payeeRent,
    });
    previousNet += refundLamports - debit;
  }
  return { batches, missing: resolved.missing, snapshot };
}

export type TakeBackReconciliation = "landed" | "pending" | "pulled";

/** A vanished entry alone never proves that a take-back reached the wallet. */
export async function reconcileTakeBack(
  rpc: TakeBackRpc,
  wallet: PublicKey,
  batch: Pick<PreparedTakeBack, "entries" | "balances">,
): Promise<TakeBackReconciliation> {
  const snapshot = await readDeckSelection(rpc, wallet, batch.entries);
  const resolved = resolveDeckEntries(batch.entries, snapshot.entries);
  if (resolved.entries.length) return "pending";
  for (const baseline of batch.balances) {
    const current = await readDestination(
      rpc,
      wallet,
      baseline.mint,
      baseline.tokenProgram,
    );
    const expected = batch.entries
      .filter((entry) => entry.mint.equals(baseline.mint))
      .reduce((sum, entry) => sum + entry.amount, 0n);
    if (current.amount < baseline.amount + expected) return "pulled";
  }
  return "landed";
}
