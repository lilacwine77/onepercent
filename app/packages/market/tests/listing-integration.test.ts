import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createChainRpc, createExitCapClient } from "../src/chain/exit-cap.js";
import { createHoldersClient } from "../src/chain/holders.js";
import { createMintSafetyClient } from "../src/chain/mint-safety.js";
import { createHttpClient } from "../src/http/fetch-json.js";
import { createJupiterLimiter } from "../src/http/rate-limit.js";
import { createJupiterSwapClient } from "../src/jupiter/swap.js";
import { createJupiterTokensClient } from "../src/jupiter/tokens.js";
import { createListingEvidenceGatherer } from "../src/listing/evidence.js";
import { evaluateMajor, evaluateTrending } from "../src/listing/evaluate.js";
import { HIT_LIST, MARKET } from "../src/params.js";
import { createPythHermesClient } from "../src/pyth/hermes.js";
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
    pyth: createPythHermesClient(opts),
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
