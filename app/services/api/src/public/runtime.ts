import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import { PublicKey } from "@solana/web3.js";
import {
  SlidingWindowLimiter,
  type ServiceRuntime,
  safeCause,
  warnCause,
} from "@onepercent/service-kit";
import { loadPublicEnv } from "./env.js";
import { loadPublicSettings } from "./settings.js";
import { createPublicRouter, type PublicRouterOptions } from "./router.js";
import { createSignerProxy, createSignerReadiness } from "./signer.js";
import { createPublicEvents } from "./events.js";
import { createPublicValue } from "./value.js";
import { createPublicData } from "./data/index.js";
import { createPublicVrf } from "./vrf.js";
import { createPublicRpcClient } from "./rpc-transport.js";

/** Mount on the public ROLE only after S0's isolation check and runtime creation. */
export function createPublicApi(
  runtime: ServiceRuntime,
  source: NodeJS.ProcessEnv = process.env,
  composition: Pick<PublicRouterOptions, "includeHealth" | "includeCors"> = {},
) {
  if (runtime.role !== "public" || runtime.key)
    throw new Error("public_role_required");
  const env = loadPublicEnv(source);
  const settings = loadPublicSettings();
  const targets = {
    settings,
    intake:
      env.INTAKE_SIGNER_URL && env.INTAKE_INTERNAL_TOKEN
        ? { url: env.INTAKE_SIGNER_URL, token: env.INTAKE_INTERNAL_TOKEN }
        : undefined,
    quote:
      env.QUOTE_SIGNER_URL && env.QUOTE_INTERNAL_TOKEN
        ? { url: env.QUOTE_SIGNER_URL, token: env.QUOTE_INTERNAL_TOKEN }
        : undefined,
  };
  const signer = createSignerProxy(targets);
  const programId = new PublicKey(runtime.env.PROGRAM_ID);
  const [deck] = PublicKey.findProgramAddressSync(
    [Buffer.from("deck")],
    programId,
  );
  return createPublicRouter({
    ...composition,
    webOrigin: env.WEB_ORIGIN,
    version: runtime.env.APP_VERSION,
    commit: runtime.env.GIT_COMMIT,
    cacheNamespace: `${runtime.env.CLUSTER}:${programId.toBase58()}`,
    ipSalt: runtime.env.LOG_IP_SALT,
    settings,
    deck: deck.toBase58(),
    rpc: createPublicRpcClient({
      url: runtime.env.RPC_URL,
      transport: settings.transport,
      api: settings.api,
    }),
    cache: runtime.redis,
    data: createPublicData({
      runtime,
      flags: env.flags,
      vrf: createPublicVrf(runtime),
      signerReadiness: createSignerReadiness(targets),
    }),
    events: createPublicEvents(runtime, settings),
    limiter: new SlidingWindowLimiter(runtime.redis),
    signer,
    value: createPublicValue(runtime, source),
    clientIp(context) {
      let ip: string | undefined;
      if (env.TRUST_PROXY_HEADER)
        ip = context.req.header(env.TRUST_PROXY_HEADER)?.trim();
      else {
        try {
          ip = getConnInfo(context).remote.address;
        } catch (error) {
          warnCause("public_client_ip_unavailable", error);
          /* In-process adapters may not expose a socket. */
        }
      }
      return ip && isIP(ip) ? ip : "unknown";
    },
    onError: (code, error) =>
      runtime.logger.warn(
        { reason: code, cause: safeCause(error) },
        "public request unavailable",
      ),
  });
}
