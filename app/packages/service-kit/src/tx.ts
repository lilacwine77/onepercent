import { warnCause } from "./safe-cause.js";
import { createHash, createPublicKey, verify } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ComputeBudgetProgram,
  ComputeBudgetInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { z } from "zod";
import bs58 from "bs58";
import { RpcError } from "./rpc.js";

const PACKET_BYTES = 1_232;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;
const BASIS_POINTS = 10_000;
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const signatureStatus = z
  .object({
    err: z.unknown().nullable(),
    confirmationStatus: z
      .enum(["processed", "confirmed", "finalized"])
      .nullable(),
  })
  .nullable();

export interface TxRpc {
  getLatestBlockhash(signal?: AbortSignal): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
  getRecentPrioritizationFees(
    writableAccounts: string[],
    signal?: AbortSignal,
  ): Promise<Array<{ prioritizationFee: number }>>;
  simulateTransaction(
    transaction: VersionedTransaction,
    signal?: AbortSignal,
  ): Promise<{ err: unknown; unitsConsumed?: number }>;
  sendRawTransaction(bytes: Uint8Array, signal?: AbortSignal): Promise<string>;
  getSignatureStatuses(
    signatures: string[],
    signal?: AbortSignal,
  ): Promise<Array<z.infer<typeof signatureStatus>>>;
  getBlockHeight(
    commitment: "finalized",
    signal?: AbortSignal,
  ): Promise<number>;
}

