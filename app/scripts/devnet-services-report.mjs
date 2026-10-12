// Read-only reconciliation of the local service database with finalized devnet.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as sdk from "../packages/sdk/dist/index.js";
import { rpc, pid } from "./devnet-session.mjs";
const require = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { Pool } = require("pg");
const { default: Redis } = createRequire(
  new URL("../packages/service-kit/package.json", import.meta.url),
)("ioredis");
const local = JSON.parse(
  readFileSync("reports/devnet/upgrade1-services-local.json", "utf8"),
);
assert(new URL(local.databaseUrl).hostname === "127.0.0.1");
const db = new Pool({ connectionString: local.databaseUrl });
const redis = new Redis(local.redisUrl);
try {
  const machine = await sdk.fetchMachine(pid, rpc),
    config = await sdk.fetchConfig(pid, rpc);
  const deck = sdk.decodeDeck(
    (await rpc.getAccountInfo(sdk.deckPda(pid)[0])).data,
  );
  const state = (await db.query("SELECT * FROM machine_state WHERE id=1"))
    .rows[0];
  assert(state, "Indexer has no Machine projection");
  const checkedFields = [
    "phase",
    "next_seq",
    "pending_pulls",
    "reserved_dust",
    "power_on_ts",
    "on_air_ts",
    "end_ts",
    "stock_sol",
    "jackpot_sol",
    "burn_sol",
    "team_sol",
    "total_spend",
    "jackpot_tokens",
    "jackpot_cost",
    "burned_total",
  ];
  for (const field of checkedFields)
    assert.equal(
      String(state.machine[field]),
      String(machine[field]),
      `Machine.${field}`,
    );
  for (const field of [
    "admin",
    "keeper",
    "executor",
    "intake_signer",
    "quote_signer",
    "token_mint",
    "snapshot_slot",
    "admin_paused",
    "guardian_paused",
    "disabled_roles",
  ])
    assert.equal(
      String(state.config[field]),
      String(config[field]),
      `Config.${field}`,
    );
  const buckets = (await db.query('SELECT * FROM buckets ORDER BY "index"'))
    .rows;
  assert.equal(
    buckets.length,
    machine.buckets.filter((b) => b.class !== 0).length,
  );
  for (const bucket of buckets)
    for (const field of ["mint", "amount", "cost", "reserved", "cap"])
      assert.equal(
        String(bucket[field]),
        String(machine.buckets[bucket.index][field]),
        `Bucket.${field}`,
      );
  const rows = (
    await db.query("SELECT * FROM deck_entries ORDER BY deck_index")
  ).rows;
  assert.equal(rows.length, deck.entries.length);
  assert.equal(String(state.deck_len), String(deck.entries.length));
  for (const [i, row] of rows.entries())
    for (const field of ["depositor", "mint", "amount", "deposit", "flags"])
      assert.equal(
        String(row[field]),
        String(deck.entries[i][field]),
        `Deck[${i}].${field}`,
      );
  const pulls = (
    await db.query(
      "SELECT seq,address,status,opened_sig,revealed_sig FROM pulls ORDER BY seq",
    )
  ).rows;
  for (const pull of pulls)
    if (["closed", "refunded"].includes(pull.status))
      assert.equal(
        await sdk.fetchPull(
          pid,
          rpc,
          new (await import("@solana/web3.js")).PublicKey(pull.address),
        ),
        null,
      );
  const summary = {
    observedAt: new Date().toISOString(),
    slot: await rpc.getSlot(),
    payerBalance: await rpc.getBalance(
      new (await import("@solana/web3.js")).PublicKey(
        "DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93",
      ),
    ),
    checks: {
      machineFields: checkedFields,
      config: true,
      buckets: buckets.length,
      deck: rows.length,
      pulls: pulls.length,
    },
    pulls,
  };
  for (const table of [
    "chain_txs",
    "chain_events",
    "creator_fee_collections",
    "exec_trades",
    "feeds",
    "intake_consumption",
  ])
    summary[table] = (
      await db.query(`SELECT count(*)::int AS count FROM ${table}`)
    ).rows[0].count;
  const signatures = [];
  const failed = [];
  let before;
  for (;;) {
    const page = await rpc.getSignaturesForAddress(
      pid,
      { limit: 1000, ...(before ? { before } : {}) },
      "finalized",
    );
    signatures.push(
      ...page.filter((row) => row.err === null).map((row) => row.signature),
    );
    failed.push(
      ...page
        .filter((row) => row.err !== null)
        .map(({ signature, slot, err }) => ({ signature, slot, err })),
    );
    if (page.length < 1000) break;
    before = page.at(-1).signature;
  }
  const stored = (await db.query("SELECT signature FROM chain_txs")).rows.map(
    (row) => row.signature,
  );
  assert(signatures.length > 0);
  assert.deepEqual(
    stored.sort(),
    signatures.sort(),
    "Full finalized transaction history",
  );
  summary.history = {
    expectedSuccessful: signatures.length,
    stored: stored.length,
    failedExcluded: failed,
    complete: true,
  };
  summary.indexerStatus = JSON.parse(await redis.get("onepct:indexer:status"));
  assert(
    summary.indexerStatus?.scanSlot && !summary.indexerStatus.reason,
    "Indexer must have completed a successful poll",
  );
  assert(
    Date.now() - Date.parse(summary.indexerStatus.checkedAt) < 60000,
    "Indexer proof must be fresh",
  );
  summary.quarantined = (
    await db.query("SELECT signature,slot,err FROM chain_txs WHERE truncated")
  ).rows;
  summary.events = (
    await db.query(
      "SELECT name,count(*)::int AS count FROM chain_events GROUP BY name ORDER BY name",
    )
  ).rows;
  summary.keeper = (
    await db.query(
      "SELECT id,kind,status,signature,last_error FROM keeper_jobs ORDER BY id",
    )
  ).rows;
  summary.executor = (
    await db.query(
      "SELECT id,kind,status,attempts FROM executor_jobs ORDER BY created_at",
    )
  ).rows;
  summary.executorDecisions = readFileSync(
    "reports/devnet/upgrade1-executor-live.log",
    "utf8",
  )
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((row) => row.msg === "executor decision")
    .map(({ time, kind, reason }) => ({ time, kind, reason }));
  for (const kind of ["burn", "jackpot"])
    assert(
      summary.executorDecisions.some(
        (row) => row.kind === kind && row.reason === "BelowMinimumTranche",
      ),
      `Missing real ${kind} policy decision`,
    );
  summary.alerts = (
    await db.query("SELECT key,severity,count,payload FROM alerts ORDER BY key")
  ).rows;
  summary.status = summary.quarantined.length
    ? "RECONCILED_WITH_HISTORY_GAPS"
    : "PASS";
  writeFileSync(
    "reports/devnet/upgrade1-services.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
} finally {
  await db.end();
  await redis.quit();
}
