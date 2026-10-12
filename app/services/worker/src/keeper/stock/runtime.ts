import { setTimeout as delay } from "node:timers/promises";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  BPS_DENOMINATOR,
  HIT_LIST,
  KEEPER_POLICY,
  MARKET,
  SERVICES,
  SOLANA_GENESIS_HASHES,
  STOCK,
} from "@onepercent/config";
import {
  createDeploymentSelector,
  EXEC_KIND,
  machinePda,
} from "@onepercent/sdk";
import { stockCap } from "@onepercent/sdk/server";
import { parseOnepercentLogs } from "@onepercent/sdk/events";
import { createTxRpc, TxSender } from "@onepercent/service-kit";
import type {
  ServiceRuntime,
  TxInstructionPlan,
} from "@onepercent/service-kit";
import { listingReportSchema } from "@onepercent/market";
import { listingClients, saveReport } from "@onepercent/cli/hitlist";
import type { KeeperExtension } from "../keeper.js";
import { freshSponsored, PersistentConditions } from "./safety.js";
import { StockChain, sponsoredAccount } from "./chain.js";
import { buildRoute, buildStockTransaction, measuredUnits } from "./builder.js";
import {
  checkStockQuote,
  planStock,
  rotated,
  stockRequests,
  stockTargets,
} from "./planner.js";
import type { StockQuote, StockState } from "./planner.js";
import { StockStore, stockBudget } from "./store.js";
import { assertStockReceipt } from "./receipt.js";
import { privateLanding, senderTip, stockBuyGuardRefusal } from "./landing.js";

class StockBuyWait extends Error {
  constructor(
    readonly refusal: NonNullable<ReturnType<typeof stockBuyGuardRefusal>>,
  ) {
    super(refusal.reason);
  }
}

