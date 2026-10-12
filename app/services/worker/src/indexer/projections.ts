import {
  jsonObjectSchema,
  type JsonObject,
  type JsonValue,
} from "@onepercent/db";
import { decodeInstructionData } from "./consumption.js";
import {
  projectSeasonEvent,
  SEASON_EVENT_MIRRORS,
  SEASON_RETAINED_MIRRORS,
} from "./season/projections.js";
import type {
  IndexedEvent,
  IndexedTransaction,
  SqlExecutor,
  StoreOptions,
} from "./store.js";

export const MIRROR_TABLES = [
  "pulls",
  "packs",
  "dust_picks",
  "royalties",
  "feeds",
  "sell_backs",
  "exec_trades",
  "mint_ledgers",
  "buckets",
  "machine_state",
  "deck_entries",
  "intake_consumption",
  ...SEASON_EVENT_MIRRORS,
  ...SEASON_RETAINED_MIRRORS,
] as const;
const U32_MAX = 4_294_967_295n;
const EMPTY_PUBLIC_KEY = "11111111111111111111111111111111";
const BUY_DISCRIMINATOR = Buffer.from([136, 30, 10, 209, 228, 139, 105, 138]);
const numeric = (value: JsonValue | undefined): bigint => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^-?\d+$/.test(String(value))
  )
    throw new Error("invalid_event_integer");
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("unsafe_event_integer");
  return BigInt(value);
};
const integer = (value: JsonValue | undefined): number => {
  const result = Number(numeric(value));
  if (!Number.isSafeInteger(result)) throw new Error("unsafe_event_integer");
  return result;
};
const object = (value: JsonValue | undefined): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_event_object");
  return value;
};
const list = (value: JsonValue | undefined): JsonValue[] => {
  if (!Array.isArray(value)) throw new Error("invalid_event_array");
  return value;
};
const amount = (value: JsonValue | undefined): string =>
  numeric(value).toString();

export interface DeckMirrorEntry {
  depositor: string;
  mint: string;
  amount: string;
  deposit: string;
  flags: number;
}
export function mutateDeck(
  deck: Map<bigint, DeckMirrorEntry>,
  event: IndexedEvent,
): number {
  const data = event.data;
  const remove = (index: bigint, moved: bigint) => {
    if (moved !== U32_MAX) {
      const last = deck.get(moved);
      if (!last) throw new Error("deck_move_missing");
      deck.set(index, last);
      deck.delete(moved);
    } else deck.delete(index);
  };
  if (event.name === "BagFed" || event.name === "CardFedBack") {
    deck.set(numeric(data.deck_index), {
      depositor: String(data.depositor ?? data.owner),
      mint: String(data.mint),
      amount: amount(data.amount),
      deposit: amount(data.deposit),
      flags: event.name === "BagFed" ? 1 : 2,
    });
  } else if (event.name === "BagTakenBack")
    remove(numeric(data.deck_index), numeric(data.moved_from));
  else if (event.name === "PackRevealed") {
    let fresh = 0;
    for (const [k, raw] of list(data.dust).entries()) {
      if ((integer(data.house_mask) & (1 << k)) !== 0) continue;
      const pick = object(raw);
      const entry = deck.get(numeric(pick.index));
      if (!entry) throw new Error("deck_pick_missing");
      if ((entry.flags & 1) !== 0) fresh |= 1 << k;
      remove(numeric(pick.index), numeric(pick.moved_from));
    }
    return fresh;
  }
  return 0;
}

async function deckFence(sql: SqlExecutor): Promise<bigint> {
  const row = (
    await sql.query(
      "SELECT last_slot FROM cursors WHERE name='indexer:deck-snapshot'",
    )
  ).rows[0];
  return row ? BigInt(String(row.last_slot)) : -1n;
}

type Position = readonly [bigint, bigint, bigint, bigint];
interface HistoricalDeck {
  deck: Map<bigint, DeckMirrorEntry>;
  through: Position;
}
const history = new WeakMap<StoreOptions, HistoricalDeck>();
const revealOrdinals = new WeakMap<
  StoreOptions,
  { through: Position; count: bigint }
>();
const positionOf = (tx: IndexedTransaction, event: IndexedEvent): Position => [
  tx.slot,
  tx.txIndex,
  event.ixIndex,
  event.eventIndex,
];
const beforePosition = (a: Position, b: Position): boolean => {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return true;
    if (a[i]! > b[i]!) return false;
  }
  return false;
};

