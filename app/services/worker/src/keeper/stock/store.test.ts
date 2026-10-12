import { expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { ServiceRuntime, SignedTxRecord } from "@onepercent/service-kit";
import { encodeInstructionPlan } from "../store.js";
import { StockStore } from "./store.js";

it("recovers exact signed bytes and instructions under a new leader claim; stale writers fail closed", async () => {
  const id = "db421600-04df-4d03-a711-6304259b7545";
  let state: Record<string, unknown> = {};
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith("SELECT id,state")) return { rows: [{ id, state }] };
    if (sql.startsWith("SELECT state"))
      return { rows: values?.[1] === state.claim ? [{ state }] : [] };
    if (sql.startsWith("UPDATE stock_plans SET state=state")) {
      const owns = values?.[2] === state.claim;
      if (owns) state = { ...state, ...JSON.parse(String(values?.[1])) };
      return { rowCount: owns ? 1 : 0, rows: [] };
    }
    throw new Error("unexpected stock query");
  });
  const pool = { query } as unknown as ServiceRuntime["pool"];
  const first = new StockStore(pool, () => {});
  state = { claim: first.term, done: false, attempts: 1 };
  const record: SignedTxRecord = {
    fingerprint: "a".repeat(64),
    signature: "1".repeat(64),
    transactionBase64: "AQID",
    lastValidBlockHeight: 123,
    status: "signed",
  };
  const instructions = [
    SystemProgram.transfer({
      fromPubkey: PublicKey.default,
      toPubkey: new PublicKey(new Uint8Array(32).fill(2)),
      lamports: 1,
    }),
  ];
  const signer = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [],
    }).compileToV0Message(),
  );
  tx.sign([signer]);
  record.transactionBase64 = Buffer.from(tx.serialize()).toString("base64");
  await first.write(id, record, { instructions, computeUnitLimit: 100000 });
  const restarted = new StockStore(pool, () => {});
  expect(await restarted.pending()).toBe(id);
  expect(await restarted.read(id)).toEqual(record);
  expect((await restarted.state(id)).attempts).toBe(1);
  const restored = await restarted.restore(id);
  expect(restored?.instructions).toEqual(instructions);
  await expect(
    first.write(id, { ...record, status: "failed" }),
  ).rejects.toThrow("stock_claim_lost");
  expect(await restarted.read(id)).toEqual(record);
});

it("never mutates a journal after loss of leadership", async () => {
  const query = vi.fn();
  const store = new StockStore(
    { query } as unknown as ServiceRuntime["pool"],
    () => {
      throw new Error("leadership_lost");
    },
  );
  await expect(store.update("plan", { done: true })).rejects.toThrow(
    "leadership_lost",
  );
  await expect(store.reserveAttempt("plan", 5)).rejects.toThrow(
    "leadership_lost",
  );
  expect(query).not.toHaveBeenCalled();
});

it("retires an unsigned pending plan before reading unavailable LUTs", async () => {
  let state: Record<string, unknown>;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith("SELECT id,state"))
      return {
        rows: state.done
          ? []
          : [{ id: "db421600-04df-4d03-a711-6304259b7545", state }],
      };
    if (sql.startsWith("SELECT state")) return { rows: [{ state }] };
    if (sql.startsWith("UPDATE stock_plans")) {
      state = { ...state, ...JSON.parse(String(values?.[1])) };
      return { rows: [], rowCount: 1 };
    }
    throw new Error("unexpected query");
  });
  const store = new StockStore(
    { query } as unknown as ServiceRuntime["pool"],
    () => {},
  );
  state = {
    claim: store.term,
    done: false,
    attempts: 0,
    instructions: encodeInstructionPlan([
      SystemProgram.transfer({
        fromPubkey: PublicKey.default,
        toPubkey: new PublicKey(new Uint8Array(32).fill(2)),
        lamports: 1,
      }),
    ]),
    computeUnitLimit: 100000,
    lookupTables: [PublicKey.default.toBase58()],
  };
  const id = (await store.pending())!;
  const unavailableLookup = vi.fn(async () => {
    throw new Error("lut_unavailable");
  });
  expect(
    await Reflect.apply(store.restore, store, [id, unavailableLookup]),
  ).toBeNull();
  expect(unavailableLookup).not.toHaveBeenCalled();
  expect(await store.pending()).toBeNull();
  expect(state.done).toBe(true);
});
