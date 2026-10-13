import { DEPLOYMENT, PROGRAM_ID } from "./program-id.js";
import { createDeploymentSelector } from "../src/deployment.js";
import type { ClusterDeployment } from "../src/deployment.js";
import { Buffer } from "buffer";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  BURN,
  CU_LIMITS,
  METEORA,
  METEORA_BY_CLUSTER,
  meteoraForCluster,
  HIT_LIST,
  JACKPOT,
  PAUSE_BITS,
  PUMP_LAYOUTS,
  STOCK,
  TX_LIMITS,
} from "@onepercent/config";
import {
  PUMPSWAP_POOL_DISCRIMINATOR,
  POOL_AUTHORITY_SEED,
  BUCKET_NONE,
  EXEC_KIND,
  EXTERNAL_IDS,
  IDL,
  PHASE,
  PYTH_PRICE_UPDATE_V2_DISCRIMINATOR,
  composeExecTransaction,
  configPda,
  decodeConfig,
  decodeMachine,
  encodeConfig,
  encodeMachine,
  encodeMintLedger,
  execBeginIx,
  execEndIx,
  ledgerPda,
  machinePda,
  serializedSize,
  userAta,
  vaultAta,
  vaultAuthPda,
} from "../src/index.js";
import {
  bookOf,
  checkExecBegin,
  minOutMajor,
  minOutMeteoraBuy,
  minOutPoolBuy,
  minOutPoolSell,
  readMeteora,
  rotateStockHour,
  stockCap,
} from "@onepercent/sdk/server";
import type { ExecBeginInput, ComposeExecInput } from "../src/index.js";
import type {
  ExecAccountReading,
  ExecReadings,
  ExecState,
  MajorQuoteInput,
  PoolQuoteInput,
  MeteoraQuoteInput,
} from "@onepercent/sdk/server";
import { decimalJson, vectors } from "./vectors.js";
type Mutable<T> = T extends PublicKey | Uint8Array | ClusterDeployment
  ? T
  : { -readonly [K in keyof T]: Mutable<T[K]> };
const U64_MAX = (1n << 64n) - 1n;
const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const data = (account: ExecAccountReading) => account.data as Buffer;
const empty = (): ExecAccountReading => ({
  address: SystemProgram.programId,
  owner: SystemProgram.programId,
  data: Buffer.alloc(0),
});
interface QuoteVector {
  input: Record<string, string | number>;
  output: { expected: string; minOut: string };
}
interface ExecVectors {
  majorBuy: QuoteVector[];
  majorSell: QuoteVector[];
  poolBuy: QuoteVector[];
  poolSell: QuoteVector[];
  meteoraBuy: QuoteVector[];
  book: {
    input: { amount: string; bucketAmount: string; cost: string };
    output: string;
  }[];
  stockCap: {
    input: { hitOutLastHour: string; hitOutThisHour: string };
    output: string;
  }[];
  errors: {
    formula: string;
    input: Record<string, string | number>;
    error: string;
  }[];
}
function inputOf(input: Record<string, string | number>) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? BigInt(value) : value,
    ]),
  );
}
const formulas: Record<string, (input: Record<string, unknown>) => unknown> = {
  majorBuy: (input) => minOutMajor(input as unknown as MajorQuoteInput),
  majorSell: (input) =>
    minOutMajor({ ...(input as unknown as MajorQuoteInput), sell: true }),
  poolBuy: (input) => minOutPoolBuy(input as unknown as PoolQuoteInput),
  poolSell: (input) => minOutPoolSell(input as unknown as PoolQuoteInput),
  meteoraBuy: (input) =>
    minOutMeteoraBuy(input as unknown as MeteoraQuoteInput),
  book: (input) =>
    bookOf(
      input.amount as bigint,
      input.bucketAmount as bigint,
      input.cost as bigint,
    ),
};
function token(
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount = 0n,
  native = false,
): ExecAccountReading {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  if (native) data.writeUInt32LE(1, 109);
  return { address, owner: EXTERNAL_IDS.splToken, data };
}
function pyth(
  address: PublicKey,
  feed: Uint8Array,
  price: bigint,
  now: bigint,
): ExecAccountReading {
  const data = Buffer.alloc(133);
  data.set(PYTH_PRICE_UPDATE_V2_DISCRIMINATOR);
  data[40] = 1;
  data.set(feed, 41);
  data.writeBigInt64LE(price, 73);
  data.writeBigUInt64LE(1n, 81);
  data.writeInt32LE(-8, 89);
  data.writeBigInt64LE(now, 93);
  return { address, owner: EXTERNAL_IDS.pythReceiver, data };
}
function fixture(sell = false, deployment: ClusterDeployment = DEPLOYMENT) {
  const programId = deployment.programId;
  const now = 7200n,
    signer = Keypair.generate().publicKey,
    mint = key(2),
    feed = key(3);
  const state: Mutable<ExecState> = {
    deployment,
    config: decodeConfig(
      encodeConfig({ keeper: signer, executor: key(4), token_mint: key(5) }),
    ),
    machine: decodeMachine(
      encodeMachine({
        phase: PHASE.onAir,
        end_ts: now + 1000n,
        stock_sol: 100_000_000_000n,
        hour_index: 2n,
        stock_hour_index: 2n,
        buckets: [
          {
            mint,
            oracle: feed,
            amount: 1_000_000_000n,
            cost: 8_000_000_000n,
            cap: 20_000_000_000n,
            enabled: 1,
            class: 1,
            decimals: 6,
          },
          ...Array.from({ length: STOCK.maxBuckets - 1 }, () => ({})),
        ],
      }),
    ),
  };
  const args: ExecBeginInput = {
    signer,
    mint,
    kind: sell ? EXEC_KIND.stockSell : EXEC_KIND.stockBuy,
    bucket: 0,
    amount: sell ? 100_000_000n : 1_000_000_000n,
    tokenProgram: EXTERNAL_IDS.splToken,
    oracles: [key(6), key(7), SystemProgram.programId, SystemProgram.programId],
  };
  const mintData = Buffer.alloc(82);
  mintData[44] = 6;
  mintData[45] = 1;
  const readings: ExecReadings = {
    mint: { address: mint, owner: EXTERNAL_IDS.splToken, data: mintData },
    ledger: {
      address: ledgerPda(programId, mint)[0],
      owner: programId,
      data: encodeMintLedger({ mint, accounted: 1_000_000_000n }),
    },
    vault: token(
      vaultAta(programId, mint, EXTERNAL_IDS.splToken),
      mint,
      vaultAuthPda(programId)[0],
      1_000_000_000n,
    ),
    src: token(
      userAta(signer, sell ? mint : NATIVE_MINT, EXTERNAL_IDS.splToken),
      sell ? mint : NATIVE_MINT,
      signer,
      0n,
      !sell,
    ),
    solDest: sell
      ? token(
          vaultAta(programId, NATIVE_MINT, EXTERNAL_IDS.splToken),
          NATIVE_MINT,
          vaultAuthPda(programId)[0],
          777n,
          true,
        )
      : empty(),
    oracles: [
      pyth(key(6), feed.toBytes(), 85_000_000n, now),
      pyth(
        key(7),
        Buffer.from(HIT_LIST.solUsdPythFeedId, "hex"),
        10_901_000_000n,
        now,
      ),
      empty(),
      empty(),
    ],
    execution: {
      stackHeight: 1,
      currentIndex: 0,
      instructions: [execBeginIx(programId, args), execEndIx(programId, args)],
    },
    machineLamports: 200_000_000_000n,
    machineRentMinimum: 1_000_000n,
  };
  const run = () => {
    readings.execution.instructions = [
      execBeginIx(programId, args),
      execEndIx(programId, args),
    ];
    return checkExecBegin(state, args, readings, now);
  };
  return { state, args, readings, now, run };
}

