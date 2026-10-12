import { Connection, PublicKey } from "@solana/web3.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { KEEPER_POLICY, MAINNET_GENESIS_HASH } from "@onepercent/config";
import { createDatabase } from "@onepercent/db";
import { createDeploymentSelector } from "@onepercent/sdk";
import { listingClients } from "@onepercent/cli/hitlist";
import { StockChain } from "./chain.js";
import { collectQuotes, loadStockState } from "./runtime.js";
import { planStock } from "./planner.js";
import { buildRoute, buildStockTransaction, measuredUnits } from "./builder.js";
import { StockStore, json } from "./store.js";
import { senderTip } from "./landing.js";

export async function runStockDryRun(
  args = process.argv.slice(2),
  source: NodeJS.ProcessEnv = process.env,
) {
  const [flag, cluster] = args;
  if (flag !== "--cluster" || cluster !== "mainnet")
    throw new Error("Usage: stock:dry-run --cluster mainnet");
  const connection = new Connection(
    z
      .string()
      .url()
      .parse(source.RPC_URL ?? source.SOLANA_RPC_URL),
    "confirmed",
  );
  if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
    throw new Error("cluster_mismatch");
  const deployment = createDeploymentSelector({
    mainnet: z.string().min(1).parse(source.PROGRAM_ID),
  })("mainnet");
  const database = createDatabase({
    connectionString: z.string().min(1).parse(source.DATABASE_URL),
  });
  try {
    const chain = new StockChain(connection, deployment),
      store = new StockStore(database.pool, () => {});
    const { state, slot, now } = await loadStockState(
      chain,
      database.pool,
      KEEPER_POLICY.revealDelaySecondsMax,
    );
    const clients = listingClients(connection.rpcEndpoint);
    for (const [index, meta] of state.buckets) {
      const bucket = state.machine.buckets[index]!;
      try {
        const { report } = await clients.check(
          bucket.mint.toBase58(),
          bucket.class === 1 ? "major" : "trending",
        );
        meta.failing = !report.pass;
      } catch {
        meta.failing = true;
      }
    }
    const refusals: Array<{ bucket: number; reason: string }> = [];
    const quotes = await collectQuotes(
      chain,
      state,
      now,
      clients.swap,
      (bucket, reason) => refusals.push({ bucket, reason }),
    );
    const plan = planStock(state, quotes, now),
      id = await store.record(state, slot, now, plan, false);
    const lookup = async (key: PublicKey) => {
      const table = (await connection.getAddressLookupTable(key)).value;
      if (!table) throw new Error("stock_lookup_missing");
      return table;
    };
    const results = [];
    for (const trade of plan) {
      const route = await buildRoute(state, trade, clients.swap, lookup),
        protocolLut = await lookup(
          new PublicKey(z.string().min(1).parse(source.STOCK_PROTOCOL_LUT)),
        );
      const blockhash = (await connection.getLatestBlockhash()).blockhash;
      const input = {
        state,
        trade,
        route,
        protocolLut,
        blockhash,
        now,
        tip: senderTip,
      };
      const probe = buildStockTransaction({ ...input, units: 1_400_000 });
      const simulation = await connection.simulateTransaction(
        probe.transaction,
        { sigVerify: false },
      );
      if (simulation.value.err !== null || !simulation.value.unitsConsumed)
        throw new Error("stock_simulation_failed");
      const built = buildStockTransaction({
        ...input,
        units: measuredUnits(simulation.value.unitsConsumed),
      });
      await store.trade(id, trade, false, "simulated");
      results.push({
        bucket: trade.bucket,
        kind: trade.kind,
        amount: trade.amount,
        minOut: trade.onchainMinOut,
        bytes: built.serializedSize,
        units: simulation.value.unitsConsumed,
      });
    }
    console.log(
      json({
        live: false,
        slot,
        now,
        buyBlockReason: state.buyBlockReason,
        results,
        refusals,
      }),
    );
  } finally {
    await database.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runStockDryRun().catch(() => {
    console.error(
      "stock_dry_run_unavailable: check public RPC, program accounts, database and protocol LUT configuration",
    );
    process.exitCode = 1;
  });
