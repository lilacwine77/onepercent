import { SEASON } from "@onepercent/config";
import { advancePhaseInstruction } from "../ix/index.js";
import { transaction } from "../tx/index.js";
import { readConfig, readMachine } from "./discover.js";
import { readClock } from "./clock.js";
import type { RescuePlan, RescuePlanOptions } from "./compose.js";

export const PHASE_NAMES = [
  "Setup",
  "Stock-Up",
  "Powered On",
  "On Air",
  "Buys Closed",
  "Final Pull",
  "Done",
] as const;

export interface PhaseCrankInput {
  config: { season_set: number; stock_up_ts: bigint };
  machine: {
    phase: number;
    on_air_ts: bigint;
    end_ts: bigint;
    final_ts: bigint;
  };
  now: bigint;
}
export type PhaseCrankState =
  | { due: true; from: number; to: number }
  | { due: false; from: number; at?: bigint; reason: string };

/** The same transition table as advance_phase, evaluated on chain time. */
export function phaseCrankState({
  config,
  machine,
  now,
}: PhaseCrankInput): PhaseCrankState {
  const from = machine.phase;
  const wait = (at: bigint, next: number): PhaseCrankState => ({
    due: false,
    from,
    at,
    reason: `NoTransitionDue: ${PHASE_NAMES[next]} is due at chain timestamp ${at}`,
  });
  const none = (reason: string): PhaseCrankState => ({
    due: false,
    from,
    reason: `NoTransitionDue: ${reason}`,
  });
  switch (from) {
    case 0:
      if (config.season_set !== 1) return none("the season is not set yet");
      return now >= config.stock_up_ts
        ? { due: true, from, to: 1 }
        : wait(config.stock_up_ts, 1);
    case 1:
      return none("Powered On follows the launch operation, not a crank");
    case 2:
      if (machine.on_air_ts === 0n) return none("On Air has no time yet");
      return now >= machine.on_air_ts
        ? { due: true, from, to: 3 }
        : wait(machine.on_air_ts, 3);
    case 3:
      if (machine.end_ts === 0n) return none("the season end has no time yet");
      return now >= machine.end_ts
        ? { due: true, from, to: 4 }
        : wait(machine.end_ts, 4);
    case 4:
      return none(
        "the Final Pull opens with start_final_pull, which ships with the Final Pull upgrade (D18)",
      );
    case 5: {
      if (machine.final_ts === 0n) return none("the Final Pull has no time");
      const at = machine.final_ts + BigInt(SEASON.sealDelaySeconds);
      return now >= at ? { due: true, from, to: 6 } : wait(at, 6);
    }
    default:
      return none("the season is Done");
  }
}

export async function readPhaseCrank(
  options: Pick<RescuePlanOptions, "rpc" | "programId">,
) {
  const [config, machine, clock] = await Promise.all([
    readConfig(options.rpc, options.programId),
    readMachine(options.rpc, options.programId),
    readClock(options.rpc),
  ]);
  return {
    slot: Math.max(config.slot, machine.slot, clock.slot),
    execInFlight: machine.exec.kind !== 0,
    state: phaseCrankState({
      config: config.config,
      machine,
      now: clock.unixTimestamp,
    }),
  };
}

/** Permissionless: any fee payer may advance a due phase, whatever the pause bits. */
export async function planAdvancePhase(
  options: RescuePlanOptions,
): Promise<RescuePlan> {
  const { slot, execInFlight, state } = await readPhaseCrank(options);
  const address = options.programId.toBase58();
  if (!state.due)
    return {
      transactions: [],
      remaining: [{ action: "advance-phase", address, reason: state.reason }],
    };
  if (execInFlight)
    return {
      transactions: [],
      remaining: [
        {
          action: "advance-phase",
          address,
          reason:
            "ExecInFlight: an exec trade is open; retry once it has ended",
        },
      ],
    };
  return {
    transactions: [
      {
        action: "advance-phase",
        addresses: [address],
        // The source phase keeps consecutive transitions distinct.
        indices: [state.from],
        slot,
        details: [{ from: state.from, to: state.to }],
        transaction: transaction(
          { wallet: options.wallet, blockhash: options.blockhash },
          [advancePhaseInstruction(options.programId)],
        ),
      },
    ],
    remaining: [],
  };
}
