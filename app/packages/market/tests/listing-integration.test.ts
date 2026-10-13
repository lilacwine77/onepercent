import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createChainRpc, createExitCapClient } from "../src/chain/exit-cap.js";
import { createHoldersClient } from "../src/chain/holders.js";
import { createMintSafetyClient } from "../src/chain/mint-safety.js";
import { createHttpClient } from "../src/http/fetch-json.js";
import { createJupiterLimiter } from "../src/http/rate-limit.js";
import { createJupiterSwapClient } from "../src/jupiter/swap.js";
import { createJupiterTokensClient } from "../src/jupiter/tokens.js";
import { createListingEvidenceGatherer } from "../src/listing/evidence.js";
import { evaluateMajor, evaluateTrending } from "../src/listing/evaluate.js";
import { HIT_LIST, MARKET, STOCK } from "../src/params.js";
import { createPythHermesClient } from "../src/pyth/hermes.js";
import { createPythPushClient } from "../src/pyth/push.js";
import { fixtureFetch } from "../src/testing.js";
import { buildLadder } from "../src/value/ladder.js";
import { createValueClient } from "../src/value/value-now.js";

const file = (name: string) =>
  new URL(`./fixtures/${name}.json`, import.meta.url);
const recordedAt = (
  JSON.parse(readFileSync(file("pyth/latest-wif"), "utf8")) as {
    recordedAt: string;
  }
).recordedAt;
const nowMs = Date.parse(recordedAt);
const clock = {
  nowMs: () => nowMs,
  sleep: () => new Promise<void>(() => {}),
  random: () => 0,
};
const env = {
  pythHermesUrl: MARKET.pyth.defaultHermesUrl,
  pythHermesApiKey: "fixture-only",
  jupiterApiKey: "fixture-only",
  solanaRpcUrl: "https://rpc.invalid/",
};

function clients(
  files: string[],
  wrap?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch,
  push = false,
) {
  const offline = fixtureFetch(files.map(file));
  const fetch = wrap ? wrap(offline) : offline;
  const opts = { fetch, env, clock };
  const jupiterHttp = createHttpClient({
    ...opts,
    provider: "jupiter",
    limiter: createJupiterLimiter({ env, clock }),
  });
  const swap = createJupiterSwapClient({ ...opts, http: jupiterHttp });
  const tokens = createJupiterTokensClient({ ...opts, http: jupiterHttp });
  const rpc = createChainRpc(opts);
  const exitCaps = createExitCapClient({ ...opts, rpc });
  const mintSafety = createMintSafetyClient({ ...opts, rpc });
  const holders = createHoldersClient({ ...opts, rpc });
  const value = createValueClient({
    quoteSell: swap.quoteSell,
    getExitCap: exitCaps.getExitCap,
    clock,
  });
  const gatherer = createListingEvidenceGatherer({
    tokens,
    swap,
    exitCaps,
    mintSafety,
    holders,
    pyth: push ? createPythPushClient({ rpc }) : createPythHermesClient(opts),
    pythSource: push ? "Pyth push feed on-chain (shard 0)" : undefined,
    history: push
      ? {
          getDailyCloses: async () => ({
            closes: [100, 110, 100, 110, 100, 110, 100, 110],
            source: "Fixture daily USD closes",
          }),
        }
      : undefined,
    clock,
    buildLadder: (mint, amount) => buildLadder(mint, amount, value.valueNow),
  });
  return { gatherer, tokens, mintSafety };
}

function wifFiles(solFixture = "pyth/latest-sol", history = true): string[] {
  return [
    "jupiter/token-major-wif",
    "jupiter/swap-major-wif-buy",
    "jupiter/swap-major-wif-probe",
    ...Array.from(
      { length: MARKET.ladder.maxRungs },
      (_, index) => `jupiter/swap-major-wif-ladder-${index}`,
    ),
    "rpc/mint-wif",
    "rpc/curve-wif-absent",
    "pyth/latest-wif",
    solFixture,
    ...(history
      ? Array.from({ length: 8 }, (_, index) => `pyth/historical-wif-${index}`)
      : []),
  ];
}

