import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  BPS_DENOMINATOR,
  PACK_EDITIONS,
  PAUSE_BITS,
  SELL_BACK,
  TX_LIMITS,
} from "@onepercent/config";
import { MAX_SELL_BACK_CARDS, PHASE } from "../src/constants.js";
import { U64_MAX } from "../src/bytes.js";
import { coverageGranularity, tierValue } from "../src/math/index.js";
import {
  sellBackChecks,
  sellBackEconomics,
  sellBackPayout,
} from "../src/math/sellback.js";
import type {
  SellBackCheckState,
  SellBackEconomicState,
  SellBackError,
} from "../src/math/sellback.js";
import { decimalJson, vectors } from "./vectors.js";

interface GoldenVectors {
  payouts: {
    name: string;
    stockedValue: string;
    quoteLamports: string;
    value: string;
    payout: string;
    margin: string;
    error: string | null;
  }[];
  checks: {
    name: string;
    input: Record<string, string | string[]> & { bucket_costs: string[] };
    expected: { ok: boolean; error?: string; [name: string]: unknown };
  }[];
}

const golden = vectors<GoldenVectors>("sellback");
const mint = new PublicKey(new Uint8Array(32).fill(19));
function context() {
  const bucket = {
    mint,
    class: 1,
    enabled: 1,
    amount: 10_000n,
    cost: 0n,
    cap: 100_000_000_000n,
    reserved: 0n,
  };
  const cards = [{ mint, kind: 1, amount: 100n, value: 50_000_000n }];
  const state: SellBackCheckState = {
    stock_sol: 100_000_000_000n,
    team_sol: 0n,
    hour_index: 1n,
    hit_out_this_hour: 0n,
    hit_out_last_hour: 0n,
    sb_paid_hour: 0n,
    sol_at_hour_start: 100_000_000_000n,
    buckets: [bucket],
    phase: PHASE.onAir,
    end_ts: 100_000n,
    exec: { kind: 0 },
    config: { admin_paused: 0, guardian_paused: 0, disabled_roles: 0 },
    binder: { len: cards.length, sb_nonce: 0 },
    mintSafe: true,
    vaultAmount: 10_100n,
    ledgerAccounted: 10_100n,
    attestationValid: true,
  };
  const quote = {
    mint,
    cards: [{ index: 0, amount: 100n }],
    quoteLamports: 50_000_000n,
    expiry: 3_660n,
    nonce: 0,
  };
  return { state, bucket, cards, quote, now: 3_600n };
}
type Context = ReturnType<typeof context>;
const check = (c: Context) =>
  sellBackChecks(c.state, c.bucket, c.cards, c.quote, c.now);

describe("Sell back Rust golden parity", () => {
  it.each(golden.payouts)("payout $name", (v) => {
    const calculate = () =>
      sellBackPayout(BigInt(v.stockedValue), BigInt(v.quoteLamports));
    if (v.error) expect(calculate).toThrow(v.error);
    else
      expect(decimalJson(calculate())).toEqual({
        value: v.value,
        payout: v.payout,
        margin: v.margin,
      });
  });

  it.each(golden.checks)("economic check $name", ({ input, expected }) => {
    const n = (key: string) => BigInt(input[key] as string);
    const state: SellBackEconomicState = {
      stock_sol: n("stock_sol"),
      team_sol: n("team_sol"),
      hour_index: n("hour_index"),
      hit_out_this_hour: n("hit_out_this_hour"),
      hit_out_last_hour: n("hit_out_last_hour"),
      sb_paid_hour: n("sb_paid_hour"),
      sol_at_hour_start: n("sol_at_hour_start"),
      buckets: input.bucket_costs.map((cost) => ({ cost: BigInt(cost) })),
    };
    const before = structuredClone(state);
    const calculate = () =>
      sellBackEconomics(
        state,
        { cost: n("bucket_cost"), cap: n("bucket_cap") },
        n("stocked_value"),
        n("quote_lamports"),
        n("now"),
      );
    if (!expected.ok) expect(calculate).toThrow(expected.error);
    else {
      const { margin, ...plan } = calculate();
      expect(margin).toBe(plan.value - plan.payout);
      expect(decimalJson({ ok: true, ...plan })).toEqual(expected);
    }
    expect(state).toEqual(before);
  });

  it("bounds payout for every u64 bit boundary", () => {
    for (let bit = 1n; bit < 64n; bit++)
      for (const stocked of [(1n << bit) - 1n, 1n << bit, (1n << bit) + 1n]) {
        if (stocked < 2n) continue;
        const result = sellBackPayout(stocked, U64_MAX);
        expect(result.payout).toBe(
          (stocked * BigInt(SELL_BACK.payoutBps)) / BigInt(BPS_DENOMINATOR),
        );
        expect(result.payout + result.margin).toBe(stocked);
      }
    expect(() => sellBackPayout(U64_MAX + 1n, 2n)).toThrow("MathOverflow");
    expect(() => sellBackPayout(2n, -1n)).toThrow("MathOverflow");
  });
});

