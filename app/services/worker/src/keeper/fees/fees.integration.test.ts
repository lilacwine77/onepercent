import { createDatabase } from "@onepercent/db";
import { KEEPER_POLICY, MONITOR } from "@onepercent/config";
import {
  TxSender,
  serviceParams,
  type TxRpc,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { PostgresKeeperStore } from "../store.js";
import { jobId } from "../jobs.js";
import { createFeeKeeper } from "./index.js";
import type { FeeChainReader, FeeSnapshot } from "./chain.js";

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
describe.skipIf(!integration)("fee exhaustion Postgres regression", () => {
  it("preserves five finalized failures across restart and permits the next collection while blocking ambiguous signatures", async () => {
    const db = createDatabase({ connectionString: databaseUrl! });
    const season = String(Date.now());
    const signal = new AbortController().signal;
    const signer = Keypair.generate();
    const initial = {
      kind: "fee-chain" as const,
      season,
      reason: "periodic" as const,
      window: "1000",
    };
    const store = new PostgresKeeperStore(db.pool);
    const reader = {
      read: async () =>
        ({
          season,
          phase: 3,
          onAirTs: 1000n,
          endTs: 2000n,
          waiting: true,
          baseFees: 0n,
          reserveFingerprint: "curve:1:2",
        }) as FeeSnapshot,
    } as unknown as FeeChainReader;
    const runtime = {
      pool: db.pool,
      env: { PROGRAM_ID: "fixture" },
      redis: { get: async () => null, set: async () => undefined },
      alerts: { alert: vi.fn() },
      logger: { warn: vi.fn() },
    } as unknown as ServiceRuntime;
    const make = (next: PostgresKeeperStore) =>
      createFeeKeeper({
        reader,
        store: next,
        runtime,
        params: { KEEPER_POLICY, MONITOR },
        assertActive: () => undefined,
      });
    let blockhash = 0;
    const rpc: TxRpc = {
      getLatestBlockhash: async () => ({
        blockhash: new PublicKey(Buffer.alloc(32, ++blockhash)).toBase58(),
        lastValidBlockHeight: 100,
      }),
      getRecentPrioritizationFees: async () => [],
      simulateTransaction: async () => ({ err: null }),
      sendRawTransaction: async () =>
        (await store.read(jobId(initial)))!.signature,
      getSignatureStatuses: async () => [
        { err: { InstructionError: [0, 1] }, confirmationStatus: "finalized" },
      ],
      getBlockHeight: async () => 99,
    };
    try {
      const job = await store.ensure(initial, new Date(1_000_000));
      await store.claim(job.id);
      const sender = new TxSender({
        rpc,
        journal: store,
        role: "keeper",
        signer: {
          publicKey: signer.publicKey,
          signTransaction: (tx) => tx.sign([signer]),
        },
        assertAuthorized: () => undefined,
        assertLeader: () => undefined,
        sendMaxAttempts: serviceParams.keeper.sendMaxAttempts,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
        cuMarginBps: 0,
        maxComputeUnitPriceMicroLamports: 1n,
        sleep: async () => undefined,
      });
      await expect(
        sender.send({
          job: job.id,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: signer.publicKey,
              toPubkey: PublicKey.default,
              lamports: 1n,
            }),
          ],
          computeUnitLimit: 100_000,
          isComplete: async () => false,
        }),
      ).rejects.toMatchObject({ code: "transaction_failed" });
      await store.finish(
        job.id,
        "failed",
        "transaction_failed",
        new Date(1_000_000),
      );
      const record = await store.read(job.id);
      expect(record).toMatchObject({ status: "failed", finalized: true });
      const restart = new PostgresKeeperStore(db.pool);
      const retained = await restart.claim(job.id);
      expect(retained.attempts).toBe(serviceParams.keeper.sendMaxAttempts);
      expect(
        (await restart.due(new Date(1_400_000))).some(
          (item) => item.id === job.id,
        ),
      ).toBe(false);
      await make(restart).discover(1400n, signal);
      const next = await db.pool.query(
        "SELECT * FROM keeper_jobs WHERE kind='fee-chain' AND payload->'intent'->>'season'=$1 ORDER BY id",
        [season],
      );
      expect(next.rows).toHaveLength(2);
      expect(
        next.rows.find((item) => item.id === job.id)?.payload.transaction,
      ).toEqual(record);
      // An exhausted budget never releases a possibly live signature.
      await db.pool.query("DELETE FROM keeper_jobs WHERE id=$1", [
        jobId({ ...initial, window: "1400" }),
      ]);
      await restart.write(job.id, {
        ...record!,
        status: "signed",
        finalized: false,
      });
      expect(
        (await restart.due(new Date(1_400_000))).some(
          (item) => item.id === job.id,
        ),
      ).toBe(true);
      await make(new PostgresKeeperStore(db.pool)).discover(1400n, signal);
      expect(
        (
          await db.pool.query(
            "SELECT id FROM keeper_jobs WHERE payload->'intent'->>'season'=$1",
            [season],
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await db.pool.query(
        "DELETE FROM keeper_jobs WHERE kind='fee-chain' AND payload->'intent'->>'season'=$1",
        [season],
      );
      await db.close();
    }
  });
});
