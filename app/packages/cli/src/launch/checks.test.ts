import { createHash } from "node:crypto";
import {
  ACCOUNT_SIZES,
  PROGRAM_IDS,
  SEASON,
  TOKEN_1PCT,
} from "@onepercent/config";
import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  encodeDbcConfigFixture,
} from "@onepercent/sdk";
import {
  buildLaunchReport,
  checkLaunchPool,
  checkDbcLaunchConfig,
  checkLaunchLookupTable,
  checkLaunchMint,
  checkLaunchPrerequisites,
  checkLaunchProgramVersions,
  checkLaunchSimulation,
  checkLaunchTokenAccount,
  checkRehearsalMint,
  classifyLaunchMintAccount,
  classifyLaunchPoolAccount,
  decodeLaunchConfig,
  decodeLaunchLedger,
  decodeLaunchMachine,
  type AccountSnapshot,
} from "./checks.js";

const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const programId = key(100);
const mint = key(101);
const wallet = key(102);
const dbcConfig = key(103);
const powerOnTs = 1_793_289_600n;
const onAirTs = powerOnTs + BigInt(SEASON.onAirDelaySeconds);
const endTs = onAirTs + BigInt(SEASON.durationSeconds);
const pda = (name: string) =>
  PublicKey.findProgramAddressSync([Buffer.from(name)], programId)[0];
const feeIn = pda("fee_in");
const vaultAuthority = pda("vault_auth");
const dbcConfigBytes = await encodeDbcConfigFixture(feeIn);
const dbcConfigAccount = () =>
  snapshot(Buffer.from(dbcConfigBytes), DBC_PROGRAM_ID);
const putKey = (data: Buffer, offset: number, value: PublicKey) =>
  data.set(value.toBytes(), offset);
const snapshot = (data: Buffer, owner = programId): AccountSnapshot => ({
  owner,
  data,
  lamports: 1n,
  executable: false,
});
const baseAccount = (name: string, length: number) => {
  const data = Buffer.alloc(length);
  data.set(
    createHash("sha256").update(`account:${name}`).digest().subarray(0, 8),
  );
  return data;
};
function configAccount() {
  const data = baseAccount("Config", 872);
  data[736] = 1;
  for (const offset of [8, 40, 72, 104, 136, 168, 200, 264, 296, 584])
    putKey(data, offset, key((offset % 200) + 1));
  putKey(data, 232, wallet);
  putKey(data, 552, mint);
  return snapshot(data);
}
function machineAccount(powered = false) {
  const data = baseAccount("Machine", 3_808);
  data[8] = 1;
  data[10] = powered ? 2 : 1;
  if (powered) {
    data.writeBigInt64LE(powerOnTs, 40);
    data.writeBigInt64LE(onAirTs, 48);
    data.writeBigInt64LE(endTs, 56);
    putKey(data, 2_608, mint);
    for (let index = 0; index < TOKEN_1PCT.onePctCardCount; index++)
      data.writeBigUInt64LE(TOKEN_1PCT.onePctCardAmount, 2_336 + index * 16);
  }
  return snapshot(data);
}
function ledgerAccount() {
  const data = baseAccount("MintLedger", ACCOUNT_SIZES.mintLedger);
  putKey(data, 8, mint);
  putKey(data, 40, wallet);
  data.writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 72);
  return snapshot(data);
}
function mintAccount() {
  const data = Buffer.alloc(82);
  data[44] = TOKEN_1PCT.decimals;
  data[45] = 1;
  data.writeBigUInt64LE(TOKEN_1PCT.totalSupply, 36);
  return snapshot(data, new PublicKey(PROGRAM_IDS.splToken));
}
function poolAccount() {
  const data = baseAccount("VirtualPool", 424);
  putKey(data, 72, dbcConfig);
  putKey(data, 136, mint);
  data.writeBigUInt64LE(123n, 272);
  return snapshot(data, DBC_PROGRAM_ID);
}
function tokenAccount(
  amount: bigint = TOKEN_1PCT.devBuyAmount,
  owner = vaultAuthority,
) {
  const data = Buffer.alloc(165);
  putKey(data, 0, mint);
  putKey(data, 32, owner);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return snapshot(data, new PublicKey(PROGRAM_IDS.splToken));
}
const dataOf = (account: AccountSnapshot) => account.data as Buffer;
function table(
  authority: PublicKey | undefined = undefined,
  addresses = [key(11), key(12)],
) {
  return new AddressLookupTableAccount({
    key: key(10),
    state: {
      addresses,
      authority,
      deactivationSlot: 18_446_744_073_709_551_615n,
      lastExtendedSlot: 100,
      lastExtendedSlotStartIndex: 0,
    },
  });
}
function prerequisites() {
  return {
    programId,
    mint,
    launchWallet: wallet,
    config: configAccount(),
    machine: machineAccount(),
    mintAccount: null,
    poolAccount: null,
    dbcConfigAccount: dbcConfigAccount(),
    expectedDbcConfig: dbcConfig,
    feeIn: {
      owner: SystemProgram.programId,
      data: Buffer.alloc(0),
      lamports: 123n,
    },
    rentMinimumLamports: 123n,
    lookupTable: table(),
    expectedLookupAddresses: [key(11), key(12)],
    currentSlot: 101,
  };
}
function simulation() {
  return {
    err: null,
    mint: mintAccount(),
    pool: poolAccount(),
    dbcConfigAccount: dbcConfigAccount(),
    expectedDbcConfig: dbcConfig,
    vault: tokenAccount(),
    launchTokenAccount: null,
    expectedMint: mint,
    feeIn,
    vaultAuthority,
  };
}
function reportInput() {
  return {
    cluster: "devnet",
    programId,
    observedSlot: 500,
    config: configAccount(),
    machine: machineAccount(true),
    ledger: ledgerAccount(),
    mint: mintAccount(),
    pool: poolAccount(),
    dbcConfigAccount: dbcConfigAccount(),
    expectedDbcConfig: dbcConfig,
    vault: tokenAccount(),
    launchTokenAccounts: [],
    launchLookupTable: key(15),
    protocolLookupTable: key(16),
    landedForm: "single-v0" as const,
    signatures: ["test-signature"],
  };
}
const failures = (checks: { id: string; status: string }[]) =>
  checks.filter((check) => check.status === "NO-GO").map((check) => check.id);

