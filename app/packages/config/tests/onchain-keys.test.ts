import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ONCHAIN_KEYS,
  PARAMS,
  HIT_TIERS,
  SELL_BACK,
  METEORA,
  METEORA_BY_CLUSTER,
  meteoraForCluster,
  parseProgramCluster,
  resolveOnchainKey,
  validateParams,
} from "../src/index.js";
import { BANNED_EVERYWHERE, BANNED_COPY } from "../src/vocabulary.js";

function validateType(type: string, value: unknown): void {
  if (type === "hex32") {
    expect(value).toMatch(/^[a-f\d]{64}$/i);
    validateType("[u8; 32]", value);
    return;
  }
  const array = type.match(/^\[(\w+); (\d+)\]$/);
  if (array) {
    const values =
      typeof value === "string" ? [...Buffer.from(value, "hex")] : value;
    expect(Array.isArray(values)).toBe(true);
    expect(values).toHaveLength(Number(array[2]));
    for (const entry of values as unknown[])
      validateType(array[1] ?? "", entry);
    return;
  }
  if (type === "Pubkey" || type === "&[u8]") {
    expect(typeof value).toBe("string");
    return;
  }
  if (type === "bool") {
    expect(typeof value).toBe("boolean");
    return;
  }
  expect(["number", "bigint"]).toContain(typeof value);
  const n = BigInt(value as number | bigint);
  const bits = Number(type.slice(1));
  const signed = type.startsWith("i");
  expect(n >= (signed ? -(1n << BigInt(bits - 1)) : 0n)).toBe(true);
  expect(n < 1n << BigInt(signed ? bits - 1 : bits)).toBe(true);
}

describe("compiled parameter contract", () => {
  it("pins only the public test signer on localnet and devnet", () => {
    const signer = JSON.parse(
      readFileSync(
        new URL(
          "../../../fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as number[];
    expect(signer).toHaveLength(64);
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const decode = (publicKey: string) => {
      let integer = 0n;
      for (const character of publicKey)
        integer = integer * 58n + BigInt(alphabet.indexOf(character));
      return [...Buffer.from(integer.toString(16).padStart(64, "0"), "hex")];
    };
    for (const cluster of ["localnet", "devnet"] as const) {
      expect(decode(meteoraForCluster(cluster).dbcConfig)).toEqual(
        signer.slice(32),
      );
    }
    expect(resolveOnchainKey("METEORA.dbcConfig")).toBe(METEORA.dbcConfig);
    expect(ONCHAIN_KEYS).toContainEqual({
      path: "METEORA.dbcConfig",
      type: "Pubkey",
    });
    if (METEORA_BY_CLUSTER.mainnet.dbcConfig === "PENDING") {
      expect(() => meteoraForCluster("mainnet")).toThrow(
        "METEORA_DBC_CONFIG is PENDING",
      );
    } else {
      expect(meteoraForCluster("mainnet").dbcConfig).toBe(
        METEORA_BY_CLUSTER.mainnet.dbcConfig,
      );
      expect(meteoraForCluster("mainnet").dbcConfig).not.toBe(
        METEORA_BY_CLUSTER.devnet.dbcConfig,
      );
    }
    expect(parseProgramCluster("mainnet-beta")).toBe("mainnet");
    expect(parseProgramCluster()).toBe("localnet");
    expect(() => parseProgramCluster("production")).toThrow(
      "Unknown program cluster",
    );
  });
  it("resolves every explicit path and fits each exact Rust type", () => {
    expect(new Set(ONCHAIN_KEYS.map((key) => key.path)).size).toBe(
      ONCHAIN_KEYS.length,
    );
    for (const key of ONCHAIN_KEYS)
      validateType(key.type, resolveOnchainKey(key.path));
  });
  it("never emits off-chain blocks or mutable governance values", () => {
    const paths = ONCHAIN_KEYS.map((key) => key.path);
    expect(paths).not.toContain("RENT_EXAMPLE_LAMPORTS_PER_BYTE");
    expect(paths).not.toContain("VRF.feeLamports");
    expect(paths).not.toContain("GOVERNANCE.timelockSeconds");
    expect(
      paths.every(
        (path) => !path.startsWith("MARKET.") && !path.startsWith("TX_LIMITS."),
      ),
    ).toBe(true);
  });
  it("appends the M2 stock bounds and Pyth constants with exact encodings", () => {
    const first = ONCHAIN_KEYS.findIndex(
      (entry) => entry.path === "STOCK.tradeMinSpacingSeconds",
    );
    expect(ONCHAIN_KEYS.slice(first, first + 5)).toEqual([
      { path: "STOCK.tradeMinSpacingSeconds", type: "i64" },
      { path: "STOCK.hourlyFloorLamports", type: "u64" },
      { path: "STOCK.hourlyHitOutMultiple", type: "u32" },
      { path: "HIT_LIST.solUsdPythFeedId", type: "hex32" },
      { path: "PROGRAM_IDS.pythReceiver", type: "Pubkey" },
    ]);
    expect(ONCHAIN_KEYS.map((key) => key.path)).not.toContain(
      "PROGRAM_IDS.pythPushOracle",
    );
    expect(ONCHAIN_KEYS.map((key) => key.path)).not.toContain(
      "PROGRAM_IDS.pythWormholeReceiver",
    );
  });
  it("compiles the D29 Meteora fee provision after the frozen M2 keys", () => {
    const pin = ONCHAIN_KEYS.findIndex(
      (entry) => entry.path === "METEORA.dbcConfig",
    );
    expect(ONCHAIN_KEYS[pin + 1]).toEqual({
      path: "METEORA.feeAllowBps",
      type: "u32",
    });
    expect(resolveOnchainKey("METEORA.feeAllowBps")).toBe(300);
  });
  it("uses the exact Sell back tiers", () => {
    expect(SELL_BACK.eligibleKinds).toEqual(
      HIT_TIERS.filter((tier) => tier.sellBack).map((tier) => tier.id),
    );
  });
  it("rejects missing, unknown, incorrectly typed and inconsistent parameters", () => {
    expect(() => resolveOnchainKey("STOCK.missing")).toThrow("Unresolved");
    expect(() => validateParams({ ...PARAMS, UNKNOWN: true })).toThrow();
    expect(() =>
      validateParams({ ...PARAMS, VRF: { ...PARAMS.VRF, maxQueues: 4.1 } }),
    ).toThrow();
    expect(() =>
      validateParams({
        ...PARAMS,
        ACCOUNT_SIZES: { ...PARAMS.ACCOUNT_SIZES, deckEntry: 1_000_000 },
      }),
    ).toThrow("allocation limits");
    expect(() =>
      validateParams({
        ...PARAMS,
        HIT_ODDS: { ...PARAMS.HIT_ODDS, blackPpb: 3_000_000 },
      }),
    ).toThrow("identity");
    expect(() =>
      validateParams({
        ...PARAMS,
        SPOTLIGHT: { ...PARAMS.SPOTLIGHT, enabledAtLaunch: true },
      }),
    ).toThrow("Season 1");
  });
  it("keeps the vocabulary source centralized and both lists distinct", () => {
    expect(new Set(BANNED_EVERYWHERE).size).toBe(BANNED_EVERYWHERE.length);
    expect(new Set(BANNED_COPY).size).toBe(BANNED_COPY.length);
    const scanner = readFileSync(
      new URL("../../../apps/web/scripts/lint-words.mjs", import.meta.url),
      "utf8",
    );
    expect(scanner).toContain("packages/config/src/vocabulary.ts");
    for (const word of BANNED_EVERYWHERE)
      expect(scanner).not.toContain(`"${word}"`);
  });
});