describe("M2 exec integer vectors", () => {
  const golden = vectors<ExecVectors>("exec");
  for (const name of [
    "majorBuy",
    "majorSell",
    "poolBuy",
    "poolSell",
    "meteoraBuy",
  ] as const)
    it(`${name}: independent golden cases and bounds`, () => {
      expect(golden[name].length).toBeGreaterThanOrEqual(50);
      for (const vector of golden[name])
        expect(decimalJson(formulas[name]!(inputOf(vector.input)))).toEqual(
          vector.output,
        );
    });
  it("book costs and saturating gross caps", () => {
    expect(golden.book.length).toBeGreaterThanOrEqual(50);
    for (const { input, output } of golden.book)
      expect(
        bookOf(
          BigInt(input.amount),
          BigInt(input.bucketAmount),
          BigInt(input.cost),
        ).toString(),
      ).toBe(output);
    for (const { input, output } of golden.stockCap)
      expect(
        stockCap(
          BigInt(input.hitOutLastHour),
          BigInt(input.hitOutThisHour),
        ).toString(),
      ).toBe(output);
    expect(bookOf(U64_MAX, U64_MAX, U64_MAX)).toBe(U64_MAX);
  });
  it("matches intermediate overflow and invalid input failures", () => {
    for (const vector of golden.errors)
      expect(() => formulas[vector.formula]!(inputOf(vector.input))).toThrow(
        vector.error,
      );
    expect(() =>
      minOutMajor({
        amount: 1n << 64n,
        tokenPrice: 1n,
        solPrice: 1n,
        tokenExponent: 0,
        solExponent: 0,
        decimals: 9,
      }),
    ).toThrow("MathOverflow");
  });
  it("rotates stock gross caps without changing the input", () => {
    const state = {
      stock_hour_index: 1n,
      stock_bought_hour: 100n,
      stock_sold_hour: 200n,
    };
    expect(rotateStockHour(state, 7199n)).toEqual(state);
    expect(rotateStockHour(state, 7200n)).toEqual({
      stock_hour_index: 2n,
      stock_bought_hour: 0n,
      stock_sold_hour: 0n,
    });
    expect(rotateStockHour(state, -1n).stock_hour_index).toBe(0n);
    expect(state.stock_bought_hour).toBe(100n);
  });
});

interface MeteoraCapture {
  address: string;
  readSlot: number;
  account: { owner: string; data: [string, "base64"] };
}
function capturedMeteora(name: string): ExecAccountReading {
  const capture = JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/meteora/accounts/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as MeteoraCapture;
  expect(capture.readSlot).toBeGreaterThan(0);
  return {
    address: new PublicKey(capture.address),
    owner: new PublicKey(capture.account.owner),
    data: Buffer.from(...capture.account.data),
  };
}
function u128At(bytes: Buffer, offset: number): bigint {
  return (
    bytes.readBigUInt64LE(offset) + (bytes.readBigUInt64LE(offset + 8) << 64n)
  );
}
function meteoraFixture(migrated = false) {
  const prefix = migrated ? "dbc-migrated" : "dbc-active";
  const active = migrated ? "damm-migrated" : prefix;
  const dbc = capturedMeteora(prefix);
  const mint = new PublicKey(data(dbc).subarray(136, 168));
  const expectedDbcConfig = new PublicKey(data(dbc).subarray(72, 104));
  const oracles: ExecReadings["oracles"] = [
    dbc,
    migrated ? capturedMeteora(active) : empty(),
    capturedMeteora(`${active}-base-vault`),
    capturedMeteora(`${active}-quote-vault`),
  ];
  const run = () => readMeteora(oracles, mint, expectedDbcConfig);
  return { mint, expectedDbcConfig, oracles, run };
}
describe("D29 Meteora spot-price math", () => {
  it.each([
    ["dbc-active", 280, 994_916_785_397n, 979_993_033_616n, 984_967_617_543n],
    [
      "damm-migrated",
      456,
      1_047_079_933_723n,
      1_031_373_734_717n,
      1_036_609_134_385n,
    ],
  ] as const)(
    "pins %s raw account spot buys",
    (name, offset, expected, burn, jackpot) => {
      const pool = capturedMeteora(name);
      const sqrtPrice = u128At(data(pool), offset);
      expect(
        minOutMeteoraBuy({
          amount: 50_000_000n,
          sqrtPrice,
          slipBps: BURN.minOutSlipBps,
        }),
      ).toEqual({ expected, minOut: burn });
      expect(
        minOutMeteoraBuy({
          amount: 50_000_000n,
          sqrtPrice,
          slipBps: JACKPOT.minOutSlipBps,
        }),
      ).toEqual({ expected, minOut: jackpot });
    },
  );
  it("floors fees before conversion, then floors slippage", () => {
    expect(
      minOutMeteoraBuy({ amount: 103n, sqrtPrice: 1n << 64n, slipBps: 150 }),
    ).toEqual({ expected: 99n, minOut: 97n });
    expect(
      minOutMeteoraBuy({
        amount: U64_MAX,
        sqrtPrice: (1n << 128n) - 1n,
        slipBps: 0,
      }),
    ).toEqual({ expected: 0n, minOut: 0n });
  });
  it("refuses zero price, out-of-range inputs and output overflow", () => {
    for (const [amount, sqrtPrice, slipBps, error] of [
      [1n, 0n, 0, "OracleInvalid"],
      [U64_MAX + 1n, 1n << 64n, 0, "MathOverflow"],
      [1n, 1n << 128n, 0, "MathOverflow"],
      [U64_MAX, 1n, 0, "MathOverflow"],
      [1n, 1n << 64n, 10_001, "MathOverflow"],
    ] as const)
      expect(() => minOutMeteoraBuy({ amount, sqrtPrice, slipBps })).toThrow(
        error,
      );
  });
});

