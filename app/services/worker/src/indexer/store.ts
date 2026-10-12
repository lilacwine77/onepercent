import { warnCause } from "@onepercent/service-kit";
import {
  jsonObjectSchema,
  type JsonObject,
  type JsonValue,
} from "@onepercent/db";
import {
  resolveConsumption,
  type IndexerAlert,
  type ProvenanceFallback,
} from "./consumption.js";
import {
  clearProjectionHistory,
  enrichEvent,
  projectEvent,
  MIRROR_TABLES,
} from "./projections.js";
import {
  prepareFeedRecovery,
  recoveredFeedEvents,
  type IntakeSignerResolver,
  RECOVERED_FEED,
} from "./feed-recovery.js";
import { SEASON_RETAINED_MIRRORS } from "./season/projections.js";
import { BLOCK0_READY_EVENT } from "./season/block0.js";

export const INDEXER_LOCK_ID = 472001;
export interface SqlExecutor {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}
export interface SqlClient extends SqlExecutor {
  release(): void;
}
export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlClient>;
}
export interface IndexedEvent {
  name: string;
  data: JsonObject;
  ixIndex: bigint;
  eventIndex: bigint;
}
export interface IndexedTransaction {
  signature: string;
  slot: bigint;
  txIndex: bigint;
  blockTime: number | null;
  err: JsonValue | null;
  truncated: boolean;
  events: IndexedEvent[];
  accountKeys: string[];
  instructions: { programId: string; data: string; accounts: string[] }[];
}
const INCOMPLETE_REASONS = new Set([
  "pull_nonce_unavailable",
  "deck_move_missing",
  "deck_pick_missing",
  "pack_pull_missing",
  "exec_begin_missing",
]);
// These failures depend on retained transaction bytes/events. Retrying the same
// transaction cannot repair them. Transport/database failures are deliberately
// excluded: no data is skipped on an unavailable dependency.
const DETERMINISTIC_REASONS = new Set([
  ...INCOMPLETE_REASONS,
  "invalid_instruction_base58",
  "instruction_too_large",
  "invalid_buy_packs_data",
  "invalid_pull_pda",
  "feed_recovery_invalid",
  "indexer_out_of_order",
  "invalid_event_integer",
  "unsafe_event_integer",
  "invalid_event_object",
  "invalid_event_array",
]);
export function isDeterministicTransactionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !("code" in error) &&
    error.message !== "fetch failed" &&
    (DETERMINISTIC_REASONS.has(error.message) ||
      error instanceof TypeError ||
      error instanceof RangeError ||
      error.name === "ZodError")
  );
}
function deterministicReason(error: unknown): string {
  return error instanceof Error && DETERMINISTIC_REASONS.has(error.message)
    ? error.message
    : "transaction_data_invalid";
}
type PendingAlert = { key: string; payload: JsonObject };

export interface StoreOptions {
  programId: string;
  royaltyPerDustCardBps: number;
  recomputeProvenance?: ProvenanceFallback;
  getIntakeSigner?: IntakeSignerResolver;
  alert?: IndexerAlert;
}

export class IndexerStore {
  constructor(
    readonly pool: SqlPool,
    readonly options: StoreOptions,
  ) {
    if (
      !Number.isInteger(options.royaltyPerDustCardBps) ||
      options.royaltyPerDustCardBps < 0 ||
      options.royaltyPerDustCardBps > 10_000
    )
      throw new Error("invalid_royalty_bps");
  }

