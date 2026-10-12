import { expect, it, vi } from "vitest";
import * as browser from "@onepercent/config/web";
import {
  CARDS_PER_PACK,
  HIT_TIERS,
  MARKET,
  MILLISECONDS_PER_MINUTE,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  SELL_BACK,
  TOKEN_1PCT,
  WEB,
  validateParams,
  validateWebParams,
  validateMarketParams,
  validateBotParams,
} from "../src/index.js";

it("shares the exact canonical objects while retaining full service validation", () => {
  expect(Object.keys(browser).sort()).toEqual([
    "CARDS_PER_PACK",
    "FEED_BACKGROUND_RPC_SHARE",
    "HIT_TIERS",
    "MILLISECONDS_PER_MINUTE",
    "PACK_EDITIONS",
    "PACK_SPLIT_BPS",
    "SELL_BACK",
    "TOKEN_1PCT",
    "WEB",
  ]);
  expect(browser.FEED_BACKGROUND_RPC_SHARE).toBeGreaterThan(0);
  expect(browser.FEED_BACKGROUND_RPC_SHARE).toBeLessThanOrEqual(0.25);
  expect(browser.CARDS_PER_PACK).toBe(CARDS_PER_PACK);
  expect(browser.HIT_TIERS).toBe(HIT_TIERS);
  expect(browser.MILLISECONDS_PER_MINUTE).toBe(MILLISECONDS_PER_MINUTE);
  expect(browser.SELL_BACK).toBe(SELL_BACK);
  expect(browser.TOKEN_1PCT).toBe(TOKEN_1PCT);
  expect(browser.PACK_EDITIONS).toBe(PACK_EDITIONS);
  expect(browser.PACK_SPLIT_BPS).toBe(PACK_SPLIT_BPS);
  expect(browser.WEB).toBe(WEB);
  expect(WEB.httpTimeoutMs).toBe(MARKET.http.timeoutMs);
  expect(validateParams().PACK_EDITIONS).toEqual(browser.PACK_EDITIONS);
  expect(validateWebParams()).toEqual(browser.WEB);
  expect(() => validateMarketParams()).not.toThrow();
  expect(() => validateBotParams()).not.toThrow();
});

it("loads the browser entry without loading zod, directly or transitively", async () => {
  vi.resetModules();
  vi.doMock("zod", () => {
    throw new Error("Validation dependency loaded");
  });
  try {
    await expect(import("@onepercent/config/web")).resolves.toMatchObject(
      browser,
    );
    // Prove that the same mock rejects the service entry and its schemas.
    await expect(import("../src/index.js")).rejects.toThrow();
  } finally {
    vi.doUnmock("zod");
    vi.resetModules();
  }
});
