import "../test/setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SELL_BACK } from "@onepercent/config/web";

const WALLET = "J4aGiHemVzcxxjcwMKm77A9uUpB4Yf32KbEBrwtKG31a";
async function freshStore() {
  localStorage.clear();
  vi.resetModules();
  const store = await import("./store");
  store.demo.use(WALLET);
  store.demo.sample();
  return store;
}

beforeEach(() => localStorage.clear());

describe("demo Feed", () => {
  it("feeds the chosen bags and closes every empty account in the same transaction", async () => {
    const store = await freshStore();
    const before = store.demo.get();
    const feedable = before.bags.filter(
      (bag) => bag.kind === "feedable" || bag.kind === "checkAtFeed",
    );
    expect(feedable.length).toBeGreaterThan(1);
    expect(before.empties.length).toBeGreaterThan(0);
    const chosen = feedable.slice(0, 2).map((bag) => bag.mint);
    const rent = before.empties.reduce((sum, e) => sum + e.lamports, 0n);

    const landed = store.feed({ feed: chosen });

    const after = store.demo.get();
    expect(landed).toEqual({
      bags: 2,
      rent,
      deposits: store.ENTRY_DEPOSIT * 2n,
    });
    expect(after.empties).toEqual([]);
    expect(after.bags.map((bag) => bag.mint)).not.toEqual(
      expect.arrayContaining(chosen),
    );
    expect(after.bags).toHaveLength(before.bags.length - 2);
    expect(after.deck.map((entry) => entry.mint)).toEqual(chosen);
    expect(after.lamports).toBe(
      before.lamports + rent - store.ENTRY_DEPOSIT * 2n - store.NETWORK_FEE,
    );
  });

  it("with nothing chosen, only takes the rent back", async () => {
    const store = await freshStore();
    const before = store.demo.get();
    const rent = before.empties.reduce((sum, e) => sum + e.lamports, 0n);
    expect(store.feed({ feed: [] })).toEqual({ bags: 0, rent, deposits: 0n });
    expect(store.demo.get().bags).toHaveLength(before.bags.length);
    expect(store.demo.get().empties).toEqual([]);
  });
});

describe("demo pull and Sell", () => {
  it("a pull lands five cards in My cards; Sell pays the hit's quote at once", async () => {
    const store = await freshStore();
    const before = store.demo.get();
    const pulled = store.rip("original", "holo");
    const after = store.demo.get();
    expect(after.cards).toHaveLength(before.cards.length + 5);
    expect(pulled.dust).toHaveLength(4);
    const quote = pulled.hit.sellBackLamports!;
    expect(quote).toBe(
      (pulled.hit.valueLamports * BigInt(SELL_BACK.payoutBps)) / 10_000n,
    );
    expect(store.sellBack([pulled.hit.cardId])).toBe(quote);
    const sold = store.demo.get();
    expect(sold.cards.map((c) => c.cardId)).not.toContain(pulled.hit.cardId);
    expect(sold.lamports).toBe(after.lamports + quote - store.NETWORK_FEE);
  });

  it("feeds a Dust Card back into the machine with its refundable deposit", async () => {
    const store = await freshStore();
    const { dust } = store.rip("original", "silver");
    const before = store.demo.get();
    store.feedBack([dust[0]!.cardId]);
    const after = store.demo.get();
    expect(after.cards.map((c) => c.cardId)).not.toContain(dust[0]!.cardId);
    expect(after.deck.at(-1)).toMatchObject({
      mint: dust[0]!.mint,
      depositLamports: store.ENTRY_DEPOSIT,
      refed: true,
    });
    expect(after.lamports).toBe(
      before.lamports - store.ENTRY_DEPOSIT - store.NETWORK_FEE,
    );
  });
});

describe("demo odds", () => {
  it("draws with the program's real odds: Silver most of the time, a Holo about 1 in 50", async () => {
    const store = await freshStore();
    const random = vi.spyOn(Math, "random");
    const counts = new Map<string, number>();
    // An even grid over the roll gives each tier its exact share of the walk.
    for (let i = 0; i < 200; i++) {
      random.mockReturnValue((i + 0.5) / 200);
      const kind = store.rip("original").hit.kind;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    random.mockRestore();
    // Original on a 200-point grid: Black 1, Holo 4 (1 in 50), Blue 22, Silver the rest.
    expect(counts.get("black")).toBe(1);
    expect(counts.get("holo")).toBe(4);
    expect(counts.get("blue")).toBe(22);
    expect(counts.get("silver")).toBe(173);
  });
});