export const amountText = z.string().regex(/^\d+$/).transform(BigInt);
export async function loadStockState(
  chain: StockChain,
  pool: ServiceRuntime["pool"],
  revealDelaySeconds: number,
): Promise<{ state: StockState; now: bigint; slot: number }> {
  const snapshot = await chain.snapshot(),
    now = snapshot.now;
  const limits = await chain.limits(snapshot, now);
  const budget = await stockBudget(pool, now);
  return {
    state: {
      ...snapshot,
      ...limits,
      budget,
      revealDelaySeconds,
      buckets: new Map(
        snapshot.machine.buckets.flatMap((b, index) =>
          b.class
            ? [
                [
                  index,
                  {
                    failing: true,
                    listedAt:
                      snapshot.machine.bucket_history[index]!.listed_ts > 0n
                        ? snapshot.machine.bucket_history[index]!.listed_ts
                        : null,
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    },
    now,
    slot: snapshot.slot,
  };
}

export async function collectQuotes(
  chain: StockChain,
  state: StockState,
  now: bigint,
  swap: ReturnType<typeof listingClients>["swap"],
  onReject: (bucket: number, reason: string) => void,
  smaller = false,
): Promise<StockQuote[]> {
  const quotes: StockQuote[] = [];
  for (const request of stockRequests(state, now)) {
    try {
      const evidence = await chain.evidence(state, request);
      let amount = smaller ? request.amount / 2n : request.amount;
      // X2 exact-in quote ladder, largest rung first, geometric reductions.
      for (
        let rung = 0;
        rung < MARKET.ladder.maxRungs && amount > 0n;
        rung++, amount /= 2n
      ) {
        const out =
          request.kind === EXEC_KIND.stockBuy
            ? await swap.quoteBuy(evidence.args.mint.toBase58(), amount)
            : await swap.quoteSell(evidence.args.mint.toBase58(), amount);
        const quote: StockQuote = {
          ...request,
          ...evidence,
          amount,
          args: { ...evidence.args, amount },
          outAmount: out.outAmount,
          minOut: out.minOut,
          impactBps: Math.abs(Number(out.priceImpact)) * 100,
        };
        const check = checkStockQuote(state, quote, now);
        if (!check.ok) {
          onReject(request.bucket, check.error);
          if (
            [
              "sponsored_price_stale",
              "OracleInvalid",
              "OracleStale",
              "OracleWide",
              "ExecInFlight",
              "Paused",
              "RoleDisabled",
            ].includes(check.error)
          )
            break;
        }
        quotes.push(quote);
        if (check.ok) break;
      }
    } catch {
      onReject(request.bucket, "stock_evidence_unavailable");
    }
  }
  return quotes;
}
export function createStockExtension(
  runtime: ServiceRuntime,
  source: NodeJS.ProcessEnv = process.env,
): KeeperExtension {
  return async ({ signal, assertLeader }) => {
    const active = () => {
      signal.throwIfAborted();
      assertLeader();
      runtime.guard?.assertAuthorized();
    };
    active();
    const cluster =
      runtime.env.CLUSTER === "mainnet-beta" ? "mainnet" : runtime.env.CLUSTER;
    const deployment = createDeploymentSelector({
      [cluster]: runtime.env.PROGRAM_ID,
    })(cluster);
    const connection = new Connection(runtime.env.RPC_URL, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
          ]),
        }),
    });
    if (cluster !== "localnet") {
      const genesis = await connection.getGenesisHash();
      if (genesis !== SOLANA_GENESIS_HASHES[cluster])
        throw new Error("stock_cluster_mismatch");
    }
    const chain = new StockChain(connection, deployment),
      store = new StockStore(runtime.pool, active, () => chain.now());
    const clients = listingClients(runtime.env.RPC_URL, source);
    const live = source.FLAG_KEEPER_STOCK_LIVE === "on";
    const protocolAddress = new PublicKey(
      z.string().min(1).parse(source.STOCK_PROTOCOL_LUT),
    );
    const lookup = async (key: PublicKey) => {
      const table = (await connection.getAddressLookupTable(key)).value;
      if (!table) throw new Error("stock_lookup_missing");
      return table;
    };
    const baseRpc = createTxRpc(runtime.rpc);
    let smaller = false;
    const rpc =
      live && cluster === "mainnet"
        ? privateLanding(
            baseRpc,
            z.string().url().parse(source.HELIUS_SENDER_URL),
            active,
            () => {
              smaller = true;
            },
          )
        : baseRpc;
    const conditions = new PersistentConditions();
    const condition = async (
      name: string,
      bad: boolean,
      now: bigint,
      payload: Record<string, string | number> = {},
    ) => {
      if (conditions.observe(name, bad, now))
        await runtime.alerts.alert(name, "warning", payload);
    };
    let lastReveal: bigint | null = null,
      revealDelay = randomInt(
        KEEPER_POLICY.revealDelaySecondsMin,
        KEEPER_POLICY.revealDelaySecondsMax + 1,
      );
    const recheck = async (state: StockState, now: bigint, slot: number) => {
      const [hour, minute] = HIT_LIST.dailyRecheckUtc.split(":").map(Number);
      const today =
        (now / 86400n) * 86400n + BigInt(hour! * 3600 + minute! * 60);
      const due = now >= today ? today : today - 86400n;
      for (const [index, bucket] of state.machine.buckets.entries()) {
        if (!bucket.class) continue;
        const kind = bucket.class === 1 ? "major" : "trending";
        const valid = (value: unknown) => {
          const parsed = listingReportSchema.safeParse(value);
          if (!parsed.success) return null;
          const r = parsed.data;
          if (
            r.mint !== bucket.mint.toBase58() ||
            r.class !== kind.toUpperCase() ||
            r.checkedAt > Date.now() ||
            BigInt(Math.floor(r.checkedAt / 1000)) < due ||
            !r.criteria.length ||
            r.pass !== r.criteria.every((c) => c.pass)
          )
            return null;
          return r;
        };
        const previous = await runtime.pool.query(
          "SELECT report FROM hitlist_reports WHERE mint=$1 AND class=$2 ORDER BY created_at DESC LIMIT 1",
          [bucket.mint.toBase58(), kind],
        );
        const checkedAt = valid(previous.rows[0]?.report);
        if (checkedAt) {
          const meta = state.buckets.get(index);
          if (meta) meta.failing = !checkedAt.pass;
          if (!checkedAt.pass)
            await runtime.alerts.alert(`stock_listing:${index}`, "warning", {
              mint: bucket.mint.toBase58(),
              command: `onepct-ops guardian DisableBucket --index ${index} --cluster ${cluster} --program-id ${deployment.programId.toBase58()} --rpc-url "$RPC_URL" --keypair "$GUARDIAN_KEYPAIR_PATH"`,
            });
          continue;
        }
        active();
        try {
          const { report, oracle } = await clients.check(
            bucket.mint.toBase58(),
            kind,
          );
          active();
          // New evidence must satisfy the same binding as cached evidence.
          if (!valid(report)) throw new Error("stock_listing_report_invalid");
          await saveReport(runtime.pool, report, oracle, slot);
          const meta = state.buckets.get(index);
          if (meta) meta.failing = !report.pass;
          if (!report.pass)
            await runtime.alerts.alert(`stock_listing:${index}`, "warning", {
              mint: bucket.mint.toBase58(),
              command: `onepct-ops guardian DisableBucket --index ${index} --cluster ${cluster} --program-id ${deployment.programId.toBase58()} --rpc-url "$RPC_URL" --keypair "$GUARDIAN_KEYPAIR_PATH"`,
            });
        } catch {
          active();
          const meta = state.buckets.get(index);
          if (meta) meta.failing = true;
          await runtime.alerts.alert(`stock_listing:${index}`, "warning", {
            reason: "recheck_unavailable",
            command: `onepct-ops guardian DisableBucket --index ${index} --cluster ${cluster} --program-id ${deployment.programId.toBase58()} --rpc-url "$RPC_URL" --keypair "$GUARDIAN_KEYPAIR_PATH"`,
          });
        }
      }
    };
    const send = async (id: string, plan: TxInstructionPlan) => {
      let safelyStopped = false;
      const sender = new TxSender({
        rpc: {
          ...rpc,
          async simulateTransaction(transaction, s) {
            // TxSender's second simulation happens before signing. A P3 guard
            // here retires this unsigned plan, just like the initial probe.
            const simulation = await rpc.simulateTransaction(transaction, s);
            active();
            const refusal = stockBuyGuardRefusal(simulation.err);
            if (refusal) {
              await store.update(id, { done: true, wait: refusal });
              throw new StockBuyWait(refusal);
            }
            return simulation;
          },
          async getLatestBlockhash(s) {
            const latest = await rpc.getLatestBlockhash(s);
            const previous = await runtime.pool.query(
              "SELECT id FROM stock_plans WHERE state->>'lastBlockhash'=$1 LIMIT 1",
              [latest.blockhash],
            );
            if (previous.rows.length > 0)
              throw new Error("stock_wait_new_blockhash");
            await store.update(id, { lastBlockhash: latest.blockhash });
            return latest;
          },
        },
        signer: runtime.key!,
        role: "keeper",
        journal: store,
        assertAuthorized: () => runtime.guard!.assertAuthorized(),
        assertLeader: active,
        ...SERVICES.keeper,
        cuMarginBps: SERVICES.landing.cuMarginBps,
        maxComputeUnitPriceMicroLamports:
          SERVICES.landing.maxComputeUnitPriceMicroLamports === null
            ? null
            : BigInt(SERVICES.landing.maxComputeUnitPriceMicroLamports),
      });
      const result = await sender.send({
        ...plan,
        job: id,
        signal,
        isComplete: async (commitment) => {
          const record = await store.read(id);
          if (!record) {
            await connection.getAccountInfo(
              machinePda(deployment.programId)[0],
              commitment,
            );
            return false;
          }
          const receipt = await connection.getTransaction(record.signature, {
            commitment,
            maxSupportedTransactionVersion: 0,
          });
          if (!receipt?.meta || receipt.meta.err !== null) return false;
          assertStockReceipt(record, receipt, deployment.programId);
          return true;
        },
        rebuild: async ({ reason, previous }) => {
          active();
          safelyStopped = true;
          let refusal = null;
          if (reason === "failed" && previous.finalized) {
            try {
              const receipt = await connection.getTransaction(
                previous.signature,
                {
                  commitment: "finalized",
                  maxSupportedTransactionVersion: 0,
                },
              );
              refusal = stockBuyGuardRefusal(receipt?.meta?.err);
            } catch {
              /* Final failure is already proved by TxSender. */
            }
          }
          active();
          if (refusal) {
            await store.update(id, { wait: refusal });
            runtime.logger.info(refusal, "stock waits before replanning");
          } else smaller = true;
          return null;
        },
      });
      active();
      if (safelyStopped || result.status === "skipped") {
        await store.update(id, { done: true });
        await runtime.pool.query(
          "UPDATE stock_trades SET status='skipped' WHERE plan_id=$1",
          [id],
        );
        return;
      }
      if (!result.signature) return;
      await runtime.pool.query(
        "UPDATE stock_trades SET signature=$2,status='sent' WHERE plan_id=$1",
        [id, result.signature],
      );
      // Keep an unfinalized success pending across leader changes and forks.
      if (!result.finalized) return;
      const tx = await connection.getTransaction(result.signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta || tx.meta.err !== null)
        throw new Error("stock_receipt_unavailable");
      const signed = await store.read(id);
      if (!signed || signed.signature !== result.signature)
        throw new Error("stock_receipt_mismatch");
      assertStockReceipt(signed, tx, deployment.programId);
      const parsed = parseOnepercentLogs({
        logs: tx.meta.logMessages ?? null,
        err: tx.meta.err,
        programId: deployment.programId.toBase58(),
      });
      const event = parsed.events.find((e) => e.name === "ExecEnded");
      if (!event || parsed.truncated || parsed.malformed) {
        // Execution is final; measurement is unavailable. Close atomically with
        // the durable diagnostic before emitting an alert that may itself fail.
        await store.completeIncompleteReceipt(id, result.signature, tx.slot);
        await runtime.alerts.alert(`stock_receipt:${id}`, "warning", {
          signature: result.signature,
          reason: "finalized_receipt_incomplete",
        });
        return;
      }
      const tradeRow = await runtime.pool.query(
        "SELECT out_amount::text,kind,bucket,mint,amount::text FROM stock_trades WHERE plan_id=$1",
        [id],
      );
      const t = z
        .object({
          out_amount: amountText,
          kind: z.number(),
          bucket: z.number(),
          mint: z.string(),
          amount: amountText,
        })
        .parse(tradeRow.rows[0]);
      if (
        event.data.kind !== t.kind ||
        event.data.bucket !== t.bucket ||
        event.data.mint !== t.mint ||
        event.data.amount !== t.amount
      )
        throw new Error("stock_receipt_mismatch");
      const slip =
        t.out_amount > 0n
          ? Number(
              ((t.out_amount - event.data.delta) * BigInt(BPS_DENOMINATOR)) /
                t.out_amount,
            )
          : 0;
      await runtime.pool.query(
        "UPDATE stock_trades SET delta=$2,slippage_bps=$3,status='confirmed',confirmed_at=now() WHERE plan_id=$1",
        [id, String(event.data.delta), slip],
      );
      runtime.metrics.stockSlippageBps.set({ kind: String(t.kind) }, slip);
      const bucketClass = (await chain.snapshot()).machine.buckets[t.bucket]!
        .class;
      runtime.metrics.stockTradesTotal.inc({
        kind: String(t.kind),
        class: String(bucketClass),
        result: "confirmed",
      });
      if (
        slip >
        (bucketClass === 1
          ? STOCK.majorMinOutSlipBps
          : STOCK.trendingMinOutSlipBps)
      )
        await runtime.alerts.alert(`stock_slippage:${t.bucket}`, "warning", {
          signature: result.signature,
          slippageBps: slip,
        });
      await store.update(id, { done: true });
    };
    let failureStreak = 0;
    while (!signal.aborted) {
      let failed = false;
      try {
        active();
        const pending = live ? await store.pending() : null;
        if (pending) {
          const plan = await store.restore(pending);
          if (plan) await send(pending, plan);
        } else {
          const snapshot = await loadStockState(
              chain,
              runtime.pool,
              revealDelay,
            ),
            { state, now, slot } = snapshot;
          if (state.lastReveal !== lastReveal) {
            lastReveal = state.lastReveal;
            revealDelay = randomInt(
              KEEPER_POLICY.revealDelaySecondsMin,
              KEEPER_POLICY.revealDelaySecondsMax + 1,
            );
            state.revealDelaySeconds = revealDelay;
          }
          if (state.buyBlockReason !== null) {
            failed = true;
            runtime.logger.info(
              { reason: state.buyBlockReason, slot },
              "stock buys wait for account bounds",
            );
          }
          await recheck(state, now, slot);
          active();
          // Monitor every listed MAJOR even when policy has no trade candidate.
          for (const [index, bucket] of state.machine.buckets.entries())
            if (bucket.class === 1) {
              let fresh = false;
              try {
                const feeds = [
                  bucket.oracle.toBytes(),
                  Buffer.from(HIT_LIST.solUsdPythFeedId, "hex"),
                ];
                const accounts = await Promise.all(
                  feeds.map((feed) => chain.read(sponsoredAccount(feed))),
                );
                fresh = accounts.every((account, i) =>
                  freshSponsored(account, feeds[i]!, now),
                );
              } catch {
                /* Missing oracle evidence remains unavailable. */
              }
              failed ||= !fresh;
              await condition(`stock_pyth:${index}`, !fresh, now, {
                mint: bucket.mint.toBase58(),
                reason: "sponsored_price_unavailable",
              });
            }
          const quotes = await collectQuotes(
            chain,
            state,
            now,
            clients.swap,
            (bucket, reason) =>
              runtime.logger.info({ bucket, reason }, "stock trade refused"),
            smaller,
          );
          const targets = stockTargets(state, now),
            machine = rotated(state, now).machine;
          await condition(
            "stock_sol_reserve",
            machine.stock_sol < targets.reserve,
            now,
          );
          await condition(
            "stock_anchor",
            targets.anchorIndex !== undefined &&
              machine.buckets[targets.anchorIndex]!.cost -
                machine.buckets[targets.anchorIndex]!.reserved <
                targets.anchor / BigInt(KEEPER_POLICY.anchorMultipleOfTopBlack),
            now,
          );
          const cap = stockCap(
            machine.hit_out_last_hour,
            machine.hit_out_this_hour,
          );
          for (const [side, used] of [
            ["buy", machine.stock_bought_hour],
            ["sell", machine.stock_sold_hour],
          ] as const) {
            const usage = Number((used * BigInt(BPS_DENOMINATOR)) / cap);
            runtime.metrics.stockHourlyUsageBps.set({ side }, usage);
            if (usage > SERVICES.monitor.stockCapUsageAlertBps)
              await runtime.alerts.alert(`stock_cap:${side}`, "warning", {
                usage,
              });
          }
          const trades = planStock(state, quotes, now),
            id = await store.record(state, slot, now, trades, live),
            trade = trades[0];
          if (trade) {
            const route = await buildRoute(state, trade, clients.swap, lookup);
            const fresh = await loadStockState(
              chain,
              runtime.pool,
              revealDelay,
            );
            await recheck(fresh.state, fresh.now, fresh.slot);
            const evidence = await chain.evidence(fresh.state, trade);
            const current = {
              ...trade,
              ...evidence,
              outAmount: route.outAmount,
              minOut: route.minOut,
            };
            const check = planStock(fresh.state, [current], fresh.now)[0];
            if (!check) {
              await store.update(id, { done: true });
              throw new Error("stock_fresh_plan_refused");
            }
            const protocolLut = await lookup(protocolAddress),
              latest = await connection.getLatestBlockhash("confirmed");
            const build = (units: number) =>
              buildStockTransaction({
                state: fresh.state,
                trade: check,
                route,
                now: fresh.now,
                blockhash: latest.blockhash,
                protocolLut,
                units,
                tip: cluster === "mainnet" ? senderTip : undefined,
              });
            const probe = build(1_400_000); // Solana transaction compute ceiling, not an economic parameter.
            const simulation = await connection.simulateTransaction(
              probe.transaction,
              { sigVerify: false, commitment: "confirmed" },
            );
            active();
            if (
              simulation.value.err !== null ||
              !simulation.value.unitsConsumed
            ) {
              const refusal = stockBuyGuardRefusal(simulation.value.err);
              await store.update(id, {
                done: true,
                ...(refusal ? { wait: refusal } : {}),
              });
              if (!refusal) smaller = true;
              if (refusal) throw new StockBuyWait(refusal);
              throw new Error("stock_simulation_failed");
            }
            const final = build(measuredUnits(simulation.value.unitsConsumed));
            await store.trade(id, check, live, "simulated");
            if (live) {
              const plan = {
                instructions: final.instructions,
                lookupTables: final.lookupTables,
                computeUnitLimit: simulation.value.unitsConsumed,
              };
              await store.savePlan(id, plan);
              await send(id, plan);
            } else
              runtime.logger.info(
                { plan: id, bytes: final.serializedSize, live: false },
                "stock dry run",
              );
          }
        }
      } catch (error) {
        failed = true;
        if (error instanceof StockBuyWait)
          runtime.logger.info(error.refusal, "stock waits before replanning");
        else if (!signal.aborted)
          runtime.logger.warn(
            { reason: "stock_cycle_failed" },
            "stock waits before replanning",
          );
      }
      failureStreak = failed
        ? Math.min(failureStreak + 1, SERVICES.keeper.sendMaxAttempts)
        : 0;
      const waitMs = failed
        ? Math.min(
            SERVICES.keeper.backoffMaxMs,
            Math.max(
              SERVICES.keeper.scanSeconds * 1000,
              SERVICES.keeper.backoffBaseMs * 2 ** failureStreak,
            ),
          )
        : randomInt(
            KEEPER_POLICY.cycleSecondsMin,
            KEEPER_POLICY.cycleSecondsMax + 1,
          ) * 1000;
      await delay(waitMs, undefined, { signal }).catch(() => undefined);
    }
  };
}
