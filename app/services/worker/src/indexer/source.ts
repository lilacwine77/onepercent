import { warnCause } from "@onepercent/service-kit";
import {
  JsonRpcClient,
  isRpcNodeLag,
  RpcError,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { parseOnepercentLogs } from "@onepercent/sdk/events";
import { jsonObjectSchema, jsonValueSchema } from "@onepercent/db";
import { PublicKey, SolanaJSONRPCErrorCode } from "@solana/web3.js";
import { z } from "zod";
import type { IndexedTransaction } from "./store.js";
import type { IndexerSettings } from "./settings.js";
import { decodeConfig, singletonAddress } from "./accounts.js";
import type { IntakeSignerEvidence } from "./feed-proof.js";

export type RpcReader = Pick<JsonRpcClient, "request">;
const integer = z.number().int().nonnegative().safe();
const pubkey = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("indexer_address_invalid", error);
    return false;
  }
});
const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
const signatureRow = z.object({
  signature,
  slot: integer,
  err: jsonValueSchema.nullable(),
  blockTime: z.number().int().safe().nullable(),
  confirmationStatus: z
    .enum(["processed", "confirmed", "finalized"])
    .nullable()
    .optional(),
});
const instruction = z.object({
  programIdIndex: integer,
  accounts: z.array(integer),
  data: z
    .string()
    .max(2_048)
    .regex(/^[1-9A-HJ-NP-Za-km-z]*$/),
});
const transactionSchema = z
  .object({
    slot: integer,
    blockTime: z.number().int().safe().nullable(),
    transaction: z.object({
      signatures: z.array(signature).min(1),
      message: z.object({
        accountKeys: z.array(pubkey),
        instructions: z.array(instruction),
      }),
    }),
    meta: z
      .object({
        err: jsonValueSchema.nullable(),
        logMessages: z.array(z.string()).nullable(),
        loadedAddresses: z
          .object({ writable: z.array(pubkey), readonly: z.array(pubkey) })
          .optional(),
      })
      .nullable(),
  })
  .nullable();
const blockSchema = z.object({ signatures: z.array(signature) }).nullable();

export interface TxSource {
  confirmedSlot(signal?: AbortSignal): Promise<bigint>;
  finalizedSlot(signal?: AbortSignal): Promise<bigint>;
  transactions(
    cursor: string | null,
    throughSlot: bigint,
    signal?: AbortSignal,
  ): Promise<IndexedTransaction[]>;
  canonical(
    signature: string,
    slot: bigint,
    signal?: AbortSignal,
    txIndex?: bigint,
  ): Promise<boolean>;
  blockTime(slot: bigint, signal?: AbortSignal): Promise<number | null>;
}

