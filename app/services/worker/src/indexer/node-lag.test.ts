import { createHash } from "node:crypto";
import { JsonRpcClient } from "@onepercent/service-kit";
import { M1_EVENT_IDL } from "@onepercent/sdk/events";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { IndexerEngine, type EngineStore } from "./engine.js";
import { mutateDeck, type DeckMirrorEntry } from "./projections.js";
import { FailoverRpc, SolanaTxSource } from "./source.js";
import type { IndexedTransaction } from "./store.js";

const programId = M1_EVENT_IDL.address;
const signature = (character: string) => character.repeat(88);
const codes = [-32004, -32016, -32007, -32009] as const;
const integer = (value: bigint, size: 2 | 4 | 8) => {
  const bytes = Buffer.alloc(size);
  if (size === 8) bytes.writeBigUInt64LE(value);
  else if (size === 4) bytes.writeUInt32LE(Number(value));
  else bytes.writeUInt16LE(Number(value));
  return bytes;
};
const owner = new PublicKey(Buffer.alloc(32, 7));
function eventBytes(
  name: "BagFed" | "BagTakenBack",
  mint: number,
  index: number,
) {
  return Buffer.concat([
    createHash("sha256").update(`event:${name}`).digest().subarray(0, 8),
    owner.toBuffer(),
    Buffer.alloc(32, mint),
    integer(100n, 8),
    integer(BigInt(index), 4),
    ...(name === "BagFed"
      ? [integer(25n, 8), integer(1n, 2)]
      : [integer(1n, 4), integer(25n, 8)]),
  ]).toString("base64");
}
const fixtures = [
  { signature: signature("2"), slot: 20, event: eventBytes("BagFed", 8, 0) },
  { signature: signature("3"), slot: 20, event: eventBytes("BagFed", 9, 1) },
  {
    signature: signature("4"),
    slot: 21,
    event: eventBytes("BagTakenBack", 8, 0),
  },
  { signature: signature("5"), slot: 22, event: eventBytes("BagFed", 10, 1) },
];
function rawTransaction(row: (typeof fixtures)[number]) {
  return {
    slot: row.slot,
    blockTime: 1000 + row.slot,
    transaction: {
      signatures: [row.signature],
      message: {
        accountKeys: [programId],
        instructions: [{ programIdIndex: 0, accounts: [], data: "" }],
      },
    },
    meta: {
      err: null,
      logMessages: [
        `Program ${programId} invoke [1]`,
        `Program data: ${row.event}`,
        `Program ${programId} success`,
      ],
    },
  };
}

function scenario(lagging: boolean) {
  let tip = 20;
  let exhaustedAttempts = 2;
  let lagResponses = 0;
  const attempts = new Map<string, number>();
  const fetchRpc = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    const { id, method, params } = request;
    const key = JSON.stringify([method, params]);
    const count = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, count);
    const exhaust = method === "getTransaction" && params[0] === signature("4");
    if (
      lagging &&
      ((exhaust && exhaustedAttempts > 0) || (!exhaust && count % 2))
    ) {
      if (exhaust) exhaustedAttempts--;
      const code = codes[lagResponses++ % codes.length];
      return Response.json({
        jsonrpc: "2.0",
        id,
        error: { code, message: "Node is behind" },
      });
    }
    let result: unknown;
    if (method === "getSlot") result = tip;
    else if (method === "getSignaturesForAddress") {
      const options = params[1] as { until?: string };
      const start =
        fixtures.findIndex((row) => row.signature === options.until) + 1;
      result = fixtures
        .slice(start)
        .filter((row) => row.slot <= tip)
        .reverse()
        .map((row) => ({
          signature: row.signature,
          slot: row.slot,
          err: null,
          blockTime: 1000 + row.slot,
          confirmationStatus: "confirmed",
        }));
    } else if (method === "getBlock") {
      result = {
        signatures: fixtures
          .filter((row) => row.slot === params[0])
          .map((row) => row.signature),
      };
    } else if (method === "getTransaction") {
      result = rawTransaction(
        fixtures.find((row) => row.signature === params[0])!,
      );
    } else throw new Error(`unexpected_method:${method}`);
    return Response.json({ jsonrpc: "2.0", id, result });
  });
  const rpc = new JsonRpcClient({
    url: "https://rpc.invalid",
    timeoutMs: 1000,
    failureThreshold: 3,
    recoverMs: 1000,
    fetch: fetchRpc,
    nodeLagRetry: { maxAttempts: 2, backoffBaseMs: 1, backoffMaxMs: 1 },
    sleep: async () => undefined,
  });
  const transactions = new Map<string, IndexedTransaction>();
  const deck = new Map<bigint, DeckMirrorEntry>();
  const finalized = new Set<string>();
  let cursor: { lastSignature: string; lastSlot: bigint } | null = null;
  const store: EngineStore = {
    cursor: async () => cursor,
    apply: vi.fn<EngineStore["apply"]>(async (tx) => {
      if (transactions.has(tx.signature)) return false;
      tx.events.forEach((event) => mutateDeck(deck, event));
      transactions.set(tx.signature, tx);
      return true;
    }),
    advanceCursor: vi.fn(async (lastSignature, lastSlot) => {
      cursor = { lastSignature, lastSlot };
    }),
    recordUnprocessable: vi.fn(async () => undefined),
    pendingFinality: async (slot) =>
      [...transactions.values()].filter(
        (tx) => tx.slot <= slot && !finalized.has(tx.signature),
      ),
    finalize: async (sig) => {
      finalized.add(sig);
    },
    rollback: vi.fn(async () => undefined),
  };
  const onNodeLag = vi.fn(async () => undefined);
  const engine = new IndexerEngine({
    source: new SolanaTxSource(rpc, programId),
    store,
    reconciler: {
      reconcile: async () => undefined,
      reconcileDeck: async () => undefined,
    },
    programId,
    onNodeLag,
    publish: async () => undefined,
    status: async () => undefined,
    accountReconcileSeconds: 300,
    deckReconcileSeconds: 600,
  });
  return {
    engine,
    store,
    onNodeLag,
    fetchRpc,
    advanceTip: () => {
      tip = 22;
    },
    snapshot: () => ({
      transactions: [...transactions.values()],
      deck: [...deck],
      finalized: [...finalized],
      cursor,
    }),
    lagResponses: () => lagResponses,
  };
}

