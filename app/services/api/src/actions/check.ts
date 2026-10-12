import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CARDS_PER_PACK, PACK_EDITIONS } from "@onepercent/config";
import { ACTION_HEADERS } from "./headers.js";
import { COPY } from "./copy.js";
import { RIP_COPY } from "./rip-copy.js";
import {
  ActionErrorSchema,
  ActionGetResponseSchema,
  ActionsJsonSchema,
} from "./spec.js";

export type BlinkFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;
export interface BlinkSample {
  path: string;
  state: string;
}
export interface BlinkCheckOptions {
  origin: string;
  fetcher?: BlinkFetcher;
  samples?: readonly BlinkSample[];
  cluster?: "mainnet-beta" | "devnet" | "localnet";
}
const SAMPLE_ADDRESS = "So11111111111111111111111111111111111111112";
export function defaultBlinkSamples(): BlinkSample[] {
  return [
    { path: "/api/actions/xray", state: "generic" },
    { path: `/api/actions/xray/${SAMPLE_ADDRESS}`, state: "wallet" },
    {
      path: `/api/actions/xray?address=${SAMPLE_ADDRESS}`,
      state: "wallet query",
    },
    { path: "/api/actions/rip", state: "generic" },
    {
      path: `/api/actions/rip?edition=${PACK_EDITIONS[0].id}`,
      state: "edition query",
    },
    ...PACK_EDITIONS.map((edition) => ({
      path: `/api/actions/rip/${edition.id}`,
      state: "current",
    })),
  ];
}
function checkHeaders(
  response: Response,
  path: string,
  cluster: NonNullable<BlinkCheckOptions["cluster"]>,
): void {
  for (const [name, value] of Object.entries(ACTION_HEADERS)) {
    const expected =
      name === "X-Blockchain-Ids" &&
      !path.startsWith("/api/actions/xray") &&
      cluster !== "mainnet-beta"
        ? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
        : value;
    assert.equal(response.headers.get(name), expected, `${path}: ${name}`);
  }
}
function checkCache(
  response: Response,
  path: string,
  maxAge: number | null = 60,
): void {
  const value = response.headers.get("Cache-Control") ?? "";
  const age = /(?:^|,)\s*max-age=(\d+)(?=\s*(?:,|$))/i.exec(value);
  assert(age, `${path}: missing max-age`);
  const seconds = Number(age[1]);
  assert(Number.isSafeInteger(seconds), `${path}: invalid max-age`);
  if (maxAge !== null)
    assert(seconds <= maxAge, `${path}: max-age exceeds ${maxAge} seconds`);
}
function jsonContent(response: Response, path: string): void {
  assert.match(
    response.headers.get("Content-Type") ?? "",
    /^application\/json(?:\s*;|$)/i,
    `${path}: expected JSON`,
  );
}
export async function checkBlinks(options: BlinkCheckOptions): Promise<{
  sheet: string;
  checked: { path: string; state: string; disabled: boolean }[];
}> {
  const origin = new URL(options.origin);
  assert(
    origin.protocol === "https:" ||
      (origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)),
    "The origin must use HTTPS (HTTP is allowed only for local fixtures)",
  );
  assert.equal(origin.pathname, "/", "Use an origin without a path");
  assert(
    !origin.username && !origin.password,
    "Use an origin without credentials",
  );
  assert(
    !origin.search && !origin.hash,
    "Use an origin without query or fragment",
  );
  const cluster = options.cluster ?? "mainnet-beta";
  const fetcher: BlinkFetcher = options.fetcher ?? fetch;
  const request = (path: string, init?: RequestInit) =>
    fetcher(new URL(path, origin).href, {
      signal: AbortSignal.timeout(10_000),
      ...init,
      headers: {
        Origin: "https://dial.to",
        ...init?.headers,
      },
    });
  async function preflight(path: string): Promise<void> {
    const response = await request(path, {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "content-type,x-accept-action-version",
      },
    });
    assert.equal(response.status, 204, `${path}: OPTIONS status`);
    checkHeaders(response, path, cluster);
    assert.equal(await response.text(), "", `${path}: OPTIONS must be empty`);
  }
  const discovery = await request("/actions.json");
  assert.equal(discovery.status, 200, "actions.json status");
  checkHeaders(discovery, "/actions.json", cluster);
  jsonContent(discovery, "/actions.json");
  const actions = ActionsJsonSchema.parse(await discovery.json());
  assert(actions.rules.length > 0, "actions.json needs route rules");
  await preflight("/actions.json");
  const icons = new Set<string>();
  const probed = new Set<string>();
  const checked: { path: string; state: string; disabled: boolean }[] = [];
  for (const sample of options.samples ?? defaultBlinkSamples()) {
    const response = await request(sample.path);
    assert.equal(response.status, 200, `${sample.path}: GET status`);
    checkHeaders(response, sample.path, cluster);
    jsonContent(response, sample.path);
    const action = ActionGetResponseSchema.parse(await response.json());
    if (response.headers.get("Cache-Control") === "no-store")
      assert(
        sample.path.startsWith("/api/actions/xray") && action.error,
        `${sample.path}: only transient X-ray errors may omit max-age`,
      );
    else checkCache(response, sample.path);
    assert.match(
      action.label,
      /^(?:Rip|X-ray)\b/,
      `${sample.path}: verb label`,
    );
    for (const link of action.links?.actions ?? [])
      assert.match(
        link.label,
        /^(?:Rip|X-ray)\b/,
        `${sample.path}: verb label`,
      );
    await preflight(sample.path);
    for (const link of action.links?.actions ?? []) {
      const href = new URL(link.href, origin);
      if (
        !href.pathname.startsWith("/api/actions/rip/") ||
        probed.has(href.href)
      )
        continue;
      assert.equal(
        href.origin,
        origin.origin,
        "Rip probes must stay on the checked origin",
      );
      probed.add(href.href);
      href.searchParams.set("n", "0");
      const probe = await request(href.href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: SAMPLE_ADDRESS, type: "transaction" }),
      });
      assert.equal(probe.status, 400, `${href.pathname}: POST probe status`);
      checkHeaders(probe, href.pathname, cluster);
      jsonContent(probe, href.pathname);
      assert.equal(
        probe.headers.get("Cache-Control"),
        "no-store",
        "POST probes must not be cached",
      );
      assert.deepEqual(ActionErrorSchema.parse(await probe.json()), {
        message: RIP_COPY.badRequest,
      });
    }
    if (!icons.has(action.icon)) {
      const icon = await request(action.icon);
      assert.equal(icon.status, 200, `${action.icon}: image status`);
      assert.match(
        icon.headers.get("Content-Type") ?? "",
        /^image\/png(?:\s*;|$)/i,
        `${action.icon}: expected PNG`,
      );
      // M5-A11 retains X1's fixed-snapshot cache and the generic static asset cache.
      // Only Rip images carry live machine values with the 60-second lifetime.
      checkCache(
        icon,
        action.icon,
        sample.path.startsWith("/api/actions/rip") ? 60 : null,
      );
      const bytes = new Uint8Array(await icon.arrayBuffer());
      assert.deepEqual(
        [...bytes.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
        `${action.icon}: invalid PNG signature`,
      );
      icons.add(action.icon);
    }
    checked.push({
      ...sample,
      disabled: action.disabled ?? false,
    });
  }
  const routePatterns = new Set(actions.rules.map((rule) => rule.apiPath));
  if (checked.some((sample) => sample.path.startsWith("/api/actions/rip/")))
    routePatterns.add("/api/actions/rip/*");
  if (checked.some((sample) => sample.path === "/api/actions/xray"))
    routePatterns.add("/api/actions/xray");
  const patterns = [...routePatterns]
    .map((path) => `- ${origin.origin}${path}`)
    .join("\n");
  const sheet = [
    "Blinks registration",
    `Host: ${origin.host}`,
    "Action URL patterns:",
    patterns,
    `X-ray: ${COPY.xrayDescription}`,
    `Rip: ${RIP_COPY.contents(CARDS_PER_PACK.dust, CARDS_PER_PACK.hit)} ✳ ${RIP_COPY.verifiable}`,
    "Contact: [founder contact email]",
    `Checked ${checked.length} route/state samples, ${icons.size} icons and ${probed.size} safe POST probes.`,
    "Submit after founder review; this check does not register the Actions.",
  ].join("\n");
  return { sheet, checked };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  assert(
    (args.length === 2 || args.length === 4) &&
      args[0] === "--origin" &&
      args[1],
    "Usage: blinks:check --origin <https://host> [--cluster mainnet-beta|devnet|localnet]",
  );
  const cluster = args[3] ?? "mainnet-beta";
  assert(
    (args.length === 2 || args[2] === "--cluster") &&
      (cluster === "mainnet-beta" ||
        cluster === "devnet" ||
        cluster === "localnet"),
    "Invalid cluster",
  );
  const result = await checkBlinks({ origin: args[1], cluster });
  console.log(result.sheet);
}
