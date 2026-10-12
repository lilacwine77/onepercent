import { warnCause } from "@onepercent/service-kit";
import { randomUUID } from "node:crypto";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { z } from "zod";
import {
  signedTxRecordSchema,
  signedTxPayer,
  type SignedTxRecord,
  type TxInstructionPlan,
  type TxJournal,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import type { ExecutorKind } from "./policy.js";
const serializedPlan = z.object({
  computeUnitLimit: z.number().int().positive().safe(),
  instructions: z.array(
    z.object({
      programId: z.string(),
      keys: z.array(
        z.object({
          pubkey: z.string(),
          isSigner: z.boolean(),
          isWritable: z.boolean(),
        }),
      ),
      data: z.string(),
    }),
  ),
  lookupTables: z.array(
    z.object({
      key: z.string(),
      addresses: z.array(z.string()),
      deactivationSlot: z.string(),
      lastExtendedSlot: z.number().int(),
      lastExtendedSlotStartIndex: z.number().int(),
      authority: z.string().optional(),
    }),
  ),
});
export interface ExecutorIntent {
  cluster: "localnet" | "devnet" | "mainnet";
  programId: string;
  id: string;
  tradeId: string;
  kind: ExecutorKind;
  mint: string;
  previousTradeTs: string;
  amount: string;
  minOut: string;
  jupiterOut: string;
}
const intentSchema = z.object({
  cluster: z.enum(["localnet", "devnet", "mainnet"]),
  programId: z.string(),
  id: z.string(),
  tradeId: z.uuid(),
  kind: z.enum(["burn", "jackpot"]),
  mint: z.string().refine((value) => {
    try {
      return new PublicKey(value).toBase58() === value;
    } catch (error) {
      warnCause("executor_address_invalid", error);
      return false;
    }
  }),
  previousTradeTs: z.string().regex(/^\d+$/),
  amount: z.string().regex(/^\d+$/),
  minOut: z.string().regex(/^\d+$/),
  jupiterOut: z.string().regex(/^\d+$/),
});
const payloadSchema = z.object({
  intent: intentSchema,
  plan: serializedPlan,
  transaction: signedTxRecordSchema.optional(),
  finalized: z.boolean().optional(),
  claim: z.uuid().optional(),
});
export interface ExecutorJob {
  intent: ExecutorIntent;
  plan: TxInstructionPlan;
  transaction?: SignedTxRecord;
}
export interface ExecutorStore extends TxJournal {
  pending(kind: ExecutorKind): Promise<ExecutorJob | null>;
  latestCompleted(
    kind: ExecutorKind,
    identity: {
      cluster: ExecutorIntent["cluster"];
      programId: string;
      signer: PublicKey;
    },
  ): Promise<ExecutorJob | null>;
  create(
    intent: Omit<ExecutorIntent, "tradeId">,
    plan: TxInstructionPlan,
  ): Promise<ExecutorJob>;
  landed(job: ExecutorJob, delta: bigint, slippageBps: number): Promise<void>;
  /** Diagnostic only: never changes signed evidence, outcome or finality. */
  diagnostic(job: ExecutorJob, reason: string): Promise<void>;
  /** Atomically retire a stale plan only when no signed evidence exists. */
  closeUnsigned(job: ExecutorJob, reason: string): Promise<boolean>;
  outcome(
    job: ExecutorJob,
    result: {
      status: "confirmed" | "failed" | "skipped";
      finalized?: boolean;
      signature?: string;
      error?: string;
    },
  ): Promise<void>;
}
const encode = (plan: TxInstructionPlan) =>
  serializedPlan.parse({
    computeUnitLimit: plan.computeUnitLimit,
    instructions: plan.instructions.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((meta) => ({
        ...meta,
        pubkey: meta.pubkey.toBase58(),
      })),
      data: ix.data.toString("base64"),
    })),
    lookupTables: (plan.lookupTables ?? []).map((table) => ({
      key: table.key.toBase58(),
      ...table.state,
      deactivationSlot: table.state.deactivationSlot.toString(),
      authority: table.state.authority?.toBase58(),
      addresses: table.state.addresses.map((key) => key.toBase58()),
    })),
  });
