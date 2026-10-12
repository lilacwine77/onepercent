import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Ed25519Program, PublicKey, Transaction } from "@solana/web3.js";
import {
  binderHeaderLayout,
  cardLayout,
  decodeBinder,
  feedBackIx,
  sellBackIx,
  sellBackMessage,
  closeBinderIx,
  withdrawOwedIx,
} from "@onepercent/sdk";
import { SellBackQuoteResponse } from "@onepercent/sdk/api";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { identifyCards, type Binder } from "../adapters/cards";
import {
  buildCardFeeds,
  buildCardRedeems,
  buildCardSell,
  buildCardsExit,
  checkedSellQuote,
} from "./cards";
import { rebindCards, serialSellQuote } from "./card-actions";

const owner = new PublicKey(new Uint8Array(32).fill(1));
const mint = new PublicKey(new Uint8Array(32).fill(2));
const signer = new PublicKey(new Uint8Array(32).fill(3));
const options = { wallet: owner, blockhash: PublicKey.default.toBase58() };
const empty = decodeBinder(binderHeaderLayout.encode({ owner }));
function fixture(count: number, kind = 1): Binder {
  const cards = Array.from({ length: count }, (_, index) => {
    const data = binderHeaderLayout.encode();
    cardLayout.write(data, 0, {
      mint,
      amount: BigInt(index + 1),
      value: 50_000_000n,
      kind,
      seq_lo: index,
    });
    return cardLayout.read(data, 0);
  });
  return { ...empty, len: count, cards };
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function quoteFixture(binder = fixture(1)) {
  const cards = identifyCards(binder.cards).sort(
    (a, b) => b.cardIndex - a.cardIndex,
  );
  const quoteLamports = 49_999_999n;
  const totalAmount = cards.reduce((sum, card) => sum + card.amount, 0n);
  const stockedValue = cards.reduce((sum, card) => sum + card.value, 0n);
  const message = sellBackMessage({
    programId: PROGRAM_ID,
    owner,
    mint,
    cards: cards.map((card) => ({
      index: card.cardIndex,
      amount: card.amount,
    })),
    totalAmount,
    quoteLamports,
    expiry: 150n,
    nonce: binder.sb_nonce,
  });
  return {
    binder,
    cards,
    response: SellBackQuoteResponse.parse({
      ok: true,
      asOfSlot: 1,
      quote: {
        owner: owner.toBase58(),
        mint: mint.toBase58(),
        cards: cards.map((card) => ({
          index: card.cardIndex,
          amount: `${card.amount}`,
        })),
        totalAmount: `${totalAmount}`,
        quoteLamports: `${quoteLamports}`,
        stockedValueLamports: `${stockedValue}`,
        valueLamports: `${quoteLamports}`,
        payoutLamports: "43499999",
        expiry: 150,
        nonce: binder.sb_nonce,
        bucketClass: "MAJOR",
        message: b64(message),
        signature: b64(new Uint8Array(64).fill(1)),
        signer: signer.toBase58(),
        router: "fixture",
        requestId: "fixture",
      },
    }),
  };
}

describe("P0 My cards transaction fixtures", () => {
  it("binds every quote field to the selected chain cards and the quote role", () => {
    const f = quoteFixture();
    const quote = checkedSellQuote({
      ...f,
      wallet: owner,
      signer,
      nowTs: 100n,
    });
    expect(quote.payoutLamports).toBe(43_499_999n);
    expect(() =>
      checkedSellQuote({ ...f, wallet: owner, signer: mint, nowTs: 100n }),
    ).toThrow("errors.cardMoved");
    expect(() =>
      checkedSellQuote({ ...f, wallet: owner, signer, nowTs: 151n }),
    ).toThrow("feed.state.quoteExpired");
    if (!f.response.ok) throw new Error("fixture");
    const response = f.response;
    expect(() =>
      checkedSellQuote({
        ...f,
        response: {
          ...response,
          quote: { ...response.quote, payoutLamports: "43499998" },
        },
        wallet: owner,
        signer,
        nowTs: 100n,
      }),
    ).toThrow("errors.generic");
  });
  it("composes the SDK Ed25519 check followed by the P0 Sell builder exactly", () => {
    const f = quoteFixture();
    const quote = checkedSellQuote({
      ...f,
      wallet: owner,
      signer,
      nowTs: 100n,
    });
    const cards = f.cards.map((card) => ({
      ...card,
      tokenProgram: TOKEN_PROGRAM_ID,
    }));
    const tx = buildCardSell({ ...options, cards, quote }) as Transaction;
    expect(tx.instructions[0]!.programId.equals(Ed25519Program.programId)).toBe(
      true,
    );
    expect(tx.instructions[1]).toEqual(
      sellBackIx(PROGRAM_ID, {
        owner,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        cards: [{ index: 0, amount: 1n }],
        quoteLamports: 49_999_999n,
        expiry: 150n,
        nonce: 0,
        attIx: 0,
      }),
    );
  });
  it("maps a refusal to closed Sell without a second sale route", () => {
    const f = quoteFixture();
    expect(() =>
      checkedSellQuote({
        ...f,
        wallet: owner,
        signer,
        nowTs: 100n,
        response: {
          ok: false,
          asOfSlot: 1,
          reason: "BUCKET_DISABLED",
        },
      }),
    ).toThrow("cards.sell.refusal.coin");
  });
  it("builds nine Dust Cards descending as P0 batches of eight then one", () => {
    const cards = identifyCards(fixture(9, 0).cards);
    const txs = buildCardFeeds({ ...options, cards }) as Transaction[];
    expect(txs).toHaveLength(2);
    expect(txs[0]!.instructions[0]).toEqual(
      feedBackIx(PROGRAM_ID, { owner, cardIndices: [8, 7, 6, 5, 4, 3, 2, 1] }),
    );
    expect(txs[1]!.instructions[0]).toEqual(
      feedBackIx(PROGRAM_ID, { owner, cardIndices: [0] }),
    );
    expect(() =>
      buildCardFeeds({ ...options, cards: identifyCards(fixture(1, 1).cards) }),
    ).toThrow("errors.cardMoved");
  });
  it("uses the M1 Redeem builder for every card kind, with nine descending cards", () => {
    const cards = identifyCards(fixture(9, 6).cards).map((card) => ({
      ...card,
      tokenProgram: TOKEN_PROGRAM_ID,
    }));
    expect(buildCardRedeems({ ...options, cards })).toHaveLength(2);
  });
  it("builds owed and close exits with only the wallet and Binder accounts", () => {
    const owed = buildCardsExit({
      ...options,
      binder: { ...empty, sol_owed: 5n },
      action: "withdraw_owed",
    }) as Transaction;
    const close = buildCardsExit({
      ...options,
      binder: empty,
      action: "close_my_cards",
    }) as Transaction;
    expect(owed.instructions).toEqual([withdrawOwedIx(PROGRAM_ID, { owner })]);
    expect(close.instructions).toEqual([closeBinderIx(PROGRAM_ID, { owner })]);
    expect(owed.instructions[0]!.keys).toHaveLength(2);
    expect(close.instructions[0]!.keys).toHaveLength(2);
    expect(() =>
      buildCardsExit({
        ...options,
        binder: { ...empty, reserved: 1 },
        action: "close_my_cards",
      }),
    ).toThrow("errors.cardMoved");
  });
  it("rebinds remaining identical cards after a partial confirmed removal", () => {
    const cards = fixture(1).cards;
    const selected = identifyCards([cards[0]!, cards[0]!]);
    expect(
      rebindCards(identifyCards(cards), [selected[1]!])[0]!.cardIndex,
    ).toBe(0);
    expect(() => rebindCards(identifyCards(cards), selected)).toThrow(
      "errors.cardMoved",
    );
  });
  it("serializes quotes across controllers for one Binder and recovers after a refusal", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const first = serialSellQuote("binder", async () => {
      calls.push("first");
      await blocked;
      throw new Error("refused");
    });
    const second = serialSellQuote("binder", async () => {
      calls.push("second");
      return 2;
    });
    const separate = serialSellQuote("other", async () => {
      calls.push("other");
      return 1;
    });
    await separate;
    expect(calls).toEqual(["first", "other"]);
    release();
    await expect(first).rejects.toThrow("refused");
    await expect(second).resolves.toBe(2);
    expect(calls).toEqual(["first", "other", "second"]);
  });
});