describe("launch account decoding SWITCH vectors", () => {
  it("accepts zero-transfer-fee v1 only on devnet and rejects every new nonzero field", () => {
    const account = dbcConfigAccount();
    account.data[236] = 1;
    expect(() =>
      checkDbcLaunchConfig(account, { feeIn, cluster: "devnet" }),
    ).not.toThrow();
    for (const cluster of ["mainnet", "mainnet-beta", "localnet"])
      expect(() => checkDbcLaunchConfig(account, { feeIn, cluster })).toThrow(
        "version",
      );
    for (let offset = 216; offset <= 220; offset++) {
      const changed = { ...account, data: Buffer.from(account.data) };
      changed.data[offset] = 1;
      expect(() =>
        checkDbcLaunchConfig(changed, { feeIn, cluster: "devnet" }),
      ).toThrow("transferFeeFields");
    }
  });
  it("decodes the issued Config, Machine and MintLedger offsets", () => {
    expect(decodeLaunchConfig(configAccount(), programId).launchWallet).toEqual(
      wallet,
    );
    expect(decodeLaunchConfig(configAccount(), programId).tokenMint).toEqual(
      mint,
    );
    const decoded = decodeLaunchMachine(machineAccount(true), programId);
    expect(decoded.phase).toBe(2);
    expect(decoded.tokenMint).toEqual(mint);
    expect(decoded.powerOnTs).toBe(powerOnTs);
    expect(decoded.onAirTs).toBe(onAirTs);
    expect(decoded.endTs).toBe(endTs);
    expect(decoded.onePct).toEqual(
      Array.from({ length: 4 }, () => ({
        state: 0,
        amount: TOKEN_1PCT.onePctCardAmount,
      })),
    );
    expect(decodeLaunchLedger(ledgerAccount(), programId)).toEqual({
      mint,
      payer: wallet,
      accounted: TOKEN_1PCT.devBuyAmount,
    });
  });
  it.each(["missing", "owner", "discriminator", "length", "executable"])(
    "rejects malformed program accounts: %s",
    (kind) => {
      const account = configAccount();
      if (kind === "owner") account.owner = key(7);
      if (kind === "discriminator") account.data[0] = account.data[0]! ^ 255;
      if (kind === "length") account.data = account.data.subarray(0, 871);
      if (kind === "executable") account.executable = true;
      expect(() =>
        decodeLaunchConfig(kind === "missing" ? null : account, programId),
      ).toThrow();
    },
  );
  it("rejects unrecognized versions and an active queue outside the Config array", () => {
    const config = configAccount();
    config.data[736] = 2;
    expect(() => decodeLaunchConfig(config, programId)).toThrow(
      "Config_version",
    );
    config.data[736] = 1;
    config.data[738] = 4;
    expect(() => decodeLaunchConfig(config, programId)).toThrow(
      "Config_active_queue",
    );
    const machine = machineAccount();
    machine.data[8] = 0;
    expect(() => decodeLaunchMachine(machine, programId)).toThrow(
      "Machine_version",
    );
  });
});

