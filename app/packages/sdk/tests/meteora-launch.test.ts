import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { WSOL_MINT } from "@onepercent/config";
import { describe, expect, it } from "vitest";
import {
  DBC_LAUNCH_LAYOUT,
  dbcLaunchDataIsValid,
  decodeDbcLaunchConfig,
  decodeDbcLaunchPool,
} from "../src/meteora/launch.js";

type IdlType =
  string | { array: [IdlType, number] } | { defined: { name: string } };
interface Definition {
  name: string;
  type: { kind: "struct"; fields: { name: string; type: IdlType }[] };
}
const idl = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/meteora/dbc.json", import.meta.url),
    "utf8",
  ),
) as {
  accounts: { name: string; discriminator: number[] }[];
  types: Definition[];
};
const definition = (name: string) => {
  const found = idl.types.find((type) => type.name === name);
  if (!found) throw new Error(`Missing DBC definition ${name}`);
  return found;
};
function byteSize(type: IdlType): number {
  if (typeof type === "string") {
    const widths: Record<string, number> = {
      u8: 1,
      u16: 2,
      u32: 4,
      u64: 8,
      u128: 16,
      pubkey: 32,
    };
    const width = widths[type];
    if (width === undefined) throw new Error(`Unsupported DBC field ${type}`);
    return width;
  }
  if ("array" in type) return byteSize(type.array[0]) * type.array[1];
  return definition(type.defined.name).type.fields.reduce(
    (sum, field) => sum + byteSize(field.type),
    0,
  );
}
function offset(name: string, fieldName: string): number {
  let result = 8;
  for (const field of definition(name).type.fields) {
    if (field.name === fieldName) return result;
    result += byteSize(field.type);
  }
  throw new Error(`Missing DBC field ${name}.${fieldName}`);
}

describe("pinned DBC launch account layouts", () => {
  it("matches every consumed offset, size and discriminator from the pinned IDL", () => {
    const pool = DBC_LAUNCH_LAYOUT.pool;
    const config = DBC_LAUNCH_LAYOUT.config;
    expect(pool.discriminator).toEqual(
      idl.accounts.find((account) => account.name === "VirtualPool")!
        .discriminator,
    );
    expect(config.discriminator).toEqual(
      idl.accounts.find((account) => account.name === "PoolConfig")!
        .discriminator,
    );
    const rust = readFileSync(
      new URL("../../../programs/onepercent/src/constants.rs", import.meta.url),
      "utf8",
    );
    const rustValues = {
      DBC_POOL_MIN_LEN: pool.minLength,
      DBC_POOL_CONFIG_OFFSET: pool.config,
      DBC_POOL_BASE_MINT_OFFSET: pool.baseMint,
      DBC_CONFIG_MIN_LEN: config.minLength,
      DBC_CONFIG_QUOTE_MINT_OFFSET: config.quoteMint,
      DBC_CONFIG_FEE_CLAIMER_OFFSET: config.feeClaimer,
      DBC_CONFIG_CREATOR_TRADING_FEE_PERCENTAGE_OFFSET:
        config.creatorTradingFeePercentage,
    };
    for (const [name, value] of Object.entries(rustValues)) {
      expect(rust).toContain(`pub const ${name}: usize = ${value};`);
    }
    for (const [name, values] of [
      ["DBC_POOL_DISCRIMINATOR", pool.discriminator],
      ["DBC_CONFIG_DISCRIMINATOR", config.discriminator],
    ] as const) {
      expect(rust).toContain(
        `pub const ${name}: [u8; 8] = [${values.join(", ")}];`,
      );
    }
    expect(pool.minLength).toBe(
      8 + byteSize({ defined: { name: "VirtualPool" } }),
    );
    expect(config.minLength).toBe(
      8 + byteSize({ defined: { name: "PoolConfig" } }),
    );
    for (const [key, field] of [
      ["config", "config"],
      ["baseMint", "base_mint"],
      ["baseVault", "base_vault"],
      ["quoteVault", "quote_vault"],
    ] as const) {
      expect(pool[key]).toBe(offset("PoolState", field));
    }
    for (const [key, field] of [
      ["quoteMint", "quote_mint"],
      ["feeClaimer", "fee_claimer"],
      ["creatorTradingFeePercentage", "creator_trading_fee_percentage"],
    ] as const) {
      expect(config[key]).toBe(offset("PoolConfig", field));
    }
  });

  it("accepts pinned launch fields and rejects changed identities or creator fees", () => {
    const mint = new PublicKey(new Uint8Array(32).fill(28));
    const dbcConfig = new PublicKey(new Uint8Array(32).fill(29));
    const feeIn = new PublicKey(new Uint8Array(32).fill(27));
    const pool = new Uint8Array(DBC_LAUNCH_LAYOUT.pool.minLength);
    const config = new Uint8Array(DBC_LAUNCH_LAYOUT.config.minLength);
    pool.set(DBC_LAUNCH_LAYOUT.pool.discriminator);
    pool.set(mint.toBytes(), offset("PoolState", "base_mint"));
    pool.set(dbcConfig.toBytes(), offset("PoolState", "config"));
    config.set(DBC_LAUNCH_LAYOUT.config.discriminator);
    config.set(
      new PublicKey(WSOL_MINT).toBytes(),
      offset("PoolConfig", "quote_mint"),
    );
    config.set(feeIn.toBytes(), offset("PoolConfig", "fee_claimer"));
    const input = { pool, config, mint, dbcConfig, feeIn };
    expect(dbcLaunchDataIsValid(input)).toBe(true);
    expect(decodeDbcLaunchPool(pool).baseMint.equals(mint)).toBe(true);
    expect(decodeDbcLaunchConfig(config).feeClaimer.equals(feeIn)).toBe(true);
    // D29 §3.1 does not add economic fields to Power-On's gate. The launch
    // track must check its exact curve/migration inputs before mainnet release.
    for (const name of ["migration_quote_threshold", "sqrt_start_price"]) {
      const at = offset("PoolConfig", name);
      config[at] = config[at]! ^ 1;
      expect(dbcLaunchDataIsValid(input)).toBe(true);
      config[at] = config[at]! ^ 1;
    }
    for (const [data, at] of [
      [pool, 0],
      [pool, offset("PoolState", "base_mint")],
      [pool, offset("PoolState", "config")],
      [config, 0],
      [config, offset("PoolConfig", "quote_mint")],
      [config, offset("PoolConfig", "fee_claimer")],
      [config, offset("PoolConfig", "creator_trading_fee_percentage")],
    ] as const) {
      data[at] = data[at]! ^ 1;
      expect(dbcLaunchDataIsValid(input)).toBe(false);
      data[at] = data[at]! ^ 1;
    }
    expect(dbcLaunchDataIsValid({ ...input, pool: pool.slice(0, -1) })).toBe(
      false,
    );
    expect(
      dbcLaunchDataIsValid({ ...input, config: config.slice(0, -1) }),
    ).toBe(false);
  });
});
