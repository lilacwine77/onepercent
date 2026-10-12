import {
  METEORA_BY_CLUSTER,
  ONEPERCENT_PROGRAM_IDS,
  meteoraForCluster,
  parseProgramCluster,
  type ProgramCluster,
} from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";

class Deployment {
  readonly #cluster: ProgramCluster;
  readonly #programId: string;

  constructor(cluster: ProgramCluster, programId: string) {
    this.#cluster = cluster;
    this.#programId = programId;
    Object.freeze(this);
  }

  get cluster(): ProgramCluster {
    return this.#cluster;
  }

  get programId(): PublicKey {
    return new PublicKey(this.#programId);
  }

  /** D32 pins the public config address before its account is created. */
  get meteoraConfigPin(): string | null {
    return METEORA_BY_CLUSTER[this.#cluster].dbcConfig === "PENDING"
      ? null
      : this.meteora.dbcConfig;
  }

  get meteora(): Readonly<ReturnType<typeof meteoraForCluster>> {
    return Object.freeze({ ...meteoraForCluster(this.#cluster) });
  }
}

/** A selected deployment can only be created by the cluster selector. */
export type ClusterDeployment = Deployment;

/** Snapshot caller configuration once; every selection requires an explicit cluster. */
export function createDeploymentSelector(
  programIds: Partial<
    Record<ProgramCluster, string | PublicKey | null | undefined>
  > = ONEPERCENT_PROGRAM_IDS,
): (cluster: string) => ClusterDeployment {
  const ids = new Map<ProgramCluster, string>();
  for (const cluster of ["localnet", "devnet", "mainnet"] as const) {
    const value = programIds[cluster];
    if (value !== null && value !== undefined)
      ids.set(cluster, new PublicKey(value).toBase58());
  }
  return (cluster: string): ClusterDeployment => {
    if (typeof cluster !== "string" || cluster.length === 0)
      throw new Error("An explicit program cluster is required");
    const selected = parseProgramCluster(cluster);
    const programId = ids.get(selected);
    if (!programId)
      throw new Error(`Program ID is not configured for ${selected}`);
    return new Deployment(selected, programId);
  };
}
