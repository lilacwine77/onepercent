import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { AccountReconciler, isDeckReadContention } from "./reconcile.js";
import {
  ACCOUNT_BYTES,
  accountDiscriminator,
  pullAddress,
  ledgerAddress,
  singletonAddress,
  TOKEN_PROGRAMS,
  vaultAddress,
  type DeckEntry,
} from "./accounts.js";
import type { IndexedTransaction, SqlPool } from "./store.js";
const person = (n: number) =>
  new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const programId = person(2);
const entry = (n: number): DeckEntry => ({
  depositor: person(3),
  mint: person((n % 250) + 1),
  amount: BigInt(n + 1),
  deposit: 123n,
  flags: 1,
});
function fixture() {
  let slot = 1;
  let counter = 0n;
  let entries: DeckEntry[] = [];
  let invalidOwner = false;
  let mutate = false;
  const calls: { method: string; params: unknown[] }[] = [];
  const rows = new Map<number, Record<string, unknown>>();
  const cursors = new Map<string, string>();
  const sql: string[] = [];
  const pool: SqlPool = {
    query: async (query, values = []) => {
      sql.push(query);
      if (query.startsWith("SELECT last_slot"))
        return {
          rows: cursors.has(String(values[0]))
            ? [{ last_slot: cursors.get(String(values[0])) }]
            : [],
        };
      if (query.startsWith("INSERT INTO cursors"))
        cursors.set(String(values[0]), String(values[1]));
      if (query.startsWith("SELECT max(slot)"))
        return {
          rows: [
            {
              slot: rows.size
                ? Math.max(...[...rows.values()].map((row) => Number(row.slot)))
                : null,
            },
          ],
        };
      if (query.startsWith("SELECT deck_index"))
        return { rows: [...rows.values()] };
      if (query.startsWith("INSERT INTO deck_entries")) {
        const [deck_index, depositor, mint, amount, deposit, flags, rowSlot] =
          values;
        rows.set(Number(deck_index), {
          deck_index,
          depositor,
          mint,
          amount,
          deposit,
          flags,
          slot: rowSlot,
        });
      }
      if (query.startsWith("DELETE FROM deck_entries"))
        for (const index of rows.keys())
          if (index >= Number(values[0])) rows.delete(index);
      return { rows: [] };
    },
    connect: async () => ({ query: pool.query, release: () => undefined }),
  };
  const request: JsonRpcClient["request"] = async (method, params, schema) => {
    calls.push({ method, params });
    const { offset, length } = (
      params[1] as { dataSlice: { offset: number; length: number } }
    ).dataSlice;
    const bytes = Buffer.alloc(
      ACCOUNT_BYTES.Deck + entries.length * ACCOUNT_BYTES.deckEntry,
    );
    accountDiscriminator("Deck").copy(bytes);
    bytes.writeUInt32LE(entries.length, 8);
    bytes.writeUInt32LE(entries.length, 12);
    bytes.writeBigUInt64LE(counter, 24);
    entries.forEach((item, i) => {
      const at = ACCOUNT_BYTES.Deck + i * ACCOUNT_BYTES.deckEntry;
      new PublicKey(item.depositor).toBuffer().copy(bytes, at);
      new PublicKey(item.mint).toBuffer().copy(bytes, at + 32);
      bytes.writeBigUInt64LE(item.amount, at + 64);
      bytes.writeUInt32LE(Number(item.deposit), at + 72);
      bytes[at + 76] = item.flags;
    });
    if (mutate && offset > 0) counter++;
    return schema.parse({
      context: { slot },
      value: {
        owner: invalidOwner ? person(99) : programId,
        executable: false,
        data: [
          bytes.subarray(offset, offset + length).toString("base64"),
          "base64",
        ],
      },
    });
  };
  const metric = vi.fn();
  const alert = vi.fn(async () => undefined);
  const reconciler = new AccountReconciler({
    rpc: { request },
    pool,
    programId,
    deckChunkBytes: 160,
    metrics: { indexerDeckDrift: { set: metric } as never },
    alert,
  });
  return {
    reconciler,
    rows,
    cursors,
    sql,
    calls,
    metric,
    alert,
    set: (items: DeckEntry[]) => {
      entries = items.map((item) => ({ ...item }));
      slot++;
      counter++;
    },
    mutate: () => {
      mutate = true;
    },
    invalidOwner: () => {
      invalidOwner = true;
    },
  };
}
describe("confirmed Deck reconciliation", () => {
  it("remembers only a successful, structurally valid opening with the exact Pull PDA", async () => {
    const f = fixture();
    const data = Buffer.alloc(17);
    createHash("sha256")
      .update("global:buy_packs")
      .digest()
      .copy(data, 0, 0, 8);
    data[9] = 1;
    data.writeUInt32LE(7, 10);
    let n = BigInt("0x" + data.toString("hex"));
    let encoded = "";
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    while (n > 0n) {
      encoded = alphabet[Number(n % 58n)] + encoded;
      n /= 58n;
    }
    const buyer = person(3);
    const address = pullAddress(programId, buyer, 7);
    const tx: IndexedTransaction = {
      signature: "confirmed-opening",
      slot: 10n,
      txIndex: 0n,
      blockTime: 1,
      err: null,
      truncated: true,
      events: [],
      accountKeys: [buyer, address],
      instructions: [
        {
          programId,
          data: encoded,
          accounts: [
            buyer,
            person(1),
            person(2),
            person(4),
            person(5),
            address,
          ],
        },
      ],
    };
    expect(await f.reconciler.remember(tx)).toBe(true);
    expect(f.cursors.has("indexer:pull-origin:" + address)).toBe(true);
    tx.instructions[0]!.data = encode(
      Buffer.concat([data, Buffer.from([1, 2, 3])]),
    );
    expect(await f.reconciler.remember(tx)).toBe(true);
    const before = f.sql.length;
    await f.reconciler.remember({ ...tx, err: "failed" });
    expect(f.sql).toHaveLength(before);
    tx.instructions[0]!.accounts[5] = person(99);
    expect(await f.reconciler.remember(tx)).toBe(false);
    expect(f.alert).toHaveBeenCalledWith(
      "indexer_tx_unprocessable",
      "warning",
      expect.objectContaining({ reason: "invalid_pull_pda" }),
    );
  });
  it("uses bounded slices, fixes drift, fences snapshots and alerts on repeated drift", async () => {
    const f = fixture();
    f.set([entry(1), entry(2), entry(3)]);
    await f.reconciler.reconcileDeck();
    expect(f.rows.size).toBe(3);
    expect(f.metric).toHaveBeenLastCalledWith(3);
    for (const { params } of f.calls)
      expect(params[1]).toMatchObject({
        commitment: "confirmed",
        dataSlice: { length: expect.any(Number) },
      });
    expect(
      f.calls.every(
        ({ params }) =>
          (params[1] as { dataSlice: { length: number } }).dataSlice.length <=
          160,
      ),
    ).toBe(true);
    f.set([entry(1)]);
    await f.reconciler.reconcileDeck();
    expect(f.rows.size).toBe(1);
    expect(f.alert).toHaveBeenCalledWith(
      "deck_drift",
      "warning",
      expect.objectContaining({ differingRows: 2 }),
    );
    await f.reconciler.reconcileDeck();
    expect(f.metric).toHaveBeenLastCalledWith(0);
    expect(f.cursors.has("indexer:deck-snapshot")).toBe(true);
  });
  it("rejects changed headers and foreign owners before any SQL write", async () => {
    const f = fixture();
    f.set([entry(1)]);
    f.mutate();
    await expect(f.reconciler.reconcileDeck()).rejects.toThrow(
      "deck_changed_during_read",
    );
    expect(f.sql).toEqual([]);
    expect(isDeckReadContention(new Error("deck_changed_during_read"))).toBe(
      true,
    );
    expect(isDeckReadContention(new Error("invalid_account_owner"))).toBe(
      false,
    );
    const bad = fixture();
    bad.invalidOwner();
    await expect(bad.reconciler.reconcileDeck()).rejects.toThrow(
      "invalid_account_owner",
    );
    expect(bad.sql).toEqual([]);
  });
  it("cannot replace a newer snapshot with an older read", async () => {
    const f = fixture();
    f.set([entry(1)]);
    f.cursors.set("indexer:deck-snapshot", "999");
    await f.reconciler.reconcileDeck();
    expect(f.rows.size).toBe(0);
    expect(f.metric).not.toHaveBeenCalled();
  });
  it("matches the 1,000-operation seeded feed/take-back/pick model", async () => {
    const f = fixture();
    const model: DeckEntry[] = [];
    let seed = 0x12345678;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    const operations = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const op =
        model.length === 0 || random() % 3 === 0
          ? "feed"
          : random() % 2 === 0
            ? "take"
            : "pick";
      operations.add(op);
      if (op === "feed") model.push(entry(i));
      else {
        const index = random() % model.length;
        const last = model.pop();
        if (last && index < model.length) model[index] = last;
      }
      f.set(model);
      await f.reconciler.reconcileDeck();
      const mirror = [...f.rows.values()]
        .sort((a, b) => Number(a.deck_index) - Number(b.deck_index))
        .map((row) => ({
          depositor: row.depositor,
          mint: row.mint,
          amount: BigInt(String(row.amount)),
          deposit: BigInt(String(row.deposit)),
          flags: Number(row.flags),
        }));
      expect(mirror).toEqual(model);
    }
    expect([...operations].sort()).toEqual(["feed", "pick", "take"]);
  }, 30_000);
});

