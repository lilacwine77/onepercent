import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AddressLookupTableAccount,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { signedTxRecordSchema } from "@onepercent/service-kit";
import type {
  ServiceRuntime,
  SignedTxRecord,
  TxInstructionPlan,
  TxJournal,
} from "@onepercent/service-kit";
import { encodeInstructionPlan, decodeInstructionPlan } from "../store.js";
import { STOCK } from "@onepercent/config";
import { EXEC_KIND } from "@onepercent/sdk";
import { emptyStockBudget } from "./planner.js";
import type { StockState, StockTrade } from "./planner.js";
export const json = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint"
      ? v.toString()
      : v instanceof Map
        ? Object.fromEntries(v)
        : v,
  );
const durableSchema = z
  .object({
    claim: z.string(),
    done: z.boolean(),
    attempts: z.number().int().nonnegative(),
    transaction: signedTxRecordSchema.optional(),
    instructions: z.unknown().optional(),
    computeUnitLimit: z.number().int().positive().optional(),
    lookupTables: z.array(z.string()).optional(),
    lookupAddresses: z.array(z.array(z.string())).optional(),
  })
  .passthrough();

/** Each signed plan is charged once. Pending sends never age out. Missing legacy
 * charge metadata fails closed instead of inventing a budget after an upgrade. */
export async function stockBudget(pool: ServiceRuntime["pool"], now: bigint) {
  const result = await pool.query(
    `SELECT state,plan FROM stock_plans WHERE live AND state ? 'transaction'
     AND (state->>'done' IS DISTINCT FROM 'true' OR state->>'budgetUntil' IS NULL
       OR (state->>'budgetUntil')::numeric >= $1)`,
    [String(now)],
  );
  const budget = emptyStockBudget();
  const mints = new Map<string, { bought: bigint; sold: bigint }>();
  const charge = z.object({
    kind: z.union([
      z.literal(EXEC_KIND.stockBuy),
      z.literal(EXEC_KIND.stockSell),
    ]),
    mint: z.string(),
    budgetLamports: z.string().regex(/^\d+$/).transform(BigInt),
  });
  for (const row of result.rows) {
    const trades = z
      .object({ trades: z.array(charge).length(1) })
      .parse(row.plan).trades;
    const t = trades[0]!;
    const side = t.kind === EXEC_KIND.stockBuy ? "bought" : "sold";
    budget[side] += t.budgetLamports;
    const used = mints.get(t.mint) ?? { bought: 0n, sold: 0n };
    used[side] += t.budgetLamports;
    mints.set(t.mint, used);
  }
  return { ...budget, mints };
}

