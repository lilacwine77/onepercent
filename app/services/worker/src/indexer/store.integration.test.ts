import { createHash, randomUUID } from "node:crypto";
import {
  applyMigrations,
  createDatabase,
  type JsonObject,
} from "@onepercent/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { IndexerStore, type IndexedTransaction } from "./store.js";
import { MIRROR_TABLES } from "./projections.js";
import { feedProofFixture } from "./feed-proof.test-data.mjs";

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
function encoded(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let value = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    value = alphabet[Number(n % 58n)] + value;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b) break;
    value = "1" + value;
  }
  return value;
}
function transaction(
  signature: string,
  slot: bigint,
  data: [string, JsonObject][],
  txIndex = 0n,
): IndexedTransaction {
  const buy = Buffer.alloc(14);
  Buffer.from([136, 30, 10, 209, 228, 139, 105, 138]).copy(buy);
  buy.writeUInt32LE(73, 10);
  return {
    signature,
    slot,
    txIndex,
    blockTime: 10 + Number(slot),
    err: null,
    truncated: false,
    accountKeys: [],
    instructions: [{ programId: "program", data: encoded(buy), accounts: [] }],
    events: data.map(([name, value], i) => ({
      name,
      data: value,
      ixIndex: 0n,
      eventIndex: BigInt(i),
    })),
  };
}
const feed = (
  wallet: string,
  mint: string,
  index: number,
): [string, JsonObject] => [
  "BagFed",
  {
    depositor: wallet,
    mint,
    amount: "18446744073709551615",
    deck_index: index,
    deposit: "55",
    fresh_in_deck: 1,
  },
];
const take = (
  wallet: string,
  mint: string,
  index: number,
  moved: number,
): [string, JsonObject] => [
  "BagTakenBack",
  {
    depositor: wallet,
    mint,
    amount: "18446744073709551615",
    deck_index: index,
    moved_from: moved,
    refund: "55",
  },
];

