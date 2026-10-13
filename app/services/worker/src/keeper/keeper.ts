import { isRpcNodeLag, RpcNodeLag, safeCause } from "@onepercent/service-kit";
import {
  PublicKey,
  type TransactionInstruction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  TxSenderError,
  type TxSendRequest,
  type TxSendResult,
} from "@onepercent/service-kit";
import type { KeeperChain, KeeperSnapshot } from "./adapter.js";
import {
  finalPullDue,
  nextPhase,
  settleIntents,
  type KeeperIntent,
} from "./jobs.js";
import type { KeeperParams } from "./params.js";
import {
  chainDate,
  decodeInstructionPlan,
  type KeeperJob,
  type KeeperStore,
} from "./store.js";

import type { KeeperFees } from "./fees/index.js";

export interface KeeperHooks {
  alert(
    key: string,
    reason: string,
    payload: Record<string, string | number>,
  ): Promise<void>;
  result(kind: string, status: string): void;
  latency(seconds: number): void;
  log(record: {
    job?: string;
    kind?: string;
    reason: string;
    sig?: string;
    cause?: ReturnType<typeof safeCause>;
  }): void;
}
export interface KeeperOptions {
  chain: Pick<
    KeeperChain,
    | "chainNow"
    | "snapshot"
    | "scanPulls"
    | "pull"
    | "pullCompletion"
    | "zeroLedgers"
    | "ledger"
    | "closeVaultState"
    | "settle"
    | "refund"
    | "advance"
    | "startFinalPull"
    | "finalSolClaims"
    | "finalClaim"
    | "claimFinalSol"
    | "closeVault"
    | "teamWithdraw"
  >;
  params: KeeperParams;
  store: KeeperStore;
  sender: { send(request: TxSendRequest): Promise<TxSendResult> };
  assertLeader(): void;
  /** A new reveal can defer housekeeping until the next exit-discovery pass. */
  shouldYield?(): boolean;
  measure(
    instructions: readonly TransactionInstruction[],
    signal: AbortSignal,
    lookupTables?: readonly AddressLookupTableAccount[],
  ): Promise<number>;
  hooks: KeeperHooks;
  fees?: KeeperFees;
  lookupTables?(
    signal: AbortSignal,
  ): Promise<readonly AddressLookupTableAccount[]>;
}
/** One serial crank queue per leadership term; K1 runs as a separate onLeader task. */
export class Keeper {
  private lastClose: bigint | undefined;
  private lastTeam: bigint | undefined;
  private phase: number | undefined;
  private busy = false;
  constructor(private readonly options: KeeperOptions) {}
  private active(signal: AbortSignal) {
    signal.throwIfAborted();
    this.options.assertLeader();
  }
  async scan(signal: AbortSignal): Promise<void> {
    if (this.busy) throw new Error("keeper_scan_overlap");
    this.busy = true;
    try {
      this.active(signal);
      const { chain, store, params } = this.options;
      const now = await chain.chainNow();
      this.active(signal);
      const date = chainDate(now);
      // Exit discovery is independent from Config, pause bits, and monitoring.
      for (const status of [2, 1] as const) {
        try {
          const pulls = await chain.scanPulls(status, signal);
          for (const pull of pulls) {
            this.active(signal);
            if (status === 2) {
              for (const intent of settleIntents(
                pull,
                params.TX_LIMITS.settlePacksPerTx,
              ))
                await store.ensure(intent, date);
              if (
                now - pull.revealedTs >
                BigInt(params.SERVICES.keeper.settleBacklogAlertSeconds)
              )
                await this.alert(
                  `settle_backlog:${pull.seq}`,
                  "settle_backlog",
                  { seq: pull.seq.toString() },
                );
            } else if (
              now >=
              pull.createdTs + BigInt(params.VRF.timeoutSeconds)
            ) {
              await store.ensure(
                {
                  kind: "refund",
                  address: pull.address.toBase58(),
                  seq: pull.seq.toString(),
                },
                date,
              );
            }
          }
        } catch (error) {
          this.active(signal);
          this.options.hooks.log({
            cause: safeCause(error),
            reason: isRpcNodeLag(error)
              ? "keeper_rpc_node_lag"
              : error instanceof Error &&
                  error.message === "keeper_job_conflict"
                ? "keeper_job_conflict"
                : "pull_scan_failed",
          });
        }
      }
      // Slow periodic discovery never postpones settlement of known Pulls.
      await this.drain(now, signal);
      if (this.options.shouldYield?.()) return;
      try {
        const snapshot = await chain.snapshot("confirmed", signal);
        this.active(signal);
        if (this.options.shouldYield?.()) return;
        const to = nextPhase(snapshot, now);
        const cadence = params.SERVICES.keeper;
        if (finalPullDue(snapshot, now))
          await store.ensure(
            {
              kind: "start-final-pull",
              endTs: snapshot.machine.endTs.toString(),
              window: (now / BigInt(cadence.scanSeconds)).toString(),
            },
            date,
          );
        else if (to !== null)
          await store.ensure(
            {
              kind: "advance",
              from: snapshot.machine.phase,
              to,
              window: (now / BigInt(cadence.scanSeconds)).toString(),
            },
            date,
          );
        if (snapshot.machine.phase === 5 || snapshot.machine.phase === 6) {
          try {
            for (const binder of await chain.finalSolClaims(signal)) {
              this.active(signal);
              if (this.options.shouldYield?.()) return;
              await store.ensure(
                {
                  kind: "final-sol",
                  address: binder.address.toBase58(),
                  owner: binder.owner.toBase58(),
                },
                date,
              );
              if (this.options.shouldYield?.()) return;
            }
          } catch (error) {
            this.active(signal);
            this.options.hooks.log({
              reason: "final_claim_scan_failed",
              cause: safeCause(error),
            });
          }
        }
        await this.discoverFees(now, signal);
        if (this.options.shouldYield?.()) return;
        if (
          this.lastClose === undefined ||
          now - this.lastClose >= BigInt(cadence.closeVaultPassSeconds) ||
          (snapshot.machine.phase === 6 && this.phase !== 6)
        ) {
          const ledgers = await chain.zeroLedgers(signal);
          this.active(signal);
          if (this.options.shouldYield?.()) return;
          for (const ledger of ledgers) {
            this.active(signal);
            if (this.options.shouldYield?.()) return;
            if (
              snapshot.machine.buckets.some(
                (bucket) =>
                  bucket.class !== 0 && bucket.mint.equals(ledger.mint),
              )
            )
              continue;
            const state = await chain.closeVaultState(
              ledger,
              "confirmed",
              signal,
            );
            this.active(signal);
            if (this.options.shouldYield?.()) return;
            if (!state.vaultExists) continue;
            const job = await store.ensure(
              {
                kind: "close-vault",
                mint: ledger.mint.toBase58(),
                payer: ledger.payer.toBase58(),
                window: (
                  now / BigInt(cadence.closeVaultPassSeconds)
                ).toString(),
              },
              date,
            );
            if (!state.payerWritable) {
              if (
                !job.payload.transaction &&
                job.status !== "skipped" &&
                (await store.claim(job.id)) &&
                (await store.skip(job.id, "payer_not_writable"))
              ) {
                this.options.hooks.result(job.kind, "skipped");
                await this.alert(
                  `close_vault_payer:${ledger.payer}`,
                  "payer_not_writable",
                  {
                    mint: ledger.mint.toBase58(),
                    payer: ledger.payer.toBase58(),
                  },
                );
              }
            }
          }
          this.lastClose = now;
        }
        if (this.options.shouldYield?.()) return;
        if (
          this.lastTeam === undefined ||
          now - this.lastTeam >= BigInt(cadence.teamWithdrawSeconds)
        ) {
          if (snapshot.machine.teamSol > 0n)
            await store.ensure(
              {
                kind: "team-withdraw",
                window: (now / BigInt(cadence.teamWithdrawSeconds)).toString(),
              },
              date,
            );
          this.lastTeam = now;
        }
        this.phase = snapshot.machine.phase;
      } catch (error) {
        this.active(signal);
        this.options.hooks.log({
          reason: isRpcNodeLag(error)
            ? "keeper_rpc_node_lag"
            : "periodic_scan_failed",
          cause: safeCause(error),
        });
      }
      if (this.options.shouldYield?.()) return;
      await this.drain(now, signal);
      // A phase transaction may just have closed buys; collect immediately.
      if (this.options.fees && !this.options.shouldYield?.()) {
        await this.discoverFees(await chain.chainNow(), signal);
        await this.drain(await chain.chainNow(), signal);
      }
    } finally {
      this.busy = false;
    }
  }
  private async discoverFees(now: bigint, signal: AbortSignal) {
    try {
      await this.options.fees?.discover(now, signal);
    } catch (error) {
      this.active(signal);
      this.options.hooks.log({
        reason: isRpcNodeLag(error)
          ? "keeper_rpc_node_lag"
          : "fee_scan_unavailable",
        cause: safeCause(error),
      });
    }
  }
  private async alert(
    key: string,
    reason: string,
    payload: Record<string, string | number>,
  ) {
    try {
      await this.options.hooks.alert(key, reason, payload);
    } catch (error) {
      this.options.hooks.log({
        reason: "alert_unavailable",
        cause: safeCause(error),
      });
    }
  }
  private async complete(
    intent: KeeperIntent,
    commitment: "confirmed" | "finalized",
    signal: AbortSignal,
  ): Promise<boolean> {
    this.active(signal);
    const chain = this.options.chain;
    switch (intent.kind) {
      case "fee-chain":
      case "launch-migration":
        return this.options.fees?.complete(intent, commitment, signal) ?? false;
      case "settle":
      case "refund": {
        const { pull, nextSeq } = await chain.pullCompletion(
          new PublicKey(intent.address),
          commitment,
          signal,
        );
        if (!pull) return nextSeq > BigInt(intent.seq);
        if (pull.seq.toString() !== intent.seq)
          throw new Error("pull_identity_changed");
        return intent.kind === "refund"
          ? pull.status !== 1
          : intent.packs.every((pack) => !!(pull.settledMask & (1 << pack)));
      }
      case "advance":
        return (
          (await chain.snapshot(commitment, signal)).machine.phase >= intent.to
        );
      case "start-final-pull":
        return (await chain.snapshot(commitment, signal)).machine.phase >= 5;
      case "final-sol": {
        const binder = await chain.finalClaim(
          new PublicKey(intent.owner),
          commitment,
          signal,
        );
        if (binder && binder.address.toBase58() !== intent.address)
          throw new Error("binder_identity_changed");
        return !binder || (binder.flags & 1) !== 0;
      }
      case "team-withdraw":
        return (
          (await chain.snapshot(commitment, signal)).machine.teamSol === 0n
        );
      case "close-vault": {
        const ledger = await chain.ledger(
          new PublicKey(intent.mint),
          commitment,
          signal,
        );
        return ledger === null;
      }
    }
  }
  private async instructions(
    intent: KeeperIntent,
    signal: AbortSignal,
  ): Promise<readonly TransactionInstruction[] | null> {
    const chain = this.options.chain;
    switch (intent.kind) {
      case "fee-chain":
      case "launch-migration":
        return (
          this.options.fees?.instructions(
            intent,
            await chain.chainNow(),
            signal,
          ) ?? null
        );
      case "settle":
      case "refund": {
        const pull = await chain.pull(
          new PublicKey(intent.address),
          "confirmed",
          signal,
        );
        if (!pull) return null;
        if (pull.seq.toString() !== intent.seq)
          throw new Error("pull_identity_changed");
        if (intent.kind === "settle") {
          if (
            pull.status !== 2 ||
            intent.packs.every((pack) => !!(pull.settledMask & (1 << pack)))
          )
            return null;
          return chain.settle(pull, intent.packs, signal);
        }
        if (pull.status !== 1) return null;
        if (
          (await chain.chainNow()) <
          pull.createdTs + BigInt(this.options.params.VRF.timeoutSeconds)
        )
          return null;
        return [await chain.refund(pull, signal)];
      }
      case "advance": {
        const snapshot = await chain.snapshot("confirmed", signal);
        if (
          snapshot.machine.phase !== intent.from ||
          nextPhase(snapshot, await chain.chainNow()) !== intent.to
        )
          return null;
        if (intent.from === 2 && intent.to === 3 && this.options.fees)
          return this.options.fees.instructions(
            intent,
            await chain.chainNow(),
            signal,
          );
        return [chain.advance()];
      }
      case "start-final-pull": {
        const snapshot = await chain.snapshot("confirmed", signal);
        if (
          snapshot.machine.endTs.toString() !== intent.endTs ||
          !finalPullDue(snapshot, await chain.chainNow())
        )
          return null;
        return snapshot.machine.phase === 3
          ? [chain.advance(), chain.startFinalPull()]
          : [chain.startFinalPull()];
      }
      case "final-sol": {
        const binder = await chain.finalClaim(
          new PublicKey(intent.owner),
          "confirmed",
          signal,
        );
        // A concurrent confirmed claim or an older bank is not a permanent
        // skipped job: let the next pass reconcile it at finalized commitment.
        if (!binder || (binder.flags & 1) !== 0) throw new RpcNodeLag();
        if (binder.address.toBase58() !== intent.address)
          throw new Error("binder_identity_changed");
        const snapshot = await chain.snapshot("confirmed", signal);
        if (snapshot.machine.phase !== 5 && snapshot.machine.phase !== 6)
          throw new RpcNodeLag();
        return [await chain.claimFinalSol(binder.owner, signal)];
      }
      case "team-withdraw": {
        const snapshot = await chain.snapshot("confirmed", signal);
        return snapshot.machine.teamSol > 0n
          ? [chain.teamWithdraw(snapshot.config.teamWallet)]
          : null;
      }
      case "close-vault": {
        const ledger = await chain.ledger(
          new PublicKey(intent.mint),
          "confirmed",
          signal,
        );
        if (!ledger) return null;
        const snapshot = await chain.snapshot("confirmed", signal);
        if (
          ledger.accounted !== 0n ||
          ledger.payer.toBase58() !== intent.payer ||
          snapshot.machine.buckets.some(
            (bucket) => bucket.class !== 0 && bucket.mint.equals(ledger.mint),
          )
        )
          return null;
        const state = await chain.closeVaultState(ledger, "confirmed", signal);
        if (!state.vaultExists || !state.payerWritable) return null;
        return [chain.closeVault(ledger, state.tokenProgram)];
      }
    }
  }
  private async drain(now: bigint, signal: AbortSignal): Promise<void> {
    const { store } = this.options;
    for (const job of await store.due(chainDate(now))) {
      this.active(signal);
      const housekeeping = job.kind !== "settle" && job.kind !== "refund";
      if (housekeeping && this.options.shouldYield?.()) return;
      const claimed = await store.claim(job.id);
      if (housekeeping && this.options.shouldYield?.()) return;
      if (
        ["pending", "sent", "failed"].includes(claimed.status) ||
        (claimed.status === "confirmed" && !claimed.payload.finalized)
      )
        await this.runJob(claimed, signal);
    }
  }
  private async runJob(job: KeeperJob, signal: AbortSignal): Promise<void> {
    const { store, sender, params, hooks } = this.options;
    const intent = job.payload.intent;
    try {
      if (await this.complete(intent, "confirmed", signal)) {
        // A persisted signature must still be reconciled by TxSender before success.
        if (!job.payload.transaction) {
          const firstConfirmation = !(
            job.payload.confirmationObserved ?? job.status === "confirmed"
          );
          const finalized = await this.complete(intent, "finalized", signal);
          await store.finish(
            job.id,
            "confirmed",
            null,
            chainDate(
              (await this.options.chain.chainNow()) +
                (finalized ? 0n : BigInt(params.SERVICES.keeper.scanSeconds)),
            ),
            finalized,
          );
          if (firstConfirmation) hooks.result(job.kind, "reconciled");
          return;
        }
      }
      let instructions: readonly TransactionInstruction[] | null;
      let computeUnitLimit = job.payload.computeUnitLimit;
      const lookupTables = await this.jobLookupTables(intent, signal);
      if (job.payload.transaction) {
        // Resume the exact persisted intent after a lost send reply, never replace it
        // merely because current payee privileges or state changed.
        // Decompilation promotes signer/writable flags and loses the original
        // instruction fingerprint. The atomic budget record retains that plan.
        instructions = decodeInstructionPlan(job.payload.instructions);
        if (!computeUnitLimit) throw new Error("keeper_budget_missing");
      } else {
        instructions = await this.instructions(intent, signal);
        if (!instructions?.length) {
          await store.finish(
            job.id,
            "skipped",
            "state_changed",
            chainDate(await this.options.chain.chainNow()),
          );
          hooks.result(job.kind, "skipped");
          return;
        }
        computeUnitLimit =
          intent.kind === "settle"
            ? params.CU_LIMITS.settle[intent.packs.length - 1]!
            : intent.kind === "refund"
              ? params.CU_LIMITS.refundPull
              : await this.options.measure(instructions, signal, lookupTables);
        this.active(signal);
        await store.budget(job.id, computeUnitLimit, instructions);
      }
      this.active(signal);
      if (
        intent.kind !== "settle" &&
        intent.kind !== "refund" &&
        this.options.shouldYield?.()
      )
        return;
      const result = await sender.send({
        job: job.id,
        instructions,
        computeUnitLimit,
        lookupTables,
        additionalSigners:
          intent.kind === "launch-migration"
            ? instructions[0]?.keys
                .filter((key) => key.isSigner)
                .slice(0, 1)
                .map((key) => key.pubkey)
            : undefined,
        isComplete: (commitment) => this.complete(intent, commitment, signal),
        rebuild: async () => {
          this.active(signal);
          const fresh = await this.instructions(intent, signal);
          if (!fresh?.length) return null;
          const freshLookupTables = await this.jobLookupTables(intent, signal);
          const units =
            intent.kind === "settle"
              ? params.CU_LIMITS.settle[intent.packs.length - 1]!
              : intent.kind === "refund"
                ? params.CU_LIMITS.refundPull
                : await this.options.measure(fresh, signal, freshLookupTables);
          this.active(signal);
          // TxSender atomically journals this plan with its replacement signature.
          return {
            instructions: fresh,
            computeUnitLimit: units,
            lookupTables: freshLookupTables,
            additionalSigners:
              intent.kind === "launch-migration"
                ? fresh[0]?.keys
                    .filter((key) => key.isSigner)
                    .slice(0, 1)
                    .map((key) => key.pubkey)
                : undefined,
          };
        },
        signal,
      });
      this.active(signal);
      const now = await this.options.chain.chainNow();
      if (result.status === "skipped") {
        await store.finish(job.id, "skipped", "state_changed", chainDate(now));
        hooks.result(job.kind, "skipped");
        return;
      }
      let finalized = false;
      if (result.status === "confirmed" && result.finalized) {
        // A finalized signature proves this job ran even if fresh activity has
        // since replenished team revenue or recreated the ledger.
        if (
          (intent.kind === "advance" || intent.kind === "start-final-pull") &&
          !(await this.complete(intent, "finalized", signal))
        ) {
          await store.finish(job.id, "skipped", "no_effect", chainDate(now));
          hooks.result(job.kind, "skipped");
          return;
        }
        finalized = true;
      } else if (result.status === "reconciled") {
        finalized = await this.complete(intent, "finalized", signal);
      }
      const firstConfirmation = !(
        job.payload.confirmationObserved ?? job.status === "confirmed"
      );
      await store.finish(
        job.id,
        "confirmed",
        null,
        chainDate(
          now + (finalized ? 0n : BigInt(params.SERVICES.keeper.scanSeconds)),
        ),
        finalized,
      );
      if (firstConfirmation) hooks.result(job.kind, result.status);
      if (
        firstConfirmation &&
        intent.kind === "settle" &&
        result.status === "confirmed"
      )
        hooks.latency(Number(now - BigInt(intent.revealedTs)));
      hooks.log({
        job: job.id,
        kind: job.kind,
        reason: result.status,
        sig: result.signature,
      });
    } catch (error) {
      this.active(signal);
      if (isRpcNodeLag(error)) {
        // Preserve the current job and signed record. A node behind the read
        // context cannot establish failure or justify replacing a transaction.
        hooks.log({
          job: job.id,
          kind: job.kind,
          reason: "keeper_rpc_node_lag",
          cause: safeCause(error),
        });
        return;
      }
      const reason = error instanceof TxSenderError ? error.code : "job_failed";
      const now = await this.options.chain.chainNow();
      const next = chainDate(now);
      next.setTime(next.getTime() + params.SERVICES.keeper.backoffMaxMs);
      // Keep sent records reconcilable even after the durable attempt budget is used.
      await store.finish(job.id, "failed", reason, next);
      hooks.result(job.kind, "failed");
      hooks.log({
        job: job.id,
        kind: job.kind,
        reason,
        cause: safeCause(error),
      });
      await this.alert(`keeper_job:${job.id}`, reason, {
        job: job.id,
        kind: job.kind,
      });
    }
  }
  private async jobLookupTables(intent: KeeperIntent, signal: AbortSignal) {
    if (
      intent.kind === "fee-chain" ||
      intent.kind === "launch-migration" ||
      (intent.kind === "advance" &&
        intent.from === 2 &&
        intent.to === 3 &&
        this.options.fees)
    )
      return this.options.lookupTables?.(signal);
    // Existing exits and unrelated maintenance never depend on launch RPC data.
    return undefined;
  }
}
export type KeeperExtension = (context: {
  signal: AbortSignal;
  assertLeader(): void;
}) => Promise<void>;
export type KeeperMonitor = (
  snapshot: KeeperSnapshot,
  now: bigint,
  signal: AbortSignal,
) => Promise<void>;
