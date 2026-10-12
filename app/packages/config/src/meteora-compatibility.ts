/** Devnet rehearsal only; deployment source provenance remains unproven. */
export const DEVNET_DBC_COMPATIBILITY = Object.freeze({
  name: "devnet-dbc-v1-zero-transfer-fee-v1",
  cluster: "devnet",
  version: 1,
} as const);
export function dbcCompatibilityProfile(cluster: string) {
  if (cluster === "devnet") return DEVNET_DBC_COMPATIBILITY;
  return { name: "dbc-v0-pinned", cluster, version: 0 } as const;
}