describe.skipIf(!enabled)(
  "indexer Postgres 17 projections (services CI)",
  () => {
    let admin: ReturnType<typeof createDatabase>;
    let database: ReturnType<typeof createDatabase>;
    let store: IndexerStore;
    const name = `onepct_indexer_${randomUUID().replaceAll("-", "")}`;
    const alert = vi.fn().mockResolvedValue(undefined);
    beforeAll(async () => {
      admin = createDatabase({ connectionString: databaseUrl });
      await admin.pool.query(`CREATE DATABASE "${name}"`);
      const isolated = new URL(databaseUrl!);
      isolated.pathname = `/${name}`;
      database = createDatabase({ connectionString: isolated.href });
      await applyMigrations(database.pool);
      // Only this disposable test database may reset the append-only signer log.
      await database.pool.query(
        "ALTER TABLE attestation_log DISABLE TRIGGER attestation_log_insert_only",
      );
    }, 30_000);
    beforeEach(async () => {
      await database.pool.query(
        `TRUNCATE ${MIRROR_TABLES.join(",")},chain_txs,attestation_log CASCADE`,
      );
      await database.pool.query("DELETE FROM cursors");
      alert.mockClear();
      store = new IndexerStore(database.pool, {
        programId: "program",
        royaltyPerDustCardBps: 137,
        alert,
        recomputeProvenance: async () => ({ path: "hop", via: "original" }),
      });
    });
    afterAll(async () => {
      await database?.close();
      if (admin) {
        await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.close();
      }
    });

    it("replays season fees identically, retains finalized Block-0 evidence and removes a forked launch", async () => {
      const fees: [string, JsonObject] = [
        "CreatorFeesCollected",
        {
          regime: 1,
          amount: "21",
          from_fee_in: "21",
          from_wsol: "0",
          to_stock: "11",
          to_burn: "0",
          to_team: "10",
          book: "2000000000",
          target: "30000000000",
          ts: "100",
        },
      ];
      await store.apply(
        transaction("season-launch", 100n, [
          [
            "PoweredOn",
            { mint: "mint", launch_pool: "pool", dev_buy: "40000000000000" },
          ],
          fees,
          fees,
        ]),
      );
      await database.pool.query(
        "INSERT INTO block0_buys(signature,owner,launch_signature,slot,tokens,lamports_spent,team,role) VALUES('external-buy','owner','season-launch',101,18446744073709551615,NULL,false,NULL)",
      );
      await database.pool.query(
        "UPDATE season_launches SET status='ready',as_of_slot=153 WHERE signature='season-launch'",
      );
      const snapshot = async () =>
        Promise.all(
          ["creator_fee_collections", "season_launches", "block0_buys"].map(
            async (table) =>
              (
                await database.pool.query(
                  `SELECT to_jsonb(t)::text AS value FROM ${table} t ORDER BY to_jsonb(t)::text`,
                )
              ).rows,
          ),
        );
      const first = await snapshot();
      expect(first[0]).toHaveLength(2);
      await store.replay(100n);
      expect(await snapshot()).toEqual(first);
      await store.replay(100n);
      expect(await snapshot()).toEqual(first);
      await store.rollback("season-launch");
      expect(await snapshot()).toEqual([[], [], []]);
    });
    it("requeues a Block-0 notification when its observation slot forks after a finalized launch", async () => {
      await store.apply(
        transaction("final-launch", 100n, [
          [
            "PoweredOn",
            {
              mint: "mint",
              launch_pool: "pool",
              dev_buy: "40000000000000",
            },
          ],
        ]),
      );
      await store.finalize("final-launch");
      await store.apply(transaction("forked-later", 150n, []));
      await database.pool.query(
        "UPDATE season_launches SET status='ready',as_of_slot=153 WHERE signature='final-launch'",
      );
      await database.pool.query(
        "INSERT INTO block0_buys(signature,owner,launch_signature,slot,tokens,lamports_spent,team,role) VALUES('finalized-buy','owner','final-launch',101,42,NULL,false,NULL)",
      );
      await database.pool.query(
        "INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES('final-launch',153,4294967295,-1,4294967295,'IndexerBlock0Ready','{}')",
      );
      await store.rollback("forked-later");
      expect(
        (
          await database.pool.query(
            "SELECT status,as_of_slot FROM season_launches",
          )
        ).rows,
      ).toEqual([{ status: "pending", as_of_slot: "100" }]);
      expect(
        (await database.pool.query("SELECT tokens FROM block0_buys")).rows,
      ).toEqual([{ tokens: "42" }]);
      expect(
        (
          await database.pool.query(
            "SELECT signature FROM chain_events WHERE name='IndexerBlock0Ready'",
          )
        ).rows,
      ).toEqual([]);
      await store.apply(transaction("replacement", 150n, []));
      expect(await store.lastAppliedSlot()).toBe(150n);
    });
    const hash = async () => {
      const results: Record<string, string> = {};
      const client = await database.pool.connect();
      try {
        await client.query("SET TIME ZONE 'UTC'");
        for (const table of MIRROR_TABLES) {
          const rows = await client.query(
            `SELECT to_jsonb(t)::text AS data FROM ${table} t ORDER BY to_jsonb(t)::text`,
          );
          results[table] = createHash("sha256")
            .update(JSON.stringify(rows.rows))
            .digest("hex");
        }
      } finally {
        client.release();
      }
      return results;
    };
    it("commits raw events/mirrors atomically, preserves u64, ignores duplicate and failed transactions", async () => {
      const tx = transaction("feed", 1n, [feed("first", "mint", 0)]);
      expect(await store.apply(tx)).toBe(true);
      expect(await store.apply(tx)).toBe(false);
      expect(
        (await database.pool.query("SELECT amount FROM deck_entries")).rows[0]
          ?.amount,
      ).toBe("18446744073709551615");
      const failed = transaction("failed", 2n, [feed("second", "mint2", 1)]);
      failed.err = { InstructionError: [0, "Custom"] };
      expect(await store.apply(failed)).toBe(false);
      expect(
        (await database.pool.query("SELECT * FROM chain_txs")).rows,
      ).toHaveLength(1);
      const invalid = transaction("invalid", 2n, [
        feed("first", "another", 1),
        ["SoldBack", { amount: "bad" }],
      ]);
      await expect(store.apply(invalid)).rejects.toThrow(
        "invalid_event_integer",
      );
      expect(
        (await database.pool.query("SELECT * FROM chain_txs")).rows,
      ).toHaveLength(1);
      expect(
        (await database.pool.query("SELECT * FROM deck_entries")).rows,
      ).toHaveLength(1);
    });
    it("first landed provenance wins in canonical slot order and take-back does not release it", async () => {
      await store.apply(
        transaction("first", 1n, [feed("first", "mint", 0)], 0n),
      );
      await store.apply(
        transaction("second", 1n, [feed("second", "mint", 1)], 1n),
      );
      await store.apply(transaction("take", 2n, [take("first", "mint", 0, 1)]));
      expect(
        (
          await database.pool.query(
            "SELECT holder,used_by,first_feed_sig FROM intake_consumption",
          )
        ).rows,
      ).toEqual([
        { holder: "original", used_by: "first", first_feed_sig: "first" },
      ]);
      expect(
        (
          await database.pool.query(
            "SELECT depositor,deck_index FROM deck_entries",
          )
        ).rows,
      ).toEqual([{ depositor: "second", deck_index: "0" }]);
      await expect(
        store.apply(
          transaction("out-of-order", 1n, [feed("third", "other", 1)], 0n),
        ),
      ).rejects.toThrow("indexer_out_of_order");
    });
    it("replays twice to identical hashes for every mirror and retains earlier-slot baseline", async () => {
      await store.apply(
        transaction(
          "feeds",
          1n,
          Array.from({ length: 4 }, (_, i) => feed("first", `mint${i}`, i)),
        ),
      );
      await store.apply(
        transaction("open", 2n, [
          [
            "PullOpened",
            {
              pull: "pull",
              seq: "1",
              buyer: "buyer",
              edition: 0,
              qty: 1,
              price: "10000",
              referrer: "11111111111111111111111111111111",
              holder: false,
              created_ts: "12",
            },
          ],
        ]),
      );
      const dust = Array.from({ length: 4 }, (_, i) => ({
        deck_len_before: 4 - i,
        index: 0,
        moved_from: i === 3 ? 4294967295 : 3 - i,
        mint: `mint${i === 0 ? 0 : 4 - i}`,
        amount: "18446744073709551615",
        depositor: "first",
        refund: "55",
      }));
      await store.apply(
        transaction("reveal", 3n, [
          [
            "PackRevealed",
            {
              seq: "1",
              pack: 0,
              edition: 0,
              live_flags: 7,
              holder: false,
              t: 53,
              widths: [1, 2, 3, 4, 5, 6],
              tier: 1,
              hit_bucket: 0,
              house_mask: 0,
              hit_mint: "hit",
              hit_amount: "7",
              hit_value: "8",
              dust,
            },
          ],
          ["PullRevealed", { seq: "1", randomness: Array(32).fill(2) }],
        ]),
      );
      await store.apply(
        transaction("settle", 4n, [
          [
            "PackSettled",
            {
              seq: "1",
              pack: 0,
              paid: ["192", "191", "192", "192"],
              redirected_mask: 2,
            },
          ],
          ["PullClosed", { seq: "1" }],
        ]),
      );
      await store.apply(
        transaction("m2-events", 5n, [
          [
            "CardFedBack",
            {
              owner: "first",
              mint: "refed",
              amount: "9",
              deck_index: 0,
              deposit: "55",
            },
          ],
          [
            "SoldBack",
            {
              owner: "first",
              mint: "hit",
              bucket: 0,
              n: 1,
              total_amount: "7",
              stocked_value: "8",
              quote_lamports: "8",
              value: "8",
              payout: "6",
              to_team: "2",
              nonce: 1,
              sb_paid_hour: "6",
              slot_refund: "0",
            },
          ],
          [
            "ExecBegun",
            {
              kind: 0,
              bucket: 0,
              mint: "hit",
              signer: "keeper",
              amount: "10",
              min_out: "9",
              v0: "0",
              book: "0",
              expected: "9",
              ts: "15",
            },
          ],
          [
            "ExecEnded",
            {
              kind: 0,
              bucket: 0,
              mint: "hit",
              amount: "10",
              min_out: "9",
              delta: "10",
              book: "0",
              tracked_after: "10",
              ts: "15",
            },
          ],
          [
            "PoweredOn",
            { mint: "mint", launch_pool: "pool", dev_buy: "40000000000000" },
          ],
          [
            "CreatorFeesCollected",
            {
              regime: 1,
              amount: "21",
              from_fee_in: "21",
              from_wsol: "0",
              to_stock: "11",
              to_burn: "0",
              to_team: "10",
              book: "2000000000",
              target: "30000000000",
              ts: "15",
            },
          ],
        ]),
      );
      // Block-0 buys are finalized external DBC history that replay retains.
      await database.pool.query(
        "INSERT INTO block0_buys(signature,owner,launch_signature,slot,tokens,lamports_spent,team,role) VALUES('external-buy','owner','m2-events',6,42,NULL,false,NULL)",
      );
      // Account-owned mirrors are restored by the final reconcile after production replay.
      const restoreAccountSnapshots = async () => {
        await database.pool.query(
          "INSERT INTO mint_ledgers(mint,ledger,payer,accounted,vault,token_program,vault_exists) VALUES($1,$2,$3,$4,$5,$6,true)",
          ["hit", "ledger", "payer", "10", "vault", "token"],
        );
        await database.pool.query(
          'INSERT INTO buckets("index",mint,class,enabled,amount,cost,reserved,cap,listed_slot) VALUES(0,$1,$2,true,10,9,0,20,1) ON CONFLICT("index") DO UPDATE SET mint=EXCLUDED.mint,class=EXCLUDED.class,enabled=EXCLUDED.enabled,amount=EXCLUDED.amount,cost=EXCLUDED.cost,reserved=EXCLUDED.reserved,cap=EXCLUDED.cap,listed_slot=EXCLUDED.listed_slot',
          ["hit", "major"],
        );
        await database.pool.query(
          "INSERT INTO machine_state(id,slot,machine,config,deck_len) VALUES(1,5,$1,$2,1)",
          [JSON.stringify({ phase: 1 }), JSON.stringify({ version: 1 })],
        );
      };
      await restoreAccountSnapshots();
      for (const table of MIRROR_TABLES)
        expect(
          (await database.pool.query(`SELECT count(*) FROM ${table}`)).rows[0]
            ?.count,
        ).not.toBe("0");
      const before = await hash();
      await store.replay(3n);
      await restoreAccountSnapshots();
      expect(await hash()).toEqual(before);
      await store.replay(3n);
      await restoreAccountSnapshots();
      expect(await hash()).toEqual(before);
      console.info("S1_REPLAY_HASHES canonical", JSON.stringify(before));
      expect(
        (
          await database.pool.query(
            "SELECT buyer_nonce,status,settled_mask FROM pulls",
          )
        ).rows[0],
      ).toEqual({ buyer_nonce: "73", status: "closed", settled_mask: 1 });
      expect(
        (await database.pool.query("SELECT fresh_mask FROM packs")).rows[0]
          ?.fresh_mask,
      ).toBe(15);
      expect(
        (
          await database.pool.query(
            "SELECT amount,paid,redirected FROM royalties ORDER BY k",
          )
        ).rows[1],
      ).toEqual({ amount: "137", paid: "191", redirected: true });
    });
    it("rewinds before an orphan slot, rebuilds first-feed consumption, then accepts replacement order", async () => {
      await store.apply(
        transaction("stable", 1n, [feed("first", "stable", 0)]),
      );
      await store.finalize("stable");
      await store.apply(transaction("orphan", 2n, [feed("first", "mint", 1)]));
      await store.apply(transaction("later", 3n, [feed("second", "mint", 2)]));
      await store.advanceCursor("later", 3n);
      await store.rollback("orphan");
      expect(await store.cursor()).toEqual({
        lastSignature: "stable",
        lastSlot: 1n,
      });
      expect(
        (
          await database.pool.query(
            "SELECT * FROM intake_consumption WHERE mint='mint'",
          )
        ).rows,
      ).toHaveLength(0);
      await store.apply(
        transaction("replacement", 2n, [feed("second", "mint", 1)]),
      );
      expect(
        (
          await database.pool.query(
            "SELECT used_by FROM intake_consumption WHERE mint='mint'",
          )
        ).rows[0]?.used_by,
      ).toBe("second");
      expect(alert).toHaveBeenCalledWith("fork_rollback", {
        signature: "orphan",
      });
    });
    it("preserves keeper-owned failing flags through replay and fork rollback", async () => {
      await store.apply(transaction("stable", 1n, [feed("first", "base", 0)]));
      await store.finalize("stable");
      await database.pool.query(
        'INSERT INTO buckets("index",mint,class,enabled,amount,cost,reserved,cap,listed_slot,failing) VALUES(0,$1,$2,true,10,9,0,20,1,true)',
        ["hit", "major"],
      );
      await store.replay(0n);
      expect(
        (await database.pool.query("SELECT mint,failing FROM buckets")).rows,
      ).toEqual([{ mint: "hit", failing: true }]);
      await store.apply(transaction("orphan", 2n, [feed("second", "mint", 1)]));
      await store.rollback("orphan");
      expect(
        (await database.pool.query("SELECT mint,failing FROM buckets")).rows,
      ).toEqual([{ mint: "hit", failing: true }]);
    });
    it("preserves a finalized canonical sibling when an orphan shares its slot", async () => {
      await store.apply(transaction("base", 1n, [feed("first", "base", 0)]));
      await store.finalize("base");
      await store.apply(
        transaction("canonical", 2n, [feed("first", "stable", 1)], 0n),
      );
      await store.finalize("canonical");
      await store.apply(
        transaction("orphan", 2n, [feed("first", "mint", 2)], 1n),
      );
      await store.rollback("orphan");
      expect(await store.cursor()).toEqual({
        lastSignature: "base",
        lastSlot: 1n,
      });
      expect(
        await store.apply(
          transaction("canonical", 2n, [feed("first", "stable", 1)], 0n),
        ),
      ).toBe(false);
      await store.apply(
        transaction("replacement", 2n, [feed("second", "mint", 2)], 1n),
      );
      expect(
        (
          await database.pool.query(
            "SELECT commitment FROM chain_txs WHERE signature='canonical'",
          )
        ).rows[0]?.commitment,
      ).toBe("finalized");
      expect(
        (await database.pool.query("SELECT count(*) FROM deck_entries")).rows[0]
          ?.count,
      ).toBe("3");
    });
    it("persists incomplete history without fabricating a Pull and requests reconcile", async () => {
      const tx = transaction("partial", 1n, [
        [
          "PackRevealed",
          {
            seq: "2",
            pack: 0,
            house_mask: 0,
            dust: [{ index: 0, moved_from: 4294967295 }],
          },
        ],
      ]);
      await store.apply(tx);
      expect(tx.truncated).toBe(true);
      expect(
        (await database.pool.query("SELECT truncated FROM chain_txs")).rows[0]
          ?.truncated,
      ).toBe(true);
      expect(
        (await database.pool.query("SELECT * FROM pulls")).rows,
      ).toHaveLength(0);
      expect(alert).toHaveBeenCalledWith(
        "indexer_projection_incomplete",
        expect.objectContaining({ signature: "partial" }),
      );
      await store.replay(0n);
    });
    it("replay retains a recoverable diagnostic when an earlier projection depended on account-only history", async () => {
      await database.pool.query(
        "INSERT INTO pulls(seq,address,buyer,buyer_nonce,edition,qty,price,holder,status,created_ts,opened_sig,live_flags,settled_mask) VALUES(7,'pull7','buyer',0,0,1,10000,false,'revealed',to_timestamp(1),'account-origin',0,0)",
      );
      const dust = Array.from({ length: 4 }, () => ({
        deck_len_before: 0,
        index: 4294967295,
        moved_from: 4294967295,
        mint: "11111111111111111111111111111111",
        amount: "0",
        depositor: "11111111111111111111111111111111",
        refund: "0",
      }));
      await store.apply(
        transaction("account-dependent", 8n, [
          [
            "PackRevealed",
            {
              seq: "7",
              pack: 0,
              edition: 0,
              live_flags: 0,
              holder: false,
              t: 1,
              widths: [1, 2, 3, 4, 5, 6],
              tier: 0,
              hit_bucket: 255,
              house_mask: 15,
              hit_mint: "11111111111111111111111111111111",
              hit_amount: "0",
              hit_value: "0",
              dust,
            },
          ],
        ]),
      );
      expect(
        (await database.pool.query("SELECT * FROM packs")).rows,
      ).toHaveLength(1);
      await store.replay(0n);
      await store.replay(0n);
      expect(
        (
          await database.pool.query(
            "SELECT data FROM chain_events WHERE signature='account-dependent'",
          )
        ).rows[0]?.data._indexer.incompleteReason,
      ).toBe("pack_pull_missing");
      expect(
        (
          await database.pool.query(
            "SELECT truncated FROM chain_txs WHERE signature='account-dependent'",
          )
        ).rows[0]?.truncated,
      ).toBe(true);
    });
    it("stores unknown provenance when no signer log or historical evidence is available", async () => {
      store = new IndexerStore(database.pool, {
        programId: "program",
        royaltyPerDustCardBps: 137,
        alert,
      });
      await store.apply(transaction("unknown", 1n, [feed("first", "mint", 0)]));
      expect(
        (
          await database.pool.query(
            "SELECT holder,path FROM intake_consumption",
          )
        ).rows[0],
      ).toEqual({ holder: "first", path: "unknown" });
      expect(alert).toHaveBeenCalledWith(
        "intake_log_missing",
        expect.objectContaining({ path: "unknown" }),
      );
    });
    it("durably recovers a truncated Feed with no live bag through rotation, replay and fork rollback", async () => {
      const fixture = feedProofFixture();
      const getIntakeSigner = vi
        .fn()
        .mockResolvedValue(fixture.options.intakeSigner);
      store = new IndexerStore(database.pool, {
        programId: fixture.options.programId,
        royaltyPerDustCardBps: 137,
        getIntakeSigner,
        alert,
      });
      const messageHash = createHash("sha256")
        .update(fixture.message)
        .digest("hex");
      await database.pool.query(
        "INSERT INTO attestation_log(message_sha256,kind,wallet,nonce,expiry,bags,signer,ip_hash) VALUES($1,'FEED',$2,$3,$4,$5::jsonb,$6,'test')",
        [
          messageHash,
          fixture.owner,
          String(fixture.nonce),
          new Date(Number(fixture.expiry) * 1000),
          JSON.stringify([
            {
              mint: fixture.mints[0],
              amount: String(fixture.amounts[0]),
              path: "hop",
              via: "original",
            },
          ]),
          fixture.signer,
        ],
      );
      expect(await store.apply(fixture.tx)).toBe(true);
      expect(
        (
          await database.pool.query(
            "SELECT holder,mint,used_by,path,first_feed_sig,slot FROM intake_consumption",
          )
        ).rows,
      ).toEqual([
        {
          holder: "original",
          mint: fixture.mints[0],
          used_by: fixture.owner,
          path: "hop",
          first_feed_sig: fixture.tx.signature,
          slot: String(fixture.tx.slot),
        },
      ]);
      const evidence = await database.pool.query(
        "SELECT name,event_index,data FROM chain_events WHERE signature=$1",
        [fixture.tx.signature],
      );
      expect(evidence.rows).toHaveLength(1);
      expect(evidence.rows[0]).toMatchObject({
        name: "IndexerFeedRecovered",
        event_index: "-1",
        data: {
          _indexer: {
            evidence: "incomplete",
            attestationSha256: messageHash,
            signer: fixture.signer,
            intakeLogMissing: false,
          },
        },
      });
      expect(evidence.rows[0]?.data).not.toHaveProperty("deck_index");
      for (const table of ["feeds", "deck_entries"])
        expect(
          (await database.pool.query(`SELECT * FROM ${table}`)).rows,
        ).toHaveLength(0);
      expect(getIntakeSigner).not.toHaveBeenCalled();
      getIntakeSigner.mockRejectedValue(new Error("intake_signer_rotated"));
      expect(await store.apply(fixture.tx)).toBe(false);
      expect(getIntakeSigner).not.toHaveBeenCalled();
      const beforeReplay = await hash();
      await store.replay(0n);
      expect(await hash()).toEqual(beforeReplay);
      await store.replay(0n);
      expect(await hash()).toEqual(beforeReplay);
      console.info("S1_REPLAY_HASHES recovered", JSON.stringify(beforeReplay));
      expect(
        (
          await database.pool.query(
            "SELECT name,event_index,data FROM chain_events WHERE signature=$1",
            [fixture.tx.signature],
          )
        ).rows,
      ).toEqual(evidence.rows);
      await store.rollback(fixture.tx.signature);
      expect(
        (await database.pool.query("SELECT * FROM intake_consumption")).rows,
      ).toHaveLength(0);
      expect(
        (await database.pool.query("SELECT * FROM chain_events")).rows,
      ).toHaveLength(0);
      expect(
        (await database.pool.query("SELECT * FROM attestation_log")).rows,
      ).toHaveLength(1);
    });
    it("backfills a retained truncated transaction and restores first-feed precedence before a later Feed", async () => {
      const fixture = feedProofFixture();
      const getIntakeSigner = vi
        .fn()
        .mockResolvedValue(fixture.options.intakeSigner);
      store = new IndexerStore(database.pool, {
        programId: fixture.options.programId,
        royaltyPerDustCardBps: 137,
        getIntakeSigner,
        alert,
        recomputeProvenance: async () => ({ path: "hop", via: "original" }),
      });
      // Model an earlier indexer version retaining the transaction without its missing log.
      await database.pool.query(
        "INSERT INTO chain_txs(signature,slot,tx_index,block_time,commitment,err,truncated) VALUES($1,$2,$3,$4,'confirmed',NULL,true)",
        [
          fixture.tx.signature,
          String(fixture.tx.slot),
          String(fixture.tx.txIndex),
          new Date(fixture.tx.blockTime! * 1000),
        ],
      );
      await store.apply(
        transaction("later-feed", 11n, [feed("second", fixture.mints[0]!, 0)]),
      );
      expect(
        (
          await database.pool.query(
            "SELECT used_by,first_feed_sig FROM intake_consumption",
          )
        ).rows,
      ).toEqual([{ used_by: "second", first_feed_sig: "later-feed" }]);
      expect(await store.apply(fixture.tx)).toBe(false);
      expect(
        (
          await database.pool.query(
            "SELECT holder,used_by,first_feed_sig,slot FROM intake_consumption",
          )
        ).rows,
      ).toEqual([
        {
          holder: "original",
          used_by: fixture.owner,
          first_feed_sig: fixture.tx.signature,
          slot: String(fixture.tx.slot),
        },
      ]);
      expect(
        (
          await database.pool.query(
            "SELECT data FROM chain_events WHERE name='IndexerFeedRecovered'",
          )
        ).rows[0]?.data._indexer,
      ).toMatchObject({ intakeLogMissing: true, path: "hop" });
      expect(
        (await database.pool.query("SELECT signature FROM feeds")).rows,
      ).toEqual([{ signature: "later-feed" }]);
      expect(
        (await database.pool.query("SELECT depositor FROM deck_entries")).rows,
      ).toEqual([{ depositor: "second" }]);
      const repaired = await hash();
      getIntakeSigner.mockRejectedValue(new Error("intake_signer_rotated"));
      expect(await store.apply(fixture.tx)).toBe(false);
      expect(getIntakeSigner).not.toHaveBeenCalled();
      await store.replay(0n);
      expect(await hash()).toEqual(repaired);
      await store.replay(0n);
      expect(await hash()).toEqual(repaired);
      console.info("S1_REPLAY_HASHES repaired", JSON.stringify(repaired));
    });
  },
);