function decode(raw: unknown): ExecutorJob {
  const value = payloadSchema.parse(raw);
  return {
    intent: value.intent,
    transaction: value.transaction,
    plan: {
      computeUnitLimit: value.plan.computeUnitLimit,
      instructions: value.plan.instructions.map(
        (ix) =>
          new TransactionInstruction({
            programId: new PublicKey(ix.programId),
            data: Buffer.from(ix.data, "base64"),
            keys: ix.keys.map((meta) => ({
              ...meta,
              pubkey: new PublicKey(meta.pubkey),
            })),
          }),
      ),
      lookupTables: value.plan.lookupTables.map(
        (table) =>
          new AddressLookupTableAccount({
            key: new PublicKey(table.key),
            state: {
              ...table,
              deactivationSlot: BigInt(table.deactivationSlot),
              authority: table.authority
                ? new PublicKey(table.authority)
                : undefined,
              addresses: table.addresses.map((key) => new PublicKey(key)),
            },
          }),
      ),
    },
  };
}
export class PostgresExecutorStore implements ExecutorStore {
  private readonly term = randomUUID();
  constructor(
    private readonly pool: Pick<ServiceRuntime["pool"], "query">,
    private readonly assertActive: () => void,
  ) {}
  async latestCompleted(
    kind: ExecutorKind,
    identity: {
      cluster: ExecutorIntent["cluster"];
      programId: string;
      signer: PublicKey;
    },
  ): Promise<ExecutorJob | null> {
    const pageSize = 32;
    for (let offset = 0; ; offset += pageSize) {
      this.assertActive();
      const result = await this.pool.query(
        `SELECT payload FROM executor_jobs
         WHERE kind=$1 AND status='confirmed' AND payload->>'finalized'='true'
           AND payload->'intent'->>'cluster'=$2 AND payload->'intent'->>'programId'=$3
         ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
        [kind, identity.cluster, identity.programId, pageSize, offset],
      );
      this.assertActive();
      for (const row of result.rows) {
        const job = decode(row.payload);
        if (!job.transaction) throw new Error("executor_history_unavailable");
        if (signedTxPayer(job.transaction).equals(identity.signer)) return job;
      }
      if (result.rows.length < pageSize) return null;
    }
  }
  async pending(kind: ExecutorKind): Promise<ExecutorJob | null> {
    this.assertActive();
    const result = await this.pool.query(
      "SELECT payload FROM executor_jobs WHERE kind=$1 AND COALESCE(payload->>'finalized','false') <> 'true' ORDER BY created_at,id LIMIT 1",
      [kind],
    );
    this.assertActive();
    if (!result.rows[0]) return null;
    const previous = payloadSchema.parse(result.rows[0].payload);
    const claimed = await this.pool.query(
      "UPDATE executor_jobs SET payload=payload || $2::jsonb WHERE id=$1 AND COALESCE(payload->>'claim','')=$3 RETURNING payload",
      [
        previous.intent.id,
        JSON.stringify({ claim: this.term }),
        previous.claim ?? "",
      ],
    );
    this.assertActive();
    if (!claimed.rows[0]) throw new Error("executor_claim_lost");
    return decode(claimed.rows[0].payload);
  }
  async create(
    value: Omit<ExecutorIntent, "tradeId">,
    plan: TxInstructionPlan,
  ): Promise<ExecutorJob> {
    this.assertActive();
    const intent = intentSchema.parse({ ...value, tradeId: randomUUID() });
    const payload = { intent, plan: encode(plan), claim: this.term };
    const result = await this.pool.query(
      `WITH job AS (
      INSERT INTO executor_jobs(id,kind,payload,status) VALUES($1,$2,$3::jsonb,'pending')
      ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING payload
    ), trade AS (
      INSERT INTO executor_trades(id,kind,amount,min_out,jupiter_out,status)
      SELECT (payload->'intent'->>'tradeId')::uuid,payload->'intent'->>'kind',
        (payload->'intent'->>'amount')::numeric,(payload->'intent'->>'minOut')::numeric,
        (payload->'intent'->>'jupiterOut')::numeric,'simulated' FROM job
      ON CONFLICT(id) DO NOTHING RETURNING id
    ) SELECT payload FROM job`,
      [intent.id, intent.kind, JSON.stringify(payload)],
    );
    this.assertActive();
    if (payloadSchema.parse(result.rows[0].payload).claim !== this.term)
      throw new Error("executor_claim_lost");
    const job = decode(result.rows[0].payload);
    return job;
  }
  async read(id: string): Promise<SignedTxRecord | null> {
    this.assertActive();
    const result = await this.pool.query(
      "SELECT payload FROM executor_jobs WHERE id=$1 AND payload->>'claim'=$2",
      [id, this.term],
    );
    this.assertActive();
    if (!result.rows[0]) throw new Error("executor_job_missing");
    return decode(result.rows[0].payload).transaction ?? null;
  }
  async write(
    id: string,
    record: SignedTxRecord,
    plan?: TxInstructionPlan,
  ): Promise<void> {
    this.assertActive();
    record = signedTxRecordSchema.parse(record);
    const patch = {
      transaction: record,
      ...(plan ? { plan: encode(plan) } : {}),
    };
    const result = await this.pool.query(
      "UPDATE executor_jobs SET payload=payload || $2::jsonb,status=$3,updated_at=now() WHERE id=$1 AND payload->>'claim'=$4 RETURNING payload",
      [
        id,
        JSON.stringify(patch),
        record.status === "signed" ? "sent" : record.status,
        this.term,
      ],
    );
    this.assertActive();
    if (!result.rows[0]) throw new Error("executor_job_missing");
    const { intent } = decode(result.rows[0].payload);
    await this.pool.query(
      "UPDATE executor_trades SET signature=$2,status=$3 WHERE id=$1",
      [
        intent.tradeId,
        record.signature,
        record.status === "signed" ? "sent" : record.status,
      ],
    );
    this.assertActive();
  }
  async reserveAttempt(
    id: string,
    maxAttempts: number,
  ): Promise<number | null> {
    this.assertActive();
    const result = await this.pool.query(
      "UPDATE executor_jobs SET attempts=attempts+1,updated_at=now() WHERE id=$1 AND attempts < $2 AND payload->>'claim'=$3 RETURNING attempts",
      [id, maxAttempts, this.term],
    );
    this.assertActive();
    if (!result.rows[0]) {
      await this.read(id);
      return null;
    }
    return z.number().int().positive().parse(result.rows[0].attempts);
  }
  async landed(
    job: ExecutorJob,
    delta: bigint,
    slippageBps: number,
  ): Promise<void> {
    this.assertActive();
    await this.read(job.intent.id);
    await this.pool.query(
      "UPDATE executor_trades SET delta=$2,slippage_bps=$3 WHERE id=$1",
      [job.intent.tradeId, delta.toString(), slippageBps],
    );
    this.assertActive();
  }
  async outcome(
    job: ExecutorJob,
    result: {
      status: "confirmed" | "failed" | "skipped";
      finalized?: boolean;
      signature?: string;
      error?: string;
    },
  ): Promise<void> {
    this.assertActive();
    const updated = await this.pool.query(
      "UPDATE executor_jobs SET status=$2,payload=payload || $3::jsonb,updated_at=now() WHERE id=$1 AND payload->>'claim'=$4 RETURNING id",
      [
        job.intent.id,
        result.status,
        JSON.stringify({ finalized: result.finalized === true }),
        this.term,
      ],
    );
    if (!updated.rows[0]) throw new Error("executor_claim_lost");
    this.assertActive();
    await this.pool.query(
      "UPDATE executor_trades SET status=$2,signature=COALESCE($3,signature),last_error=$4,confirmed_at=CASE WHEN $2='confirmed' THEN COALESCE(confirmed_at,now()) ELSE confirmed_at END WHERE id=$1",
      [
        job.intent.tradeId,
        result.status,
        result.signature ?? null,
        result.error ?? null,
      ],
    );
    this.assertActive();
  }
  async diagnostic(job: ExecutorJob, reason: string): Promise<void> {
    this.assertActive();
    const result = await this.pool.query(
      `UPDATE executor_trades t SET last_error=$2
       WHERE t.id=$1 AND EXISTS (
         SELECT 1 FROM executor_jobs j WHERE j.id=$3 AND j.payload->>'claim'=$4
         AND j.payload->'intent'->>'tradeId'=t.id::text
       ) RETURNING t.id`,
      [job.intent.tradeId, reason, job.intent.id, this.term],
    );
    this.assertActive();
    if (!result.rows[0]) throw new Error("executor_claim_lost");
  }
  async closeUnsigned(job: ExecutorJob, reason: string): Promise<boolean> {
    this.assertActive();
    const result = await this.pool.query(
      `WITH closed AS (
        UPDATE executor_jobs SET status='skipped',
          payload=payload || '{"finalized":true}'::jsonb,updated_at=now()
        WHERE id=$1 AND payload->>'claim'=$2 AND NOT (payload ? 'transaction')
        RETURNING payload
      ) UPDATE executor_trades SET status='skipped',last_error=$3
        WHERE id IN (SELECT (payload->'intent'->>'tradeId')::uuid FROM closed)
        RETURNING id`,
      [job.intent.id, this.term, reason],
    );
    this.assertActive();
    if (!result.rows.length) await this.read(job.intent.id);
    return result.rows.length === 1;
  }
}