/** Only standard JSON-RPC is used. A future transport can implement TxSource unchanged. */
export class SolanaTxSource implements TxSource {
  private readonly finalizedBlocks = new Map<bigint, string[]>();
  constructor(
    readonly rpc: RpcReader,
    readonly programId: string,
  ) {
    pubkey.parse(programId);
  }
  async confirmedSlot(signal?: AbortSignal) {
    return BigInt(
      await this.rpc.request(
        "getSlot",
        [{ commitment: "confirmed" }],
        integer,
        signal,
      ),
    );
  }
  async finalizedSlot(signal?: AbortSignal) {
    this.finalizedBlocks.clear();
    return BigInt(
      await this.rpc.request(
        "getSlot",
        [{ commitment: "finalized" }],
        integer,
        signal,
      ),
    );
  }
  async blockTime(slot: bigint, signal?: AbortSignal) {
    try {
      return await this.rpc.request(
        "getBlockTime",
        [safeSlot(slot)],
        z.number().int().safe().nullable(),
        signal,
      );
    } catch (error) {
      if (!isRpcNodeLag(error) || signal?.aborted) throw error;
      // The transport already retried and consulted the configured fallback.
      // Wait for the next poll instead of inventing this slot's chain time.
      return null;
    }
  }
  /** Standard RPC has no pre-instruction account history. Even an equal slot is incomplete. */
  async currentIntakeSigner(
    slot: bigint,
    signal?: AbortSignal,
  ): Promise<IntakeSignerEvidence> {
    const result = await this.rpc.request(
      "getAccountInfo",
      [
        singletonAddress(this.programId, "config"),
        {
          commitment: "confirmed",
          encoding: "base64",
          minContextSlot: safeSlot(slot),
        },
      ],
      z.object({
        context: z.object({ slot: integer }),
        value: z
          .object({
            owner: pubkey,
            executable: z.boolean(),
            data: z.tuple([z.string(), z.literal("base64")]),
          })
          .nullable(),
      }),
      signal,
    );
    if (
      !result.value ||
      result.value.executable ||
      result.value.owner !== this.programId ||
      BigInt(result.context.slot) < slot
    )
      throw new Error("feed_config_unavailable");
    const config = decodeConfig(Buffer.from(result.value.data[0], "base64"));
    return { address: config.intake_signer, source: "current" };
  }
  async canonical(
    sig: string,
    slot: bigint,
    signal?: AbortSignal,
    txIndex?: bigint,
  ) {
    const matches = (signatures: readonly string[]) =>
      txIndex === undefined
        ? signatures.includes(sig)
        : signatures[safeSlot(txIndex)] === sig;
    const cached = this.finalizedBlocks.get(slot);
    if (cached) return matches(cached);
    let block: z.infer<typeof blockSchema>;
    try {
      block = await this.rpc.request(
        "getBlock",
        [
          safeSlot(slot),
          {
            commitment: "finalized",
            transactionDetails: "signatures",
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ],
        blockSchema,
        signal,
      );
    } catch (error) {
      if (!isSkippedSlot(error)) throw error;
      warnCause("indexer_slot_skipped", error);
      // A skipped-slot error alone also covers a recent snapshot/storage gap.
      // Require an evaluated rooted range and retention covering this slot.
      const rooted = await this.rpc.request(
        "getBlocks",
        [
          safeSlot(slot),
          safeSlot(slot),
          {
            commitment: "finalized",
            minContextSlot: safeSlot(slot),
          },
        ],
        z.array(integer).max(1),
        signal,
      );
      const firstAvailable = await this.rpc.request(
        "getFirstAvailableBlock",
        [],
        integer,
        signal,
      );
      if (rooted.length !== 0 || BigInt(firstAvailable) > slot) throw error;
      this.finalizedBlocks.set(slot, []);
      return false;
    }
    // Null/pruned/unavailable is not evidence of a fork. Retry without deleting anything.
    if (!block) throw new Error("finalized_block_unavailable");
    this.finalizedBlocks.set(slot, block.signatures);
    return matches(block.signatures);
  }
  async transactions(
    cursor: string | null,
    throughSlot: bigint,
    signal?: AbortSignal,
  ) {
    const rows = new Map<string, z.infer<typeof signatureRow>>();
    let before: string | undefined;
    const pageEnds = new Set<string>();
    for (;;) {
      const page = await this.rpc.request(
        "getSignaturesForAddress",
        [
          this.programId,
          {
            commitment: "confirmed",
            minContextSlot: safeSlot(throughSlot),
            limit: 1000,
            ...(cursor ? { until: cursor } : {}),
            ...(before ? { before } : {}),
          },
        ],
        z.array(signatureRow).max(1000),
        signal,
      );
      for (const row of page) {
        if (row.signature === cursor) break;
        if (row.confirmationStatus === "processed")
          throw new Error("unconfirmed_signature");
        if (BigInt(row.slot) <= throughSlot) rows.set(row.signature, row);
      }
      if (page.length < 1000 || page.some((row) => row.signature === cursor))
        break;
      before = page.at(-1)!.signature;
      if (pageEnds.has(before)) throw new Error("signature_page_stalled");
      pageEnds.add(before);
    }
    const blocks = new Map<number, string[]>();
    const result: IndexedTransaction[] = [];
    for (const row of rows.values()) {
      let signatures = blocks.get(row.slot);
      if (!signatures) {
        const block = await this.rpc.request(
          "getBlock",
          [
            row.slot,
            {
              commitment: "confirmed",
              transactionDetails: "signatures",
              rewards: false,
              maxSupportedTransactionVersion: 0,
            },
          ],
          blockSchema,
          signal,
        );
        if (!block) throw new Error("confirmed_block_unavailable");
        signatures = block.signatures;
        blocks.set(row.slot, signatures);
      }
      const txIndex = signatures.indexOf(row.signature);
      if (txIndex < 0) throw new Error("signature_block_mismatch");
      const raw = await this.rpc.request(
        "getTransaction",
        [
          row.signature,
          {
            commitment: "confirmed",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          },
        ],
        transactionSchema,
        signal,
      );
      if (!raw?.meta) throw new Error("confirmed_transaction_unavailable");
      if (
        raw.slot !== row.slot ||
        raw.transaction.signatures[0] !== row.signature
      )
        throw new Error("transaction_identity_mismatch");
      const keys = [
        ...raw.transaction.message.accountKeys,
        ...(raw.meta.loadedAddresses?.writable ?? []),
        ...(raw.meta.loadedAddresses?.readonly ?? []),
      ];
      const instructions = raw.transaction.message.instructions.map((ix) => {
        const programId = keys[ix.programIdIndex];
        if (!programId || ix.accounts.some((index) => !keys[index]))
          throw new Error("instruction_account_index");
        return {
          programId,
          data: ix.data,
          accounts: ix.accounts.map((index) => keys[index]!),
        };
      });
      const parsed = parseOnepercentLogs({
        logs: raw.meta.logMessages ?? [],
        err: raw.meta.err,
        programId: this.programId,
        topLevelProgramIds: instructions.map((ix) => ix.programId),
      });
      result.push({
        signature: row.signature,
        slot: BigInt(raw.slot),
        txIndex: BigInt(txIndex),
        blockTime: raw.blockTime,
        err: raw.meta.err,
        truncated:
          parsed.truncated ||
          parsed.unknownEvent ||
          parsed.malformed ||
          !raw.meta.logMessages?.length,
        accountKeys: keys,
        instructions,
        events: parsed.events.map((event) => ({
          name: event.name,
          data: jsonObjectSchema.parse(
            JSON.parse(
              JSON.stringify(event.data, (_, value: unknown) =>
                typeof value === "bigint" ? value.toString() : value,
              ),
            ),
          ),
          ixIndex: BigInt(event.ixIndex),
          eventIndex: BigInt(event.eventIndex),
        })),
      });
    }
    return result.sort((a, b) =>
      a.slot < b.slot
        ? -1
        : a.slot > b.slot
          ? 1
          : a.txIndex < b.txIndex
            ? -1
            : a.txIndex > b.txIndex
              ? 1
              : 0,
    );
  }
}
function safeSlot(slot: bigint) {
  return integer.parse(Number(slot));
}

function isSkippedSlot(error: unknown): error is RpcError {
  return (
    error instanceof RpcError &&
    (error.code === SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_SLOT_SKIPPED ||
      error.code ===
        SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_LONG_TERM_STORAGE_SLOT_SKIPPED)
  );
}

/** The recovery clock starts at the first successful primary probe, not at failover. */
export class FailoverRpc implements RpcReader {
  private readonly failures = new Map<string, number>();
  private readonly recoveryProbes = new Map<
    string,
    (signal?: AbortSignal) => Promise<unknown>
  >();
  private fallback = false;
  private healthySince: number | undefined;
  constructor(
    private readonly options: {
      primary: RpcReader;
      secondary?: RpcReader;
      settings: IndexerSettings["indexer"];
      alert: ServiceRuntime["alerts"]["alert"];
      now?: () => number;
    },
  ) {}
  get usingFallback() {
    return this.fallback;
  }
  async request<T>(
    method: string,
    params: unknown[],
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const usingFallback = this.fallback;
    const primaryProbe = (probeSignal?: AbortSignal) =>
      this.options.primary.request(method, params, schema, probeSignal);
    // Probe current requests, not an expired signature captured at failover time.
    if (usingFallback && this.recoveryProbes.has(method))
      this.recoveryProbes.set(method, primaryProbe);
    try {
      const value = await (
        usingFallback ? this.options.secondary! : this.options.primary
      ).request(method, params, schema, signal);
      if (!usingFallback) {
        this.failures.delete(method);
        this.recoveryProbes.delete(method);
      }
      return value;
    } catch (error) {
      if (!signal?.aborted && !usingFallback && this.options.secondary) {
        const failures = (this.failures.get(method) ?? 0) + 1;
        this.failures.set(method, failures);
        this.recoveryProbes.set(method, primaryProbe);
        const nodeLag = isRpcNodeLag(error);
        if (
          nodeLag ||
          failures >= this.options.settings.fallbackAfterFailures
        ) {
          this.healthySince = undefined;
          if (!this.fallback) {
            this.fallback = true;
            await this.options.alert("indexer_rpc_fallback", "warning", {
              reason: nodeLag ? "primary_node_lag" : "primary_unavailable",
            });
          }
          // Node-lag errors arrive only after the primary's bounded retries.
          // Try the identical read on the fallback within this poll.
          if (nodeLag)
            return this.options.secondary.request(
              method,
              params,
              schema,
              signal,
            );
        }
      }
      throw error;
    }
  }
  async probe(signal?: AbortSignal): Promise<void> {
    if (!this.fallback) return;
    const now = (this.options.now ?? Date.now)();
    try {
      await this.options.primary.request(
        "getSlot",
        [{ commitment: "confirmed" }],
        integer,
        signal,
      );
      for (const probe of this.recoveryProbes.values()) {
        await probe(signal);
      }
      this.healthySince ??= now;
      if (
        now - this.healthySince >=
        this.options.settings.fallbackRecoverSeconds * 1000
      ) {
        this.fallback = false;
        this.failures.clear();
        this.recoveryProbes.clear();
        this.healthySince = undefined;
        await this.options.alert("indexer_rpc_recovered", "info", {
          reason: "primary_healthy",
        });
      }
    } catch (error) {
      warnCause("indexer_rpc_probe_failed", error);
      this.healthySince = undefined;
    }
  }
}

export function createIndexerRpc(
  runtime: ServiceRuntime,
  fallbackUrl: string | undefined,
  settings: IndexerSettings,
) {
  return new FailoverRpc({
    primary: runtime.rpc,
    secondary: fallbackUrl
      ? new JsonRpcClient({
          url: fallbackUrl,
          timeoutMs: settings.transport.rpcTimeoutMs,
          failureThreshold: settings.transport.breakerFailureThreshold,
          recoverMs: settings.transport.breakerOpenSeconds * 1000,
          nodeLagRetry: {
            maxAttempts: settings.transport.rpcNodeLagMaxAttempts,
            backoffBaseMs: settings.transport.rpcNodeLagBackoffBaseMs,
            backoffMaxMs: settings.transport.rpcNodeLagBackoffMaxMs,
          },
        })
      : undefined,
    settings: settings.indexer,
    alert: runtime.alerts.alert.bind(runtime.alerts),
  });
}