describe("launch mint template safety", () => {
  it("classifies absent and prefunded System addresses identically", () => {
    expect(classifyLaunchMintAccount(null)).toBe("absent");
    expect(
      classifyLaunchMintAccount({
        ...snapshot(Buffer.alloc(0), SystemProgram.programId),
        lamports: 890_880n,
      }),
    ).toBe("absent");
    expect(classifyLaunchMintAccount(mintAccount())).toBe("token-mint");
  });
  it.each([
    snapshot(Buffer.alloc(0), key(7)),
    snapshot(Buffer.alloc(1), SystemProgram.programId),
    { ...snapshot(Buffer.alloc(0), SystemProgram.programId), executable: true },
  ])("classifies incompatible accounts as foreign", (account) => {
    expect(classifyLaunchMintAccount(account)).toBe("foreign");
  });
  it("accepts the immutable SPL Token mint", () => {
    expect(checkLaunchMint(mintAccount())).toEqual({
      decimals: 6,
      supply: "1000000000000000",
      tokenProgram: PROGRAM_IDS.splToken,
      mintAuthority: null,
      freezeAuthority: null,
    });
  });
  it.each([0, 81, 83, 166])("rejects mint length %s", (length) => {
    expect(() =>
      checkLaunchMint({ ...mintAccount(), data: Buffer.alloc(length) }),
    ).toThrow("mint_layout");
  });
  it.each([0, 46])("rejects a retained authority at offset %s", (offset) => {
    const account = mintAccount();
    dataOf(account).writeUInt32LE(1, offset);
    expect(() => checkLaunchMint(account)).toThrow("mint_authorities");
  });
  it.each([44, 45])(
    "rejects invalid decimals, initialization or account type at %s",
    (offset) => {
      const account = mintAccount();
      account.data[offset] = 0;
      expect(() => checkLaunchMint(account)).toThrow();
    },
  );
  it("rejects missing, Token-2022 and executable mints", () => {
    expect(() => checkLaunchMint(null)).toThrow("mint_missing");
    expect(() =>
      checkLaunchMint({
        ...mintAccount(),
        owner: new PublicKey(PROGRAM_IDS.token2022),
      }),
    ).toThrow("mint_token_program");
    expect(() =>
      checkLaunchMint({ ...mintAccount(), executable: true }),
    ).toThrow("mint_token_program");
  });
  it("accepts an external burn of one base unit", () => {
    const account = mintAccount();
    dataOf(account).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
    expect(checkLaunchMint(account).supply).toBe(
      (TOKEN_1PCT.totalSupply - 1n).toString(),
    );
  });
  it("rejects a supply above the configured initial supply", () => {
    const account = mintAccount();
    dataOf(account).writeBigUInt64LE(TOKEN_1PCT.totalSupply + 1n, 36);
    expect(() => checkLaunchMint(account)).toThrow("mint_supply");
  });
});