/** Invalidate after SQL rollback or rebuilding canonical history. */
export function clearProjectionHistory(options: StoreOptions): void {
  history.delete(options);
  revealOrdinals.delete(options);
}

async function revealOrdinal(
  sql: SqlExecutor,
  tx: IndexedTransaction,
  event: IndexedEvent,
  options: StoreOptions,
): Promise<string> {
  const position = positionOf(tx, event);
  const previous = revealOrdinals.get(options);
  const cached =
    previous && beforePosition(previous.through, position)
      ? previous
      : { through: [-1n, -1n, -1n, -1n] as Position, count: 0n };
  const row = (
    await sql.query(
      "SELECT COUNT(*) AS count FROM chain_events WHERE name='PullRevealed' AND NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:'||chain_events.signature) AND (slot,tx_index,ix_index,event_index)>($1,$2,$3,$4) AND (slot,tx_index,ix_index,event_index)<=($5,$6,$7,$8)",
      [...cached.through.map(String), ...position.map(String)],
    )
  ).rows[0];
  const count = cached.count + BigInt(String(row!.count));
  revealOrdinals.set(options, { through: position, count });
  return count.toString();
}

async function historicalFreshMask(
  sql: SqlExecutor,
  tx: IndexedTransaction,
  event: IndexedEvent,
  options: StoreOptions,
): Promise<number> {
  const position = positionOf(tx, event);
  let cached = history.get(options);
  if (!cached || !beforePosition(cached.through, position)) {
    cached = { deck: new Map(), through: [-1n, -1n, -1n, -1n] };
    history.set(options, cached);
  }
  const rows = (
    await sql.query(
      "SELECT slot,tx_index,name,data,ix_index,event_index FROM chain_events WHERE name IN ('BagFed','BagTakenBack','CardFedBack','PackRevealed') AND NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:'||chain_events.signature) AND (slot,tx_index,ix_index,event_index)>($1,$2,$3,$4) AND (slot,tx_index,ix_index,event_index)<($5,$6,$7,$8) ORDER BY slot,tx_index,ix_index,event_index",
      [...cached.through.map(String), ...position.map(String)],
    )
  ).rows;
  try {
    for (const row of rows) {
      mutateDeck(cached.deck, {
        name: String(row.name),
        data: jsonObjectSchema.parse(row.data),
        ixIndex: BigInt(String(row.ix_index)),
        eventIndex: BigInt(String(row.event_index)),
      });
      cached.through = [
        BigInt(String(row.slot)),
        BigInt(String(row.tx_index)),
        BigInt(String(row.ix_index)),
        BigInt(String(row.event_index)),
      ];
    }
  } catch (error) {
    clearProjectionHistory(options);
    throw error;
  }
  // Keep the cache strictly before the current event: its SQL savepoint may fail.
  // Only touched rows are needed for computing the current pack's fresh mask.
  const touched = new Map<bigint, DeckMirrorEntry>();
  for (const [k, raw] of list(event.data.dust).entries()) {
    if ((integer(event.data.house_mask) & (1 << k)) !== 0) continue;
    const pick = object(raw);
    for (const index of [numeric(pick.index), numeric(pick.moved_from)]) {
      const row = cached.deck.get(index);
      if (row) touched.set(index, row);
    }
  }
  return mutateDeck(touched, event);
}

