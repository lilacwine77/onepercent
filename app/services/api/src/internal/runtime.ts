import { PublicKey } from "@solana/web3.js";
import { createMintSafetyClient, type MarketEnv } from "@onepercent/market";
import {
  SlidingWindowLimiter,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import {
  createIntakeService,
  createFeedChainReader,
  createIntakeHistoryReader,
  createFeedLogWriter,
  createIntakeLiveReader,
} from "../intake/index.js";
import {
  createQuoteService,
  createQuoteStateReader,
  createQuoteValueClient,
  createQuoteLogWriter,
  type SellBackMessageEncoder,
} from "../quote/index.js";
import { createInternalSignerApp } from "./routes.js";
import { loadIntakeParams, loadQuoteRateParams } from "./params.js";

/** D22 startup mounts this app on S0's existing private server. */
export function createRuntimeSignerApp(
  runtime: ServiceRuntime,
  options: {
    marketEnv: MarketEnv;
    /** S1's completed poll time; must advance even when no program transaction lands. */
    indexerTime?: () => Promise<number>;
    /** Trusted historical evidence only; never populated from an HTTP request. */
    historyNormalization?: Parameters<typeof createIntakeHistoryReader>[1];
    /** Optional override, validated against the canonical message vectors. */
    sellBackEncoder?: SellBackMessageEncoder;
    fetch?: typeof fetch;
  },
) {
  if (
    !runtime.key ||
    !runtime.guard ||
    !runtime.env.INTERNAL_TOKEN ||
    !["intake-signer", "quote-signer"].includes(runtime.role)
  )
    throw new Error("signer_runtime_unavailable");
  const common = {
    programId: new PublicKey(runtime.env.PROGRAM_ID),
    signer: runtime.key,
    guard: runtime.guard,
    blockTimeNow: () => runtime.rpc.blockTimeNow(),
  };
  const router = {
    token: runtime.env.INTERNAL_TOKEN,
    limiter: new SlidingWindowLimiter(runtime.redis),
    metrics: runtime.metrics,
    logDecision: (fields: {
      role: string;
      result: string;
      durationMs: number;
    }) => runtime.logger.info(fields, "signer decision"),
  };
  const fetchImpl = options.fetch ?? fetch;
  if (runtime.role === "intake-signer") {
    if (!options.indexerTime) throw new Error("indexer_freshness_unavailable");
    const params = loadIntakeParams();
    const safety = createMintSafetyClient({
      env: options.marketEnv,
      fetch: fetchImpl,
      rpc: {
        call: (schema, method, params) =>
          runtime.rpc.request(method, params, schema),
      },
    });
    const chain = createFeedChainReader(runtime.rpc, common.programId, safety);
    const service = createIntakeService({
      ...common,
      params,
      readState: chain.state,
      readBag: chain.bag,
      history: createIntakeHistoryReader(
        runtime.rpc,
        options.historyNormalization,
        { evidenceCacheSeconds: params.SERVICES.signers.evidenceCacheSeconds },
      ),
      live: createIntakeLiveReader(runtime.pool),
      indexerTime: options.indexerTime,
      appendLogs: async (rows) => {
        await createFeedLogWriter(runtime.db)(rows);
        for (const row of rows)
          runtime.logger.info(
            { message_sha256: row.messageSha256 },
            "FEED attestation recorded",
          );
      },
    });
    return createInternalSignerApp({
      ...router,
      role: "intake-signer",
      rates: params.INTAKE,
      service,
    });
  }
  const rates = loadQuoteRateParams();
  const service = createQuoteService({
    ...common,
    readState: createQuoteStateReader(runtime.rpc, common.programId),
    valueNow: createQuoteValueClient({
      env: options.marketEnv,
      fetch: fetchImpl,
      rpc: runtime.rpc,
    }),
    appendLog: async (row) => {
      await createQuoteLogWriter(runtime.db)(row);
      runtime.logger.info(
        { message_sha256: row.messageSha256 },
        "Sell back quote recorded",
      );
    },
    encoder: options.sellBackEncoder,
  });
  return createInternalSignerApp({
    ...router,
    role: "quote-signer",
    rates,
    service,
  });
}
