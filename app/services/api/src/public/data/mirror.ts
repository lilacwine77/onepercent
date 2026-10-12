import { type ServiceRuntime, warnCause } from "@onepercent/service-kit";
import { z } from "zod";
import { PublicDataUnavailable, safeNumber } from "./draft-layouts.js";

interface Client {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}
const number = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform(safeNumber);
const amount = z.string().regex(/^\d{1,20}$/);
const key = z.string().min(32).max(44);
const pending = z.object({
  seq: amount,
  pull: key,
  buyer: key,
  edition: number,
  qty: number,
  createdTs: number,
});
const pack = z.object({
  pack: number,
  t: number,
  widths: z.array(number).length(6),
  tier: number,
  hitBucket: number,
  hitMint: key,
  hitAmount: amount,
  hitValue: amount,
  houseMask: number,
  liveFlags: number.nullish().transform((value) => value ?? undefined),
});
const dust = z.object({
  pack: number,
  k: number,
  deckLenBefore: number,
  deckIndex: number,
  movedFrom: number,
  mint: key,
  amount,
  depositor: key,
  royalty: amount,
  refund: amount,
  paid: amount,
  redirected: z.boolean(),
  settleSig: z.string().nullable(),
});
const pull = z.object({
  seq: amount,
  pull: key,
  buyer: key,
  buyerNonce: number,
  referrer: key.nullable(),
  edition: number,
  qty: number,
  price: amount,
  createdTs: number,
  status: z.enum(["pending", "revealed", "closed", "refunded"]),
  settledMask: number,
  randomness: z
    .string()
    .regex(/^[a-f\d]{64}$/i)
    .nullable(),
  revealedSlot: number.nullable(),
  revealOrder: number.nullable(),
  liveFlags: number,
  holder: z.boolean(),
  openedSig: z.string(),
  revealedSig: z.string().nullable(),
});

