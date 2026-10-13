import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TX_LIMITS, VRF } from "@onepercent/config";
import {
  closeVaultInstruction,
  type Payee,
  type SettleInput,
} from "../ix/index.js";
import { RESERVED_KEYS } from "../constants.js";
import {
  buildRefundTransaction,
  buildSettleTransaction,
  serializedSize,
  transaction,
  type BuiltTransaction,
} from "../tx/index.js";
import {
  findClosableVaults,
  findMyVaultDeposits,
  findOwnPulls,
  findPullsPaying,
  readBinder,
  readPayees,
  readPull,
  readVaultDeposit,
  type RescueRpc,
} from "./discover.js";
import { readClock } from "./clock.js";
import { planTakeBack, readRentMinimum } from "./plan-deck.js";
import { planRedeem } from "./plan-cards.js";
import { planCloseBinder, planWithdrawOwed } from "./plan-binder.js";
import { planFinalClaims } from "./plan-final.js";

export * from "./discover.js";
export * from "./clock.js";
export * from "./plan-deck.js";
export * from "./plan-cards.js";
export * from "./plan-binder.js";
export * from "./plan-crank.js";
export * from "./plan-final.js";

export type RescueAction =
  | "take-back"
  | "redeem"
  | "settle"
  | "refund"
  | "close-vault"
  | "final-claims"
  | "withdraw-owed"
  | "close-binder"
  | "advance-phase"
  | "start-final-pull"
  | "claim-final-sol"
  | "claim-final-tokens";
export interface RescuePlanOptions {
  rpc: RescueRpc;
  programId: PublicKey;
  wallet: PublicKey;
  blockhash: string;
}
export interface RescueTransaction {
  transaction: BuiltTransaction;
  action: RescueAction;
  addresses: string[];
  indices?: number[];
  slot?: number;
  details?: readonly {
    mint?: PublicKey;
    amount?: bigint;
    index?: number;
    kind?: number;
    recipient?: PublicKey;
    seq?: bigint;
    pack?: number;
    from?: number;
    to?: number;
  }[];
}
export interface RescueRemaining {
  action: RescueAction;
  address?: string;
  reason: string;
}
export interface RescuePlan {
  transactions: RescueTransaction[];
  remaining: RescueRemaining[];
}
export class RescuePreconditionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RescuePreconditionError";
    this.code = code;
  }
}

export function selectionIndices(
  indices: readonly number[] | undefined,
  length: number,
): number[] {
  const result =
    indices === undefined
      ? Array.from({ length }, (_, index) => index)
      : [...indices];
  if (result.some((index) => !Number.isSafeInteger(index) || index < 0))
    throw new RescuePreconditionError(
      "invalid_index",
      "Exit indices must be non-negative integers",
    );
  if (new Set(result).size !== result.length)
    throw new RescuePreconditionError(
      "duplicate_index",
      "Exit indices must be unique",
    );
  return result.sort((a, b) => b - a);
}

function unique(keys: readonly PublicKey[]): PublicKey[] {
  return [...new Map(keys.map((key) => [key.toBase58(), key])).values()];
}

/** Each Pull is re-read; a previous discovery is only an address selection. */
export async function planSettle(
  options: RescuePlanOptions & { pulls: readonly PublicKey[] },
): Promise<RescuePlan> {
  const result: RescuePlan = { transactions: [], remaining: [] };
  for (const address of unique(options.pulls)) {
    const pull = await readPull(options.rpc, options.programId, address);
    if (!pull) continue;
    if (pull.status !== 2) {
      result.remaining.push({
        action: "settle",
        address: address.toBase58(),
        reason: "PullNotRevealed: this Pull is still pending",
      });
      continue;
    }
    const rows = await readPayees(
      options.rpc,
      unique([
        pull.buyer,
        pull.referrer,
        ...pull.packs.flatMap((pack) =>
          pack.royalties.map((royalty) => royalty.depositor),
        ),
      ]),
    );
    const payee = (key: PublicKey): Payee => ({
      address: key,
      executable: rows.find((row) => row.address.equals(key))!.executable,
    });
    const packs: SettleInput[] = pull.packs.flatMap((pack, packIndex) => {
      if (pull.settled_mask & (1 << packIndex)) return [];
      const wallets = pack.royalties.map((royalty, index) =>
        pack.house_mask & (1 << index) ? null : payee(royalty.depositor),
      ) as unknown as SettleInput["wallets"];
      return [
        {
          pull: address,
          seq: pull.seq,
          pack: packIndex,
          buyer: payee(pull.buyer),
          referrer: pull.referrer.equals(PublicKey.default)
            ? undefined
            : payee(pull.referrer),
          wallets,
        },
      ];
    });
    while (packs.length) {
      let built: BuiltTransaction | undefined;
      let count = Math.min(TX_LIMITS.settlePacksPerTx, packs.length);
      for (; count > 0; count--) {
        try {
          built = buildSettleTransaction(options.programId, {
            wallet: options.wallet,
            blockhash: options.blockhash,
            packs: packs.slice(0, count),
          });
          break;
        } catch (error) {
          if (!(error instanceof RangeError) || count === 1) throw error;
        }
      }
      if (!built) throw new Error("Unable to build a settle transaction");
      const batch = packs.splice(0, count);
      result.transactions.push({
        action: "settle",
        transaction: built,
        addresses: [address.toBase58()],
        slot: Math.max(pull.slot, ...rows.map((row) => row.slot)),
        indices: batch.map((pack) => pack.pack),
        details: batch.map((pack) => ({
          seq: pack.seq,
          pack: pack.pack,
          recipient: pack.buyer.address,
        })),
      });
    }
  }
  return result;
}

