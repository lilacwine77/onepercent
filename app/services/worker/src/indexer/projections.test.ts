import { describe, expect, it, vi } from "vitest";
import {
  clearProjectionHistory,
  enrichEvent,
  mutateDeck,
  projectEvent,
  type DeckMirrorEntry,
} from "./projections.js";
import type {
  IndexedEvent,
  IndexedTransaction,
  SqlExecutor,
  StoreOptions,
} from "./store.js";

const event = (name: string, data: IndexedEvent["data"]): IndexedEvent => ({
  name,
  data,
  ixIndex: 0n,
  eventIndex: 0n,
});
describe("Deck event projection", () => {
  it("matches an independent array after 1,000 deterministic mixed inserts, take-backs and picks", () => {
    const rows: DeckMirrorEntry[] = [];
    const mirror = new Map<bigint, DeckMirrorEntry>();
    let seed = 982341;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 1000; i++) {
      if (rows.length === 0 || random() % 3 === 0) {
        const row = {
          depositor: `wallet-${i}`,
          mint: `mint-${i}`,
          amount: String(i + 1),
          deposit: "25",
          flags: random() % 2 ? 1 : 2,
        };
        mutateDeck(
          mirror,
          event(row.flags === 1 ? "BagFed" : "CardFedBack", {
            depositor: row.depositor,
            owner: row.depositor,
            mint: row.mint,
            amount: row.amount,
            deposit: row.deposit,
            deck_index: rows.length,
          }),
        );
        rows.push(row);
      } else {
        const index = random() % rows.length;
        const moved = index === rows.length - 1 ? 4294967295 : rows.length - 1;
        const row = rows[index]!;
        if (random() % 2 === 0)
          mutateDeck(
            mirror,
            event("BagTakenBack", { deck_index: index, moved_from: moved }),
          );
        else
          expect(
            mutateDeck(
              mirror,
              event("PackRevealed", {
                house_mask: 14,
                dust: [{ index, moved_from: moved }, {}, {}, {}],
              }),
            ),
          ).toBe(row.flags === 1 ? 1 : 0);
        const tail = rows.pop()!;
        if (index < rows.length) rows[index] = tail;
      }
      expect(
        [...mirror.entries()]
          .sort(([a], [b]) => Number(a - b))
          .map(([, row]) => row),
      ).toEqual(rows);
    }
  });
  it("rejects a missing moved entry instead of silently corrupting the Deck", () => {
    expect(() =>
      mutateDeck(
        new Map(),
        event("BagTakenBack", { deck_index: 0, moved_from: 3 }),
      ),
    ).toThrow("deck_move_missing");
  });
});

const options = (): StoreOptions => ({
  programId: "program",
  royaltyPerDustCardBps: 200,
});
const transaction = (slot: bigint, txIndex = 0n): IndexedTransaction => ({
  signature: `s${slot}`,
  slot,
  txIndex,
  blockTime: 1,
  err: null,
  truncated: false,
  events: [],
  accountKeys: [],
  instructions: [],
});

it("keeps validated CPI Pull nonce metadata instead of requiring a top-level buy", async () => {
  const opened = event("PullOpened", { _indexer: { buyerNonce: 73 } });
  await expect(
    enrichEvent({ query: vi.fn() }, transaction(1n), opened, options()),
  ).resolves.toBeUndefined();
  expect(opened.data._indexer).toEqual({ buyerNonce: 73 });
});

it("stores live flags as the union across packs, including packs preceding an account snapshot", async () => {
  let flags = 0;
  const sql: SqlExecutor = {
    query: vi.fn(async (text, values) => {
      if (text.startsWith("SELECT last_slot"))
        return { rows: [{ last_slot: "999" }] };
      if (text.startsWith("SELECT price"))
        return { rows: [{ price: "10000" }] };
      if (text.startsWith("UPDATE pulls SET live_flags")) {
        expect(text).toBe(
          "UPDATE pulls SET live_flags=live_flags | $2 WHERE seq=$1",
        );
        flags |= Number(values?.[1]);
      }
      return { rows: [] };
    }),
  };
  for (const [pack, liveFlags] of [1, 4, 2].entries())
    await projectEvent(
      sql,
      transaction(1n),
      event("PackRevealed", {
        seq: "1",
        pack,
        t: 0,
        widths: [0, 0, 0, 0, 0, 0],
        tier: 0,
        hit_bucket: 0,
        hit_mint: "mint",
        hit_amount: "0",
        hit_value: "0",
        house_mask: 15,
        live_flags: liveFlags,
        _indexer: { freshMask: 0 },
        dust: Array.from({ length: 4 }, () => ({
          deck_len_before: 0,
          index: 0,
          moved_from: 4294967295,
          mint: "mint",
          amount: "0",
          depositor: "owner",
          refund: "0",
        })),
      }),
      options(),
    );
  expect(flags).toBe(7);
});

