import { PHASE } from "@onepercent/sdk/constants";
import { FeatureFlags } from "@onepercent/sdk/api";
import {
  SlidingWindowLimiter,
  hashClientIp,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { createPublicData } from "../public/data/index.js";
import { configBeforeProgram } from "../public/data/config.js";
import { createPublicVrf } from "../public/vrf.js";
import { InMemoryLinkRateLimiter, requestIp } from "../link/ratelimit.js";
import type { RipDependencies, RipSnapshot } from "./rip.js";
import { resolveActionCluster } from "./cluster.js";

export function createRipDependencies(
  runtime: ServiceRuntime | undefined,
  webOrigin: string,
  source: NodeJS.ProcessEnv = process.env,
): RipDependencies {
  const flags = FeatureFlags.parse(
    Object.fromEntries(
      Object.keys(FeatureFlags.shape).map((name) => [
        name,
        source[`FLAG_${name}`] === "on",
      ]),
    ),
  );
  const cluster = resolveActionCluster(runtime?.env?.CLUSTER, source.CLUSTER);
  const publicApiOrigin = source.PUBLIC_API_URL || webOrigin;
  const publicApiUrl = URL.parse(publicApiOrigin);
  if (
    !publicApiUrl ||
    !["http:", "https:"].includes(publicApiUrl.protocol) ||
    publicApiUrl.username ||
    publicApiUrl.password
  )
    throw new Error("Invalid API environment: PUBLIC_API_URL");
  // X-ray and health remain independent while Rip is dormant. Check the public
  // role before the first use of each chain, Redis or IP-salt dependency.
  const publicRuntime = () => {
    if (runtime && (runtime.role !== "public" || runtime.key))
      throw new Error("public_role_required");
    return runtime;
  };
  let data: ReturnType<typeof createPublicData> | undefined;
  const publicData = () => {
    const current = publicRuntime();
    if (!current) return undefined;
    data ??= createPublicData({
      runtime: current,
      flags,
      vrf: createPublicVrf(current),
    });
    return data;
  };
  let limiter: SlidingWindowLimiter | undefined;
  const memory = new InMemoryLinkRateLimiter();
  let cachedSnapshot: RipSnapshot | undefined;
  let pendingSnapshot: Promise<RipSnapshot> | undefined;
  async function readSnapshot(): Promise<RipSnapshot> {
    // Bound age from the start of the reads, including RPC latency.
    const asOfMs = Date.now();
    const active = flags.BLINKS_RIP && flags.PACKS ? publicData() : undefined;
    const config = active
      ? await active.config()
      : configBeforeProgram(
          {
            CLUSTER: cluster,
            PROGRAM_ID: runtime?.env?.PROGRAM_ID ?? source.PROGRAM_ID ?? "",
          },
          flags,
        );
    // A disabled or pre-deploy Blink does not require the machine to exist.
    if (
      !config.flags.BLINKS_RIP ||
      !config.flags.PACKS ||
      config.phase === null ||
      config.phase < PHASE.onAir
    )
      return { config, machine: null, nowTs: 0, asOfMs };
    const current = publicRuntime();
    if (!current || !active) throw new Error("rip_runtime_unavailable");
    const [machine, now] = await Promise.all([
      active.machine(),
      current.rpc.chainNow(),
    ]);
    const nowTs = Number(now);
    if (!Number.isSafeInteger(nowTs)) throw new Error("rip_chain_time_invalid");
    return { config, machine, nowTs, asOfMs };
  }
  return {
    webOrigin,
    publicApiOrigin,
    cluster,
    clock: Date.now,
    clientIp(context) {
      const current = publicRuntime();
      const ip = requestIp(context, source.TRUST_PROXY_HEADER);
      return current ? hashClientIp(current.env.LOG_IP_SALT, ip) : ip;
    },
    limiter: {
      consume(key, rule) {
        const current = publicRuntime();
        if (!current) return memory.consume(key, rule);
        limiter ??= new SlidingWindowLimiter(current.redis);
        return limiter.limit(
          `${cluster}:${current.env.PROGRAM_ID}:${key}`,
          rule.limit,
          rule.windowMs / 1_000,
        );
      },
    },
    rpc: {
      async request(method, params, schema, signal) {
        const current = publicRuntime();
        if (!current) throw new Error("rip_runtime_unavailable");
        return current.rpc.request(method, params, schema, signal);
      },
    },
    async snapshot(options) {
      if (options?.fresh) return readSnapshot();
      const now = Date.now();
      if (
        cachedSnapshot &&
        cachedSnapshot.asOfMs <= now &&
        cachedSnapshot.asOfMs + 2_000 > now
      )
        return cachedSnapshot;
      if (!pendingSnapshot)
        pendingSnapshot = readSnapshot()
          .then((snapshot) => {
            cachedSnapshot = snapshot;
            return snapshot;
          })
          .finally(() => {
            pendingSnapshot = undefined;
          });
      return pendingSnapshot;
    },
    onResult: (route, outcome, latencyMs) =>
      runtime?.logger.info({ route, outcome, latencyMs }, "blink request"),
  };
}
