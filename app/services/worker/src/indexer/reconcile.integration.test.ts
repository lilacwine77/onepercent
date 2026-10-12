import { createHash, randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { applyMigrations, createDatabase } from "@onepercent/db";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_BYTES,
  accountDiscriminator,
  ledgerAddress,
  singletonAddress,
  TOKEN_PROGRAMS,
  vaultAddress,
} from "./accounts.js";
import { AccountReconciler } from "./reconcile.js";
import { IndexerStore } from "./store.js";
import { MIRROR_TABLES } from "./projections.js";

const enabled = process.env.SERVICES_INTEGRATION === "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  enabled &&
  (!databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    ))
)
  throw new Error("SERVICES_INTEGRATION requires a local TEST_DATABASE_URL");
const programId = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
const depositor = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
const mint = new PublicKey(new Uint8Array(32).fill(4)).toBase58();

describe.skipIf(!enabled)(
  "indexer account reconciliation (services CI, Postgres 17)",
  () => {
    const name = `onepct_reconcile_${randomUUID().replaceAll("-", "")}`;
    let admin: ReturnType<typeof createDatabase>;
    let database: ReturnType<typeof createDatabase>;
    beforeAll(async () => {
      admin = createDatabase({ connectionString: databaseUrl });
      await admin.pool.query(`CREATE DATABASE "${name}"`);
      const local = new URL(databaseUrl!);
      local.pathname = `/${name}`;
      database = createDatabase({ connectionString: local.href });
      await applyMigrations(database.pool);
    }, 30_000);
    afterAll(async () => {
      await database?.close();
      if (admin) {
        await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.close();
      }
    });
    it("hashes every mirror identically after repeated snapshots and fences older Deck events", async () => {
      const machine = Buffer.alloc(ACCOUNT_BYTES.Machine);
      accountDiscriminator("Machine").copy(machine);
      new PublicKey(mint).toBuffer().copy(machine, 224);
      machine[224 + 109] = 1;
      machine[224 + 110] = 1;
      const config = Buffer.alloc(ACCOUNT_BYTES.Config);
      accountDiscriminator("Config").copy(config);
      const deck = Buffer.alloc(ACCOUNT_BYTES.Deck + ACCOUNT_BYTES.deckEntry);
      accountDiscriminator("Deck").copy(deck);
      deck.writeUInt32LE(1, 8);
      deck.writeUInt32LE(1, 12);
      deck.writeBigUInt64LE(1n, 24);
      new PublicKey(depositor).toBuffer().copy(deck, 64);
      new PublicKey(mint).toBuffer().copy(deck, 96);
      deck.writeBigUInt64LE((1n << 64n) - 1n, 128);
      deck.writeUInt32LE(123, 136);
      deck[140] = 1;
      const accounts = new Map([
        [singletonAddress(programId, "machine"), machine],
        [singletonAddress(programId, "config"), config],
        [singletonAddress(programId, "deck"), deck],
      ]);
      const request: JsonRpcClient["request"] = async (
        method,
        params,
        schema,
      ) => {
        if (method === "getProgramAccounts")
          return schema.parse({ context: { slot: 100 }, value: [] });
        if (method === "getMultipleAccounts")
          return schema.parse({
            context: { slot: 100 },
            value: (params[0] as string[]).map((address) => {
              const data = accounts.get(address);
              return data
                ? {
                    owner: programId,
                    executable: false,
                    data: [data.toString("base64"), "base64"],
                  }
                : null;
            }),
          });
        if (method !== "getAccountInfo")
          throw new Error("unexpected_rpc_method");
        const data = accounts.get(String(params[0]));
        const slice = (
          params[1] as { dataSlice?: { offset: number; length: number } }
        ).dataSlice;
        const bytes =
          data && slice
            ? data.subarray(slice.offset, slice.offset + slice.length)
            : data;
        return schema.parse({
          context: { slot: 100 },
          value: bytes
            ? {
                owner: programId,
                executable: false,
                data: [bytes.toString("base64"), "base64"],
              }
            : null,
        });
      };
      const reconciler = new AccountReconciler({
        pool: database.pool,
        rpc: { request },
        programId,
        deckChunkBytes: 160,
        metrics: { indexerDeckDrift: { set: vi.fn() } as never },
        alert: async () => undefined,
      });
      const store = new IndexerStore(database.pool, {
        programId,
        royaltyPerDustCardBps: 1,
        recomputeProvenance: async () => ({ path: "self", via: null }),
      });
      await store.apply({
        signature: "listing",
        slot: 10n,
        txIndex: 0n,
        blockTime: 10,
        err: null,
        truncated: false,
        accountKeys: [],
        instructions: [],
        events: [
          {
            name: "ConfigChanged",
            ixIndex: 0n,
            eventIndex: 0n,
            data: { action: 13, actor: depositor, key: mint, a: "1", b: "0" },
          },
        ],
      });
      await reconciler.reconcile();
      await reconciler.reconcileDeck();
      expect(
        (await database.pool.query("SELECT listed_slot FROM buckets")).rows,
      ).toEqual([{ listed_slot: "10" }]);
      await store.apply({
        signature: "older-confirmed-feed",
        slot: 50n,
        txIndex: 0n,
        blockTime: 50,
        err: null,
        truncated: false,
        accountKeys: [],
        instructions: [],
        events: [
          {
            name: "BagFed",
            ixIndex: 0n,
            eventIndex: 0n,
            data: {
              depositor,
              mint,
              amount: "1",
              deposit: "1",
              deck_index: 1,
              fresh_in_deck: 1,
            },
          },
        ],
      });
      const snapshot = async () => {
        const hashes: Record<string, string> = {};
        const client = await database.pool.connect();
        try {
          await client.query("SET TIME ZONE 'UTC'");
          for (const table of MIRROR_TABLES) {
            const rows = await client.query(
              `SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
            );
            hashes[table] = createHash("sha256")
              .update(JSON.stringify(rows.rows))
              .digest("hex");
          }
        } finally {
          client.release();
        }
        return hashes;
      };
      const first = await snapshot();
      await reconciler.reconcile();
      await reconciler.reconcileDeck();
      expect(await snapshot()).toEqual(first);
      expect(
        (
          await database.pool.query(
            "SELECT deck_index,amount FROM deck_entries",
          )
        ).rows,
      ).toEqual([{ deck_index: "0", amount: "18446744073709551615" }]);
      expect(
        (
          await database.pool.query(
            "SELECT last_slot FROM cursors WHERE name='indexer:deck-snapshot'",
          )
        ).rows[0].last_slot,
      ).toBe("100");
    });
    it("retains the canonical VaultClosed time at the snapshot and clears it on reopening", async () => {
      const ledger = ledgerAddress(programId, mint);
      const vault = vaultAddress(programId, mint, TOKEN_PROGRAMS[0]);
      const ledgerData = Buffer.alloc(ACCOUNT_BYTES.MintLedger);
      accountDiscriminator("MintLedger").copy(ledgerData);
      new PublicKey(mint).toBuffer().copy(ledgerData, 8);
      new PublicKey(depositor).toBuffer().copy(ledgerData, 40);
      let exists = false;
      const rpcAccount = (owner: string, data: Buffer) => ({
        owner,
        executable: false,
        data: [data.toString("base64"), "base64"],
      });
      const request: JsonRpcClient["request"] = async (
        method,
        params,
        schema,
      ) => {
        if (method === "getMultipleAccounts")
          return schema.parse({
            context: { slot: 100 },
            value: (params[0] as string[]).map((address) =>
              address === ledger
                ? rpcAccount(programId, ledgerData)
                : address === mint
                  ? rpcAccount(TOKEN_PROGRAMS[0], Buffer.alloc(82))
                  : address === vault && exists
                    ? rpcAccount(TOKEN_PROGRAMS[0], Buffer.alloc(165))
                    : null,
            ),
          });
        if (method !== "getAccountInfo")
          throw new Error("unexpected_rpc_method");
        const address = String(params[0]);
        return schema.parse({
          context: { slot: 100 },
          value:
            address === ledger
              ? rpcAccount(programId, ledgerData)
              : address === mint
                ? rpcAccount(TOKEN_PROGRAMS[0], Buffer.alloc(82))
                : null,
        });
      };
      const reconciler = new AccountReconciler({
        pool: database.pool,
        rpc: { request },
        programId,
        deckChunkBytes: 160,
        metrics: { indexerDeckDrift: { set: vi.fn() } as never },
        alert: async () => undefined,
      });
      // A future closure must not supply the timestamp for this account snapshot.
      for (const [signature, slot, time] of [
        ["closed-at-80", 80, 80],
        ["closed-at-150", 150, 150],
      ] as const) {
        await database.pool.query(
          "INSERT INTO chain_txs(signature,slot,tx_index,block_time,commitment,truncated) VALUES($1,$2,0,to_timestamp($3),'confirmed',false)",
          [signature, slot, time],
        );
        await database.pool.query(
          "INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES($1,$2,0,0,0,'VaultClosed',$3::jsonb)",
          [signature, slot, JSON.stringify({ mint })],
        );
      }
      await reconciler.reconcile([ledger], 100n);
      expect(
        (
          await database.pool.query(
            "SELECT vault,vault_exists,closed_at FROM mint_ledgers WHERE mint=$1",
            [mint],
          )
        ).rows,
      ).toEqual([{ vault, vault_exists: false, closed_at: new Date(80_000) }]);
      await reconciler.reconcile([ledger], 100n);
      expect(
        (
          await database.pool.query(
            "SELECT closed_at FROM mint_ledgers WHERE mint=$1",
            [mint],
          )
        ).rows[0].closed_at,
      ).toEqual(new Date(80_000));
      exists = true;
      await reconciler.reconcile([ledger], 100n);
      expect(
        (
          await database.pool.query(
            "SELECT vault_exists,closed_at FROM mint_ledgers WHERE mint=$1",
            [mint],
          )
        ).rows,
      ).toEqual([{ vault_exists: true, closed_at: null }]);
      exists = false;
      await database.pool.query(
        "DELETE FROM chain_txs WHERE signature='closed-at-80'",
      );
      await reconciler.reconcile([ledger], 100n);
      expect(
        (
          await database.pool.query(
            "SELECT closed_at FROM mint_ledgers WHERE mint=$1",
            [mint],
          )
        ).rows[0].closed_at,
      ).toBeNull();
    });
  },
);