describe("D29 canonical Meteora account reads", () => {
  it("authenticates a live DBC reference and both SPL vaults", () => {
    expect(meteoraFixture().run()).toEqual({
      migrated: false,
      sqrtPrice: 128_794_468_968_736_475n,
      recordedQuote: 11_718_439_597n,
      actualQuote: 18_919_831_183n,
    });
  });
  it("selects DAMM v2 when is_migrated is one, ignoring the old DBC price", () => {
    const f = meteoraFixture(true);
    const result = f.run();
    expect(result).toMatchObject({
      migrated: true,
      sqrtPrice: 125_545_362_027_818_175n,
      recordedQuote: 173_933_382_992n,
      actualQuote: 174_079_781_792n,
      layoutVersion: 1,
    });
    data(f.oracles[0]).fill(0, 280, 296);
    expect(f.run()).toEqual(result);
  });
  it.each([false, true])(
    "rejects another reference pool, migrated=%s",
    (migrated) => {
      const f = meteoraFixture(migrated);
      f.oracles[migrated ? 1 : 0].address = key(77);
      expect(f.run).toThrow("AccountMismatch");
    },
  );
  it.each([false, true])(
    "requires an independent expected config pin, migrated=%s",
    (migrated) => {
      const f = meteoraFixture(migrated);
      expect(() => readMeteora(f.oracles, f.mint, key(77))).toThrow(
        "AccountMismatch",
      );
    },
  );
  it.each([false, true])(
    "rejects a substituted vault authority, migrated=%s",
    (migrated) => {
      const f = meteoraFixture(migrated);
      key(77).toBuffer().copy(data(f.oracles[3]), 32);
      expect(f.run).toThrow("AccountMismatch");
    },
  );
  it("requires the pre-migration DAMM sentinel", () => {
    const f = meteoraFixture();
    f.oracles[1].address = key(77);
    expect(f.run).toThrow("AccountMismatch");
  });
  it("rejects an unsupported migration flag and malformed pool data", () => {
    const f = meteoraFixture();
    data(f.oracles[0])[305] = 2;
    expect(f.run).toThrow("OracleInvalid");
    const g = meteoraFixture(true);
    g.oracles[1].data = g.oracles[1].data.subarray(0, 1111);
    expect(g.run).toThrow("OracleInvalid");
  });
  it("matches Rust error ordering when vault metadata and bytes both fail", () => {
    const f = meteoraFixture(true);
    f.oracles[2].data = Buffer.alloc(0);
    f.oracles[3].owner = key(77);
    expect(f.run).toThrow("AccountMismatch");
    const g = meteoraFixture(true);
    key(77).toBuffer().copy(data(g.oracles[2]), 0);
    g.oracles[3].data = Buffer.alloc(0);
    expect(g.run).toThrow("OracleInvalid");
  });
  it.each([
    [
      "owner",
      (f: ReturnType<typeof meteoraFixture>) => {
        f.oracles[1].owner = key(77);
      },
      "AccountMismatch",
    ],
    [
      "mint orientation",
      (f: ReturnType<typeof meteoraFixture>) => {
        key(77).toBuffer().copy(data(f.oracles[1]), 200);
      },
      "AccountMismatch",
    ],
    [
      "discriminator",
      (f: ReturnType<typeof meteoraFixture>) => {
        data(f.oracles[1])[0] = 0;
      },
      "OracleInvalid",
    ],
    [
      "disabled pool",
      (f: ReturnType<typeof meteoraFixture>) => {
        data(f.oracles[1])[481] = 1;
      },
      "OracleInvalid",
    ],
    [
      "unsupported layout",
      (f: ReturnType<typeof meteoraFixture>) => {
        data(f.oracles[1])[696] = 0;
      },
      "OracleInvalid",
    ],
    [
      "zero price",
      (f: ReturnType<typeof meteoraFixture>) => {
        data(f.oracles[1]).fill(0, 456, 472);
      },
      "OracleInvalid",
    ],
    [
      "invalid token data",
      (f: ReturnType<typeof meteoraFixture>) => {
        data(f.oracles[2])[108] = 0;
      },
      "OracleInvalid",
    ],
    [
      "non-native quote",
      (f: ReturnType<typeof meteoraFixture>) => {
        data(f.oracles[3]).writeUInt32LE(0, 109);
      },
      "OracleInvalid",
    ],
  ] as const)("rejects DAMM %s", (_, mutate, error) => {
    const f = meteoraFixture(true);
    mutate(f);
    expect(f.run).toThrow(error);
  });
});

describe("checkExecBegin account and state mirror", () => {
  it.each([false, true])("accepts a bound MAJOR pair, sell=%s", (sell) => {
    const f = fixture(sell),
      original = decimalJson(f.state);
    const quote = minOutMajor({
      amount: f.args.amount,
      tokenPrice: 85_000_000n,
      solPrice: 10_901_000_000n,
      tokenExponent: -8,
      solExponent: -8,
      decimals: 6,
      sell,
    });
    expect(f.run()).toEqual({ ok: true, minOut: quote.minOut });
    expect(decimalJson(f.state)).toEqual(original);
  });
  const cases: [string, (f: ReturnType<typeof fixture>) => void, string][] = [
    [
      "role",
      (f) => {
        f.state.config.keeper = key(8);
      },
      "Unauthorized",
    ],
    [
      "disabled role",
      (f) => {
        f.state.config.disabled_roles = 1 << 3;
      },
      "RoleDisabled",
    ],
    [
      "pause",
      (f) => {
        f.state.config.guardian_paused = PAUSE_BITS.stockBuy;
      },
      "Paused",
    ],
    [
      "phase",
      (f) => {
        f.state.machine.phase = PHASE.stockUp;
      },
      "WrongPhase",
    ],
    [
      "season",
      (f) => {
        f.state.machine.end_ts = f.now;
      },
      "SeasonOver",
    ],
    [
      "in flight",
      (f) => {
        f.state.machine.exec.kind = EXEC_KIND.burn;
      },
      "ExecInFlight",
    ],
    [
      "bucket",
      (f) => {
        f.args.bucket = 16;
      },
      "BucketInvalid",
    ],
    [
      "bucket class",
      (f) => {
        f.state.machine.buckets[0]!.class = 3;
      },
      "BucketInvalid",
    ],
    [
      "vault",
      (f) => {
        f.readings.vault.address = key(8);
      },
      "VaultMismatch",
    ],
    [
      "ledger",
      (f) => {
        f.readings.ledger.address = key(8);
      },
      "LedgerMismatch",
    ],
    [
      "src native",
      (f) => {
        data(f.readings.src).writeUInt32LE(0, 109);
      },
      "AccountMismatch",
    ],
    [
      "src owner",
      (f) => {
        key(8).toBuffer().copy(data(f.readings.src), 32);
      },
      "AccountMismatch",
    ],
    [
      "disabled bucket",
      (f) => {
        f.state.machine.buckets[0]!.enabled = 0;
      },
      "BucketDisabled",
    ],
    [
      "unsafe mint",
      (f) => {
        data(f.readings.mint).writeUInt32LE(1, 0);
      },
      "MintNotSafe",
    ],
    [
      "spacing",
      (f) => {
        f.state.machine.last_stock_trade_ts =
          f.now - BigInt(STOCK.tradeMinSpacingSeconds) + 1n;
      },
      "TooSoon",
    ],
    [
      "tranche",
      (f) => {
        f.args.amount = STOCK.majorTrancheMaxLamports + 1n;
      },
      "TrancheTooLarge",
    ],
    [
      "bucket cap",
      (f) => {
        f.state.machine.buckets[0]!.cap = 8_000_000_000n;
      },
      "BucketCapExceeded",
    ],
    [
      "hourly cap",
      (f) => {
        f.state.machine.stock_bought_hour = STOCK.hourlyFloorLamports;
      },
      "HourlyCapReached",
    ],
    [
      "oracle owner",
      (f) => {
        f.readings.oracles[0].owner = key(8);
      },
      "OracleInvalid",
    ],
    [
      "oracle feed",
      (f) => {
        data(f.readings.oracles[0])[41] = 0;
      },
      "OracleInvalid",
    ],
    [
      "partial verification",
      (f) => {
        data(f.readings.oracles[0])[40] = 0;
      },
      "OracleInvalid",
    ],
    [
      "stale",
      (f) => {
        data(f.readings.oracles[0]).writeBigInt64LE(
          f.now - BigInt(STOCK.pythMaxAgeSeconds) - 1n,
          93,
        );
      },
      "OracleStale",
    ],
    [
      "wide",
      (f) => {
        data(f.readings.oracles[0]).writeBigUInt64LE(850_001n, 81);
      },
      "OracleWide",
    ],
    [
      "rent",
      (f) => {
        f.readings.machineLamports =
          f.args.amount + f.readings.machineRentMinimum - 1n;
      },
      "TrancheTooLarge",
    ],
  ];
  it.each(cases)("rejects %s", (_, change, error) => {
    const f = fixture();
    change(f);
    expect(f.run()).toEqual({ ok: false, error });
  });
  it("requires top-level and exactly the paired two program instructions", () => {
    const f = fixture();
    f.readings.execution.stackHeight = 2;
    expect(f.run()).toEqual({ ok: false, error: "NotTopLevel" });
    f.readings.execution.stackHeight = 1;
    for (const instructions of [
      [execBeginIx(PROGRAM_ID, f.args)],
      [
        execBeginIx(PROGRAM_ID, f.args),
        execEndIx(PROGRAM_ID, f.args),
        execEndIx(PROGRAM_ID, f.args),
      ],
      [execEndIx(PROGRAM_ID, f.args), execBeginIx(PROGRAM_ID, f.args)],
    ]) {
      f.readings.execution.instructions = instructions;
      expect(checkExecBegin(f.state, f.args, f.readings, f.now)).toEqual({
        ok: false,
        error: "ExecPairing",
      });
    }
  });
  it("checks pairing and in-flight state before begin account bindings", () => {
    const f = fixture(true);
    const begin = execBeginIx(PROGRAM_ID, f.args);
    begin.keys[8]!.isWritable = false;
    f.readings.execution.instructions = [begin];
    const run = () => checkExecBegin(f.state, f.args, f.readings, f.now);
    expect(run()).toEqual({ ok: false, error: "ExecPairing" });
    f.readings.execution.instructions = [begin, execEndIx(PROGRAM_ID, f.args)];
    f.state.machine.exec.kind = EXEC_KIND.stockSell;
    expect(run()).toEqual({ ok: false, error: "ExecInFlight" });
    f.state.machine.exec.kind = EXEC_KIND.none;
    expect(run()).toEqual({ ok: false, error: "AccountMismatch" });
  });
  it("accepts age/confidence boundaries, future publish times, and hourly rollover", () => {
    const f = fixture();
    data(f.readings.oracles[0]).writeBigInt64LE(
      f.now - BigInt(STOCK.pythMaxAgeSeconds),
      93,
    );
    data(f.readings.oracles[0]).writeBigUInt64LE(850_000n, 81);
    f.state.machine.stock_hour_index = 1n;
    f.state.machine.stock_bought_hour = U64_MAX;
    expect(f.run().ok).toBe(true);
    data(f.readings.oracles[0]).writeBigInt64LE(f.now + 1n, 93);
    expect(f.run().ok).toBe(true);
  });
  it("sells disabled buckets in BuysClosed, skipping the MAJOR gross cap", () => {
    const f = fixture(true);
    f.state.machine.phase = PHASE.buysClosed;
    f.state.machine.end_ts = 1n;
    f.state.machine.stock_sold_hour = U64_MAX;
    f.state.machine.buckets[0]!.enabled = 0;
    expect(f.run().ok).toBe(true);
    f.state.machine.phase = PHASE.onAir;
    expect(f.run()).toEqual({ ok: false, error: "MathOverflow" });
  });
  it("keeps reserved book", () => {
    const f = fixture(true);
    f.state.machine.buckets[0]!.reserved = f.state.machine.buckets[0]!.cost;
    expect(f.run()).toEqual({ ok: false, error: "ReservedCapacity" });
  });
});

