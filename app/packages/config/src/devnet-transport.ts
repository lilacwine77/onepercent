/** Off-chain devnet profile; never an input to mainnet K1/S3 settings. */
export const DEVNET_RPC_PROFILE = Object.freeze({
  name: "devnet-rpc-p75-v1",
  cluster: "devnet",
  percentile: 75,
  tipLamports: 0n,
  maxComputeUnitPriceMicroLamports: 1_000_000n,
} as const);

export function devnetTransportProfile(cluster: string) {
  if (cluster !== DEVNET_RPC_PROFILE.cluster)
    throw new Error("devnet_transport_requires_devnet");
  return DEVNET_RPC_PROFILE;
}