describe("listing gathering from recorded providers", () => {
  const pushFiles = () => [
    ...wifFiles().filter((name) => !name.startsWith("pyth/")),
    "rpc/pyth-push-listing-wif",
    "rpc/pyth-push-listing-sol",
  ];

  it("uses push prices for the exact Jupiter 150 SOL probe without Hermes", async () => {
    const requests = vi.fn<typeof fetch>();
    const { gatherer } = clients(
      pushFiles(),
      (offline) => requests.mockImplementation(offline),
      true,
    );
    const major = HIT_LIST.launchMajors[0];
    const evidence = await gatherer.gatherMajorEvidence(
      major.mint,
      major.pythFeedId,
    );
    const report = evaluateMajor(evidence, nowMs);
    expect(evidence.sellRecoveryBps).toBe(9_921n);
    expect(evidence.dailySigmaBps).toBe(1_019);
    for (const id of ["pyth_fresh", "pyth_conf", "sell150_recovery_bps"])
      expect(report.criteria.find((entry) => entry.id === id)?.pass).toBe(true);
    expect(
      report.criteria.find((entry) => entry.id === "pyth_fresh")?.source,
    ).toBe("Pyth push feed on-chain (shard 0) publish_time");
    expect(
      report.criteria.find((entry) => entry.id === "sigma_daily_bps")?.source,
    ).toBe("Fixture daily USD closes");
    expect(
      requests.mock.calls.every(([input]) => !String(input).includes("hermes")),
    ).toBe(true);
  });

  it("reads fresh probe prices after a slow public history request", async () => {
    let currentMs = nowMs;
    const movingClock = { ...clock, nowMs: () => currentMs };
    const swap = createJupiterSwapClient({
      env,
      clock: movingClock,
      fetch: fixtureFetch([
        file("jupiter/swap-major-wif-buy"),
        file("jupiter/swap-major-wif-probe"),
      ]),
    });
    const gatherer = createListingEvidenceGatherer({
      clock: movingClock,
      swap,
      tokens: { getTokens: async () => ({}) },
      mintSafety: { getMintSafety: async () => ({ safe: true, decimals: 6 }) },
      exitCaps: {
        getCurve: async () => undefined,
        getCanonicalPool: async () => undefined,
      },
      holders: { getTopHolders: async () => ({ top10Bps: 0, excluded: [] }) },
      buildLadder: async () => {
        throw new Error("No cap fixture");
      },
      pyth: {
        getLatest: async (feedId) => {
          const symbol = feedId === HIT_LIST.solUsdPythFeedId ? "sol" : "wif";
          const fixture = JSON.parse(
            readFileSync(file(`pyth/latest-${symbol}`), "utf8"),
          ) as {
            response: {
              body: {
                parsed: {
                  id: string;
                  price: {
                    price: string;
                    conf: string;
                    expo: number;
                    publish_time: number;
                  };
                }[];
              };
            };
          };
          const update = fixture.response.body.parsed[0]!;
          return {
            ...update,
            price: {
              ...update.price,
              publish_time: Math.floor(currentMs / 1_000),
            },
          };
        },
      },
      history: {
        getDailyCloses: async () => {
          await Promise.resolve();
          currentMs += (STOCK.pythMaxAgeSeconds + 1) * 1_000;
          return {
            closes: Array<number>(8).fill(100),
            source: "Delayed history fixture",
          };
        },
      },
    });
    const major = HIT_LIST.launchMajors[0];
    const evidence = await gatherer.gatherMajorEvidence(
      major.mint,
      major.pythFeedId,
    );
    expect(evidence.sellRecoveryBps).toBe(9_921n);
    expect(evidence.pyth?.publish_time).toBe(Math.floor(currentMs / 1_000));
  });

  it.each(["wif", "sol"])(
    "refuses the sell probe when the push %s feed is older than 60 seconds",
    async (symbol) => {
      const fixture = JSON.parse(
        readFileSync(file(`rpc/pyth-push-listing-${symbol}`), "utf8"),
      ) as {
        request: { body: { params: [string, unknown] } };
      };
      const { gatherer } = clients(
        pushFiles(),
        (offline) => async (input, init) => {
          const response = await offline(input, init);
          const request = init?.body
            ? (JSON.parse(String(init.body)) as { params?: unknown[] })
            : null;
          if (request?.params?.[0] !== fixture.request.body.params[0])
            return response;
          const body = (await response.json()) as {
            result: { value: { data: [string, string] } };
          };
          const data = Buffer.from(body.result.value.data[0], "base64");
          data.writeBigInt64LE(
            BigInt(Math.floor(nowMs / 1_000) - STOCK.pythMaxAgeSeconds - 1),
            93,
          );
          body.result.value.data[0] = data.toString("base64");
          return Response.json(body);
        },
        true,
      );
      const major = HIT_LIST.launchMajors[0];
      const evidence = await gatherer.gatherMajorEvidence(
        major.mint,
        major.pythFeedId,
      );
      expect(evidence.sellRecoveryBps).toBeNull();
      const report = evaluateMajor(evidence, nowMs);
      expect(
        report.criteria.find((entry) => entry.id === "sell150_recovery_bps")
          ?.pass,
      ).toBe(false);
      expect(
        report.criteria.find((entry) => entry.id === "pyth_fresh")?.pass,
      ).toBe(symbol === "sol");
    },
  );

  it.each(["pyth/latest-sol-stale", "pyth/latest-sol-wide"])(
    "refuses a probe based on %s while the token feed stays valid",
    async (solFixture) => {
      const { gatherer } = clients(wifFiles(solFixture));
      const major = HIT_LIST.launchMajors[0];
      const evidence = await gatherer.gatherMajorEvidence(
        major.mint,
        major.pythFeedId,
      );
      expect(evidence.sellRecoveryBps).toBeNull();
      const report = evaluateMajor(evidence, nowMs);
      expect(
        report.criteria.find((entry) => entry.id === "pyth_fresh")!.pass,
      ).toBe(true);
      expect(
        report.criteria.find((entry) => entry.id === "pyth_conf")!.pass,
      ).toBe(true);
      expect(
        report.criteria.find((entry) => entry.id === "sell150_recovery_bps"),
      ).toMatchObject({ pass: false, observed: null });
    },
  );

  it("refuses a historical window whose updates fall outside their requested UTC days", async () => {
    // Replay the recorded latest update for every historical request to model a provider day gap.
    const { gatherer } = clients(
      wifFiles("pyth/latest-sol", false),
      (offline) => async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        url.pathname = url.pathname.replace(
          /\/v2\/updates\/price\/\d+$/,
          "/v2/updates/price/latest",
        );
        return offline(url, init);
      },
    );
    const major = HIT_LIST.launchMajors[0];
    const evidence = await gatherer.gatherMajorEvidence(
      major.mint,
      major.pythFeedId,
    );
    expect(evidence.sellRecoveryBps).not.toBeNull();
    expect(evidence.dailySigmaBps).toBeNull();
    expect(
      evaluateMajor(evidence, nowMs).criteria.find(
        (entry) => entry.id === "sigma_daily_bps",
      ),
    ).toMatchObject({ pass: false, observed: null });
  });

  it("snapshots five launch-major reports with synthetic Pyth clearly scoped to tests", async () => {
    const reports = [];
    for (const major of HIT_LIST.launchMajors) {
      const symbol = major.symbol.toLowerCase();
      const rpcFiles =
        symbol === "fartcoin" || symbol === "pnut"
          ? [`rpc/curve-150-${symbol}`, `rpc/pool-${symbol}-absent`]
          : [`rpc/curve-${symbol}-absent`];
      const selected = [
        `jupiter/token-major-${symbol}`,
        `jupiter/swap-major-${symbol}-buy`,
        `jupiter/swap-major-${symbol}-probe`,
        ...Array.from(
          { length: MARKET.ladder.maxRungs },
          (_, index) => `jupiter/swap-major-${symbol}-ladder-${index}`,
        ),
        `rpc/mint-${symbol}`,
        ...rpcFiles,
        `pyth/latest-${symbol}`,
        "pyth/latest-sol",
        ...(symbol === "wif"
          ? Array.from(
              { length: 8 },
              (_, index) => `pyth/historical-wif-${index}`,
            )
          : []),
      ];
      const { gatherer } = clients(selected);
      const evidence = await gatherer.gatherMajorEvidence(
        major.mint,
        major.pythFeedId,
      );
      expect(evidence.mintSafe).not.toBeNull();
      expect(evidence.externalDepthUsd).not.toBeNull();
      expect(evidence.sellRecoveryBps).not.toBeNull();
      expect(evidence.capLamports).not.toBeNull();
      expect(evidence.dailySigmaBps).toBe(symbol === "wif" ? 1_019 : null);
      reports.push(evaluateMajor(evidence, nowMs));
    }
    // Only WIF has the explicitly synthetic historical window; others fail that missing criterion.
    expect(reports).toHaveLength(5);
    expect(reports).toMatchSnapshot();
  });

  it("gathers PumpSwap flags, real reserves and eligible holders with a failed cap quote", async () => {
    const tokensFixture = JSON.parse(
      readFileSync(file("jupiter/tokens-specials"), "utf8"),
    ) as {
      request: { url: string };
      response: { body: { id: string; symbol: string }[] };
    };
    const mint = tokensFixture.response.body.find(
      (entry) => entry.symbol === "PQC",
    )!.id;
    const { gatherer, tokens } = clients([
      "jupiter/tokens-specials",
      "jupiter/swap-buy-pqc-unavailable",
      "rpc/mint-pqc",
      "rpc/curve-151-pqc",
      "rpc/pool-pqc",
      "rpc/vault-pqc",
      "rpc/holders-pqc-largest",
      "rpc/holders-pqc-owners",
      "rpc/holders-pqc-supply",
    ]);
    await tokens.getTokens(
      new URL(tokensFixture.request.url).searchParams.get("query")!.split(","),
    );
    const evidence = await gatherer.gatherTrendingEvidence(mint);
    expect(evidence.pumpOrigin).toBe(true);
    expect(evidence.realQuoteLamports).toBeGreaterThan(0n);
    expect(evidence.curveSolQuote).toBe(true);
    expect(evidence.poolSolQuote).toBe(true);
    expect(evidence.curveMayhem).toBe(false);
    expect(evidence.poolMayhem).toBe(false);
    expect(evidence.excludedHolders).not.toBeNull();
    expect(evidence.top10Bps).not.toBeNull();
    expect(evidence.capLamports).toBeNull();
    expect(evaluateTrending(evidence, nowMs).criteria).toHaveLength(11);
  });

  it("reports the live PUMP TransferHook as unsafe", async () => {
    const mintFixture = JSON.parse(
      readFileSync(file("rpc/mint-pump"), "utf8"),
    ) as { request: { body: { params: [string] } } };
    const { mintSafety } = clients(["rpc/mint-pump"]);
    const safety = await mintSafety.getMintSafety(
      mintFixture.request.body.params[0],
    );
    expect(safety.extensions).toContain("TransferHook");
    expect(safety.safe).toBe(false);
    const report = evaluateMajor(
      {
        mint: mintFixture.request.body.params[0],
        symbol: "PUMP",
        mintSafe: safety.safe,
        pyth: null,
        firstPoolCreatedAtMs: null,
        externalDepthUsd: null,
        sellRecoveryBps: null,
        dailySigmaBps: null,
        capLamports: null,
        excludedHolders: null,
        jupiterTopHoldersPercentage: null,
      },
      nowMs,
    );
    expect(
      report.criteria.find((entry) => entry.id === "mint_is_safe"),
    ).toMatchObject({ pass: false, observed: false });
  });
});