/** The caller supplies the shared timeout/circuit-breaker JSON-RPC client. */
export function createTxRpc(client: {
  request<T>(
    method: string,
    params: unknown[],
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}): TxRpc {
  return {
    async getLatestBlockhash(signal) {
      const result = await client.request(
        "getLatestBlockhash",
        [{ commitment: "confirmed" }],
        z.object({
          value: z.object({
            blockhash: z.string().min(1),
            lastValidBlockHeight: safeInteger,
          }),
        }),
        signal,
      );
      return result.value;
    },
    getRecentPrioritizationFees: (accounts, signal) =>
      client.request(
        "getRecentPrioritizationFees",
        [accounts],
        z.array(z.object({ prioritizationFee: safeInteger })),
        signal,
      ),
    async simulateTransaction(transaction, signal) {
      const result = await client.request(
        "simulateTransaction",
        [
          Buffer.from(transaction.serialize()).toString("base64"),
          { encoding: "base64", commitment: "confirmed", sigVerify: false },
        ],
        z.object({
          value: z.object({
            err: z.unknown().nullable(),
            unitsConsumed: safeInteger.optional(),
          }),
        }),
        signal,
      );
      return result.value;
    },
    sendRawTransaction: (bytes, signal) =>
      client.request(
        "sendTransaction",
        [
          Buffer.from(bytes).toString("base64"),
          {
            encoding: "base64",
            preflightCommitment: "confirmed",
            skipPreflight: false,
            maxRetries: 0,
          },
        ],
        z.string().min(1),
        signal,
      ),
    async getSignatureStatuses(signatures, signal) {
      const result = await client.request(
        "getSignatureStatuses",
        [signatures, { searchTransactionHistory: true }],
        z.object({ value: z.array(signatureStatus).length(signatures.length) }),
        signal,
      );
      return result.value;
    },
    getBlockHeight: (commitment, signal) =>
      client.request("getBlockHeight", [{ commitment }], safeInteger, signal),
  };
}

export const signedTxRecordSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().refine((value) => {
      try {
        return bs58.decode(value).length === 64;
      } catch (error) {
        warnCause("signature_invalid", error);
        return false;
      }
    }),
    transactionBase64: z
      .string()
      .min(1)
      .max(Math.ceil(PACKET_BYTES / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
    lastValidBlockHeight: safeInteger,
    status: z.enum(["signed", "confirmed", "failed"]),
    /** Only a finalized signature observation sets this; absent means unfinalized. */
    finalized: z.boolean().optional(),
    /** Proof that the first submission was explicitly rejected before acceptance. */
    failureProof: z.literal("preflight").optional(),
    /** Finalized expiry plus history and application-state reconciliation proved no landing. */
    expired: z.boolean().optional(),
  })
  .strict();
export type SignedTxRecord = z.infer<typeof signedTxRecordSchema>;

export interface TxInstructionPlan {
  instructions: readonly TransactionInstruction[];
  /** Explicit account-creation signer, public only. Default remains payer only. */
  additionalSigners?: readonly PublicKey[];
  lookupTables?: readonly AddressLookupTableAccount[];
  /** Measured instruction budget before the configured margin. */
  computeUnitLimit: number;
}

/**
 * S3 persists this record in the keyed job before any send. Keeping the signed
 * bytes allows the next leader to retry the same signature after a lost reply.
 * Writes must be durable and atomic. One active caller per job is required;
 * the keeper's dedicated leader session provides cross-process exclusion.
 * reserveAttempt atomically increments keeper_jobs.attempts only while it is
 * below maxAttempts; it returns the new durable total or null at the limit.
 * The counter belongs to the job, survives record replacement and restarts,
 * and is never reset by write. D23 reserves once per successfully simulated new
 * record, immediately before signing. Fresh reads, failed simulations, replaying
 * persisted bytes, status polling and reconciliation need no reservation.
 */
export interface TxJournal {
  read(job: string): Promise<SignedTxRecord | null>;
  /** A supplied plan must be saved atomically with its newly signed record. */
  write(
    job: string,
    record: SignedTxRecord,
    plan?: TxInstructionPlan,
  ): Promise<void>;
  reserveAttempt(job: string, maxAttempts: number): Promise<number | null>;
}

export interface TxSendRequest extends TxInstructionPlan {
  job: string;
  /** Inspect persisted signed evidence only; never build, sign or submit. */
  reconcileOnly?: boolean;
  /** Must read chain state at the requested commitment, with no cached verdict. */
  isComplete(commitment: "confirmed" | "finalized"): Promise<boolean>;
  /** Pure fresh reads/builds after safe replacement; null means no work is currently needed. */
  rebuild?(context: {
    reason: "failed" | "expired";
    previous: SignedTxRecord;
    signal?: AbortSignal;
  }): Promise<TxInstructionPlan | null>;
  signal?: AbortSignal;
}

export interface TxSenderOptions {
  rpc: TxRpc;
  signer: {
    publicKey: PublicKey;
    signTransaction(transaction: VersionedTransaction): void;
  };
  role: "keeper" | "executor";
  assertAuthorized(): void;
  /** Mandatory for the keeper; it must fail immediately after session loss. */
  assertLeader?: () => void;
  journal: TxJournal;
  sendMaxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  cuMarginBps: number;
  maxComputeUnitPriceMicroLamports: bigint | null;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export type TxSendResult =
  | { status: "confirmed"; signature: string; finalized?: boolean }
  | { status: "reconciled"; signature?: string; finalized?: boolean }
  | { status: "skipped"; signature?: string };

export class TxSenderError extends Error {
  constructor(
    readonly code:
      | "fee_cap_pending"
      | "invalid_request"
      | "invalid_record"
      | "job_conflict"
      | "simulation_failed"
      | "transaction_failed"
      | "signature_mismatch"
      | "transaction_pending",
    readonly signature?: string,
  ) {
    super(code);
    this.name = "TxSenderError";
  }
}

function decodeSignedRecord(value: unknown) {
  const record = signedTxRecordSchema.parse(value);
  const bytes = Buffer.from(record.transactionBase64, "base64");
  const transaction = VersionedTransaction.deserialize(bytes);
  const signature = transaction.signatures[0];
  const count = transaction.message.header.numRequiredSignatures;
  const signerKeys = transaction.message.staticAccountKeys.slice(0, count);
  if (
    bytes.length > PACKET_BYTES ||
    bytes.toString("base64") !== record.transactionBase64 ||
    !Buffer.from(transaction.serialize()).equals(bytes) ||
    transaction.version !== 0 ||
    count === 0 ||
    transaction.signatures.length !== count ||
    signerKeys.length !== count ||
    new Set(signerKeys.map((key) => key.toBase58())).size !== count ||
    !signature ||
    bs58.encode(signature) !== record.signature
  )
    throw new Error("signed_record_encoding_invalid");
  for (const [index, key] of signerKeys.entries()) {
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        key.toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    if (
      !verify(
        null,
        transaction.message.serialize(),
        publicKey,
        transaction.signatures[index]!,
      )
    )
      throw new Error("signed_record_signature_invalid");
  }
  return { record, signerKeys };
}

/** Derive historical ownership only from verified persisted transaction bytes. */
export function signedTxPayer(value: SignedTxRecord): PublicKey {
  try {
    return decodeSignedRecord(value).signerKeys[0]!;
  } catch (error) {
    warnCause("invalid_record", error);
    throw new TxSenderError("invalid_record");
  }
}

/** The nearest-rank 75th percentile, in micro-lamports per compute unit. */
export function priorityPrice(
  samples: readonly { prioritizationFee: number }[],
  cap: bigint,
): bigint {
  if (cap < 0n || cap > 18_446_744_073_709_551_615n) {
    throw new TxSenderError("invalid_request");
  }
  const prices = samples.map(({ prioritizationFee }) => {
    safeInteger.parse(prioritizationFee);
    return BigInt(prioritizationFee);
  });
  prices.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const percentile = prices[Math.ceil((prices.length * 3) / 4) - 1] ?? 0n;
  return percentile < cap ? percentile : cap;
}

function fingerprint(request: TxSendRequest, payer: PublicKey): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        payer: payer.toBase58(),
        computeUnitLimit: request.computeUnitLimit,
        instructions: request.instructions.map((instruction) => ({
          program: instruction.programId.toBase58(),
          keys: instruction.keys.map((key) => ({
            pubkey: key.pubkey.toBase58(),
            signer: key.isSigner,
            writable: key.isWritable,
          })),
          data: instruction.data.toString("base64"),
        })),
        ...(request.additionalSigners?.length
          ? {
              additionalSigners: request.additionalSigners.map((key) =>
                key.toBase58(),
              ),
            }
          : {}),
        tables:
          request.lookupTables?.map((table) => table.key.toBase58()) ?? [],
      }),
    )
    .digest("hex");
}

