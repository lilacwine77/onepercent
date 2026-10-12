import { getTableColumns, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type PgColumn,
} from "drizzle-orm/pg-core";
import { attestationBagsJson, objectJson, u64, valueJson } from "./types.js";

const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const position = (name: string) => bigint(name, { mode: "bigint" });
const orderKey = () => ({
  slot: position("slot").notNull(),
  txIndex: position("tx_index").notNull(),
  ixIndex: position("ix_index").notNull(),
  eventIndex: position("event_index").notNull(),
});

// SQL protects the same representation bounds as the TS adapter, including SQL clients.
function amountChecks(columns: Record<string, PgColumn>) {
  const first = Object.values(columns)[0];
  if (!first) return [];
  return Object.values(getTableColumns(first.table)).flatMap((column) => {
    if (column.getSQLType() === "numeric(20,0)") {
      return [
        check(
          `${column.name}_u64`,
          sql`${column} >= 0 AND ${column} <= 18446744073709551615`,
        ),
      ];
    }
    if (column.getSQLType() === "numeric(20,0)[]") {
      return [
        check(
          `${column.name}_u64`,
          sql`0 <= ALL(${column}) AND 18446744073709551615 >= ALL(${column})`,
        ),
      ];
    }
    return [];
  });
}

export const chainTxs = pgTable(
  "chain_txs",
  {
    signature: text("signature").primaryKey(),
    slot: position("slot").notNull(),
    blockTime: time("block_time"),
    txIndex: position("tx_index").notNull(),
    commitment: text("commitment", {
      enum: ["confirmed", "finalized"],
    }).notNull(),
    err: valueJson("err"),
    truncated: boolean("truncated").notNull().default(false),
  },
  (table) => [
    check(
      "commitment_valid",
      sql`${table.commitment} IN ('confirmed', 'finalized')`,
    ),
    index("chain_txs_order_idx").on(table.slot, table.txIndex),
    index("chain_txs_finality_idx").on(table.commitment, table.slot),
  ],
);

export const chainEvents = pgTable(
  "chain_events",
  {
    signature: text("signature")
      .notNull()
      .references(() => chainTxs.signature, { onDelete: "cascade" }),
    ...orderKey(),
    name: text("name").notNull(),
    data: objectJson("data").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.signature, table.ixIndex, table.eventIndex] }),
    index("chain_events_order_idx").on(
      table.slot,
      table.txIndex,
      table.ixIndex,
      table.eventIndex,
    ),
    index("chain_events_name_idx").on(table.name, table.slot),
  ],
);

export const cursors = pgTable("cursors", {
  name: text("name").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: position("last_slot").notNull(),
});

export const pulls = pgTable(
  "pulls",
  {
    seq: u64("seq").primaryKey(),
    address: text("address").notNull(),
    buyer: text("buyer").notNull(),
    buyerNonce: position("buyer_nonce").notNull(),
    edition: integer("edition").notNull(),
    qty: integer("qty").notNull(),
    price: u64("price").notNull(),
    referrer: text("referrer"),
    holder: boolean("holder").notNull(),
    status: text("status", {
      enum: ["pending", "revealed", "closed", "refunded"],
    }).notNull(),
    createdTs: time("created_ts").notNull(),
    openedSig: text("opened_sig").notNull(),
    revealedSig: text("revealed_sig"),
    revealedSlot: position("revealed_slot"),
    revealOrder: position("reveal_order"),
    liveFlags: integer("live_flags").notNull(),
    randomness: text("randomness"),
    settledMask: integer("settled_mask").notNull(),
  },
  (table) => [
    ...amountChecks(table),
    check(
      "pull_status_valid",
      sql`${table.status} IN ('pending', 'revealed', 'closed', 'refunded')`,
    ),
    index("pulls_address_idx").on(table.address),
    index("pulls_buyer_idx").on(table.buyer, table.seq),
    index("pulls_status_idx").on(table.status, table.createdTs),
    index("pulls_reveal_idx").on(table.revealedSlot, table.revealOrder),
  ],
);

