export type ActionCluster = "mainnet-beta" | "devnet" | "localnet";

export function resolveActionCluster(...candidates: unknown[]): ActionCluster {
  for (const candidate of candidates)
    if (
      candidate === "mainnet-beta" ||
      candidate === "devnet" ||
      candidate === "localnet"
    )
      return candidate;
  return "mainnet-beta";
}
