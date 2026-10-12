import { SERVICES } from "@onepercent/config";
import type { PublicSettings } from "../settings.js";

// Explicit test settings; production requires the merged PARAMS exports.
export const settings: PublicSettings = {
  api: {
    ...SERVICES.api,
    machineMaxAgeMs: 2000,
    meCacheMs: 2000,
    rpcPerMinutePerIp: 600,
    rpcMaxDataSliceBytes: 65536,
    valuePerMinutePerIp: 60,
    ssePingSeconds: 15,
    sseReplayEvents: 500,
  },
  quote: { rateLimitPerMinutePerWallet: 30, rateLimitPerMinutePerIp: 60 },
  intake: { rateLimitPerMinutePerWallet: 30, rateLimitPerMinutePerIp: 60 },
  tx: { feedBagsPerTxWithLookupTable: 1, txPerSignAll: 8, redeemPerTx: 8 },
  transport: SERVICES.transport,
  indexer: { pollMs: 2000 },
};
