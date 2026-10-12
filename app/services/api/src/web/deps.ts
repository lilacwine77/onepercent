import {
  createExitCapClient,
  createJupiterSwapClient,
  createJupiterTokensClient,
  createValueClient,
  createPriceSource,
  loadMarketEnv,
} from "@onepercent/market";
import { MARKET, SERVICES, WEB } from "@onepercent/config";
import { heliusRpcUrl, parseXrayEnv } from "../xray/env.js";
import { BeaconCounters, RedisCounterStore } from "./beacon.js";
import { LogoProxy } from "./logo.js";
import { ItemLimiter } from "./limits.js";
import { WebValues, type WebValueSources } from "./values.js";
import { readWebConfig } from "./web-config.js";
import { cacheMetadata, cacheExitCaps } from "./cache.js";
import { createWebLogger } from "./log.js";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { WebRoyalties } from "./royalties.js";
import { SignedTransactionSender } from "./send.js";
import { createPublicRpcClient } from "../public/rpc-transport.js";
import { loadPublicSettings } from "../public/settings.js";
import { createPublicEvents } from "../public/events.js";
import { pollEvents } from "./events.js";
import { createHighlights } from "./highlights.js";
export function createWebDependencies(
  env: NodeJS.ProcessEnv = {},
  runtime?: Pick<ServiceRuntime, "pool" | "env" | "redis">,
) {
  const xray = parseXrayEnv(env);
  const logger = createWebLogger(env);
  let sending:
    { sender: SignedTransactionSender; limiter: ItemLimiter } | undefined;
  const sendDependencies = () => {
    if (!sending) {
      // B14 bootstrap and credential checks must not depend on G1/P0 settings.
      const publicSettings = loadPublicSettings();
      sending = {
        sender: new SignedTransactionSender(
          runtime
            ? createPublicRpcClient({
                url: runtime.env.RPC_URL,
                transport: publicSettings.transport,
                api: publicSettings.api,
              })
            : undefined,
        ),
        limiter: new ItemLimiter(publicSettings.api.rpcPerMinutePerIp),
      };
    }
    return sending;
  };
  let sources: WebValueSources = {
    metadata: async () => ({}),
    prices: {
      getPrices: async () => ({}),
      getSolUsd: async () => {
        throw new Error("Display sources unavailable");
      },
    },
    getExitCap: async () => ({ kind: "none" }),
    valueNow: async () => ({ status: "unavailable", reason: "PROVIDER_ERROR" }),
  };
  if (xray.XRAY_SOURCE === "live") {
    const marketEnv = loadMarketEnv({
      ...env,
      SOLANA_RPC_URL: heliusRpcUrl(xray),
    });
    const options = { fetch, env: marketEnv };
    const tokens = createJupiterTokensClient(options),
      swaps = createJupiterSwapClient(options),
      caps = createExitCapClient(options);
    const getExitCap = cacheExitCaps((mint) => caps.getExitCap(mint));
    sources = {
      metadata: cacheMetadata(async (mints) => {
        const found = await tokens.getTokens(mints);
        return Object.fromEntries(
          mints.map((mint) => {
            const token = found[mint];
            return [
              mint,
              token
                ? {
                    symbol: token.symbol,
                    name: token.name,
                    decimals: token.decimals,
                    ...(token.icon ? { logoURI: token.icon } : {}),
                  }
                : undefined,
            ];
          }),
        );
      }),
      prices: createPriceSource({
        ...options,
        maxPriceAgeSlots: MARKET.price.maxAgeSlots,
      }),
      getExitCap,
      valueNow: createValueClient({
        quoteSell: (mint, amount) => swaps.quoteSell(mint, amount),
        getExitCap,
      }).valueNow,
    };
  }
  return {
    logger,
    config: readWebConfig(env),
    royalties: new WebRoyalties(runtime?.pool),
    get sender() {
      return sendDependencies().sender;
    },
    set sender(value: SignedTransactionSender) {
      sendDependencies().sender = value;
    },
    get sendLimiter() {
      return sendDependencies().limiter;
    },
    set sendLimiter(value: ItemLimiter) {
      sendDependencies().limiter = value;
    },
    values: new WebValues(sources),
    logos: new LogoProxy(sources.metadata),
    counters: new BeaconCounters(
      env.REDIS_URL ? new RedisCounterStore(env.REDIS_URL, logger) : undefined,
    ),
    valuesLimiter: new ItemLimiter(WEB.valuesNowPerMinutePerIp),
    logoLimiter: new ItemLimiter(WEB.valuesNowPerMinutePerIp),
    beaconLimiter: new ItemLimiter(WEB.beaconPerMinutePerIp),
    // Keep bootstrap config reachable while the public parameters are unavailable.
    liveLimiter: SERVICES.api
      ? new ItemLimiter(SERVICES.api.rpcPerMinutePerIp)
      : null,
    events: runtime
      ? (after?: string) =>
          pollEvents(createPublicEvents(runtime, loadPublicSettings()), after)
      : async () => {
          throw new Error("Event source unavailable");
        },
    highlights: runtime
      ? createHighlights(runtime.pool)
      : async () => {
          throw new Error("Highlights unavailable");
        },
    trustedProxyHeader: xray.TRUST_PROXY_HEADER,
    webOrigin: env.WEB_ORIGIN || "http://localhost:5173",
  };
}
export type WebDependencies = ReturnType<typeof createWebDependencies>;
