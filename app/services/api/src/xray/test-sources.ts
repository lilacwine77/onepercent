import { vi } from "vitest";
import type { ChainSource, PriceSource } from "./provider-types.js";
const address = "11111111111111111111111111111111";
export function testSources() {
  const chain: ChainSource = {
    getTokenAccounts: vi.fn(async () => []),
    getAccounts: vi.fn(async () => new Map()),
    getMetadata: vi.fn(async () => new Map()),
    getSlot: vi.fn(async () => 100),
    getBlockTime: vi.fn(async () => 1_700_000_000),
    getSnapshotEvidence: vi.fn(async () => new Map()),
  };
  const prices: PriceSource = {
    getPrices: vi.fn(async () => ({})),
    getTokenInfo: vi.fn(async () => ({})),
    getSolUsd: vi.fn(async () => 200),
  };
  return {
    chain,
    prices,
    names: { resolve: vi.fn(async () => address) },
    publicWebUrl: "http://localhost:5173",
    publicApiUrl: "http://localhost:3000",
    now: () => Date.parse("2026-10-08T12:00:00.000Z"),
  };
}
