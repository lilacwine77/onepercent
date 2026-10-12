import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  decodeBinder,
  decodeConfig,
  decodeDeckHeader,
  decodeMachine,
  decodePullHeader,
  safeNumber,
} from "./draft-layouts.js";
import { maxQty, paramsHash, readEconomics, rotateHour } from "./math.js";
import { readMeMirror, readSnapshot, readVerifyMirror } from "./mirror.js";
import type { ServiceRuntime } from "@onepercent/service-kit";

const owner = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
function account(name: string, size: number) {
  const data = Buffer.alloc(size);
  createHash("sha256").update(`account:${name}`).digest().copy(data, 0, 0, 8);
  return data;
}
function binder(cap = 0) {
  const data = account("Binder", 112 + cap * 56);
  new PublicKey(owner).toBuffer().copy(data, 8);
  data.writeUInt16LE(cap, 106);
  return data;
}
function machine() {
  const data = account("Machine", 3808);
  data[8] = 1;
  return decodeMachine(data);
}
// Deliberately synthetic arithmetic inputs, not deployable product parameters.
const economics = () =>
  readEconomics({
    BPS_DENOMINATOR: 100,
    PACK_EDITIONS: Array.from({ length: 4 }, () => ({
      priceLamports: 10n,
      maxPerRip: 3,
    })),
    CARDS_PER_PACK: { dust: 4 },
    HIT_TIERS: Array.from({ length: 4 }, () => ({ valueBps: 50 })),
    MAX_LIST_PER_RIP_LAMPORTS: 100n,
    COVERAGE: { perPackValueBps: 200, dustBuffer: 4 },
    STOCK: { maxBuckets: 16, targetBaseLamports: 5n },
    SELL_BACK: {
      solFloorLamports: 2n,
      hourlyBudgetMinLamports: 4n,
      hourlyBudgetBpsOfStockSol: 25,
    },
  });

describe("M1 draft read adapters", () => {
  it("reads immutable ABI offsets and rejects wrong owner or dynamic length", () => {
    const data = binder(1);
    data.writeUInt16LE(1, 104);
    data.writeBigUInt64LE((1n << 64n) - 1n, 144);
    expect(decodeBinder(data, owner).cards[0]?.amount).toBe(
      "18446744073709551615",
    );
    expect(() => decodeBinder(data.subarray(0, -1), owner)).toThrow(
      "invalid_binder",
    );
    expect(() => decodeBinder(data, PublicKey.default.toBase58())).toThrow(
      "invalid_binder",
    );
  });
  it("implements all close conditions including both Final bits", () => {
    const data = binder(1);
    expect(decodeBinder(data, owner).closable).toBe(true);
    data.writeBigUInt64LE(1n, 72);
    data[111] = 1;
    expect(decodeBinder(data, owner).closable).toBe(false);
    data[111] = 3;
    expect(decodeBinder(data, owner).closable).toBe(true);
    for (const offset of [102, 104, 108]) {
      data.writeUInt16LE(1, offset);
      expect(decodeBinder(data, owner).closable).toBe(false);
      data.writeUInt16LE(0, offset);
    }
    data.writeBigUInt64LE(1n, 80);
    expect(decodeBinder(data, owner).closable).toBe(false);
  });
  it("rejects discriminator, version, queue and account size drift", () => {
    expect(() => decodeMachine(account("Config", 3808))).toThrow(
      "account_layout_mismatch",
    );
    const config = account("Config", 872);
    config[736] = 1;
    config[738] = 4;
    expect(() => decodeConfig(config)).toThrow("account_version_mismatch");
    config[738] = 0;
    expect(decodeConfig(config).vrf.queues).toHaveLength(4);
    const deck = account("Deck", 64);
    deck[49] = 1;
    deck.writeUInt32LE(1, 8);
    expect(() => decodeDeckHeader(deck)).toThrow("invalid_deck");
    const pull = account("Pull", 376);
    pull[143] = 1;
    pull[147] = 1;
    expect(decodePullHeader(pull).qty).toBe(1);
    expect(() => decodePullHeader(pull.subarray(0, 176))).toThrow(
      "invalid_pull",
    );
  });
  it("never rounds a large chain integer", () => {
    expect(() => safeNumber(9_007_199_254_740_993n)).toThrow("unsafe_integer");
  });
});

