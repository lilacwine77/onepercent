import { dbcCompatibilityProfile } from "@onepercent/config";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  DBC_ACCOUNT_CODER,
  DAMM_V2_ACCOUNT_CODER,
  DBC_IDL,
  fromMeteoraWire,
  toMeteoraWire,
} from "./codec.js";
import {
  buildDbcLaunchConfig,
  deriveDbcCurve,
  DBC_DEFAULT_THRESHOLD,
} from "./math.js";
import type {
  DbcPoolConfig,
  DbcPoolState,
  DammV2Pool,
  DammV2Position,
  DammV2Config,
} from "./types.js";
import type { Idl } from "@anchor-lang/core";
type IdlType = Idl["instructions"][number]["args"][number]["type"];
export function decodeDbcConfig(data: Uint8Array): DbcPoolConfig {
  return fromMeteoraWire(
    DBC_ACCOUNT_CODER.decode("PoolConfig", Buffer.from(data)),
  ) as DbcPoolConfig;
}
export function decodeDbcPool(data: Uint8Array): DbcPoolState {
  const v = DBC_ACCOUNT_CODER.decode("VirtualPool", Buffer.from(data)) as {
    pool_state: unknown;
  };
  return fromMeteoraWire(v.pool_state) as DbcPoolState;
}
export function decodeDammV2Pool(data: Uint8Array): DammV2Pool {
  return fromMeteoraWire(
    DAMM_V2_ACCOUNT_CODER.decode("Pool", Buffer.from(data)),
  ) as DammV2Pool;
}
export function decodeDammV2Position(data: Uint8Array): DammV2Position {
  return fromMeteoraWire(
    DAMM_V2_ACCOUNT_CODER.decode("Position", Buffer.from(data)),
  ) as DammV2Position;
}
function zeroType(type: IdlType): unknown {
  if (typeof type === "string")
    return type === "pubkey"
      ? PublicKey.default
      : type === "bool"
        ? false
        : ["u64", "i64", "u128", "i128", "u256"].includes(type)
          ? 0n
          : 0;
  if ("array" in type)
    return Array.from({ length: Number(type.array[1]) }, () =>
      zeroType(type.array[0]),
    );
  if ("defined" in type) {
    const found = DBC_IDL.types?.find((t) => t.name === type.defined.name);
    if (!found || found.type.kind !== "struct")
      throw new Error("Unsupported fixture type");
    return Object.fromEntries(
      (found.type.fields ?? []).map((f) => {
        if (typeof f !== "object" || !("name" in f))
          throw new Error("Unnamed fixture field");
        return [f.name, zeroType(f.type)];
      }),
    );
  }
  throw new Error("Unsupported fixture type");
}
function zeroAccount(name: string): Record<string, unknown> {
  return fromMeteoraWire(zeroType({ defined: { name } })) as Record<
    string,
    unknown
  >;
}
export function expectedDbcConfig(
  feeIn: PublicKey,
  migrationQuoteThreshold = DBC_DEFAULT_THRESHOLD,
): DbcPoolConfig {
  const p = buildDbcLaunchConfig(migrationQuoteThreshold),
    d = deriveDbcCurve(migrationQuoteThreshold);
  const result = zeroAccount("PoolConfig") as unknown as DbcPoolConfig;
  Object.assign(result, {
    quoteMint: NATIVE_MINT,
    feeClaimer: feeIn,
    leftoverReceiver: feeIn,
    collectFeeMode: p.collectFeeMode,
    migrationOption: p.migrationOption,
    activationType: p.activationType,
    tokenDecimal: p.tokenDecimal,
    tokenType: p.tokenType,
    partnerPermanentLockedLiquidityPercentage: 100,
    migrationFeeOption: 6,
    fixedTokenSupplyFlag: 1,
    tokenUpdateAuthority: 1,
    swapBaseAmount: d.swapBaseAmount,
    migrationQuoteThreshold,
    migrationBaseThreshold: d.migrationBaseThreshold,
    migrationSqrtPrice: d.migrationSqrtPrice,
    preMigrationTokenSupply: d.totalSupply,
    postMigrationTokenSupply: d.totalSupply,
    migratedPoolFeeBps: 250,
    sqrtStartPrice: d.sqrtStartPrice,
  });
  Object.assign(result.poolFees.baseFee, p.poolFees.baseFee);
  for (let i = 0; i < p.curve.length; i++)
    Object.assign(result.curve[i]!, p.curve[i]);
  return result;
}
function differences(
  actual: unknown,
  expected: unknown,
  path: string,
  out: string[],
): void {
  if (expected instanceof PublicKey) {
    if (!(actual instanceof PublicKey) || !actual.equals(expected))
      out.push(path);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      out.push(path);
      return;
    }
    expected.forEach((v, i) => differences(actual[i], v, `${path}[${i}]`, out));
    return;
  }
  if (expected && typeof expected === "object") {
    for (const [k, v] of Object.entries(expected)) {
      if (k.toLowerCase().includes("padding")) continue;
      differences(
        actual && typeof actual === "object"
          ? Reflect.get(actual, k)
          : undefined,
        v,
        path ? `${path}.${k}` : k,
        out,
      );
    }
    return;
  }
  if (actual !== expected) out.push(path);
}
export function dbcConfigMismatches(
  actual: DbcPoolConfig,
  feeIn: PublicKey,
  migrationQuoteThreshold = DBC_DEFAULT_THRESHOLD,
  cluster = "mainnet",
): string[] {
  const result: string[] = [];
  const expected = expectedDbcConfig(feeIn, migrationQuoteThreshold);
  const profile = dbcCompatibilityProfile(cluster);
  if (actual.version === 1 && profile.version === 1) {
    expected.version = 1;
    // Old IDL padding0 starts at account offset 216. V1 assigns these five bytes
    // to transfer fee basis points and authority selectors; require all zero.
    if (
      actual.padding0.length !== 14 ||
      actual.padding0.slice(0, 5).some((byte) => byte !== 0)
    )
      result.push("transferFeeFields");
  }
  differences(actual, expected, "", result);
  return result;
}
/** Synthetic account encoder for unit tests. Mainnet captures are separate fixtures. */
function encodeFixture(name: string, value: unknown): Buffer {
  const layoutMap = Reflect.get(DBC_ACCOUNT_CODER, "accountLayouts") as Map<
    string,
    {
      layout: { encode: (value: unknown, buffer: Buffer) => number };
      discriminator: number[];
    }
  >;
  const entry = layoutMap.get(name);
  if (!entry) throw new Error("Missing fixture layout");
  // Anchor's public encoder allocates 1,000 bytes; PoolConfig is 1,048 bytes.
  const buffer = Buffer.alloc(4096),
    length = entry.layout.encode(toMeteoraWire(value), buffer);
  return Buffer.concat([
    Buffer.from(entry.discriminator),
    buffer.subarray(0, length),
  ]);
}
export async function encodeDbcConfigFixture(
  feeIn: PublicKey,
  migrationQuoteThreshold = DBC_DEFAULT_THRESHOLD,
  overrides: Partial<DbcPoolConfig> = {},
): Promise<Buffer> {
  return encodeFixture("PoolConfig", {
    ...expectedDbcConfig(feeIn, migrationQuoteThreshold),
    ...overrides,
  });
}
export async function encodeDbcPoolFixture(
  overrides: Partial<DbcPoolState>,
): Promise<Buffer> {
  return encodeFixture("VirtualPool", {
    poolState: { ...zeroAccount("PoolState"), ...overrides },
  });
}

export function decodeDammV2Config(data: Uint8Array): DammV2Config {
  return fromMeteoraWire(
    DAMM_V2_ACCOUNT_CODER.decode("Config", Buffer.from(data)),
  ) as DammV2Config;
}
