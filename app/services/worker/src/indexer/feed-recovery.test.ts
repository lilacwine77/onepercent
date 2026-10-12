import { describe, expect, it, vi } from "vitest";
import {
  prepareFeedRecovery,
  recoveredFeedEvents,
  RECOVERED_FEED,
} from "./feed-recovery.js";
import { feedProofFixture } from "./feed-proof.test-data.mjs";
import { projectEvent } from "./projections.js";
import {
  IndexerStore,
  type SqlExecutor,
  type SqlPool,
  type StoreOptions,
} from "./store.js";

function scenario() {
  const fixture = feedProofFixture();
  const options: StoreOptions = {
    programId: fixture.options.programId,
    royaltyPerDustCardBps: 200,
    getIntakeSigner: vi.fn().mockResolvedValue(fixture.options.intakeSigner),
  };
  const row = {
    wallet: fixture.owner,
    signer: fixture.signer,
    nonce: String(fixture.nonce),
    expiry: new Date(Number(fixture.expiry) * 1000),
    bags: [
      {
        mint: fixture.mints[0]!,
        amount: String(fixture.amounts[0]),
        path: "hop",
        via: "original",
      },
    ],
  };
  const sql: SqlExecutor = {
    query: vi.fn().mockResolvedValue({ rows: [row] }),
  };
  return { ...fixture, options, row, sql };
}

describe("missing Feed log recovery", () => {
  it("recovers provenance with no live bag, without projecting fabricated Deck or Feed fields", async () => {
    const { tx, options, sql } = scenario();
    const proofs = await prepareFeedRecovery(tx, options);
    const events = await recoveredFeedEvents(sql, tx, proofs, options);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: RECOVERED_FEED,
      eventIndex: -1n,
      data: {
        _indexer: {
          holder: "original",
          path: "hop",
          evidence: "incomplete",
          intakeLogMissing: false,
        },
      },
    });
    expect(events[0]!.data).not.toHaveProperty("deck_index");
    expect(events[0]!.data).not.toHaveProperty("deposit");
    const projection: SqlExecutor = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    await projectEvent(projection, tx, events[0]!, options);
    const writes = vi
      .mocked(projection.query)
      .mock.calls.filter(([query]) => /INSERT|UPDATE|DELETE/.test(query));
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toContain("INSERT INTO intake_consumption");
    expect(writes[0]![1]).toEqual([
      "original",
      tx.instructions.at(-1)!.accounts[7],
      tx.instructions.at(-1)!.accounts[0],
      "hop",
      tx.signature,
      String(tx.slot),
    ]);
  });
  it("marks a current-key join incomplete without discarding signed hop provenance", async () => {
    const { tx, options, sql, signer } = scenario();
    options.getIntakeSigner = async () => ({
      address: signer,
      source: "current",
    });
    const [event] = await recoveredFeedEvents(
      sql,
      tx,
      await prepareFeedRecovery(tx, options),
      options,
    );
    expect(event?.data._indexer).toMatchObject({
      evidence: "incomplete",
      holder: "original",
      path: "hop",
    });
  });
  it.each(["signer", "nonce", "expiry", "wallet", "bags"])(
    "rejects an attestation log with mismatched %s",
    async (field) => {
      const { tx, options, sql, row } = scenario();
      Object.assign(row, { [field]: field === "bags" ? [] : "invalid" });
      const [event] = await recoveredFeedEvents(
        sql,
        tx,
        await prepareFeedRecovery(tx, options),
        options,
      );
      expect(event?.data._indexer).toMatchObject({
        holder:
          row.wallet === "invalid"
            ? tx.instructions.at(-1)!.accounts[0]
            : row.wallet,
        path: "unknown",
        intakeLogMissing: true,
      });
    },
  );
  it("uses the shared S2 fallback only after a verified Feed and a missing log", async () => {
    const { tx, options } = scenario();
    const sql: SqlExecutor = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    options.recomputeProvenance = vi
      .fn()
      .mockResolvedValue({ path: "self", via: null });
    const [event] = await recoveredFeedEvents(
      sql,
      tx,
      await prepareFeedRecovery(tx, options),
      options,
    );
    expect(event?.data._indexer).toMatchObject({
      path: "self",
      intakeLogMissing: true,
    });
    expect(options.recomputeProvenance).toHaveBeenCalledOnce();
  });
  it("ignores failed transactions before any signer lookup or database write", async () => {
    const { tx, options } = scenario();
    tx.err = { InstructionError: [2, "Custom"] };
    const pool = { query: vi.fn(), connect: vi.fn() } as unknown as SqlPool;
    expect(await new IndexerStore(pool, options).apply(tx)).toBe(false);
    expect(options.getIntakeSigner).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("alerts and skips unreadable accounts without blocking the scan", async () => {
    const { tx, options } = scenario();
    options.alert = vi.fn().mockResolvedValue(undefined);
    tx.instructions.at(-1)!.accounts[8] = tx.instructions.at(-1)!.accounts[0]!;
    expect(await prepareFeedRecovery(tx, options)).toEqual([]);
    expect(options.alert).toHaveBeenCalledWith(
      "indexer_feed_recovery_incomplete",
      expect.objectContaining({ reason: "unreadable_feed_evidence" }),
    );
  });
  it("does not depend on current Config availability or signer rotation", async () => {
    const { tx, options, sql } = scenario();
    options.getIntakeSigner = vi.fn().mockRejectedValue(new Error("rotated"));
    const [event] = await recoveredFeedEvents(
      sql,
      tx,
      await prepareFeedRecovery(tx, options),
      options,
    );
    expect(event?.data._indexer).toMatchObject({
      evidence: "incomplete",
      path: "hop",
    });
    expect(options.getIntakeSigner).not.toHaveBeenCalled();
    delete options.getIntakeSigner;
    expect(await prepareFeedRecovery(tx, options)).toHaveLength(1);
  });
  it("reuses durable evidence on duplicate processing after key rotation", async () => {
    const { tx, options, sql } = scenario();
    tx.events = await recoveredFeedEvents(
      sql,
      tx,
      await prepareFeedRecovery(tx, options),
      options,
    );
    options.getIntakeSigner = vi.fn().mockRejectedValue(new Error("rotated"));
    expect(await prepareFeedRecovery(tx, options)).toEqual([]);
    expect(options.getIntakeSigner).not.toHaveBeenCalled();
  });
  it("recovers only missing bags when another BagFed was retained", async () => {
    const fixture = feedProofFixture({ count: 2 });
    fixture.tx.events = [
      {
        name: "BagFed",
        ixIndex: BigInt(fixture.ixIndex),
        eventIndex: 0n,
        data: {
          depositor: fixture.owner,
          mint: fixture.mints[0]!,
          amount: String(fixture.amounts[0]),
        },
      },
    ];
    const options: StoreOptions = {
      programId: fixture.options.programId,
      royaltyPerDustCardBps: 200,
      getIntakeSigner: async () => fixture.options.intakeSigner,
    };
    const events = await recoveredFeedEvents(
      { query: async () => ({ rows: [] }) },
      fixture.tx,
      await prepareFeedRecovery(fixture.tx, options),
      options,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.data.mint).toBe(fixture.mints[1]);
  });
});
