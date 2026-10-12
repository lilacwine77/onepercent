import { BPS_DENOMINATOR, TOKEN_1PCT } from "@onepercent/config";
import { U64_MAX } from "../bytes.js";
import type { PumpFeeConfig, PumpGlobal } from "./layouts.js";

// Reverse quote and fee selection: pump-public-docs 2293f9a6 FEE_PROGRAM_README.md; M4 §10.2.
export function devBuyQuoteDetails(
  global: PumpGlobal,
  feeConfig: PumpFeeConfig,
  tokens: bigint = TOKEN_1PCT.devBuyAmount,
) {
  const virtualToken = global.initialVirtualTokenReserves,
    virtualSol = global.initialVirtualSolReserves;
  if (
    tokens <= 0n ||
    tokens > U64_MAX ||
    virtualToken <= tokens ||
    virtualSol <= 0n ||
    tokens > global.initialRealTokenReserves
  )
    throw new RangeError("Invalid initial dev-buy reserves or amount");
  if (!feeConfig.feeTiers.length) throw new Error("Pump fee tiers are missing");
  for (let i = 1; i < feeConfig.feeTiers.length; i++)
    if (
      feeConfig.feeTiers[i]!.marketCapLamportsThreshold <=
      feeConfig.feeTiers[i - 1]!.marketCapLamportsThreshold
    )
      throw new Error("Pump fee tiers are not strictly increasing");
  const marketCapLamports =
    (virtualSol * global.tokenTotalSupply) / virtualToken;
  let tier = feeConfig.feeTiers[0]!;
  for (const candidate of feeConfig.feeTiers)
    if (marketCapLamports >= candidate.marketCapLamportsThreshold)
      tier = candidate;
  const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
  const netLamports = ceil(tokens * virtualSol, virtualToken - tokens) + 1n;
  const bps = BigInt(BPS_DENOMINATOR);
  const maxSolCost = ceil(
    netLamports * (bps + tier.fees.protocolFeeBps + tier.fees.creatorFeeBps),
    bps,
  );
  if (maxSolCost > U64_MAX) throw new RangeError("Dev-buy cost exceeds u64");
  return {
    tokens,
    marketCapLamports,
    netLamports,
    maxSolCost,
    protocolFeeBps: tier.fees.protocolFeeBps,
    creatorFeeBps: tier.fees.creatorFeeBps,
    feeTierThreshold: tier.marketCapLamportsThreshold,
  };
}
export function devBuyQuote(
  global: PumpGlobal,
  feeConfig: PumpFeeConfig,
  tokens: bigint = TOKEN_1PCT.devBuyAmount,
): bigint {
  return devBuyQuoteDetails(global, feeConfig, tokens).maxSolCost;
}