  async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [INDEXER_LOCK_ID]);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      clearProjectionHistory(this.options);
      await client
        .query("ROLLBACK")
        .catch((error) => warnCause("indexer_rollback_failed", error));
      throw error;
    } finally {
      client.release();
    }
  }

  async cursor(): Promise<{
    lastSignature: string | null;
    lastSlot: bigint;
  } | null> {
    const row = (
      await this.pool.query(
        "SELECT last_signature,last_slot FROM cursors WHERE name='indexer'",
      )
    ).rows[0];
    return row
      ? {
          lastSignature:
            row.last_signature === null ? null : String(row.last_signature),
          lastSlot: BigInt(String(row.last_slot)),
        }
      : null;
  }

  async advanceCursor(signature: string, slot: bigint): Promise<void> {
    await this.pool.query(
      "INSERT INTO cursors(name,last_signature,last_slot) VALUES('indexer',$1,$2) ON CONFLICT(name) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot",
      [signature, slot.toString()],
    );
  }

  async lastAppliedSlot(): Promise<bigint> {
    const row = (
      await this.pool.query(
        "SELECT COALESCE(MAX(t.slot),0) AS slot FROM chain_txs t WHERE t.err IS NULL AND NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:' || t.signature)",
      )
    ).rows[0];
    return BigInt(String(row?.slot ?? 0));
  }

  /** Retain deterministic failures for inspection without blocking later signatures. */
  async recordUnprocessable(
    tx: IndexedTransaction,
    error: unknown,
  ): Promise<void> {
    const reason = deterministicReason(error);
    await this.transaction(async (client) => {
      clearProjectionHistory(this.options);
      await client.query(
        "INSERT INTO chain_txs(signature,slot,tx_index,block_time,commitment,err,truncated) VALUES($1,$2,$3,$4,'confirmed',NULL,true) ON CONFLICT(signature) DO UPDATE SET truncated=true",
        [
          tx.signature,
          String(tx.slot),
          String(tx.txIndex),
          tx.blockTime === null ? null : new Date(tx.blockTime * 1000),
        ],
      );
      await client.query(
        "INSERT INTO cursors(name,last_signature,last_slot) VALUES($1,$2,$3) ON CONFLICT(name) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot",
        [
          `indexer:unprocessable:${tx.signature}`,
          tx.signature,
          String(tx.slot),
        ],
      );
      for (const event of tx.events) {
        const metadata = event.data._indexer;
        await this.persistRecovery(client, tx, {
          ...event,
          data: {
            ...event.data,
            _indexer: {
              ...(metadata &&
              typeof metadata === "object" &&
              !Array.isArray(metadata)
                ? metadata
                : {}),
              incompleteReason: reason,
            },
          },
        });
      }
    });
    tx.truncated = true;
    await this.options.alert?.("indexer_tx_unprocessable", {
      signature: tx.signature,
      slot: String(tx.slot),
      reason,
    });
  }

  async apply(tx: IndexedTransaction): Promise<boolean> {
    // Failed Solana transactions have no committed program effects, including emitted logs.
    if (tx.err !== null) return false;
    const alerts: PendingAlert[] = [];
    const applied = await this.transaction(async (client) => {
      const inserted = await client.query(
        "INSERT INTO chain_txs(signature,slot,tx_index,block_time,commitment,err,truncated) VALUES($1,$2,$3,$4,'confirmed',NULL,$5) ON CONFLICT(signature) DO NOTHING RETURNING signature",
        [
          tx.signature,
          tx.slot.toString(),
          tx.txIndex.toString(),
          tx.blockTime === null ? null : new Date(tx.blockTime * 1000),
          tx.truncated,
        ],
      );
      if (inserted.rows.length === 0) {
        const saved = (
          await client.query(
            "SELECT truncated FROM chain_txs WHERE signature=$1",
            [tx.signature],
          )
        ).rows[0];
        tx.truncated ||= saved?.truncated === true;
        // The signature cursor advances only after notification. A crash or webhook failure retries here.
        const recorded = await client.query(
          "SELECT name,data,ix_index,event_index FROM chain_events WHERE signature=$1 ORDER BY ix_index,event_index",
          [tx.signature],
        );
        const retainedTx: IndexedTransaction = {
          ...tx,
          events: recorded.rows.map((row) => ({
            name: String(row.name),
            data: jsonObjectSchema.parse(row.data),
            ixIndex: BigInt(String(row.ix_index)),
            eventIndex: BigInt(String(row.event_index)),
          })),
        };
        const repairs = await recoveredFeedEvents(
          client,
          retainedTx,
          await prepareFeedRecovery(retainedTx, this.options),
          this.options,
        );
        for (const event of repairs) {
          await this.persistRecovery(client, tx, event);
          recorded.rows.push({ name: event.name, data: event.data });
        }
        if (repairs.length) await this.rebuildConsumption(client);
        for (const row of recorded.rows) {
          const data = jsonObjectSchema.parse(row.data);
          const metadata = data._indexer;
          if (
            metadata &&
            typeof metadata === "object" &&
            !Array.isArray(metadata)
          ) {
            if (metadata.intakeLogMissing)
              alerts.push({
                key: "intake_log_missing",
                payload: {
                  signature: tx.signature,
                  mint: data.mint!,
                  path: metadata.path!,
                },
              });
            if (metadata.incompleteReason)
              alerts.push({
                key: "indexer_projection_incomplete",
                payload: {
                  signature: tx.signature,
                  event: String(row.name),
                  reason: metadata.incompleteReason,
                },
              });
            if (metadata.evidence === "incomplete")
              alerts.push({
                key: "feed_proof_incomplete",
                payload: {
                  signature: tx.signature,
                  mint: data.mint!,
                  reason: "retained_instruction_evidence",
                },
              });
          }
          if (row.name === "VaultShortfall")
            alerts.push({
              key: "VaultShortfall",
              payload: { signature: tx.signature, ...data },
            });
        }
        return false;
      }
      const latest = (
        await client.query(
          "SELECT slot,tx_index FROM chain_txs WHERE signature<>$1 ORDER BY slot DESC,tx_index DESC LIMIT 1",
          [tx.signature],
        )
      ).rows[0];
      if (
        latest &&
        (BigInt(String(latest.slot)) > tx.slot ||
          (BigInt(String(latest.slot)) === tx.slot &&
            BigInt(String(latest.tx_index)) > tx.txIndex))
      )
        throw new Error("indexer_out_of_order");
      const recovered = await recoveredFeedEvents(
        client,
        tx,
        await prepareFeedRecovery(tx, this.options),
        this.options,
      );
      for (const source of [...tx.events, ...recovered].sort((a, b) =>
        a.ixIndex < b.ixIndex
          ? -1
          : a.ixIndex > b.ixIndex
            ? 1
            : a.eventIndex < b.eventIndex
              ? -1
              : a.eventIndex > b.eventIndex
                ? 1
                : 0,
      )) {
        const event: IndexedEvent = {
          ...source,
          data: structuredClone(source.data),
        };
        if (event.name === "BagFed") {
          const resolved = await resolveConsumption(
            client,
            tx,
            event,
            this.options,
          );
          event.data._indexer = {
            ...resolved.provenance,
            intakeLogMissing: resolved.missing,
          };
          if (resolved.missing)
            alerts.push({
              key: "intake_log_missing",
              payload: {
                signature: tx.signature,
                mint: event.data.mint!,
                path: resolved.provenance.path,
              },
            });
        }
        if (event.name === RECOVERED_FEED) {
          const metadata = event.data._indexer as JsonObject;
          if (metadata.intakeLogMissing)
            alerts.push({
              key: "intake_log_missing",
              payload: {
                signature: tx.signature,
                mint: event.data.mint!,
                path: metadata.path!,
              },
            });
          if (metadata.evidence === "incomplete")
            alerts.push({
              key: "feed_proof_incomplete",
              payload: {
                signature: tx.signature,
                mint: event.data.mint!,
                reason: "retained_instruction_evidence",
              },
            });
        }
        await client.query("SAVEPOINT event_projection");
        const persist = () =>
          client.query(
            "INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(signature,ix_index,event_index) DO NOTHING",
            [
              tx.signature,
              tx.slot.toString(),
              tx.txIndex.toString(),
              event.ixIndex.toString(),
              event.eventIndex.toString(),
              event.name,
              JSON.stringify(event.data),
            ],
          );
        try {
          await enrichEvent(client, tx, event, this.options);
          await persist();
          await projectEvent(client, tx, event, this.options);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (!INCOMPLETE_REASONS.has(reason)) throw error;
          warnCause("indexer_projection_incomplete", error);
          await client.query("ROLLBACK TO SAVEPOINT event_projection");
          const metadata = event.data._indexer;
          event.data._indexer = {
            ...(metadata &&
            typeof metadata === "object" &&
            !Array.isArray(metadata)
              ? metadata
              : {}),
            incompleteReason: reason,
          };
          await persist();
          await client.query(
            "UPDATE chain_txs SET truncated=true WHERE signature=$1",
            [tx.signature],
          );
          tx.truncated = true;
          alerts.push({
            key: "indexer_projection_incomplete",
            payload: { signature: tx.signature, event: event.name, reason },
          });
        }
        await client.query("RELEASE SAVEPOINT event_projection");
        if (event.name === "VaultShortfall")
          alerts.push({
            key: "VaultShortfall",
            payload: { signature: tx.signature, ...event.data },
          });
      }
      return true;
    });
    for (const alert of alerts)
      await this.options.alert?.(alert.key, alert.payload);
    return applied;
  }

  private async persistRecovery(
    client: SqlClient,
    tx: IndexedTransaction,
    event: IndexedEvent,
  ): Promise<void> {
    await client.query(
      "INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(signature,ix_index,event_index) DO NOTHING",
      [
        tx.signature,
        String(tx.slot),
        String(tx.txIndex),
        String(event.ixIndex),
        String(event.eventIndex),
        event.name,
        JSON.stringify(event.data),
      ],
    );
  }

  private async rebuildConsumption(client: SqlClient): Promise<void> {
    // A late proof must restore first-Feed precedence, including earlier unknown records.
    await client.query("TRUNCATE intake_consumption");
    const rows = await client.query(
      "SELECT signature,slot,data FROM chain_events WHERE name IN ('BagFed','IndexerFeedRecovered') AND data->'_indexer'->>'incompleteReason' IS NULL AND NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:'||chain_events.signature) ORDER BY slot,tx_index,ix_index,event_index",
    );
    for (const row of rows.rows) {
      const data = jsonObjectSchema.parse(row.data);
      const metadata = jsonObjectSchema.parse(data._indexer);
      await client.query(
        "INSERT INTO intake_consumption(holder,mint,used_by,path,first_feed_sig,slot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(holder,mint) DO NOTHING",
        [
          metadata.holder,
          data.mint,
          data.depositor,
          metadata.path,
          row.signature,
          row.slot,
        ],
      );
    }
  }

  async pendingFinality(
    maxSlot: bigint,
  ): Promise<{ signature: string; slot: bigint; txIndex: bigint }[]> {
    const result = await this.pool.query(
      "SELECT signature,slot,tx_index FROM chain_txs WHERE commitment='confirmed' AND slot<=$1 ORDER BY slot,tx_index",
      [maxSlot.toString()],
    );
    return result.rows.map((row) => ({
      signature: String(row.signature),
      slot: BigInt(String(row.slot)),
      txIndex: BigInt(String(row.tx_index)),
    }));
  }

  async finalize(signature: string): Promise<void> {
    await this.pool.query(
      "UPDATE chain_txs SET commitment='finalized' WHERE signature=$1",
      [signature],
    );
  }

  async rollback(signature: string): Promise<void> {
    const warnings = await this.transaction(async (client) => {
      const orphan = (
        await client.query("SELECT slot FROM chain_txs WHERE signature=$1", [
          signature,
        ])
      ).rows[0];
      if (!orphan) return null;
      // Re-fetch all later confirmed signatures to preserve replacement order and first Feed precedence.
      await client.query(
        "DELETE FROM chain_txs WHERE commitment='confirmed' AND slot >= $1",
        [orphan.slot],
      );
      // A board's finalized launch can survive a fork in its later publication
      // slot. Requeue that notification before resetting the stream, otherwise
      // its high order key would hide replacement transactions behind it.
      await client.query(
        `WITH removed AS (
          DELETE FROM chain_events WHERE name=$2 AND slot >= $1 RETURNING signature
        ) UPDATE season_launches SET status='pending',as_of_slot=slot
          WHERE signature IN (SELECT signature FROM removed)`,
        [orphan.slot, BLOCK0_READY_EVENT],
      );
      await client.query(
        "DELETE FROM cursors WHERE (name LIKE 'indexer:pull-origin:%' OR name LIKE 'indexer:unprocessable:%') AND NOT EXISTS (SELECT 1 FROM chain_txs WHERE signature=cursors.last_signature)",
      );
      await client.query(
        "INSERT INTO cursors(name,last_signature,last_slot) VALUES('indexer:stream-reset',NULL,$1) ON CONFLICT(name) DO UPDATE SET last_signature=NULL,last_slot=EXCLUDED.last_slot",
        [orphan.slot],
      );
      await client.query("DELETE FROM cursors WHERE name='indexer:published'");
      const incomplete = await this.rebuild(client);
      const latest = (
        await client.query(
          "SELECT signature,slot FROM chain_txs WHERE slot < $1 ORDER BY slot DESC,tx_index DESC LIMIT 1",
          [orphan.slot],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO cursors(name,last_signature,last_slot) VALUES('indexer',$1,$2) ON CONFLICT(name) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot",
        [latest?.signature ?? null, latest?.slot ?? "0"],
      );
      return incomplete;
    });
    if (warnings === null) return;
    for (const warning of warnings)
      await this.options.alert?.(warning.key, warning.payload);
    await this.options.alert?.("fork_rollback", { signature });
  }

  async replay(fromSlot: bigint): Promise<void> {
    if (fromSlot < 0n) throw new Error("invalid_replay_slot");
    const warnings = await this.transaction(async (client) => {
      // Earlier events are the baseline: truncating and starting at fromSlot loses live older cards.
      return this.rebuild(client);
    });
    for (const warning of warnings)
      await this.options.alert?.(warning.key, warning.payload);
  }

  private async rebuild(client: SqlClient): Promise<PendingAlert[]> {
    clearProjectionHistory(this.options);
    const warnings: PendingAlert[] = [];
    // Buckets also hold the keeper-owned failing flag. Preserve it while the following
    // account reconcile refreshes chain fields; rebuilding events must not clear it.
    const retained: readonly string[] = SEASON_RETAINED_MIRRORS;
    const eventMirrors = MIRROR_TABLES.filter(
      (table) => table !== "buckets" && !retained.includes(table),
    );
    await client.query(`TRUNCATE ${eventMirrors.join(", ")}`);
    await client.query(
      "DELETE FROM cursors WHERE name IN ('indexer:deck-snapshot','indexer:account-snapshot') OR name LIKE 'indexer:account:%'",
    );
    const rows = (
      await client.query(
        "SELECT e.*,t.block_time FROM chain_events e JOIN chain_txs t USING(signature) WHERE NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:'||e.signature) ORDER BY e.slot,e.tx_index,e.ix_index,e.event_index",
      )
    ).rows;
    for (const row of rows) {
      const event: IndexedEvent = {
        name: String(row.name),
        data: jsonObjectSchema.parse(row.data),
        ixIndex: BigInt(String(row.ix_index)),
        eventIndex: BigInt(String(row.event_index)),
      };
      const tx: IndexedTransaction = {
        signature: String(row.signature),
        slot: BigInt(String(row.slot)),
        txIndex: BigInt(String(row.tx_index)),
        blockTime:
          row.block_time === null
            ? null
            : new Date(String(row.block_time)).getTime() / 1000,
        err: null,
        truncated: false,
        events: [event],
        accountKeys: [],
        instructions: [],
      };
      const metadata = event.data._indexer;
      if (
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        metadata.incompleteReason
      )
        continue;
      await client.query("SAVEPOINT replay_projection");
      try {
        await projectEvent(client, tx, event, this.options);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        if (!INCOMPLETE_REASONS.has(reason)) throw error;
        warnCause("indexer_projection_incomplete", error);
        await client.query("ROLLBACK TO SAVEPOINT replay_projection");
        event.data._indexer = {
          ...(metadata &&
          typeof metadata === "object" &&
          !Array.isArray(metadata)
            ? metadata
            : {}),
          incompleteReason: reason,
        };
        await client.query(
          "UPDATE chain_events SET data=$4::jsonb WHERE signature=$1 AND ix_index=$2 AND event_index=$3",
          [
            tx.signature,
            event.ixIndex.toString(),
            event.eventIndex.toString(),
            JSON.stringify(event.data),
          ],
        );
        await client.query(
          "UPDATE chain_txs SET truncated=true WHERE signature=$1",
          [tx.signature],
        );
        warnings.push({
          key: "indexer_projection_incomplete",
          payload: { signature: tx.signature, event: event.name, reason },
        });
      }
      await client.query("RELEASE SAVEPOINT replay_projection");
    }
    return warnings;
  }
}
