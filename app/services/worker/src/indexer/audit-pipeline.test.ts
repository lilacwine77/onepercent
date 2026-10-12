import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_BYTES,
  accountDiscriminator,
  ledgerAddress,
  pullAddress,
} from "./accounts.js";
import { IndexerEngine, type EngineStore, type Reconciler } from "./engine.js";
import {
  encodeFeedInstructionData,
  feedProofFixture,
} from "./feed-proof.test-data.mjs";
import { AccountReconciler } from "./reconcile.js";
import type { TxSource } from "./source.js";
import {
  IndexerStore,
  type IndexedTransaction,
  type SqlPool,
  type StoreOptions,
} from "./store.js";

const key = (n: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(n);
  return new PublicKey(bytes).toBase58();
};
const programId = key(1);
function transaction(signature = "confirmed", slot = 20n): IndexedTransaction {
  return {
    signature,
    slot,
    txIndex: 0n,
    blockTime: 1000,
    err: null,
    truncated: false,
    events: [],
    instructions: [],
    accountKeys: [],
  };
}
function database(latestSlot?: bigint) {
  const queries: { query: string; values: unknown[] }[] = [];
  let cursor: { last_signature: string; last_slot: string } | undefined;
  const pool: SqlPool = {
    query: async (query, values = []) => {
      queries.push({ query, values });
      if (
        query.startsWith("INSERT INTO chain_txs") &&
        query.includes("RETURNING")
      )
        return { rows: [{ signature: values[0] }] };
      if (
        query.startsWith(
          "SELECT slot,tx_index FROM chain_txs WHERE signature<>",
        )
      )
        return {
          rows:
            latestSlot === undefined
              ? []
              : [{ slot: String(latestSlot), tx_index: "0" }],
        };
      if (
        query.startsWith("INSERT INTO cursors") &&
        query.includes("VALUES('indexer',")
      )
        cursor = {
          last_signature: String(values[0]),
          last_slot: String(values[1]),
        };
      if (query.startsWith("SELECT last_signature,last_slot FROM cursors"))
        return { rows: cursor ? [cursor] : [] };
      if (query.startsWith("SELECT COALESCE(MAX"))
        return { rows: [{ slot: "20" }] };
      return { rows: [] };
    },
    connect: async () => ({ query: pool.query, release: () => undefined }),
  };
  return { pool, queries };
}
function accounts(pool: SqlPool, program = programId) {
  const calls: { method: string; addresses: string[] }[] = [];
  const request: JsonRpcClient["request"] = async (method, params, schema) => {
    const addresses =
      method === "getMultipleAccounts"
        ? (params[0] as string[])
        : [String(params[0])];
    calls.push({ method, addresses });
    return schema.parse({
      context: { slot: 40 },
      value:
        method === "getMultipleAccounts" ? addresses.map(() => null) : null,
    });
  };
  const alert = vi.fn(async () => undefined);
  const reconciler = new AccountReconciler({
    rpc: { request },
    pool,
    programId: program,
    deckChunkBytes: 160,
    alert,
    metrics: { indexerDeckDrift: { set: vi.fn() } as never },
  });
  return { reconciler, calls, alert };
}
function pipeline(
  txs: IndexedTransaction[],
  store: EngineStore,
  reconciler: Reconciler,
  program = programId,
  onMaintenanceFailure?: (
    kind: "accounts" | "deck",
    error: unknown,
    attempt: number,
  ) => Promise<void>,
) {
  const source: TxSource = {
    confirmedSlot: vi.fn(async () => 40n),
    finalizedSlot: vi.fn(async () => 0n),
    canonical: vi.fn(async () => true),
    blockTime: vi.fn(async () => 1000),
    transactions: vi.fn(async () => txs),
  };
  const status = vi.fn(async () => undefined);
  const engine = new IndexerEngine({
    source,
    store,
    reconciler,
    programId: program,
    publish: vi.fn(async () => undefined),
    status,
    accountReconcileSeconds: 300,
    deckReconcileSeconds: 600,
    onMaintenanceFailure,
  });
  return { engine, source, status };
}