export const packs = pgTable(
  "packs",
  {
    seq: u64("seq")
      .notNull()
      .references(() => pulls.seq, { onDelete: "cascade" }),
    pack: integer("pack").notNull(),
    t: position("t").notNull(),
    widths: integer("widths").array().notNull(),
    tier: integer("tier").notNull(),
    hitBucket: integer("hit_bucket").notNull(),
    hitMint: text("hit_mint").notNull(),
    hitAmount: u64("hit_amount").notNull(),
    hitValue: u64("hit_value").notNull(),
    houseMask: integer("house_mask").notNull(),
    freshMask: integer("fresh_mask").notNull(),
    liveFlags: integer("live_flags"),
  },
  (table) => [
    ...amountChecks(table),
    primaryKey({ columns: [table.seq, table.pack] }),
    check("widths_six", sql`cardinality(${table.widths}) = 6`),
  ],
);

// Season mirrors are append-only schema additions. Operational executor records
// are independent from the canonical exec_trades event mirror.
export const creatorFeeCollections = pgTable(
  "creator_fee_collections",
  {
    signature: text("signature")
      .notNull()
      .references(() => chainTxs.signature, { onDelete: "cascade" }),
    ...orderKey(),
    regime: text("regime", {
      enum: ["belowFloor", "season", "afterEnd"],
    }).notNull(),
    amount: u64("amount").notNull(),
    fromFeeIn: u64("from_fee_in").notNull(),
    fromWsol: u64("from_wsol").notNull(),
    toStock: u64("to_stock").notNull(),
    toBurn: u64("to_burn").notNull(),
    toTeam: u64("to_team").notNull(),
    book: u64("book").notNull(),
    target: u64("target").notNull(),
    ts: time("ts").notNull(),
  },
  (table) => [
    ...amountChecks(table),
    primaryKey({ columns: [table.signature, table.eventIndex] }),
    check(
      "creator_fee_regime_valid",
      sql`${table.regime} IN ('belowFloor','season','afterEnd')`,
    ),
    index("creator_fee_collections_order_idx").on(
      table.slot,
      table.txIndex,
      table.ixIndex,
      table.eventIndex,
    ),
  ],
);

export const seasonLaunches = pgTable(
  "season_launches",
  {
    signature: text("signature")
      .primaryKey()
      .references(() => chainTxs.signature, { onDelete: "cascade" }),
    slot: position("slot").notNull(),
    mint: text("mint").notNull(),
    launchPool: text("launch_pool").notNull(),
    devBuyTokens: u64("dev_buy_tokens").notNull(),
    status: text("status", { enum: ["pending", "ready"] })
      .notNull()
      .default("pending"),
    asOfSlot: position("as_of_slot").notNull(),
  },
  (table) => [
    ...amountChecks(table),
    check(
      "season_launch_status_valid",
      sql`${table.status} IN ('pending','ready')`,
    ),
  ],
);

export const block0Buys = pgTable(
  "block0_buys",
  {
    signature: text("signature").notNull(),
    owner: text("owner").notNull(),
    launchSignature: text("launch_signature")
      .notNull()
      .references(() => seasonLaunches.signature, { onDelete: "cascade" }),
    slot: position("slot").notNull(),
    tokens: u64("tokens").notNull(),
    lamportsSpent: u64("lamports_spent"),
    team: boolean("team").notNull(),
    role: text("role"),
  },
  (table) => [
    ...amountChecks(table),
    primaryKey({ columns: [table.signature, table.owner] }),
    index("block0_buys_launch_idx").on(table.launchSignature, table.slot),
  ],
);

