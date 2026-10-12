import "./setup.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../app.js";
import { defaultDeps } from "../../link/index.js";
import { ACTION_HEADERS } from "../headers.js";
import { formatSol, formatSolDisplay } from "../format.js";
import {
  ActionErrorSchema,
  ActionGetResponseSchema,
  ActionsJsonSchema,
  ExternalLinkResponseSchema,
} from "../spec.js";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { xrayService } from "../../xray/service.js";
import { createXrayDependencies } from "../../xray/deps.js";

const env = {
  WEB_ORIGIN: "https://onepercent.test",
  APP_VERSION: "test",
  GIT_COMMIT: "offline",
};
function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../__fixtures__/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}
const result = XrayResultSchema.parse(fixture("xray-result"));
const address = result.address;
function harness() {
  const get = vi.fn(async () => structuredClone(result));
  return {
    app: createApi(env, {
      ...defaultDeps(env),
      blinksXray: true,
      xrayPort: { get },
      logger: { info: vi.fn() },
    }),
    get,
  };
}
function headers(response: Response, options = false) {
  for (const [name, value] of Object.entries(ACTION_HEADERS))
    expect(response.headers.get(name)).toBe(value);
  if (!options)
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
}
function noTransactions(body: unknown): void {
  if (Array.isArray(body)) body.forEach(noTransactions);
  else if (body && typeof body === "object") {
    expect(body).not.toHaveProperty("transaction");
    Object.values(body).forEach(noTransactions);
  }
}

