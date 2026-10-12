const normalizeCluster = (value) => {
  if (value === "mainnet-beta") return "mainnet";
  if (value === "localnet" || value === "devnet" || value === "mainnet")
    return value;
  throw new Error(`Unknown program cluster: ${value}`);
};

/** Resolve Anchor's explicit cluster before checking the compiled pin. */
export function anchorBuildCluster(args, environmentCluster) {
  let provider;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    let value;
    if (argument === "--provider.cluster") value = args[++index];
    else if (argument.startsWith("--provider.cluster="))
      value = argument.slice("--provider.cluster=".length);
    else continue;
    if (!value || value.startsWith("--"))
      throw new Error("--provider.cluster requires a value");
    if (provider !== undefined)
      throw new Error("--provider.cluster must be specified once");
    provider = value;
  }
  const configured =
    environmentCluster === undefined
      ? undefined
      : normalizeCluster(environmentCluster);
  if (provider === undefined) return configured ?? "localnet";
  if (/^https?:\/\//i.test(provider)) {
    if (configured === undefined)
      throw new Error(
        "A custom --provider.cluster URL requires explicit ONEPERCENT_CLUSTER",
      );
    return configured;
  }
  const selected = normalizeCluster(provider);
  if (configured !== undefined && selected !== configured)
    throw new Error(
      "--provider.cluster and ONEPERCENT_CLUSTER must select the same cluster",
    );
  return selected;
}

export { ONEPERCENT_PROGRAM_IDS as PROGRAM_IDS } from "./mainnet-pins.mjs";

/** Preserve other Cargo options and reject a mismatched or ambiguous cluster. */
export function clusterCargoArgs(args, cluster) {
  cluster = normalizeCluster(cluster);
  if (args.includes("--all-features"))
    throw new Error("--all-features would select mutually exclusive clusters");
  const selected = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value =
      arg === "--features" || arg === "-F"
        ? args[++i]
        : arg.startsWith("--features=")
          ? arg.slice(11)
          : arg.startsWith("-F")
            ? arg.slice(2)
            : undefined;
    if (value !== undefined) selected.push(...value.split(/[,\s]+/));
  }
  for (const name of ["devnet", "mainnet"])
    if (selected.includes(name) && name !== cluster)
      throw new Error(
        `Cargo feature ${name} conflicts with cluster ${cluster}`,
      );
  if (cluster === "localnet" || selected.includes(cluster)) return [...args];
  const separator = args.indexOf("--");
  const at = separator < 0 ? args.length : separator;
  return [...args.slice(0, at), "--features", cluster, ...args.slice(at)];
}

export function anchorClusterArgs(args, cluster) {
  const at = args.indexOf("--");
  const head = at < 0 ? args : args.slice(0, at);
  const tail = at < 0 ? [] : args.slice(at + 1);
  // Features are Cargo arguments, not Anchor flags.
  const cargo = clusterCargoArgs(tail, cluster);
  return cargo.length ? [...head, "--", ...cargo] : [...head];
}
