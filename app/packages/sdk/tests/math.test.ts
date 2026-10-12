import { describe, expect, it } from "vitest";
import {
  PACK_EDITIONS,
  RENT_TEST_RATES_LAMPORTS_PER_BYTE,
} from "@onepercent/config";
import {
  bucketPick,
  carve,
  coverage,
  coverageGranularity,
  deposits,
  drawTier,
  dustIndex,
  feedNonces,
  maxQty,
  rotateHour,
  segments,
  splitPack,
  tierValue,
} from "../src/math/index.js";
import type { MathBucket } from "../src/math/index.js";
import { decimalJson, vectors } from "./vectors.js";
type Vector<I, O> = { input: I; output: O };
interface RandomInput {
  randomness: string;
  seq: string;
  pack: number;
}
interface JsonBucket {
  amount: string;
  cost: string;
  reserved: string;
  class: number;
  enabled: boolean;
}
const buckets = (items: JsonBucket[]): MathBucket[] =>
  items.map((b) => ({
    ...b,
    amount: BigInt(b.amount),
    cost: BigInt(b.cost),
    reserved: BigInt(b.reserved),
    enabled: Number(b.enabled),
  }));

describe("Rust golden math parity", () => {
  it("split including u64 extremes", () => {
    for (const v of vectors<Vector<{ price: string }, unknown>[]>("split"))
      expect(decimalJson(splitPack(BigInt(v.input.price)))).toEqual(v.output);
  });
  it("at least 200 exact tier draws", () => {
    const samples =
      vectors<
        Vector<
          RandomInput & { edition: number; live: number; holder: boolean },
          unknown
        >[]
      >("draw");
    expect(samples.length).toBeGreaterThanOrEqual(200);
    for (const { input: i, output } of samples)
      expect(
        drawTier(
          Buffer.from(i.randomness, "hex"),
          BigInt(i.seq),
          i.pack,
          i.edition,
          i.live,
          i.holder,
        ),
      ).toEqual(output);
  });
  it("dust indexes", () => {
    for (const { input: i, output } of vectors<
      Vector<RandomInput & { k: number; len: number }, number>[]
    >("dust"))
      expect(
        dustIndex(
          Buffer.from(i.randomness, "hex"),
          BigInt(i.seq),
          i.pack,
          i.k,
          i.len,
        ),
      ).toBe(output);
  });
  it("weighted buckets and disabled backing fallback", () => {
    for (const { input: i, output } of vectors<
      Vector<
        RandomInput & {
          kind: number;
          value: string;
          backing: number;
          buckets: JsonBucket[];
        },
        number | null
      >[]
    >("bucket"))
      expect(
        bucketPick(
          Buffer.from(i.randomness, "hex"),
          BigInt(i.seq),
          i.pack,
          i.kind,
          BigInt(i.value),
          buckets(i.buckets),
          i.backing,
        ),
      ).toBe(output);
  });
  it("carve floor, empty input and u64 extremes", () => {
    for (const { input: i, output } of vectors<
      Vector<{ amount: string; cost: string; value: string }, unknown>[]
    >("carve"))
      expect(
        decimalJson(carve(BigInt(i.amount), BigInt(i.cost), BigInt(i.value))),
      ).toEqual(output);
  });
  it("coverage matches Rust's atomic reservations including D12", () => {
    const samples =
      vectors<
        Vector<
          { price: string; qty: number; buckets: JsonBucket[] },
          { backing: number[] | null; buckets: JsonBucket[] }
        >[]
      >("coverage");
    for (const { input, output } of samples) {
      const initial = buckets(input.buckets);
      const before = decimalJson(initial);
      const backing = coverage(BigInt(input.price), input.qty, initial);
      expect(backing).toEqual(output.backing);
      expect(decimalJson(initial)).toEqual(before);
      const after = initial.map((bucket) => ({ ...bucket }));
      if (backing)
        for (const index of backing)
          after[index]!.reserved += tierValue(BigInt(input.price), 4);
      expect(decimalJson(after)).toEqual(decimalJson(buckets(output.buckets)));
    }
  });
  it("maxQty matches coverage reservation and dust buffer", () => {
    for (const { input: i, output } of vectors<
      Vector<
        {
          edition: number;
          deckLen: number;
          reservedDust: string;
          buckets: JsonBucket[];
        },
        number
      >[]
    >("maxqty"))
      expect(
        maxQty(
          i.edition,
          i.deckLen,
          BigInt(i.reservedDust),
          buckets(i.buckets),
        ),
      ).toBe(output);
  });
});
describe("integer accounting and D12", () => {
  it("conserves every split, including values above JS's integer precision", () => {
    for (const price of [
      0n,
      1n,
      101n,
      (1n << 64n) - 1n,
      ...PACK_EDITIONS.map((e) => e.priceLamports),
    ]) {
      const s = splitPack(price);
      expect(
        s.stock + s.team + s.referral + s.burn + s.jackpot + 4n * s.royalty,
      ).toBe(price);
    }
  });
  it("matches the independent encoding sanity cases", () => {
    expect(drawTier(new Uint8Array(32), 1n, 0, 0).t).toBe(786467289);
    expect(drawTier(new Uint8Array(32), 1n, 1, 0)).toMatchObject({
      t: 67122303,
      tier: 2,
    });
    expect(drawTier(new Uint8Array(32).fill(255), 7n, 3, 0).t).toBe(535533360);
    expect(
      [0, 1, 2, 3].map((k) => dustIndex(new Uint8Array(32), 1n, 0, k, 1000)),
    ).toEqual([223, 200, 475, 529]);
  });
  it("does not activate Spotlight, including if its reserved mask is supplied", () => {
    for (let edition = 0; edition < PACK_EDITIONS.length; edition++)
      expect(segments(edition, 7, true)[1]).toBe(0);
  });
  it("D12 skips a coarse Major and chooses another qualifying bucket", () => {
    const coarse: MathBucket = {
      amount: 1n,
      cost: 2000000000n,
      reserved: 0n,
      class: 1,
      enabled: 1,
    };
    const qualified = { ...coarse, amount: 100n };
    expect(coverageGranularity(PACK_EDITIONS[0].priceLamports, coarse)).toBe(
      false,
    );
    expect(coverage(PACK_EDITIONS[0].priceLamports, 1, [coarse])).toBeNull();
    expect(maxQty(0, 100, 0n, [coarse])).toBe(0);
    expect(
      coverage(PACK_EDITIONS[0].priceLamports, 1, [coarse, qualified]),
    ).toEqual([1]);
  });
  it("carving preserves the token granularity for all remaining covered tiers", () => {
    const price = PACK_EDITIONS[0].priceLamports;
    for (let amount = 40n; amount <= 100n; amount++) {
      let b: MathBucket = {
        amount,
        cost: 2000000000n,
        reserved: 0n,
        class: 1,
        enabled: 1,
      };
      for (const tier of [1, 2, 3]) {
        const c = carve(b.amount, b.cost, tierValue(price, tier));
        expect(c).not.toBeNull();
        b = { ...b, amount: c!.amount, cost: c!.cost };
        expect(coverageGranularity(price, b)).toBe(true);
      }
    }
  });
  it("rotates all four hour fields once; jumps clear the prior hour", () => {
    const m = {
      hour_index: 1n,
      hit_out_this_hour: 10n,
      hit_out_last_hour: 5n,
      sb_paid_hour: 77n,
      sol_at_hour_start: 88n,
      stock_sol: 99n,
    };
    expect(rotateHour(m, 7199n)).toEqual(m);
    expect(rotateHour(m, 7200n)).toEqual({
      ...m,
      hour_index: 2n,
      hit_out_this_hour: 0n,
      hit_out_last_hour: 10n,
      sb_paid_hour: 0n,
      sol_at_hour_start: 99n,
    });
    expect(rotateHour(m, 10800n).hit_out_last_hour).toBe(0n);
    expect(rotateHour(m, -1n).hour_index).toBe(0n);
    expect(m.sb_paid_hour).toBe(77n);
  });
  it("allocates unused nonces out of order without replay or overflow", () => {
    expect(feedNonces(10, 0b101, 3)).toEqual([11, 13, 14]);
    expect(() => feedNonces(10, 65535, 1)).toThrow();
    expect(feedNonces(0xffffffff, 0, 1)).toEqual([0xffffffff]);
    expect(() => feedNonces(0xffffffff, 0, 2)).toThrow();
  });
  it("rent estimates follow each supplied sysvar rate", () => {
    for (const rate of RENT_TEST_RATES_LAMPORTS_PER_BYTE) {
      const d = deposits(BigInt(rate));
      expect(d.deckEntry).toBe(80n * BigInt(rate));
      expect(d.cardSlot).toBe(56n * BigInt(rate));
      expect(d.pull(10)).toBe(2304n * BigInt(rate));
    }
  });
});