describe("DBC config, pool and token account safety", () => {
  it("refuses a version 1 DBC config in the mainnet report while the reference remains version 0", () => {
    const account = dbcConfigAccount();
    account.data[236] = 1;
    const report = buildLaunchReport({
      ...reportInput(),
      cluster: "mainnet",
      dbcConfigAccount: account,
    });
    expect(
      report.checks.find((check) => check.id === "report.pool"),
    ).toMatchObject({
      status: "NO-GO",
      detail: "dbc_config_fields:version",
    });
  });
  const poolInput = () => ({
    mint,
    feeIn,
    dbcConfig,
    dbcConfigAccount: dbcConfigAccount(),
    requirePartnerFees: true,
  });
  it("requires D29 config and partner fees paid to FeeIn", () => {
    expect(checkLaunchPool(poolAccount(), poolInput())).toMatchObject({
      config: dbcConfig.toBase58(),
      baseMint: mint.toBase58(),
      feeClaimer: feeIn.toBase58(),
      partnerQuoteFee: "123",
      creatorQuoteFee: "0",
    });
  });
  it.each([
    [8, "quoteMint"],
    [40, "feeClaimer"],
    [72, "leftoverReceiver"],
    [104, "poolFees"],
    [136, "poolFees"],
    [232, "collectFeeMode"],
    [233, "migrationOption"],
    [235, "tokenDecimal"],
    [236, "version"],
    [237, "tokenType"],
    [239, "partnerPermanentLockedLiquidityPercentage"],
    [240, "partnerLiquidityPercentage"],
    [241, "creatorPermanentLockedLiquidityPercentage"],
    [242, "creatorLiquidityPercentage"],
    [243, "migrationFeeOption"],
    [245, "creatorTradingFeePercentage"],
    [246, "tokenUpdateAuthority"],
    [264, "migrationQuoteThreshold"],
    [344, "preMigrationTokenSupply"],
    [352, "postMigrationTokenSupply"],
    [360, "migratedCollectFeeMode"],
    [361, "migratedDynamicFee"],
    [362, "migratedPoolFeeBps"],
    [364, "migratedPoolBaseFeeMode"],
    [366, "migratedCompoundingFeeBps"],
    [392, "sqrtStartPrice"],
    [408, "curve"],
  ] as const)("rejects changed config field at %s (%s)", (...[offset]) => {
    const account = dbcConfigAccount();
    account.data[offset] = account.data[offset]! ^ 1;
    expect(() => checkDbcLaunchConfig(account, { feeIn })).toThrow(
      "dbc_config_fields:",
    );
    expect(
      checkLaunchSimulation({
        ...simulation(),
        dbcConfigAccount: account,
      }).find((check) => check.id === "6.pool"),
    ).toMatchObject({ status: "NO-GO" });
    expect(
      buildLaunchReport({
        ...reportInput(),
        cluster: "mainnet",
        dbcConfigAccount: account,
      }).checks.find((check) => check.id === "report.pool"),
    ).toMatchObject({ status: "NO-GO" });
  });
  it("rejects missing, foreign or malformed config", () => {
    expect(() => checkDbcLaunchConfig(null, { feeIn })).toThrow(
      "dbc_config_missing",
    );
    expect(() =>
      checkDbcLaunchConfig({ ...dbcConfigAccount(), owner: key(9) }, { feeIn }),
    ).toThrow("dbc_config_owner");
    const account = dbcConfigAccount();
    account.data[0] = account.data[0]! ^ 1;
    expect(() => checkDbcLaunchConfig(account, { feeIn })).toThrow();
  });
  it.each([
    [72, "pool_config"],
    [136, "pool_base_mint"],
    [360, "pool_creator_fees"],
  ] as const)("rejects changed pool field %s", (offset, code) => {
    const account = poolAccount();
    account.data[offset] = account.data[offset]! ^ 1;
    expect(() => checkLaunchPool(account, poolInput())).toThrow(code);
  });
  it("requires accrued partner fees in simulation, allowing already claimed fees in reports", () => {
    const account = poolAccount();
    dataOf(account).writeBigUInt64LE(0n, 272);
    expect(() => checkLaunchPool(account, poolInput())).toThrow(
      "pool_partner_fees_missing",
    );
    expect(
      checkLaunchPool(account, { ...poolInput(), requirePartnerFees: false })
        .partnerQuoteFee,
    ).toBe("0");
  });
  it("rejects base-denominated fees and mismatched quoted partner fees", () => {
    expect(() =>
      checkLaunchPool(poolAccount(), {
        ...poolInput(),
        expectedPartnerFee: 124n,
      }),
    ).toThrow("pool_partner_fee_quote_mismatch");
    for (const offset of [248, 264]) {
      const account = poolAccount();
      dataOf(account).writeBigUInt64LE(1n, offset);
      expect(() => checkLaunchPool(account, poolInput())).toThrow(
        "pool_base_fees",
      );
    }
    const creator = poolAccount();
    dataOf(creator).writeBigUInt64LE(1n, 352);
    expect(() => checkLaunchPool(creator, poolInput())).toThrow(
      "pool_creator_fees",
    );
  });
  it("rejects malformed pool layouts and owners", () => {
    expect(() => checkLaunchPool(null, poolInput())).toThrow("pool_missing");
    expect(() =>
      checkLaunchPool({ ...poolAccount(), owner: key(9) }, poolInput()),
    ).toThrow("pool_owner");
    const account = poolAccount();
    account.data[0] = account.data[0]! ^ 1;
    expect(() => checkLaunchPool(account, poolInput())).toThrow();
  });
  it("validates token program, mint, authority and initialized state", () => {
    expect(checkLaunchTokenAccount(tokenAccount(), mint, vaultAuthority)).toBe(
      TOKEN_1PCT.devBuyAmount,
    );
    expect(() =>
      checkLaunchTokenAccount(tokenAccount(), key(8), vaultAuthority),
    ).toThrow("token_account_identity");
    expect(() => checkLaunchTokenAccount(tokenAccount(), mint, wallet)).toThrow(
      "token_account_identity",
    );
    const frozen = tokenAccount();
    frozen.data[108] = 2;
    expect(() => checkLaunchTokenAccount(frozen, mint, vaultAuthority)).toThrow(
      "token_account_layout_or_state",
    );
  });
});

