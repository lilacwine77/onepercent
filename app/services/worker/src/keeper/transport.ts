import { devnetTransportProfile } from "@onepercent/config";

/** Devnet's operational cap is separate from the mainnet 24-hour measurement. */
export function keeperPriorityCap(
  cluster: string,
  measuredCap: number | null,
): bigint | null {
  if (cluster === "devnet")
    return devnetTransportProfile(cluster).maxComputeUnitPriceMicroLamports;
  return measuredCap === null ? null : BigInt(measuredCap);
}