it("assigns one-based global reveal ordinals across slots and multiple callbacks in a transaction", async () => {
  const positions = [
    [100n, 7n, 0n, 1n],
    [100n, 7n, 0n, 4n],
    [101n, 0n, 0n, 2n],
  ];
  const assigned: unknown[] = [];
  const sql: SqlExecutor = {
    query: vi.fn(async (text, values) => {
      if (text.startsWith("SELECT last_slot")) return { rows: [] };
      if (text.startsWith("SELECT COUNT")) {
        const start = values!.slice(0, 4).map(String).map(BigInt);
        const end = values!.slice(4).map(String).map(BigInt);
        const compare = (a: bigint[], b: bigint[]) => {
          for (let i = 0; i < 4; i++) {
            if (a[i]! < b[i]!) return -1;
            if (a[i]! > b[i]!) return 1;
          }
          return 0;
        };
        return {
          rows: [
            {
              count: positions.filter(
                (position) =>
                  compare(position, start) > 0 && compare(position, end) <= 0,
              ).length,
            },
          ],
        };
      }
      if (text.startsWith("UPDATE pulls SET revealed_sig"))
        assigned.push(values![3]);
      return { rows: [] };
    }),
  };
  const config = options();
  for (const [i, position] of positions.entries())
    await projectEvent(
      sql,
      transaction(position[0]!, position[1]!),
      {
        ...event("PullRevealed", { seq: i + 1, randomness: Array(32).fill(0) }),
        eventIndex: position[3]!,
      },
      config,
    );
  expect(assigned).toEqual(["1", "2", "3"]);
});

it("processes historical Deck events once across a backlog, and invalidates after rollback", async () => {
  const rows: Record<string, unknown>[] = [];
  const config = options();
  let processed = 0;
  const pick = { index: 0, moved_from: 4294967295 };
  for (let i = 0; i < 100; i++) {
    rows.push({
      slot: String(i * 2 + 1),
      tx_index: "0",
      ix_index: "0",
      event_index: "0",
      name: "BagFed",
      data: {
        depositor: "owner",
        mint: "mint",
        amount: "1",
        deposit: "1",
        deck_index: 0,
      },
    });
    rows.push({
      slot: String(i * 2 + 2),
      tx_index: "0",
      ix_index: "0",
      event_index: "0",
      name: "PackRevealed",
      data: { house_mask: 14, dust: [pick, {}, {}, {}] },
    });
  }
  const sql: SqlExecutor = {
    query: vi.fn(async (text, values) => {
      if (text.startsWith("SELECT last_slot"))
        return { rows: [{ last_slot: "1000" }] };
      const start = BigInt(String(values![0]));
      const end = BigInt(String(values![4]));
      const matched = rows.filter(
        (row) =>
          BigInt(String(row.slot)) > start && BigInt(String(row.slot)) < end,
      );
      processed += matched.length;
      return { rows: matched };
    }),
  };
  for (let i = 0; i < 100; i++) {
    const reveal = event("PackRevealed", {
      house_mask: 14,
      dust: [pick, {}, {}, {}],
    });
    await enrichEvent(sql, transaction(BigInt(i * 2 + 2)), reveal, config);
    expect(reveal.data._indexer).toEqual({ freshMask: 1 });
  }
  expect(processed).toBe(199);
  clearProjectionHistory(config);
  const reveal = event("PackRevealed", {
    house_mask: 14,
    dust: [pick, {}, {}, {}],
  });
  await enrichEvent(sql, transaction(2n), reveal, config);
  expect(reveal.data._indexer).toEqual({ freshMask: 1 });
});
