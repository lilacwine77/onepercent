import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createJupiterSwapClient } from "../src/jupiter/swap.js";
import {
  HIT_LIST,
  LAMPORTS_PER_SOL,
  MARKET,
  SELL_BACK,
  STOCK,
  TX_LIMITS,
  U16_MAX,
  U32_MAX,
  U64_MAX,
} from "../src/params.js";
import {
  createSellBackClient,
  parseSellBackQuote,
  quoteSellBackBatch,
  quoteSellBackCard,
  serializeSellBackQuote,
  type MachineSnapshot,
  type SellBackBatchInput,
  type SellBackBatchQuote,
  type SellBackCard,
} from "../src/sellback/quote.js";
import { fixtureFetch } from "../src/testing.js";
import {
  createValueClient,
  type ValueNowResult,
} from "../src/value/value-now.js";

const mint = HIT_LIST.launchMajors[0]!.mint;
const otherMint = HIT_LIST.launchMajors[1]!.mint;
const owner = "11111111111111111111111111111111";
const sol = LAMPORTS_PER_SOL;
const valueResult = (lamports: bigint): ValueNowResult => ({
  status: "ok",
  lamports,
  quoteLamports: lamports,
  capped: false,
  router: "metis",
  requestId: "pure-vector",
  fetchedAtMs: 1234,
});
const card = (patch: Partial<SellBackCard> = {}): SellBackCard => ({
  cardId: "card-a",
  cardIndex: 0,
  mint,
  amount: 1n,
  valueLamports: sol,
  kind: "silver",
  ...patch,
});
const input = (
  patch: Partial<SellBackBatchInput> = {},
): SellBackBatchInput => ({
  owner,
  cards: [card()],
  nonce: 1,
  nowTs: 7200,
  ...patch,
});
const snapshot = (patch: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  phase: "OnAir",
  endTs: 10_000,
  stockSolLamports: 100n * sol,
  stockBookLamports: 0n,
  hitOutLastHourLamports: 0n,
  sbHourIndex: 2,
  sbPaidHourLamports: 0n,
  stockSolAtHourStartLamports: 100n * sol,
  bucket: {
    mint,
    class: "MAJOR",
    enabled: true,
    bookCostLamports: 0n,
    capLamports: 1_000n * sol,
  },
  ...patch,
});
const quote = (amount: bigint = sol) => vi.fn(async () => valueResult(amount));
function requireQuote(
  result: Awaited<ReturnType<typeof quoteSellBackBatch>>,
): SellBackBatchQuote {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.quote;
}