export class StockStore implements TxJournal {
  readonly term = randomUUID();
  constructor(
    readonly pool: ServiceRuntime["pool"],
    readonly active: () => void,
    readonly now: () => Promise<bigint> = async () =>
      BigInt(Math.floor(Date.now() / 1000)),
  ) {}
  async record(
    state: StockState,
    slot: number,
    now: bigint,
    trades: StockTrade[],
    live: boolean,
  ): Promise<string> {
    this.active();
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO stock_plans(id,slot,chain_time,live,state,plan) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        String(slot),
        new Date(Number(now) * 1000),
        live,
        json({
          claim: this.term,
          done: !live || !trades.length,
          attempts: 0,
          machine: state.machine,
        }),
        json({
          trades: trades.map((t) => ({
            kind: t.kind,
            bucket: t.bucket,
            amount: t.amount,
            // A Sell's book can change between planning and landing. Charge its
            // on-chain tranche ceiling, not a stale token-to-book conversion.
            budgetLamports:
              t.kind === EXEC_KIND.stockBuy
                ? t.amount
                : state.machine.buckets[t.bucket]!.class === 1
                  ? STOCK.majorTrancheMaxLamports
                  : STOCK.trendingTrancheMaxLamports,
            mint: t.args.mint,
            minOut: t.onchainMinOut,
            outAmount: t.outAmount,
            reason: t.reason,
            class: state.machine.buckets[t.bucket]!.class,
          })),
        }),
      ],
    );
    this.active();
    return id;
  }
  async pending(): Promise<string | null> {
    this.active();
    const result = await this.pool.query(
      "SELECT id,state FROM stock_plans WHERE live AND state->>'done'='false' ORDER BY created_at LIMIT 1",
    );
    if (!result.rows.length) return null;
    const row = z
      .object({ id: z.string().uuid(), state: durableSchema })
      .parse(result.rows[0]);
    await this.update(row.id, { claim: this.term }, row.state.claim);
    return row.id;
  }
  async state(id: string) {
    this.active();
    const row = await this.pool.query(
      "SELECT state FROM stock_plans WHERE id=$1 AND state->>'claim'=$2",
      [id, this.term],
    );
    this.active();
    if (row.rows.length !== 1) throw new Error("stock_claim_lost");
    return durableSchema.parse(row.rows[0].state);
  }
  async update(id: string, data: object, claim: string = this.term) {
    this.active();
    if ("done" in data && data.done === true)
      data = { ...data, budgetUntil: String((await this.now()) + 3600n) };
    const result = await this.pool.query(
      "UPDATE stock_plans SET state=state || $2::jsonb WHERE id=$1 AND state->>'claim'=$3",
      [id, json(data), claim],
    );
    this.active();
    if (result.rowCount !== 1) throw new Error("stock_claim_lost");
  }
  async read(id: string) {
    return (await this.state(id)).transaction ?? null;
  }
  async write(id: string, record: SignedTxRecord, plan?: TxInstructionPlan) {
    await this.update(id, {
      transaction: signedTxRecordSchema.parse(record),
      budgetUntil: String((await this.now()) + 3600n),
      ...(plan
        ? {
            instructions: encodeInstructionPlan(plan.instructions),
            computeUnitLimit: plan.computeUnitLimit,
            lookupAddresses: (plan.lookupTables ?? []).map((t) =>
              t.state.addresses.map((a) => a.toBase58()),
            ),
            lookupTables: (plan.lookupTables ?? []).map((t) =>
              t.key.toBase58(),
            ),
          }
        : {}),
    });
  }
  async completeIncompleteReceipt(id: string, signature: string, slot: number) {
    this.active();
    const data = {
      done: true,
      budgetUntil: String((await this.now()) + 3600n),
      receipt: {
        status: "incomplete",
        signature,
        slot,
        reason: "finalized_receipt_incomplete",
      },
    };
    this.active();
    const result = await this.pool.query(
      `WITH closed AS (
        UPDATE stock_plans SET state=state || $2::jsonb
        WHERE id=$1 AND state->>'claim'=$3 AND state->'transaction'->>'signature'=$4
        RETURNING id
      ) UPDATE stock_trades SET signature=$4,status='confirmed',confirmed_at=now(),
        delta=NULL,slippage_bps=NULL WHERE plan_id IN (SELECT id FROM closed) RETURNING plan_id`,
      [id, json(data), this.term, signature],
    );
    this.active();
    if (result.rowCount !== 1) throw new Error("stock_claim_lost");
  }
  async reserveAttempt(id: string, max: number) {
    this.active();
    const r = await this.pool.query(
      "UPDATE stock_plans SET state=jsonb_set(state,'{attempts}',to_jsonb((state->>'attempts')::int+1)) WHERE id=$1 AND state->>'claim'=$2 AND (state->>'attempts')::int<$3 RETURNING (state->>'attempts')::int AS attempts",
      [id, this.term, max],
    );
    this.active();
    return r.rows.length
      ? z.number().int().positive().parse(r.rows[0].attempts)
      : null;
  }
  async savePlan(id: string, plan: TxInstructionPlan) {
    await this.update(id, {
      instructions: encodeInstructionPlan(plan.instructions),
      computeUnitLimit: plan.computeUnitLimit,
      lookupTables: (plan.lookupTables ?? []).map((t) => t.key.toBase58()),
    });
  }
  async restore(id: string): Promise<TxInstructionPlan | null> {
    const s = await this.state(id);
    // No signed bytes means nothing can land. Retire before resolving any plan data.
    if (!s.transaction) {
      await this.update(id, { done: true });
      return null;
    }
    if (!s.instructions || !s.computeUnitLimit)
      throw new Error("stock_signed_plan_missing");
    const instructions = decodeInstructionPlan(s.instructions);
    const message = VersionedTransaction.deserialize(
      Buffer.from(s.transaction.transactionBase64, "base64"),
    ).message;
    // Older journals contain table keys but no addresses. Recover the referenced
    // positions from their signed message and persisted instructions, without RPC.
    const positions = new Map<number, PublicKey>();
    message.compiledInstructions.slice(2).forEach((compiled, i) => {
      const ix = instructions[i];
      if (!ix || compiled.accountKeyIndexes.length !== ix.keys.length)
        throw new Error("stock_signed_plan_invalid");
      positions.set(compiled.programIdIndex, ix.programId);
      compiled.accountKeyIndexes.forEach((index, j) => {
        const key = ix.keys[j]!.pubkey;
        if (positions.has(index) && !positions.get(index)!.equals(key))
          throw new Error("stock_signed_plan_invalid");
        positions.set(index, key);
      });
    });
    const recovered = new Map<string, PublicKey[]>();
    let offset = message.staticAccountKeys.length;
    for (const side of ["writableIndexes", "readonlyIndexes"] as const)
      for (const table of message.addressTableLookups) {
        const key = table.accountKey.toBase58();
        const addresses = recovered.get(key) ?? [];
        for (const index of table[side]) {
          const address = positions.get(offset++);
          if (!address) throw new Error("stock_signed_plan_invalid");
          addresses[index] = address;
        }
        recovered.set(key, addresses);
      }
    return {
      instructions,
      computeUnitLimit: s.computeUnitLimit,
      lookupTables: (s.lookupTables ?? []).map((key, i) => {
        const saved = s.lookupAddresses?.[i];
        const addresses = recovered.get(key) ?? [];
        return new AddressLookupTableAccount({
          key: new PublicKey(key),
          state: {
            deactivationSlot: (1n << 64n) - 1n,
            lastExtendedSlot: 0,
            lastExtendedSlotStartIndex: 0,
            addresses: saved
              ? saved.map((a) => new PublicKey(a))
              : Array.from(
                  { length: addresses.length },
                  (_, index) =>
                    addresses[index] ??
                    new PublicKey(
                      createHash("sha256").update(`${key}:${index}`).digest(),
                    ),
                ),
          },
        });
      }),
    };
  }
  async trade(id: string, trade: StockTrade, live: boolean, status: string) {
    this.active();
    await this.pool.query(
      "INSERT INTO stock_trades(plan_id,kind,bucket,mint,amount,min_out,out_amount,live,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        trade.kind,
        trade.bucket,
        trade.args.mint.toBase58(),
        String(trade.amount),
        String(trade.onchainMinOut),
        String(trade.outAmount),
        live,
        status,
      ],
    );
    this.active();
  }
}