describe("node lag through ingestion and projection", () => {
  it("produces the same ordered events and Deck after alternating nodes and an exhausted read", async () => {
    const healthy = scenario(false);
    const lagging = scenario(true);
    for (const run of [healthy, lagging]) {
      await run.engine.poll();
      expect(run.snapshot().cursor?.lastSignature).toBe(signature("3"));
      run.advanceTip();
      await run.engine.poll();
      if (run === lagging) {
        expect(run.snapshot().cursor?.lastSignature).toBe(signature("3"));
        expect(run.snapshot().transactions).toHaveLength(2);
        expect(run.onNodeLag).toHaveBeenCalledOnce();
      }
      await run.engine.poll();
      await run.engine.poll();
      expect(run.store.apply).toHaveBeenCalledTimes(4);
      expect(run.store.advanceCursor).toHaveBeenCalledTimes(4);
      expect(run.store.recordUnprocessable).not.toHaveBeenCalled();
      expect(run.store.rollback).not.toHaveBeenCalled();
      await run.engine.stop();
    }
    expect(lagging.snapshot()).toEqual(healthy.snapshot());
    expect(lagging.snapshot().transactions.map((tx) => tx.signature)).toEqual(
      fixtures.map((row) => row.signature),
    );
    expect(lagging.snapshot().deck.map(([, row]) => row.mint)).toEqual(
      [9, 10].map((n) => new PublicKey(Buffer.alloc(32, n)).toBase58()),
    );
    expect(lagging.lagResponses()).toBeGreaterThan(10);
  });

  it("finishes bounded primary attempts before requesting the fallback", async () => {
    const order: string[] = [];
    const client = (label: string) =>
      new JsonRpcClient({
        url: `https://${label}.invalid`,
        timeoutMs: 1000,
        failureThreshold: 3,
        recoverMs: 1000,
        nodeLagRetry: { maxAttempts: 3, backoffBaseMs: 1, backoffMaxMs: 1 },
        sleep: async () => undefined,
        fetch: async (_url, init) => {
          const { id } = JSON.parse(String(init?.body)) as { id: number };
          order.push(label);
          return Response.json(
            label === "primary"
              ? {
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32004, message: "Not available" },
                }
              : { jsonrpc: "2.0", id, result: 20 },
          );
        },
      });
    const source = new SolanaTxSource(
      new FailoverRpc({
        primary: client("primary"),
        secondary: client("fallback"),
        settings: {
          fallbackAfterFailures: 5,
          fallbackRecoverSeconds: 600,
          pollMs: 2000,
          accountReconcileSeconds: 300,
          deckReconcileSeconds: 600,
          deckChunkBytes: 262144,
          maxLagSecondsForIntake: 30,
          lagAlertSeconds: 60,
        },
        alert: async () => ({ recorded: true, delivered: true }),
      }),
      programId,
    );
    expect(await source.confirmedSlot()).toBe(20n);
    expect(order).toEqual(["primary", "primary", "primary", "fallback"]);
  });
});