interface PythCapture {
  feedId: string;
  address: string;
  shard: number;
  response: {
    result: {
      context: { slot: number };
      value: { owner: string; data: [string, "base64"]; space: number };
    };
  };
}
function capturedPyth(name: string): ExecAccountReading {
  const capture = JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/mainnet/pyth/${name}-usd.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as PythCapture;
  const account = capture.response.result.value;
  const raw = Buffer.from(account.data[0], account.data[1]);
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(capture.shard);
  const canonical = PublicKey.findProgramAddressSync(
    [shard, Buffer.from(capture.feedId, "hex")],
    EXTERNAL_IDS.pythPushOracle,
  )[0];
  expect(capture.shard).toBe(0);
  expect(capture.response.result.context.slot).toBeGreaterThan(0);
  expect(canonical.toBase58()).toBe(capture.address);
  expect(account.owner).toBe(EXTERNAL_IDS.pythReceiver.toBase58());
  expect(raw.length).toBe(account.space);
  expect(raw.length).toBe(134);
  expect(raw.subarray(0, 8)).toEqual(
    Buffer.from(PYTH_PRICE_UPDATE_V2_DISCRIMINATOR),
  );
  expect(raw[40]).toBe(1);
  expect(raw.subarray(41, 73).toString("hex")).toBe(capture.feedId);
  return { address: canonical, owner: new PublicKey(account.owner), data: raw };
}
function capturedMajorFixture(symbol: string) {
  const major = HIT_LIST.launchMajors.find((entry) => entry.symbol === symbol)!;
  const f = fixture();
  const token = capturedPyth(symbol.toLowerCase());
  const sol = capturedPyth("sol");
  const now =
    data(token).readBigInt64LE(93) > data(sol).readBigInt64LE(93)
      ? data(token).readBigInt64LE(93)
      : data(sol).readBigInt64LE(93);
  data(f.readings.mint)[44] = major.decimals;
  f.state.machine.end_ts = now + 1_000n;
  f.state.machine.buckets[0]!.oracle = new PublicKey(
    Buffer.from(major.pythFeedId, "hex"),
  );
  f.readings.oracles = [token, sol, empty(), empty()];
  f.args.oracles = [
    token.address,
    sol.address,
    SystemProgram.programId,
    SystemProgram.programId,
  ];
  const run = () => {
    f.readings.execution.instructions = [
      execBeginIx(PROGRAM_ID, f.args),
      execEndIx(PROGRAM_ID, f.args),
    ];
    return checkExecBegin(f.state, f.args, f.readings, now);
  };
  return { ...f, now, run, major };
}
describe("captured mainnet PriceUpdateV2 feeds", () => {
  it.each(HIT_LIST.launchMajors.map((major) => major.symbol))(
    "reads the shard-zero SOL and %s bytes with their captured freshness",
    (symbol) => {
      const f = capturedMajorFixture(symbol);
      const [token, sol] = f.readings.oracles;
      const quote = minOutMajor({
        amount: f.args.amount,
        tokenPrice: data(token).readBigInt64LE(73),
        tokenExponent: data(token).readInt32LE(89),
        solPrice: data(sol).readBigInt64LE(73),
        solExponent: data(sol).readInt32LE(89),
        decimals: f.major.decimals,
      });
      const stale = [token, sol].some(
        (reading) =>
          f.now - data(reading).readBigInt64LE(93) >
          BigInt(STOCK.pythMaxAgeSeconds),
      );
      expect(f.run()).toEqual(
        stale
          ? { ok: false, error: "OracleStale" }
          : { ok: true, minOut: quote.minOut },
      );
    },
  );
  const changes: [
    string,
    (f: ReturnType<typeof capturedMajorFixture>) => void,
    string,
  ][] = [
    [
      "Partial verification",
      (f) => {
        data(f.readings.oracles[0])[40] = 0;
      },
      "OracleInvalid",
    ],
    [
      "stale publication",
      (f) => {
        data(f.readings.oracles[0]).writeBigInt64LE(
          f.now - BigInt(STOCK.pythMaxAgeSeconds) - 1n,
          93,
        );
      },
      "OracleStale",
    ],
    [
      "wide confidence",
      (f) => {
        data(f.readings.oracles[0]).writeBigUInt64LE(
          data(f.readings.oracles[0]).readBigInt64LE(73),
          81,
        );
      },
      "OracleWide",
    ],
    [
      "wrong owner",
      (f) => {
        f.readings.oracles[0].owner = key(99);
      },
      "OracleInvalid",
    ],
    [
      "truncated data",
      (f) => {
        f.readings.oracles[0].data = f.readings.oracles[0].data.subarray(
          0,
          132,
        );
      },
      "OracleInvalid",
    ],
  ];
  it.each(changes)("rejects captured feed with %s", (_, change, error) => {
    const f = capturedMajorFixture("WIF");
    change(f);
    expect(f.run()).toEqual({ ok: false, error });
  });
});