async function query<T>(
  client: Client,
  sql: string,
  schema: z.ZodType<T>,
  values: unknown[] = [],
): Promise<T[]> {
  return z.array(schema).parse((await client.query(sql, values)).rows);
}
export async function readSnapshot<T>(
  pool: ServiceRuntime["pool"],
  read: (client: Client, asOfSlot: number) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const [position] = await query(
      client,
      `SELECT GREATEST((SELECT slot FROM machine_state WHERE id = 1), (SELECT MAX(slot) FROM chain_txs WHERE err IS NULL AND commitment IN ('confirmed', 'finalized'))) AS slot`,
      z.object({ slot: number.nullable() }),
    );
    if (position?.slot == null)
      throw new PublicDataUnavailable("indexer_unavailable");
    const result = await read(client, position.slot);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch((error) => {
      warnCause("public_mirror_rollback_failed", error);
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function readMeMirror(
  pool: ServiceRuntime["pool"],
  wallet: string,
) {
  return readSnapshot(pool, async (client, asOfSlot) => {
    const deck = await query(
      client,
      `SELECT deck_index AS "deckIndex", mint, amount::text, deposit::text, (flags & 1) = 1 AS fresh, (flags & 2) = 2 AS refed, slot AS "asOfSlot" FROM deck_entries WHERE depositor = $1 ORDER BY deck_index`,
      z.object({
        deckIndex: number,
        mint: key,
        amount,
        deposit: amount,
        fresh: z.boolean(),
        refed: z.boolean(),
        asOfSlot: number,
      }),
      [wallet],
    );
    const pendingRows = await query(
      client,
      `SELECT p.seq::text, p.address AS pull, p.buyer, p.edition, p.qty, FLOOR(EXTRACT(EPOCH FROM p.created_ts))::bigint AS "createdTs" FROM pulls p JOIN chain_txs t ON t.signature = p.opened_sig AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE p.buyer = $1 AND p.status = 'pending' ORDER BY p.seq`,
      pending,
      [wallet],
    );
    const settleable = await query(
      client,
      `SELECT p.seq::text, p.address AS pull, ARRAY(SELECT n FROM generate_series(0, p.qty - 1) n WHERE (p.settled_mask & (1 << n)) = 0 ORDER BY n) AS packs FROM pulls p JOIN chain_txs t ON t.signature = p.revealed_sig AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE p.status = 'revealed' AND (p.buyer = $1 OR EXISTS (SELECT 1 FROM dust_picks d WHERE d.seq = p.seq AND d.depositor = $1)) ORDER BY p.seq`,
      z.object({ seq: amount, pull: key, packs: z.array(number) }),
      [wallet],
    );
    const vaultDeposits = await query(
      client,
      `SELECT l.mint, l.payer = $1 AS "payerIsWallet", l.accounted::text, l.vault_exists AS "vaultExists", CASE WHEN l.vault_exists THEN 'held' ELSE 'returned' END AS state FROM mint_ledgers l WHERE l.payer = $1 OR EXISTS (SELECT 1 FROM feeds f JOIN chain_txs t ON t.signature = f.signature AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE f.depositor = $1 AND f.mint = l.mint) ORDER BY l.mint`,
      z.object({
        mint: key,
        payerIsWallet: z.boolean(),
        accounted: amount,
        vaultExists: z.boolean(),
        state: z.enum(["held", "returned"]),
      }),
      [wallet],
    );
    // PackSettled.paid combines royalty and returned deposit. A partial transfer
    // has no on-chain attribution order: report receipts, leave royalties unknown.
    // Count one pulled pack per wallet; redirected payments are not their SOL.
    const [totals] = await query(
      client,
      `SELECT COUNT(DISTINCT (r.seq,r.pack)) FILTER (WHERE t.block_time >= CURRENT_TIMESTAMP - INTERVAL '24 hours') AS "count24h", CASE WHEN BOOL_OR(r.paid < r.amount + r.refund) FILTER (WHERE t.block_time >= CURRENT_TIMESTAMP - INTERVAL '24 hours') THEN NULL ELSE COALESCE(SUM(r.amount) FILTER (WHERE t.block_time >= CURRENT_TIMESTAMP - INTERVAL '24 hours'),0)::text END AS "lamports24h", CASE WHEN BOOL_OR(r.paid < r.amount + r.refund) THEN NULL ELSE COALESCE(SUM(r.amount),0)::text END AS total, COALESCE(SUM(r.paid) FILTER (WHERE t.block_time >= CURRENT_TIMESTAMP - INTERVAL '24 hours'),0)::text AS "receiptsLamports24h", COALESCE(SUM(r.paid),0)::text AS "receiptsTotal" FROM royalties r JOIN chain_txs t ON t.signature = r.settle_sig AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE r.depositor = $1 AND NOT r.redirected`,
      z.object({
        count24h: number,
        lamports24h: amount.nullable(),
        total: amount.nullable(),
        receiptsLamports24h: amount,
        receiptsTotal: amount,
      }),
      [wallet],
    );
    if (!totals) throw new PublicDataUnavailable();
    return {
      asOfSlot,
      deck,
      pulls: {
        pending: pendingRows,
        settleable: settleable.filter((row) => row.packs.length > 0),
      },
      vaultDeposits,
      royalties: {
        count24h: totals.count24h,
        lamports24h: totals.lamports24h,
        total: totals.total,
        settlementReceipts: {
          lamports24h: totals.receiptsLamports24h,
          total: totals.receiptsTotal,
        },
      },
    };
  });
}

export async function readVerifyMirror(
  pool: ServiceRuntime["pool"],
  seq: string,
) {
  return readSnapshot(pool, async (client, asOfSlot) => {
    const [header] = await query(
      client,
      `SELECT p.seq::text, p.address AS pull, p.buyer, p.buyer_nonce AS "buyerNonce", p.referrer, p.edition, p.qty, p.price::text, FLOOR(EXTRACT(EPOCH FROM p.created_ts))::bigint AS "createdTs", p.status, p.settled_mask AS "settledMask", p.randomness, p.revealed_slot AS "revealedSlot", p.reveal_order AS "revealOrder", p.live_flags AS "liveFlags", p.holder, p.opened_sig AS "openedSig", p.revealed_sig AS "revealedSig" FROM pulls p JOIN chain_txs t ON t.signature = p.opened_sig AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE p.seq = $1`,
      pull,
      [seq],
    );
    if (!header) return null;
    const [reveal] = header.revealedSig
      ? await query(
          client,
          `SELECT FLOOR(EXTRACT(EPOCH FROM t.block_time))::bigint AS ts FROM chain_events e JOIN chain_txs t ON t.signature = e.signature AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE e.signature = $1 AND e.name = 'PullRevealed' AND e.data->>'seq' = $2 LIMIT 1`,
          z.object({ ts: number.nullable() }),
          [header.revealedSig, seq],
        )
      : [];
    // Raw mirror state alone cannot publish any outcome: require its confirmed event.
    if (!reveal)
      return {
        asOfSlot,
        ...header,
        status:
          header.status === "refunded"
            ? ("refunded" as const)
            : ("pending" as const),
        randomness: null,
        revealedSlot: null,
        revealOrder: null,
        revealedTs: null,
        revealedSig: null,
        packs: [],
      };
    const packs = await query(
      client,
      `SELECT p.pack, p.t, p.widths, p.tier, p.hit_bucket AS "hitBucket", p.hit_mint AS "hitMint", p.hit_amount::text AS "hitAmount", p.hit_value::text AS "hitValue", p.house_mask AS "houseMask", e.data->'live_flags' AS "liveFlags" FROM packs p JOIN chain_events e ON e.data->>'pack' = p.pack::text JOIN chain_txs t ON t.signature = e.signature AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE p.seq = $1::numeric AND e.signature = $2 AND e.name = 'PackRevealed' AND e.data->>'seq' = $1::text ORDER BY p.pack`,
      pack,
      [seq, header.revealedSig],
    );
    const picks = await query(
      client,
      `SELECT pack, k, deck_len_before AS "deckLenBefore", deck_index AS "deckIndex", moved_from AS "movedFrom", mint, amount::text, depositor, royalty::text, refund::text, paid::text, redirected, settle_sig AS "settleSig" FROM dust_picks WHERE seq = $1 ORDER BY pack,k`,
      dust,
      [seq],
    );
    return {
      asOfSlot,
      ...header,
      revealedTs: reveal.ts,
      packs: packs.map((row) => ({
        ...row,
        dust: picks.filter((pick) => pick.pack === row.pack),
      })),
    };
  });
}

/**
 * Packs opened per edition among the most recent confirmed pulls (PACK_EDITIONS
 * order): the edition mix the Feed back estimate weighs (@onepercent/config
 * feedBackEstimate). All zero without pulls yet.
 */
export async function readEditionMix(
  pool: ServiceRuntime["pool"],
  recentPulls = 500,
): Promise<[number, number, number, number]> {
  return readSnapshot(pool, async (client) => {
    const rows = await query(
      client,
      `SELECT r.edition, SUM(r.qty)::bigint AS packs FROM (SELECT p.edition, p.qty FROM pulls p JOIN chain_txs t ON t.signature = p.opened_sig AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') ORDER BY p.seq DESC LIMIT $1) r GROUP BY r.edition`,
      z.object({ edition: number, packs: number }),
      [recentPulls],
    );
    const mix: [number, number, number, number] = [0, 0, 0, 0];
    for (const row of rows)
      if (row.edition >= 0 && row.edition < mix.length)
        mix[row.edition] = row.packs;
    return mix;
  });
}

export async function readStatusMirror(pool: ServiceRuntime["pool"]) {
  return readSnapshot(pool, async (client, asOfSlot) => {
    const [status] = await query(
      client,
      `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND classid = CASE WHEN hashtext('onepct:keeper') < 0 THEN 4294967295 ELSE 0 END::oid AND objid = (hashtext('onepct:keeper')::bigint & 4294967295)::oid AND objsubid = 1) AS leader, (SELECT GREATEST(0,FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - MAX(t.block_time))))::bigint FROM chain_events e JOIN chain_txs t ON t.signature = e.signature AND t.err IS NULL AND t.commitment IN ('confirmed','finalized') WHERE e.name = 'PackSettled') AS "lastSettleAgeSeconds"`,
      z.object({
        leader: z.boolean(),
        lastSettleAgeSeconds: number.nullable(),
      }),
    );
    if (!status) throw new PublicDataUnavailable();
    return { asOfSlot, keeper: status };
  });
}
