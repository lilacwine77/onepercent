import { warnCause } from "@onepercent/service-kit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  serviceParams,
  signedTxRecordSchema,
  type SignedTxRecord,
  type TxJournal,
  type TxInstructionPlan,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { intentSchema, jobId, type KeeperIntent } from "./jobs.js";

const address = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("keeper_address_invalid", error);
    return false;
  }
});
const instructionPlanSchema = z
  .array(
    z
      .object({
        programId: address,
        keys: z.array(
          z
            .object({
              pubkey: address,
              isSigner: z.boolean(),
              isWritable: z.boolean(),
            })
            .strict(),
        ),
        dataBase64: z
          .string()
          .refine(
            (value) =>
              Buffer.from(value, "base64").toString("base64") === value,
          ),
      })
      .strict(),
  )
  .min(1);
export function encodeInstructionPlan(
  instructions: readonly TransactionInstruction[],
) {
  return instructionPlanSchema.parse(
    instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      keys: instruction.keys.map((meta) => ({
        pubkey: meta.pubkey.toBase58(),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
      })),
      dataBase64: instruction.data.toString("base64"),
    })),
  );
}
export function decodeInstructionPlan(
  value: unknown,
): TransactionInstruction[] {
  if (value === undefined) throw new Error("keeper_plan_missing");
  return instructionPlanSchema.parse(value).map(
    (instruction) =>
      new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.keys.map((meta) => ({
          ...meta,
          pubkey: new PublicKey(meta.pubkey),
        })),
        data: Buffer.from(instruction.dataBase64, "base64"),
      }),
  );
}

const payloadSchema = z
  .object({
    intent: intentSchema,
    transaction: signedTxRecordSchema.optional(),
    computeUnitLimit: z.number().int().positive().optional(),
    instructions: instructionPlanSchema.optional(),
    lookupTables: z.array(address).optional(),
    additionalSigners: z.array(address).max(1).optional(),
    claim: z.uuid().optional(),
    finalized: z.boolean().optional(),
    confirmationObserved: z.boolean().optional(),
  })
  .strict();
const jobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  payload: payloadSchema,
  status: z.enum(["pending", "sent", "confirmed", "failed", "skipped"]),
  attempts: z.number().int().nonnegative(),
  next_attempt_at: z.date(),
  last_error: z.string().nullable(),
  signature: z.string().nullable(),
});
export type KeeperJob = z.infer<typeof jobSchema>;
export interface KeeperStore extends TxJournal {
  ensure(intent: KeeperIntent, now: Date): Promise<KeeperJob>;
  due(now: Date): Promise<KeeperJob[]>;
  claim(id: string): Promise<KeeperJob>;
  budget(
    id: string,
    units: number,
    instructions: readonly TransactionInstruction[],
  ): Promise<void>;
  finish(
    id: string,
    status: KeeperJob["status"],
    reason: string | null,
    next: Date,
    finalized?: boolean,
  ): Promise<void>;
  skip(id: string, reason: string): Promise<boolean>;
}
function parseJob(value: unknown): KeeperJob {
  const job = jobSchema.parse(value);
  if (
    job.id !== jobId(job.payload.intent) ||
    job.kind !== job.payload.intent.kind
  )
    throw new Error("keeper_job_corrupt");
  return job;
}
/** Shared by the hot drain and fee discovery: terminal exhausted jobs retain
 * their history without blocking future intents; ambiguous signatures still do. */
export const keeperResumableSql = (
  maxAttempts: string,
) => `(status IN ('pending','sent','failed') OR (status='confirmed' AND COALESCE(payload->>'finalized','false') <> 'true'))
         AND (attempts < ${maxAttempts} OR (
           payload ? 'transaction'
           AND COALESCE(payload->'transaction'->>'expired','false') <> 'true'
           AND COALESCE(payload->'transaction'->>'finalized','false') <> 'true'
           AND NOT (COALESCE(payload->'transaction'->>'status','')='failed' AND (
             COALESCE(payload->'transaction'->>'finalized','false')='true'
             OR COALESCE(payload->'transaction'->>'failureProof','')='preflight'
           ))
         ))`;