function poolFixture(kind: ExecBeginInput["kind"]) {
  const f = fixture(kind === EXEC_KIND.stockSell);
  f.args.kind = kind;
  const mint = f.args.mint;
  const authority = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_AUTHORITY_SEED), mint.toBuffer()],
    EXTERNAL_IDS.pumpFun,
  )[0];
  const poolAddress = PublicKey.findProgramAddressSync(
    [
      Buffer.from(PUMP_LAYOUTS.poolSeed),
      Buffer.alloc(2),
      authority.toBuffer(),
      mint.toBuffer(),
      NATIVE_MINT.toBuffer(),
    ],
    EXTERNAL_IDS.pumpSwap,
  )[0];
  const base = token(key(41), mint, poolAddress, 500_000_000_000_000n);
  const quote = token(key(42), NATIVE_MINT, poolAddress, 400_000_000_000n);
  const poolBytes = Buffer.alloc(261);
  poolBytes.set(PUMPSWAP_POOL_DISCRIMINATOR);
  mint.toBuffer().copy(poolBytes, 43);
  NATIVE_MINT.toBuffer().copy(poolBytes, 75);
  base.address.toBuffer().copy(poolBytes, 139);
  quote.address.toBuffer().copy(poolBytes, 171);
  poolBytes.writeBigUInt64LE((1n << 64n) - 2_000_000_000n, 245);
  poolBytes.writeBigInt64LE(-1n, 253);
  const pool: ExecAccountReading = {
    address: poolAddress,
    owner: EXTERNAL_IDS.pumpSwap,
    data: poolBytes,
  };
  const bucket = f.state.machine.buckets[0]!;
  bucket.class = 2;
  bucket.oracle = poolAddress;
  bucket.cost = 1_000_000_000n;
  f.readings.oracles = [pool, base, quote, empty()];
  f.args.oracles = f.readings.oracles.map(
    (account) => account.address,
  ) as unknown as ExecBeginInput["oracles"];
  return f;
}
function canonicalMeteoraPool(
  config: PublicKey,
  mint: PublicKey,
  program: PublicKey,
) {
  const pair = [mint.toBuffer(), NATIVE_MINT.toBuffer()].sort(Buffer.compare);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), config.toBuffer(), pair[1]!, pair[0]!],
    program,
  )[0];
}
function meteoraBeginFixture(kind: ExecBeginInput["kind"], migrated = false) {
  const f = fixture();
  const captured = meteoraFixture(migrated);
  const mint = f.args.mint;
  const config = new PublicKey(
    meteoraForCluster(f.state.deployment.cluster).dbcConfig,
  );
  // Inject the captured ABI into a local canonical launch, with explicit reserves.
  const oracles = captured.oracles;
  oracles[0].address = canonicalMeteoraPool(
    config,
    mint,
    EXTERNAL_IDS.meteoraDbc,
  );
  config.toBuffer().copy(data(oracles[0]), 72);
  mint.toBuffer().copy(data(oracles[0]), 136);
  mint.toBuffer().copy(data(oracles[2]), 0);
  if (migrated) {
    oracles[1].address = canonicalMeteoraPool(
      new PublicKey(METEORA.dammV2Config),
      mint,
      EXTERNAL_IDS.meteoraDammV2,
    );
    mint.toBuffer().copy(data(oracles[1]), 168);
  }
  data(oracles[migrated ? 1 : 0]).writeBigUInt64LE(
    30_000_000_000n,
    migrated ? 688 : 240,
  );
  data(oracles[3]).writeBigUInt64LE(200_000_000_000n, 64);
  f.args.kind = kind;
  f.args.bucket = BUCKET_NONE;
  f.args.amount = 50_000_000n;
  f.state.config.executor = f.args.signer;
  f.state.config.token_mint = mint;
  f.state.machine.burn_sol = 5_000_000_000n;
  f.state.machine.jackpot_sol = 5_000_000_000n;
  f.readings.oracles = [...oracles];
  f.args.oracles = oracles.map(
    (account) => account.address,
  ) as unknown as ExecBeginInput["oracles"];
  return f;
}
describe("reserve oracle begin checks", () => {
  it.each([EXEC_KIND.stockBuy, EXEC_KIND.stockSell])(
    "accepts canonical TRENDING PumpSwap pool for kind %s",
    (kind) => {
      const f = poolFixture(kind);
      expect(f.run().ok).toBe(true);
      data(f.readings.oracles[0])[243] = 1;
      expect(f.run()).toEqual({ ok: false, error: "OracleInvalid" });
    },
  );
  it.each([
    [EXEC_KIND.burn, false, 979_993_033_616n],
    [EXEC_KIND.jackpotBuy, false, 984_967_617_543n],
    [EXEC_KIND.burn, true, 1_031_373_734_717n],
    [EXEC_KIND.jackpotBuy, true, 1_036_609_134_385n],
  ] as const)(
    "pins Meteora begin kind=%s migrated=%s",
    (kind, migrated, minOut) => {
      const f = meteoraBeginFixture(kind, migrated);
      expect(f.run()).toEqual({ ok: true, minOut });
      if (migrated) {
        data(f.readings.oracles[0]).fill(0, 280, 296);
        data(f.readings.oracles[0]).writeBigUInt64LE(0n, 240);
        expect(f.run()).toEqual({ ok: true, minOut });
      }
    },
  );
  it.each([
    [EXEC_KIND.burn, false, 75_000_000n],
    [EXEC_KIND.jackpotBuy, false, 300_000_000n],
    [EXEC_KIND.burn, true, 75_000_000n],
    [EXEC_KIND.jackpotBuy, true, 300_000_000n],
  ] as const)(
    "caps kind=%s migrated=%s by recorded reserves, excluding donations",
    (kind, migrated, limit) => {
      const f = meteoraBeginFixture(kind, migrated);
      f.args.amount = limit;
      const accepted = f.run();
      expect(accepted.ok).toBe(true);
      data(f.readings.oracles[3]).writeBigUInt64LE(900_000_000_000n, 64);
      expect(f.run()).toEqual(accepted);
      f.args.amount += 1n;
      expect(f.run()).toEqual({ ok: false, error: "TrancheTooLarge" });
      data(f.readings.oracles[migrated ? 1 : 0]).writeBigUInt64LE(
        30_000_001_000n,
        migrated ? 688 : 240,
      );
      expect(f.run().ok).toBe(true);
    },
  );
  it.each([false, true])(
    "refuses a non-canonical Meteora reference, migrated=%s",
    (migrated) => {
      const f = meteoraBeginFixture(EXEC_KIND.burn, migrated);
      const poolIndex = migrated ? 1 : 0;
      f.readings.oracles[poolIndex].address = key(43);
      f.args.oracles = f.readings.oracles.map(
        (account) => account.address,
      ) as unknown as ExecBeginInput["oracles"];
      expect(f.run()).toEqual({ ok: false, error: "AccountMismatch" });
    },
  );
  it("selects an explicit deployment pin and refuses the pending mainnet pin", () => {
    const f = meteoraBeginFixture(EXEC_KIND.burn);
    f.state.deployment = createDeploymentSelector({ devnet: PROGRAM_ID })(
      "devnet",
    );
    expect(f.run().ok).toBe(true);
    f.state.deployment = createDeploymentSelector({ mainnet: PROGRAM_ID })(
      "mainnet",
    );
    if (METEORA_BY_CLUSTER.mainnet.dbcConfig === "PENDING")
      expect(f.run).toThrow("METEORA_DBC_CONFIG is PENDING for mainnet");
    else expect(f.run().ok).toBe(false); // The fixture pool remains bound to the devnet config.
  });
  it("allows any Burn caller in Done despite disabled roles and pauses while preserving limits", () => {
    const f = meteoraBeginFixture(EXEC_KIND.burn);
    const expected = f.run();
    f.state.machine.phase = PHASE.done;
    f.state.config.executor = key(66);
    f.state.config.disabled_roles = 0xff;
    f.state.config.admin_paused = 0xff;
    f.state.config.guardian_paused = 0xff;
    expect(f.run()).toEqual(expected);
    f.state.machine.last_burn_ts = f.now;
    expect(f.run()).toEqual({ ok: false, error: "TooSoon" });
    f.state.machine.last_burn_ts = 0n;
    f.state.machine.burn_hour_index = 2n;
    f.state.machine.burn_paid_hour = BURN.hourlyMaxLamports;
    expect(f.run()).toEqual({ ok: false, error: "HourlyCapReached" });
    f.state.machine.burn_paid_hour = 0n;
    f.args.amount = BURN.trancheMaxLamports + 1n;
    expect(f.run()).toEqual({ ok: false, error: "TrancheTooLarge" });
    f.args.amount = 50_000_000n;
    f.state.machine.phase = PHASE.finalPull;
    expect(f.run()).toEqual({ ok: false, error: "Unauthorized" });
    f.state.machine.phase = PHASE.done;
    f.args.kind = EXEC_KIND.jackpotBuy;
    expect(f.run()).toEqual({ ok: false, error: "Unauthorized" });
  });
  it("allows an empty canonical closed ledger only for Done Burn", () => {
    const f = meteoraBeginFixture(EXEC_KIND.burn);
    f.state.machine.phase = PHASE.done;
    f.readings.ledger.owner = SystemProgram.programId;
    f.readings.ledger.data = Buffer.alloc(0);
    expect(f.run().ok).toBe(true);
    f.state.machine.final_pool_1pct = 1n;
    expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
    f.state.machine.final_pool_1pct = 0n;
    f.state.machine.jackpot_tokens = 1n;
    expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
    f.state.machine.jackpot_tokens = 0n;
    f.state.machine.onepct[0]!.amount = 1n;
    expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
    f.state.machine.onepct[0]!.amount = 0n;
    f.readings.ledger.executable = true;
    expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
    f.readings.ledger.executable = false;
    f.readings.ledger.data = Buffer.alloc(1);
    expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
    f.readings.ledger.data = Buffer.alloc(0);
    f.readings.ledger.address = key(67);
    expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
    f.readings.ledger.address = ledgerPda(PROGRAM_ID, f.args.mint)[0];
    f.state.machine.phase = PHASE.finalPull;
    expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
  });
  it("preflights a closed vault only with exact immediate Done Burn restoration", () => {
    const f = meteoraBeginFixture(EXEC_KIND.burn);
    const expected = f.run();
    f.state.machine.phase = PHASE.done;
    f.readings.vault.owner = SystemProgram.programId;
    f.readings.vault.data = Buffer.alloc(0);
    f.readings.ledger.owner = SystemProgram.programId;
    f.readings.ledger.data = Buffer.alloc(0);
    expect(f.run()).toEqual({ ok: false, error: "VaultMismatch" });
    const restore = createAssociatedTokenAccountIdempotentInstruction(
      f.args.signer,
      f.readings.vault.address,
      vaultAuthPda(PROGRAM_ID)[0],
      f.args.mint,
      f.args.tokenProgram,
    );
    const begin = execBeginIx(PROGRAM_ID, f.args);
    const end = execEndIx(PROGRAM_ID, f.args);
    const check = (
      instructions: TransactionInstruction[] = [restore, begin, end],
      currentIndex = 1,
    ) => {
      f.readings.execution.instructions = instructions;
      f.readings.execution.currentIndex = currentIndex;
      return checkExecBegin(f.state, f.args, f.readings, f.now);
    };
    expect(check()).toEqual(expected);
    f.readings.vault.executable = true;
    expect(check()).toEqual({ ok: false, error: "VaultMismatch" });
    f.readings.vault.executable = false;
    f.readings.vault.data = Buffer.alloc(1);
    expect(check()).toEqual({ ok: false, error: "VaultMismatch" });
    f.readings.vault.data = Buffer.alloc(0);
    f.readings.vault.address = key(88);
    expect(check()).toEqual({ ok: false, error: "VaultMismatch" });
    f.readings.vault.address = vaultAta(
      PROGRAM_ID,
      f.args.mint,
      f.args.tokenProgram,
    );
    expect(check([begin, restore, end], 0)).toEqual({
      ok: false,
      error: "VaultMismatch",
    });
    for (const altered of [
      new TransactionInstruction({ ...restore, data: Buffer.from([0]) }),
      new TransactionInstruction({
        ...restore,
        programId: SystemProgram.programId,
      }),
      new TransactionInstruction({
        ...restore,
        keys: restore.keys.map((meta, index) =>
          index === 2 ? { ...meta, pubkey: key(89) } : meta,
        ),
      }),
      new TransactionInstruction({
        ...restore,
        keys: restore.keys.map((meta, index) =>
          index === 0 ? { ...meta, isSigner: false } : meta,
        ),
      }),
    ])
      expect(check([altered, begin, end])).toEqual({
        ok: false,
        error: "VaultMismatch",
      });
    f.state.machine.phase = PHASE.finalPull;
    expect(check()).toEqual({ ok: false, error: "VaultMismatch" });
    f.state.machine.phase = PHASE.done;
    f.state.machine.burn_hour_index = 2n;
    f.state.machine.burn_paid_hour = BURN.hourlyMaxLamports;
    expect(check()).toEqual({ ok: false, error: "HourlyCapReached" });
  });
  it("rejects nonpositive signed quote reserves and wrong pool token authority", () => {
    const f = poolFixture(EXEC_KIND.stockBuy);
    data(f.readings.oracles[0]).writeBigUInt64LE(
      (1n << 64n) - 400_000_000_000n,
      245,
    );
    expect(f.run()).toEqual({ ok: false, error: "OracleInvalid" });
    const g = poolFixture(EXEC_KIND.stockBuy);
    key(43).toBuffer().copy(data(g.readings.oracles[1]), 32);
    expect(g.run()).toEqual({ ok: false, error: "OracleInvalid" });
  });
  it("refuses a TRENDING pool with valid fields at a non-canonical address", () => {
    const f = poolFixture(EXEC_KIND.stockBuy);
    const substituted = key(43);
    f.readings.oracles[0].address = substituted;
    f.state.machine.buckets[0]!.oracle = substituted;
    f.args.oracles = [
      substituted,
      ...f.args.oracles.slice(1),
    ] as unknown as ExecBeginInput["oracles"];
    for (const reserve of [f.readings.oracles[1], f.readings.oracles[2]])
      substituted.toBuffer().copy(data(reserve), 32);
    expect(f.run()).toEqual({ ok: false, error: "OracleInvalid" });
  });
  it("checks per-mint caps, TRENDING share, Burn spacing and budget", () => {
    const f = poolFixture(EXEC_KIND.stockBuy);
    f.state.machine.buckets[0]!.trend_hour_index = 2;
    f.state.machine.buckets[0]!.trend_bought_hour =
      STOCK.trendingHourlyMaxLamports;
    expect(f.run()).toEqual({ ok: false, error: "HourlyCapReached" });
    f.state.machine.buckets[0]!.trend_bought_hour = 0n;
    f.state.machine.stock_sol = f.args.amount;
    expect(f.run()).toEqual({ ok: false, error: "TrendingShareExceeded" });
    const g = meteoraBeginFixture(EXEC_KIND.burn);
    g.state.machine.last_burn_ts = g.now;
    expect(g.run()).toEqual({ ok: false, error: "TooSoon" });
    g.state.machine.last_burn_ts = 0n;
    g.state.machine.burn_hour_index = 2n;
    g.state.machine.burn_paid_hour = BURN.hourlyMaxLamports;
    expect(g.run()).toEqual({ ok: false, error: "HourlyCapReached" });
  });
  it("binds current transaction metas to its readings", () => {
    const f = fixture();
    f.readings.execution.instructions[0]!.keys[3]!.pubkey = key(99);
    expect(checkExecBegin(f.state, f.args, f.readings, f.now)).toEqual({
      ok: false,
      error: "AccountMismatch",
    });
  });
});

