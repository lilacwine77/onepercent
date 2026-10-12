import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { HIT_LIST, MARKET } from "../src/params.js";
import {
  buildLadder,
  capLamportsAtImpact,
  marginalValue,
  valueAt,
} from "../src/value/ladder.js";
import type { ValueNowResult } from "../src/value/value-now.js";

const mint = HIT_LIST.launchMajors[0]!.mint;
const ok = (lamports: bigint): ValueNowResult => ({
  status: "ok",
  lamports,
  quoteLamports: lamports,
  capped: false,
  router: "vector",
  requestId: "pure",
  fetchedAtMs: 0,
});
function sequence(values: bigint[]) {
  let index = 0;
  return vi.fn(async (): Promise<ValueNowResult> => {
    const value = values[index++];
    return value === undefined
      ? { status: "unavailable", reason: "NO_QUOTE" }
      : ok(value);
  });
}

describe("marginal ladders", () => {
  it("doubles amounts to the configured maximum", async () => {
    const values = Array.from(
      { length: MARKET.ladder.maxRungs },
      (_, index) => 10n * 2n ** BigInt(index),
    );
    const source = sequence(values);
    const ladder = await buildLadder(mint, 3n, source);
    expect(ladder.stopReason).toBe("MAX_RUNGS");
    expect(ladder.rungs.map((rung) => rung.amount)).toEqual(
      values.map((_value, index) => 3n * 2n ** BigInt(index)),
    );
    expect(ladder.rungs.every((rung) => rung.recoveryBps === 10_000n)).toBe(
      true,
    );
    expect(source).toHaveBeenCalledTimes(MARKET.ladder.maxRungs);
  });

  it("includes the first low-recovery rung and stops strictly below the boundary", async () => {
    const source = sequence([100n, 100n, 199n, 400n]);
    const ladder = await buildLadder(mint, 10n, source);
    expect(ladder.stopReason).toBe("LOW_RECOVERY");
    expect(ladder.rungs.map((rung) => rung.rawRecoveryBps)).toEqual([
      10_000n,
      5_000n,
      4_975n,
    ]);
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("applies both clamps and stops on raw recovery before the lower clamp", async () => {
    const ladder = await buildLadder(
      mint,
      10n,
      sequence([100n, 300n, 100n, 500n]),
    );
    expect(ladder.rungs.map((rung) => rung.lamports)).toEqual([
      100n,
      200n,
      200n,
    ]);
    expect(ladder.rungs.map((rung) => rung.nonMonotone)).toEqual([
      false,
      false,
      true,
    ]);
    expect(ladder.rungs[2]).toMatchObject({
      rawRecoveryBps: 2_500n,
      recoveryBps: 5_000n,
    });
    expect(ladder.stopReason).toBe("LOW_RECOVERY");
  });

  it("uses floor interpolation, handles the origin, and never extrapolates", async () => {
    const ladder = await buildLadder(mint, 2n, sequence([3n, 5n, 9n]));
    expect(
      [0n, 1n, 2n, 3n, 4n, 5n, 8n, 9n].map((amount) => valueAt(ladder, amount)),
    ).toEqual([0n, 1n, 3n, 4n, 5n, 6n, 9n, undefined]);
    expect(marginalValue(ladder, 2n, 3n)).toBe(3n);
    expect(marginalValue(ladder, 8n, 1n)).toBeUndefined();
    expect(ladder.stopReason).toBe("UNAVAILABLE");
  });

  it("selects the largest rung meeting the impact bound using clamped recovery", async () => {
    const ladder = await buildLadder(
      mint,
      100n,
      sequence([10_000n, 19_800n, 39_000n]),
    );
    expect(capLamportsAtImpact(ladder, 200)).toBe(19_800n);
    expect(capLamportsAtImpact(ladder, 100)).toBe(19_800n);
    expect(capLamportsAtImpact(ladder, 99)).toBe(10_000n);
    expect(capLamportsAtImpact(ladder, 500)).toBe(39_000n);
  });

  it("stops safely for an unavailable or zero-valued first rung", async () => {
    const empty = await buildLadder(mint, 2n, sequence([]));
    expect(empty).toMatchObject({
      rungs: [],
      stopReason: "UNAVAILABLE",
      unavailableReason: "NO_QUOTE",
    });
    expect(valueAt(empty, 0n)).toBeUndefined();
    expect(capLamportsAtImpact(empty, 200)).toBeUndefined();
    const source = sequence([0n, 10n]);
    const zero = await buildLadder(mint, 2n, source);
    expect(zero.stopReason).toBe("ZERO_BASE_VALUE");
    expect(zero.rungs[0]).toMatchObject({
      lamports: 0n,
      rawRecoveryBps: 0n,
      recoveryBps: 0n,
    });
    expect(source).toHaveBeenCalledOnce();
  });

  it("retains the architect's exact one-lamport rounding counterexample", async () => {
    const ladder = await buildLadder(mint, 2n, sequence([1n, 2n]));
    expect(valueAt(ladder, 1n)).toBe(0n);
    expect(marginalValue(ladder, 1n, 1n)).toBe(1n);
    expect(marginalValue(ladder, 1n, 1n)).toBe(valueAt(ladder, 1n)! + 1n);
  });

  it("is non-decreasing and bounds marginal values within one rounding lamport", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 1n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.array(fc.bigInt({ min: 0n, max: 2_000_000n }), {
          maxLength: MARKET.ladder.maxRungs - 1,
        }),
        fc.nat(),
        fc.nat(),
        async (base, initial, remaining, rawHeld, rawAdd) => {
          const ladder = await buildLadder(
            mint,
            base,
            sequence([initial, ...remaining]),
          );
          const maximum = ladder.rungs.at(-1)!.amount;
          const held = BigInt(rawHeld) % (maximum + 1n);
          const add = BigInt(rawAdd) % (maximum - held + 1n);
          expect(valueAt(ladder, held + add)!).toBeGreaterThanOrEqual(
            valueAt(ladder, held)!,
          );
          expect(marginalValue(ladder, held, add)!).toBeLessThanOrEqual(
            valueAt(ladder, add)! + 1n,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("rejects invalid amounts and impact bounds", async () => {
    await expect(buildLadder(mint, 0n, sequence([1n]))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const ladder = await buildLadder(mint, 1n, sequence([1n]));
    expect(() => valueAt(ladder, -1n)).toThrow();
    expect(() => marginalValue(ladder, 0n, -1n)).toThrow();
    expect(() => capLamportsAtImpact(ladder, 10_001)).toThrow();
  });
});
