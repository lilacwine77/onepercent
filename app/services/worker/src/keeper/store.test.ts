import { randomBytes } from "node:crypto";
import { createDatabase } from "@onepercent/db";
import {
  PublicKey,
  TransactionInstruction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import type { SignedTxRecord } from "@onepercent/service-kit";
import { describe, expect, it, vi } from "vitest";
import { jobId, type KeeperIntent } from "./jobs.js";
import {
  PostgresKeeperStore,
  encodeInstructionPlan,
  decodeInstructionPlan,
  type KeeperJob,
} from "./store.js";

const address = new PublicKey(Buffer.alloc(32, 1)).toBase58();
const instructions = [
  new TransactionInstruction({
    programId: new PublicKey(Buffer.alloc(32, 2)),
    keys: [
      { pubkey: new PublicKey(address), isSigner: false, isWritable: true },
    ],
    data: Buffer.from("fixture"),
  }),
];
const intent: KeeperIntent = { kind: "refund", address, seq: "700" };
const now = new Date("2026-10-09T00:00:00Z");
const record = (last = "1"): SignedTxRecord => ({
  fingerprint: "a".repeat(64),
  signature: "1".repeat(63) + last,
  transactionBase64: "AA==",
  lastValidBlockHeight: 100,
  status: "signed",
});
const initial = (item: KeeperIntent = intent): KeeperJob => ({
  id: jobId(item),
  kind: item.kind,
  payload: { intent: item },
  status: "pending",
  attempts: 0,
  next_attempt_at: now,
  last_error: null,
  signature: null,
});
function memoryPool() {
  const rows = new Map<string, KeeperJob>();
  let before: ((sql: string, values: unknown[]) => Promise<void>) | undefined;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    await before?.(sql, values);
    const id = String(values[0]);
    const row = rows.get(id);
    const result = (values: unknown[]) => ({
      rows: structuredClone(values),
      rowCount: values.length,
    });
    if (sql.startsWith("INSERT")) {
      if (!row) {
        const payload = JSON.parse(String(values[2])) as KeeperJob["payload"];
        rows.set(id, {
          ...initial(payload.intent),
          next_attempt_at: values[3] as Date,
        });
      }
      return result([]);
    }
    if (sql.startsWith("SELECT *") && sql.includes("status IN"))
      return result(
        [...rows.values()].filter(
          (job) =>
            (["pending", "sent", "failed"].includes(job.status) ||
              (job.status === "confirmed" && !job.payload.finalized)) &&
            job.next_attempt_at <= (values[0] as Date) &&
            (job.attempts < Number(values[1]) ||
              (!!job.payload.transaction &&
                !job.payload.transaction.expired &&
                !job.payload.transaction.finalized &&
                !(
                  job.payload.transaction.status === "failed" &&
                  (job.payload.transaction.finalized ||
                    job.payload.transaction.failureProof === "preflight")
                ))),
        ),
      );
    if (sql.startsWith("SELECT *"))
      return result(
        row &&
          (!sql.includes("payload->>'claim'") ||
            row.payload.claim === values[1])
          ? [row]
          : [],
      );
    if (sql.includes("'{claim}'")) {
      if (!row || (row.payload.claim ?? "") !== values[2]) return result([]);
      row.payload.claim = String(values[1]);
      return result([row]);
    }
    if (sql.includes("WITH previous")) {
      const previous = [...rows.values()].some(
        (item) =>
          item.kind === "close-vault" &&
          item.status === "skipped" &&
          item.last_error === values[1] &&
          item.payload.intent.kind === "close-vault" &&
          row?.payload.intent.kind === "close-vault" &&
          item.payload.intent.mint === row.payload.intent.mint &&
          item.payload.intent.payer === row.payload.intent.payer,
      );
      const updated =
        !!row &&
        row.payload.claim === values[2] &&
        row.status !== "skipped" &&
        !row.payload.transaction;
      if (updated) {
        row.status = "skipped";
        row.last_error = String(values[1]);
      }
      return result([{ updated, notify: !previous }]);
    }
    const termIndex =
      sql.includes("'{transaction}'") || sql.includes("next_attempt_at=$4")
        ? 4
        : 2;
    if (!row || row.payload.claim !== values[termIndex]) return result([]);
    if (sql.includes("attempts=attempts+1")) {
      if (row.attempts >= Number(values[1])) return result([]);
      row.attempts++;
      return result([{ attempts: row.attempts }]);
    }
    if (sql.includes("'{transaction}'")) {
      Object.assign(row.payload, JSON.parse(String(values[5])));
      row.payload.transaction = JSON.parse(String(values[1])) as SignedTxRecord;
      row.signature = String(values[2]);
      row.status = values[3] as KeeperJob["status"];
      return result([row]);
    }
    if (sql.includes("'{computeUnitLimit}'")) {
      if (row.payload.transaction) return result([]);
      row.payload.computeUnitLimit = Number(values[1]);
      row.payload.instructions = JSON.parse(
        String(values[3]),
      ) as KeeperJob["payload"]["instructions"];
      return result([row]);
    }
    if (sql.includes("next_attempt_at=$4")) {
      Object.assign(row.payload, JSON.parse(String(values[5])));
      row.status = values[1] as KeeperJob["status"];
      row.last_error = values[2] as string | null;
      row.next_attempt_at = values[3] as Date;
      return result([row]);
    }
    throw new Error("unexpected_test_query");
  });
  return {
    rows,
    query,
    pool: { query } as unknown as ConstructorParameters<
      typeof PostgresKeeperStore
    >[0],
    before(fn: typeof before) {
      before = fn;
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("keeper durable term fencing", () => {
  it("atomically replaces bytes and original plan without resetting attempts", async () => {
    const db = memoryPool();
    const store = new PostgresKeeperStore(db.pool);
    const job = await store.ensure(intent, now);
    await store.claim(job.id);
    await store.budget(job.id, 3000, instructions);
    await store.reserveAttempt(job.id, 5);
    await store.write(job.id, record());
    const replacement = new TransactionInstruction({
      ...instructions[0]!,
      data: Buffer.from("replacement"),
    });
    await store.write(job.id, record("2"), {
      computeUnitLimit: 4000,
      instructions: [replacement],
    });
    const next = await store.claim(job.id);
    expect(next.payload.transaction).toEqual(record("2"));
    expect(next.payload.computeUnitLimit).toBe(4000);
    expect(next.payload.instructions).toEqual(
      encodeInstructionPlan([replacement]),
    );
    expect(next.attempts).toBe(1);
    await store.write(job.id, { ...record("2"), status: "confirmed" });
    expect((await store.claim(job.id)).payload.instructions).toEqual(
      next.payload.instructions,
    );
  });
  it("keeps confirmed jobs due until finality and reopens forked signed records", async () => {
    const db = memoryPool();
    const store = new PostgresKeeperStore(db.pool);
    const job = await store.ensure(intent, now);
    await store.claim(job.id);
    await store.write(job.id, { ...record(), status: "confirmed" });
    await store.finish(job.id, "confirmed", null, now, false);
    expect((await store.due(now)).map((job) => job.id)).toEqual([job.id]);
    await store.finish(job.id, "confirmed", null, now, true);
    expect(await store.due(now)).toEqual([]);
    await store.write(job.id, record());
    const restored = (await store.due(now))[0]!;
    expect(restored.payload.finalized).toBe(false);
    expect(restored.payload.confirmationObserved).toBe(true);
    expect(restored.payload.transaction?.transactionBase64).toBe(
      record().transactionBase64,
    );
  });
  it("preserves bytes and attempts while refusing all stale-term mutations", async () => {
    const db = memoryPool();
    const first = new PostgresKeeperStore(db.pool);
    const second = new PostgresKeeperStore(db.pool);
    const job = await first.ensure(intent, now);
    await first.claim(job.id);
    await first.budget(job.id, 3000, instructions);
    expect(await first.reserveAttempt(job.id, 5)).toBe(1);
    await first.write(job.id, record());
    const taken = await second.claim(job.id);
    expect(taken.payload.transaction).toEqual(record());
    expect(taken.attempts).toBe(1);
    expect(taken.payload.computeUnitLimit).toBe(3000);
    expect(taken.payload.instructions).toEqual(
      encodeInstructionPlan(instructions),
    );
    expect(
      decodeInstructionPlan(taken.payload.instructions)[0]?.keys[0]?.isSigner,
    ).toBe(false);
    expect(await second.read(job.id)).toEqual(record());
    for (const operation of [
      () => first.read(job.id),
      () => first.write(job.id, record("2")),
      () => first.finish(job.id, "failed", "old", now),
      () => first.reserveAttempt(job.id, 5),
      () => first.budget(job.id, 4000, instructions),
      () => first.skip(job.id, "old"),
    ])
      await expect(operation()).rejects.toThrow("keeper_claim_lost");
    expect(await second.reserveAttempt(job.id, 5)).toBe(2);
  });
  it("does not overwrite a newer signature when an old journal write arrives late", async () => {
    const db = memoryPool();
    const first = new PostgresKeeperStore(db.pool);
    const second = new PostgresKeeperStore(db.pool);
    const job = await first.ensure(intent, now);
    await first.claim(job.id);
    const entered = deferred();
    const release = deferred();
    db.before(async (sql, values) => {
      if (sql.includes("'{transaction}'") && values[4] === first.term) {
        entered.resolve();
        await release.promise;
      }
    });
    const stale = first.write(job.id, record()).then(
      () => "unexpected",
      (error: Error) => error.message,
    );
    await entered.promise;
    await second.claim(job.id);
    await second.write(job.id, record("2"));
    expect(await second.reserveAttempt(job.id, 5)).toBe(1);
    await expect(first.reserveAttempt(job.id, 5)).rejects.toThrow(
      "keeper_claim_lost",
    );
    release.resolve();
    expect(await stale).toBe("keeper_claim_lost");
    expect(await second.read(job.id)).toEqual(record("2"));
  });
  it("CAS rejects a stale claim statement delayed after a newer claim", async () => {
    const db = memoryPool();
    const first = new PostgresKeeperStore(db.pool);
    const second = new PostgresKeeperStore(db.pool);
    const job = await first.ensure(intent, now);
    const entered = deferred();
    const release = deferred();
    db.before(async (sql, values) => {
      if (sql.includes("'{claim}'") && values[1] === first.term) {
        entered.resolve();
        await release.promise;
      }
    });
    const stale = first.claim(job.id).then(
      () => "unexpected",
      (error: Error) => error.message,
    );
    await entered.promise;
    await second.claim(job.id);
    release.resolve();
    expect(await stale).toBe("keeper_claim_conflict");
    expect((await second.claim(job.id)).payload.claim).toBe(second.term);
  });
  it("does not claim after an abort during the preceding read", async () => {
    const db = memoryPool();
    const abort = new AbortController();
    const first = new PostgresKeeperStore(db.pool, {
      assertActive: () => abort.signal.throwIfAborted(),
    });
    const job = await first.ensure(intent, now);
    db.before(async (sql) => {
      if (sql.startsWith("SELECT")) abort.abort();
    });
    await expect(first.claim(job.id)).rejects.toThrow();
    expect(db.rows.get(job.id)?.payload.claim).toBeUndefined();
  });
  it("keeps exhaustion distinct from fencing and never resets durable attempts", async () => {
    const db = memoryPool();
    const store = new PostgresKeeperStore(db.pool);
    const job = await store.ensure(intent, now);
    await store.claim(job.id);
    expect(await store.reserveAttempt(job.id, 1)).toBe(1);
    expect(await store.reserveAttempt(job.id, 1)).toBeNull();
    await store.write(job.id, record());
    expect(await store.skip(job.id, "state_changed")).toBe(false);
    expect(db.rows.get(job.id)?.status).toBe("sent");
    await store.write(job.id, { ...record(), status: "failed" });
    expect((await store.ensure(intent, now)).attempts).toBe(1);
    await expect(store.budget(job.id, 999, instructions)).rejects.toThrow(
      "keeper_budget_conflict",
    );
  });
  it("alerts a non-writable payer only once across hourly close passes", async () => {
    const db = memoryPool();
    const store = new PostgresKeeperStore(db.pool);
    const close: KeeperIntent = {
      kind: "close-vault",
      mint: address,
      payer: address,
      window: "1",
    };
    const first = await store.ensure(close, now);
    await store.claim(first.id);
    expect(await store.skip(first.id, "payer_not_writable")).toBe(true);
    expect(await store.skip(first.id, "payer_not_writable")).toBe(false);
    const next = await store.ensure({ ...close, window: "2" }, now);
    await store.claim(next.id);
    expect(await store.skip(next.id, "payer_not_writable")).toBe(false);
    expect(db.rows.get(next.id)?.status).toBe("skipped");
  });
});

const integration = process.env["SERVICES_INTEGRATION"] === "1";
const databaseUrl = process.env["TEST_DATABASE_URL"];
if (
  integration &&
  (!databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    ))
)
  throw new Error("TEST_DATABASE_URL must target a local CI/dev container");
describe.skipIf(!integration)("keeper Postgres integration", () => {
  it("fences a late write, preserves retry state, and deduplicates payer alerts", async () => {
    const db = createDatabase({ connectionString: databaseUrl! });
    const seq = randomBytes(8).readBigUInt64LE().toString();
    const item: KeeperIntent = { kind: "refund", address, seq };
    const ids: string[] = [];
    let release: (() => void) | undefined;
    try {
      const first = new PostgresKeeperStore(db.pool);
      const second = new PostgresKeeperStore(db.pool, { sendMaxAttempts: 2 });
      const job = await first.ensure(item, now);
      ids.push(job.id);
      await first.claim(job.id);
      await first.budget(job.id, 3000, instructions);
      expect(await first.reserveAttempt(job.id, 2)).toBe(1);
      const captured = deferred();
      const gate = deferred();
      release = gate.resolve;
      const wrapped = {
        query: async (sql: string, values: unknown[]) => {
          if (sql.includes("'{transaction}'")) {
            captured.resolve();
            await gate.promise;
          }
          return db.pool.query(sql, values);
        },
      } as unknown as ConstructorParameters<typeof PostgresKeeperStore>[0];
      const old = new PostgresKeeperStore(wrapped);
      await old.claim(job.id);
      const delayed = old.write(job.id, record()).then(
        () => "unexpected",
        (error: Error) => error.message,
      );
      await captured.promise;
      await second.claim(job.id);
      await second.write(job.id, record("2"));
      gate.resolve();
      expect(await delayed).toBe("keeper_claim_lost");
      expect(await second.read(job.id)).toEqual(record("2"));
      expect(await second.reserveAttempt(job.id, 2)).toBe(2);
      expect(await second.reserveAttempt(job.id, 2)).toBeNull();
      expect((await second.due(now)).some((row) => row.id === job.id)).toBe(
        true,
      );
      await second.write(job.id, { ...record("2"), expired: true });
      expect((await second.due(now)).some((row) => row.id === job.id)).toBe(
        false,
      );
      const mint = new PublicKey(randomBytes(32)).toBase58();
      for (const window of ["1", "2"]) {
        const close: KeeperIntent = {
          kind: "close-vault",
          mint,
          payer: address,
          window,
        };
        const current = await second.ensure(close, now);
        ids.push(current.id);
        await second.claim(current.id);
        expect(await second.skip(current.id, "payer_not_writable")).toBe(
          window === "1",
        );
      }
    } finally {
      release?.();
      if (ids.length)
        await db.pool.query(
          "DELETE FROM keeper_jobs WHERE id=ANY($1::text[])",
          [ids],
        );
      await db.close();
    }
  });
});

it("keeps exhausted jobs out of the hot drain unless their signature remains ambiguous", async () => {
  const db = memoryPool();
  const store = new PostgresKeeperStore(db.pool, { sendMaxAttempts: 1 });
  const job = await store.ensure(intent, now);
  await store.claim(job.id);
  await store.reserveAttempt(job.id, 1);
  expect(await store.due(now)).toEqual([]);
  await store.write(job.id, record());
  expect(await store.due(now)).toHaveLength(1);
  await store.write(job.id, { ...record(), expired: true });
  expect(await store.due(now)).toEqual([]);
  await store.write(job.id, { ...record(), status: "failed", finalized: true });
  expect(await store.due(now)).toEqual([]);
  await store.write(job.id, {
    ...record(),
    status: "failed",
    failureProof: "preflight",
  });
  expect(await store.due(now)).toEqual([]);
  await store.write(job.id, { ...record(), status: "failed" });
  expect(await store.due(now)).toHaveLength(1);
  await store.write(job.id, {
    ...record(),
    status: "confirmed",
    finalized: false,
  });
  expect(await store.due(now)).toHaveLength(1);
});

it("persists lookup-table identities atomically with the original plan for K1", async () => {
  const db = memoryPool();
  const store = new PostgresKeeperStore(db.pool);
  const job = await store.ensure(intent, now);
  await store.claim(job.id);
  const table = new AddressLookupTableAccount({
    key: new PublicKey(address),
    state: {
      deactivationSlot: 0xffffffffffffffffn,
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      addresses: [instructions[0]!.programId],
    },
  });
  await store.write(job.id, record(), {
    instructions,
    computeUnitLimit: 3000,
    lookupTables: [table],
  });
  expect((await store.claim(job.id)).payload.lookupTables).toEqual([address]);
  await store.write(job.id, { ...record(), status: "confirmed" });
  expect((await store.claim(job.id)).payload.lookupTables).toEqual([address]);
});