export class TxSender {
  private readonly active = new Map<
    string,
    {
      fingerprint: string;
      reconcileOnly: boolean;
      promise: Promise<TxSendResult>;
    }
  >();

  constructor(private readonly options: TxSenderOptions) {
    z.object({
      sendMaxAttempts: safeInteger.positive(),
      backoffBaseMs: safeInteger.positive(),
      backoffMaxMs: safeInteger.positive(),
      cuMarginBps: safeInteger,
    }).parse(options);
    if (
      options.backoffMaxMs < options.backoffBaseMs ||
      (options.role === "keeper" && !options.assertLeader)
    ) {
      throw new TxSenderError("invalid_request");
    }
    if (options.maxComputeUnitPriceMicroLamports !== null) {
      priorityPrice([], options.maxComputeUnitPriceMicroLamports);
    }
  }

  send(request: TxSendRequest): Promise<TxSendResult> {
    const id = fingerprint(request, this.options.signer.publicKey);
    const reconcileOnly = request.reconcileOnly === true;
    const running = this.active.get(request.job);
    if (running) {
      if (
        running.fingerprint !== id ||
        running.reconcileOnly !== reconcileOnly
      ) {
        return Promise.reject(new TxSenderError("job_conflict"));
      }
      return running.promise;
    }
    const promise = this.run(request, id).finally(() => {
      this.active.delete(request.job);
    });
    this.active.set(request.job, { fingerprint: id, reconcileOnly, promise });
    return promise;
  }

  private assertActive(signal?: AbortSignal): void {
    signal?.throwIfAborted();
    this.options.assertAuthorized();
    this.options.assertLeader?.();
  }

