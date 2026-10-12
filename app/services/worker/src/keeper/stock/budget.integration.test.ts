import { randomUUID } from "node:crypto";
import { applyMigrations, createDatabase } from "@onepercent/db";
import { KEEPER_POLICY, SELL_BACK, STOCK } from "@onepercent/config";
import { EXEC_KIND, keeperWindowBounds } from "@onepercent/sdk";
import { minOutMajor, stockBuyGuard } from "@onepercent/sdk/server";
import type { SignedTxRecord } from "@onepercent/service-kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { StockStore, stockBudget } from "./store.js";
import {
  planStock,
  stockRequests,
  stockTargets,
  type StockTrade,
} from "./planner.js";
import { fixture } from "./testing.js";

const enabled = process.env.SERVICES_INTEGRATION === "1";
const url = process.env.TEST_DATABASE_URL;
if (
  enabled &&
  (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
)
  throw new Error("SERVICES_INTEGRATION requires a local TEST_DATABASE_URL");

describe.skipIf(!enabled)("K1 own journal budget on Postgres 17", () => {
  let admin: ReturnType<typeof createDatabase>,
    db: ReturnType<typeof createDatabase>;
  const name = `k1_budget_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    admin = createDatabase({ connectionString: url! });
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    const isolated = new URL(url!);
    isolated.pathname = `/${name}`;
    db = createDatabase({ connectionString: isolated.href });
    await applyMigrations(db.pool);
  }, 30_000);
  beforeEach(async () => {
    await db.pool.query("TRUNCATE stock_trades, stock_plans CASCADE");
  });
  afterAll(async () => {
    await db?.close();
    if (admin) {
      await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.close();
    }
  });
  it("charges before send, once per signed plan, through restart, hour rotation and ambiguous finality", async () => {
    const f = fixture();
    let now = 7199n;
    const store = new StockStore(
      db.pool,
      () => {},
      async () => now,
    );
    const trade: StockTrade = {
      kind: EXEC_KIND.stockBuy,
      bucket: 0,
      amount: STOCK.majorTrancheMaxLamports,
      args: { ...f.args, amount: STOCK.majorTrancheMaxLamports },
      readings: f.readings,
      outAmount: 1n,
      minOut: 1n,
      onchainMinOut: 1n,
      impactBps: 0,
      reason: "anchor",
    };
    const first = await store.record(f.state, 100, now, [trade], true);
    await store.record(f.state, 100, now, [trade], false);
    expect((await stockBudget(db.pool, now)).bought).toBe(0n);
    const signed: SignedTxRecord = {
      fingerprint: "a".repeat(64),
      signature: "1".repeat(64),
      transactionBase64: "AQID",
      lastValidBlockHeight: 123,
      status: "signed",
    };
    await store.write(first, signed);
    expect((await stockBudget(db.pool, now)).bought).toBe(trade.amount);
    now = 7201n;
    const restarted = new StockStore(
      db.pool,
      () => {},
      async () => now,
    );
    expect(await restarted.pending()).toBe(first);
    await restarted.write(first, { ...signed, status: "signed" });
    expect((await stockBudget(db.pool, now)).bought).toBe(trade.amount);
    await restarted.update(first, { done: true });
    // Finish the configured hourly budget with a second distinct signed plan.
    const remaining = STOCK.hourlyFloorLamports - trade.amount;
    if (remaining > 0n) {
      const second = await restarted.record(
        f.state,
        101,
        now,
        [{ ...trade, amount: remaining }],
        true,
      );
      await restarted.write(second, {
        ...signed,
        signature: "1".repeat(63) + "2",
      });
      await restarted.update(second, { done: true });
    }
    f.state.budget = await stockBudget(db.pool, now);
    expect(f.state.budget.bought).toBe(STOCK.hourlyFloorLamports);
    expect(f.state.budget.mints.get(f.args.mint.toBase58())?.bought).toBe(
      STOCK.hourlyFloorLamports,
    );
    expect(
      stockRequests(f.state, now).filter((r) => r.kind === EXEC_KIND.stockBuy),
    ).toEqual([]);
    // An unresolved signed plan is still charged beyond its original window.
    const pending = await restarted.record(f.state, 102, now, [trade], true);
    await restarted.write(pending, signed);
    now += 7200n;
    expect((await stockBudget(db.pool, now)).bought).toBe(trade.amount);
    // A receipt can retire a plan without another write(): completion extends the charge.
    await restarted.update(pending, { done: true });
    expect((await stockBudget(db.pool, now + 3599n)).bought).toBe(trade.amount);
    expect((await stockBudget(db.pool, now + 3601n)).bought).toBe(0n);
  });
  it("closes an incomplete finalized receipt after three leaders, preserves its charge and leaves measurements unknown", async () => {
    const f = fixture();
    let now = 25_000n;
    let store = new StockStore(
      db.pool,
      () => {},
      async () => now,
    );
    const trade: StockTrade = {
      kind: EXEC_KIND.stockBuy,
      bucket: 0,
      amount: f.args.amount,
      args: f.args,
      readings: f.readings,
      outAmount: 1n,
      minOut: 1n,
      onchainMinOut: 1n,
      impactBps: 0,
      reason: "anchor",
    };
    const id = await store.record(f.state, 100, now, [trade], true);
    await store.trade(id, trade, true, "planned");
    const signed: SignedTxRecord = {
      fingerprint: "a".repeat(64),
      signature: "1".repeat(64),
      transactionBase64: "AQID",
      lastValidBlockHeight: 123,
      status: "confirmed",
      finalized: true,
    };
    await store.write(id, signed);
    for (let restart = 0; restart < 3; restart++) {
      const former = store;
      store = new StockStore(
        db.pool,
        () => {},
        async () => now,
      );
      expect(await store.pending()).toBe(id);
      await expect(
        former.completeIncompleteReceipt(id, signed.signature, 101),
      ).rejects.toThrow("stock_claim_lost");
      expect((await stockBudget(db.pool, now)).bought).toBe(trade.amount);
    }
    await expect(
      store.completeIncompleteReceipt(id, "wrong-signature", 101),
    ).rejects.toThrow("stock_claim_lost");
    expect(await store.pending()).toBe(id);
    await store.completeIncompleteReceipt(id, signed.signature, 101);
    expect(await store.pending()).toBeNull();
    expect(await store.state(id)).toMatchObject({
      done: true,
      receipt: {
        status: "incomplete",
        signature: signed.signature,
        slot: 101,
        reason: "finalized_receipt_incomplete",
      },
    });
    const rows = await db.pool.query(
      "SELECT status,signature,delta,slippage_bps,confirmed_at FROM stock_trades WHERE plan_id=$1",
      [id],
    );
    expect(rows.rows[0]).toMatchObject({
      status: "confirmed",
      signature: signed.signature,
      delta: null,
      slippage_bps: null,
    });
    expect(rows.rows[0].confirmed_at).toBeInstanceOf(Date);
    now += 3599n;
    expect((await stockBudget(db.pool, now)).bought).toBe(trade.amount);
    now += 2n;
    expect((await stockBudget(db.pool, now)).bought).toBe(0n);
  });
  it("restocks after a settled reveal and the full keeper delay, while restart retains journal caps and signed pending charges", async () => {
    const f = fixture();
    let now = 45_000n;
    f.state.machine.hour_index = now / 3600n;
    f.state.machine.stock_hour_index = now / 3600n;
    f.state.machine.end_ts = now + 10_000n;
    f.state.machine.packs_revealed[0] = 1n;
    f.state.machine.last_reveal_ts =
      now - BigInt(KEEPER_POLICY.revealDelaySecondsMin);
    f.state.lastReveal = f.state.machine.last_reveal_ts;
    f.state.revealDelaySeconds = KEEPER_POLICY.revealDelaySecondsMax;
    const buys = () =>
      stockRequests(f.state, now).filter((r) => r.kind === EXEC_KIND.stockBuy);

    f.state.machine.pending_pulls = 1n;
    expect(buys()).toEqual([]);
    f.state.machine.pending_pulls = 0n;
    f.state.machine.unsettled_reveals = 1n;
    expect(buys()).toEqual([]);
    f.state.machine.unsettled_reveals = 0n;
    expect(stockBuyGuard(f.state.machine, 0, f.args.amount, now)).toBeNull();
    expect(buys()).toEqual([]);
    now =
      f.state.machine.last_reveal_ts +
      BigInt(KEEPER_POLICY.revealDelaySecondsMax);
    expect(buys()[0]?.amount).toBe(STOCK.majorTrancheMaxLamports);
    for (const oracle of f.readings.oracles.slice(0, 2))
      (oracle.data as Buffer).writeBigInt64LE(now, 93);
    const amount = buys()[0]!.amount;
    const quote = minOutMajor({
      amount,
      solPrice: 10_901_000_000n,
      solExponent: -8,
      tokenPrice: 85_000_000n,
      tokenExponent: -8,
      decimals: 6,
      sell: false,
    });
    const [trade] = planStock(
      f.state,
      [
        {
          ...buys()[0]!,
          args: { ...f.args, amount },
          readings: f.readings,
          outAmount: quote.expected,
          minOut: quote.minOut,
          impactBps: 0,
        },
      ],
      now,
    );
    expect(trade?.kind).toBe(EXEC_KIND.stockBuy);
    const store = new StockStore(
      db.pool,
      () => {},
      async () => now,
    );
    const signed: SignedTxRecord = {
      fingerprint: "a".repeat(64),
      signature: "1".repeat(64),
      transactionBase64: "AQID",
      lastValidBlockHeight: 123,
      status: "signed",
    };
    let pending = "",
      signedPlans = 0;
    for (let charged = 0n; charged < STOCK.hourlyFloorLamports;) {
      const next =
        STOCK.hourlyFloorLamports - charged < trade!.amount
          ? STOCK.hourlyFloorLamports - charged
          : trade!.amount;
      const id = await store.record(
        f.state,
        200,
        now,
        [{ ...trade!, amount: next, args: { ...trade!.args, amount: next } }],
        true,
      );
      await store.write(id, {
        ...signed,
        signature: "1".repeat(63) + String(++signedPlans),
      });
      charged += next;
      if (charged < STOCK.hourlyFloorLamports)
        await store.update(id, { done: true });
      else pending = id;
    }
    const restarted = new StockStore(
      db.pool,
      () => {},
      async () => now,
    );
    expect(await restarted.pending()).toBe(pending);
    f.state.budget = await stockBudget(db.pool, now);
    expect(f.state.budget.bought).toBe(STOCK.hourlyFloorLamports);
    expect(buys()).toEqual([]);
    now += 7200n;
    expect(await restarted.pending()).toBe(pending);
    f.state.budget = await stockBudget(db.pool, now);
    expect(f.state.budget.bought).toBe(trade!.amount);
    expect(f.state.budget.mints.get(f.args.mint.toBase58())?.bought).toBe(
      trade!.amount,
    );
  });
  it("uses intersecting payout and inventory windows in plans backed by the own journal", async () => {
    const f = fixture();
    const start = 72_000n;
    let now = start + 600n;
    const sol = 1_000_000_000n;
    f.state.machine.hour_index = start / 3600n;
    f.state.machine.stock_hour_index = start / 3600n;
    f.state.machine.end_ts = start + 10_000n;
    f.state.machine.sb_paid_hour = 2n * sol;
    f.state.machine.sb_paid_prev_hour = 3n * sol;
    f.state.machine.hit_out_last_hour = 40n * sol;
    f.state.machine.bucket_history[0]!.sb_inflow_hour = 3n * sol;
    f.state.machine.bucket_history[0]!.sb_inflow_prev_hour = 4n * sol;
    f.state.machine.stock_sol = SELL_BACK.solFloorLamports + 7n * sol;
    const readBounds = async () => {
      const payouts = keeperWindowBounds(
        f.state.machine,
        now,
        BigInt(KEEPER_POLICY.solReserveExtraMinutes * 60),
      );
      const inventory = keeperWindowBounds(
        f.state.machine,
        now,
        BigInt(KEEPER_POLICY.inventoryTargetMinutes * 60),
      );
      expect(payouts).not.toBeNull();
      expect(inventory).not.toBeNull();
      f.state.payoutReserve = payouts!.payouts;
      f.state.inventoryInflowBound = inventory!.inflows.reduce(
        (sum, value) => sum + value,
        0n,
      );
      f.state.budget = await stockBudget(db.pool, now);
      return { payouts, inventory };
    };
    const crossing = await readBounds();
    expect(crossing.payouts?.payouts).toBe(5n * sol);
    expect(crossing.inventory?.inflows[0]).toBe(7n * sol);
    expect(stockRequests(f.state, now)[0]?.amount).toBe(2n * sol);
    const initialTarget = stockTargets(f.state, now);
    expect(initialTarget.targets.get(0)).toBe(initialTarget.anchor + 13n * sol);

    now = start + BigInt(KEEPER_POLICY.solReserveExtraMinutes * 60);
    expect((await readBounds()).payouts?.payouts).toBe(2n * sol);
    expect(stockRequests(f.state, now)[0]?.amount).toBe(
      STOCK.majorTrancheMaxLamports,
    );
    now = start + BigInt(KEEPER_POLICY.inventoryTargetMinutes * 60);
    expect((await readBounds()).inventory?.inflows[0]).toBe(3n * sol);
    const currentTarget = stockTargets(f.state, now);
    expect(currentTarget.targets.get(0)).toBe(currentTarget.anchor + 17n * sol);

    now = start + 3600n;
    const adjacent = await readBounds();
    expect(adjacent.payouts?.payouts).toBe(2n * sol);
    expect(adjacent.inventory?.inflows[0]).toBe(3n * sol);
    now += 3600n;
    const expired = await readBounds();
    expect(expired.payouts?.payouts).toBe(0n);
    expect(expired.inventory?.inflows.every((value) => value === 0n)).toBe(
      true,
    );
  });
  it("fails closed on legacy signed charges and bounds a Sell whose book can change before landing", async () => {
    const f = fixture(true);
    const now = 30_000n;
    const store = new StockStore(
      db.pool,
      () => {},
      async () => now,
    );
    const trade: StockTrade = {
      ...f.args,
      kind: EXEC_KIND.stockSell,
      args: f.args,
      readings: f.readings,
      minOut: 1n,
      outAmount: 1n,
      onchainMinOut: 1n,
      impactBps: 0,
      reason: "sell_down",
    };
    const id = await store.record(f.state, 200, now, [trade], true);
    const record: SignedTxRecord = {
      fingerprint: "a".repeat(64),
      signature: "1".repeat(63) + "3",
      transactionBase64: "AQID",
      lastValidBlockHeight: 123,
      status: "signed",
    };
    await store.write(id, record);
    expect((await stockBudget(db.pool, now)).sold).toBe(
      STOCK.majorTrancheMaxLamports,
    );
    await db.pool.query(
      "UPDATE stock_plans SET plan=jsonb_set(plan,'{trades,0,budgetLamports}','null') WHERE id=$1",
      [id],
    );
    await expect(stockBudget(db.pool, now)).rejects.toThrow();
    await db.pool.query(
      "UPDATE stock_plans SET state=(state || '{\"done\":true}'::jsonb) - 'budgetUntil' WHERE id=$1",
      [id],
    );
    await expect(stockBudget(db.pool, now + 7200n)).rejects.toThrow();
  });
});
