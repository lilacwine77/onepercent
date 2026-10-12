import type { ExitCapSource } from "./provider-types.js";
import { API_LOGS } from "@onepercent/eligibility/copy";
import { parseXrayEnv, heliusRpcUrl, type XrayEnv } from "./env.js";
import { HeliusChainSource } from "./helius.js";
import { JupiterPriceSource } from "./price-source.js";
import { createMarketExitCaps } from "./market-exit-caps.js";
import { SnsNameResolver } from "./names.js";
import { createFixtureSources } from "./fixture-source.js";
import { XrayService } from "./service.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import {
  NoopTurnstileVerifier,
  CloudflareTurnstileVerifier,
  type XrayLogger,
} from "./turnstile.js";
import { SharePageRenderer } from "./share-page.js";
import type { XrayRouterDependencies } from "./router.js";

export async function createXrayDependencies(
  input: NodeJS.ProcessEnv = {},
  logger?: XrayLogger,
  adapters: { exitCaps?: ExitCapSource; fetch?: typeof fetch } = {},
): Promise<XrayRouterDependencies> {
  return createXrayDependenciesFromEnv(parseXrayEnv(input), logger, adapters);
}

async function createXrayDependenciesFromEnv(
  env: XrayEnv,
  logger?: XrayLogger,
  adapters: { exitCaps?: ExitCapSource; fetch?: typeof fetch } = {},
): Promise<XrayRouterDependencies> {
  let service: XrayService;
  const common = {
    publicWebUrl: env.PUBLIC_WEB_URL,
    publicApiUrl: env.PUBLIC_API_URL,
    logger,
    snsEnabled: env.XRAY_SNS_ENABLED,
    exitCaps: adapters.exitCaps,
  };
  if (env.XRAY_SOURCE === "fixtures") {
    logger?.info({}, API_LOGS.fixtures);
    const fixtures = await createFixtureSources();
    service = new XrayService({
      ...common,
      ...fixtures,
      slotS: env.FEED_SNAPSHOT_SLOT ?? fixtures.slotS,
      allowedAddresses: new Set(Object.values(fixtures.owners)),
      exitCaps: adapters.exitCaps ?? fixtures.exitCaps,
    });
  } else {
    const rpcUrl = heliusRpcUrl(env);
    const chain = new HeliusChainSource({ rpcUrl, fetch: adapters.fetch });
    const prices = new JupiterPriceSource(chain, {
      apiKey: env.JUPITER_API_KEY,
      fetch: adapters.fetch,
      maxRps: env.JUPITER_MAX_RPS,
    });
    service = new XrayService({
      ...common,
      chain,
      prices,
      exitCaps:
        adapters.exitCaps ??
        createMarketExitCaps({ rpcUrl, fetch: adapters.fetch }),
      names: new SnsNameResolver(rpcUrl, env.XRAY_SNS_ENABLED),
      slotS: env.FEED_SNAPSHOT_SLOT,
    });
  }
  return {
    service,
    env,
    limiter: new SlidingWindowRateLimiter(),
    turnstile:
      env.XRAY_SOURCE === "fixtures"
        ? new NoopTurnstileVerifier(logger)
        : new CloudflareTurnstileVerifier(
            env.TURNSTILE_SECRET!,
            env.PUBLIC_WEB_URL,
          ),
    sharePage: new SharePageRenderer(env.PUBLIC_WEB_URL, env.WEB_SHELL_URL),
  };
}
let defaultDependencies: Promise<XrayRouterDependencies> | undefined;
export function getDefaultXrayDependencies(
  env?: XrayEnv,
  logger?: XrayLogger,
): Promise<XrayRouterDependencies> {
  defaultDependencies ??= createXrayDependenciesFromEnv(
    env ?? parseXrayEnv(process.env),
    logger,
  ).catch((error: unknown) => {
    defaultDependencies = undefined;
    throw error;
  });
  return defaultDependencies;
}
