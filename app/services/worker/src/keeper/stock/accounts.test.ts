import { expect, it, vi } from "vitest";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import type { ServiceRuntime } from "@onepercent/service-kit";
import {
  decodeMachine,
  encodeMachine,
  encodeConfig,
  encodePull,
  encodeBinder,
  pullHeaderLayout,
  configPda,
  machinePda,
  EXEC_KIND,
} from "@onepercent/sdk";
import { minOutMajor } from "@onepercent/sdk/server";
import { HIT_LIST, KEEPER_POLICY, SEASON, STOCK } from "@onepercent/config";
import { StockChain } from "./chain.js";
import { loadStockState } from "./runtime.js";
import {
  checkStockQuote,
  planStock,
  stockRequests,
  stockTargets,
} from "./planner.js";
import { fixture } from "./testing.js";

function scenario(now = 8100n) {
  const f = fixture();
  f.state.machine.end_ts = now + BigInt(SEASON.lastCallSeconds) + 1n;
  f.state.machine.hour_index = now / 3600n;
  f.state.machine.stock_hour_index = now / 3600n;
  f.state.machine.stock_sol = 6_000_000_000n;
  const id = f.state.deployment.programId;
  const wrap = (data: Uint8Array, lamports: number, owner = id) => ({
    data: Buffer.from(data),
    lamports,
    owner,
    executable: false,
    rentEpoch: 0,
  });
  let pulls: ReturnType<typeof wrap>[] = [],
    binders: ReturnType<typeof wrap>[] = [];
  let missing = false;
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(now, 32);
  const rpc = {
    getMultipleAccountsInfoAndContext: vi.fn(async () => ({
      context: { slot: 100 },
      value: [
        wrap(encodeConfig(f.state.config), 1),
        wrap(
          encodeMachine(f.state.machine),
          Number(f.state.machine.stock_sol) + 1,
        ),
        wrap(clock, 1),
      ],
    })),
    getMinimumBalanceForRentExemption: vi.fn(async () => 1),
    getProgramAccounts: vi.fn(
      async (
        _id: PublicKey,
        opts: { filters: { memcmp: { bytes: string } }[] },
      ) => {
        if (missing) throw new Error("account_rpc_unavailable");
        const isPull =
          opts.filters[0]!.memcmp.bytes ===
          pullHeaderLayout.encode({}).subarray(0, 8).toString("base64");
        return (isPull ? pulls : binders).map((account) => ({
          pubkey: id,
          account,
        }));
      },
    ),
    getAccountInfo: vi.fn(async (key: PublicKey) => {
      if (key.equals(SYSVAR_CLOCK_PUBKEY)) {
        const data = Buffer.alloc(40);
        data.writeBigInt64LE(now, 32);
        return wrap(data, 1);
      }
      const r = [f.readings.mint, f.readings.vault].find((r) =>
        r.address.equals(key),
      );
      if (!r || missing) return null;
      return wrap(r.data, 1, r.owner);
    }),
  };
  const query = vi.fn(async (sql: string) => {
    if (!sql.startsWith("SELECT state,plan FROM stock_plans"))
      throw new Error("non_journal_query");
    return { rows: [] };
  });
  const chain = new StockChain(
    rpc as unknown as Connection,
    f.state.deployment,
  );
  const read = async (delay: number = KEEPER_POLICY.revealDelaySecondsMin) => {
    const loaded = await loadStockState(
      chain,
      { query } as unknown as ServiceRuntime["pool"],
      delay,
    );
    loaded.state.buckets.get(0)!.failing = false; // Current public hit-list check passes.
    return loaded;
  };
  for (const oracle of f.readings.oracles.slice(0, 2))
    Buffer.from(
      oracle.data.buffer,
      oracle.data.byteOffset,
      oracle.data.byteLength,
    ).writeBigInt64LE(now, 93);
  const amount = 5_000_000_000n;
  const price = minOutMajor({
    amount,
    solPrice: 10_901_000_000n,
    solExponent: -8,
    tokenPrice: 85_000_000n,
    tokenExponent: -8,
    decimals: 6,
  });
  const quote = {
    kind: EXEC_KIND.stockBuy,
    bucket: 0,
    amount,
    reason: "anchor",
    args: { ...f.args, amount },
    readings: f.readings,
    outAmount: price.expected,
    minOut: price.minOut,
    impactBps: 0,
  };
  return {
    f,
    chain,
    rpc,
    query,
    read,
    now,
    quote,
    missing: () => {
      missing = true;
    },
    pull: (settled = false) => {
      pulls = [
        wrap(
          encodePull({
            qty: 1,
            status: 2,
            revealed_ts: now,
            settled_mask: settled ? 1 : 0,
          }),
          1,
        ),
      ];
    },
    owed: (funded: boolean) => {
      binders = [
        wrap(encodeBinder({ cap: 1, sol_owed: 10n }), funded ? 11 : 1),
      ];
    },
  };
}

