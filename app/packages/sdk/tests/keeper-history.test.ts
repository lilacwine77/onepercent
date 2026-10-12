import { describe, expect, it } from "vitest";
import { KEEPER_POLICY } from "@onepercent/config";
import { decodeMachine, encodeMachine } from "../src/layouts.js";
import { keeperWindowBounds, rotateHour } from "../src/math/index.js";

function fixture() {
  return decodeMachine(
    encodeMachine({
      keeper_history_version: 1n,
      keeper_history_started_ts: 1n,
      last_reveal_ts: 3000n,
      hour_index: 1n,
      sb_paid_hour: 11n,
      sb_paid_prev_hour: 17n,
      bucket_history: Array.from({ length: 16 }, (_, index) => ({
        listed_ts: 2n,
        sb_inflow_hour: BigInt(index + 1),
        sb_inflow_prev_hour: BigInt(index + 3),
      })),
    }),
  );
}
describe("P3 account history", () => {
  it("fits the reserved bytes and round trips without changing the deployed prefix", () => {
    const data = encodeMachine(fixture());
    const legacy = Buffer.from(data);
    legacy.fill(0, 2656, 3072);
    const old = decodeMachine(legacy);
    expect(old.keeper_history_version).toBe(0n);
    expect(keeperWindowBounds(old, 4000n, 900n)).toBeNull();
    expect(encodeMachine(old)).toEqual(legacy);
    expect(data.subarray(0, 2656)).toEqual(legacy.subarray(0, 2656));
    expect(data.readBigInt64LE(2656)).toBe(3000n);
    expect(data.readBigUInt64LE(2664)).toBe(17n);
    expect(data.readBigInt64LE(2688 + 15 * 24)).toBe(2n);
    expect(data.readBigUInt64LE(2688 + 15 * 24 + 8)).toBe(16n);
    expect(data.length).toBe(3808);
  });
  it("covers configured windows before, at and after the hour boundary", () => {
    const m = fixture();
    for (const minutes of [
      KEEPER_POLICY.solReserveExtraMinutes,
      KEEPER_POLICY.inventoryTargetMinutes,
    ]) {
      const window = BigInt(minutes * 60);
      expect(window).toBeLessThanOrEqual(3600n);
      expect(keeperWindowBounds(m, 3600n, window)?.payouts).toBe(28n);
      expect(
        keeperWindowBounds(m, 3600n + window - 1n, window)?.inflows[15],
      ).toBe(34n);
      expect(keeperWindowBounds(m, 3600n + window, window)?.payouts).toBe(11n);
      expect(keeperWindowBounds(m, 7200n, window)?.payouts).toBe(11n);
      expect(keeperWindowBounds(m, 10800n, window)?.payouts).toBe(0n);
    }
    expect(m.sb_paid_prev_hour).toBe(17n);
    expect(m.bucket_history[0]!.sb_inflow_hour).toBe(1n);
  });
  it("rotates all counters together and never mutates a decoded snapshot", () => {
    const m = fixture();
    const rotated = rotateHour(m, 7200n);
    expect(rotated.hour_index).toBe(2n);
    expect(rotated.sb_paid_prev_hour).toBe(11n);
    expect(rotated.bucket_history[0]!.sb_inflow_prev_hour).toBe(1n);
    expect(rotated.bucket_history[0]!.listed_ts).toBe(2n);
    expect(m.bucket_history[0]!.sb_inflow_prev_hour).toBe(3n);
  });
  it("refuses incomplete, future, unsupported and saturated evidence", () => {
    const m = fixture();
    expect(keeperWindowBounds(m, 4000n, 3601n)).toBeNull();
    expect(keeperWindowBounds(m, 4000n, 0n)).toBeNull();
    expect(keeperWindowBounds(m, 3000n, 900n)).toBeNull();
    const fresh = { ...m, keeper_history_started_ts: 3100n };
    expect(keeperWindowBounds(fresh, 4000n, 900n)).toBeNull();
    expect(keeperWindowBounds(fresh, 4001n, 900n)).not.toBeNull();
    const saturated = {
      ...fresh,
      bucket_history: fresh.bucket_history.map((h) => ({
        ...h,
        sb_inflow_hour: (1n << 64n) - 1n,
      })),
    };
    expect(keeperWindowBounds(saturated, 4001n, 900n)).toBeNull();
    expect(
      keeperWindowBounds({ ...m, keeper_history_version: 3n }, 15000n, 900n),
    ).toBeNull();
  });
});