function composition(
  kind = EXEC_KIND.stockBuy as ExecBeginInput["kind"],
  deployment: ClusterDeployment = DEPLOYMENT,
): ComposeExecInput {
  const programId = deployment.programId;
  const f = fixture(kind === EXEC_KIND.stockSell, deployment);
  f.args.kind = kind;
  if (kind > EXEC_KIND.stockSell) f.args.bucket = BUCKET_NONE;
  const beginIx = execBeginIx(programId, f.args),
    endIx = execEndIx(programId, f.args);
  const protocolLut = new AddressLookupTableAccount({
    key: key(90),
    state: {
      deactivationSlot: U64_MAX,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [
        configPda(programId)[0],
        machinePda(programId)[0],
        vaultAuthPda(programId)[0],
        ...beginIx.keys.map((meta) => meta.pubkey),
      ].filter(
        (address, index, list) =>
          list.findIndex((a) => a.equals(address)) === index,
      ),
    },
  });
  return {
    deployment: f.state.deployment,
    payer: f.args.signer,
    beginIx,
    endIx,
    swap: {
      setup: [],
      swap: new TransactionInstruction({
        programId: EXTERNAL_IDS.splToken,
        keys: [],
        data: Buffer.from([17]),
      }),
      cleanup: [],
      lookupTables: [],
    },
    computeBudget: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ],
    extraIxs: [],
    protocolLut,
    blockhash: key(91).toBase58(),
  };
}
describe("composeExecTransaction", () => {
  it.each([
    EXEC_KIND.stockBuy,
    EXEC_KIND.stockSell,
    EXEC_KIND.burn,
    EXEC_KIND.jackpotBuy,
  ])("creates ATAs then an atomic v0 pair for kind %s", (kind) => {
    const input = composition(kind),
      built = composeExecTransaction(input);
    expect(built.transaction.version).toBe(0);
    expect(built.serializedSize).toBe(serializedSize(built.transaction));
    expect(built.serializedSize).toBe(built.transaction.serialize().length);
    expect(built.serializedSize).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
    const ixs = TransactionMessage.decompile(built.transaction.message, {
      addressLookupTableAccounts: [input.protocolLut],
    }).instructions;
    expect(ixs.filter((ix) => ix.programId.equals(PROGRAM_ID))).toHaveLength(2);
    const begin = ixs.findIndex((ix) => ix.programId.equals(PROGRAM_ID));
    expect(
      ixs
        .slice(1, begin)
        .every((ix) => ix.programId.equals(EXTERNAL_IDS.associatedToken)),
    ).toBe(true);
    expect(begin).toBe(kind === EXEC_KIND.stockSell ? 3 : 2);
    expect(ixs.at(-1)!.data.equals(input.endIx.data)).toBe(true);
  });
  it("restores a closed canonical vault only when a Burn caller opts in", () => {
    const input = composition(EXEC_KIND.burn);
    const normal = composeExecTransaction(input);
    const restored = composeExecTransaction({
      ...input,
      restoreTokenVault: true,
    });
    const ixs = TransactionMessage.decompile(restored.transaction.message, {
      addressLookupTableAccounts: [input.protocolLut],
    }).instructions;
    const begin = ixs.findIndex((ix) => ix.programId.equals(PROGRAM_ID));
    expect(begin).toBe(3);
    const ata = ixs[begin - 1]!;
    expect(ata.programId).toEqual(EXTERNAL_IDS.associatedToken);
    expect(ata.data).toEqual(Buffer.from([1]));
    expect(ata.keys[0]!.pubkey).toEqual(input.payer);
    expect(ata.keys[1]!.pubkey).toEqual(input.beginIx.keys[5]!.pubkey);
    expect(ata.keys[2]!.pubkey).toEqual(vaultAuthPda(PROGRAM_ID)[0]);
    expect(ata.keys[3]!.pubkey).toEqual(input.beginIx.keys[3]!.pubkey);
    expect(restored.serializedSize).toBeGreaterThan(normal.serializedSize);
    expect(ixs.at(-1)!.data).toEqual(input.endIx.data);
    for (const kind of [
      EXEC_KIND.stockBuy,
      EXEC_KIND.stockSell,
      EXEC_KIND.jackpotBuy,
    ])
      expect(() =>
        composeExecTransaction({
          ...composition(kind),
          restoreTokenVault: true,
        }),
      ).toThrow("Token vault restoration requires Burn");
  });
  it("adds the measured restoration budget once without changing the caller's limit or price", () => {
    const input = composition(EXEC_KIND.burn);
    const baseline = CU_LIMITS.execBegin + CU_LIMITS.execEnd;
    input.computeBudget = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: baseline }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 12_345 }),
    ];
    for (const restoreTokenVault of [false, true, true]) {
      const built = composeExecTransaction({ ...input, restoreTokenVault });
      const ixs = TransactionMessage.decompile(built.transaction.message, {
        addressLookupTableAccounts: [input.protocolLut],
      }).instructions;
      expect(ixs[0]!.data.readUInt32LE(1)).toBe(
        baseline + (restoreTokenVault ? CU_LIMITS.restoreBurnVault : 0),
      );
      expect(ixs[1]!.data).toEqual(input.computeBudget[1]!.data);
      expect(input.computeBudget[0]!.data.readUInt32LE(1)).toBe(baseline);
    }
  });
  it.each([1_400_000, 1_390_000])(
    "caps the restoration budget at the runtime maximum for a %s CU route",
    (units) => {
      const input = composition(EXEC_KIND.burn);
      input.computeBudget = [
        ComputeBudgetProgram.setComputeUnitLimit({ units }),
      ];
      const built = composeExecTransaction({
        ...input,
        restoreTokenVault: true,
      });
      const ixs = TransactionMessage.decompile(built.transaction.message, {
        addressLookupTableAccounts: [input.protocolLut],
      }).instructions;
      expect(ixs[0]!.data.readUInt32LE(1)).toBe(1_400_000);
    },
  );
  it("rejects missing, malformed or duplicate restoration compute limits", () => {
    const input = composition(EXEC_KIND.burn);
    const limit = input.computeBudget[0]!;
    for (const computeBudget of [
      [],
      [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })],
    ])
      expect(() =>
        composeExecTransaction({
          ...input,
          computeBudget,
          restoreTokenVault: true,
        }),
      ).toThrow("Token vault restoration requires a compute unit limit");
    for (const computeBudget of [
      [limit, limit],
      [new TransactionInstruction({ ...limit, data: Buffer.from([2, 1]) })],
    ])
      expect(() =>
        composeExecTransaction({
          ...input,
          computeBudget,
          restoreTokenVault: true,
        }),
      ).toThrow("Invalid exec compute budget");
  });
  it("preserves a full route with a second LUT at the exact packet boundary", () => {
    const input = composition();
    const routeKeys = Array.from({ length: 24 }, (_, index) =>
      key(100 + index),
    );
    const routeLut = new AddressLookupTableAccount({
      key: key(92),
      state: { ...input.protocolLut.state, addresses: routeKeys },
    });
    const routeProgram = key(200);
    const route = (marker: number, addresses: PublicKey[]) =>
      new TransactionInstruction({
        programId: routeProgram,
        keys: addresses.map((pubkey, index) => ({
          pubkey,
          isSigner: false,
          isWritable: index % 2 === 0,
        })),
        data: Buffer.from([marker]),
      });
    const extra = route(1, []);
    const setup = route(2, routeKeys.slice(0, 2));
    const first = route(3, routeKeys.slice(0, 12));
    const second = route(4, routeKeys.slice(12));
    const cleanup = route(5, routeKeys.slice(-2));
    input.computeBudget = [
      ...input.computeBudget,
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ];
    input.extraIxs = [extra];
    input.swap = {
      setup: [setup],
      swap: [first, second],
      cleanup: [cleanup],
      lookupTables: [routeLut],
    };
    const baseline = composeExecTransaction(input);
    const padding = TX_LIMITS.maxTxBytes - baseline.serializedSize;
    expect(padding).toBeGreaterThanOrEqual(128);
    // Replacing one data byte with >=128 bytes adds one short-vector length byte.
    cleanup.data = Buffer.alloc(padding);
    cleanup.data[0] = 5;
    const built = composeExecTransaction(input);
    expect(built.serializedSize).toBe(TX_LIMITS.maxTxBytes);
    expect(built.transaction.serialize().length).toBe(TX_LIMITS.maxTxBytes);
    expect(
      built.transaction.message.addressTableLookups.map((table) =>
        table.accountKey.toBase58(),
      ),
    ).toEqual([input.protocolLut.key.toBase58(), routeLut.key.toBase58()]);
    const ixs = TransactionMessage.decompile(built.transaction.message, {
      addressLookupTableAccounts: [input.protocolLut, routeLut],
    }).instructions;
    expect(ixs.map((ix) => ix.programId.toBase58())).toEqual(
      [
        ComputeBudgetProgram.programId,
        ComputeBudgetProgram.programId,
        routeProgram,
        EXTERNAL_IDS.associatedToken,
        input.deployment.programId,
        routeProgram,
        routeProgram,
        routeProgram,
        routeProgram,
        input.deployment.programId,
      ].map((program) => program.toBase58()),
    );
    for (const [index, expected] of [
      [2, extra],
      [4, input.beginIx],
      [5, setup],
      [6, first],
      [7, second],
      [8, cleanup],
      [9, input.endIx],
    ] as const) {
      expect(ixs[index]!.data).toEqual(expected.data);
      expect(ixs[index]!.keys.map((meta) => meta.pubkey.toBase58())).toEqual(
        expected.keys.map((meta) => meta.pubkey.toBase58()),
      );
    }
    cleanup.data = Buffer.concat([cleanup.data, Buffer.from([0])]);
    expect(() => composeExecTransaction(input)).toThrow("byte budget");
  });
  it("keeps sol_dest read-only in the IDL and writable only for StockSell", () => {
    for (const name of ["exec_begin", "exec_end"]) {
      const definition = IDL.instructions.find((ix) => ix.name === name)!;
      const sol = definition.accounts.find((a) => a.name === "sol_dest")!;
      expect("writable" in sol && sol.writable).toBeFalsy();
    }
    for (const kind of [
      EXEC_KIND.stockBuy,
      EXEC_KIND.stockSell,
      EXEC_KIND.burn,
      EXEC_KIND.jackpotBuy,
    ]) {
      const { beginIx, endIx } = composition(kind);
      expect(beginIx.keys[8]!.isWritable).toBe(kind === EXEC_KIND.stockSell);
      expect(endIx.keys[7]!.isWritable).toBe(kind === EXEC_KIND.stockSell);
    }
  });
  it("rejects a program instruction in every external slot", () => {
    for (const slot of ["extra", "setup", "swap", "cleanup"] as const) {
      const input = composition();
      if (slot === "extra") input.extraIxs = [input.beginIx];
      else input.swap[slot] = [input.beginIx];
      expect(() => composeExecTransaction(input)).toThrow("ExecPairing");
    }
  });
  it.each(["beginIx", "endIx"] as const)(
    "rejects readonly StockSell sol_dest in %s",
    (name) => {
      const input = composition(EXEC_KIND.stockSell);
      input[name].keys[name === "beginIx" ? 8 : 7]!.isWritable = false;
      expect(() => composeExecTransaction(input)).toThrow(
        "Invalid sol_dest writability",
      );
    },
  );
  it("rejects conflicting contents for a duplicated lookup table key", () => {
    const input = composition();
    input.swap.lookupTables = [
      new AddressLookupTableAccount({
        key: input.protocolLut.key,
        state: {
          ...input.protocolLut.state,
          addresses: [key(99), ...input.protocolLut.state.addresses.slice(1)],
        },
      }),
    ];
    expect(() => composeExecTransaction(input)).toThrow(
      "Conflicting lookup table contents",
    );
  });
  it("rejects mismatched kind/bindings/flags, mutable protocol LUT and duplicate budgets", () => {
    const changes: ((input: ComposeExecInput) => void)[] = [
      (i) => {
        i.endIx.data[8] = EXEC_KIND.burn;
      },
      (i) => {
        i.endIx.keys[3]!.pubkey = key(10);
      },
      (i) => {
        i.beginIx.keys[8]!.isWritable = true;
      },
      (i) => {
        i.protocolLut.state.authority = key(10);
      },
      (i) => {
        i.computeBudget = [...i.computeBudget, ...i.computeBudget];
      },
    ];
    for (const change of changes) {
      const input = composition();
      change(input);
      expect(() => composeExecTransaction(input)).toThrow();
    }
  });
  it("rejects a message over the packet bound", () => {
    const input = composition();
    input.swap.cleanup = [
      new TransactionInstruction({
        programId: EXTERNAL_IDS.splToken,
        keys: [],
        data: Buffer.alloc(TX_LIMITS.maxTxBytes),
      }),
    ];
    expect(() => composeExecTransaction(input)).toThrow("byte budget");
  });
});