describe("launch lookup table", () => {
  const input = () => ({
    table: table(),
    expectedAddresses: [key(11), key(12)],
    currentSlot: 101,
  });
  it("requires one full slot after its extension", () => {
    expect(checkLaunchLookupTable(input()).authority).toBeNull();
    expect(() =>
      checkLaunchLookupTable({ ...input(), currentSlot: 100 }),
    ).toThrow("lookup_table_not_warmed");
  });
  it("rejects mutable, deactivating and absent tables", () => {
    expect(() =>
      checkLaunchLookupTable({ ...input(), table: table(wallet) }),
    ).toThrow("lookup_table_inactive_or_mutable");
    const inactive = table();
    inactive.state.deactivationSlot = 102n;
    expect(() =>
      checkLaunchLookupTable({ ...input(), table: inactive }),
    ).toThrow("lookup_table_inactive_or_mutable");
    expect(() => checkLaunchLookupTable({ ...input(), table: null })).toThrow(
      "lookup_table_missing",
    );
  });
  it.each([[12, 11], [11], [11, 12, 13], [11, 11]])(
    "rejects reordered, partial, extra or duplicate contents %j",
    (...bytes) => {
      expect(() =>
        checkLaunchLookupTable({
          ...input(),
          table: table(undefined, bytes.map(key)),
        }),
      ).toThrow("lookup_table_addresses");
    },
  );
});