describe("Sell back batch arithmetic", () => {
  // These pure arithmetic vectors list independently calculated floor results.
  it.each([
    [0n, 1n, 0n],
    [1n, 1n, 0n],
    [2n, 3n, 1n],
    [3n, 2n, 1n],
    [10n, 10n, 8n],
    [99n, 100n, 86n],
    [100n, 99n, 86n],
    [100n, 100n, 87n],
    [101n, 101n, 87n],
    [199n, 200n, 173n],
    [200n, 199n, 173n],
    [200n, 200n, 174n],
    [10_000n, 9_999n, 8_699n],
    [9_999n, 10_000n, 8_699n],
    [10_001n, 10_001n, 8_700n],
    [1_000_000_000n, 2_000_000_000n, 870_000_000n],
    [2_000_000_000n, 1_000_000_000n, 870_000_000n],
  ])("stocked %s, executable %s pays %s", async (stocked, live, expected) => {
    const values = quote(live);
    const result = requireQuote(
      await quoteSellBackBatch(
        input({
          cards: [
            card({ valueLamports: stocked / 2n }),
            card({
              cardId: "card-b",
              cardIndex: 1,
              amount: 2n,
              valueLamports: stocked - stocked / 2n,
            }),
          ],
        }),
        snapshot(),
        values,
      ),
    );
    expect(result.payoutLamports).toBe(expected);
    expect(result.stockedValueLamports).toBe(stocked);
    expect(result.valueLamports).toBe(stocked < live ? stocked : live);
    expect(result.quoteLamports).toBe(live);
    expect(result.amount).toBe(3n);
    expect(values).toHaveBeenCalledExactlyOnceWith(mint, 3n);
  });

  it.each([
    ["MAJOR", 60],
    ["TRENDING", 20],
  ] as const)("uses the %s TTL", async (bucketClass, ttl) => {
    const state = snapshot();
    state.bucket.class = bucketClass;
    const result = requireQuote(
      await quoteSellBackBatch(input(), state, quote()),
    );
    expect(result.expiresAt).toBe(7200 + ttl);
    expect(result.bucketClass).toBe(bucketClass);
    expect(result.owner).toBe(owner);
    expect(result.cards).toEqual([{ cardIndex: 0, amount: 1n }]);
    expect(result).toMatchObject({
      router: "metis",
      requestId: "pure-vector",
      quoteFetchedAtMs: 1234,
    });
  });

  it("puts the capped executable value in the message inputs", async () => {
    const result = requireQuote(
      await quoteSellBackBatch(input(), snapshot(), async () => ({
        ...valueResult(90n),
        status: "ok",
        quoteLamports: 100n,
        capped: true,
        lamports: 90n,
        router: "metis",
        requestId: "capped",
        fetchedAtMs: 1,
      })),
    );
    expect(result.quoteLamports).toBe(90n);
    expect(result.payoutLamports).toBe(78n);
  });

  it("quotes a recorded multi-card total with exactly one order request", async () => {
    const path = new URL(
      "./fixtures/jupiter/swap-sell-wif.json",
      import.meta.url,
    );
    const recorded = JSON.parse(readFileSync(path, "utf8")) as {
      recordedAt: string;
      request: { url: string };
      response: { body: { inAmount: string; outAmount: string } };
    };
    const url = new URL(recorded.request.url);
    const recordedMint = url.searchParams.get("inputMint")!;
    const total = BigInt(recorded.response.body.inAmount);
    const out = BigInt(recorded.response.body.outAmount);
    const fetch = vi.fn(fixtureFetch(path));
    const swap = createJupiterSwapClient({
      fetch,
      env: {
        pythHermesUrl: MARKET.pyth.defaultHermesUrl,
        jupiterApiKey: "fixture-test-credential",
      },
      clock: {
        nowMs: () => Date.parse(recorded.recordedAt),
        random: () => 0,
        sleep: () => new Promise(() => {}),
      },
    });
    const value = createValueClient({
      quoteSell: swap.quoteSell,
      getExitCap: async () => ({ kind: "none" }),
    });
    const state = snapshot();
    state.bucket.mint = recordedMint;
    const result = requireQuote(
      await createSellBackClient(value).quoteSellBackBatch(
        input({
          cards: [
            card({ mint: recordedMint, amount: total / 2n }),
            card({
              mint: recordedMint,
              cardId: "card-b",
              cardIndex: 1,
              amount: total - total / 2n,
            }),
          ],
        }),
        state,
      ),
    );
    expect(result.amount).toBe(total);
    expect(result.quoteLamports).toBe(out);
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URL(String(fetch.mock.calls[0]![0])).pathname).toBe(
      "/swap/v2/order",
    );
    expect(
      new URL(String(fetch.mock.calls[0]![0])).searchParams.get("amount"),
    ).toBe(total.toString());
  });
});

