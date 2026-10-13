import { ACCOUNT_SIZES, SEASON } from "@onepercent/config";
import type { PublicKey } from "@solana/web3.js";
import { FINAL_CLAIM_FLAGS, PHASE } from "../constants.js";
import { finalShares } from "../math/finalPull.js";
import {
  buildClaimFinalSolTransaction,
  buildClaimFinalTokensTransaction,
  buildStartFinalPullTransaction,
} from "../tx/finalClaims.js";
import { readBinder, readMachine, readPayees } from "./discover.js";
import { readClock } from "./clock.js";
import { readRentMinimum } from "./plan-deck.js";
import { planRedeem } from "./plan-cards.js";
import type { RescueAction, RescuePlan, RescuePlanOptions } from "./compose.js";

const empty = (): RescuePlan => ({ transactions: [], remaining: [] });
const blocked = (
  action: RescueAction,
  address: PublicKey,
  reason: string,
): RescuePlan => ({
  transactions: [],
  remaining: [{ action, address: address.toBase58(), reason }],
});

/** Only RPC account reads and chain time are needed to start the Final Pull. */
export async function planStartFinalPull(
  options: RescuePlanOptions,
): Promise<RescuePlan> {
  const [machine, clock] = await Promise.all([
    readMachine(options.rpc, options.programId),
    readClock(options.rpc),
  ]);
  if (machine.phase >= PHASE.finalPull) return empty();
  let reason: string | undefined;
  const due = machine.end_ts + BigInt(SEASON.finalPullDelaySeconds);
  if (machine.phase !== PHASE.buysClosed)
    reason = "WrongPhase: advance the season to Buys Closed first";
  else if (machine.end_ts === 0n)
    reason = "WrongPhase: the season end timestamp is not set";
  else if (clock.unixTimestamp < due)
    reason = `FinalPullNotDue: retry at chain timestamp ${due}`;
  else if (machine.pending_pulls !== 0n)
    reason = "PullPending: pending Pulls must reveal or refund first";
  else if (machine.exec.kind !== 0)
    reason = "ExecInFlight: retry once the exec trade has ended";
  if (reason) return blocked("start-final-pull", machine.address, reason);
  return {
    transactions: [
      {
        action: "start-final-pull",
        addresses: [machine.address.toBase58()],
        slot: Math.max(machine.slot, clock.slot),
        details: [{ from: PHASE.buysClosed, to: PHASE.finalPull }],
        transaction: buildStartFinalPullTransaction(options.programId, options),
      },
    ],
    remaining: [],
  };
}

async function claimState(
  options: RescuePlanOptions,
  owner: PublicKey,
  skipNoSpend = false,
) {
  // Checking the Binder first preserves the absent-account no-op without a Machine read.
  const binder = await readBinder(options.rpc, options.programId, owner);
  if (!binder || (skipNoSpend && binder.season_spend === 0n)) return null;
  const machine = await readMachine(options.rpc, options.programId);
  return { binder, machine };
}

function claimPhase(
  state: NonNullable<Awaited<ReturnType<typeof claimState>>>,
  action: RescueAction,
): RescuePlan | undefined {
  if (
    state.machine.phase !== PHASE.finalPull &&
    state.machine.phase !== PHASE.done
  )
    return blocked(
      action,
      state.binder.address,
      "WrongPhase: Final Pull claims open after start_final_pull",
    );
  return undefined;
}

/** The fee payer may push SOL to another Binder's owner without that owner's signature. */
export async function planClaimFinalSol(
  options: RescuePlanOptions & { owner?: PublicKey },
): Promise<RescuePlan> {
  const owner = options.owner ?? options.wallet;
  const state = await claimState(options, owner);
  if (!state || (state.binder.flags & FINAL_CLAIM_FLAGS.sol) !== 0)
    return empty();
  const phase = claimPhase(state, "claim-final-sol");
  if (phase) return phase;
  const [payee] = await readPayees(options.rpc, [owner]);
  return {
    transactions: [
      {
        action: "claim-final-sol",
        addresses: [state.binder.address.toBase58()],
        slot: Math.max(state.binder.slot, state.machine.slot, payee!.slot),
        details: [
          {
            amount: finalShares(state.machine, state.binder).sol,
            recipient: owner,
          },
        ],
        transaction: buildClaimFinalSolTransaction(options.programId, {
          ...options,
          owner,
          ownerWritable: !payee!.executable,
        }),
      },
    ],
    remaining: [],
  };
}

