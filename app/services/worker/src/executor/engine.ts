import { isRpcNodeLag, safeCause } from "@onepercent/service-kit";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BPS_DENOMINATOR } from "@onepercent/config";
import type { ExecEnded, ClusterDeployment } from "@onepercent/sdk";
import type { AddressLookupTableAccount, PublicKey } from "@solana/web3.js";
import type { TxSender, TxInstructionPlan } from "@onepercent/service-kit";
import { TxSenderError } from "@onepercent/service-kit";
import {
  planExecutor,
  executorDelay,
  type ExecutorPolicy,
  type ExecutorKind,
  type ExecutorSnapshot,
  type ExecutorReference,
} from "./policy.js";
import { checkPlan, composeExecutor, type ExecutorSwap } from "./compose.js";
import type { P1ExecutorPort } from "./p1.js";
import type { ExecutorStore, ExecutorJob } from "./store.js";

export interface ExecutorDependencies {
  deployment: ClusterDeployment;
  policy: ExecutorPolicy;
  signer: PublicKey;
  p1: P1ExecutorPort;
  protocolLut: AddressLookupTableAccount;
  tipLamports: bigint | null;
  snapshot(
    commitment: "confirmed" | "finalized",
    signal?: AbortSignal,
  ): Promise<ExecutorSnapshot>;
  reference(
    snapshot: ExecutorSnapshot,
    signal?: AbortSignal,
  ): Promise<{ snapshot: ExecutorSnapshot; reference: ExecutorReference }>;
  swap(
    plan: import("./policy.js").ExecutorPlan,
    minOut: bigint,
    expected: bigint | undefined,
    signal?: AbortSignal,
  ): Promise<ExecutorSwap>;
  blockhash(signal?: AbortSignal): Promise<string>;
  measure(plan: TxInstructionPlan, signal?: AbortSignal): Promise<number>;
  sender: Pick<TxSender, "send">;
  store: ExecutorStore;
  residue(signal?: AbortSignal): Promise<bigint>;
  receipt(
    signature: string,
    signal?: AbortSignal,
  ): Promise<ExecEnded & { sourceResidue: bigint }>;
  slippage(kind: ExecutorKind, value: number): void;
  assertActive(): void;
  alert(
    name: "executor_residue" | "executor_failures",
    payload: Record<string, string | number>,
  ): Promise<void>;
  result(kind: ExecutorKind, result: string): void;
  log(record: {
    kind: ExecutorKind;
    reason: string;
    cause?: ReturnType<typeof safeCause>;
  }): void;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Notify the supervisor before waiting for a possibly stalled sibling. */
  onFailure?: (error: unknown) => void;
}
export class Executor {
  private pending = Promise.resolve();
  private failures = 0;
  private readonly checkedHistory = new Set<string>();
  constructor(private readonly options: ExecutorDependencies) {}
  /** Both timers share one signer and source ATA; never interleave their pairs. */
  tick(kind: ExecutorKind, signal: AbortSignal): Promise<void> {
    const work = this.pending.then(() => this.run(kind, signal));
    this.pending = work.catch(() => undefined);
    return work;
  }
  private active(signal: AbortSignal): void {
    signal.throwIfAborted();
    this.options.assertActive();
  }
  private async alert(
    kind: ExecutorKind,
    name: Parameters<ExecutorDependencies["alert"]>[0],
    payload: Record<string, string | number>,
  ): Promise<void> {
    try {
      await this.options.alert(name, payload);
    } catch (error) {
      this.options.log({
        kind,
        reason: "executor_alert_unavailable",
        cause: safeCause(error),
      });
    }
  }
  private async checkedReceipt(
    job: ExecutorJob,
    signature: string,
    signal: AbortSignal,
  ) {
    const receipt = await this.options.receipt(signature, signal);
    this.active(signal);
    if (
      receipt.kind !== (job.intent.kind === "burn" ? 3 : 4) ||
      receipt.bucket !== 255 ||
      receipt.mint !== job.intent.mint ||
      receipt.ts <= BigInt(job.intent.previousTradeTs) ||
      receipt.amount !== BigInt(job.intent.amount) ||
      receipt.min_out !== BigInt(job.intent.minOut) ||
      receipt.delta < receipt.min_out
    )
      throw new Error("executor_receipt_binding");
    // Inspect the transaction's post-state, never a later donated live balance.
    if (receipt.sourceResidue !== 0n) {
      await this.alert(job.intent.kind, "executor_residue", {
        kind: job.intent.kind,
        amount: receipt.sourceResidue.toString(),
      });
      throw new Error("executor_residue");
    }
    return receipt;
  }
  private async checkCompleted(signal: AbortSignal): Promise<void> {
    for (const kind of ["burn", "jackpot"] as const) {
      const job = await this.options.store.latestCompleted(kind, {
        cluster: this.options.deployment.cluster,
        programId: this.options.deployment.programId.toBase58(),
        signer: this.options.signer,
      });
      this.active(signal);
      if (!job) continue;
      if (
        job.intent.cluster !== this.options.deployment.cluster ||
        job.intent.programId !== this.options.deployment.programId.toBase58() ||
        job.intent.kind !== kind ||
        !job.transaction
      )
        throw new Error("executor_history_unavailable");
      const signature = job.transaction.signature;
      const binding = JSON.stringify([signature, job.intent]);
      if (this.checkedHistory.has(binding)) continue;
      await this.checkedReceipt(job, signature, signal);
      this.checkedHistory.add(binding);
    }
  }
  private async run(kind: ExecutorKind, signal: AbortSignal): Promise<void> {
    this.active(signal);
    let job: ExecutorJob | null = null;
    try {
      const own = await this.options.store.pending(kind);
      this.active(signal);
      // Both kinds share one source ATA. Legacy journals may contain both an
      // unsigned plan and another signed intent, or two signed intents.
      const other = await this.options.store.pending(
        kind === "burn" ? "jackpot" : "burn",
      );
      this.active(signal);
      const rank = (candidate: ExecutorJob | null) =>
        candidate?.transaction
          ? candidate.transaction.status === "confirmed"
            ? 2
            : 1
          : 0;
      job = rank(other) > rank(own) ? other : (own ?? other);
      const reconcileOnly = !!(own?.transaction && other?.transaction);
      if (job) kind = job.intent.kind;
      if (
        job &&
        (job.intent.cluster !== this.options.deployment.cluster ||
          job.intent.programId !== this.options.deployment.programId.toBase58())
      )
        throw new Error("executor_journal_deployment_mismatch");
      // Older releases finalized before checking residue. Recheck each kind's
      // last completed receipt before any new signature or source reset, even
      // when the live balance is zero (an outside credit may arrive later).
      if (!job?.transaction) await this.checkCompleted(signal);
      if (!job) {
        const initialResidue = await this.options.residue(signal);
        this.active(signal);
        if (initialResidue !== 0n)
          this.options.log({
            kind,
            reason: "executor_external_credit",
          });
        const initial = await this.options.snapshot("confirmed", signal);
        if (!initial.config.executor.equals(this.options.signer))
          throw new Error("executor_role_mismatch");
        const { snapshot, reference } = await this.options.reference(
          initial,
          signal,
        );
        if (!snapshot.config.executor.equals(this.options.signer))
          throw new Error("executor_role_mismatch");
        const decision = planExecutor(
          kind,
          snapshot,
          reference,
          this.options.policy,
        );
        if (!decision.ok) {
          this.options.result(kind, "skipped");
          this.options.log({ kind, reason: decision.reason });
          return;
        }
        const checked = checkPlan(
          this.options.p1,
          decision.plan,
          this.options.signer,
        );
        const swap = await this.options.swap(
          decision.plan,
          checked.minOut,
          checked.expected,
          signal,
        );
        this.active(signal);
        const composed = composeExecutor({
          plan: decision.plan,
          p1: this.options.p1,
          signer: this.options.signer,
          swap,
          protocolLut: this.options.protocolLut,
          blockhash: await this.options.blockhash(signal),
          tipLamports: this.options.tipLamports,
          computeUnitLimit: 1,
        });
        composed.computeUnitLimit = await this.options.measure(
          composed,
          signal,
        );
        this.active(signal);
        job = await this.options.store.create(
          {
            cluster: this.options.deployment.cluster,
            programId: this.options.deployment.programId.toBase58(),
            id: `executor:${this.options.deployment.cluster}:${this.options.deployment.programId.toBase58()}:${kind}:${snapshot.config.token_mint.toBase58()}:${decision.plan.previousTradeTs}:${randomUUID()}`,
            kind,
            mint: snapshot.config.token_mint.toBase58(),
            amount: decision.plan.amount.toString(),
            minOut: checked.minOut.toString(),
            jupiterOut: swap.outAmount.toString(),
            previousTradeTs: decision.plan.previousTradeTs.toString(),
          },
          composed,
        );
      }
      const current = job;
      const result = await this.options.sender.send({
        ...current.plan,
        job: current.intent.id,
        signal,
        reconcileOnly,
        isComplete: async (commitment) => {
          const state = await this.options.snapshot(commitment, signal);
          this.active(signal);
          const last =
            kind === "burn"
              ? state.machine.last_burn_ts
              : state.machine.last_jackpot_buy_ts;
          return last > BigInt(current.intent.previousTradeTs);
        },
        // Expiry or a proven failure may change routing. Stop this intent and
        // let the next tick plan from fresh state, never replay a stale quote.
        rebuild: async () => null,
      });
      this.active(signal);
      if (
        result.status === "skipped" ||
        (result.status === "reconciled" && !result.signature)
      ) {
        await this.options.store.outcome(current, {
          status: "skipped",
          signature: result.signature,
          finalized: true,
        });
        this.options.result(kind, "skipped");
        return;
      }
      if (result.signature) {
        const receipt = await this.checkedReceipt(
          current,
          result.signature,
          signal,
        );
        const quoted = BigInt(current.intent.jupiterOut);
        const slippage =
          quoted > 0n
            ? Number(
                ((quoted - receipt.delta) * BigInt(BPS_DENOMINATOR)) / quoted,
              )
            : 0;
        if (!Number.isSafeInteger(slippage))
          throw new Error("executor_slippage_invalid");
        await this.options.store.landed(current, receipt.delta, slippage);
        this.options.slippage(kind, slippage);
      }
      await this.options.store.outcome(current, {
        status: "confirmed",
        signature: result.signature,
        finalized: result.finalized,
      });
      this.failures = 0;
      if (current.transaction?.status !== "confirmed")
        this.options.result(kind, "confirmed");
    } catch (error) {
      if (signal.aborted) return;
      if (isRpcNodeLag(error)) {
        // A lagging read proves no transaction outcome. Keep any durable intent
        // intact so the next tick reconciles it from fresh chain evidence.
        this.options.log({
          kind,
          reason: "executor_rpc_node_lag",
          cause: safeCause(error),
        });
        return;
      }
      if (
        !job &&
        error instanceof Error &&
        (error.message.startsWith("executor_refused:") ||
          error.message === "executor_quote_below_min_out")
      ) {
        this.options.result(kind, "skipped");
        this.options.log({
          kind,
          reason: error.message,
          cause: safeCause(error),
        });
        return;
      }
      // An ambiguous signed record remains pending until TxSender reconciles it.
      const reason =
        error instanceof Error && /^[a-zA-Z0-9_:]{1,128}$/.test(error.message)
          ? error.message
          : "executor_failed";
      if (job) {
        try {
          if (
            error instanceof TxSenderError &&
            error.code === "simulation_failed"
          ) {
            this.active(signal);
            await this.options.store.closeUnsigned(job, reason);
          }
          await this.options.store.diagnostic(job, reason);
        } catch (error) {
          if (signal.aborted) return;
          this.options.log({
            kind,
            reason: "executor_diagnostic_unavailable",
            cause: safeCause(error),
          });
        }
      }
      this.failures += 1;
      this.options.result(kind, "failed");
      this.options.log({ kind, reason, cause: safeCause(error) });
      if (this.failures >= 5)
        await this.alert(kind, "executor_failures", {
          failures: this.failures,
        });
    }
  }
  async onLeader(signal: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const term = AbortSignal.any([signal, controller.signal]);
    const sleep =
      this.options.sleep ??
      ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
    const loop = async (kind: ExecutorKind) => {
      while (!term.aborted) {
        try {
          await sleep(
            executorDelay(kind, this.options.policy, this.options.random),
            term,
          );
        } catch (error) {
          if (term.aborted) return;
          this.options.log({
            kind,
            reason: "executor_timer_failed",
            cause: safeCause(error),
          });
          // eslint-disable-next-line preserve-caught-error -- Original cause is logged; preserve the public error contract.
          throw new Error("executor_timer_failed");
        }
        if (!term.aborted) await this.tick(kind, term);
      }
    };
    const loops = [loop("burn"), loop("jackpot")];
    try {
      await Promise.all(loops);
    } catch (error) {
      controller.abort();
      if (!signal.aborted) this.options.onFailure?.(error);
      throw error;
    } finally {
      controller.abort();
      await Promise.allSettled(loops);
    }
  }
}