export const executorTrades = pgTable(
  "executor_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signature: text("signature"),
    kind: text("kind").notNull(),
    amount: u64("amount").notNull(),
    minOut: u64("min_out").notNull(),
    jupiterOut: u64("jupiter_out"),
    delta: u64("delta"),
    slippageBps: integer("slippage_bps"),
    status: text("status", {
      enum: ["planned", "simulated", "sent", "confirmed", "failed", "skipped"],
    }).notNull(),
    lastError: text("last_error"),
    createdAt: time("created_at").notNull().defaultNow(),
    confirmedAt: time("confirmed_at"),
  },
  (table) => [
    ...amountChecks(table),
    uniqueIndex("executor_trades_signature_idx").on(table.signature),
    check(
      "executor_trade_status_valid",
      sql`${table.status} IN ('planned','simulated','sent','confirmed','failed','skipped')`,
    ),
    index("executor_trades_created_idx").on(table.createdAt),
  ],
);

export const executorJobs = pgTable(
  "executor_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: objectJson("payload").notNull(),
    status: text("status", {
      enum: ["pending", "sent", "confirmed", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("executor_job_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check(
      "executor_job_status_valid",
      sql`${table.status} IN ('pending','sent','confirmed','failed','skipped')`,
    ),
    index("executor_jobs_status_idx").on(table.status),
  ],
);

export const dustPicks = pgTable(
  "dust_picks",
  {
    seq: u64("seq")
      .notNull()
      .references(() => pulls.seq, { onDelete: "cascade" }),
    pack: integer("pack").notNull(),
    k: integer("k").notNull(),
    deckLenBefore: position("deck_len_before").notNull(),
    deckIndex: position("deck_index").notNull(),
    movedFrom: position("moved_from").notNull(),
    mint: text("mint").notNull(),
    amount: u64("amount").notNull(),
    depositor: text("depositor").notNull(),
    royalty: u64("royalty").notNull(),
    refund: u64("refund").notNull(),
    paid: u64("paid").notNull(),
    redirected: boolean("redirected").notNull(),
    settleSig: text("settle_sig"),
  },
  (table) => [
    ...amountChecks(table),
    primaryKey({ columns: [table.seq, table.pack, table.k] }),
    index("dust_picks_depositor_idx").on(table.depositor, table.seq),
  ],
);

export const deckEntries = pgTable(
  "deck_entries",
  {
    deckIndex: position("deck_index").primaryKey(),
    depositor: text("depositor").notNull(),
    mint: text("mint").notNull(),
    amount: u64("amount").notNull(),
    deposit: u64("deposit").notNull(),
    flags: integer("flags").notNull(),
    ...orderKey(),
  },
  (table) => [
    ...amountChecks(table),
    index("deck_entries_order_idx").on(
      table.slot,
      table.txIndex,
      table.ixIndex,
      table.eventIndex,
    ),
    index("deck_entries_depositor_idx").on(table.depositor, table.mint),
  ],
);

export const feeds = pgTable(
  "feeds",
  {
    signature: text("signature")
      .notNull()
      .references(() => chainTxs.signature, { onDelete: "cascade" }),
    eventIndex: position("event_index").notNull(),
    depositor: text("depositor").notNull(),
    mint: text("mint").notNull(),
    amount: u64("amount").notNull(),
    deckIndex: position("deck_index").notNull(),
    deposit: u64("deposit").notNull(),
    freshInDeck: integer("fresh_in_deck").notNull(),
    attestationSha256: text("attestation_sha256"),
  },
  (table) => [
    ...amountChecks(table),
    primaryKey({ columns: [table.signature, table.eventIndex] }),
    index("feeds_depositor_idx").on(table.depositor, table.mint),
    index("feeds_attestation_idx").on(table.attestationSha256),
  ],
);

export const mintLedgers = pgTable(
  "mint_ledgers",
  {
    mint: text("mint").primaryKey(),
    ledger: text("ledger").notNull(),
    payer: text("payer").notNull(),
    accounted: u64("accounted").notNull(),
    vault: text("vault").notNull(),
    tokenProgram: text("token_program").notNull(),
    vaultExists: boolean("vault_exists").notNull(),
    closedAt: time("closed_at"),
  },
  amountChecks,
);

export const buckets = pgTable(
  "buckets",
  {
    index: integer("index").primaryKey(),
    mint: text("mint").notNull(),
    class: text("class", { enum: ["major", "trending"] }).notNull(),
    enabled: boolean("enabled").notNull(),
    amount: u64("amount").notNull(),
    cost: u64("cost").notNull(),
    reserved: u64("reserved").notNull(),
    cap: u64("cap").notNull(),
    listedSlot: position("listed_slot").notNull(),
    failing: boolean("failing").notNull().default(false),
  },
  (table) => [
    ...amountChecks(table),
    check("bucket_class_valid", sql`${table.class} IN ('major', 'trending')`),
    uniqueIndex("buckets_mint_idx").on(table.mint),
  ],
);

export const machineState = pgTable(
  "machine_state",
  {
    id: integer("id").primaryKey(),
    slot: position("slot").notNull(),
    machine: objectJson("machine").notNull(),
    config: objectJson("config").notNull(),
    deckLen: position("deck_len").notNull(),
  },
  (table) => [check("machine_singleton", sql`${table.id} = 1`)],
);

export const intakeConsumption = pgTable(
  "intake_consumption",
  {
    holder: text("holder").notNull(),
    mint: text("mint").notNull(),
    usedBy: text("used_by").notNull(),
    path: text("path", { enum: ["self", "hop", "unknown"] }).notNull(),
    firstFeedSig: text("first_feed_sig").notNull(),
    slot: position("slot").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.holder, table.mint] }),
    check(
      "consumption_path_valid",
      sql`${table.path} IN ('self', 'hop', 'unknown')`,
    ),
    index("intake_consumption_feed_idx").on(table.firstFeedSig),
  ],
);

