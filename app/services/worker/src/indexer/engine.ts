import { isRpcNodeLag, warnCause } from "@onepercent/service-kit";
import {
  isDeterministicTransactionError,
  type IndexedTransaction,
} from "./store.js";
import { IndexerMaintenance } from "./maintenance.js";
import { dirtyAccountAddresses } from "./dirty.js";
import type { TxSource } from "./source.js";

export interface EngineStore {
  cursor(): Promise<{ lastSignature: string | null; lastSlot: bigint } | null>;
  apply(tx: IndexedTransaction): Promise<boolean>;
  recordUnprocessable(tx: IndexedTransaction, error: unknown): Promise<void>;
  lastAppliedSlot?(): Promise<bigint>;
  advanceCursor(signature: string, slot: bigint): Promise<void>;
  pendingFinality(
    slot: bigint,
  ): Promise<{ signature: string; slot: bigint; txIndex: bigint }[]>;
  finalize(signature: string): Promise<void>;
  rollback(signature: string): Promise<void>;
}
export interface Reconciler {
  recoverPullNonces?(tx: IndexedTransaction): Promise<void>;
  remember?(tx: IndexedTransaction): Promise<boolean | void>;
  reconcile(accounts?: readonly string[], minSlot?: bigint): Promise<unknown>;
  reconcileDeck(minSlot?: bigint): Promise<unknown>;
}

/** One serial writer; notification bursts are coalesced and cannot reorder transactions. */
export class IndexerEngine {
  private inFlight: Promise<void> | undefined;
  private again = false;
  private stopped = false;
  private readonly abort = new AbortController();
  readonly maintenance: IndexerMaintenance;
  private refreshSingletons = false;
  private readonly dirtyAccounts = new Set<string>();
  constructor(
    private readonly options: {
      source: TxSource;
      store: EngineStore;
      reconciler: Reconciler;
      publish: () => Promise<void>;
      afterApply?: (tx: IndexedTransaction) => Promise<void>;
      status: (
        confirmedSlot: bigint,
        latestEventSlot: bigint,
        scanSlot: bigint,
      ) => Promise<void>;
      beforePoll?: (signal: AbortSignal) => Promise<void>;
      onNodeLag?: (error: unknown) => Promise<void>;
      programId: string;
      maintenanceRetryMs?: number;
      onMaintenanceFailure?: (
        kind: "accounts" | "deck",
        error: unknown,
        attempt: number,
      ) => Promise<void>;
      accountReconcileSeconds: number;
      deckReconcileSeconds: number;
      now?: () => number;
    },
  ) {
    this.maintenance = new IndexerMaintenance({
      confirmedSlot: () => options.source.confirmedSlot(this.abort.signal),
      accounts: (slot) => options.reconciler.reconcile(undefined, slot),
      deck: (slot) => options.reconciler.reconcileDeck(slot),
      accountSeconds: options.accountReconcileSeconds,
      deckSeconds: options.deckReconcileSeconds,
      retryMs: options.maintenanceRetryMs ?? 2000,
      onFailure: options.onMaintenanceFailure,
      now: options.now,
    });
  }
  poll(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.inFlight = (async () => {
      do {
        this.again = false;
        try {
          await this.tick();
        } catch (error) {
          if (!isRpcNodeLag(error) || this.abort.signal.aborted) throw error;
          // A lagging provider is not evidence that anything can be skipped.
          // Keep the last committed cursor and wait for the next scheduled poll.
          this.again = false;
          await this.options.onNodeLag?.(error);
          break;
        }
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  private async tick() {
    const { source, store, reconciler } = this.options;
    const signal = this.abort.signal;
    await this.options.beforePoll?.(signal);
    const finalized = await source.finalizedSlot(signal);
    for (const row of await store.pendingFinality(finalized)) {
      signal.throwIfAborted();
      if (await source.canonical(row.signature, row.slot, signal, row.txIndex))
        await store.finalize(row.signature);
      else {
        await store.rollback(row.signature);
        this.maintenance.request(row.slot, true);
      }
    }
    const throughSlot = await source.confirmedSlot(signal);
    const cursor = await store.cursor();
    const transactions = await source.transactions(
      cursor?.lastSignature ?? null,
      throughSlot,
      signal,
    );
    let latestEventSlot =
      (await store.lastAppliedSlot?.()) ?? cursor?.lastSlot ?? 0n;
    for (const tx of transactions) {
      signal.throwIfAborted();
      let applied = false;
      // The account helper handles unavailable nonce evidence internally.
      // Escaping transport/schema failures must retry, never quarantine a valid transaction.
      if (tx.err === null) await reconciler.recoverPullNonces?.(tx);
      try {
        if (tx.err === null) {
          if ((await reconciler.remember?.(tx)) === false) tx.truncated = true;
        }
        applied = await store.apply(tx);
        if (tx.err === null && tx.slot > latestEventSlot)
          latestEventSlot = tx.slot;
      } catch (error) {
        if (!isDeterministicTransactionError(error)) throw error;
        warnCause("indexer_tx_unprocessable", error);
        tx.truncated = true;
        await store.recordUnprocessable(tx, error);
      }
      if (tx.err === null) {
        dirtyAccountAddresses(tx, this.options.programId).forEach((key) =>
          this.dirtyAccounts.add(key),
        );
        this.refreshSingletons = true;
        if (tx.truncated) this.maintenance.request(tx.slot, true);
      }
      if (applied) await this.options.afterApply?.(tx);
      await store.advanceCursor(tx.signature, tx.slot);
    }
    if (this.refreshSingletons || this.dirtyAccounts.size) {
      // One bounded batch of event-named accounts for the entire tick.
      await reconciler.reconcile([...this.dirtyAccounts], throughSlot);
      this.dirtyAccounts.clear();
      this.refreshSingletons = false;
    }
    // Raw committed rows form a durable outbox; Redis failure retries on the next poll.
    await this.options.publish();
    const confirmed = await source.confirmedSlot(signal);
    latestEventSlot = (await store.lastAppliedSlot?.()) ?? latestEventSlot;
    await this.options.status(confirmed, latestEventSlot, throughSlot);
  }
  async stop() {
    this.stopped = true;
    this.abort.abort();
    await Promise.all([
      this.inFlight?.catch((error) =>
        warnCause("indexer_shutdown_poll_failed", error),
      ),
      this.maintenance.stop(),
    ]);
  }
}
