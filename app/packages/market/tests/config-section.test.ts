import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as config from "@onepercent/config";
import * as params from "../src/params.js";

const { MARKET, validateMarketParams } = params;

describe("X2 config section", () => {
  it("validates the documented defaults and rejects invalid settings", () => {
    expect(validateMarketParams()).toEqual(MARKET);
    for (const patch of [
      { http: { ...MARKET.http, timeoutMs: -1 } },
      { jupiter: { ...MARKET.jupiter, buildMaxAccounts: 0 } },
      { jupiter: { ...MARKET.jupiter, buildMaxAccounts: 65 } },
      { jupiter: { ...MARKET.jupiter, plan: "missing" } },
      { extra: true },
    ])
      expect(() => validateMarketParams({ ...MARKET, ...patch })).toThrow();
  });

  it("re-exports the PARAMS §22.4 values used by X2 from M1 config", () => {
    const document = readFileSync(
      resolve(
        realpathSync(fileURLToPath(new URL("..", import.meta.url))),
        "../../../docs/codex/PARAMS.md",
      ),
      "utf8",
    );
    const source = document
      .split("### 22.4")[1]!
      .split("```ts")[1]!
      .split("```")[0]!;
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    const context = { exports: {} as Record<string, unknown> };
    runInNewContext(compiled, context);
    const selected = {
      PROGRAM_IDS: ["pumpFun", "pumpSwap", "splToken", "token2022"],
      STOCK: [
        "targetBaseLamports",
        "pythMaxAgeSeconds",
        "pythMaxConfBps",
        "trendingPoolFeeAllowanceBps",
      ],
      SELL_BACK: [
        "quoteTtlSeconds",
        "solFloorLamports",
        "hourlyBudgetMinLamports",
        "hourlyBudgetBpsOfStockSol",
        "eligibleKinds",
      ],
      HIT_LIST: [
        "launchMajors",
        "solUsdPythFeedId",
        "neverListed",
        "majorBar",
        "trendingBar",
        "capMaxPriceImpactBps",
      ],
      XRAY: ["priceIdsPerCall"],
      FEED_RULES: ["maxMintDecimals", "allowedToken2022Extensions"],
      TX_LIMITS: ["redeemPerTx"],
    };
    const expected: Record<string, unknown> = {};
    const actual: Record<string, unknown> = {};
    const exported: Record<string, unknown> = params;
    const configured: Record<string, unknown> = config;
    for (const key of [
      "LAMPORTS_PER_SOL",
      "BPS_DENOMINATOR",
      "WSOL_MINT",
      "PUMP_LAYOUTS",
    ]) {
      expected[key] = context.exports[key];
      actual[key] = exported[key];
      expect(exported[key]).toBe(configured[key]);
    }
    for (const [block, keys] of Object.entries(selected)) {
      const values = context.exports[block] as Record<string, unknown>;
      const exportedValues = exported[block] as Record<string, unknown>;
      expect(exported[block]).toBe(configured[block]);
      expected[block] = Object.fromEntries(
        keys.map((key) => [key, values[key]]),
      );
      actual[block] = Object.fromEntries(
        keys.map((key) => [key, exportedValues[key]]),
      );
    }
    expect(actual).toEqual(expected);
  });
});