export const attestationLog = pgTable(
  "attestation_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageSha256: text("message_sha256").notNull(),
    kind: text("kind", { enum: ["FEED"] }).notNull(),
    wallet: text("wallet").notNull(),
    nonce: position("nonce").notNull(),
    expiry: time("expiry").notNull(),
    bags: attestationBagsJson("bags").notNull(),
    signer: text("signer").notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attestation_log_message_idx").on(table.messageSha256),
    check("attestation_kind_valid", sql`${table.kind} = 'FEED'`),
    index("attestation_log_wallet_idx").on(table.wallet, table.createdAt),
  ],
);

export const quoteLog = pgTable(
  "quote_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageSha256: text("message_sha256").notNull(),
    owner: text("owner").notNull(),
    mint: text("mint").notNull(),
    cardIndices: integer("card_indices").array().notNull(),
    amounts: u64("amounts").array().notNull(),
    totalAmount: u64("total_amount").notNull(),
    quoteLamports: u64("quote_lamports").notNull(),
    valueLamports: u64("value_lamports").notNull(),
    payoutLamports: u64("payout_lamports").notNull(),
    expiry: time("expiry").notNull(),
    nonce: position("nonce").notNull(),
    router: text("router").notNull(),
    requestId: text("request_id").notNull(),
    signer: text("signer").notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    ...amountChecks(table),
    uniqueIndex("quote_log_message_idx").on(table.messageSha256),
    check(
      "quote_card_lengths",
      sql`cardinality(${table.cardIndices}) = cardinality(${table.amounts})`,
    ),
    index("quote_log_owner_idx").on(table.owner, table.createdAt),
  ],
);

export const sellBacks = pgTable(
  "sell_backs",
  {
    signature: text("signature")
      .notNull()
      .references(() => chainTxs.signature, { onDelete: "cascade" }),
    ...orderKey(),
    owner: text("owner").notNull(),
    mint: text("mint").notNull(),
    bucket: integer("bucket").notNull(),
    n: integer("n").notNull(),
    totalAmount: u64("total_amount").notNull(),
    stockedValue: u64("stocked_value").notNull(),
    quoteLamports: u64("quote_lamports").notNull(),
    value: u64("value").notNull(),
    payout: u64("payout").notNull(),
    toTeam: u64("to_team").notNull(),
    nonce: position("nonce").notNull(),
    sbPaidHour: u64("sb_paid_hour").notNull(),
    slotRefund: u64("slot_refund").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.signature, table.eventIndex] }),
    ...amountChecks(table),
    index("sell_backs_order_idx").on(
      table.slot,
      table.txIndex,
      table.ixIndex,
      table.eventIndex,
    ),
    index("sell_backs_owner_idx").on(table.owner, table.slot),
  ],
);