export async function enrichEvent(
  sql: SqlExecutor,
  tx: IndexedTransaction,
  event: IndexedEvent,
  options: StoreOptions,
): Promise<void> {
  if (event.name === "PullOpened") {
    // AccountReconciler validates the exact event-named Pull for CPI purchases.
    const metadata = event.data._indexer;
    if (
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      typeof metadata.buyerNonce === "number" &&
      Number.isInteger(metadata.buyerNonce) &&
      metadata.buyerNonce >= 0 &&
      metadata.buyerNonce <= Number(U32_MAX)
    )
      return;
    const ix = tx.instructions[Number(event.ixIndex)];
    const bytes = ix ? decodeInstructionData(ix.data) : Buffer.alloc(0);
    if (
      !ix ||
      ix.programId !== options.programId ||
      bytes.length < 14 ||
      !bytes.subarray(0, 8).equals(BUY_DISCRIMINATOR)
    )
      throw new Error("pull_nonce_unavailable");
    event.data._indexer = { buyerNonce: bytes.readUInt32LE(10) };
  } else if (event.name === "PackRevealed") {
    let fresh: number;
    if (tx.slot <= (await deckFence(sql)))
      fresh = await historicalFreshMask(sql, tx, event, options);
    else {
      const deck = new Map<bigint, DeckMirrorEntry>();
      const indices = new Set<string>();
      for (const [k, raw] of list(event.data.dust).entries()) {
        if ((integer(event.data.house_mask) & (1 << k)) !== 0) continue;
        const pick = object(raw);
        indices.add(amount(pick.index));
        if (numeric(pick.moved_from) !== U32_MAX)
          indices.add(amount(pick.moved_from));
      }
      for (const row of (
        await sql.query(
          "SELECT deck_index,depositor,mint,amount,deposit,flags FROM deck_entries WHERE deck_index=ANY($1::bigint[])",
          [[...indices]],
        )
      ).rows) {
        deck.set(BigInt(String(row.deck_index)), {
          depositor: String(row.depositor),
          mint: String(row.mint),
          amount: String(row.amount),
          deposit: String(row.deposit),
          flags: Number(row.flags),
        });
      }

      fresh = mutateDeck(deck, event);
    }
    event.data._indexer = { freshMask: fresh };
  }
}