describe("recorded Actions responses", () => {
  it.each([
    ["actions-json", "/actions.json", "GET", 200],
    ["xray-generic", "/api/actions/xray", "GET", 200],
    ["xray-query", `/api/actions/xray?address=${address}`, "GET", 200],
    ["xray-path", `/api/actions/xray/${address}`, "GET", 200],
    ["xray-post-default", "/api/actions/xray", "POST", 200],
    ["xray-post-ref", "/api/actions/xray?ref=alice_1", "POST", 200],
    ["invalid-address", "/api/actions/xray?address=0x123", "GET", 400],
  ] as const)("matches %s", async (name, path, method, status) => {
    const { app } = harness();
    const response = await app.request(path, {
      method,
      headers: {
        Origin: "https://dial.to",
        "Content-Type": "application/json",
      },
      ...(method === "POST"
        ? { body: JSON.stringify({ account: address }) }
        : {}),
    });
    expect(response.status).toBe(status);
    headers(response);
    const body = await response.json();
    expect(body).toEqual(fixture(name));
    noTransactions(body);
    const schema =
      status >= 400
        ? ActionErrorSchema
        : name === "actions-json"
          ? ActionsJsonSchema
          : method === "GET"
            ? ActionGetResponseSchema
            : ExternalLinkResponseSchema;
    expect(schema.safeParse(body).success).toBe(true);
    if (method === "GET" && path !== "/actions.json" && status === 200) {
      const action = ActionGetResponseSchema.parse(body);
      expect(action.label).toMatch(/^(X-ray|Rip)\b/);
      for (const linked of action.links?.actions ?? [])
        expect(linked.label).toMatch(/^X-ray\b/);
    }
  });

  it.each([
    "/actions.json",
    "/api/actions/xray",
    "/api/actions/rip/after_hours",
    "/api/actions/missing",
  ])("includes compatibility metadata on OPTIONS %s", async (path) => {
    const response = await harness().app.request(path, {
      method: "OPTIONS",
      headers: { Origin: "https://dial.to" },
    });
    expect(response.status).toBe(204);
    headers(response, true);
    expect(await response.text()).toBe("");
  });

  it("keeps CORS wildcard confined to Actions and cache lifetimes pinned", async () => {
    const { app } = harness();
    const health = await app.request("/health", {
      headers: { Origin: "https://dial.to" },
    });
    expect(health.headers.has("Access-Control-Allow-Origin")).toBe(false);
    const session = await app.request(`/api/link/session/${"a".repeat(32)}`, {
      headers: { Origin: "https://dial.to" },
    });
    expect(session.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(
      (await app.request("/actions.json")).headers.get("Cache-Control"),
    ).toBe("public, max-age=300");
    expect(
      (await app.request("/api/actions/xray")).headers.get("Cache-Control"),
    ).toBe("public, max-age=60");
  });

  it.each([
    ["mainnet-beta", "/api/actions/rip/original", false],
    ["devnet", "/api/actions/rip/original", true],
    ["localnet", "/api/actions/rip/original", false],
    ["devnet", "/api/actions/xray", false],
  ] as const)(
    "keeps Action metadata and JSON on an oversized POST (%s, %s, length=%s)",
    async (cluster, path, contentLength) => {
      const get = vi.fn();
      const app = createApi(env, {
        ...defaultDeps(env),
        cluster,
        xrayPort: { get },
        logger: { info: vi.fn() },
      });
      const body = JSON.stringify({
        account: address,
        padding: "x".repeat(64 * 1024),
      });
      const response = await app.request(path, {
        method: "POST",
        headers: {
          Origin: "https://dial.to",
          "Content-Type": "application/json",
          ...(contentLength
            ? { "Content-Length": String(Buffer.byteLength(body)) }
            : {}),
        },
        body,
      });
      expect(response.status).toBe(413);
      for (const [name, value] of Object.entries(ACTION_HEADERS)) {
        const expected =
          name === "X-Blockchain-Ids" &&
          cluster !== "mainnet-beta" &&
          !path.startsWith("/api/actions/xray")
            ? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
            : value;
        expect(response.headers.get(name)).toBe(expected);
      }
      expect(response.headers.get("Content-Type")).toMatch(
        /^application\/json/,
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(ActionErrorSchema.parse(await response.json())).toEqual({
        message: "That request isn’t valid.",
      });
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("preserves the existing non-Action oversized POST response", async () => {
    const response = await harness().app.request("/api/link/bind", {
      method: "POST",
      headers: {
        Origin: "https://dial.to",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ padding: "x".repeat(64 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload Too Large");
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(response.headers.has("X-Action-Version")).toBe(false);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("keeps the Actions error body and metadata on an unexpected server failure", async () => {
    const app = createApi(env, {
      ...defaultDeps(env),
      blinksXray: true,
      linkRateLimiter: {
        consume: async () => {
          throw new Error("test_backend_failure");
        },
      },
      logger: { info: vi.fn() },
    });
    const response = await app.request(`/api/actions/xray/${address}`, {
      headers: { Origin: "https://dial.to" },
    });
    expect(response.status).toBe(500);
    headers(response);
    const body = await response.json();
    expect(body).toEqual({ message: "The machine didn’t answer. Try again." });
    expect(ActionErrorSchema.safeParse(body).success).toBe(true);
    noTransactions(body);
  });

  it("accepts addr alias, omits zero segments and uses singular counts", async () => {
    const { app, get } = harness();
    get.mockResolvedValue({
      ...result,
      counts: {
        ...result.counts,
        bags: 1,
        feedable: 0,
        checkAtFeed: 0,
        sellable: 1,
      },
    });
    const body = await (
      await app.request(`/api/actions/xray?addr=${address}`)
    ).json();
    expect(body.description).toBe("1 bag ✳ 1 has a bid ≈0.79 SOL est.");
    expect(get).toHaveBeenCalledWith(address, undefined);
  });

  it("matches the empty-wallet Blink fixture with a nonempty description", async () => {
    const { app, get } = harness();
    get.mockResolvedValue({
      ...result,
      counts: {
        bags: 0,
        feedable: 0,
        checkAtFeed: 0,
        sellable: 0,
        notFeedable: 0,
        empty: 0,
        notInSet: 0,
      },
      totals: { sellValueSol: "0", rentBackSol: "0" },
      worst: null,
    });
    const response = await app.request(`/api/actions/xray/${address}`);
    headers(response);
    const body = await response.json();
    expect(body).toEqual(fixture("xray-empty"));
    expect(ActionGetResponseSchema.safeParse(body).success).toBe(true);
  });

  it("reports rent when only empty accounts remain instead of calling the wallet clean", async () => {
    const { app, get } = harness();
    get.mockResolvedValue({
      ...result,
      counts: {
        bags: 0,
        feedable: 0,
        checkAtFeed: 0,
        sellable: 0,
        notFeedable: 0,
        empty: 1,
        notInSet: 0,
      },
      totals: { sellValueSol: "0", rentBackSol: "0.002039" },
      worst: null,
    });
    const body = await (
      await app.request(`/api/actions/xray/${address}`)
    ).json();
    expect(body.description).toBe("1 empty account ≈0.0020 SOL rent back");
  });

  it("truncates only the displayed title and forwards the complete normalized name and referral", async () => {
    const { app, get } = harness();
    const name = `${"a".repeat(63)}.sns`;
    const share = {
      ...result.share,
      squareUrl: `https://onepercent.test/x/${name}/square.png?ref=alice_1`,
    };
    get.mockResolvedValue({ ...result, share });
    const body = await (
      await app.request(`/api/actions/xray/${name.toUpperCase()}?ref=alice_1`)
    ).json();
    expect(body.title).toBe(
      `X-ray: ${address.slice(0, 4)}…${address.slice(-4)}`,
    );
    expect(get).toHaveBeenCalledWith(name.toUpperCase(), { ref: "alice_1" });
    expect(body.icon).toBe(share.squareUrl);
    expect(body.icon).toContain(name);
    expect(body.links.actions[0].href).toBe("/api/actions/xray?ref=alice_1");
  });

  it("uses the generic Blink on upstream or schema failure without leaking details", async () => {
    const { app, get } = harness();
    for (const failure of [new Error("private provider detail"), null]) {
      if (failure) get.mockRejectedValueOnce(failure);
      else
        get.mockResolvedValueOnce({
          ...result,
          totals: { ...result.totals, sellValueSol: 0.1 },
        } as never);
      const response = await app.request(`/api/actions/xray/${address}`);
      expect(response.status).toBe(200);
      headers(response);
      expect(await response.json()).toEqual({
        ...(fixture("xray-generic") as object),
        error: { message: "The X-ray is busy. Try again in a minute." },
      });
    }
  });

  it("keeps the estimate label whole when oversized counters exhaust the description", async () => {
    const { app, get } = harness();
    get.mockResolvedValue({
      ...result,
      counts: {
        ...result.counts,
        bags: Number.MAX_SAFE_INTEGER,
        feedable: Number.MAX_SAFE_INTEGER,
        checkAtFeed: Number.MAX_SAFE_INTEGER,
        sellable: Number.MAX_SAFE_INTEGER,
      },
      totals: { ...result.totals, sellValueSol: "1".repeat(48) },
    });
    const body = await (
      await app.request(`/api/actions/xray/${address}`)
    ).json();
    expect(body.description.length).toBeLessThanOrEqual(140);
    expect(body.description).not.toContain("≈");
    expect(body.description).not.toContain("…");
    expect(body.description).toContain("to check at Feed");
  });

  it.each(["bad value", "ab", "a".repeat(17)])(
    "discards invalid ref %s and uses the scanned account",
    async (ref) => {
      const response = await harness().app.request(
        `/api/actions/xray?ref=${encodeURIComponent(ref)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: address }),
        },
      );
      expect(await response.json()).toEqual(fixture("xray-post-default"));
    },
  );

  it.each([
    ["/api/actions/xray", "POST", "{}", 400],
    ["/api/actions/xray", "POST", "{", 400],
    [
      "/api/actions/xray?address=11111111111111111111111111111111111",
      "GET",
      undefined,
      400,
    ],
    ["/api/actions/rip/no_such_edition", "GET", undefined, 404],
    ["/api/actions/missing", "GET", undefined, 404],
    ["/actions.json", "POST", undefined, 404],
  ] as const)(
    "keeps errors compliant: %s %s",
    async (path, method, body, status) => {
      const response = await harness().app.request(path, {
        method,
        ...(body ? { body } : {}),
      });
      expect(response.status).toBe(status);
      headers(response);
      expect(ActionErrorSchema.safeParse(await response.json()).success).toBe(
        true,
      );
    },
  );

  it("uses the shared X1 service directly and preserves full names and referrals", async () => {
    const get = vi.spyOn(xrayService, "get").mockResolvedValue(result);
    try {
      const app = createApi(env, { blinksXray: true });
      const response = await app.request(
        "/api/actions/xray/full-name.sns?ref=alice_1",
      );
      expect(response.status).toBe(200);
      expect(get).toHaveBeenCalledWith("full-name.sns", { ref: "alice_1" });
    } finally {
      get.mockRestore();
    }
  });

  it("merges X1 and link dependencies and reuses the injected service for Actions", async () => {
    const xray = await createXrayDependencies({ XRAY_SOURCE: "fixtures" });
    const get = vi.spyOn(xray.service, "get").mockResolvedValue(result);
    const take = vi.spyOn(xray.limiter, "take");
    const app = createApi(env, {
      xray,
      blinksXray: true,
      logger: { info: vi.fn() },
    });
    const blink = await app.request(`/api/actions/xray/${address}?ref=alice_1`);
    expect(blink.status).toBe(200);
    expect(get).toHaveBeenCalledWith(address, { ref: "alice_1" });
    expect(take).not.toHaveBeenCalled();
    const scan = await app.request(`/api/xray/${address}?ref=alice_1`);
    expect(scan.status).toBe(200);
    expect(await scan.json()).toEqual(result);
    expect(take).toHaveBeenCalledOnce();
    expect((await app.request("/api/link/telegram/1")).status).toBe(503);
  });
});

describe("X1 schema and exact SOL formatting", () => {
  it.each([
    ["0.7912", "0.79"],
    ["412.6", "412.6"],
    ["1", "1"],
    ["0.0061", "0.0061"],
    ["0.002039", "0.00204"],
    ["0", "0"],
    ["0.000000001", "0.000000001"],
    ["18446744073.709551615", "18446744073.71"],
  ])("formats %s as %s without floats", (input, expected) =>
    expect(formatSol(input!)).toBe(expected),
  );
  it.each([
    ["412.6099", "412.6"],
    ["1", "1"],
    ["0.849999", "0.84"],
    ["0.1", "0.10"],
    ["0.01001", "0.01"],
    ["0.00619999", "0.0061"],
    ["0.009999999", "0.0099"],
    ["0.002039", "0.0020"],
    ["0.000000019", "0.000000019"],
    ["0.000000001", "0.0000000010"],
    ["0", "0"],
    ["18446744073.709551615", "18446744073.7"],
    ["9007199254740993.129999999", "9007199254740993.12"],
  ])(
    "floors estimate %s to X1 display %s without floats",
    (input, expected) => {
      expect(formatSolDisplay(input!)).toBe(expected);
      const [whole, fraction = ""] = input!.split(".");
      expect(formatSolDisplay(BigInt(whole + fraction.padEnd(9, "0")))).toBe(
        expected,
      );
    },
  );
  it("floors the labelled estimate in a wallet Blink", async () => {
    const h = harness();
    h.get.mockResolvedValueOnce({
      ...result,
      counts: {
        ...result.counts,
        bags: 1,
        feedable: 0,
        checkAtFeed: 0,
        sellable: 1,
      },
      totals: { ...result.totals, sellValueSol: "0.002039" },
    });
    const response = await h.app.request(`/api/actions/xray/${address}`);
    const action = ActionGetResponseSchema.parse(await response.json());
    expect(action.description).toContain("≈0.0020 SOL est.");
  });
  it("accepts bigint lamports and requires SOL strings and the snapshot counter", () => {
    expect(formatSol(791_200_000n)).toBe("0.79");
    expect(
      XrayResultSchema.safeParse({
        ...result,
        totals: { sellValueSol: 1, rentBackSol: "0" },
      }).success,
    ).toBe(false);
    expect(
      XrayResultSchema.safeParse({
        ...result,
        counts: { ...result.counts, checkAtFeed: undefined },
      }).success,
    ).toBe(false);
  });
  it("permits the paired nullable amount only for the mint_missing reasonCode", () => {
    const bag = {
      mint: address,
      symbol: "TEST",
      name: "Test",
      logoUrl: null,
      amountUi: null,
      decimals: null,
      tokenProgram: "spl",
      buckets: ["not_in_set"],
      reason: "Not supported",
      reasonCode: "mint_missing",
    };
    expect(XrayResultSchema.safeParse({ ...result, bags: [bag] }).success).toBe(
      true,
    );
    expect(
      XrayResultSchema.safeParse({
        ...result,
        bags: [{ ...bag, reason: "mint_missing" }],
      }).success,
    ).toBe(true);
    for (const change of [
      { buckets: ["feedable"] },
      { amountUi: "1" },
      { decimals: 9 },
      { reasonCode: undefined },
      { reasonCode: "not_pump_fun" },
      { reasonCode: "unknown_reason" },
      { buckets: ["not_in_set", "feedable"] },
      { valueSol: "0" },
    ]) {
      expect(
        XrayResultSchema.safeParse({ ...result, bags: [{ ...bag, ...change }] })
          .success,
      ).toBe(false);
    }
    for (const reason of [undefined, "mint_missing", "Another label"])
      expect(
        XrayResultSchema.safeParse({ ...result, bags: [{ ...bag, reason }] })
          .success,
      ).toBe(true);
    for (const reason of ["mint_missing", "Not supported"])
      expect(
        XrayResultSchema.safeParse({
          ...result,
          bags: [{ ...bag, reason, reasonCode: undefined }],
        }).success,
      ).toBe(false);
  });
});