export const execTrades = pgTable(
  "exec_trades",
  {
    signature: text("signature")
      .primaryKey()
      .references(() => chainTxs.signature, { onDelete: "cascade" }),
    ...orderKey(),
    kind: integer("kind").notNull(),
    bucket: integer("bucket").notNull(),
    mint: text("mint").notNull(),
    signer: text("signer").notNull(),
    amount: u64("amount").notNull(),
    minOut: u64("min_out").notNull(),
    v0: u64("v0").notNull(),
    book: u64("book").notNull(),
    expected: u64("expected").notNull(),
    delta: u64("delta").notNull(),
    trackedAfter: u64("tracked_after").notNull(),
    ts: time("ts").notNull(),
  },
  (table) => [
    ...amountChecks(table),
    index("exec_trades_order_idx").on(
      table.slot,
      table.txIndex,
      table.ixIndex,
      table.eventIndex,
    ),
    index("exec_trades_mint_idx").on(table.mint, table.ts),
  ],
);

export const royalties = pgTable(
  "royalties",
  {
    seq: u64("seq")
      .notNull()
      .references(() => pulls.seq, { onDelete: "cascade" }),
    pack: integer("pack").notNull(),
    k: integer("k").notNull(),
    depositor: text("depositor").notNull(),
    amount: u64("amount").notNull(),
    refund: u64("refund").notNull(),
    paid: u64("paid").notNull(),
    redirected: boolean("redirected").notNull(),
    settleSig: text("settle_sig"),
  },
  (table) => [
    ...amountChecks(table),
    primaryKey({ columns: [table.seq, table.pack, table.k] }),
    index("royalties_depositor_idx").on(table.depositor, table.seq),
    index("royalties_settle_sig_idx").on(table.settleSig),
  ],
);

export const keeperJobs = pgTable(
  "keeper_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: objectJson("payload").notNull(),
    status: text("status", {
      enum: ["pending", "sent", "confirmed", "failed", "skipped"],
    }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: time("next_attempt_at").notNull(),
    lastError: text("last_error"),
    signature: text("signature"),
  },
  (table) => [
    check(
      "job_status_valid",
      sql`${table.status} IN ('pending', 'sent', 'confirmed', 'failed', 'skipped')`,
    ),
    check("attempts_nonnegative", sql`${table.attempts} >= 0`),
    index("keeper_jobs_due_idx").on(table.status, table.nextAttemptAt),
    uniqueIndex("keeper_jobs_signature_idx").on(table.signature),
  ],
);

// K1 stores a validated JSON plan/report alongside searchable chain and timing facts.
export const stockPlans = pgTable(
  "stock_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slot: position("slot").notNull(),
    chainTime: time("chain_time").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    live: boolean("live").notNull(),
    state: objectJson("state").notNull(),
    plan: objectJson("plan").notNull(),
  },
  (table) => [index("stock_plans_created_idx").on(table.createdAt)],
);

export const stockTrades = pgTable(
  "stock_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => stockPlans.id),
    signature: text("signature"),
    kind: integer("kind").notNull(),
    bucket: integer("bucket").notNull(),
    mint: text("mint").notNull(),
    amount: u64("amount").notNull(),
    minOut: u64("min_out").notNull(),
    outAmount: u64("out_amount").notNull(),
    delta: u64("delta"),
    slippageBps: integer("slippage_bps"),
    live: boolean("live").notNull(),
    status: text("status", {
      enum: ["planned", "simulated", "sent", "confirmed", "failed", "skipped"],
    }).notNull(),
    lastError: text("last_error"),
    createdAt: time("created_at").notNull().defaultNow(),
    confirmedAt: time("confirmed_at"),
  },
  (table) => [
    ...amountChecks(table),
    check(
      "stock_trade_status_valid",
      sql`${table.status} IN ('planned', 'simulated', 'sent', 'confirmed', 'failed', 'skipped')`,
    ),
    uniqueIndex("stock_trades_signature_idx").on(table.signature),
    index("stock_trades_plan_idx").on(table.planId),
    index("stock_trades_mint_idx").on(table.mint, table.createdAt),
  ],
);

