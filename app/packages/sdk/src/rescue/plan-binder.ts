import {
  buildCloseBinderTransaction,
  buildWithdrawOwedTransaction,
} from "../tx/binder.js";
import { readBinder, type RescueBinder } from "./discover.js";
import { readRentMinimum } from "./plan-deck.js";
import type { RescuePlan, RescuePlanOptions } from "./compose.js";

/** The owner-signed exits read only the Binder PDA: no scan, phase or pause bit. */
export async function planWithdrawOwed(
  options: RescuePlanOptions,
): Promise<RescuePlan> {
  const binder = await readBinder(
    options.rpc,
    options.programId,
    options.wallet,
  );
  if (!binder || binder.sol_owed === 0n)
    return { transactions: [], remaining: [] };
  const rent = await readRentMinimum(options);
  // withdraw_owed pays min(sol_owed, balance above the Binder's own rent).
  const free = binder.accountLamports - rent(binder.dataLength);
  const pay = free <= 0n ? 0n : free < binder.sol_owed ? free : binder.sol_owed;
  if (pay === 0n)
    return {
      transactions: [],
      remaining: [
        {
          action: "withdraw-owed",
          address: binder.address.toBase58(),
          reason: `${binder.sol_owed} lamports are owed, but the Binder holds nothing above its rent yet; retry later`,
        },
      ],
    };
  return {
    transactions: [
      {
        action: "withdraw-owed",
        addresses: [binder.address.toBase58()],
        slot: binder.slot,
        details: [{ amount: pay, recipient: options.wallet }],
        transaction: buildWithdrawOwedTransaction(options.programId, {
          wallet: options.wallet,
          blockhash: options.blockhash,
        }),
      },
    ],
    remaining: [],
  };
}

/** Mirrors close_binder's checks so the plan names the missing step. */
export function closeBinderBlocker(binder: RescueBinder): string | undefined {
  if (binder.len > 0)
    return `BinderNotEmpty: Redeem the ${binder.len} remaining card(s) first`;
  if (binder.fresh_in_deck > 0)
    return `BinderNotEmpty: ${binder.fresh_in_deck} FRESH card(s) still count in the Deck or in an unsettled Pull; take back or settle them first`;
  if (binder.sol_owed > 0n)
    return "BinderNotEmpty: withdraw the owed SOL first";
  if (binder.reserved > 0)
    return "PullPending: a Pull is still open; refund it after its timeout or settle it after its reveal";
  if (binder.season_spend > 0n && (binder.flags & 3) !== 3)
    return "FinalNotClaimed: complete both Final Pull claims before closing My cards";
  return undefined;
}

export async function planCloseBinder(
  options: RescuePlanOptions,
): Promise<RescuePlan> {
  const binder = await readBinder(
    options.rpc,
    options.programId,
    options.wallet,
  );
  // An absent Binder is already closed (close_binder is a no-op for it).
  if (!binder) return { transactions: [], remaining: [] };
  const reason = closeBinderBlocker(binder);
  if (reason)
    return {
      transactions: [],
      remaining: [
        {
          action: "close-binder",
          address: binder.address.toBase58(),
          reason,
        },
      ],
    };
  return {
    transactions: [
      {
        action: "close-binder",
        addresses: [binder.address.toBase58()],
        slot: binder.slot,
        details: [
          { amount: binder.accountLamports, recipient: options.wallet },
        ],
        transaction: buildCloseBinderTransaction(options.programId, {
          wallet: options.wallet,
          blockhash: options.blockhash,
        }),
      },
    ],
    remaining: [],
  };
}