function encode(bytes: Buffer) {
  let value = BigInt("0x" + bytes.toString("hex"));
  let text = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (value > 0n) {
    text = alphabet[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = "1" + text;
  }
  return text;
}
function accountFixture() {
  const accounts = new Map<
    string,
    { owner: string; executable: boolean; data: [string, "base64"] }
  >();
  const queries: { query: string; values: unknown[] }[] = [];
  const pool: SqlPool = {
    query: async (query, values = []) => {
      queries.push({ query, values });
      return { rows: [] };
    },
    connect: async () => ({ query: pool.query, release: () => undefined }),
  };
  const calls: { method: string; addresses: string[] }[] = [];
  let active = 0;
  let maxActive = 0;
  const request: JsonRpcClient["request"] = async (method, params, schema) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active--;
    if (method === "getMultipleAccounts") {
      const addresses = params[0] as string[];
      calls.push({ method, addresses });
      return schema.parse({
        context: { slot: 100 },
        value: addresses.map((address) => accounts.get(address) ?? null),
      });
    }
    if (method === "getProgramAccounts") {
      calls.push({ method, addresses: [] });
      const filter = (params[1] as { filters: { memcmp: { bytes: string } }[] })
        .filters[0]!.memcmp.bytes;
      return schema.parse({
        context: { slot: 100 },
        value: [...accounts]
          .filter(
            ([, value]) =>
              Buffer.from(value.data[0], "base64")
                .subarray(0, 8)
                .toString("base64") === filter,
          )
          .map(([pubkey, account]) => ({ pubkey, account })),
      });
    }
    if (method === "getAccountInfo") {
      const address = String(params[0]);
      calls.push({ method, addresses: [address] });
      return schema.parse({
        context: { slot: 100 },
        value: accounts.get(address) ?? null,
      });
    }
    throw new Error("unexpected_rpc_method");
  };
  const alert = vi.fn(async () => undefined);
  const reconciler = new AccountReconciler({
    pool,
    rpc: { request },
    programId,
    deckChunkBytes: 160,
    metrics: { indexerDeckDrift: { set: vi.fn() } as never },
    alert,
  });
  return {
    reconciler,
    calls,
    queries,
    alert,
    concurrency: () => maxActive,
    add(address: string, bytes: Buffer, owner = programId) {
      accounts.set(address, {
        owner,
        executable: false,
        data: [bytes.toString("base64"), "base64"],
      });
    },
  };
}
describe("bounded account reconciliation", () => {
  it("batches 201 touched accounts into three requests instead of individual lookups", async () => {
    const f = accountFixture();
    await f.reconciler.reconcile(
      Array.from({ length: 201 }, (_, index) => person(index + 1)),
      1n,
    );
    expect(
      f.calls
        .filter(({ method }) => method === "getMultipleAccounts")
        .map(({ addresses }) => addresses.length),
    ).toEqual([2, 100, 100, 1]);
    expect(f.calls.filter(({ method }) => method === "getAccountInfo")).toEqual(
      [
        {
          method: "getAccountInfo",
          addresses: [singletonAddress(programId, "deck")],
        },
      ],
    );
    expect(f.concurrency()).toBeLessThanOrEqual(2);
  });
  it("batches a full 101-ledger scan into mint reads and same-slot ledger/vault pairs", async () => {
    const f = accountFixture();
    for (let index = 1; index <= 101; index++) {
      const mint = person(index);
      const bytes = Buffer.alloc(ACCOUNT_BYTES.MintLedger);
      accountDiscriminator("MintLedger").copy(bytes);
      new PublicKey(mint).toBuffer().copy(bytes, 8);
      f.add(ledgerAddress(programId, mint), bytes);
      f.add(mint, Buffer.alloc(82), TOKEN_PROGRAMS[0]);
      f.add(
        vaultAddress(programId, mint, TOKEN_PROGRAMS[0]),
        Buffer.alloc(165),
        TOKEN_PROGRAMS[0],
      );
    }
    await f.reconciler.reconcile(undefined, 1n);
    expect(
      f.calls
        .filter(({ method }) => method === "getMultipleAccounts")
        .map(({ addresses }) => addresses.length),
    ).toEqual([2, 100, 1, 100, 100, 2]);
    expect(f.calls).toHaveLength(9);
    expect(
      f.queries.filter(({ query }) =>
        query.startsWith("INSERT INTO mint_ledgers"),
      ),
    ).toHaveLength(101);
    expect(f.concurrency()).toBeLessThanOrEqual(2);
  }, 15_000);
  it("recovers CPI nonce only from the owned exact Pull PDA and persists its opening signature", async () => {
    const f = accountFixture();
    const buyer = person(3);
    const address = pullAddress(programId, buyer, 7);
    const bytes = Buffer.alloc(ACCOUNT_BYTES.Pull + ACCOUNT_BYTES.packRecord);
    accountDiscriminator("Pull").copy(bytes);
    bytes.writeBigUInt64LE(42n, 8);
    new PublicKey(buyer).toBuffer().copy(bytes, 16);
    bytes.writeUInt32LE(7, 136);
    bytes[143] = 1;
    bytes[144] = 1;
    f.add(address, bytes);
    const tx: IndexedTransaction = {
      signature: "cpi-opening",
      slot: 10n,
      txIndex: 0n,
      blockTime: 1,
      err: null,
      truncated: false,
      accountKeys: [],
      instructions: [{ programId: person(99), data: "1", accounts: [address] }],
      events: [
        {
          name: "PullOpened",
          ixIndex: 0n,
          eventIndex: 0n,
          data: { pull: address, buyer, seq: "42" },
        },
      ],
    };
    await f.reconciler.recoverPullNonces(tx);
    expect(tx.events[0]!.data._indexer).toEqual({ buyerNonce: 7 });
    await f.reconciler.remember(tx);
    expect(f.queries).toEqual([
      expect.objectContaining({
        values: ["indexer:pull-origin:" + address, "cpi-opening", "10"],
      }),
    ]);
    tx.events[0]!.data = { pull: address, buyer: person(4), seq: "42" };
    await expect(f.reconciler.recoverPullNonces(tx)).resolves.toBeUndefined();
    expect(tx.events[0]!.data._indexer).toBeUndefined();
    expect(f.alert).toHaveBeenCalledWith(
      "pull_history_incomplete",
      "warning",
      expect.objectContaining({ reason: "invalid_pull_pda" }),
    );
  });
});
