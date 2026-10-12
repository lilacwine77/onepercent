import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { bulkOptions } from "../experience";
import {
  binderHeaderLayout,
  decodeBinder,
  cardLayout,
  configLayout,
  machineLayout,
} from "@onepercent/sdk";
import {
  actionGates,
  binderClosable,
  cardBatches,
  cardRows,
  identifyCards,
  resolveCards,
  sellRefusal,
  type Binder,
} from "./cards";
const mint = new PublicKey(new Uint8Array(32).fill(7));
const card = (kind = 0, seq = 1) =>
  cardLayout.read(cardLayoutBytes(kind, seq), 0);
function cardLayoutBytes(kind: number, seq: number) {
  const bytes = binderHeaderLayout.encode();
  cardLayout.write(bytes, 0, {
    mint,
    amount: 1_000_000n,
    kind,
    seq_lo: seq,
    value: 100n,
  });
  return bytes;
}
const binder = (cards = [card()]): Binder => ({
  ...decodeBinder(binderHeaderLayout.encode()),
  cards,
  len: cards.length,
});
const config = configLayout.decode(configLayout.encode());
const machine = machineLayout.decode(
  machineLayout.encode({ phase: 3, end_ts: 100n }),
);
const gates = { config, machine, nowTs: 10n, sell: true, feed: true };

describe("live card models", () => {
  it("identifies duplicates and resolves current swap-remove indices", () => {
    const a = card(1, 1),
      b = card(2, 2);
    const ids = identifyCards([a, b, a]);
    expect(ids.map((row) => row.cardId.split(":").at(-1))).toEqual([
      "0",
      "0",
      "1",
    ]);
    expect(resolveCards(binder([b, a]), [ids[0]!.cardId])[0]!.cardIndex).toBe(
      1,
    );
    expect(() => resolveCards(binder([b]), [ids[0]!.cardId])).toThrow(
      "errors.cardMoved",
    );
  });
  it("keeps nine redeems descending over the transaction boundary", () => {
    expect(
      cardBatches(
        identifyCards(Array.from({ length: 9 }, (_, i) => card(0, i))),
      ).map((batch) => batch.map((c) => c.cardIndex)),
    ).toEqual([[8, 7, 6, 5, 4, 3, 2, 1], [0]]);
  });
  it("offers D30 actions and always preserves every Redeem exit", () => {
    for (let kind = 0; kind <= 8; kind++) {
      const open = actionGates(kind, gates);
      expect(open.redeem.open).toBe(true);
      expect(open.sellBack.open).toBe(kind >= 1 && kind <= 4);
      expect(open.feedBack.open).toBe(kind === 0);
      expect(
        actionGates(kind, {
          ...gates,
          config: null,
          machine: null,
          sell: false,
          feed: false,
        }).redeem.open,
      ).toBe(true);
    }
  });
  it("closes risk actions at pause and end time", () => {
    expect(actionGates(1, { ...gates, nowTs: 100n }).sellBack.open).toBe(false);
    expect(
      actionGates(0, { ...gates, config: { ...config, guardian_paused: 2 } })
        .feedBack.open,
    ).toBe(false);
  });
  it("checks every close condition independently, including Final claim bits", () => {
    const empty = binder([]);
    expect(binderClosable(empty)).toBe(true);
    for (const patch of [
      { reserved: 1 },
      { fresh_in_deck: 1 },
      { sol_owed: 1n },
      { season_spend: 1n, flags: 1 },
    ])
      expect(binderClosable({ ...empty, ...patch })).toBe(false);
    expect(binderClosable({ ...empty, season_spend: 1n, flags: 3 })).toBe(true);
  });
  it("never puts a market value on a hit and expires Sell quotes", () => {
    const selected = binder([card(1)]);
    const id = identifyCards(selected.cards)[0]!.cardId;
    const rows = cardRows({
      ...gates,
      binder: selected,
      decimals: new Map([[mint.toBase58(), 6]]),
      values: [
        {
          mint: mint.toBase58(),
          amount: 1_000_000n,
          symbol: "TEST",
          name: "Test",
          decimals: 6,
          logo: null,
          value: {
            status: "ok",
            lamports: 999_999n,
            capped: true,
            label: "est",
          },
        },
      ],
      sellQuotes: new Map([[id, { lamports: 87n, expiresAt: 9n }]]),
    });
    expect(rows[0]!.value).toEqual({ kind: "none" });
    expect(rows[0]!.amountUi).toBe("1");
    expect(rows[0]!.sellBack).toBeNull();
  });
  it("maps signer refusals to one-line closed Sell copy", () => {
    expect(sellRefusal("CAP")).toBe("cards.sell.refusal.coin");
    expect(sellRefusal("QUOTE_UNAVAILABLE")).toBe("cards.sell.refusal.noPrice");
  });
  it("keeps unquoted hits in Sell all and waits for the grouped preview before displaying a payout", () => {
    const rows = cardRows({ ...gates, binder: binder([card(1), card(2)]) });
    const sell = bulkOptions(rows, null).find(
      (option) => option.action === "sell_back",
    );
    expect(sell).toEqual({
      action: "sell_back",
      ids: rows.map((row) => row.cardId),
      of: 2,
      lamports: null,
    });
  });
});
