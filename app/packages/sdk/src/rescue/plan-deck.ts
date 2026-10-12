import { Buffer } from "buffer";
import { PublicKey, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { ACCOUNT_SIZES } from "@onepercent/config";
import { deckHeaderLayout } from "../layouts.js";
import { buildTakeBackTransactions } from "../tx/index.js";
import {
  findDeckEntries,
  readMints,
  readPayees,
  rescuePda,
  rpcCall,
} from "./discover.js";
import {
  selectionIndices,
  type RescuePlan,
  type RescuePlanOptions,
} from "./compose.js";

export interface DeckSelection {
  deckIndex: number;
  mint: PublicKey;
  amount: bigint;
  flags: number;
  deposit: number;
}

/** Rent comes from the current sysvar, including changed exemption thresholds. */
export async function readRentMinimum(
  options: Pick<RescuePlanOptions, "rpc">,
): Promise<(size: number) => bigint> {
  const result = await rpcCall(() =>
    options.rpc.getAccountInfoAndContext(SYSVAR_RENT_PUBKEY, {
      commitment: "confirmed",
    }),
  );
  if (
    !result.value ||
    result.value.executable ||
    !result.value.owner.equals(
      new PublicKey("Sysvar1111111111111111111111111111111111111"),
    ) ||
    result.value.data.length !== 17
  )
    throw new Error("Rent sysvar is unavailable");
  const bytes = Buffer.from(result.value.data);
  const rate = bytes.readBigUInt64LE(0);
  const threshold = bytes.readDoubleLE(8);
  if (!Number.isFinite(threshold) || threshold < 0)
    throw new Error("Invalid Rent exemption threshold");
  return (size) => {
    // Solana's ACCOUNT_STORAGE_OVERHEAD is a layout constant, not a rent rate.
    const value = Number(BigInt(size + 128) * rate) * threshold;
    if (!Number.isSafeInteger(Math.trunc(value)))
      throw new Error("Rent value exceeds the exact integer range");
    return BigInt(Math.trunc(value));
  };
}

export async function planTakeBack(
  options: RescuePlanOptions & {
    indices?: readonly number[];
    expected?: readonly DeckSelection[];
  },
): Promise<RescuePlan> {
  const fresh = await findDeckEntries(
    options.rpc,
    options.programId,
    options.wallet,
  );
  const indices =
    options.indices === undefined
      ? fresh.map((entry) => entry.deckIndex)
      : selectionIndices(options.indices, 0);
  const remaining: RescuePlan["remaining"] = [];
  const entries = indices
    .flatMap((deckIndex) => {
      const entry = fresh.find(
        (candidate) => candidate.deckIndex === deckIndex,
      );
      const expected = options.expected?.find(
        (item) => item.deckIndex === deckIndex,
      );
      if (
        !entry ||
        (options.expected !== undefined && !expected) ||
        (expected &&
          (!expected.mint.equals(entry.mint) ||
            expected.amount !== entry.amount ||
            expected.flags !== entry.flags ||
            expected.deposit !== entry.deposit))
      ) {
        remaining.push({
          action: "take-back",
          address: String(deckIndex),
          reason:
            "CardMoved: the selected Deck entry changed; select it again from a fresh scan",
        });
        return [];
      }
      return [entry];
    })
    .sort((a, b) => b.deckIndex - a.deckIndex);
  if (!entries.length) return { transactions: [], remaining };
  const [rent, ownerRows, deckAccount, mints] = await Promise.all([
    readRentMinimum(options),
    readPayees(options.rpc, [options.wallet]),
    rpcCall(() =>
      options.rpc.getAccountInfoAndContext(
        rescuePda(options.programId, "deck")[0],
        {
          commitment: "confirmed",
          dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
        },
      ),
    ),
    readMints(
      options.rpc,
      entries.map((entry) => entry.mint),
    ),
  ]);
  if (!deckAccount.value || !deckAccount.value.owner.equals(options.programId))
    throw new Error("Deck is unavailable");
  const header = deckHeaderLayout.decode(deckAccount.value.data);
  if (
    !Number.isSafeInteger(deckAccount.value.lamports) ||
    deckAccount.value.lamports < 0
  )
    throw new Error("Invalid Deck lamport balance");
  let deckBalance = BigInt(deckAccount.value.lamports);
  let ownerBalance = ownerRows[0]!.lamports;
  let len = header.len;
  let cap = header.cap;
  const ownerMinimum = rent(ownerRows[0]!.dataLength);
  for (const entry of entries) {
    len--;
    const nextMinimum = rent(
      ACCOUNT_SIZES.deckHeader + ACCOUNT_SIZES.deckEntry * len,
    );
    if (len < cap && deckBalance >= nextMinimum) cap = len;
    const minimum = rent(
      ACCOUNT_SIZES.deckHeader + ACCOUNT_SIZES.deckEntry * cap,
    );
    const available = deckBalance > minimum ? deckBalance - minimum : 0n;
    const refund =
      available < BigInt(entry.deposit) ? available : BigInt(entry.deposit);
    if (refund > 0n && ownerBalance + refund < ownerMinimum) {
      remaining.push({
        action: "take-back",
        address: String(entry.deckIndex),
        reason: `PayeeBelowRent: add at least ${ownerMinimum - ownerBalance - refund} lamports to ${options.wallet.toBase58()}, plus transaction fees and any destination account rent, then retry`,
      });
      return { transactions: [], remaining };
    }
    deckBalance -= refund;
    ownerBalance += refund;
  }
  const transactions = buildTakeBackTransactions(options.programId, {
    wallet: options.wallet,
    blockhash: options.blockhash,
    entries: entries.map((entry) => ({
      ...entry,
      tokenProgram: mints.find((mint) => mint.address.equals(entry.mint))!
        .tokenProgram,
    })),
  });
  return {
    transactions: transactions.map((built) => {
      if (!(built instanceof Transaction))
        throw new Error("Unexpected versioned rescue transaction");
      const indices = built.instructions
        .filter((ix) => ix.programId.equals(options.programId))
        .map((ix) => ix.data.readUInt32LE(8));
      return {
        transaction: built,
        action: "take-back",
        addresses: [options.wallet.toBase58()],
        slot: Math.max(
          deckAccount.context.slot,
          ...entries.map((entry) => entry.slot),
          ...mints.map((mint) => mint.slot),
        ),
        indices,
        details: indices.map((index) => {
          const entry = entries.find((row) => row.deckIndex === index)!;
          return {
            index,
            mint: entry.mint,
            amount: entry.amount,
            recipient: options.wallet,
          };
        }),
      };
    }),
    remaining,
  };
}
