import * as config from "@onepercent/config";

const id = "\0onepercent-browser-params";
const names = [
  "ACCOUNT_SIZES",
  "ATTESTATIONS",
  "BPS_DENOMINATOR",
  "CARDS_PER_PACK",
  "CARD_KINDS",
  "COVERAGE",
  "CREATOR_FEE_SPLIT_BPS",
  "CU_LIMITS",
  "DRAW_TAGS",
  "FEED_RULES",
  "GOVERNANCE",
  "HIT_ODDS",
  "HIT_TIERS",
  "JACKPOT",
  "MAX_LIST_PER_RIP_LAMPORTS",
  "ONEPERCENT_PROGRAM_IDS",
  "PACK_EDITIONS",
  "PACK_SPLIT_BPS",
  "PAUSE_BITS",
  "PPB_DENOMINATOR",
  "PROGRAM_IDS",
  "PUMP_LAYOUTS",
  "RESCUE",
  "SEASON",
  "SELL_BACK",
  "STOCK",
  "TOKEN_1PCT",
  "TX_LIMITS",
  "UI",
  "VRF",
  "WEB",
  "WSOL_MINT",
  "XRAY",
];
function literal(value) {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return `[${value.map(literal).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}:${literal(item)}`)
      .join(",")}}`;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === null ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  throw new Error("Browser parameters must contain only static values");
}

/** Compile authoritative values, never the root validation/service modules, into browser SDK callers. */
export function browserParamsSource(sourceConfig = config) {
  const selected = Object.fromEntries(
    names.map((name) => [name, sourceConfig[name]]),
  );
  // Project only the operational values used by browser reads and simulation.
  selected.SERVICES = {
    api: {
      rpcMaxDataSliceBytes: sourceConfig.SERVICES.api.rpcMaxDataSliceBytes,
      rpcPerMinutePerIp: sourceConfig.SERVICES.api.rpcPerMinutePerIp,
    },
    indexer: { deckChunkBytes: sourceConfig.SERVICES.indexer.deckChunkBytes },
    transport: { rpcTimeoutMs: sourceConfig.SERVICES.transport.rpcTimeoutMs },
    landing: { cuMarginBps: sourceConfig.SERVICES.landing.cuMarginBps },
  };
  // Upstream M4 SDK exports launch builders from its root. Project their public
  // cluster selector only when available; execute the authoritative guards at
  // build time, retaining both valid results and rejected mainnet configurations.
  let meteoraSource =
    '\nexport function parseProgramCluster(value="localnet"){if(value==="mainnet-beta")return "mainnet";if(["localnet","devnet","mainnet"].includes(value))return value;throw new Error("Unknown program cluster: "+value);}';
  if (typeof sourceConfig.meteoraForCluster === "function") {
    if (!sourceConfig.METEORA_BY_CLUSTER)
      throw new Error("Missing Meteora cluster parameters");
    selected.METEORA_BY_CLUSTER = sourceConfig.METEORA_BY_CLUSTER;
    if (sourceConfig.METEORA) selected.METEORA = sourceConfig.METEORA;
    const decisions = Object.fromEntries(
      ["localnet", "devnet", "mainnet"].map((cluster) => {
        try {
          return [cluster, { value: sourceConfig.meteoraForCluster(cluster) }];
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          return [cluster, { error: error.message }];
        }
      }),
    );
    meteoraSource += `\nconst meteoraDecisions=${literal(decisions)};\nexport function meteoraForCluster(cluster){if(!Object.hasOwn(meteoraDecisions,cluster))throw new Error("Unknown program cluster");const decision=meteoraDecisions[cluster];if("error" in decision)throw new Error(decision.error);return Object.freeze({...decision.value});}`;
  }
  return (
    Object.entries(selected)
      .map(([name, value]) => `export const ${name}=${literal(value)};`)
      .join("\n") + meteoraSource
  );
}

export function browserParams() {
  return {
    name: "onepercent-browser-params",
    enforce: "pre",
    // Unit tests consume original exports; production and dev browsers use the same static projection.
    resolveId(source) {
      if (source === "@onepercent/config") return id;
    },
    load(source) {
      if (source === id) return browserParamsSource();
    },
  };
}
