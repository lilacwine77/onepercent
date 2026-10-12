import {
  BPS_DENOMINATOR,
  COVERAGE,
  HIT_LIST,
  KEEPER_POLICY,
  PACK_EDITIONS,
  SEASON,
  SELL_BACK,
  SERVICES,
  STOCK,
} from "@onepercent/config";
import {
  EXEC_KIND,
  execBeginIx,
  execEndIx,
  PHASE,
  rotateHour,
  tierValue,
} from "@onepercent/sdk";
import {
  bookOf,
  checkExecBegin,
  rotateStockHour,
  stockCap,
  stockBuyGuard,
} from "@onepercent/sdk/server";
import type { ExecBeginInput } from "@onepercent/sdk";
import type { ExecReadings, ExecState } from "@onepercent/sdk/server";

const BPS = BigInt(BPS_DENOMINATOR);
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));
const max = (a: bigint, b: bigint) => (a > b ? a : b);
export interface StockState extends ExecState {
  slot?: number;
  /** Null only when current accounts bound every required obligation. */
  buyBlockReason: string | null;
  spendableSol: bigint;
  budget: StockBudget;
  buckets: ReadonlyMap<number, { failing: boolean; listedAt: bigint | null }>;
  payoutReserve: bigint;
  inventoryInflowBound: bigint;
  lastReveal: bigint | null;
  revealDelaySeconds: number;
}
export interface StockBudget {
  bought: bigint;
  sold: bigint;
  mints: ReadonlyMap<string, { bought: bigint; sold: bigint }>;
}
export const emptyStockBudget = (): StockBudget => ({
  bought: 0n,
  sold: 0n,
  mints: new Map(),
});
export interface StockRequest {
  bucket: number;
  kind: typeof EXEC_KIND.stockBuy | typeof EXEC_KIND.stockSell;
  amount: bigint;
  reason: string;
}
export interface StockQuote extends StockRequest {
  args: ExecBeginInput;
  readings: ExecReadings;
  outAmount: bigint;
  minOut: bigint;
  impactBps: number;
}
export interface StockTrade extends StockQuote {
  onchainMinOut: bigint;
}
export function rotated(state: StockState, now: bigint): StockState {
  const machine = rotateStockHour(rotateHour(state.machine, now), now);
  return {
    ...state,
    machine: {
      ...machine,
      stock_bought_hour: max(machine.stock_bought_hour, state.budget.bought),
      stock_sold_hour: max(machine.stock_sold_hour, state.budget.sold),
      buckets: machine.buckets.map((b) => {
        const used = state.budget.mints.get(b.mint.toBase58());
        const current = BigInt(b.trend_hour_index) === now / 3600n;
        return {
          ...b,
          trend_hour_index: Number(now / 3600n),
          trend_bought_hour: max(
            current ? b.trend_bought_hour : 0n,
            used?.bought ?? 0n,
          ),
          trend_sold_hour: max(
            current ? b.trend_sold_hour : 0n,
            used?.sold ?? 0n,
          ),
        };
      }),
    },
  };
}
export function stockTargets(state: StockState, now: bigint) {
  const m = state.machine;
  const majors = m.buckets
    .map((b, index) => ({ ...b, index }))
    .filter(
      (b) =>
        b.class === 1 &&
        b.enabled === 1 &&
        state.buckets.get(b.index)?.failing === false,
    );
  majors.sort((a, b) =>
    a.cost - a.reserved === b.cost - b.reserved
      ? a.index - b.index
      : a.cost - a.reserved > b.cost - b.reserved
        ? -1
        : 1,
  );
  const available = majors.reduce(
    (sum, b) => sum + b.cost - b.reserved,
    m.stock_sol,
  );
  const edition = [...PACK_EDITIONS]
    .reverse()
    .find(
      (e) =>
        (e.priceLamports * BigInt(COVERAGE.perPackValueBps)) / BPS <= available,
    );
  const anchor = edition
    ? ((edition.priceLamports * BigInt(COVERAGE.perPackValueBps)) / BPS) *
      BigInt(KEEPER_POLICY.anchorMultipleOfTopBlack)
    : 0n;
  const inventory = max(
    0n,
    (m.hit_out_last_hour * BigInt(KEEPER_POLICY.inventoryTargetMinutes)) / 60n -
      state.inventoryInflowBound,
  );
  const targets = new Map<number, bigint>();
  const trending = m.buckets
    .map((b, index) => ({ ...b, index }))
    .filter(
      (b) =>
        b.class === 2 &&
        b.enabled === 1 &&
        state.buckets.get(b.index)?.failing === false &&
        state.buckets.get(b.index)?.listedAt !== null &&
        state.buckets.get(b.index)?.listedAt !== undefined &&
        now >=
          state.buckets.get(b.index)!.listedAt! +
            BigInt(HIT_LIST.trendingNoticeSeconds),
    );
  const book = m.buckets.reduce((sum, b) => sum + b.cost, m.stock_sol);
  const trendTarget = trending.length
    ? min(
        (inventory * BigInt(STOCK.trendingShareMaxBps)) / BPS,
        (book * BigInt(STOCK.trendingShareMaxBps)) / BPS,
      )
    : 0n;
  for (const b of majors)
    targets.set(
      b.index,
      (inventory - trendTarget) / BigInt(majors.length) +
        (b.index === majors[0]?.index ? anchor : 0n),
    );
  for (const b of trending)
    targets.set(b.index, trendTarget / BigInt(trending.length));
  return {
    targets,
    anchorIndex: majors[0]?.index,
    anchor,
    reserve: SELL_BACK.solFloorLamports + state.payoutReserve,
  };
}
/** Ordered candidates only. A cycle executes at most one, then reads and plans again. */
export function stockRequests(input: StockState, now: bigint): StockRequest[] {
  const state = rotated(input, now),
    m = state.machine;
  if (
    m.exec.kind !== 0 ||
    !([PHASE.poweredOn, PHASE.onAir, PHASE.buysClosed] as number[]).includes(
      m.phase,
    )
  )
    return [];
  if (now < m.last_stock_trade_ts + BigInt(STOCK.tradeMinSpacingSeconds))
    return [];
  const { targets, anchorIndex, anchor, reserve } = stockTargets(state, now);
  const cap = stockCap(m.hit_out_last_hour, m.hit_out_this_hour);
  const requests: StockRequest[] = [];
  const sell = (index: number, desired: bigint, reason: string) => {
    const b = m.buckets[index]!;
    if (
      m.phase === PHASE.poweredOn ||
      b.amount === 0n ||
      desired < 0n ||
      (desired === 0n && b.cost > 0n)
    )
      return;
    const trendSold =
      BigInt(b.trend_hour_index) === now / 3600n ? b.trend_sold_hour : 0n;
    const limit = min(
      desired,
      b.cost - b.reserved,
      b.class === 1
        ? STOCK.majorTrancheMaxLamports
        : STOCK.trendingTrancheMaxLamports,
      b.class === 1 && m.phase === PHASE.buysClosed
        ? b.cost
        : max(0n, cap - m.stock_sold_hour),
      b.class === 2
        ? max(0n, STOCK.trendingHourlyMaxLamports - trendSold)
        : b.cost,
    );
    // Largest token amount whose floored book removal is within the limit.
    const amount =
      b.cost === 0n
        ? b.amount
        : min(b.amount, ((limit + 1n) * b.amount - 1n) / b.cost);
    if (amount > 0n && limit >= 0n)
      requests.push({
        bucket: index,
        kind: EXEC_KIND.stockSell,
        amount,
        reason,
      });
  };
  const indices = m.buckets
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.class !== 0)
    .sort((a, b) => a.b.class - b.b.class || a.index - b.index);
  for (const { b, index } of indices) {
    if (
      m.phase === PHASE.buysClosed ||
      b.enabled === 0 ||
      state.buckets.get(index)?.failing
    )
      sell(index, b.cost - b.reserved, "sell_down");
  }
  if (m.phase === PHASE.buysClosed) return requests;
  if (m.stock_sol < reserve) {
    for (const { b, index } of indices)
      sell(index, b.cost - b.reserved, "sol_reserve");
    return requests;
  }
  if (m.end_ts !== 0n && now >= m.end_ts - BigInt(SEASON.lastCallSeconds)) {
    for (const { b, index } of indices)
      sell(
        index,
        max(0n, b.cost - b.reserved - (targets.get(index) ?? 0n)),
        "last_call",
      );
  }
  if (
    state.lastReveal !== null &&
    now <
      state.lastReveal +
        BigInt(
          Math.max(
            state.revealDelaySeconds,
            KEEPER_POLICY.revealDelaySecondsMin,
          ),
        )
  )
    return requests;
  if (state.buyBlockReason !== null) return requests;
  const buy = (index: number, target: bigint, reason: string) => {
    const b = m.buckets[index]!,
      meta = state.buckets.get(index);
    if (b.enabled !== 1 || meta?.failing !== false) return;
    if (
      b.class === 2 &&
      (meta.listedAt === null ||
        now < meta.listedAt + BigInt(HIT_LIST.trendingNoticeSeconds))
    )
      return;
    const trendBought =
      BigInt(b.trend_hour_index) === now / 3600n ? b.trend_bought_hour : 0n;
    const total = m.buckets.reduce((sum, x) => sum + x.cost, m.stock_sol);
    const trend = m.buckets.reduce(
      (sum, x) => sum + (x.class === 2 ? x.cost : 0n),
      0n,
    );
    const amount = min(
      target - (b.cost - b.reserved),
      min(m.stock_sol, state.spendableSol) - reserve,
      b.cap - b.cost,
      max(0n, cap - m.stock_bought_hour),
      b.class === 1
        ? STOCK.majorTrancheMaxLamports
        : STOCK.trendingTrancheMaxLamports,
      b.class === 2
        ? max(0n, STOCK.trendingHourlyMaxLamports - trendBought)
        : m.stock_sol,
      b.class === 2
        ? max(0n, (total * BigInt(STOCK.trendingShareMaxBps)) / BPS - trend)
        : m.stock_sol,
    );
    if (
      amount > 0n &&
      stockBuyGuard(input.machine, index, amount, now) === null
    )
      requests.push({
        bucket: index,
        kind: EXEC_KIND.stockBuy,
        amount,
        reason,
      });
  };
  if (anchorIndex !== undefined) buy(anchorIndex, anchor, "anchor");
  for (const [index, target] of targets) buy(index, target, "inventory");
  return requests;
}
export function checkStockQuote(
  state: StockState,
  quote: StockQuote,
  now: bigint,
) {
  if (quote.kind === EXEC_KIND.stockBuy) {
    const guard = stockBuyGuard(state.machine, quote.bucket, quote.amount, now);
    if (guard) return { ok: false as const, error: guard };
  }
  state = rotated(state, now);
  if (quote.kind === EXEC_KIND.stockBuy && state.buyBlockReason !== null)
    return { ok: false as const, error: state.buyBlockReason };
  if (
    quote.kind === EXEC_KIND.stockBuy &&
    quote.amount >
      min(state.machine.stock_sol, state.spendableSol) -
        stockTargets(state, now).reserve
  )
    return { ok: false as const, error: "stock_spendable_sol" };
  const b = state.machine.buckets[quote.bucket];
  if (
    !b ||
    quote.args.bucket !== quote.bucket ||
    quote.args.kind !== quote.kind ||
    quote.args.amount !== quote.amount
  )
    return { ok: false as const, error: "quote_binding" };
  if (
    !Number.isFinite(quote.impactBps) ||
    Math.abs(quote.impactBps) > KEEPER_POLICY.maxQuotedImpactBps
  )
    return { ok: false as const, error: "price_impact" };
  if (
    b.class === 1 &&
    quote.readings.oracles
      .slice(0, 2)
      .some(
        (o) =>
          o.data.length < 101 ||
          now < Buffer.from(o.data).readBigInt64LE(93) ||
          now - Buffer.from(o.data).readBigInt64LE(93) >
            BigInt(SERVICES.stock.pythSkipAgeSeconds),
      )
  )
    return { ok: false as const, error: "sponsored_price_stale" };
  const begin = execBeginIx(state.deployment.programId, quote.args),
    end = execEndIx(state.deployment.programId, quote.args);
  const checked = checkExecBegin(
    state,
    quote.args,
    {
      ...quote.readings,
      execution: {
        stackHeight: 1,
        currentIndex: 0,
        instructions: [begin, end],
      },
    },
    now,
  );
  if (!checked.ok) return checked;
  if (quote.minOut < checked.minOut)
    return { ok: false as const, error: "route_min_out" };
  if (b.reserved > 0n && quote.kind === EXEC_KIND.stockBuy) {
    for (const e of PACK_EDITIONS) {
      const smallest = tierValue(e.priceLamports, 1);
      if (
        b.cost > 0n &&
        smallest * b.amount >= b.cost &&
        smallest * (b.amount + checked.minOut) < b.cost + quote.amount
      )
        return { ok: false as const, error: "ReservedCapacity" };
    }
  }
  return checked;
}
export function planStock(
  state: StockState,
  quotes: readonly StockQuote[],
  now: bigint,
): StockTrade[] {
  for (const request of stockRequests(state, now)) {
    const rungs = quotes
      .filter(
        (q) =>
          q.bucket === request.bucket &&
          q.kind === request.kind &&
          q.amount > 0n &&
          q.amount <= request.amount,
      )
      .sort((a, b) =>
        a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1,
      );
    for (const q of rungs) {
      const check = checkStockQuote(state, q, now);
      if (check.ok)
        return [{ ...q, reason: request.reason, onchainMinOut: check.minOut }];
    }
  }
  return [];
}
export function removedBook(state: StockState, trade: StockRequest) {
  const b = state.machine.buckets[trade.bucket]!;
  return trade.kind === EXEC_KIND.stockSell
    ? bookOf(trade.amount, b.amount, b.cost)
    : trade.amount;
}