describe("exec deployment isolation", () => {
  const select = createDeploymentSelector({
    localnet: key(101),
    devnet: key(102),
    mainnet: key(103),
  });
  it.each(["localnet", "devnet", "mainnet"] as const)(
    "binds preflight, the pair and the wSOL destination to %s",
    (cluster) => {
      const deployment = select(cluster),
        programId = deployment.programId;
      const f = fixture(true, deployment);
      expect(f.run().ok).toBe(true);
      f.readings.ledger.owner = PROGRAM_ID;
      expect(f.run()).toEqual({ ok: false, error: "LedgerMismatch" });
      f.readings.ledger.owner = programId;
      f.readings.vault.address = vaultAta(
        PROGRAM_ID,
        f.args.mint,
        f.args.tokenProgram,
      );
      expect(f.run()).toEqual({ ok: false, error: "VaultMismatch" });
      const input = composition(EXEC_KIND.stockSell, deployment);
      const result = composeExecTransaction(input);
      const ixs = TransactionMessage.decompile(result.transaction.message, {
        addressLookupTableAccounts: [input.protocolLut],
      }).instructions;
      const destination = vaultAta(
        programId,
        NATIVE_MINT,
        EXTERNAL_IDS.splToken,
      );
      expect(ixs[2]!.keys[1]!.pubkey.equals(destination)).toBe(true);
      expect(ixs[2]!.keys[2]!.pubkey.equals(vaultAuthPda(programId)[0])).toBe(
        true,
      );
      expect(input.beginIx.keys[8]!.pubkey.equals(destination)).toBe(true);
      expect(input.endIx.keys[7]!.pubkey.equals(destination)).toBe(true);
      expect(ixs.filter((ix) => ix.programId.equals(programId))).toHaveLength(
        2,
      );
      const wrong = select(cluster === "localnet" ? "devnet" : "localnet");
      expect(() =>
        composeExecTransaction({ ...input, deployment: wrong }),
      ).toThrow("ExecPairing");
      input.endIx = execEndIx(wrong.programId, f.args);
      expect(() => composeExecTransaction(input)).toThrow("ExecPairing");
      const ownCpi = composition(EXEC_KIND.stockSell, deployment);
      ownCpi.swap.swap = new TransactionInstruction({
        programId,
        keys: [],
        data: Buffer.alloc(0),
      });
      expect(() => composeExecTransaction(ownCpi)).toThrow("ExecPairing");
    },
  );
});