export async function planRefund(
  options: RescuePlanOptions & { pulls: readonly PublicKey[] },
): Promise<RescuePlan> {
  const clock = await readClock(options.rpc);
  const result: RescuePlan = { transactions: [], remaining: [] };
  for (const address of unique(options.pulls)) {
    const pull = await readPull(options.rpc, options.programId, address);
    if (!pull) continue;
    if (pull.status !== 1) {
      result.remaining.push({
        action: "refund",
        address: address.toBase58(),
        reason: "This Pull is revealed; settle it instead",
      });
      continue;
    }
    const due = pull.created_ts + BigInt(VRF.timeoutSeconds);
    if (clock.unixTimestamp < due) {
      result.remaining.push({
        action: "refund",
        address: address.toBase58(),
        reason: `TooEarlyToRefund: retry at chain timestamp ${due}`,
      });
      continue;
    }
    const buyer = (await readPayees(options.rpc, [pull.buyer]))[0]!;
    result.transactions.push({
      action: "refund",
      addresses: [address.toBase58()],
      slot: Math.max(clock.slot, pull.slot, buyer.slot),
      details: [{ seq: pull.seq, recipient: pull.buyer }],
      transaction: buildRefundTransaction(options.programId, {
        wallet: options.wallet,
        blockhash: options.blockhash,
        pull: address,
        seq: pull.seq,
        buyer,
      }),
    });
  }
  return result;
}

export async function planCloseVaults(
  options: RescuePlanOptions & {
    mints?: readonly PublicKey[];
    owner?: PublicKey;
  },
): Promise<RescuePlan> {
  const rows = options.mints
    ? (
        await Promise.all(
          unique(options.mints).map((mint) =>
            readVaultDeposit(options.rpc, options.programId, mint),
          ),
        )
      ).filter((row) => row !== null)
    : options.owner
      ? await findMyVaultDeposits(options.rpc, options.programId, options.owner)
      : await findClosableVaults(options.rpc, options.programId);
  const selected = options.mints
    ? rows.filter((row) => options.mints!.some((mint) => mint.equals(row.mint)))
    : rows;
  const result: RescuePlan = { transactions: [], remaining: [] };
  // A missing ledger is already closed; explicit mint selections reconcile to no work.
  if (!selected.length) return result;
  const [payees, rent] = await Promise.all([
    readPayees(
      options.rpc,
      selected.map((row) => row.payer),
    ),
    readRentMinimum(options),
  ]);
  let instructions: ReturnType<typeof closeVaultInstruction>[] = [];
  let addresses: string[] = [];
  const flush = () => {
    if (!instructions.length) return;
    result.transactions.push({
      action: "close-vault",
      addresses,
      details: addresses.map((address) => {
        const row = selected.find(
          (candidate) => candidate.mint.toBase58() === address,
        )!;
        return { mint: row.mint, recipient: row.payer };
      }),
      slot: Math.max(
        ...selected.map((row) => row.slot),
        ...payees.map((row) => row.slot),
      ),
      transaction: transaction(
        { wallet: options.wallet, blockhash: options.blockhash },
        instructions,
      ),
    });
    instructions = [];
    addresses = [];
  };
  for (const row of selected) {
    const payer = payees.find((payee) => payee.address.equals(row.payer))!;
    let reason: string | undefined;
    if (!row.closable)
      reason = "Comes back when that coin's vault is empty and unlisted";
    else if (
      !payer.owner.equals(SystemProgram.programId) ||
      payer.executable ||
      RESERVED_KEYS.has(payer.address.toBase58())
    )
      reason = "The stored vault payer is not a creditable System account";
    else {
      const minimum = rent(payer.dataLength);
      const after = payer.lamports + row.ledgerLamports + row.vaultLamports;
      if (after < minimum)
        reason = `PayeeBelowRent: add at least ${minimum - after} lamports to ${payer.address.toBase58()}, plus any fees if it is also the fee payer, then retry`;
    }
    if (reason) {
      result.remaining.push({
        action: "close-vault",
        address: row.mint.toBase58(),
        reason,
      });
      continue;
    }
    const ix = closeVaultInstruction(options.programId, {
      mint: row.mint,
      payer: row.payer,
      tokenProgram: row.mintInfo.tokenProgram,
    });
    if (
      serializedSize(
        transaction({ wallet: options.wallet, blockhash: options.blockhash }, [
          ...instructions,
          ix,
        ]),
      ) > TX_LIMITS.maxTxBytes
    )
      flush();
    instructions.push(ix);
    addresses.push(row.mint.toBase58());
  }
  flush();
  return result;
}

