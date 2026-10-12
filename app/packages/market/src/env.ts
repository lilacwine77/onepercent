import { MarketError } from "./errors.js";
import { MARKET } from "./params.js";

export interface MarketEnv {
  jupiterApiKey?: string;
  pythHermesUrl: string;
  pythHermesApiKey?: string;
  solanaRpcUrl?: string;
}

function optionalValue(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function checkedUrl(value: string, variable: string): string {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("Invalid URL");
    }
    return value;
  } catch {
    throw new MarketError("INVALID_INPUT", { message: `Invalid ${variable}` });
  }
}

export function loadMarketEnv(
  source: Record<string, string | undefined> = process.env,
): MarketEnv {
  const jupiterApiKey = optionalValue(source["JUPITER_API_KEY"]);
  const pythHermesApiKey = optionalValue(source["PYTH_HERMES_API_KEY"]);
  const solanaRpcUrl = optionalValue(source["SOLANA_RPC_URL"]);
  return {
    pythHermesUrl: checkedUrl(
      optionalValue(source["PYTH_HERMES_URL"]) ?? MARKET.pyth.defaultHermesUrl,
      "PYTH_HERMES_URL",
    ),
    ...(jupiterApiKey === undefined ? {} : { jupiterApiKey }),
    ...(pythHermesApiKey === undefined ? {} : { pythHermesApiKey }),
    ...(solanaRpcUrl === undefined
      ? {}
      : { solanaRpcUrl: checkedUrl(solanaRpcUrl, "SOLANA_RPC_URL") }),
  };
}