describe("S1 audit regressions through the ingestion pipeline", () => {
  it("accepts trailing Anchor buy_packs bytes and advances beyond the opening", async () => {
    const db = database();
    const { reconciler, alert } = accounts(db.pool);
    const store = new IndexerStore(db.pool, {
      programId,
      royaltyPerDustCardBps: 200,
    });
    const buyer = key(2);
    const address = pullAddress(programId, buyer, 7);
    const data = Buffer.alloc(20);
    createHash("sha256")
      .update("global:buy_packs")
      .digest()
      .copy(data, 0, 0, 8);
    data[9] = 1;
    data.writeUInt32LE(7, 10);
    data.set([9, 8, 7], 17);
    const tx = transaction();
    tx.instructions = [
      {
        programId,
        data: encodeFeedInstructionData(data),
        accounts: [buyer, key(3), key(4), key(5), key(6), address],
      },
    ];
    const { engine } = pipeline([tx], store, reconciler);
    await expect(engine.poll()).resolves.toBeUndefined();
    expect(await store.cursor()).toEqual({
      lastSignature: tx.signature,
      lastSlot: tx.slot,
    });
    expect(db.queries).toContainEqual(
      expect.objectContaining({
        values: [
          "indexer:pull-origin:" + address,
          tx.signature,
          String(tx.slot),
        ],
      }),
    );
    expect(alert).not.toHaveBeenCalled();
    expect(tx.truncated).toBe(false);
    await engine.stop();
  });

  it.each(["following_attestation", "overlap", "low_offset", "rotated_signer"])(
    "recovers a successful Feed with %s and advances the cursor",
    async (kind) => {
      const f = feedProofFixture();
      if (kind === "following_attestation") {
        [
          f.tx.instructions[f.attestationIxIndex],
          f.tx.instructions[f.ixIndex],
        ] = [
          f.tx.instructions[f.ixIndex]!,
          f.tx.instructions[f.attestationIxIndex]!,
        ];
        f.feed[f.feed.length - 1] = f.ixIndex;
        f.tx.instructions[f.attestationIxIndex]!.data =
          encodeFeedInstructionData(f.feed);
      }
      if (kind === "overlap" || kind === "low_offset") {
        f.ed25519.writeUInt16LE(kind === "overlap" ? 80 : 0, 2);
        f.tx.instructions[f.attestationIxIndex]!.data =
          encodeFeedInstructionData(f.ed25519);
      }
      const db = database();
      const options: StoreOptions = {
        programId: f.options.programId,
        royaltyPerDustCardBps: 200,
        getIntakeSigner: vi.fn().mockRejectedValue(new Error("rotated_config")),
        alert: vi.fn(async () => undefined),
      };
      const store = new IndexerStore(db.pool, options);
      const { reconciler } = accounts(db.pool, f.options.programId);
      const { engine } = pipeline(
        [f.tx],
        store,
        reconciler,
        f.options.programId,
      );
      await expect(engine.poll()).resolves.toBeUndefined();
      expect(await store.cursor()).toEqual({
        lastSignature: f.tx.signature,
        lastSlot: f.tx.slot,
      });
      const recovery = db.queries.find(
        ({ query, values }) =>
          query.startsWith("INSERT INTO chain_events") &&
          values[5] === "IndexerFeedRecovered",
      );
      expect(recovery).toBeDefined();
      expect(JSON.parse(String(recovery!.values[6]))._indexer).toMatchObject({
        evidence: "incomplete",
        path: "unknown",
      });
      expect(options.getIntakeSigner).not.toHaveBeenCalled();
      expect(options.alert).toHaveBeenCalledWith(
        "intake_log_missing",
        expect.objectContaining({ path: "unknown" }),
      );
      await engine.stop();
    },
  );

  it("retains and alerts an out-of-order transaction while advancing past it", async () => {
    const db = database(30n);
    const alert = vi.fn(async () => undefined);
    const store = new IndexerStore(db.pool, {
      programId,
      royaltyPerDustCardBps: 200,
      alert,
    });
    const { reconciler } = accounts(db.pool);
    const tx = transaction("late-history", 20n);
    const { engine } = pipeline([tx], store, reconciler);
    await expect(engine.poll()).resolves.toBeUndefined();
    expect(tx.truncated).toBe(true);
    expect(await store.cursor()).toEqual({
      lastSignature: tx.signature,
      lastSlot: tx.slot,
    });
    expect(db.queries.some(({ query }) => query === "ROLLBACK")).toBe(true);
    expect(db.queries).toContainEqual(
      expect.objectContaining({
        values: ["indexer:unprocessable:late-history", "late-history", "20"],
      }),
    );
    expect(alert).toHaveBeenCalledWith("indexer_tx_unprocessable", {
      signature: tx.signature,
      slot: "20",
      reason: "indexer_out_of_order",
    });
    await engine.stop();
  });

  it("reconciles only event-named PDAs in one batched pass per tick", async () => {
    const db = database();
    const { reconciler, calls } = accounts(db.pool);
    const store: EngineStore = {
      cursor: vi.fn(async () => null),
      apply: vi.fn(async () => true),
      recordUnprocessable: vi.fn(async () => undefined),
      advanceCursor: vi.fn(async () => undefined),
      pendingFinality: vi.fn(async () => []),
      finalize: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    };
    const txs = [transaction("first"), transaction("second", 21n)];
    const mints = Array.from({ length: 101 }, (_, index) => key(1000 + index));
    txs.forEach((tx, index) => {
      tx.accountKeys = Array.from({ length: 200 }, (_, item) =>
        key(2000 + item),
      );
      tx.events = mints
        .slice(index * 60, (index + 1) * 60)
        .map((mint, eventIndex) => ({
          name: "BagFed",
          data: { mint },
          ixIndex: 0n,
          eventIndex: BigInt(eventIndex),
        }));
    });
    const { engine, source } = pipeline(txs, store, reconciler);
    await engine.poll();
    expect(calls).toHaveLength(4);
    expect(
      calls
        .filter(({ method }) => method === "getMultipleAccounts")
        .map(({ addresses }) => addresses.length),
    ).toEqual([2, 100, 1]);
    expect(calls.slice(2).flatMap(({ addresses }) => addresses)).toEqual(
      mints.map((mint) => ledgerAddress(programId, mint)),
    );
    expect(source.confirmedSlot).toHaveBeenCalledTimes(2);
    expect(store.advanceCursor).toHaveBeenCalledTimes(2);
    await engine.stop();
  });

  it("finishes ingestion while a Deck header changes between sliced reads", async () => {
    const db = database();
    const store = new IndexerStore(db.pool, {
      programId,
      royaltyPerDustCardBps: 200,
    });
    const deck = Buffer.alloc(ACCOUNT_BYTES.Deck + 3 * ACCOUNT_BYTES.deckEntry);
    accountDiscriminator("Deck").copy(deck);
    deck.writeUInt32LE(3, 8);
    deck.writeUInt32LE(3, 12);
    let chunks = 0;
    const request: JsonRpcClient["request"] = async (
      _method,
      params,
      schema,
    ) => {
      const { offset, length } = (
        params[1] as { dataSlice: { offset: number; length: number } }
      ).dataSlice;
      if (offset > 0) {
        chunks++;
        deck.writeBigUInt64LE(BigInt(chunks), 24);
      }
      return schema.parse({
        context: { slot: 40 },
        value: {
          owner: programId,
          executable: false,
          data: [
            deck.subarray(offset, offset + length).toString("base64"),
            "base64",
          ],
        },
      });
    };
    const real = new AccountReconciler({
      pool: db.pool,
      rpc: { request },
      programId,
      deckChunkBytes: 160,
      alert: vi.fn(async () => undefined),
      metrics: { indexerDeckDrift: { set: vi.fn() } as never },
    });
    const reconciler: Reconciler = {
      reconcile: vi.fn(async () => undefined),
      reconcileDeck: real.reconcileDeck.bind(real),
    };
    const failure = vi.fn(async () => undefined);
    const tx = transaction();
    const { engine, status } = pipeline(
      [tx],
      store,
      reconciler,
      programId,
      failure,
    );
    await expect(
      Promise.all([engine.maintenance.run(), engine.poll()]),
    ).resolves.toEqual([undefined, undefined]);
    expect(chunks).toBe(2);
    expect(failure).toHaveBeenCalledWith(
      "deck",
      expect.objectContaining({ message: "deck_changed_during_read" }),
      1,
    );
    expect(await store.cursor()).toEqual({
      lastSignature: tx.signature,
      lastSlot: tx.slot,
    });
    expect(status).toHaveBeenCalledOnce();
    await engine.stop();
  });
});