it("uses the current balance after a payout even if the indexer omitted it", async () => {
  const s = scenario();
  expect(planStock((await s.read()).state, [s.quote], s.now)).toHaveLength(1);
  s.f.state.machine.stock_sol -= 4_000_000_000n;
  s.f.state.machine.sb_paid_hour = 4_000_000_000n;
  const { state } = await s.read();
  expect(state.spendableSol).toBe(2_000_000_000n);
  expect(planStock(state, [s.quote], s.now)).toEqual([]);
  expect(s.query).toHaveBeenCalledTimes(2);
  expect(s.rpc.getAccountInfo).toHaveBeenCalledWith(s.f.args.mint, {
    commitment: "confirmed",
    minContextSlot: 100,
  });
  expect(s.rpc.getMultipleAccountsInfoAndContext).toHaveBeenCalledWith(
    [
      configPda(s.f.state.deployment.programId)[0],
      machinePda(s.f.state.deployment.programId)[0],
      SYSVAR_CLOCK_PUBKEY,
    ],
    "confirmed",
  );
});

it.each(["unsettled", "counter", "missing", "owed"])(
  "refuses buys with %s account obligations",
  async (mode) => {
    const s = scenario();
    if (mode === "unsettled") s.pull();
    if (mode === "counter") s.f.state.machine.unsettled_reveals = 1n;
    if (mode === "missing") s.missing();
    if (mode === "owed") s.owed(false);
    const { state } = await s.read();
    expect(state.buyBlockReason).not.toBeNull();
    expect(
      stockRequests(state, s.now).filter((r) => r.kind === EXEC_KIND.stockBuy),
    ).toEqual([]);
    expect(checkStockQuote(state, s.quote, s.now).ok).toBe(false);
    if (mode === "unsettled")
      expect(state.buyBlockReason).toBe("unsettled_reveal");
  },
);

it("keeps Binder escrow out of spendable SOL and denies unknown listing times", async () => {
  const s = scenario();
  s.owed(true);
  const { state } = await s.read();
  expect(state.buyBlockReason).toBeNull();
  expect(state.spendableSol).toBe(6_000_000_000n);
  expect(state.buckets.get(0)?.listedAt).toBeNull();
  state.machine = decodeMachine(
    encodeMachine({
      ...state.machine,
      buckets: state.machine.buckets.map((b, i) =>
        i ? b : { ...b, class: 2 },
      ),
    }),
  );
  expect(
    stockRequests(state, s.now).filter((r) => r.kind === EXEC_KIND.stockBuy),
  ).toEqual([]);
});

it("refuses an unknown previous-hour payout reserve and bounds the current-hour reserve", async () => {
  const s = scenario();
  s.f.state.machine.keeper_history_version = 0n;
  s.f.state.machine.last_reveal_ts = 1n;
  const snapshot = await s.chain.snapshot();
  expect((await s.chain.limits(snapshot, 7200n)).buyBlockReason).toBe(
    "payout_reserve_unavailable",
  );
  const state = (await s.read()).state;
  state.payoutReserve = 4_000_000_000n;
  expect(
    stockRequests(state, s.now).find((r) => r.kind === EXEC_KIND.stockBuy)
      ?.amount,
  ).toBe(1_000_000_000n);
});

it("enforces the own journal even when the on-chain hour rotates", () => {
  const f = fixture();
  f.state.budget = {
    bought: STOCK.hourlyFloorLamports,
    sold: 0n,
    mints: new Map(),
  };
  expect(
    stockRequests(f.state, f.now + 3600n).filter(
      (r) => r.kind === EXEC_KIND.stockBuy,
    ),
  ).toEqual([]);
});

it("does not spend other Machine pots or donations above tracked stock", async () => {
  const s = scenario();
  const snapshot = await s.chain.snapshot();
  snapshot.machineAccount.lamports += 5_000_000_000;
  expect((await s.chain.limits(snapshot, s.now)).spendableSol).toBe(
    6_000_000_000n,
  );
  s.f.state.machine.jackpot_sol = 3_000_000_000n;
  expect((await s.read()).state.buyBlockReason).toBe("machine_underfunded");
});

it("blocks a pending draw even before its Pull account is returned", async () => {
  const s = scenario();
  s.f.state.machine.pending_pulls = 1n;
  expect((await s.read()).state.buyBlockReason).toBe("pending_pull");
});

it("requires the canonical vault to cover the tracked token stock", async () => {
  const s = scenario();
  Buffer.from(
    s.f.readings.vault.data.buffer,
    s.f.readings.vault.data.byteOffset,
    s.f.readings.vault.data.byteLength,
  ).writeBigUInt64LE(0n, 64);
  expect((await s.read()).state.buyBlockReason).toBe("stock_vault_unreadable");
});

