import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import {
  meteoraForCluster,
  ONEPERCENT_PROGRAM_IDS,
  ACCOUNT_SIZES,
  PROGRAM_IDS,
  SEASON,
  TOKEN_1PCT,
} from "@onepercent/config";
import {
  createDeploymentSelector,
  launchAddresses,
  launchLookupAddresses,
  launchInstructionGroups,
  DBC_PROGRAM_ID,
  encodeDbcConfigFixture,
  quoteDbcExactOut,
  buildDbcLaunchConfig,
} from "@onepercent/sdk";
import type { LaunchTransactionOptions } from "@onepercent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENESIS } from "../runtime.js";
import { readLaunchPolicy } from "./landing.js";
import {
  planLaunch,
  requireLaunchCluster,
  runLaunch,
  observeLaunchState,
  rebroadcastLaunchAttempt,
} from "./runtime.js";
import { sendLaunch } from "./send.js";
import type { LaunchAttempt } from "./send.js";
import type { LaunchInput } from "./input.js";

vi.mock("./landing.js", async (original) => {
  const actual = await original<typeof import("./landing.js")>();
  return {
    ...actual,
    readLaunchPolicy: vi.fn(() => null),
  };
});
const TOKEN_PROGRAM_ID = new PublicKey(PROGRAM_IDS.splToken);
const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const programId = key(51),
  mint = key(21),
  wallet = key(22),
  lut = key(23),
  dbcConfig = new PublicKey(meteoraForCluster("devnet").dbcConfig);
const file = (path: string) =>
  new URL(`../../../../fixtures/${path}`, import.meta.url);
