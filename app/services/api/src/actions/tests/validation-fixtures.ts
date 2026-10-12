import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { ConfigResponse, MachineResponse } from "@onepercent/sdk/api";
import { PAUSE_BITS } from "@onepercent/config";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { defaultDeps } from "../../link/index.js";
import * as publicFixture from "../../public/__fixtures__/responses.js";
import { registerActions } from "../index.js";
import type { RipDependencies, RipSnapshot } from "../rip.js";

export const CHECK_STATES = [
  "off",
  "beforeOnAir",
  "seasonOver",
  "paused",
  "busy",
  "hungry",
  "refilling",
  "covered1",
  "covered5",
] as const;
export type CheckState = (typeof CHECK_STATES)[number];
const fixturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
  "base64",
);
const xrayResult = XrayResultSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../__fixtures__/xray-result.json", import.meta.url),
      "utf8",
    ),
  ),
);
export function fixtureSnapshot(
  state: CheckState,
  now = Date.now(),
): RipSnapshot {
  const config = ConfigResponse.parse({
    ...publicFixture.config,
    cluster: "devnet",
    flags: { ...publicFixture.flags, BLINKS_RIP: true, PACKS: true },
    phase: 3,
    season: {
      ...publicFixture.config.season,
      endTs: Math.floor(now / 1_000) + 86_400,
    },
  });
  const machine = MachineResponse.parse({
    ...publicFixture.machine,
    phase: 3,
    coverage: { maxQty: [5, 5, 5, 5] },
    deck: { len: 100, reservedDust: "0", free: 100 },
  });
  if (state === "off") config.flags.BLINKS_RIP = false;
  if (state === "beforeOnAir") config.phase = 2;
  if (state === "seasonOver") config.phase = 4;
  if (state === "paused") config.paused = PAUSE_BITS.rip;
  if (state === "busy") machine.vrf.busy = true;
  if (state === "hungry") machine.deck.free = 0;
  if (state === "refilling") machine.coverage.maxQty = [0, 0, 0, 0];
  if (state === "covered1") machine.coverage.maxQty = [1, 1, 1, 1];
  return { config, machine, nowTs: Math.floor(now / 1_000), asOfMs: now };
}
export function createCheckFixture(
  state: CheckState,
  origin = "https://onepercent.test",
  xrayState: "wallet" | "empty" | "busy" = "wallet",
) {
  const app = new Hono();
  // The API fixture models the web-hosted static icon and the existing X-ray image host.
  // Rip image requests below use the real B2 renderer and middleware.
  for (const path of ["/assets/pack-3d.png", "/fixtures/xray.png"])
    app.get(path, (context) => {
      context.header("Content-Type", "image/png");
      context.header("Cache-Control", "public, max-age=3600");
      return context.body(new Uint8Array(fixturePng));
    });
  const rip: RipDependencies = {
    webOrigin: origin,
    publicApiOrigin: origin,
    cluster: "devnet",
    snapshot: async () => fixtureSnapshot(state),
    rpc: {
      async request() {
        throw new Error("Checker must not request a transaction or reach RPC");
      },
    },
    limiter: { consume: () => ({ ok: true }) },
    clientIp: () => "127.0.0.1",
    clock: Date.now,
  };
  registerActions(app, {
    ...defaultDeps({ WEB_ORIGIN: origin }),
    rip,
    blinksXray: true,
    cluster: rip.cluster,
    xrayPort: {
      get: async () => {
        if (xrayState === "busy") throw new Error("Fixture X-ray unavailable");
        const result = structuredClone(xrayResult);
        if (xrayState === "empty") {
          for (const name of Object.keys(
            result.counts,
          ) as (keyof typeof result.counts)[])
            result.counts[name] = 0;
          result.totals = { sellValueSol: "0", rentBackSol: "0" };
        }
        result.share.squareUrl = `${origin}/fixtures/xray.png`;
        return result;
      },
    },
    logger: { info() {} },
  });
  return app;
}
