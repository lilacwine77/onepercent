// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { FEED_RULES, WEB } from "@onepercent/config";
import { ValuesResponse } from "@onepercent/web-api";
import { feedBackValues } from "./feed-back-values";
import type { SelectedCard } from "../adapters/cards";
const api = vi.hoisted(() => vi.fn());
vi.mock("../data/api", () => ({ api }));
const mint = new PublicKey(new Uint8Array(32).fill(1));
const card = (id: number): SelectedCard => ({
  cardId: `${id}`,
  cardIndex: id,
  mint,
  amount: BigInt(id + 1),
  value: 0n,
  kind: 0,
  edition: 0,
  flags: 0,
  _pad: 0,
  seq_lo: id,
});
const item = (
  card: SelectedCard,
  label: "est" | "if_sold_now",
  value: bigint,
) => ({
  mint: card.mint.toBase58(),
  amount: card.amount.toString(),
  symbol: "COIN",
  name: "Coin",
  decimals: 6,
  logo: null,
  value: { status: "ok", label, capped: false, lamports: value.toString() },
});
beforeEach(() => {
  api.mockReset();
});
it("requests exact selected amounts in now mode and raises the configured threshold guard", async () => {
  const selected = [card(0), card(1)];
  api.mockResolvedValue(
    ValuesResponse.parse({
      items: [
        item(selected[0]!, "if_sold_now", FEED_RULES.confirmAboveLamports),
        item(selected[1]!, "if_sold_now", FEED_RULES.confirmAboveLamports + 1n),
      ],
    }),
  );
  const result = await feedBackValues(selected);
  expect(JSON.parse(api.mock.calls[0]![2].body)).toEqual({
    mode: "now",
    items: selected.map((entry) => ({
      mint: entry.mint.toBase58(),
      amount: entry.amount.toString(),
    })),
  });
  expect(result["0"]?.needsConfirm).toBe(false);
  expect(result["1"]?.needsConfirm).toBe(true);
  expect(result["1"]?.value).toEqual({
    kind: "now",
    lamports: FEED_RULES.confirmAboveLamports + 1n,
  });
});
it("never promotes estimates, mismatched amounts or unavailable quotes into executable figures", async () => {
  const selected = [card(0), card(1), card(2)];
  api.mockResolvedValue(
    ValuesResponse.parse({
      items: [
        item(selected[0]!, "est", 900000000n),
        item({ ...selected[1]!, amount: 999n }, "if_sold_now", 900000000n),
      ],
    }),
  );
  const expected = Object.fromEntries(
    selected.map((entry) => [
      entry.cardId,
      { value: { kind: "none" }, needsConfirm: true },
    ]),
  );
  expect(await feedBackValues(selected)).toEqual(expected);
  api.mockRejectedValue(new Error("API unavailable"));
  expect(await feedBackValues(selected)).toEqual(expected);
});
it("bounds every request and retains the generic guard for missing batch rows", async () => {
  api.mockResolvedValue({ items: [] });
  const selected = Array.from({ length: WEB.valuesBatchMax + 1 }, (_, index) =>
    card(index),
  );
  const result = await feedBackValues(selected);
  expect(api).toHaveBeenCalledTimes(2);
  expect(JSON.parse(api.mock.calls[0]![2].body).items).toHaveLength(
    WEB.valuesBatchMax,
  );
  expect(Object.keys(result)).toHaveLength(selected.length);
  expect(
    Object.values(result).every(
      (entry) => entry.needsConfirm && entry.value.kind === "none",
    ),
  ).toBe(true);
});