const programs = JSON.parse(
  readFileSync(file("meteora/programs.json"), "utf8"),
) as {
  programs: {
    programId: string;
    programData: string;
    deploymentSlot: number;
  }[];
};
const input: LaunchInput = {
  command: "plan",
  cluster: "devnet",
  rpc: "https://rpc.example.test",
  program: programId.toBase58(),
  lut: lut.toBase58(),
  dbcConfig: dbcConfig.toBase58(),
  name: "Launch rehearsal",
  symbol: "TEST",
  uri: "https://metadata.example.test/coin",
  acceptWarnings: false,
};
const deployment = createDeploymentSelector({ devnet: programId })("devnet");
const a = launchAddresses({ deployment, mint, wallet });
const dbcConfigBytes = await encodeDbcConfigFixture(a.feeIn);
const quoteDetails = quoteDbcExactOut(
  buildDbcLaunchConfig(),
  TOKEN_1PCT.devBuyAmount,
);
const quote = quoteDetails.maxQuoteIn;
const account = (
  data: Buffer,
  owner = programId,
  lamports = 10000000,
): AccountInfo<Buffer> => ({
  data,
  owner,
  lamports,
  executable: false,
  rentEpoch: 0,
});
const base = (name: string, size: number) => {
  const data = Buffer.alloc(size);
  createHash("sha256").update(`account:${name}`).digest().copy(data, 0, 0, 8);
  return data;
};
function config() {
  const data = base("Config", 872);
  data[736] = 1;
  wallet.toBuffer().copy(data, 232);
  mint.toBuffer().copy(data, 552);
  return account(data);
}
function machine(powered = false) {
  const data = base("Machine", 3808);
  data[8] = 1;
  data[10] = powered ? 2 : 1;
  if (powered) {
    const t = 1000n;
    data.writeBigInt64LE(t, 40);
    data.writeBigInt64LE(t + BigInt(SEASON.onAirDelaySeconds), 48);
    data.writeBigInt64LE(
      t + BigInt(SEASON.onAirDelaySeconds + SEASON.durationSeconds),
      56,
    );
    mint.toBuffer().copy(data, 2608);
    for (let i = 0; i < TOKEN_1PCT.onePctCardCount; i++)
      data.writeBigUInt64LE(TOKEN_1PCT.onePctCardAmount, 2336 + i * 16);
  }
  return account(data);
}
function ledger() {
  const data = base("MintLedger", ACCOUNT_SIZES.mintLedger);
  mint.toBuffer().copy(data, 8);
  wallet.toBuffer().copy(data, 40);
  data.writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 72);
  return account(data);
}
function splMint() {
  const data = Buffer.alloc(82);
  data[44] = TOKEN_1PCT.decimals;
  data[45] = 1;
  data.writeBigUInt64LE(TOKEN_1PCT.totalSupply, 36);
  return account(data, TOKEN_PROGRAM_ID);
}
function dbcPoolAccount() {
  const data = base("VirtualPool", 424);
  dbcConfig.toBuffer().copy(data, 72);
  mint.toBuffer().copy(data, 136);
  data.writeBigUInt64LE(quoteDetails.partnerFee, 272);
  return account(data, DBC_PROGRAM_ID);
}
function simulatedAccounts(powered = true) {
  const vault = Buffer.alloc(165);
  mint.toBuffer().copy(vault);
  a.vaultAuth.toBuffer().copy(vault, 32);
  vault.writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 64);
  vault[108] = 1;
  return [
    splMint(),
    dbcPoolAccount(),
    account(vault, TOKEN_PROGRAM_ID),
    null,
    account(Buffer.alloc(0), SystemProgram.programId, 2000000000),
    machine(powered),
    ledger(),
  ].map((row) =>
    row === null
      ? null
      : {
          owner: row.owner.toBase58(),
          data: [row.data.toString("base64"), "base64"] as [string, "base64"],
          lamports: row.lamports,
          executable: row.executable,
          rentEpoch: 0,
        },
  );
}
function lookupData() {
  const options: LaunchTransactionOptions = {
    deployment,
    wallet,
    mint,
    name: input.name!,
    symbol: input.symbol!,
    uri: input.uri!,
    blockhash: key(24).toBase58(),
    maxSolCost: quote,
    computeUnitLimit: 1400000,
    computeUnitPriceMicroLamports: 0n,
    tip: {
      recipient: new PublicKey("4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE"),
      lamports: 0n,
    },
  };
  const keys = launchLookupAddresses(options);
  const data = Buffer.alloc(56 + keys.length * 32);
  data.writeUInt32LE(1);
  data.writeBigUInt64LE((1n << 64n) - 1n, 4);
  data.writeBigUInt64LE(50n, 12);
  keys.forEach((key, i) => key.toBuffer().copy(data, 56 + i * 32));
  return data;
}
function mockConnection() {
  const connection = new Connection(input.rpc);
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({
    blockhash: key(24).toBase58(),
    lastValidBlockHeight: 400,
  });
  vi.spyOn(connection, "getSlot").mockResolvedValue(100);
  vi.spyOn(connection, "getMinimumBalanceForRentExemption").mockResolvedValue(
    650240,
  );
  vi.spyOn(connection, "getRecentPrioritizationFees").mockResolvedValue([
    { slot: 100, prioritizationFee: 10 },
  ]);
  vi.spyOn(connection, "getMultipleAccountsInfoAndContext").mockResolvedValue({
    context: { slot: 100 },
    value: [
      config(),
      machine(),
      null,
      account(Buffer.alloc(0), SystemProgram.programId),
      account(Buffer.alloc(0), SystemProgram.programId, 4000000000),
      null,
    ],
  });
  vi.spyOn(connection, "getAccountInfo").mockImplementation(async (address) => {
    if (address.equals(dbcConfig))
      return account(Buffer.from(dbcConfigBytes), DBC_PROGRAM_ID);
    if (address.equals(lut))
      return account(lookupData(), AddressLookupTableProgram.programId);
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const program = programs.programs.find(
      (row) => row.programId === address.toBase58(),
    );
    if (program) {
      const data = Buffer.alloc(36);
      data.writeUInt32LE(2);
      new PublicKey(program.programData).toBuffer().copy(data, 4);
      return { ...account(data, loader), executable: true };
    }
    const programData = programs.programs.find(
      (row) => row.programData === address.toBase58(),
    );
    if (programData) {
      const data = Buffer.alloc(46);
      data.writeUInt32LE(3);
      data.writeBigUInt64LE(BigInt(programData.deploymentSlot), 4);
      return account(data, loader);
    }
    throw new Error("Unexpected mock account read");
  });
  const simulate = vi
    .spyOn(connection, "simulateTransaction")
    .mockResolvedValue({
      context: { slot: 101 },
      value: {
        err: null,
        logs: [],
        unitsConsumed: 200000,
        accounts: simulatedAccounts(),
      },
    });
  return { connection, simulate };
}
beforeEach(() => {
  vi.mocked(readLaunchPolicy).mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("launch plan runtime with RPC mocks", () => {
  it.each(["devnet", "localnet"] as const)(
    "allows the first %s rehearsal without earlier devnet evidence",
    async (cluster) => {
      const { connection } = mockConnection();
      const result = await planLaunch(
        connection,
        { ...input, cluster },
        { wallet, mint },
      );
      expect(result.checks).toContainEqual(
        expect.objectContaining({ id: "rehearsal_mint", status: "GO" }),
      );
    },
  );
  it("rejects absent mainnet pins or a test config before simulation", async () => {
    const { connection, simulate } = mockConnection();
    await expect(
      planLaunch(
        connection,
        { ...input, cluster: "mainnet" },
        { wallet, mint },
      ),
    ).rejects.toThrow(
      ONEPERCENT_PROGRAM_IDS.mainnet === null
        ? "launch_mainnet_program_pending"
        : "launch_mainnet_program_pin_mismatch",
    );
    expect(simulate).not.toHaveBeenCalled();
  });
  it("rejects an incorrect config pin or an empty program identity", async () => {
    const { connection, simulate } = mockConnection();
    await expect(
      planLaunch(
        connection,
        { ...input, dbcConfig: key(90).toBase58() },
        { wallet, mint },
      ),
    ).rejects.toThrow("launch_dbc_config_cluster_pin_mismatch");
    await expect(
      planLaunch(
        connection,
        { ...input, program: PublicKey.default.toBase58() },
        { wallet, mint },
      ),
    ).rejects.toThrow("invalid_launch_program");
    expect(simulate).not.toHaveBeenCalled();
  });
  it("builds real devnet v0 bytes and checks all post-state with its measured profile", async () => {
    const { connection, simulate } = mockConnection();
    const result = await planLaunch(connection, input, { wallet, mint });
    expect(result.form).toBe("single");
    expect(result.report.quoteLamports).toBe(quote);
    expect(result.report.sizes.single).toBeLessThanOrEqual(1232);
    expect(result.report.ok).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "landing_policy", status: "GO" }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "simulation.report.phase", status: "GO" }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "simulation.report.ledger", status: "GO" }),
    );
    expect(simulate).toHaveBeenCalledTimes(2);
    const request = simulate.mock.calls[0]![1];
    expect(request).toMatchObject({
      sigVerify: false,
      replaceRecentBlockhash: true,
      minContextSlot: 100,
    });
    expect(
      (request as { accounts: { addresses: string[] } }).accounts.addresses,
    ).toEqual(
      [
        mint,
        a.launchPool,
        a.vault,
        a.launchAta,
        wallet,
        a.machine,
        a.ledger,
      ].map((key) => key.toBase58()),
    );
  });
  it("rebuilds with measured margin then simulates the final message again", async () => {
    vi.mocked(readLaunchPolicy).mockReturnValue({
      landing: {
        cuMarginBps: 2000,
        tipLamports: 1000000n,
        maxComputeUnitPriceMicroLamports: 100n,
      },
      keeper: { sendMaxAttempts: 3, backoffBaseMs: 10 },
    });
    const { connection, simulate } = mockConnection();
    const result = await planLaunch(connection, input, { wallet, mint });
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(result.buildOptions.computeUnitLimit).toBe(240000);
    expect(result.buildOptions.computeUnitPriceMicroLamports).toBe(10n);
    const groups = launchInstructionGroups(result.buildOptions);
    const expected = [
      ...new Set([
        wallet.toBase58(),
        ...[...groups.createAndBuy, ...groups.depositAndPowerOn].flatMap((ix) =>
          ix.keys
            .filter((key) => key.isWritable)
            .map((key) => key.pubkey.toBase58()),
        ),
      ]),
    ]
      .sort()
      .slice(0, 128)
      .map((address) => new PublicKey(address));
    expect(
      connection.getRecentPrioritizationFees,
    ).toHaveBeenCalledExactlyOnceWith({ lockedWritableAccounts: expected });
    expect(expected).toContainEqual(mint);
    expect(expected).toContainEqual(a.feeIn);
    expect(expected).toContainEqual(a.vault);
  });
  it("refuses a successful no-op Power-On and incomplete simulation accounts", async () => {
    const { connection, simulate } = mockConnection();
    simulate.mockResolvedValue({
      context: { slot: 101 },
      value: {
        err: null,
        logs: [],
        unitsConsumed: 200000,
        accounts: simulatedAccounts(false),
      },
    });
    const result = await planLaunch(connection, input, { wallet, mint });
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "simulation.report.phase",
        status: "NO-GO",
      }),
    );
    simulate.mockResolvedValue({
      context: { slot: 101 },
      value: { err: null, logs: [], unitsConsumed: 200000, accounts: [] },
    });
    const missing = await planLaunch(connection, input, { wallet, mint });
    expect(missing.report.ok).toBe(false);
    expect(missing.checks).toContainEqual(
      expect.objectContaining({ id: "6.mint", status: "NO-GO" }),
    );
  });
  it("stays single-only and reports oversized diagnostic bytes without a LUT", async () => {
    const { connection, simulate } = mockConnection();
    const result = await planLaunch(
      connection,
      { ...input, cluster: "localnet", lut: undefined },
      { wallet, mint },
    );
    expect(result.form).toBe("single");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "launch_transaction_size",
        status: "NO-GO",
      }),
    );
    expect(simulate).not.toHaveBeenCalled();
  });
  it("reports a mismatched DBC config as NO-GO while retaining diagnostic bytes", async () => {
    const { connection } = mockConnection();
    const original = vi
      .mocked(connection.getAccountInfo)
      .getMockImplementation()!;
    vi.mocked(connection.getAccountInfo).mockImplementation(async (...args) => {
      if (args[0].equals(dbcConfig)) {
        const bytes = Buffer.from(dbcConfigBytes);
        bytes[245] = 1;
        return account(bytes, DBC_PROGRAM_ID);
      }
      return original(...args);
    });
    const result = await planLaunch(connection, input, { wallet, mint });
    expect(result.report.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "3.dbc_config",
        status: "NO-GO",
        detail: expect.stringContaining("creatorTradingFeePercentage"),
      }),
    );
    expect(result.report.sizes.single).toBeLessThanOrEqual(1232);
  });
  it("reports a stale DBC lookup table as a named NO-GO", async () => {
    const { connection, simulate } = mockConnection();
    const original = vi
      .mocked(connection.getAccountInfo)
      .getMockImplementation()!;
    vi.mocked(connection.getAccountInfo).mockImplementation(async (...args) => {
      if (args[0].equals(lut)) {
        const bytes = lookupData();
        key(93).toBuffer().copy(bytes, 56);
        return account(bytes, AddressLookupTableProgram.programId);
      }
      return original(...args);
    });
    const result = await planLaunch(connection, input, { wallet, mint });
    expect(result.report.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "lut_dbc_accounts_mismatch",
        status: "NO-GO",
      }),
    );
    expect(simulate).toHaveBeenCalledTimes(2);
  });
  it.each([136, 360])(
    "rejects a simulated pool identity or creator fee mismatch at offset %i",
    async (offset) => {
      const { connection, simulate } = mockConnection();
      const post = simulatedAccounts();
      const pool = Buffer.from(post[1]!.data[0], "base64");
      pool[offset] = pool[offset]! ^ 1;
      post[1]!.data[0] = pool.toString("base64");
      simulate.mockResolvedValue({
        context: { slot: 101 },
        value: { err: null, logs: [], unitsConsumed: 200000, accounts: post },
      });
      const result = await planLaunch(connection, input, { wallet, mint });
      expect(result.checks).toContainEqual(
        expect.objectContaining({ id: "6.pool", status: "NO-GO" }),
      );
    },
  );
  it("rejects send --simulate before RPC or signer access", async () => {
    const genesis = vi
      .spyOn(Connection.prototype, "getGenesisHash")
      .mockResolvedValue(GENESIS.devnet);
    const read = vi
      .spyOn(Connection.prototype, "getAccountInfo")
      .mockRejectedValue(new Error("must not read"));
    await expect(
      runLaunch([
        "send",
        "--cluster",
        "devnet",
        "--rpc",
        input.rpc,
        "--program",
        input.program,
        "--dbc-config",
        dbcConfig.toBase58(),
        "--wallet",
        "/does-not-exist/operator.json",
        "--mint-keypair",
        "/does-not-exist/mint.json",
        "--confirm",
        mint.toBase58().slice(0, 8),
        "--simulate",
      ]),
    ).rejects.toThrow("simulate_flag_requires_read_only_launch_command");
    expect(genesis).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("verifies genesis before reading a signer or any application account", async () => {
    const genesis = vi
      .spyOn(Connection.prototype, "getGenesisHash")
      .mockResolvedValue(GENESIS.mainnet);
    const read = vi
      .spyOn(Connection.prototype, "getAccountInfo")
      .mockRejectedValue(new Error("must not read"));
    await expect(
      runLaunch([
        "plan",
        "--cluster",
        "devnet",
        "--rpc",
        input.rpc,
        "--program",
        input.program,
        "--dbc-config",
        dbcConfig.toBase58(),
        "--wallet",
        "/does-not-exist/operator.json",
      ]),
    ).rejects.toThrow("launch_genesis_mismatch");
    expect(genesis).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    const rpc = new Connection("http://127.0.0.1:8899");
    await expect(
      requireLaunchCluster(rpc, {
        cluster: "localnet",
        rpc: "http://127.0.0.1:8899",
      }),
    ).rejects.toThrow("launch_genesis_mismatch");
  });
});

