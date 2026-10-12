import { readFileSync } from "node:fs";
import { PublicKey, Keypair } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { describe, expect, it } from "vitest";
import {
  DBC_IDL,
  DAMM_V2_IDL,
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DAMM_V2_CUSTOM_CONFIG,
  buildDbcLaunchConfig,
  deriveDbcCurve,
  quoteDbcExactOut,
  dbcFeeSplit,
  integerSqrt,
  decodeDbcConfig,
  decodeDbcPool,
  dbcConfigMismatches,
  encodeDbcConfigFixture,
  encodeDbcPoolFixture,
  createDbcConfigIx,
  initializeDbcPoolIx,
  dbcSwap2Ix,
  dbcPartialFillIx,
  migrateDbcDammV2Ix,
  dbcClaimTradingFeeIx,
  dbcPartnerWithdrawSurplusIx,
  dammV2ClaimPositionFeeIx,
  dbcPool,
  dbcPoolAuthority,
  dammV2PoolAuthority,
  DBC_INSTRUCTION_CODER,
  decodeDammV2Config,
  decodeDammV2Pool,
  decodeDammV2Position,
  quoteDammV2ExactOut,
  quoteMeteoraSell,
  dbcQuoteDelta,
  dammV2Swap2Ix,
} from "./index.js";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/meteora/${name}`, import.meta.url),
      "utf8",
    ),
  );
function withoutUpstreamDocs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUpstreamDocs);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "docs")
        .map(([key, entry]) => [key, withoutUpstreamDocs(entry)]),
    );
  return value;
}
const capture = fixture("mainnet-launch-simulation.json");
const key = (n: number) =>
  Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
const feeIn = new PublicKey(capture.addresses.feeIn);
const config = new PublicKey(capture.addresses.config);
const mint = new PublicKey(capture.addresses.mint);
const payer = key(9);
const encoded = (index: number) =>
  Buffer.from(capture.accounts[index].data[0], "base64");

describe("Meteora pinned mainnet evidence", () => {
  it("decodes the mainnet customizable DAMM config reserved for DBC", () => {
    const captured = fixture("accounts/damm-customizable.json");
    expect(captured.account.owner).toBe(DAMM_V2_PROGRAM_ID.toBase58());
    const config = decodeDammV2Config(
      Buffer.from(captured.account.data[0], "base64"),
    );
    expect(config.configType).toBe(1);
    expect(config.poolCreatorAuthority).toEqual(dbcPoolAuthority());
    expect(config.permission).toBe(1n);
    expect(config.index).toBe(20006n);
  });
  it("retains the successful unsigned instruction byte vectors", () => {
    const wallet = new PublicKey(capture.addresses.payer);
    const create = createDbcConfigIx({ config, payer: wallet, feeIn });
    const init = initializeDbcPoolIx({
      config,
      mint,
      payer: wallet,
      name: "T",
      symbol: "T",
      uri: "https://x.co",
    });
    const buy = dbcSwap2Ix({
      config,
      mint,
      user: wallet,
      amountOut: 40_000_000_000_000n,
      maxQuoteIn: 1_192_328_122n,
    });
    for (const [actual, index] of [
      [create, 0],
      [init, 1],
      [buy, capture.instructions.length - 1],
    ] as const) {
      expect(actual.data.toString("hex")).toBe(
        capture.instructions[index].dataHex,
      );
      expect(
        actual.keys.map((k) => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
      ).toEqual(capture.instructions[index].keys);
    }
  });

  it("derives the SDK IDLs from the canonical fixtures by removing only docs", () => {
    expect(DBC_IDL).toEqual(withoutUpstreamDocs(fixture("dbc.json")));
    expect(DAMM_V2_IDL).toEqual(withoutUpstreamDocs(fixture("damm-v2.json")));
  });
  it("decodes the unsigned config and verifies every D29 field", () => {
    expect(capture.err).toBeNull();
    expect(capture.kind).toBe("unsigned-mainnet-simulation");
    expect(dbcConfigMismatches(decodeDbcConfig(encoded(0)), feeIn)).toEqual([]);
  });
  it("matches live reserves, partner/protocol fee rounding and exact token output", () => {
    const pool = decodeDbcPool(encoded(1)),
      quote = quoteDbcExactOut(buildDbcLaunchConfig(), 40_000_000_000_000n);
    expect(pool.config).toEqual(config);
    expect(pool.baseMint).toEqual(mint);
    expect(dbcPool(config, mint).toBase58()).toBe(capture.addresses.pool);
    expect(pool.quoteReserve).toBe(quote.excludedFeeInput);
    expect(pool.sqrtPrice).toBe(quote.nextSqrtPrice);
    expect(pool.partnerQuoteFee).toBe(quote.partnerFee);
    expect(pool.protocolQuoteFee).toBe(quote.protocolFee);
    expect(pool.creatorQuoteFee).toBe(0n);
    expect(pool.partnerBaseFee).toBe(0n);
    expect(encoded(3).readBigUInt64LE(64)).toBe(quote.amountOut);
    expect(pool.baseReserve + quote.amountOut).toBe(1_000_000_000_000_000n);
    expect(quote.quoteIn).toBe(1_192_328_122n);
  });
  it("captures an immutable legacy SPL mint with the exact supply", () => {
    const data = encoded(2);
    expect(capture.accounts[2].owner).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(data.readUInt32LE(0)).toBe(0);
    expect(data.readUInt32LE(46)).toBe(0);
    expect(data.readBigUInt64LE(36)).toBe(1_000_000_000_000_000n);
    expect(data[44]).toBe(6);
  });
  it("rejects wrong discriminators and truncated accounts", () => {
    expect(() => decodeDbcConfig(encoded(1))).toThrow();
    expect(() => decodeDbcPool(encoded(0))).toThrow();
    expect(() => decodeDbcPool(encoded(1).subarray(0, 100))).toThrow();
  });
});
describe("Meteora config and integer math", () => {
  it("preserves the exact default curve and source arithmetic", () => {
    const actual = JSON.parse(
      JSON.stringify(deriveDbcCurve(), (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
    expect(actual).toEqual(capture.curve);
    expect(integerSqrt((1n << 256n) - 1n)).toBe((1n << 128n) - 1n);
  });
  it("recomputes the curve for a founder-selected threshold", () => {
    const low = deriveDbcCurve(10_000_000_000n),
      high = deriveDbcCurve(170_000_000_000n);
    expect(low.totalSupply).toBe(high.totalSupply);
    expect(low.migrationSqrtPrice).toBeLessThan(high.migrationSqrtPrice);
    expect(
      quoteDbcExactOut(
        buildDbcLaunchConfig(170_000_000_000n),
        40_000_000_000_000n,
      ).quoteIn,
    ).toBeGreaterThan(2_384_000_000n);
    expect(() => deriveDbcCurve(0n)).toThrow();
    expect(() => deriveDbcCurve(1n << 64n)).toThrow();
  });
  it("bounds input with ceiling slippage and rejects impossible amounts", () => {
    const c = buildDbcLaunchConfig(),
      q = quoteDbcExactOut(c, 40_000_000_000_000n, 100);
    expect(q.maxQuoteIn).toBe((q.quoteIn * 101n + 99n) / 100n);
    expect(() => quoteDbcExactOut(c, 0n)).toThrow();
    expect(() => quoteDbcExactOut(c, 1_000_000_000_000_000n)).toThrow();
    expect(() => quoteDbcExactOut(c, 1n, -1)).toThrow();
  });
  it("gives the partner the rounding remainder after protocol fees", () => {
    expect(dbcFeeSplit(1n)).toEqual({
      tradeFee: 1n,
      protocolFee: 0n,
      partnerFee: 1n,
    });
    expect(dbcFeeSplit(5n)).toEqual({
      tradeFee: 5n,
      protocolFee: 1n,
      partnerFee: 4n,
    });
  });
  it("roundtrips synthetic account fixtures without Anchor buffer limits", async () => {
    const changed = decodeDbcConfig(encoded(0));
    changed.poolFees.dynamicFee.binStepU128 = 17n;
    const roundtrip = decodeDbcConfig(
      await encodeDbcConfigFixture(feeIn, 85_000_000_000n, changed),
    );
    expect(roundtrip.poolFees.dynamicFee.binStepU128).toBe(17n);

    const data = await encodeDbcConfigFixture(feeIn);
    expect(data.length).toBe(1048);
    expect(dbcConfigMismatches(decodeDbcConfig(data), feeIn)).toEqual([]);
    const pool = decodeDbcPool(
      await encodeDbcPoolFixture({
        config,
        baseMint: mint,
        partnerQuoteFee: 10n,
      }),
    );
    expect(pool.config).toEqual(config);
    expect(pool.partnerQuoteFee).toBe(10n);
  });
  it.each([
    "creatorTradingFeePercentage",
    "migratedPoolFeeBps",
    "migratedCollectFeeMode",
    "migratedDynamicFee",
    "migratedPoolBaseFeeMode",
    "migratedCompoundingFeeBps",
    "tokenType",
    "tokenUpdateAuthority",
    "partnerPermanentLockedLiquidityPercentage",
    "creatorLiquidityPercentage",
    "migrationFeePercentage",
    "migrationFeeOption",
  ] as const)("rejects changed %s", (field) => {
    const state = decodeDbcConfig(encoded(0));
    state[field]++;
    expect(dbcConfigMismatches(state, feeIn)).toContain(field);
  });
  it("checks nested fee settings, curve liquidity, supply and destination keys", () => {
    const state = decodeDbcConfig(encoded(0));
    state.poolFees.baseFee.secondFactor = 1n;
    state.curve[0]!.liquidity++;
    state.preMigrationTokenSupply++;
    state.feeClaimer = key(30);
    expect(dbcConfigMismatches(state, feeIn)).toEqual(
      expect.arrayContaining([
        "poolFees.baseFee.secondFactor",
        "curve[0].liquidity",
        "preMigrationTokenSupply",
        "feeClaimer",
      ]),
    );
  });
});
describe("Meteora instruction builders", () => {
  it("matches fixed program authorities", () => {
    expect(dbcPoolAuthority().toBase58()).toBe(
      "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM",
    );
    expect(dammV2PoolAuthority().toBase58()).toBe(
      "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
    );
  });
  it("creates a config with both destinations set to FeeIn", () => {
    const ix = createDbcConfigIx({ config, payer, feeIn });
    expect(ix.programId).toEqual(DBC_PROGRAM_ID);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[1]?.pubkey).toEqual(feeIn);
    expect(ix.keys[2]?.pubkey).toEqual(feeIn);
    expect(DBC_INSTRUCTION_CODER.decode(ix.data)?.name).toBe("create_config");
  });
  it("initializes a SPL mint with payer and vanity-mint signatures", () => {
    const ix = initializeDbcPoolIx({
      config,
      mint,
      payer,
      name: "Onepercent",
      symbol: "1PCT",
      uri: "https://onepercent.fun/metadata",
    });
    expect(
      ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()),
    ).toEqual([payer, mint, payer].map((k) => k.toBase58()));
    expect(ix.keys[11]?.pubkey).toEqual(TOKEN_PROGRAM_ID);
    expect(ix.keys[12]?.pubkey).toEqual(TOKEN_PROGRAM_ID);
    expect(() =>
      initializeDbcPoolIx({
        config,
        mint,
        payer,
        name: "Onepercent",
        symbol: "12345678901",
        uri: "https://x.co",
      }),
    ).toThrow();
  });
  it("encodes exact output in amount_0 and maximum quote in amount_1", () => {
    const damm = dammV2Swap2Ix({
      mint,
      user: payer,
      amountOut: 40n,
      maxQuoteIn: 80n,
    });
    expect(damm.data.readBigUInt64LE(8)).toBe(40n);
    expect(damm.data.readBigUInt64LE(16)).toBe(80n);
    expect(damm.data[24]).toBe(2);

    const ix = dbcSwap2Ix({
      config,
      mint,
      user: payer,
      amountOut: 40n,
      maxQuoteIn: 80n,
    });
    expect(ix.data.readBigUInt64LE(8)).toBe(40n);
    expect(ix.data.readBigUInt64LE(16)).toBe(80n);
    expect(ix.data[24]).toBe(2);
    expect(
      dbcPartialFillIx({ config, mint, user: payer, amountIn: 50n }).data[24],
    ).toBe(1);
  });
  it("migrates only to the pinned customizable DAMM config", () => {
    const ix = migrateDbcDammV2Ix({
      config,
      mint,
      payer,
      positionNftMint: key(40),
    });
    expect(ix.keys).toHaveLength(26);
    expect(ix.keys[25]?.pubkey).toEqual(DAMM_V2_CUSTOM_CONFIG);
    expect(ix.keys[12]?.pubkey).toEqual(DAMM_V2_PROGRAM_ID);
    expect(
      ix.keys
        .slice(8, 11)
        .every(
          (k) =>
            k.pubkey.equals(DBC_PROGRAM_ID) && !k.isWritable && !k.isSigner,
        ),
    ).toBe(true);
  });
  it("provides explicit permissionless-caller CPI surfaces for the services track", () => {
    const input = {
      config,
      mint,
      feeClaimer: feeIn,
      baseAccount: key(41),
      quoteAccount: key(42),
    };
    expect(
      dbcClaimTradingFeeIx({ ...input, maxBaseAmount: 0n, maxQuoteAmount: 10n })
        .keys[9]?.isSigner,
    ).toBe(true);
    expect(dbcPartnerWithdrawSurplusIx(input).keys[6]?.pubkey).toEqual(feeIn);
    const claim = dammV2ClaimPositionFeeIx({
      mint,
      positionNftMint: key(43),
      owner: feeIn,
      baseAccount: input.baseAccount,
      quoteAccount: input.quoteAccount,
    });
    expect(claim.programId).toEqual(DAMM_V2_PROGRAM_ID);
    expect(claim.keys[8]?.pubkey).toEqual(NATIVE_MINT);
    expect(claim.keys[9]?.isWritable).toBe(false);
  });
});

describe("Meteora deployed-program local migration vectors", () => {
  const local = fixture("validator-launch.json");
  const raw = (name: string) =>
    readFileSync(
      new URL(
        `../../../../fixtures/meteora/accounts/${name}.bin`,
        import.meta.url,
      ),
    );
  it("reproduces the exact one-lamport threshold rounding surplus", () => {
    const c = deriveDbcCurve(),
      q = quoteDbcExactOut(buildDbcLaunchConfig(), 40_000_000_000_000n);
    const reserve =
      q.excludedFeeInput +
      dbcQuoteDelta(
        q.nextSqrtPrice,
        c.migrationSqrtPrice,
        c.curve[0]!.liquidity,
      );
    expect(reserve).toBe(85_000_000_001n);
    expect(reserve.toString()).toBe(local.thresholdBuy.quoteReserve);
  });
  it("decodes the flat 250-bps pool and permanently locked FeeIn position", () => {
    const pool = decodeDammV2Pool(raw("local-damm-pool")),
      position = decodeDammV2Position(raw("local-damm-position"));
    const fee = Buffer.from(pool.poolFees.baseFee.baseFeeInfo.data);
    expect(fee.readBigUInt64LE(0)).toBe(25_000_000n);
    expect(fee[8]).toBe(0);
    expect(pool.collectFeeMode).toBe(1);
    expect(pool.poolFees.dynamicFee.initialized).toBe(0);
    expect(pool.poolFees.compoundingFeeBps).toBe(0);
    expect(position.unlockedLiquidity).toBe(0n);
    expect(position.vestedLiquidity).toBe(0n);
    expect(position.permanentLockedLiquidity).toBe(pool.liquidity);
    expect(pool.permanentLockLiquidity).toBe(pool.liquidity);
    const nft = raw("local-damm-position-nft");
    expect(new PublicKey(nft.subarray(32, 64)).toBase58()).toBe(
      local.config.feeIn,
    );
    expect(nft.readBigUInt64LE(64)).toBe(1n);
    expect(local.powerOn).toBe("real-m4.1-program");
    expect(local.productionDeploymentVerified).toBe(false);
  });
  it("matches the executed migrated-pool exact-output quote and rejects unsupported fee profiles", () => {
    const pool = decodeDammV2Pool(raw("local-damm-pool"));
    const quote = quoteDammV2ExactOut(pool, 1_000_000_000_000n);
    expect(
      JSON.parse(
        JSON.stringify(quote, (_k, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      ),
    ).toEqual(local.dammBuy.quote);
    expect(quote.amountOut.toString()).toBe(local.dammBuy.output);
    expect(quote.protocolFee.toString()).toBe(local.dammBuy.protocolQuoteFee);
    pool.collectFeeMode = 2;
    expect(() => quoteDammV2ExactOut(pool, 1n)).toThrow("Unsupported");
  });
  it("quotes a within-segment sale with quote-side fee rounding", () => {
    const c = deriveDbcCurve(),
      buy = quoteDbcExactOut(buildDbcLaunchConfig(), 40_000_000_000_000n);
    const sale = quoteMeteoraSell({
      sqrtPrice: buy.nextSqrtPrice,
      liquidity: c.curve[0]!.liquidity,
      minSqrtPrice: c.sqrtStartPrice,
      amountIn: 40_000_000_000_000n,
    });
    expect(sale.nextSqrtPrice).toBeGreaterThanOrEqual(c.sqrtStartPrice);
    expect(sale.quoteOut + sale.tradeFee).toBe(sale.grossQuoteOut);
    expect(sale.partnerFee + sale.protocolFee).toBe(sale.tradeFee);
    expect(sale.quoteOut).toBeLessThan(buy.quoteIn);
    expect(() =>
      quoteMeteoraSell({
        sqrtPrice: buy.nextSqrtPrice,
        liquidity: c.curve[0]!.liquidity,
        minSqrtPrice: c.sqrtStartPrice,
        amountIn: 80_000_000_000_000n,
      }),
    ).toThrow("segment");
  });
});