describe("read-only economic mirrors", () => {
  it("fails closed until G1 config exports exist", () => {
    expect(() => readEconomics({})).toThrow("m1_parameters_unavailable");
    expect(() => paramsHash({})).toThrow("m1_parameters_unavailable");
  });
  it("reserves coverage per bucket and checks token granularity", () => {
    const m = machine();
    const b = m.buckets[0]!;
    Object.assign(b, { class: 1, enabled: 1, amount: 100n, cost: 60n });
    expect(maxQty(0, 16, m, economics())).toBe(3);
    b.reserved = 20n;
    expect(maxQty(0, 16, m, economics())).toBe(2);
    b.amount = 1n;
    expect(maxQty(0, 16, m, economics())).toBe(0);
  });
  it("checks deck buffer and only eligible MAJOR inventory", () => {
    const m = machine();
    Object.assign(m.buckets[0]!, {
      class: 2,
      enabled: 1,
      amount: 100n,
      cost: 60n,
    });
    expect(maxQty(0, 16, m, economics())).toBe(0);
    m.buckets[0]!.class = 1;
    m.reservedDust = 5n;
    expect(maxQty(0, 16, m, economics())).toBe(1);
  });
  it("rotates hour boundaries without mutating chain input", () => {
    const m = machine();
    Object.assign(m, {
      hourIndex: 1n,
      hitOutThisHour: 11n,
      stockSol: 10n,
      sbPaidHour: 3n,
    });
    expect(rotateHour(m, 7_199n).sbPaidHour).toBe(3n);
    expect(rotateHour(m, 7_200n)).toMatchObject({
      hitOutLastHour: 11n,
      sbPaidHour: 0n,
      solAtHourStart: 10n,
    });
    expect(rotateHour(m, 10_800n).hitOutLastHour).toBe(0n);
    expect(m.sbPaidHour).toBe(3n);
  });
  it("hashes compiled keys in stable canonical order with lossless amounts", () => {
    const source = {
      ONCHAIN_KEYS: [{ path: "z" }, { path: "a" }],
      resolveOnchainKey: (path: string) =>
        path === "a" ? (1n << 64n) - 1n : { z: true, a: 1 },
      validateParams: () => undefined,
    };
    const hash = paramsHash(source);
    expect(hash).toBe(
      paramsHash({
        ...source,
        ONCHAIN_KEYS: [...source.ONCHAIN_KEYS].reverse(),
      }),
    );
    expect(hash).toBe(
      createHash("sha256")
        .update('{"a":"18446744073709551615","z":{"a":1,"z":true}}')
        .digest("hex"),
    );
  });
});

function poolWith(results: unknown[][]) {
  const commands: string[] = [];
  let released = false;
  const client = {
    query: async (sql: string) => {
      commands.push(sql);
      return { rows: sql.startsWith("SELECT") ? (results.shift() ?? []) : [] };
    },
    release: () => {
      released = true;
    },
  };
  return {
    pool: { connect: async () => client } as unknown as ServiceRuntime["pool"],
    commands,
    released: () => released,
  };
}
describe("confirmed indexer read boundaries", () => {
  it("uses one read-only repeatable snapshot and releases it after failure", async () => {
    const test = poolWith([[{ slot: "12" }]]);
    await expect(
      readSnapshot(test.pool, async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    expect(test.commands[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(test.commands.at(-1)).toBe("ROLLBACK");
    expect(test.released()).toBe(true);
  });
  it("returns an unavailable indexer instead of a made-up zero slot", async () => {
    const test = poolWith([[{ slot: null }]]);
    await expect(readMeMirror(test.pool, owner)).rejects.toThrow(
      "indexer_unavailable",
    );
  });
  it("exposes actual settlement receipts while a partial royalty remains unknown", async () => {
    const test = poolWith([
      [{ slot: "12" }],
      [],
      [],
      [],
      [],
      [
        {
          count24h: "1",
          lamports24h: null,
          total: null,
          receiptsLamports24h: "4",
          receiptsTotal: "4",
        },
      ],
    ]);
    expect((await readMeMirror(test.pool, owner)).royalties).toEqual({
      count24h: 1,
      lamports24h: null,
      total: null,
      settlementReceipts: { lamports24h: "4", total: "4" },
    });
  });
  it("does not return mirror reveal outcomes without confirmed events", async () => {
    const test = poolWith([
      [{ slot: "12" }],
      [
        {
          seq: "1",
          pull: owner,
          buyer: owner,
          buyerNonce: "0",
          referrer: null,
          edition: 0,
          qty: 1,
          price: "1",
          createdTs: "1",
          status: "revealed",
          settledMask: 0,
          randomness: "ab".repeat(32),
          revealedSlot: "12",
          revealOrder: "0",
          liveFlags: 0,
          holder: false,
          openedSig: "opened",
          revealedSig: "revealed",
        },
      ],
      [],
    ]);
    const result = await readVerifyMirror(test.pool, "1");
    expect(result).toMatchObject({
      status: "pending",
      randomness: null,
      revealedSlot: null,
      revealOrder: null,
      packs: [],
    });
    expect(test.commands.some((sql) => sql.includes("FROM packs"))).toBe(false);
    expect(test.commands.at(-1)).toBe("COMMIT");
  });
});