  private async build(
    request: TxSendRequest,
    id: string,
    cap: bigint,
    previousAttempt: number,
  ): Promise<{ record: SignedTxRecord; attempt: number } | null> {
    this.assertActive(request.signal);
    const allowed = this.allowedSigners(request);
    const writable = new Set([this.options.signer.publicKey.toBase58()]);
    for (const instruction of request.instructions) {
      if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
        throw new TxSenderError("invalid_request");
      }
      for (const key of instruction.keys) {
        if (key.isWritable) writable.add(key.pubkey.toBase58());
        if (key.isSigner && !allowed.has(key.pubkey.toBase58())) {
          throw new TxSenderError("invalid_request");
        }
      }
    }
    const latest = await this.options.rpc.getLatestBlockhash(request.signal);
    const price = priorityPrice(
      await this.options.rpc.getRecentPrioritizationFees(
        [...writable].sort(),
        request.signal,
      ),
      cap,
    );
    const withBudget = (units: number) => {
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: this.options.signer.publicKey,
          recentBlockhash: latest.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
            ...request.instructions,
          ],
        }).compileToV0Message([...(request.lookupTables ?? [])]),
      );
      if (
        transaction.message.header.numRequiredSignatures !== allowed.size ||
        transaction.serialize().length > PACKET_BYTES
      ) {
        throw new TxSenderError("invalid_request");
      }
      return transaction;
    };
    const units = Math.ceil(
      (request.computeUnitLimit * (BASIS_POINTS + this.options.cuMarginBps)) /
        BASIS_POINTS,
    );
    // Solana's compute-budget field is u32; protocol measurements set its value.
    if (!Number.isSafeInteger(units) || units > 0xffff_ffff) {
      throw new TxSenderError("invalid_request");
    }
    const transaction = withBudget(units);
    const simulation = await this.options.rpc.simulateTransaction(
      transaction,
      request.signal,
    );
    if (simulation.err !== null) {
      throw new TxSenderError("simulation_failed");
    }
    this.assertActive(request.signal);
    const attempt = await this.options.journal.reserveAttempt(
      request.job,
      this.options.sendMaxAttempts,
    );
    if (attempt === null) return null;
    if (
      !Number.isSafeInteger(attempt) ||
      attempt <= previousAttempt ||
      attempt > this.options.sendMaxAttempts
    ) {
      throw new TxSenderError("invalid_record");
    }
    this.assertActive(request.signal);
    this.options.signer.signTransaction(transaction);
    const signature = transaction.signatures[0];
    if (!signature || signature.every((value) => value === 0)) {
      throw new TxSenderError("invalid_request");
    }
    const record: SignedTxRecord = {
      fingerprint: id,
      signature: bs58.encode(signature),
      transactionBase64: Buffer.from(transaction.serialize()).toString(
        "base64",
      ),
      lastValidBlockHeight: latest.lastValidBlockHeight,
      status: "signed",
    };
    this.validateRecord(record, request);
    return { attempt, record };
  }

  private async status(record: SignedTxRecord, signal?: AbortSignal) {
    const statuses = await this.options.rpc.getSignatureStatuses(
      [record.signature],
      signal,
    );
    const status = statuses[0];
    if (status?.confirmationStatus === "finalized") {
      return {
        state:
          status.err == null ? ("confirmed" as const) : ("failed" as const),
        finalized: true,
        awaitFinality: false,
      };
    }
    if (status?.confirmationStatus === "confirmed") {
      return {
        state:
          status.err == null ? ("confirmed" as const) : ("pending" as const),
        finalized: false,
        // Confirmed errors may be reverted. Poll without spending send attempts.
        awaitFinality: status.err != null,
      };
    }
    return {
      state: "pending" as const,
      finalized: false,
      awaitFinality: false,
    };
  }

  private allowedSigners(request: TxInstructionPlan): Set<string> {
    const additional = request.additionalSigners ?? [];
    const allowed = new Set([
      this.options.signer.publicKey.toBase58(),
      ...additional.map((key) => key.toBase58()),
    ]);
    if (additional.length > 1 || allowed.size !== additional.length + 1)
      throw new TxSenderError("invalid_request");
    return allowed;
  }

  private validateRecord(
    value: unknown,
    request: TxInstructionPlan,
  ): SignedTxRecord {
    try {
      const allowed = this.allowedSigners(request);
      const { record, signerKeys } = decodeSignedRecord(value);
      if (
        signerKeys.length !== allowed.size ||
        !signerKeys[0]!.equals(this.options.signer.publicKey) ||
        signerKeys.some((key) => !allowed.has(key.toBase58()))
      )
        throw new Error();
      return record;
    } catch (error) {
      warnCause("invalid_record", error);
      throw new TxSenderError("invalid_record");
    }
  }

  /** Check current intent only before replay; an expired old plan may be replaced. */
  private assertMatches(
    record: SignedTxRecord,
    request: TxSendRequest,
    id: string,
    cap: bigint,
  ): void {
    if (record.fingerprint !== id) throw new TxSenderError("job_conflict");
    try {
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(record.transactionBase64, "base64"),
      );
      const message = TransactionMessage.decompile(transaction.message, {
        addressLookupTableAccounts: [...(request.lookupTables ?? [])],
      });
      const [limitInstruction, priceInstruction] = message.instructions;
      if (
        !limitInstruction ||
        !priceInstruction ||
        ComputeBudgetInstruction.decodeSetComputeUnitPrice(priceInstruction)
          .microLamports > cap ||
        ComputeBudgetInstruction.decodeSetComputeUnitLimit(limitInstruction)
          .units !==
          Math.ceil(
            (request.computeUnitLimit *
              (BASIS_POINTS + this.options.cuMarginBps)) /
              BASIS_POINTS,
          )
      )
        throw new Error();
      // Compilation promotes an account's privileges across all instructions.
      // Compare compiled messages, rather than per-instruction decompiled flags.
      const expected = new TransactionMessage({
        payerKey: this.options.signer.publicKey,
        recentBlockhash: message.recentBlockhash,
        instructions: [
          limitInstruction,
          priceInstruction,
          ...request.instructions,
        ],
      }).compileToV0Message([...(request.lookupTables ?? [])]);
      if (
        !Buffer.from(expected.serialize()).equals(
          Buffer.from(transaction.message.serialize()),
        )
      )
        throw new TxSenderError("job_conflict");
    } catch (error) {
      if (error instanceof TxSenderError) throw error;
      warnCause("invalid_record", error);
      throw new TxSenderError("invalid_record");
    }
  }

  private async writeStatus(
    request: TxSendRequest,
    record: SignedTxRecord,
    status: "signed" | "failed" | "confirmed",
    finalized?: boolean,
    failureProof?: "preflight",
  ) {
    const updated = {
      ...record,
      status,
      ...(finalized === undefined ? {} : { finalized }),
      ...(failureProof ? { failureProof } : {}),
    };
    if (status !== "failed") delete updated.failureProof;
    if (status === "confirmed") delete updated.expired;
    await this.options.journal.write(request.job, updated);
    return updated;
  }

  private async confirmed(
    request: TxSendRequest,
    record: SignedTxRecord,
    id: string,
    cap: bigint,
    finalized = false,
  ): Promise<TxSendResult> {
    if (record.fingerprint !== id) {
      if (await request.isComplete("confirmed"))
        return { status: "reconciled", signature: record.signature };
      throw new TxSenderError("job_conflict");
    }
    this.assertMatches(record, request, id, cap);
    if (record.status !== "confirmed" || (finalized && !record.finalized))
      await this.writeStatus(
        request,
        record,
        "confirmed",
        finalized || undefined,
      );
    return {
      status: "confirmed",
      signature: record.signature,
      ...(finalized ? { finalized: true } : {}),
    };
  }

  private async backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    const ceiling = Math.min(
      this.options.backoffMaxMs,
      this.options.backoffBaseMs * 2 ** Math.max(0, attempt - 1),
    );
    const random = (this.options.random ?? Math.random)();
    if (!Number.isFinite(random) || random < 0 || random >= 1)
      throw new TxSenderError("invalid_request");
    const wait = Math.floor(
      this.options.backoffBaseMs +
        random * (ceiling - this.options.backoffBaseMs),
    );
    await (
      this.options.sleep ??
      ((milliseconds, signal) => delay(milliseconds, undefined, { signal }))
    )(wait, signal);
  }

  private async run(request: TxSendRequest, id: string): Promise<TxSendResult> {
    this.assertActive(request.signal);
    if (
      !request.job.trim() ||
      !request.instructions.length ||
      !Number.isSafeInteger(request.computeUnitLimit) ||
      request.computeUnitLimit <= 0
    ) {
      throw new TxSenderError("invalid_request");
    }
    const cap = this.options.maxComputeUnitPriceMicroLamports;
    if (cap === null) throw new TxSenderError("fee_cap_pending");
    const stored = await this.options.journal.read(request.job);
    let record = stored === null ? null : this.validateRecord(stored, request);
    if (request.reconcileOnly) {
      if (!record) throw new TxSenderError("transaction_pending");
      this.assertMatches(record, request, id, cap);
    }
    let lastFailure: string | undefined;
    let alreadyProcessed = false;
    let previousAttempt = 0;
    let replacement:
      { reason: "failed" | "expired"; previous: SignedTxRecord } | undefined;
    // The extra pass permits reconciliation of the final send without another send.
    for (let pass = 0; pass <= this.options.sendMaxAttempts; pass += 1) {
      this.assertActive(request.signal);
      if (record) {
        let observation =
          record.status === "failed" &&
          (record.finalized || record.failureProof === "preflight")
            ? {
                state: "failed" as const,
                finalized: record.finalized === true,
                awaitFinality: false,
              }
            : record.status === "confirmed" && record.finalized
              ? {
                  state: "confirmed" as const,
                  finalized: true,
                  awaitFinality: false,
                }
              : await this.status(record, request.signal);
        if (observation.state === "confirmed")
          return this.confirmed(
            request,
            record,
            id,
            cap,
            observation.finalized,
          );
        if (
          (record.status === "confirmed" || record.status === "failed") &&
          observation.state === "pending"
        ) {
          // A fork can remove a prior confirmation. Keep the exact signature and
          // bytes ambiguous until history and finality permit replacing them.
          record = await this.writeStatus(request, record, "signed", false);
        }
        if (observation.awaitFinality) alreadyProcessed = true;
        if (observation.state === "pending") {
          const height = await this.options.rpc.getBlockHeight(
            "finalized",
            request.signal,
          );
          if (height > record.lastValidBlockHeight) {
            // Final history lookup closes the race with a just-landed transaction.
            observation = await this.status(record, request.signal);
            if (observation.state === "confirmed")
              return this.confirmed(
                request,
                record,
                id,
                cap,
                observation.finalized,
              );
            if (observation.state === "pending") {
              if (await request.isComplete("finalized"))
                return {
                  status: "reconciled",
                  signature: record.signature,
                  finalized: true,
                };
              if (!record.expired) {
                record = { ...record, expired: true };
                await this.options.journal.write(request.job, record);
              }
              replacement = { reason: "expired", previous: record };
              record = null;
              alreadyProcessed = false;
            }
          }
        }
        if (observation.state === "failed" && record) {
          if (
            record.status !== "failed" ||
            (observation.finalized && !record.finalized)
          )
            record = await this.writeStatus(
              request,
              record,
              "failed",
              observation.finalized || undefined,
            );
          lastFailure = record.signature;
          if (request.reconcileOnly)
            return { status: "skipped", signature: record.signature };
          if (await request.isComplete("confirmed"))
            return { status: "reconciled", signature: record.signature };
          if (await request.isComplete("finalized"))
            return {
              status: "reconciled",
              signature: record.signature,
              finalized: true,
            };
          replacement = { reason: "failed", previous: record };
          record = null;
          alreadyProcessed = false;
        }
        if (record) this.assertMatches(record, request, id, cap);
      }
      if (request.reconcileOnly && replacement)
        return { status: "skipped", signature: replacement.previous.signature };
      const complete = await request.isComplete("confirmed");
      if (!record && complete) return { status: "reconciled" };
      if (record && complete && (await request.isComplete("finalized")))
        return {
          status: "reconciled",
          signature: record.signature,
          finalized: true,
        };
      if (request.reconcileOnly)
        throw new TxSenderError("transaction_pending", record?.signature);
      if ((alreadyProcessed || complete) && record) {
        // An observed submission or completed action needs polling, not replay.
        // Keep its evidence until history or finalized reconciliation settles it.
        if (pass < this.options.sendMaxAttempts)
          await this.backoff(pass + 1, request.signal);
        continue;
      }
      if (pass === this.options.sendMaxAttempts) break;
      this.assertActive(request.signal);
      // Only a newly built record has no earlier submission that could still land.
      // Stored records and retries stay ambiguous even if this RPC rejects them.
      const firstSubmission = record === null;
      if (!record) {
        if (replacement && request.rebuild) {
          const plan = await request.rebuild({
            ...replacement,
            signal: request.signal,
          });
          this.assertActive(request.signal);
          if (plan === null)
            return {
              status: "skipped",
              signature: replacement.previous.signature,
            };
          if (
            !plan.instructions.length ||
            !Number.isSafeInteger(plan.computeUnitLimit) ||
            plan.computeUnitLimit <= 0
          )
            throw new TxSenderError("invalid_request");
          request = {
            ...request,
            instructions: plan.instructions,
            computeUnitLimit: plan.computeUnitLimit,
            lookupTables: plan.lookupTables,
            additionalSigners: plan.additionalSigners,
          };
          id = fingerprint(request, this.options.signer.publicKey);
        }
        replacement = undefined;
        const built = await this.build(request, id, cap, previousAttempt);
        if (!built) break;
        record = built.record;
        previousAttempt = built.attempt;
        // Failure here prevents sending even when the persistence outcome is unknown.
        await this.options.journal.write(request.job, record, {
          instructions: request.instructions,
          computeUnitLimit: request.computeUnitLimit,
          ...(request.additionalSigners?.length
            ? { additionalSigners: request.additionalSigners }
            : {}),
          ...(request.lookupTables
            ? { lookupTables: request.lookupTables }
            : {}),
        });
      }
      this.assertActive(request.signal);
      let submitted: string | undefined;
      try {
        submitted = await this.options.rpc.sendRawTransaction(
          Buffer.from(record.transactionBase64, "base64"),
          request.signal,
        );
      } catch (error) {
        warnCause("transaction_submission_failed", error);
        request.signal?.throwIfAborted();
        if (
          firstSubmission &&
          error instanceof RpcError &&
          error.kind === "preflight_rejected"
        ) {
          record = await this.writeStatus(
            request,
            record,
            "failed",
            false,
            "preflight",
          );
          lastFailure = record.signature;
        } else if (
          error instanceof RpcError &&
          error.kind === "already_processed"
        ) {
          alreadyProcessed = true;
        }
        // Transport failures and rejected resends preserve the signature and bytes.
      }
      if (submitted !== undefined && submitted !== record.signature)
        throw new TxSenderError("signature_mismatch", record.signature);
      if (record.status !== "failed") {
        const observation = await this.status(record, request.signal);
        if (observation.state === "confirmed")
          return this.confirmed(
            request,
            record,
            id,
            cap,
            observation.finalized,
          );
        if (observation.state === "failed") {
          record = await this.writeStatus(
            request,
            record,
            "failed",
            observation.finalized || undefined,
          );
          lastFailure = record.signature;
        }
        if (observation.awaitFinality) alreadyProcessed = true;
      }
      if (pass + 1 < this.options.sendMaxAttempts)
        await this.backoff(pass + 1, request.signal);
    }
    throw new TxSenderError(
      lastFailure && !record ? "transaction_failed" : "transaction_pending",
      record?.signature ?? lastFailure,
    );
  }
}

/** Exact upper bound for the additional fee; useful for operational telemetry. */
export function computePriorityFeeLamports(
  computeUnits: bigint,
  microLamports: bigint,
): bigint {
  if (computeUnits < 0n || microLamports < 0n) {
    throw new TxSenderError("invalid_request");
  }
  return (
    (computeUnits * microLamports + MICRO_LAMPORTS_PER_LAMPORT - 1n) /
    MICRO_LAMPORTS_PER_LAMPORT
  );
}