export const GET_EVERYTHING_BACK_ORDER = [
  "refund",
  "settle",
  "final-claims",
  "redeem",
  "take-back",
  "withdraw-owed",
  "close-binder",
  "close-vault",
] as const;
export type RescueStage = (typeof GET_EVERYTHING_BACK_ORDER)[number];
/** Callers may customize a stage while preserving confirmed stage ordering. */
export type RescueExtensions = Partial<
  Record<
    "final-claims" | "withdraw-owed" | "close-binder",
    (options: RescuePlanOptions) => Promise<RescuePlan>
  >
>;

export async function planEverythingBackStage(
  options: RescuePlanOptions,
  stage: RescueStage,
  extensions: RescueExtensions = {},
): Promise<RescuePlan> {
  const extension = extensions[stage as keyof RescueExtensions];
  if (extension) return extension(options);
  if (stage === "final-claims") return planFinalClaims(options);
  if (stage === "redeem") return planRedeem(options);
  if (stage === "take-back") return planTakeBack(options);
  if (stage === "withdraw-owed") return planWithdrawOwed(options);
  if (stage === "close-binder") return planCloseBinder(options);
  if (stage === "close-vault") {
    try {
      return await planCloseVaults({ ...options, owner: options.wallet });
    } catch (error) {
      if (isScanRefused(error))
        return {
          transactions: [],
          remaining: [
            {
              action: stage,
              reason:
                "rpc_scan_refused: vault deposits could not be listed; retry with an RPC that allows scans",
            },
          ],
        };
      throw error;
    }
  }
  const binder = await readBinder(
    options.rpc,
    options.programId,
    options.wallet,
  );
  if (stage === "refund" || stage === "settle") {
    const own = binder
      ? await findOwnPulls(
          options.rpc,
          options.programId,
          options.wallet,
          binder.pull_nonce,
        )
      : [];
    if (stage === "refund")
      return planRefund({
        ...options,
        pulls: own
          .filter((pull) => pull.status === 1)
          .map((pull) => pull.address),
      });
    let paying: Awaited<ReturnType<typeof findPullsPaying>> = [];
    const remaining: RescueRemaining[] = [];
    try {
      paying = await findPullsPaying(
        options.rpc,
        options.programId,
        options.wallet,
      );
    } catch (error) {
      if (!isScanRefused(error)) throw error;
      remaining.push({
        action: stage,
        reason:
          "rpc_scan_refused: Pulls paying this wallet could not be scanned; own Pulls remain available",
      });
    }
    const plan = await planSettle({
      ...options,
      pulls: [...own.filter((pull) => pull.status === 2), ...paying].map(
        (pull) => pull.address,
      ),
    });
    return {
      transactions: plan.transactions,
      remaining: [...remaining, ...plan.remaining],
    };
  }
  return { transactions: [], remaining: [] };
}

function isScanRefused(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("rpc_scan_refused") ||
      ("code" in error && error.code === "rpc_scan_refused"))
  );
}

/** Resume only after the previous stage has been confirmed and reconciled. */
export async function* composeEverythingBack(
  getOptions: () => Promise<RescuePlanOptions>,
  extensions: RescueExtensions = {},
): AsyncGenerator<{ stage: RescueStage; plan: RescuePlan }> {
  for (const stage of GET_EVERYTHING_BACK_ORDER)
    yield {
      stage,
      plan: await planEverythingBackStage(
        await getOptions(),
        stage,
        extensions,
      ),
    };
}
