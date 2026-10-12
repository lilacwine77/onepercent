import { expect, it, vi } from "vitest";
import { Connection } from "@solana/web3.js";
import { decodeMachine, encodeMachine, encodeConfig } from "@onepercent/sdk";
import { StockChain } from "./chain.js";
import { collectQuotes } from "./runtime.js";
import { stockRequests } from "./planner.js";
import { fixture } from "./testing.js";

it.each([
  "revealed",
  "pending",
  "last_reveal_ts",
  "unsettled_reveals",
  "sb_paid_prev_hour",
  "bucket_history",
  "stock_sol",
  "jackpot_sol",
  "burn_sol",
  "team_sol",
  "final_pool_sol",
  "config",
  "slot",
])(
  "rejects %s changes in the last evidence read and requires a fresh plan",
  async (change) => {
    const f = fixture();
    f.state.machine.stock_sol = 6_000_000_000n;
    f.state.slot = 100;
    const machine = { ...decodeMachine(encodeMachine(f.state.machine)) };
    const config = { ...f.state.config };
    const account = (
      data: Uint8Array,
      owner = f.state.deployment.programId,
    ) => ({
      owner,
      data: Buffer.from(data),
      lamports: Number(f.readings.machineLamports),
      executable: false,
      rentEpoch: 0,
    });
    let slot = 101;
    const multiple = vi.fn(async () => ({
      context: { slot },
      value: [
        account(f.readings.ledger.data, f.readings.ledger.owner),
        account(f.readings.vault.data, f.readings.vault.owner),
        account(f.readings.src.data, f.readings.src.owner),
        null,
        account(encodeMachine(machine)),
        account(encodeConfig(config)),
      ],
    }));
    const chain = new StockChain(
      {
        getMultipleAccountsInfoAndContext: multiple,
        getMinimumBalanceForRentExemption: async () => 1,
      } as unknown as Connection,
      f.state.deployment,
    );
    vi.spyOn(chain, "read").mockImplementation(async (key) => {
      const reading = [f.readings.mint, ...f.readings.oracles].find((r) =>
        r.address.equals(key),
      );
      // Sponsored oracle addresses are derived from the configured feed.
      return reading ?? f.readings.oracles[0];
    });
    const request = stockRequests(f.state, f.now)[0]!;
    expect(request.amount).toBe(5_000_000_000n);
    await expect(chain.evidence(f.state, request)).resolves.toHaveProperty(
      "args",
    );
    if (change === "revealed") machine.packs_revealed[0] = 1n;
    else if (change === "pending") machine.pending_pulls = 1n;
    else if (change === "bucket_history")
      machine.bucket_history[0] = {
        ...machine.bucket_history[0]!,
        sb_inflow_hour: 1n,
      };
    else if (change === "config") config.admin_paused = 8;
    else if (change === "slot") slot = 99;
    else machine[change as "stock_sol"] += 1n;
    // The Pull can already have been settled and closed; only Machine records it.
    await expect(chain.evidence(f.state, request)).rejects.toThrow(
      "stock_snapshot_changed",
    );
    const swap = { quoteBuy: vi.fn(), quoteSell: vi.fn() };
    expect(
      await collectQuotes(
        chain,
        f.state,
        f.now,
        swap as unknown as Parameters<typeof collectQuotes>[3],
        () => {},
      ),
    ).toEqual([]);
    expect(swap.quoteBuy).not.toHaveBeenCalled();
    expect(multiple).toHaveBeenCalledWith(expect.any(Array), {
      commitment: "confirmed",
      minContextSlot: 100,
    });
  },
);
