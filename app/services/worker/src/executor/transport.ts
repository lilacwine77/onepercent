import { devnetTransportProfile } from "@onepercent/config";

/** Reuse the approved devnet transport without filling mainnet measurements. */
export function executorTransport(
  cluster: string,
  measured: {
    tipLamports: number | null;
    maxComputeUnitPriceMicroLamports: number | null;
  },
) {
  if (cluster === "devnet") return devnetTransportProfile(cluster);
  return {
    tipLamports:
      measured.tipLamports === null ? null : BigInt(measured.tipLamports),
    maxComputeUnitPriceMicroLamports:
      measured.maxComputeUnitPriceMicroLamports === null
        ? null
        : BigInt(measured.maxComputeUnitPriceMicroLamports),
  };
}
