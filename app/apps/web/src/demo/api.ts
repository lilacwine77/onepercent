/**
 * PREVIEW builds only: routes the app's /api/* calls per flow. Live flows reach
 * the real API (same origin, behind Caddy); demo flows get the demo machine's
 * answers, in the same shapes and parsed by the same schemas as production.
 * Without an API at all (a static preview), every flow is demo.
 */
import { WebConfigResponse, type WebConfig } from "@onepercent/web-api";
import { ConfigResponse } from "@onepercent/sdk/api";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { SAMPLE_BAGS, SAMPLE_EMPTIES } from "./data";
import { machineFlows, type Modes } from "./modes";
import { demo } from "./store";
import { buildXray } from "./xray";
import xrayCard from "./xray-card.png";

const SYSTEM = "11111111111111111111111111111111";
const now = () => Math.floor(Date.now() / 1000);
// Validated with the app's schemas, returned raw (they transform u64 strings to bigint).
const valid = <T>(schema: { parse(value: unknown): unknown }, value: T) => (
  schema.parse(value),
  value
);
/** The demo machine: On Air, every machine flag on. */
const config = () =>
  valid(ConfigResponse, {
    asOfSlot: 412000000,
    cluster: "devnet",
    programId: SYSTEM,
    flags: {
      XRAY: true,
      FEED: true,
      PACKS: true,
      SELL_BACK: true,
      SOUND: true,
      TV_LIVE: false,
      BOARDS: false,
      HOLDER_BOOST: false,
    },
    paramsHash: "0".repeat(64),
    phase: 3,
    roles: {
      keeper: SYSTEM,
      executor: SYSTEM,
      intakeSigner: SYSTEM,
      quoteSigner: SYSTEM,
      teamWallet: SYSTEM,
      teamWallets: [SYSTEM],
    },
    vrf: { queues: [SYSTEM], activeIndex: 0 },
    season: {
      snapshotSlot: "400000000",
      snapshotTs: now() - 9 * 86_400,
      stockUpTs: now() - 3 * 86_400,
      powerOnTs: now() - 86_400,
      onAirTs: now() - 3_600,
      endTs: now() + 6 * 86_400,
      finalTs: now() + 7 * 86_400,
    },
    paused: 0,
  });
const json = (body: unknown, status = 200, delay = 160) =>
  new Promise<Response>((resolve) =>
    setTimeout(
      () =>
        resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      delay,
    ),
  );

/**
 * @param web the API's web config, or null when the preview runs without an API
 */
export function installApi(modes: Modes, web: WebConfig | null) {
  const original = window.fetch.bind(window);
  const machine = machineFlows(modes);
  window.fetch = async (input, init) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(href, window.location.href);
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith("/api/")
    )
      return original(input, init);
    const path = url.pathname;
    if (path === "/api/web/config" && !web)
      return json(
        valid(WebConfigResponse, {
          lookupTable: null,
          adminMultisig: null,
          flags: { XRAY: true },
          modes,
        }),
      );
    // Shared chain reads are real as soon as any machine flow is live.
    if (path === "/api/config" && (machine || !web)) return json(config());
    if (path === "/api/rpc" && (machine || !web)) {
      const { method, id } = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        id?: number;
      };
      if (method === "getSlot")
        return json({ jsonrpc: "2.0", id, result: 412_000_000 });
      if (method === "getBlockTime")
        return json({ jsonrpc: "2.0", id, result: now() });
      if (web) return original(input, init);
      return json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Demo" },
      });
    }
    const xray = /^\/api\/xray\/([^/]+)$/.exec(path);
    if (xray && modes.xray === "live" && web) {
      // A live scan of the demo wallet also gives the demo flows their bags.
      const response = await original(input, init);
      if (response.ok)
        void response
          .clone()
          .json()
          .then((body) => {
            const parsed = XrayResultSchema.safeParse(body);
            if (parsed.success) demo.seed(parsed.data);
          })
          .catch(() => undefined);
      return response;
    }
    if (xray) {
      const address = decodeURIComponent(xray[1]!);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
        return json(
          {
            error: "invalid_address",
            message: "That’s not a Solana wallet address.",
          },
          400,
        );
      const state = demo.get();
      const own = address === state.address && state.source !== null;
      const result = buildXray(
        address,
        own ? state.bags : SAMPLE_BAGS,
        own ? state.empties : SAMPLE_EMPTIES,
        window.location.origin,
        xrayCard,
      );
      return json(valid(XrayResultSchema, result), 200, 900);
    }
    if (!web) {
      if (path === "/api/beacon") return new Response(null, { status: 204 });
      return json({ error: "not_found" }, 404);
    }
    return original(input, init);
  };
  // Without an API, first-party analytics have nowhere to go.
  if (!web) navigator.sendBeacon = () => true;
}
