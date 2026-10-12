/** Only the two public deployment identifiers enter the browser bundle. */
export function browserDeployment(env) {
  const cluster = env.CLUSTER === "mainnet-beta" ? "mainnet" : env.CLUSTER;
  if (!env.PROGRAM_ID && !cluster) return null;
  if (!env.PROGRAM_ID || !["localnet", "devnet", "mainnet"].includes(cluster))
    throw new Error(
      "Configure CLUSTER and PROGRAM_ID together for the web build",
    );
  const walletCluster = cluster === "mainnet" ? "mainnet" : "devnet";
  if (env.VITE_CLUSTER && env.VITE_CLUSTER !== walletCluster)
    throw new Error("Web wallet cluster disagrees with deployment cluster");
  return { cluster, programId: env.PROGRAM_ID };
}
