import { describe, expect, it } from "vitest";
import {
  AddressLookupTableAccount,
  SystemProgram,
  PublicKey,
} from "@solana/web3.js";
import { HIT_LIST, KEEPER_POLICY, SERVICES, STOCK } from "@onepercent/config";
import { EXEC_KIND, PHASE, execBeginIx, execEndIx } from "@onepercent/sdk";
import { checkExecBegin, minOutMajor } from "@onepercent/sdk/server";
import { fixture } from "./testing.js";
import {
  checkStockQuote,
  planStock,
  stockRequests,
  stockTargets,
} from "./planner.js";
import type { StockQuote } from "./planner.js";
import { buildRoute, buildStockTransaction } from "./builder.js";
function quoted(f = fixture(), amount = f.args.amount): StockQuote {
  const q = minOutMajor({
    amount,
    solPrice: 10_901_000_000n,
    solExponent: -8,
    tokenPrice: 85_000_000n,
    tokenExponent: -8,
    decimals: 6,
    sell: f.args.kind === EXEC_KIND.stockSell,
  });
  return {
    args: { ...f.args, amount },
    readings: f.readings,
    kind: f.args.kind as 1 | 2,
    bucket: 0,
    amount,
    minOut: q.minOut,
    outAmount: q.expected,
    impactBps: 0,
    reason: "test",
  };
}
describe("stock policy", () => {
  it("cold start prioritizes the largest-free anchor and spends only reserve surplus", () => {
    const f = fixture();
    const [request] = stockRequests(f.state, f.now);
    expect(request).toMatchObject({
      kind: EXEC_KIND.stockBuy,
      reason: "anchor",
      amount: STOCK.majorTrancheMaxLamports,
    });
    expect(stockTargets(f.state, f.now).anchor).toBe(30_000_000_000n);
    expect(planStock(f.state, [quoted(f)], f.now)).toHaveLength(1);
  });
  it.each([
    "paused",
    "role",
    "lock",
    "spacing",
    "cap",
    "season",
    "final",
    "reveal",
    "stale",
    "wide",
    "impact",
    "threshold",
  ])("fails closed for %s", (mode) => {
    const f = fixture();
    const q = quoted(f);
    if (mode === "paused") f.state.config.admin_paused = 8;
    if (mode === "role") f.state.config.disabled_roles = 1 << 3;
    if (mode === "lock") f.state.machine.exec.kind = 1;
    if (mode === "spacing") f.state.machine.last_stock_trade_ts = f.now;
    if (mode === "cap")
      f.state.machine.stock_bought_hour = STOCK.hourlyFloorLamports;
    if (mode === "season") f.state.machine.end_ts = f.now;
    if (mode === "final") f.state.machine.phase = PHASE.finalPull;
    if (mode === "reveal") f.state.lastReveal = f.now;
    if (mode === "stale")
      Buffer.from(f.readings.oracles[0].data.buffer).writeBigInt64LE(
        f.now - BigInt(SERVICES.stock.pythSkipAgeSeconds) - 1n,
        93,
      );
    if (mode === "wide")
      (f.readings.oracles[0].data as Buffer).writeBigUInt64LE(85_000_000n, 81);
    if (mode === "impact") q.impactBps = KEEPER_POLICY.maxQuotedImpactBps + 1;
    if (mode === "threshold") q.minOut = 1n;
    expect(planStock(f.state, [q], f.now)).toEqual([]);
  });
  it("sells for reserve drain, failing and disabled buckets, Last Call and BuysClosed", () => {
    for (const mode of [
      "drain",
      "failing",
      "disabled",
      "last",
      "closed",
    ] as const) {
      const f = fixture(true);
      if (mode === "drain") f.state.machine.stock_sol = 0n;
      if (mode === "failing")
        f.state.buckets = new Map([[0, { failing: true, listedAt: 0n }]]);
      if (mode === "disabled") f.state.machine.buckets[0]!.enabled = 0;
      if (mode === "last") {
        f.state.machine.end_ts = f.now + 1n;
        f.state.machine.buckets[0]!.cost = 80_000_000_000n;
      }
      if (mode === "closed") {
        f.state.machine.phase = PHASE.buysClosed;
        f.state.machine.stock_sold_hour = STOCK.hourlyFloorLamports;
      }
      expect(planStock(f.state, [quoted(f, 10_000_000n)], f.now)[0]?.kind).toBe(
        EXEC_KIND.stockSell,
      );
    }
  });
  it("rolls gross caps and includes launch-hour output", () => {
    const f = fixture();
    f.state.machine.stock_bought_hour = STOCK.hourlyFloorLamports;
    expect(stockRequests(f.state, f.now)).toEqual([]);
    f.state.machine.hit_out_this_hour = STOCK.hourlyFloorLamports;
    expect(stockRequests(f.state, f.now).length).toBeGreaterThan(0);
    f.state.machine.stock_hour_index = 1n;
    expect(planStock(f.state, [quoted(f)], f.now)).toHaveLength(1);
  });
  it("keeps reserved book and D12 granularity during both sides", () => {
    const sell = fixture(true);
    sell.state.machine.phase = PHASE.buysClosed;
    sell.state.machine.buckets[0]!.reserved =
      sell.state.machine.buckets[0]!.cost;
    expect(planStock(sell.state, [quoted(sell)], sell.now)).toEqual([]);
    const buy = fixture();
    const b = buy.state.machine.buckets[0]!;
    b.cost = 50_000_000n;
    b.amount = 1n;
    b.reserved = 1n;
    (buy.readings.mint.data as Buffer)[44] = 0;
    (buy.readings.oracles[0].data as Buffer).writeBigInt64LE(
      5_000_000_000n,
      73,
    );
    const q = quoted(buy);
    q.minOut = 1n;
    expect(checkStockQuote(buy.state, q, buy.now)).toEqual({
      ok: false,
      error: "ReservedCapacity",
    });
  });
  it("never lets any accepted generated plan fail the P1 mirror", () => {
    let seed = 991;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    let accepted = 0;
    for (let i = 0; i < 1000; i++) {
      const f = fixture(i % 2 === 1);
      const b = f.state.machine.buckets[0]!;
      f.state.machine.stock_sol = BigInt(random()) * 10n;
      b.reserved = BigInt(random()) % b.cost;
      f.state.machine.stock_bought_hour = BigInt(random()) * 10n;
      f.state.machine.stock_sold_hour = BigInt(random()) * 10n;
      if (i % 2) f.state.machine.phase = PHASE.buysClosed;
      const q = quoted(f, BigInt((random() % 100_000_000) + 1));
      const before = JSON.stringify(f.state.machine, (_k, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      for (const t of planStock(f.state, [q], f.now)) {
        const readings = {
          ...t.readings,
          execution: {
            stackHeight: 1,
            currentIndex: 0,
            instructions: [
              execBeginIx(f.state.deployment.programId, t.args),
              execEndIx(f.state.deployment.programId, t.args),
            ],
          },
        };
        expect(checkExecBegin(f.state, t.args, readings, f.now)).toEqual({
          ok: true,
          minOut: t.onchainMinOut,
        });
        accepted++;
      }
      expect(
        JSON.stringify(f.state.machine, (_k, v: unknown) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      ).toBe(before);
    }
    expect(accepted).toBeGreaterThan(100);
  }, 60_000);
  it("builds through X2 with native wrapping disabled and the canonical destination", async () => {
    const f = fixture(),
      trade = planStock(f.state, [quoted(f)], f.now)[0]!;
    const begin = execBeginIx(f.state.deployment.programId, f.args),
      end = execEndIx(f.state.deployment.programId, f.args);
    const protocolLut = new AddressLookupTableAccount({
      key: new PublicKey(new Uint8Array(32).fill(81)),
      state: {
        deactivationSlot: (1n << 64n) - 1n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [...begin.keys, ...end.keys].map((k) => k.pubkey),
      },
    });
    const route = await buildRoute(
      f.state,
      trade,
      {
        async build(input) {
          expect(input.wrapAndUnwrapSol).toBe(false);
          expect(input.destinationTokenAccount).toBe(
            f.readings.vault.address.toBase58(),
          );
          return {
            inAmount: trade.amount,
            minOut: trade.onchainMinOut,
            outAmount: trade.outAmount,
            setupInstructions: [],
            swapInstruction: {
              programId: SystemProgram.programId.toBase58(),
              accounts: [],
              data: "",
            },
            cleanupInstruction: null,
            otherInstructions: [],
            computeBudgetInstructions: [],
            lookupTables: {},
          };
        },
      },
      async () => protocolLut,
    );
    const result = buildStockTransaction({
      state: f.state,
      trade,
      route,
      now: f.now,
      blockhash: PublicKey.default.toBase58(),
      protocolLut,
      units: 500_000,
    });
    expect(result.serializedSize).toBeLessThanOrEqual(1232);
    expect(
      result.instructions.filter((ix) =>
        ix.programId.equals(f.state.deployment.programId),
      ),
    ).toHaveLength(2);
    route.minOut = 0n;
    expect(() =>
      buildStockTransaction({
        state: f.state,
        trade,
        route,
        now: f.now,
        blockhash: PublicKey.default.toBase58(),
        protocolLut,
        units: 500_000,
      }),
    ).toThrow("route_min_out");
  });
});

it("TRENDING notice and hourly sizing are independent of MAJOR capacity", () => {
  const f = fixture();
  f.state.machine.buckets[0]!.class = 2;
  f.state.machine.hit_out_last_hour = 200_000_000_000n;
  const listedAt = f.now - BigInt(HIT_LIST.trendingNoticeSeconds) + 1n;
  f.state.machine.bucket_history[0]!.listed_ts = listedAt;
  f.state.buckets = new Map([[0, { failing: false, listedAt }]]);
  expect(
    stockRequests(f.state, f.now).filter((t) => t.kind === EXEC_KIND.stockBuy),
  ).toEqual([]);
  expect(stockRequests(f.state, f.now + 1n)[0]).toMatchObject({
    kind: EXEC_KIND.stockBuy,
    amount: STOCK.trendingTrancheMaxLamports,
  });
  f.state.machine.buckets[0]!.trend_hour_index = Number(f.now / 3600n);
  f.state.machine.buckets[0]!.trend_bought_hour =
    STOCK.trendingHourlyMaxLamports;
  expect(stockRequests(f.state, f.now + 1n)).toEqual([]);
  f.state.machine.phase = PHASE.buysClosed;
  f.state.machine.buckets[0]!.trend_sold_hour = STOCK.trendingHourlyMaxLamports;
  expect(
    stockRequests(f.state, f.now + 1n).filter(
      (t) => t.kind === EXEC_KIND.stockSell,
    ),
  ).toEqual([]);
});
