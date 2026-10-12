import { randomUUID } from "node:crypto";
import { applyMigrations, createDatabase } from "@onepercent/db";
import { TxSender, type TxRpc } from "@onepercent/service-kit";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresExecutorStore, type ExecutorIntent } from "./store.js";

const enabled = process.env.SERVICES_INTEGRATION === "1";
const url = process.env.TEST_DATABASE_URL;
if (
  enabled &&
  (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
)
  throw new Error("SERVICES_INTEGRATION requires a local TEST_DATABASE_URL");

describe.skipIf(!enabled)("executor completed history on Postgres", () => {
  const name = `executor_history_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createDatabase>;
  let db: ReturnType<typeof createDatabase>;
  let order = 0;
  const current = Keypair.fromSeed(Buffer.alloc(32, 42));
  const previous = Keypair.fromSeed(Buffer.alloc(32, 43));
  const programId = new PublicKey(Buffer.alloc(32, 44)).toBase58();
  const identity = {
    cluster: "localnet" as const,
    programId,
    signer: current.publicKey,
  };
  beforeAll(async () => {
    admin = createDatabase({ connectionString: url! });
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    const isolated = new URL(url!);
    isolated.pathname = `/${name}`;
    db = createDatabase({ connectionString: isolated.href });
    await applyMigrations(db.pool);
  }, 30_000);
  beforeEach(async () => {
    order = 0;
    await db.pool.query("TRUNCATE executor_jobs, executor_trades");
  });
  afterAll(async () => {
    await db?.close();
    if (admin) {
      await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.close();
    }
  });
  async function completed(
    kind: "burn" | "jackpot",
    signer = current,
    overrides: Partial<Pick<ExecutorIntent, "cluster" | "programId">> = {},
    status: "confirmed" | "failed" = "confirmed",
    finalized = true,
  ) {
    const store = new PostgresExecutorStore(db.pool, () => {});
    const job = await store.create(
      {
        id: randomUUID(),
        kind,
        cluster: identity.cluster,
        programId,
        mint: new PublicKey(Buffer.alloc(32, 45)).toBase58(),
        previousTradeTs: "0",
        amount: "1",
        minOut: "1",
        jupiterOut: "1",
        ...overrides,
      },
      {
        instructions: [
          SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: PublicKey.default,
            lamports: 1n,
          }),
        ],
        computeUnitLimit: 10_000,
      },
    );
    const rpc: TxRpc = {
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 100,
      }),
      getRecentPrioritizationFees: async () => [],
      simulateTransaction: async () => ({ err: null }),
      sendRawTransaction: async () =>
        (await store.read(job.intent.id))!.signature,
      getSignatureStatuses: async () => [
        { err: null, confirmationStatus: "finalized" },
      ],
      getBlockHeight: async () => 99,
    };
    await new TxSender({
      rpc,
      journal: store,
      role: "executor",
      signer: {
        publicKey: signer.publicKey,
        signTransaction: (tx) => tx.sign([signer]),
      },
      assertAuthorized: () => {},
      sendMaxAttempts: 1,
      backoffBaseMs: 1,
      backoffMaxMs: 1,
      cuMarginBps: 0,
      maxComputeUnitPriceMicroLamports: 1n,
    }).send({ ...job.plan, job: job.intent.id, isComplete: async () => false });
    await store.outcome(job, { status, finalized });
    await db.pool.query(
      "UPDATE executor_jobs SET created_at=to_timestamp($2) WHERE id=$1",
      [job.intent.id, ++order],
    );
    return job;
  }
  it("selects each kind's latest successful finalized receipt for the deployment and signer, across pages and rotation", async () => {
    const burn = await completed("burn");
    const jackpot = await completed("jackpot");
    await completed("burn", current, {}, "confirmed", false);
    await completed("burn", current, {}, "failed");
    await completed("burn", current, { cluster: "devnet" });
    await completed("burn", current, {
      programId: PublicKey.default.toBase58(),
    });
    const old = await completed("burn", previous);
    const payload = (
      await db.pool.query("SELECT payload FROM executor_jobs WHERE id=$1", [
        old.intent.id,
      ])
    ).rows[0].payload;
    for (let index = 0; index < 33; index += 1) {
      const id = randomUUID();
      await db.pool.query(
        "INSERT INTO executor_jobs(id,kind,payload,status,created_at) VALUES($1,'burn',$2::jsonb,'confirmed',to_timestamp($3))",
        [
          id,
          JSON.stringify({
            ...payload,
            intent: { ...payload.intent, id, tradeId: randomUUID() },
          }),
          ++order,
        ],
      );
    }
    const restarted = new PostgresExecutorStore(db.pool, () => {});
    expect((await restarted.latestCompleted("burn", identity))?.intent.id).toBe(
      burn.intent.id,
    );
    expect(
      (await restarted.latestCompleted("jackpot", identity))?.intent.id,
    ).toBe(jackpot.intent.id);
    expect(
      await restarted.latestCompleted("burn", {
        ...identity,
        signer: Keypair.generate().publicKey,
      }),
    ).toBeNull();
  }, 30_000);
  it("fails closed on missing or invalid signed evidence instead of treating the source balance as donated", async () => {
    const store = new PostgresExecutorStore(db.pool, () => {});
    const job = await completed("burn");
    await db.pool.query(
      "UPDATE executor_jobs SET payload=payload - 'transaction' WHERE id=$1",
      [job.intent.id],
    );
    await expect(store.latestCompleted("burn", identity)).rejects.toThrow(
      "executor_history_unavailable",
    );
    const latest = await completed("burn");
    await db.pool.query(
      "UPDATE executor_jobs SET payload=jsonb_set(payload,'{transaction,transactionBase64}','\"AQID\"'::jsonb) WHERE id=$1",
      [latest.intent.id],
    );
    await expect(store.latestCompleted("burn", identity)).rejects.toThrow();
  });
});