it("restocks after settlement and the chosen reveal delay even when the Pull is closed", async () => {
  const s = scenario();
  const m = s.f.state.machine;
  m.packs_revealed[0] = 1n;
  m.last_reveal_ts = s.now - BigInt(KEEPER_POLICY.revealDelaySecondsMax);
  m.unsettled_reveals = 1n;
  expect(planStock((await s.read()).state, [s.quote], s.now)).toEqual([]);
  m.unsettled_reveals = 0n;
  expect(
    planStock(
      (await s.read(KEEPER_POLICY.revealDelaySecondsMax)).state,
      [s.quote],
      s.now,
    ),
  ).toHaveLength(1);
  m.last_reveal_ts += 1n;
  expect(
    planStock(
      (await s.read(KEEPER_POLICY.revealDelaySecondsMax)).state,
      [s.quote],
      s.now,
    ),
  ).toEqual([]);
  // The same settled reveal can be admitted with a shorter configured random wait.
  expect(planStock((await s.read()).state, [s.quote], s.now)).toHaveLength(1);
  m.last_reveal_ts = s.now - BigInt(KEEPER_POLICY.revealDelaySecondsMin) + 1n;
  expect(stockRequests((await s.read()).state, s.now)).toEqual([]);
  expect(
    s.rpc.getAccountInfo.mock.calls.every(
      ([key]) => !key.equals(SYSVAR_CLOCK_PUBKEY),
    ),
  ).toBe(true);
});

it("admits TRENDING at its on-chain notice boundary with a passing public report", async () => {
  const s = scenario(180000n);
  const m = s.f.state.machine;
  m.buckets[0]!.class = 2;
  m.buckets[0]!.cost = 0n;
  m.stock_sol = 100_000_000_000n;
  m.hit_out_last_hour = 60_000_000_000n;
  m.bucket_history[0]!.listed_ts =
    s.now - BigInt(HIT_LIST.trendingNoticeSeconds) + 1n;
  expect(stockRequests((await s.read()).state, s.now)).toEqual([]);
  m.bucket_history[0]!.listed_ts -= 1n;
  const { state } = await s.read();
  expect(state.buckets.get(0)?.listedAt).toBe(m.bucket_history[0]!.listed_ts);
  expect(stockRequests(state, s.now)).toEqual([
    expect.objectContaining({ kind: EXEC_KIND.stockBuy, reason: "inventory" }),
  ]);
  state.buckets.get(0)!.failing = true;
  expect(
    stockRequests(state, s.now).filter((r) => r.kind === EXEC_KIND.stockBuy),
  ).toEqual([]);
});

it.each([0n, 899n, 900n, 1799n, 1800n, 3600n, 7200n])(
  "bounds payout and inflow windows across retained hour +%ss",
  async (offset) => {
    const s = scenario(180000n + offset);
    const m = s.f.state.machine;
    m.hour_index = 50n;
    m.sb_paid_hour = 2_000_000_000n;
    m.sb_paid_prev_hour = 3_000_000_000n;
    m.hit_out_last_hour = 80_000_000_000n;
    m.bucket_history[0]!.sb_inflow_hour = 7_000_000_000n;
    m.bucket_history[0]!.sb_inflow_prev_hour = 11_000_000_000n;
    // Every bucket contributes, including one no longer listed.
    m.bucket_history[1]!.sb_inflow_hour = 1_000_000_000n;
    const { state } = await s.read();
    expect(state.buyBlockReason).toBeNull();
    const payouts =
      offset < 900n ? 5n : offset < 3600n ? 2n : offset === 3600n ? 2n : 0n;
    const inflows = offset < 1800n ? 19n : offset <= 3600n ? 8n : 0n;
    expect(state.payoutReserve).toBe(payouts * 1_000_000_000n);
    expect(state.inventoryInflowBound).toBe(inflows * 1_000_000_000n);
    if (offset === 1800n) {
      const t = stockTargets(state, s.now);
      expect(t.targets.get(0)).toBe(t.anchor + 32_000_000_000n);
    }
  },
);

it.each(["legacy", "saturated", "future"])(
  "refuses unproved %s history without inflating inventory",
  async (mode) => {
    const s = scenario(180000n);
    const m = s.f.state.machine;
    m.hit_out_last_hour = 80_000_000_000n;
    if (mode === "legacy") {
      m.keeper_history_version = 0n;
      m.last_reveal_ts = 1n;
    }
    if (mode === "saturated")
      m.bucket_history[0]!.sb_inflow_prev_hour = (1n << 64n) - 1n;
    if (mode === "future") m.hour_index += 1n;
    const { state } = await s.read();
    if (mode !== "saturated")
      expect(state.buyBlockReason).toBe("payout_reserve_unavailable");
    else {
      expect(state.buyBlockReason).toBeNull();
      expect(state.inventoryInflowBound).toBe(40_000_000_000n);
      expect(stockTargets(state, s.now).targets.get(0)).toBe(
        stockTargets(state, s.now).anchor,
      );
    }
  },
);
