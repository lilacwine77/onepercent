import {
  createDeploymentSelector,
  type ClusterDeployment,
} from "@onepercent/sdk/browser";

export function selectWebDeployment(
  binding: { cluster: string; programId: string } | null,
): ClusterDeployment {
  if (!binding) throw new Error("Web deployment is not configured");
  const cluster =
    binding.cluster === "mainnet-beta" ? "mainnet" : binding.cluster;
  return createDeploymentSelector({ [cluster]: binding.programId })(cluster);
}

/** Build-pinned identity remains available when API/config services are offline. */
export function webDeployment(): ClusterDeployment {
  return selectWebDeployment(__WEB_DEPLOYMENT__);
}
export function deploymentChain(): "solana:mainnet" | "solana:devnet" {
  return webDeployment().cluster === "mainnet"
    ? "solana:mainnet"
    : "solana:devnet";
}