describe("Sell back preflight", () => {
  const refusals: [SellBackError, (c: Context) => void][] = [
    [
      "Paused",
      (c) => {
        c.state.config = {
          ...c.state.config,
          admin_paused: PAUSE_BITS.sellBack,
        };
      },
    ],
    [
      "Paused",
      (c) => {
        c.state.config = {
          ...c.state.config,
          guardian_paused: PAUSE_BITS.sellBack,
        };
      },
    ],
    [
      "WrongPhase",
      (c) => {
        c.state.phase = PHASE.buysClosed;
      },
    ],
    [
      "SeasonOver",
      (c) => {
        c.state.end_ts = c.now;
      },
    ],
    [
      "RoleDisabled",
      (c) => {
        c.state.config = { ...c.state.config, disabled_roles: 1 << 6 };
      },
    ],
    [
      "ExecInFlight",
      (c) => {
        c.state.exec = { kind: 1 };
      },
    ],
    [
      "InvalidArgument",
      (c) => {
        c.quote.cards = [];
      },
    ],
    [
      "InvalidArgument",
      (c) => {
        c.quote.quoteLamports = 0n;
      },
    ],
    [
      "InvalidArgument",
      (c) => {
        c.quote.cards[0]!.index = -1;
      },
    ],
    [
      "CardMoved",
      (c) => {
        c.quote.cards[0]!.index = 1;
      },
    ],
    [
      "CardMoved",
      (c) => {
        c.quote.cards[0]!.amount = 99n;
      },
    ],
    [
      "CardMoved",
      (c) => {
        c.cards[0]!.mint = PublicKey.default;
      },
    ],
    [
      "NotSellBackable",
      (c) => {
        c.cards[0]!.kind = 0;
      },
    ],
    [
      "NotSellBackable",
      (c) => {
        c.cards[0]!.kind = 5;
      },
    ],
    [
      "BucketInvalid",
      (c) => {
        c.bucket.class = 0;
      },
    ],
    [
      "BucketInvalid",
      (c) => {
        c.bucket.mint = PublicKey.default;
      },
    ],
    [
      "BucketDisabled",
      (c) => {
        c.bucket.enabled = 0;
      },
    ],
    [
      "MintNotSafe",
      (c) => {
        c.state.mintSafe = false;
      },
    ],
    [
      "VaultInvariant",
      (c) => {
        c.state.vaultAmount--;
      },
    ],
    [
      "AttestationInvalid",
      (c) => {
        c.state.attestationValid = false;
      },
    ],
    [
      "AttestationExpired",
      (c) => {
        c.quote.expiry = c.now - 1n;
      },
    ],
    [
      "AttestationExpired",
      (c) => {
        c.quote.expiry++;
      },
    ],
    [
      "AttestationReplay",
      (c) => {
        c.quote.nonce++;
      },
    ],
    [
      "MathOverflow",
      (c) => {
        c.quote.nonce = 0xffffffff;
        c.state.binder.sb_nonce = 0xffffffff;
      },
    ],
    [
      "MathOverflow",
      (c) => {
        c.bucket.amount = U64_MAX;
      },
    ],
  ];
  it.each(refusals)("returns %s without changing state", (error, change) => {
    const c = context();
    change(c);
    const before = decimalJson(c);
    expect(check(c)).toEqual({ ok: false, error });
    expect(decimalJson(c)).toEqual(before);
  });

  it("accepts every eligible kind, both TTL boundaries and unrelated pause bits", () => {
    for (const kind of [1, 2, 3, 4])
      for (const bucketClass of [1, 2]) {
        const c = context();
        c.cards[0]!.kind = kind;
        c.bucket.class = bucketClass;
        c.state.config = {
          ...c.state.config,
          guardian_paused: PAUSE_BITS.feed | PAUSE_BITS.rip,
        };
        c.quote.expiry =
          c.now +
          BigInt(
            bucketClass === 1
              ? SELL_BACK.quoteTtlSeconds.major
              : SELL_BACK.quoteTtlSeconds.trending,
          );
        const result = check(c);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.nonce).toBe(1);
          expect(result.totalAmount).toBe(100n);
          expect(result.payout).toBe(43_500_000n);
        }
        c.quote.expiry++;
        expect(check(c)).toEqual({ ok: false, error: "AttestationExpired" });
      }
  });

  it("pins eight descending cards and refuses duplicates, ascending order and nine", () => {
    expect(MAX_SELL_BACK_CARDS).toBe(8);
    expect(MAX_SELL_BACK_CARDS).toBe(TX_LIMITS.redeemPerTx);
    const c = context();
    c.cards = Array.from({ length: 9 }, () => ({ ...c.cards[0]! }));
    c.state.binder.len = c.cards.length;
    c.quote.cards = Array.from({ length: 8 }, (_, i) => ({
      index: 7 - i,
      amount: 100n,
    }));
    expect(check(c).ok).toBe(true);
    c.quote.cards.reverse();
    expect(check(c)).toEqual({ ok: false, error: "InvalidArgument" });
    c.quote.cards = Array.from({ length: 8 }, () => ({
      index: 0,
      amount: 100n,
    }));
    expect(check(c)).toEqual({ ok: false, error: "InvalidArgument" });
    c.quote.cards = Array.from({ length: 9 }, (_, i) => ({
      index: 8 - i,
      amount: 100n,
    }));
    expect(check(c)).toEqual({ ok: false, error: "InvalidArgument" });
  });

  it("rejects an overflowing amount sum before invalid attestation evidence", () => {
    const c = context();
    c.cards = [
      { ...c.cards[0]!, amount: U64_MAX },
      { ...c.cards[0]!, amount: 1n },
    ];
    c.state.binder.len = 2;
    c.quote.cards = [
      { index: 1, amount: 1n },
      { index: 0, amount: U64_MAX },
    ];
    c.state.attestationValid = false;
    expect(check(c)).toEqual({ ok: false, error: "MathOverflow" });
  });

  it("preserves reserved OG coverage when an AH Black Foil returns", () => {
    const c = context();
    c.bucket.amount = 30n;
    c.bucket.cost = 1_500_000_000n;
    c.bucket.reserved = 1_500_000_000n;
    c.cards[0] = { mint, amount: 30n, value: 15_000_000_000n, kind: 4 };
    c.quote.cards[0]!.amount = 30n;
    c.quote.quoteLamports = 15_000_000_000n;
    const before = decimalJson(c);
    expect(coverageGranularity(PACK_EDITIONS[0].priceLamports, c.bucket)).toBe(
      true,
    );
    expect(check(c)).toEqual({ ok: false, error: "ReservedCapacity" });
    expect(decimalJson(c)).toEqual(before);
    c.bucket.reserved = 0n;
    expect(check(c).ok).toBe(true);
  });

  it("preserves every edition previously deliverable by a reserved bucket", () => {
    for (const edition of PACK_EDITIONS) {
      const c = context();
      c.bucket.amount = 1n;
      c.bucket.cost = tierValue(edition.priceLamports, 1);
      c.bucket.reserved = c.bucket.cost;
      c.cards[0] = { mint, amount: 1n, value: 15_000_000_000n, kind: 4 };
      c.quote.cards[0]!.amount = 1n;
      c.quote.quoteLamports = c.cards[0]!.value;
      expect(coverageGranularity(edition.priceLamports, c.bucket)).toBe(true);
      expect(check(c)).toEqual({ ok: false, error: "ReservedCapacity" });
    }
  });

  it("allows a return that keeps reserved coverage and ignores already unavailable editions", () => {
    const c = context();
    c.bucket.reserved = 1_500_000_000n;
    c.bucket.cost = c.bucket.reserved;
    c.bucket.amount = 30n;
    expect(check(c).ok).toBe(true);
    c.bucket.amount = 1n;
    c.bucket.cost = 15_000_000_000n;
    c.cards[0]!.amount = 1n;
    c.quote.cards[0]!.amount = 1n;
    expect(
      PACK_EDITIONS.every(
        (edition) => !coverageGranularity(edition.priceLamports, c.bucket),
      ),
    ).toBe(true);
    expect(check(c).ok).toBe(true);
  });
});
