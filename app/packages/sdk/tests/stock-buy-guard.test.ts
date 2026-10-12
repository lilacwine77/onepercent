import { describe, expect, it } from "vitest";
import { HIT_LIST, POST_REVEAL_BUY_DELAY } from "@onepercent/config";
import { decodeMachine, encodeMachine } from "../src/layouts.js";
import { keeperWindowBounds, rotateHour } from "../src/math/index.js";
import { stockBuyGuard } from "@onepercent/sdk/server";

const now = 180010n,
  amount = 1_000_000_000n;
function fixture() {
  return decodeMachine(
    encodeMachine({
      phase: 3,
      keeper_history_version: 1n,
      hour_index: now / 3600n,
      stock_sol: 10_000_000_000n,
      buckets: Array.from({ length: 16 }, () => ({ class: 1 })),
    }),
  );
}
describe("StockBuy execution guard mirror", () => {
  it("a previously eligible plan stops after a draw, reveal or partial settlement", () => {
    const m = fixture();
    expect(stockBuyGuard(m, 0, amount, now)).toBeNull();
    expect(stockBuyGuard({ ...m, pending_pulls: 1n }, 0, amount, now)).toBe(
      "StockBuyPullInFlight",
    );
    expect(stockBuyGuard({ ...m, unsettled_reveals: 1n }, 0, amount, now)).toBe(
      "StockBuyPullInFlight",
    );
    const revealed = { ...m, last_reveal_ts: now };
    expect(
      stockBuyGuard(
        revealed,
        0,
        amount,
        now + BigInt(POST_REVEAL_BUY_DELAY) - 1n,
      ),
    ).toBe("StockBuyRevealDelay");
    expect(
      stockBuyGuard(revealed, 0, amount, now + BigInt(POST_REVEAL_BUY_DELAY)),
    ).toBeNull();
  });
  it("checks the exact TRENDING notice and reserve boundaries", () => {
    const m = fixture();
    const listed = {
      ...m,
      buckets: m.buckets.map((b) => ({ ...b, class: 2 })),
      bucket_history: m.bucket_history.map((h) => ({ ...h, listed_ts: now })),
    };
    expect(
      stockBuyGuard(
        listed,
        0,
        amount,
        now + BigInt(HIT_LIST.trendingNoticeSeconds) - 1n,
      ),
    ).toBe("StockBuyListingNotice");
    expect(
      stockBuyGuard(
        listed,
        0,
        amount,
        now + BigInt(HIT_LIST.trendingNoticeSeconds),
      ),
    ).toBeNull();
    const reserve = {
      ...m,
      sb_paid_hour: 3_000_000_000n,
      sb_paid_prev_hour: 5_000_000_001n,
    };
    expect(stockBuyGuard(reserve, 0, amount, now)).toBe("StockBuyReserve");
    expect(
      stockBuyGuard(
        { ...reserve, stock_sol: m.stock_sol + 1n },
        0,
        amount,
        now,
      ),
    ).toBeNull();
    expect(stockBuyGuard(reserve, 0, amount, 180900n)).toBeNull();
    expect(
      stockBuyGuard({ ...m, last_reveal_ts: (1n << 63n) - 1n }, 0, amount, now),
    ).toBe("StockBuyRevealDelay");
  });
  it("never invents pre-upgrade history and completes it through hour rotations", () => {
    const m = {
      ...fixture(),
      keeper_history_version: 0n,
      last_reveal_ts: now - 30n,
    };
    expect(stockBuyGuard(m, 0, amount, now)).toBe("StockBuyReserve");
    expect(stockBuyGuard(m, 0, amount, 180900n)).toBeNull();
    expect(stockBuyGuard(m, 0, amount, 183600n)).toBeNull();
    expect(keeperWindowBounds(m, 183600n, 900n)).toBeNull();
    const rotated = rotateHour(m, 183600n);
    expect(rotated.keeper_history_version).toBe(2n);
    expect(rotateHour(rotated, 187200n).keeper_history_version).toBe(1n);
    expect(keeperWindowBounds(m, 187200n, 900n)?.payouts).toBe(0n);
  });
});