const attempt: LaunchAttempt = {
  form: "single",
  signatures: ["persisted-signature"],
  encodedTransactions: ["persisted-signed-bytes"],
  lastValidBlockHeight: 400,
};
const view = (value: AccountInfo<Buffer> | null) =>
  value && { ...value, lamports: BigInt(value.lamports) };

describe("launch observation and persisted broadcasts", () => {
  it("accepts a pre-funded System mint address through planning and sending", async () => {
    vi.mocked(readLaunchPolicy).mockReturnValue({
      landing: {
        cuMarginBps: 2000,
        tipLamports: 1000000n,
        maxComputeUnitPriceMicroLamports: 100n,
      },
      keeper: { sendMaxAttempts: 3, backoffBaseMs: 10 },
    });
    const { connection } = mockConnection();
    const prefunded = account(Buffer.alloc(0), SystemProgram.programId, 890880);
    vi.mocked(connection.getMultipleAccountsInfoAndContext).mockResolvedValue({
      context: { slot: 100 },
      value: [
        config(),
        machine(),
        prefunded,
        account(Buffer.alloc(0), SystemProgram.programId),
        account(Buffer.alloc(0), SystemProgram.programId, 4000000000),
        prefunded,
      ],
    });
    const plan = await planLaunch(connection, input, { wallet, mint });
    expect(plan.report.ok).toBe(true);
    expect(plan.checks).toContainEqual(
      expect.objectContaining({
        id: "3.config",
        status: "GO",
        value: expect.objectContaining({ prefundedLamports: "890880" }),
      }),
    );
    let landed = false;
    const submit = vi.fn(async () => {
      landed = true;
    });
    const result = await sendLaunch(
      {
        mint: mint.toBase58(),
        confirm: mint.toBase58().slice(0, 8),
        maxBuilds: 1,
        maxPasses: 2,
      },
      {
        chainNow: async () => 100,
        observe: async () =>
          observeLaunchState({
            mintAccount: landed ? view(splMint()) : view(prefunded),
            poolAccount: landed ? view(dbcPoolAccount()) : view(prefunded),
            machineAccount: view(machine(landed)),
            programId,
            mint,
          }),
        preflight: async () => {
          expect(plan.report.ok).toBe(true);
        },
        prepare: async () => attempt,
        persist: vi.fn(async () => {}),
        load: async () => null,
        send: submit,
        finalizedHeight: async () => 200,
        history: async () => ["absent"],
        sleep: async () => {},
        emit: vi.fn(),
      },
    );
    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledExactlyOnceWith(attempt);
  });
  it("keeps SPL Token and foreign mint accounts distinct", () => {
    const observe = (value: AccountInfo<Buffer>, powered = false) =>
      observeLaunchState({
        mintAccount: view(value),
        poolAccount: view(dbcPoolAccount()),
        machineAccount: view(machine(powered)),
        programId,
        mint,
      });
    const token = splMint();
    expect(observe(token)).toBe("mint-without-power-on");
    expect(observe(token, true)).toBe("powered-on");
    const onAir = machine(true);
    onAir.data[10] = 3;
    onAir.data[2344] = 1;
    expect(
      observeLaunchState({
        mintAccount: view(token),
        poolAccount: view(dbcPoolAccount()),
        machineAccount: view(onAir),
        programId,
        mint,
      }),
    ).toBe("powered-on");
    expect(observe(account(Buffer.alloc(0), key(88)))).toBe(
      "foreign-mint-account",
    );
    expect(observe(account(Buffer.from([1]), SystemProgram.programId))).toBe(
      "foreign-mint-account",
    );
    expect(
      observe({
        ...account(Buffer.alloc(0), SystemProgram.programId),
        executable: true,
      }),
    ).toBe("foreign-mint-account");
  });
  it("requires both mint and pool to be absent before rebuilding", () => {
    const observe = (
      mintAccount: AccountInfo<Buffer> | null,
      poolAccount: AccountInfo<Buffer> | null,
    ) =>
      observeLaunchState({
        mintAccount: view(mintAccount),
        poolAccount: view(poolAccount),
        machineAccount: view(machine()),
        programId,
        mint,
      });
    expect(observe(null, null)).toBe("absent");
    expect(observe(splMint(), null)).toBe("mint-without-power-on");
    expect(observe(null, dbcPoolAccount())).toBe("mint-without-power-on");
    expect(observe(null, account(Buffer.alloc(0), key(88)))).toBe(
      "foreign-pool-account",
    );
    expect(
      observe(splMint(), account(Buffer.from([1]), SystemProgram.programId)),
    ).toBe("foreign-pool-account");
  });
  function broadcastFixture() {
    const status = vi
      .fn<Connection["getSignatureStatuses"]>()
      .mockResolvedValue({ context: { slot: 100 }, value: [null] });
    const height = vi.fn<Connection["getBlockHeight"]>().mockResolvedValue(200);
    const deps = {
      submit: vi.fn<(encoded: string) => Promise<string>>(
        async () => attempt.signatures[0]!,
      ),
      assertCluster: vi.fn(async () => {}),
      sleep: vi.fn<(milliseconds: number) => Promise<void>>(async () => {}),
      emit: vi.fn(),
    };
    return {
      rpc: { getSignatureStatuses: status, getBlockHeight: height },
      status,
      height,
      deps,
    };
  }
  it("rebroadcasts the exact persisted bytes every two seconds until confirmed", async () => {
    const f = broadcastFixture();
    f.status
      .mockResolvedValueOnce({ context: { slot: 100 }, value: [null] })
      .mockResolvedValueOnce({ context: { slot: 101 }, value: [null] })
      .mockResolvedValueOnce({
        context: { slot: 102 },
        value: [
          {
            slot: 101,
            confirmations: 1,
            err: null,
            confirmationStatus: "confirmed",
          },
        ],
      });
    await rebroadcastLaunchAttempt(f.rpc, attempt, f.deps);
    expect(f.deps.submit.mock.calls).toEqual([
      [attempt.encodedTransactions[0]],
      [attempt.encodedTransactions[0]],
    ]);
    expect(f.deps.sleep.mock.calls).toEqual([[2000], [2000]]);
    expect(f.deps.assertCluster).toHaveBeenCalledTimes(2);
    expect(f.status).toHaveBeenCalledWith(attempt.signatures, {
      searchTransactionHistory: true,
    });
  });
  it("keeps broadcasting after an ambiguous transport response and stops at expiry", async () => {
    const f = broadcastFixture();
    f.deps.submit.mockRejectedValueOnce(new Error("transport timeout"));
    f.height
      .mockResolvedValueOnce(399)
      .mockResolvedValueOnce(400)
      .mockResolvedValueOnce(401);
    await rebroadcastLaunchAttempt(f.rpc, attempt, f.deps);
    expect(f.deps.submit.mock.calls).toEqual([
      [attempt.encodedTransactions[0]],
      [attempt.encodedTransactions[0]],
    ]);
    expect(f.deps.emit).toHaveBeenCalledWith({
      event: "launch_transport_ambiguous",
      signatures: attempt.signatures,
    });
  });
  it("never broadcasts an already expired or confirmed attempt", async () => {
    const f = broadcastFixture();
    f.height.mockResolvedValue(401);
    await rebroadcastLaunchAttempt(f.rpc, attempt, f.deps);
    expect(f.deps.submit).not.toHaveBeenCalled();
    f.status.mockResolvedValue({
      context: { slot: 102 },
      value: [
        {
          slot: 101,
          confirmations: null,
          err: null,
          confirmationStatus: "finalized",
        },
      ],
    });
    await rebroadcastLaunchAttempt(f.rpc, attempt, f.deps);
    expect(f.deps.submit).not.toHaveBeenCalled();
  });
});