async function insert(
  sql: SqlExecutor,
  table: string,
  row: Record<string, unknown>,
  keys: string[],
): Promise<void> {
  // Identifiers come exclusively from the static projection definitions below.
  const columns = Object.keys(row);
  const updates = columns
    .filter((column) => !keys.includes(column))
    .map((column) => `${column}=EXCLUDED.${column}`);
  await sql.query(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (${keys.join(",")}) ${updates.length ? `DO UPDATE SET ${updates.join(",")}` : "DO NOTHING"}`,
    Object.values(row),
  );
}

async function moveDeck(
  sql: SqlExecutor,
  index: string,
  moved: string,
  position: Record<string, string>,
): Promise<void> {
  if (BigInt(moved) !== U32_MAX) {
    const row = (
      await sql.query(
        "SELECT depositor,mint,amount,deposit,flags FROM deck_entries WHERE deck_index=$1",
        [moved],
      )
    ).rows[0];
    if (!row) throw new Error("deck_move_missing");
    await insert(
      sql,
      "deck_entries",
      { ...row, deck_index: index, ...position },
      ["deck_index"],
    );
    await sql.query("DELETE FROM deck_entries WHERE deck_index=$1", [moved]);
  } else
    await sql.query("DELETE FROM deck_entries WHERE deck_index=$1", [index]);
}

async function updatePull(
  sql: SqlExecutor,
  seq: string,
  changes: Record<string, unknown>,
  slot: bigint,
): Promise<void> {
  const columns = Object.keys(changes);
  await sql.query(
    `UPDATE pulls SET ${columns.map((column, index) => `${column}=$${index + 3}`).join(",")} WHERE seq=$1 AND NOT EXISTS (SELECT 1 FROM cursors WHERE name='indexer:account:'||pulls.address AND last_slot >= $2)`,
    [seq, slot.toString(), ...Object.values(changes)],
  );
}

export async function projectEvent(
  sql: SqlExecutor,
  tx: IndexedTransaction,
  event: IndexedEvent,
  options: StoreOptions,
): Promise<void> {
  const d = event.data;
  await projectSeasonEvent(sql, tx, event);
  const position = {
    slot: tx.slot.toString(),
    tx_index: tx.txIndex.toString(),
    ix_index: event.ixIndex.toString(),
    event_index: event.eventIndex.toString(),
  };
  const applyDeck = tx.slot > (await deckFence(sql));
  switch (event.name) {
    case "IndexerFeedRecovered": {
      const metadata = object(d._indexer);
      await sql.query(
        "INSERT INTO intake_consumption(holder,mint,used_by,path,first_feed_sig,slot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(holder,mint) DO NOTHING",
        [
          metadata.holder,
          d.mint,
          d.depositor,
          metadata.path,
          tx.signature,
          position.slot,
        ],
      );
      break;
    }
    case "BagFed": {
      const metadata = object(d._indexer);
      await insert(
        sql,
        "feeds",
        {
          signature: tx.signature,
          event_index: position.event_index,
          depositor: d.depositor,
          mint: d.mint,
          amount: amount(d.amount),
          deck_index: amount(d.deck_index),
          deposit: amount(d.deposit),
          fresh_in_deck: integer(d.fresh_in_deck),
          attestation_sha256: metadata.attestationSha256,
        },
        ["signature", "event_index"],
      );
      await sql.query(
        "INSERT INTO intake_consumption(holder,mint,used_by,path,first_feed_sig,slot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(holder,mint) DO NOTHING",
        [
          metadata.holder,
          d.mint,
          d.depositor,
          metadata.path,
          tx.signature,
          position.slot,
        ],
      );
      if (applyDeck)
        await insert(
          sql,
          "deck_entries",
          {
            deck_index: amount(d.deck_index),
            depositor: d.depositor,
            mint: d.mint,
            amount: amount(d.amount),
            deposit: amount(d.deposit),
            flags: 1,
            ...position,
          },
          ["deck_index"],
        );
      break;
    }
    case "CardFedBack":
      if (applyDeck)
        await insert(
          sql,
          "deck_entries",
          {
            deck_index: amount(d.deck_index),
            depositor: d.owner,
            mint: d.mint,
            amount: amount(d.amount),
            deposit: amount(d.deposit),
            flags: 2,
            ...position,
          },
          ["deck_index"],
        );
      break;
    case "BagTakenBack":
      if (applyDeck)
        await moveDeck(
          sql,
          amount(d.deck_index),
          amount(d.moved_from),
          position,
        );
      break;
    case "PullOpened": {
      // Insert does not replace a newer authoritative account snapshot.
      await sql.query(
        "INSERT INTO pulls(seq,address,buyer,buyer_nonce,edition,qty,price,referrer,holder,status,created_ts,opened_sig,live_flags,settled_mask) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,0,0) ON CONFLICT(seq) DO NOTHING",
        [
          amount(d.seq),
          d.pull,
          d.buyer,
          amount(object(d._indexer).buyerNonce),
          integer(d.edition),
          integer(d.qty),
          amount(d.price),
          d.referrer === EMPTY_PUBLIC_KEY ? null : d.referrer,
          d.holder,
          new Date(Number(numeric(d.created_ts)) * 1000),
          tx.signature,
        ],
      );
      break;
    }
    case "PackRevealed": {
      const seq = amount(d.seq);
      const pack = integer(d.pack);
      const pull = (
        await sql.query("SELECT price FROM pulls WHERE seq=$1", [seq])
      ).rows[0];
      if (!pull) throw new Error("pack_pull_missing");
      const royalty =
        (BigInt(String(pull.price)) * BigInt(options.royaltyPerDustCardBps)) /
        10_000n;
      await insert(
        sql,
        "packs",
        {
          seq,
          pack,
          t: amount(d.t),
          widths: list(d.widths).map(integer),
          tier: integer(d.tier),
          hit_bucket: integer(d.hit_bucket),
          hit_mint: d.hit_mint,
          hit_amount: amount(d.hit_amount),
          hit_value: amount(d.hit_value),
          house_mask: integer(d.house_mask),
          fresh_mask: integer(object(d._indexer).freshMask),
          live_flags: integer(d.live_flags),
        },
        ["seq", "pack"],
      );
      await sql.query(
        "UPDATE pulls SET live_flags=live_flags | $2 WHERE seq=$1",
        [seq, integer(d.live_flags)],
      );
      for (const [k, raw] of list(d.dust).entries()) {
        const pick = object(raw);
        const house = (integer(d.house_mask) & (1 << k)) !== 0;
        if (!house && applyDeck)
          await moveDeck(
            sql,
            amount(pick.index),
            amount(pick.moved_from),
            position,
          );
        await insert(
          sql,
          "dust_picks",
          {
            seq,
            pack,
            k,
            deck_len_before: amount(pick.deck_len_before),
            deck_index: amount(pick.index),
            moved_from: amount(pick.moved_from),
            mint: pick.mint,
            amount: amount(pick.amount),
            depositor: pick.depositor,
            royalty: house ? "0" : royalty.toString(),
            refund: amount(pick.refund),
            paid: "0",
            redirected: false,
            settle_sig: null,
          },
          ["seq", "pack", "k"],
        );
        if (!house)
          await insert(
            sql,
            "royalties",
            {
              seq,
              pack,
              k,
              depositor: pick.depositor,
              amount: royalty.toString(),
              refund: amount(pick.refund),
              paid: "0",
              redirected: false,
              settle_sig: null,
            },
            ["seq", "pack", "k"],
          );
      }
      break;
    }
    case "PullRevealed": {
      const randomness = Buffer.from(list(d.randomness).map(integer)).toString(
        "hex",
      );
      // Reveal order is the global one-based ordinal of canonical PullRevealed events.
      await sql.query(
        "UPDATE pulls SET revealed_sig=$2,revealed_slot=$3,reveal_order=$4,randomness=$5 WHERE seq=$1",
        [
          amount(d.seq),
          tx.signature,
          position.slot,
          await revealOrdinal(sql, tx, event, options),
          randomness,
        ],
      );
      await updatePull(sql, amount(d.seq), { status: "revealed" }, tx.slot);
      break;
    }
    case "PackSettled": {
      for (const [k, paid] of list(d.paid).entries()) {
        const values = [
          amount(d.seq),
          integer(d.pack),
          k,
          amount(paid),
          (integer(d.redirected_mask) & (1 << k)) !== 0,
          tx.signature,
        ];
        for (const table of ["dust_picks", "royalties"])
          await sql.query(
            `UPDATE ${table} SET paid=$4,redirected=$5,settle_sig=$6 WHERE seq=$1 AND pack=$2 AND k=$3`,
            values,
          );
      }
      await sql.query(
        "UPDATE pulls SET settled_mask=settled_mask | $2 WHERE seq=$1 AND NOT EXISTS (SELECT 1 FROM cursors WHERE name='indexer:account:'||pulls.address AND last_slot >= $3)",
        [amount(d.seq), 1 << integer(d.pack), position.slot],
      );
      break;
    }
    case "PullRefunded":
      await updatePull(sql, amount(d.seq), { status: "refunded" }, tx.slot);
      break;
    case "PullClosed":
      await sql.query(
        "UPDATE pulls SET status=CASE WHEN status='refunded' THEN status ELSE 'closed' END WHERE seq=$1 AND NOT EXISTS (SELECT 1 FROM cursors WHERE name='indexer:account:'||pulls.address AND last_slot >= $2)",
        [amount(d.seq), position.slot],
      );
      break;
    case "VaultClosed":
      await sql.query(
        "UPDATE mint_ledgers SET vault_exists=false,closed_at=$2 WHERE mint=$1 AND NOT EXISTS (SELECT 1 FROM cursors WHERE name='indexer:account:'||mint_ledgers.ledger AND last_slot >= $3)",
        [
          d.mint,
          tx.blockTime === null ? null : new Date(tx.blockTime * 1000),
          position.slot,
        ],
      );
      break;
    case "SoldBack": {
      const row: Record<string, unknown> = {
        signature: tx.signature,
        ...position,
        owner: d.owner,
        mint: d.mint,
      };
      for (const field of ["bucket", "n", "nonce"])
        row[field] = integer(d[field]);
      for (const field of [
        "total_amount",
        "stocked_value",
        "quote_lamports",
        "value",
        "payout",
        "to_team",
        "sb_paid_hour",
        "slot_refund",
      ])
        row[field] = amount(d[field]);
      await insert(sql, "sell_backs", row, ["signature", "event_index"]);
      break;
    }
    case "ExecEnded": {
      const rawBegun = (
        await sql.query(
          "SELECT data FROM chain_events WHERE signature=$1 AND name='ExecBegun' AND event_index<$2 ORDER BY event_index DESC LIMIT 1",
          [tx.signature, position.event_index],
        )
      ).rows[0]?.data;
      if (rawBegun === undefined) throw new Error("exec_begin_missing");
      const begun = jsonObjectSchema.parse(rawBegun);
      const row: Record<string, unknown> = {
        signature: tx.signature,
        ...position,
        kind: integer(d.kind),
        bucket: integer(d.bucket),
        mint: d.mint,
        signer: begun.signer,
        v0: amount(begun.v0),
        expected: amount(begun.expected),
        ts: new Date(Number(numeric(d.ts)) * 1000),
      };
      for (const field of [
        "amount",
        "min_out",
        "book",
        "delta",
        "tracked_after",
      ])
        row[field] = amount(d[field]);
      await insert(sql, "exec_trades", row, ["signature"]);
      break;
    }
  }
}