export const hitlistReports = pgTable(
  "hitlist_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mint: text("mint").notNull(),
    class: text("class", { enum: ["major", "trending"] }).notNull(),
    passed: boolean("passed").notNull(),
    slot: position("slot").notNull(),
    capLamports: u64("cap_lamports"),
    oracle: text("oracle"),
    report: objectJson("report").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    ...amountChecks(table),
    check("hitlist_class_valid", sql`${table.class} IN ('major', 'trending')`),
    index("hitlist_reports_mint_idx").on(table.mint, table.createdAt),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    key: text("key").primaryKey(),
    severity: text("severity", {
      enum: ["info", "warning", "critical"],
    }).notNull(),
    firstAt: time("first_at").notNull(),
    lastAt: time("last_at").notNull(),
    count: position("count").notNull(),
    payload: objectJson("payload").notNull(),
    notifiedAt: time("notified_at"),
  },
  (table) => [
    check(
      "alert_severity_valid",
      sql`${table.severity} IN ('info', 'warning', 'critical')`,
    ),
    check("alert_count_positive", sql`${table.count} > 0`),
    index("alerts_recent_idx").on(table.lastAt),
  ],
);

// ===== BEGIN M5 BOT TABLES
import { date, smallint } from "drizzle-orm/pg-core";

const telegramId = (name: string) => bigint(name, { mode: "number" });
const referralPattern = "^([1-9A-HJ-NP-Za-km-z]{32,44}|[a-z0-9_]{3,16})$";

export const tgChats = pgTable(
  "tg_chats",
  {
    chatId: telegramId("chat_id").primaryKey(),
    kind: text("kind", { enum: ["private", "group"] }).notNull(),
    startedAt: time("started_at"),
    blockedAt: time("blocked_at"),
    alerts: text("alerts", { enum: ["off", "live", "daily"] })
      .notNull()
      .default("off"),
    hits: boolean("hits").notNull().default(false),
    updatedAt: time("updated_at").notNull(),
  },
  (table) => [
    check("tg_chats_kind", sql`${table.kind} IN ('private','group')`),
    check("tg_chats_alerts", sql`${table.alerts} IN ('off','live','daily')`),
    check(
      "tg_chats_private_alerts",
      sql`${table.kind} = 'private' OR ${table.alerts} = 'off'`,
    ),
    check(
      "tg_chats_group_hits",
      sql`${table.kind} = 'group' OR ${table.hits} = false`,
    ),
    index("tg_chats_hits_idx")
      .on(table.chatId)
      .where(sql`${table.hits} AND ${table.blockedAt} IS NULL`),
  ],
);

export const tgReferrals = pgTable(
  "tg_referrals",
  {
    telegramUserId: telegramId("telegram_user_id").primaryKey(),
    code: text("code").notNull(),
    setAt: time("set_at").notNull(),
  },
  (table) => [
    check(
      "tg_referrals_code",
      sql`${table.code} ~ ${sql.raw(`'${referralPattern}'`)}`,
    ),
  ],
);