describe("Sell back refusal boundaries", () => {
  it("validates structural fields before any value call", async () => {
    const values = quote();
    const badInputs: SellBackBatchInput[] = [
      input({ nonce: -1 }),
      input({ nonce: U32_MAX + 1 }),
      input({ nonce: 0.5 }),
      input({ cards: [] }),
      input({ owner: "invalid" }),
      input({ cards: [card({ cardIndex: U16_MAX + 1 })] }),
      input({ cards: [card({ cardIndex: -1 })] }),
      input({ cards: [card({ amount: -1n })] }),
      input({ cards: [card({ valueLamports: U64_MAX + 1n })] }),
      input({ cards: [card(), card({ cardId: "duplicate-index" })] }),
      input({
        cards: Array.from({ length: TX_LIMITS.redeemPerTx + 1 }, (_, index) =>
          card({ cardIndex: index }),
        ),
      }),
      input({
        cards: [card({ amount: U64_MAX }), card({ cardIndex: 1, amount: 1n })],
      }),
    ];
    for (const bad of badInputs)
      expect(await quoteSellBackBatch(bad, snapshot(), values)).toEqual({
        ok: false,
        reason: "INVALID_INPUT",
      });
    expect(values).not.toHaveBeenCalled();
    expect(
      (
        await quoteSellBackBatch(
          input({ nonce: U32_MAX, cards: [card({ cardIndex: U16_MAX })] }),
          snapshot(),
          quote(),
        )
      ).ok,
    ).toBe(true);
  });

  it("checks phase, kinds, mint and bucket in that order before quoting", async () => {
    const values = quote();
    expect(
      await quoteSellBackBatch(
        input({ cards: [card({ kind: "jackpot", mint: otherMint })] }),
        snapshot({ phase: "Done" }),
        values,
      ),
    ).toMatchObject({ reason: "PHASE" });
    expect(
      (await quoteSellBackBatch(input({ nowTs: 9999 }), snapshot(), values)).ok,
    ).toBe(true);
    expect(
      await quoteSellBackBatch(input({ nowTs: 10_000 }), snapshot(), values),
    ).toMatchObject({ reason: "PHASE" });
    values.mockClear();
    for (const kind of ["jackpot", "one_percent", "dust", "spotlight"]) {
      expect(
        await quoteSellBackBatch(
          input({ cards: [card({ kind, mint: otherMint })] }),
          snapshot(),
          values,
        ),
      ).toMatchObject({ reason: "KIND" });
    }
    expect(
      await quoteSellBackBatch(
        input({ cards: [card(), card({ cardIndex: 1, mint: otherMint })] }),
        snapshot(),
        values,
      ),
    ).toMatchObject({ reason: "MINT" });
    const disabled = snapshot();
    disabled.bucket.enabled = false;
    expect(
      await quoteSellBackBatch(
        input({ cards: [card({ mint: otherMint })] }),
        disabled,
        values,
      ),
    ).toMatchObject({ reason: "MINT" });
    expect(await quoteSellBackBatch(input(), disabled, values)).toMatchObject({
      reason: "BUCKET_DISABLED",
    });
    expect(values).not.toHaveBeenCalled();
  });

  it("refuses unavailable, failed or zero executable values", async () => {
    for (const values of [
      quote(0n),
      async (): Promise<ValueNowResult> => ({
        status: "unavailable",
        reason: "NO_QUOTE",
      }),
      async (): Promise<ValueNowResult> => {
        throw new Error("synthetic provider failure");
      },
    ]) {
      expect(
        await quoteSellBackBatch(input(), snapshot(), values),
      ).toMatchObject({ reason: "QUOTE_UNAVAILABLE" });
    }
  });

  it.each([false, true])(
    "enforces the exact SOL floor with fill-first below=%s",
    async (below) => {
      const payout = 870_000_000n;
      const needed = (below ? payout : sol) + SELL_BACK.solFloorLamports;
      const state = snapshot({
        stockBookLamports: below
          ? STOCK.targetBaseLamports - 1n
          : STOCK.targetBaseLamports,
        stockSolLamports: needed,
      });
      expect((await quoteSellBackBatch(input(), state, quote())).ok).toBe(true);
      expect(
        await quoteSellBackBatch(
          input(),
          { ...state, stockSolLamports: needed - 1n },
          quote(),
        ),
      ).toMatchObject({ reason: "SOL_FLOOR" });
    },
  );

  it("includes the previous-hour hit outflow in the fill-first target", async () => {
    const target = STOCK.targetBaseLamports + 2n * sol;
    const state = snapshot({
      hitOutLastHourLamports: 2n * sol,
      stockBookLamports: target - 1n,
      stockSolLamports: 870_000_000n + SELL_BACK.solFloorLamports,
    });
    expect((await quoteSellBackBatch(input(), state, quote())).ok).toBe(true);
    expect(
      await quoteSellBackBatch(
        input(),
        { ...state, stockBookLamports: target },
        quote(),
      ),
    ).toMatchObject({ reason: "SOL_FLOOR" });
  });

  it.each([
    [10n * sol, 5n * sol],
    [20n * sol, 5n * sol],
    [100n * sol, 25n * sol],
  ])("enforces the hourly budget at start stock %s", async (base, budget) => {
    const state = snapshot({
      stockSolAtHourStartLamports: base,
      sbPaidHourLamports: budget - 870_000_000n,
    });
    expect((await quoteSellBackBatch(input(), state, quote())).ok).toBe(true);
    expect(
      await quoteSellBackBatch(
        input(),
        { ...state, sbPaidHourLamports: state.sbPaidHourLamports + 1n },
        quote(),
      ),
    ).toMatchObject({ reason: "HOURLY_BUDGET" });
  });

  it("resets the paid counter at the exact UTC-hour boundary", async () => {
    const state = snapshot({ sbHourIndex: 1, sbPaidHourLamports: 25n * sol });
    expect(
      await quoteSellBackBatch(input({ nowTs: 7199 }), state, quote()),
    ).toMatchObject({ reason: "HOURLY_BUDGET" });
    expect(
      (await quoteSellBackBatch(input({ nowTs: 7200 }), state, quote())).ok,
    ).toBe(true);
  });

  it("uses current stock SOL for a new hour instead of the previous base", async () => {
    const state = snapshot({
      sbHourIndex: 1,
      stockSolLamports: 8n * sol,
      stockSolAtHourStartLamports: 100n * sol,
    });
    expect(
      await quoteSellBackBatch(
        input({ cards: [card({ valueLamports: 6n * sol })] }),
        state,
        quote(6n * sol),
      ),
    ).toMatchObject({ reason: "HOURLY_BUDGET" });
    state.sbHourIndex = 2;
    expect(
      (
        await quoteSellBackBatch(
          input({ cards: [card({ valueLamports: 6n * sol })] }),
          state,
          quote(6n * sol),
        )
      ).ok,
    ).toBe(true);
  });

  it("applies bucket cap to the full added value with an inclusive boundary", async () => {
    const state = snapshot();
    state.bucket.bookCostLamports = 10n * sol;
    state.bucket.capLamports = 11n * sol;
    expect((await quoteSellBackBatch(input(), state, quote())).ok).toBe(true);
    state.bucket.capLamports -= 1n;
    expect(await quoteSellBackBatch(input(), state, quote())).toMatchObject({
      reason: "CAP",
    });
  });

  it("reports SOL floor before budget and budget before cap", async () => {
    const state = snapshot({
      stockSolLamports: 0n,
      sbPaidHourLamports: 100n * sol,
    });
    state.bucket.capLamports = 0n;
    expect(await quoteSellBackBatch(input(), state, quote())).toMatchObject({
      reason: "SOL_FLOOR",
    });
    state.stockSolLamports = 100n * sol;
    expect(await quoteSellBackBatch(input(), state, quote())).toMatchObject({
      reason: "HOURLY_BUDGET",
    });
  });
});