describe("launch go/no-go", () => {
  it("classifies prefunded pool addresses and rejects existing or foreign pools", () => {
    const prefunded = {
      ...snapshot(Buffer.alloc(0), SystemProgram.programId),
      lamports: 890_880n,
    };
    expect(classifyLaunchPoolAccount(prefunded)).toBe("absent");
    expect(classifyLaunchPoolAccount(poolAccount())).toBe("dbc-pool");
    expect(classifyLaunchPoolAccount(snapshot(Buffer.alloc(0), key(7)))).toBe(
      "foreign",
    );
    expect(
      checkLaunchPrerequisites({
        ...prerequisites(),
        poolAccount: prefunded,
      }).find((check) => check.id === "3.pool"),
    ).toMatchObject({ status: "GO", value: { prefundedLamports: "890880" } });
    expect(
      checkLaunchPrerequisites({
        ...prerequisites(),
        poolAccount: poolAccount(),
      }).find((check) => check.id === "3.pool"),
    ).toMatchObject({ status: "NO-GO", detail: "pool_already_exists" });
    expect(
      checkLaunchPrerequisites({
        ...prerequisites(),
        poolAccount: snapshot(Buffer.alloc(0), key(7)),
      }).find((check) => check.id === "3.pool"),
    ).toMatchObject({ status: "NO-GO", detail: "pool_foreign_account" });
  });
  it("allows a prefunded mint address and reports its donated lamports", () => {
    const result = checkLaunchPrerequisites({
      ...prerequisites(),
      mintAccount: {
        ...snapshot(Buffer.alloc(0), SystemProgram.programId),
        lamports: 890_880n,
      },
    });
    expect(failures(result)).toEqual([]);
    expect(result.find((check) => check.id === "3.config")).toMatchObject({
      status: "GO",
      value: { mintExists: false, prefundedLamports: "890880" },
    });
    expect(checkLaunchPrerequisites(prerequisites())[0]).toMatchObject({
      value: { prefundedLamports: "0" },
    });
  });
  it("distinguishes an existing SPL Token mint from a foreign owner", () => {
    expect(
      checkLaunchPrerequisites({
        ...prerequisites(),
        mintAccount: mintAccount(),
      })[0],
    ).toMatchObject({ status: "NO-GO", detail: "mint_already_exists" });
    expect(
      checkLaunchPrerequisites({
        ...prerequisites(),
        mintAccount: snapshot(Buffer.alloc(0), key(7)),
      })[0],
    ).toMatchObject({ status: "NO-GO", detail: "mint_foreign_account" });
  });
  it("passes valid prerequisites and reads the actual rent requirement", () => {
    expect(failures(checkLaunchPrerequisites(prerequisites()))).toEqual([]);
    expect(
      failures(
        checkLaunchPrerequisites({
          ...prerequisites(),
          rentMinimumLamports: 124n,
        }),
      ),
    ).toEqual(["4.fee_in"]);
    expect(
      failures(
        checkLaunchPrerequisites({
          ...prerequisites(),
          rentMinimumLamports: 0n,
        }),
      ),
    ).toEqual([]);
  });
  it("rejects mismatched signers, existing mint, wrong phase and malformed FeeIn", () => {
    expect(
      failures(checkLaunchPrerequisites({ ...prerequisites(), mint: key(5) })),
    ).toEqual(["3.config"]);
    expect(
      failures(
        checkLaunchPrerequisites({ ...prerequisites(), launchWallet: key(5) }),
      ),
    ).toEqual(["3.config"]);
    expect(
      failures(
        checkLaunchPrerequisites({
          ...prerequisites(),
          mintAccount: mintAccount(),
        }),
      ),
    ).toEqual(["3.config"]);
    expect(
      failures(
        checkLaunchPrerequisites({
          ...prerequisites(),
          machine: machineAccount(true),
        }),
      ),
    ).toEqual(["4.machine"]);
    expect(
      failures(
        checkLaunchPrerequisites({
          ...prerequisites(),
          feeIn: snapshot(Buffer.alloc(0)),
        }),
      ),
    ).toEqual(["4.fee_in"]);
  });
  it("validates successful post-state and fails immediately on simulation error", () => {
    expect(failures(checkLaunchSimulation(simulation()))).toEqual([]);
    expect(
      failures(
        checkLaunchSimulation({
          ...simulation(),
          err: { InstructionError: [8, "Custom"] },
        }),
      ),
    ).toEqual(["6.simulation"]);
    expect(
      failures(checkLaunchSimulation({ ...simulation(), mint: null })),
    ).toEqual(["6.mint"]);
    expect(
      failures(
        checkLaunchSimulation({
          ...simulation(),
          vault: tokenAccount(TOKEN_1PCT.devBuyAmount + 1n),
        }),
      ),
    ).toEqual(["6.vault"]);
    expect(
      failures(
        checkLaunchSimulation({
          ...simulation(),
          launchTokenAccount: tokenAccount(0n, wallet),
        }),
      ),
    ).toEqual(["6.launch_account"]);
  });
  it("accepts the empty zero-lamport System account returned after closure", () => {
    const closed = {
      ...snapshot(Buffer.alloc(0), SystemProgram.programId),
      lamports: 0n,
    };
    expect(
      failures(
        checkLaunchSimulation({ ...simulation(), launchTokenAccount: closed }),
      ),
    ).toEqual([]);
    for (const malformed of [
      { ...closed, lamports: 1n },
      { ...closed, data: Buffer.from([1]) },
      { ...closed, executable: true },
      { ...closed, owner: key(8) },
    ])
      expect(
        failures(
          checkLaunchSimulation({
            ...simulation(),
            launchTokenAccount: malformed,
          }),
        ),
      ).toEqual(["6.launch_account"]);
  });
  it("records devnet rehearsal provenance under D18", () => {
    const result = checkRehearsalMint(mintAccount(), {
      cluster: "devnet",
      mint,
      observedSlot: 88,
    });
    expect(result.status).toBe("GO");
    expect(result.value).toMatchObject({
      cluster: "devnet",
      mint: mint.toBase58(),
      observedSlot: 88,
      tokenProgram: PROGRAM_IDS.splToken,
    });
  });
  it("does not infer initial supply from a standalone rehearsal mint without DBC evidence", () => {
    const account = mintAccount();
    dataOf(account).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
    expect(
      checkRehearsalMint(account, {
        cluster: "devnet",
        mint,
        observedSlot: 88,
      }),
    ).toMatchObject({
      status: "NO-GO",
      detail: "rehearsal_initial_supply_unproven",
    });
  });
  it("program changes warn, while incomplete evidence cannot pass", () => {
    const versions = [
      DBC_PROGRAM_ID.toBase58(),
      DAMM_V2_PROGRAM_ID.toBase58(),
    ].map((programId, index) => ({
      programId,
      deploySlot: index,
      executableHash: `hash-${index}`,
    }));
    expect(checkLaunchProgramVersions(versions, versions).status).toBe("GO");
    expect(
      checkLaunchProgramVersions(
        [{ ...versions[0]!, deploySlot: 900 }, ...versions.slice(1)],
        versions,
      ).status,
    ).toBe("WARN");
    expect(
      checkLaunchProgramVersions(
        [{ ...versions[0]!, executableHash: "changed" }, ...versions.slice(1)],
        versions,
      ).status,
    ).toBe("WARN");
    expect(checkLaunchProgramVersions(versions.slice(1), versions).status).toBe(
      "NO-GO",
    );
    expect(
      checkLaunchProgramVersions([versions[0]!, versions[0]!], versions).status,
    ).toBe("NO-GO");
  });
});