export async function planClaimFinalTokens(
  options: RescuePlanOptions,
): Promise<RescuePlan> {
  const state = await claimState(options, options.wallet);
  if (!state || (state.binder.flags & FINAL_CLAIM_FLAGS.tokens) !== 0)
    return empty();
  const phase = claimPhase(state, "claim-final-tokens");
  if (phase) return phase;
  const capacity = await tokenClaimBlocker(options, state);
  if (capacity) return capacity;
  return {
    transactions: [
      {
        action: "claim-final-tokens",
        addresses: [state.binder.address.toBase58()],
        slot: Math.max(state.binder.slot, state.machine.slot),
        details: tokenDetails(state),
        transaction: buildClaimFinalTokensTransaction(
          options.programId,
          options,
        ),
      },
    ],
    remaining: [],
  };
}

function tokenDetails(
  state: NonNullable<Awaited<ReturnType<typeof claimState>>>,
) {
  const shares = finalShares(state.machine, state.binder);
  return [
    ...(shares.onePct > 0n
      ? [
          {
            mint: state.machine.token_mint,
            amount: shares.onePct,
            kind: 8,
            recipient: state.binder.owner,
          },
        ]
      : []),
    ...shares.buckets.flatMap((amount, index) =>
      amount > 0n
        ? [
            {
              mint: state.machine.buckets[index]!.mint,
              amount,
              kind: 8,
              recipient: state.binder.owner,
            },
          ]
        : [],
    ),
  ];
}

async function tokenClaimBlocker(
  options: RescuePlanOptions,
  state: NonNullable<Awaited<ReturnType<typeof claimState>>>,
): Promise<RescuePlan | undefined> {
  const count = tokenDetails(state).length;
  if (count === 0) return undefined;
  const { binder } = state;
  const free = Math.max(0, binder.cap - binder.len - binder.reserved);
  const cap = binder.cap + Math.max(0, count - free);
  if (cap > 65_535 || binder.reserved + count > 65_535)
    return blocked(
      "claim-final-tokens",
      binder.address,
      "BinderFull: Redeem existing cards, then retry the Final Pull token claim",
    );
  if (cap === binder.cap) return undefined;
  const [rent, payees] = await Promise.all([
    readRentMinimum(options),
    readPayees(options.rpc, [options.wallet]),
  ]);
  const floor =
    rent(ACCOUNT_SIZES.binderHeader + ACCOUNT_SIZES.cardSlot * cap) +
    binder.sol_owed;
  const required =
    floor > binder.accountLamports ? floor - binder.accountLamports : 0n;
  if (payees[0]!.lamports < required)
    return blocked(
      "claim-final-tokens",
      binder.address,
      `Final card slots need ${required} lamports of rent; Redeem existing cards or add at least ${required - payees[0]!.lamports} lamports, plus transaction fees, then retry`,
    );
  return undefined;
}

/** Claims precede Redeem. SOL lands first so token-slot rent cannot prevent its exit. */
export async function planFinalClaims(
  options: RescuePlanOptions,
): Promise<RescuePlan> {
  const state = await claimState(options, options.wallet, true);
  if (!state || (state.binder.flags & 3) === 3) return empty();
  const phase = claimPhase(state, "final-claims");
  if (phase) return phase;
  const plan =
    (state.binder.flags & FINAL_CLAIM_FLAGS.sol) === 0
      ? await planClaimFinalSol(options)
      : await planClaimFinalTokens(options);
  if (
    plan.transactions.length === 0 &&
    plan.remaining.length > 0 &&
    state.binder.len > 0
  ) {
    // Confirm existing card exits, then re-read this stage before materializing Final cards.
    const redeem = await planRedeem(options);
    if (redeem.transactions.length > 0) return redeem;
  }
  return {
    transactions: plan.transactions.map((row) => ({
      ...row,
      action: "final-claims",
    })),
    remaining: plan.remaining.map((row) => ({
      ...row,
      action: "final-claims",
    })),
  };
}