export const tgLinks = pgTable(
  "tg_links",
  {
    telegramUserId: telegramId("telegram_user_id").primaryKey(),
    wallet: text("wallet").notNull().unique(),
    linkedAt: time("linked_at").notNull(),
  },
  (table) => [
    check(
      "tg_links_wallet",
      sql`${table.wallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
  ],
);

export const linkNonces = pgTable(
  "link_nonces",
  {
    nonce: text("nonce").primaryKey(),
    telegramUserId: telegramId("telegram_user_id").notNull(),
    botUsername: text("bot_username").notNull(),
    issuedAt: time("issued_at").notNull(),
    expiresAt: time("expires_at").notNull(),
    closedAt: time("closed_at"),
  },
  (table) => [
    check("link_nonces_nonce", sql`${table.nonce} ~ '^[0-9a-f]{32}$'`),
    uniqueIndex("link_nonces_open_user_idx")
      .on(table.telegramUserId)
      .where(sql`${table.closedAt} IS NULL`),
  ],
);

export const goSessions = pgTable(
  "go_sessions",
  {
    id: text("id").primaryKey(),
    telegramUserId: telegramId("telegram_user_id").notNull(),
    action: text("action", { enum: ["feed", "rip", "cards"] }).notNull(),
    edition: text("edition", {
      enum: ["original", "blue_shift", "signature", "after_hours"],
    }),
    n: smallint("n"),
    ref: text("ref"),
    createdAt: time("created_at").notNull(),
    expiresAt: time("expires_at").notNull(),
    usedAt: time("used_at"),
  },
  (table) => [
    check("go_sessions_id", sql`${table.id} ~ '^[0-9a-f]{32}$'`),
    check("go_sessions_action", sql`${table.action} IN ('feed','rip','cards')`),
    check(
      "go_sessions_edition",
      sql`${table.edition} IN ('original','blue_shift','signature','after_hours')`,
    ),
    check("go_sessions_n", sql`${table.n} BETWEEN 1 AND 10`),
    check(
      "go_sessions_ref",
      sql`${table.ref} ~ ${sql.raw(`'${referralPattern}'`)}`,
    ),
    check(
      "go_sessions_rip_fields",
      sql`${table.action} = 'rip' OR (${table.edition} IS NULL AND ${table.n} IS NULL)`,
    ),
    check(
      "go_sessions_n_edition",
      sql`${table.n} IS NULL OR ${table.edition} IS NOT NULL`,
    ),
    index("go_sessions_user_idx").on(table.telegramUserId, table.createdAt),
    index("go_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const notifyJobs = pgTable(
  "notify_jobs",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    chatId: telegramId("chat_id").notNull(),
    kind: text("kind", { enum: ["royalty", "hit", "digest"] }).notNull(),
    priority: smallint("priority").notNull(),
    payload: objectJson("payload").notNull(),
    notBefore: time("not_before").notNull(),
    expiresAt: time("expires_at").notNull(),
    status: text("status", {
      enum: ["queued", "sending", "sent", "skipped", "failed", "expired"],
    })
      .notNull()
      .default("queued"),
    attempts: smallint("attempts").notNull().default(0),
    outcome: text("outcome"),
    createdAt: time("created_at").notNull(),
    finishedAt: time("finished_at"),
  },
  (table) => [
    check("notify_jobs_kind", sql`${table.kind} IN ('royalty','hit','digest')`),
    check(
      "notify_jobs_status",
      sql`${table.status} IN ('queued','sending','sent','skipped','failed','expired')`,
    ),
    index("notify_jobs_due_idx")
      .on(table.priority, table.id)
      .where(sql`${table.status} = 'queued'`),
    index("notify_jobs_chat_idx")
      .on(table.chatId, table.kind)
      .where(sql`${table.status} = 'queued'`),
  ],
);

export const notifyCursors = pgTable(
  "notify_cursors",
  {
    name: text("name", { enum: ["royalties", "hits"] }).primaryKey(),
    slot: position("slot").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  (table) => [
    check("notify_cursors_name", sql`${table.name} IN ('royalties','hits')`),
  ],
);

export const digestRuns = pgTable("digest_runs", {
  day: date("day").primaryKey(),
  startedAt: time("started_at").notNull(),
  finishedAt: time("finished_at"),
  jobs: integer("jobs").notNull().default(0),
});
// ===== END M5 BOT TABLES