describe("landed launch report", () => {
  it("accepts a finalized launch after an external burn and proves its initial DBC supply", () => {
    const input = { ...reportInput(), landedForm: "proxima-separate" as const };
    dataOf(input.mint).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
    const report = buildLaunchReport(input);
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "report.pool")?.value,
    ).toMatchObject({ initialSupply: TOKEN_1PCT.totalSupply.toString() });
    expect(
      report.checks.find((check) => check.id === "report.mint")?.value,
    ).toMatchObject({ supply: (TOKEN_1PCT.totalSupply - 1n).toString() });
  });
  it.each([344, 352, 246])(
    "still rejects altered DBC supply or metadata policy at %s after a burn",
    (offset) => {
      const input = reportInput();
      dataOf(input.mint).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
      input.dbcConfigAccount.data[offset] =
        input.dbcConfigAccount.data[offset]! ^ 1;
      expect(buildLaunchReport(input).ok).toBe(false);
      expect(
        buildLaunchReport(input).checks.find(
          (check) => check.id === "report.pool",
        ),
      ).toMatchObject({ status: "NO-GO" });
    },
  );
  it("reports all launch checks, clocks, form, addresses and JSON-safe values", () => {
    const report = buildLaunchReport(reportInput());
    expect(report.ok).toBe(true);
    expect(report.landedForm).toBe("single-v0");
    expect(report.addresses.tokenMint).toBe(mint.toBase58());
    expect(report.addresses.feeIn).toBe(feeIn.toBase58());
    expect(report.addresses.launchWallet).toBe(wallet.toBase58());
    expect(report.addresses.teamWallets).toHaveLength(1);
    expect(report.addresses.guardians).toHaveLength(2);
    expect(
      report.checks.find((entry) => entry.id === "report.timestamps")!.value,
    ).toMatchObject({
      powerOnTs: powerOnTs.toString(),
      onAirTs: onAirTs.toString(),
      endTs: endTs.toString(),
      onePctReleaseTs: TOKEN_1PCT.onePctReleaseOffsetsSeconds.map((offset) =>
        (onAirTs + BigInt(offset)).toString(),
      ),
    });
    expect(() => JSON.stringify(report)).not.toThrow();
  });
  it.each([2, 3])(
    "accepts slot 0 promotion in phase %s without changing allocation",
    (phase) => {
      const input = reportInput();
      input.machine.data[10] = phase;
      input.machine.data[2_344] = 1;
      const report = buildLaunchReport(input);
      expect(report.ok).toBe(true);
      expect(
        report.checks.find((check) => check.id === "report.one_pct")?.value,
      ).toEqual([
        { amount: TOKEN_1PCT.onePctCardAmount.toString(), state: "Live" },
        ...Array.from({ length: 3 }, () => ({
          amount: TOKEN_1PCT.onePctCardAmount.toString(),
          state: "Locked",
        })),
      ]);
    },
  );
  it.each([1, 2, 3])("rejects a later Live slot %s", (index) => {
    const input = reportInput();
    input.machine.data[2_344 + index * 16] = 1;
    expect(failures(buildLaunchReport(input).checks)).toEqual([
      "report.one_pct",
    ]);
    input.machine.data[2_344] = 1;
    expect(failures(buildLaunchReport(input).checks)).toEqual([
      "report.one_pct",
    ]);
  });
  it.each([2, 3, 7])(
    "rejects slot 0 state %s after the allocation changed",
    (state) => {
      const input = reportInput();
      input.machine.data[2_344] = state;
      expect(failures(buildLaunchReport(input).checks)).toEqual([
        "report.one_pct",
      ]);
    },
  );
  it("keeps immediate simulation strict before OnAir and slot promotion", () => {
    const input = { ...reportInput(), launchSimulation: true };
    expect(buildLaunchReport(input).ok).toBe(true);
    input.machine.data[2_344] = 1;
    expect(failures(buildLaunchReport(input).checks)).toEqual([
      "report.one_pct",
    ]);
    input.machine.data[10] = 3;
    expect(failures(buildLaunchReport(input).checks)).toEqual([
      "report.phase",
      "report.one_pct",
    ]);
  });
  it("reports donations without crediting them to the ledger", () => {
    const report = buildLaunchReport({
      ...reportInput(),
      vault: tokenAccount(TOKEN_1PCT.devBuyAmount + 1n),
    });
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((entry) => entry.id === "report.vault")!.value,
    ).toEqual({
      amount: (TOKEN_1PCT.devBuyAmount + 1n).toString(),
      unaccounted: "1",
    });
    expect(
      report.checks.find((entry) => entry.id === "report.ledger")!.value,
    ).toEqual({ accounted: TOKEN_1PCT.devBuyAmount.toString() });
  });
  it("reports a donated unit in a non-ATA account without requiring an empty wallet", () => {
    expect(
      buildLaunchReport({
        ...reportInput(),
        launchTokenAccounts: [tokenAccount(0n, wallet)],
      }).ok,
    ).toBe(true);
    const report = buildLaunchReport({
      ...reportInput(),
      launchTokenAccounts: [tokenAccount(0n, wallet), tokenAccount(1n, wallet)],
    });
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "report.launch_wallet")?.value,
    ).toEqual({ amount: "1", tokenAccounts: 2 });
  });
  it("reports a donated unit in the launch ATA while accounting for exactly the dev buy", () => {
    const report = buildLaunchReport({
      ...reportInput(),
      landedForm: "proxima-separate",
      launchTokenAccounts: [tokenAccount(1n, wallet)],
    });
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "report.ledger")?.value,
    ).toEqual({ accounted: TOKEN_1PCT.devBuyAmount.toString() });
  });
  it("still rejects mismatched wallet token account identity", () => {
    const report = buildLaunchReport({
      ...reportInput(),
      launchTokenAccounts: [tokenAccount(1n, key(7))],
    });
    expect(failures(report.checks)).toEqual(["report.launch_wallet"]);
  });
  it.each(["phase", "mint", "ledger", "slots", "clock", "vault"])(
    "rejects incorrect landed %s",
    (kind) => {
      const input = reportInput();
      if (kind === "phase") input.machine.data[10] = 4;
      if (kind === "mint") putKey(dataOf(input.machine), 2_608, key(7));
      if (kind === "ledger")
        dataOf(input.ledger).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount + 1n, 72);
      if (kind === "slots") input.machine.data[2_344 + 16] = 1;
      if (kind === "clock")
        dataOf(input.machine).writeBigInt64LE(
          1_793_289_600n + BigInt(SEASON.onAirDelaySeconds) + 1n,
          48,
        );
      if (kind === "vault")
        input.vault = tokenAccount(TOKEN_1PCT.devBuyAmount - 1n);
      expect(buildLaunchReport(input).ok).toBe(false);
    },
  );
});