describe("Sell back quote JSON", () => {
  it("round-trips batch amounts as decimal strings through a strict schema", async () => {
    const result = requireQuote(
      await quoteSellBackBatch(input(), snapshot(), quote()),
    );
    const json = serializeSellBackQuote(result);
    expect(JSON.parse(json).amount).toBe("1");
    expect(JSON.parse(json).cards[0].amount).toBe("1");
    expect(parseSellBackQuote(json)).toEqual(result);
    for (const patch of [
      { extra: true },
      { amount: "01" },
      { amount: 1 },
      { payoutLamports: "-1" },
      { nonce: U32_MAX + 1 },
      { totalAmount: "2" },
      { cards: [{ cardIndex: 0, amount: "1", extra: true }] },
    ]) {
      expect(() =>
        parseSellBackQuote(JSON.stringify({ ...JSON.parse(json), ...patch })),
      ).toThrow();
    }
  });

  it("returns exactly the single-card shape and message inputs", async () => {
    const result = await quoteSellBackCard(
      card(),
      { owner, nonce: 1, nowTs: 7200 },
      snapshot(),
      quote(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(Object.keys(result.quote).sort()).toEqual(
      [
        "cardId",
        "mint",
        "amount",
        "payoutLamports",
        "expiresAt",
        "nonce",
        "owner",
        "cards",
        "totalAmount",
        "quoteLamports",
      ].sort(),
    );
    expect(parseSellBackQuote(serializeSellBackQuote(result.quote))).toEqual(
      result.quote,
    );
  });
});