/** Each leadership term owns a fresh store. Only keeper_jobs is written. */
export class PostgresKeeperStore implements KeeperStore {
  readonly term = randomUUID();
  constructor(
    private readonly pool: Pick<ServiceRuntime["pool"], "query">,
    private readonly options: {
      assertActive?: () => void;
      sendMaxAttempts?: number;
    } = {},
  ) {}
  private assertActive(): void {
    this.options.assertActive?.();
  }
  async ensure(intent: KeeperIntent, now: Date): Promise<KeeperJob> {
    this.assertActive();
    intent = intentSchema.parse(intent);
    const id = jobId(intent);
    await this.pool.query(
      "INSERT INTO keeper_jobs (id,kind,payload,status,attempts,next_attempt_at) VALUES ($1,$2,$3::jsonb,'pending',0,$4) ON CONFLICT (id) DO NOTHING",
      [id, intent.kind, JSON.stringify({ intent }), now],
    );
    this.assertActive();
    const job = await this.get(id);
    if (JSON.stringify(job.payload.intent) !== JSON.stringify(intent))
      throw new Error("keeper_job_conflict");
    return job;
  }
  private async get(id: string, owned = false): Promise<KeeperJob> {
    this.assertActive();
    const result = owned
      ? await this.pool.query(
          "SELECT * FROM keeper_jobs WHERE id=$1 AND payload->>'claim'=$2",
          [id, this.term],
        )
      : await this.pool.query("SELECT * FROM keeper_jobs WHERE id=$1", [id]);
    this.assertActive();
    if (!result.rows.length)
      throw new Error(owned ? "keeper_claim_lost" : "keeper_job_missing");
    return parseJob(result.rows[0]);
  }
  async due(now: Date): Promise<KeeperJob[]> {
    this.assertActive();
    const result = await this.pool.query(
      `SELECT * FROM keeper_jobs
       WHERE ${keeperResumableSql("$2")}
         AND next_attempt_at <= $1
       ORDER BY CASE WHEN status='confirmed' THEN 3 WHEN kind='settle' THEN 0 WHEN kind='refund' THEN 1 ELSE 2 END, next_attempt_at, id`,
      [
        now,
        this.options.sendMaxAttempts ?? serviceParams.keeper.sendMaxAttempts,
      ],
    );
    this.assertActive();
    return result.rows.map(parseJob);
  }
  /** CAS also fences an old claim statement delayed until after a new claim. */
  async claim(id: string): Promise<KeeperJob> {
    const previous = await this.get(id);
    this.assertActive();
    const result = await this.pool.query(
      "UPDATE keeper_jobs SET payload=jsonb_set(payload,'{claim}',to_jsonb($2::text)) WHERE id=$1 AND COALESCE(payload->>'claim','')=$3 RETURNING *",
      [id, this.term, previous.payload.claim ?? ""],
    );
    this.assertActive();
    if (result.rowCount !== 1) throw new Error("keeper_claim_conflict");
    return parseJob(result.rows[0]);
  }
  async read(id: string): Promise<SignedTxRecord | null> {
    return (await this.get(id, true)).payload.transaction ?? null;
  }
  async write(
    id: string,
    input: SignedTxRecord,
    plan?: TxInstructionPlan,
  ): Promise<void> {
    this.assertActive();
    const record = signedTxRecordSchema.parse(input);
    if (plan && record.status !== "signed")
      throw new Error("keeper_plan_invalid");
    const update = {
      ...(plan
        ? {
            computeUnitLimit: z
              .number()
              .int()
              .positive()
              .safe()
              .parse(plan.computeUnitLimit),
            instructions: encodeInstructionPlan(plan.instructions),
            additionalSigners: (plan.additionalSigners ?? []).map((key) =>
              key.toBase58(),
            ),
            lookupTables: (plan.lookupTables ?? []).map((table) =>
              table.key.toBase58(),
            ),
          }
        : {}),
      ...(record.status === "signed" ? { finalized: false } : {}),
    };
    const result = await this.pool.query(
      "UPDATE keeper_jobs SET payload=jsonb_set(payload || $6::jsonb,'{transaction}',$2::jsonb),signature=$3,status=$4 WHERE id=$1 AND payload->>'claim'=$5",
      [
        id,
        JSON.stringify(record),
        record.signature,
        record.status === "signed" ? "sent" : record.status,
        this.term,
        JSON.stringify(update),
      ],
    );
    this.assertActive();
    if (result.rowCount !== 1) throw new Error("keeper_claim_lost");
  }
  async reserveAttempt(id: string, max: number): Promise<number | null> {
    this.assertActive();
    z.number().int().positive().parse(max);
    const result = await this.pool.query(
      "UPDATE keeper_jobs SET attempts=attempts+1 WHERE id=$1 AND attempts < $2 AND payload->>'claim'=$3 RETURNING attempts",
      [id, max, this.term],
    );
    this.assertActive();
    if (result.rows.length)
      return z
        .object({ attempts: z.number().int().positive() })
        .parse(result.rows[0]).attempts;
    // A lost claim is not a normally exhausted attempt budget.
    await this.get(id, true);
    return null;
  }
  async budget(
    id: string,
    units: number,
    instructions: readonly TransactionInstruction[],
  ): Promise<void> {
    this.assertActive();
    z.number().int().positive().parse(units);
    const result = await this.pool.query(
      "UPDATE keeper_jobs SET payload=jsonb_set(jsonb_set(payload,'{computeUnitLimit}',to_jsonb($2::int)),'{instructions}',$4::jsonb) WHERE id=$1 AND payload->>'claim'=$3 AND NOT (payload ? 'transaction')",
      [
        id,
        units,
        this.term,
        JSON.stringify(encodeInstructionPlan(instructions)),
      ],
    );
    this.assertActive();
    if (result.rowCount !== 1) {
      await this.get(id, true);
      throw new Error("keeper_budget_conflict");
    }
  }
  async finish(
    id: string,
    status: KeeperJob["status"],
    reason: string | null,
    next: Date,
    finalized = false,
  ): Promise<void> {
    this.assertActive();
    const result = await this.pool.query(
      "UPDATE keeper_jobs SET status=$2,last_error=$3,next_attempt_at=$4,payload=payload || $6::jsonb WHERE id=$1 AND payload->>'claim'=$5",
      [
        id,
        status,
        reason,
        next,
        this.term,
        JSON.stringify({
          finalized,
          ...(status === "confirmed" ? { confirmationObserved: true } : {}),
        }),
      ],
    );
    this.assertActive();
    if (result.rowCount !== 1) throw new Error("keeper_claim_lost");
  }
  async skip(id: string, reason: string): Promise<boolean> {
    this.assertActive();
    // The previous-window query makes this notification once per mint/payer,
    // while retaining every skipped job as evidence for each observed pass.
    const result = await this.pool.query(
      `
      WITH previous AS (
        SELECT 1 FROM keeper_jobs earlier JOIN keeper_jobs target_job ON target_job.id=$1
        WHERE earlier.kind='close-vault' AND earlier.status='skipped' AND earlier.last_error=$2
          AND earlier.payload->'intent'->>'mint'=target_job.payload->'intent'->>'mint'
          AND earlier.payload->'intent'->>'payer'=target_job.payload->'intent'->>'payer'
        LIMIT 1
      ), updated AS (
        UPDATE keeper_jobs SET status='skipped',last_error=$2
        WHERE id=$1 AND payload->>'claim'=$3 AND status <> 'skipped'
          AND NOT (payload ? 'transaction') RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM updated) AS updated,
             NOT EXISTS (SELECT 1 FROM previous) AS notify`,
      [id, reason, this.term],
    );
    this.assertActive();
    const value = z
      .object({ updated: z.boolean(), notify: z.boolean() })
      .parse(result.rows[0]);
    if (!value.updated) await this.get(id, true);
    return value.updated && value.notify;
  }
}
export function chainDate(seconds: bigint): Date {
  const milliseconds = Number(seconds * 1000n);
  if (!Number.isSafeInteger(milliseconds)) throw new Error("chain_time_range");
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new Error("chain_time_range");
  return date;
}
