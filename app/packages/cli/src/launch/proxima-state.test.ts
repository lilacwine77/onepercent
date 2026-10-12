import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { ACCOUNT_SIZES, PROGRAM_IDS, TOKEN_1PCT } from "@onepercent/config";
import {
  createDeploymentSelector,
  DBC_PROGRAM_ID,
  encodeDbcConfigFixture,
  launchAddresses,
  proximaDepositInstructions,
} from "@onepercent/sdk";
import { checkProximaState, type ProximaState } from "./proxima-state.js";
import type { AccountSnapshot } from "./checks.js";
import { parseLaunchInput } from "./input.js";
import { executeProxima } from "./proxima.js";
import { OpsError } from "../input.js";

const key = (n: number) => new PublicKey(Buffer.alloc(32, n));
const signer = Keypair.generate();
const identity = {
  wallet: signer.publicKey,
  mint: key(6),
  deployment: createDeploymentSelector({ localnet: key(7) })("localnet"),
};
const a = launchAddresses(identity);
const dbcBytes = await encodeDbcConfigFixture(a.feeIn);
const token = new PublicKey(PROGRAM_IDS.splToken);
const snap = (data: Buffer, owner = a.programId): AccountSnapshot => ({
  data,
  owner,
  lamports: 1n,
  executable: false,
});
const data = (account: AccountSnapshot) => account.data as Buffer;
function account(name: string, length: number) {
  const value = Buffer.alloc(length);
  createHash("sha256")
    .update(`account:${name}`)
    .digest()
    .subarray(0, 8)
    .copy(value);
  return snap(value);
}
function tokenAccount(amount: bigint, owner: PublicKey) {
  const value = Buffer.alloc(165);
  identity.mint.toBuffer().copy(value, 0);
  owner.toBuffer().copy(value, 32);
  value.writeBigUInt64LE(amount, 64);
  value[108] = 1;
  return snap(value, token);
}
function state(
  stage: "setup" | "external" | "deposit" | "powered" = "external",
): ProximaState {
  const config = account("Config", 872),
    machine = account("Machine", 3808);
  const c = data(config),
    m = data(machine);
  c[736] = 1;
  c[739] = 1;
  key(9).toBuffer().copy(c, 8);
  identity.wallet.toBuffer().copy(c, 232);
  identity.mint.toBuffer().copy(c, 552);
  m[8] = 1;
  m[10] = stage === "setup" ? 0 : stage === "powered" ? 2 : 1;
  const mint = snap(Buffer.alloc(82), token);
  data(mint)[44] = TOKEN_1PCT.decimals;
  data(mint)[45] = 1;
  data(mint).writeBigUInt64LE(TOKEN_1PCT.totalSupply, 36);
  const pool = account("VirtualPool", 424);
  pool.owner = DBC_PROGRAM_ID;
  a.dbcConfig.toBuffer().copy(data(pool), 72);
  identity.wallet.toBuffer().copy(data(pool), 104);
  identity.mint.toBuffer().copy(data(pool), 136);
  const deposited = stage === "deposit" || stage === "powered";
  const launchAta = tokenAccount(
    deposited ? 0n : TOKEN_1PCT.devBuyAmount,
    identity.wallet,
  );
  let ledger = null;
  if (stage === "powered") {
    ledger = account("MintLedger", ACCOUNT_SIZES.mintLedger);
    identity.mint.toBuffer().copy(data(ledger), 8);
    identity.wallet.toBuffer().copy(data(ledger), 40);
    data(ledger).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 72);
    identity.mint.toBuffer().copy(m, 2608);
    m.writeBigInt64LE(1n, 40);
  }
  return {
    config,
    machine,
    mint: stage === "setup" ? null : mint,
    pool: stage === "setup" ? null : pool,
    dbc: snap(Buffer.from(dbcBytes), DBC_PROGRAM_ID),
    ledger,
    vault: deposited
      ? tokenAccount(TOKEN_1PCT.devBuyAmount, a.vaultAuth)
      : null,
    launchAta,
    launchTokens: [launchAta],
    now: 10n,
  };
}
describe("Proxima D32 state transitions", () => {
  it("registers a public mint during Setup before permissionless StockUp", () => {
    const s = state("setup");
    key(10).toBuffer().copy(data(s.config!), 552);
    expect(checkProximaState(identity, s).stage).toBe("set-mint");
    identity.mint.toBuffer().copy(data(s.config!), 552);
    expect(checkProximaState(identity, s)).toMatchObject({
      stage: "stock-up",
      seasonReady: true,
    });
    data(s.machine!)[10] = 1;
    expect(checkProximaState(identity, s).stage).toBe("awaiting-proxima");
  });
  it("accepts an externally created canonical pool and separates deposit and Power-On", () => {
    expect(checkProximaState(identity, state()).stage).toBe("deposit");
    expect(checkProximaState(identity, state("deposit")).stage).toBe(
      "power-on",
    );
    expect(checkProximaState(identity, state("powered")).stage).toBe(
      "powered-on",
    );
  });
  it.each([
    ["external", "deposit"],
    ["deposit", "power-on"],
    ["powered", "powered-on"],
  ] as const)("accepts an external one-unit burn at %s", (stage, expected) => {
    const s = state(stage);
    data(s.mint!).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
    expect(checkProximaState(identity, s).stage).toBe(expected);
  });
  it.each([
    ["external", "deposit"],
    ["deposit", "power-on"],
    ["powered", "powered-on"],
  ] as const)(
    "accepts one-unit donations to the ATA or another token account at %s",
    (stage, expected) => {
      for (const destination of ["ata", "other"] as const) {
        const s = state(stage);
        const before = stage === "external" ? TOKEN_1PCT.devBuyAmount : 0n;
        if (destination === "ata")
          data(s.launchAta!).writeBigUInt64LE(before + 1n, 64);
        else
          s.launchTokens = [
            ...s.launchTokens,
            tokenAccount(1n, identity.wallet),
          ];
        expect(checkProximaState(identity, s)).toMatchObject({
          stage: expected,
          walletAmount: (before + 1n).toString(),
        });
      }
    },
  );
  it.each(["deposit", "powered"] as const)(
    "does not request another deposit after a large wallet donation at %s",
    (stage) => {
      const s = state(stage);
      data(s.launchAta!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount + 1n, 64);
      expect(checkProximaState(identity, s).stage).toBe(
        stage === "deposit" ? "power-on" : "powered-on",
      );
    },
  );
  it.each([
    [
      "wrong config",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.pool!), 72),
    ],
    [
      "wrong mint",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.pool!), 136),
    ],
    [
      "wrong creator",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.pool!), 104),
    ],
    [
      "wrong FeeIn",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.dbc!), 40),
    ],
    [
      "unproven initial supply",
      (s: ProximaState) =>
        data(s.dbc!).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 344),
    ],
    [
      "changed post-migration supply",
      (s: ProximaState) =>
        data(s.dbc!).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 352),
    ],
    [
      "mutable metadata configuration",
      (s: ProximaState) => {
        data(s.dbc!)[246] = 0;
      },
    ],
    [
      "foreign pool owner",
      (s: ProximaState) => {
        s.pool!.owner = token;
      },
    ],
    [
      "short dev buy",
      (s: ProximaState) =>
        data(s.launchAta!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount - 1n, 64),
    ],
    [
      "inflated current supply",
      (s: ProximaState) =>
        data(s.mint!).writeBigUInt64LE(TOKEN_1PCT.totalSupply + 1n, 36),
    ],
    [
      "mint authority retained",
      (s: ProximaState) => data(s.mint!).writeUInt32LE(1, 0),
    ],
    [
      "freeze authority retained",
      (s: ProximaState) => data(s.mint!).writeUInt32LE(1, 46),
    ],
    [
      "dev buy outside the ATA",
      (s: ProximaState) => {
        data(s.launchAta!).writeBigUInt64LE(0n, 64);
        s.launchTokens = [
          s.launchAta!,
          tokenAccount(TOKEN_1PCT.devBuyAmount, identity.wallet),
        ];
      },
    ],
    [
      "wrong registered mint",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.config!), 552),
    ],
  ] as const)("refuses %s", (_, mutate) => {
    const s = state();
    data(s.mint!).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
    mutate(s);
    expect(() => checkProximaState(identity, s)).toThrow();
  });
  it.each([
    [
      "wrong machine mint",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.machine!), 2608),
    ],
    [
      "missing Power-On time",
      (s: ProximaState) => data(s.machine!).writeBigInt64LE(0n, 40),
    ],
    [
      "wrong ledger mint",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.ledger!), 8),
    ],
    [
      "wrong ledger payer",
      (s: ProximaState) => key(11).toBuffer().copy(data(s.ledger!), 40),
    ],
    [
      "incorrect accounting",
      (s: ProximaState) =>
        data(s.ledger!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount + 1n, 72),
    ],
    [
      "short vault",
      (s: ProximaState) =>
        data(s.vault!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount - 1n, 64),
    ],
  ] as const)(
    "still refuses %s after Power-On with wallet surplus",
    (_, mutate) => {
      const s = state("powered");
      data(s.mint!).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
      data(s.launchAta!).writeBigUInt64LE(1n, 64);
      mutate(s);
      expect(() => checkProximaState(identity, s)).toThrow();
    },
  );
  it("refuses a partial deposit and an already-accounted ledger", () => {
    for (const amount of [TOKEN_1PCT.devBuyAmount - 1n]) {
      const s = state("deposit");
      data(s.vault!).writeBigUInt64LE(amount, 64);
      expect(() => checkProximaState(identity, s)).toThrow(
        "proxima_dev_buy_amount_or_account",
      );
    }
    const s = state("powered");
    data(s.machine!)[10] = 1;
    expect(() => checkProximaState(identity, s)).toThrow(
      "proxima_already_accounted",
    );
  });
  it("keeps donated excess unaccounted before and after the exact deposit", () => {
    const before = state();
    before.vault = tokenAccount(3n, a.vaultAuth);
    expect(checkProximaState(identity, before)).toMatchObject({
      stage: "deposit",
      unaccountedSurplus: "3",
    });
    const after = state("deposit");
    data(after.vault!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount + 3n, 64);
    expect(checkProximaState(identity, after)).toMatchObject({
      stage: "power-on",
      unaccountedSurplus: "3",
    });
    const powered = state("powered");
    data(powered.vault!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount + 3n, 64);
    expect(checkProximaState(identity, powered)).toMatchObject({
      stage: "powered-on",
      accounted: TOKEN_1PCT.devBuyAmount.toString(),
      unaccountedSurplus: "3",
    });
  });
  it("accepts an already-funded vault without relying on the wallet balance", () => {
    const s = state();
    s.vault = tokenAccount(TOKEN_1PCT.devBuyAmount + 3n, a.vaultAuth);
    expect(checkProximaState(identity, s)).toMatchObject({
      stage: "power-on",
      accounted: "0",
      unaccountedSurplus: "3",
      walletAmount: TOKEN_1PCT.devBuyAmount.toString(),
    });
  });
  it("builds only ATA creation and exact transfer; Power-On remains separate", () => {
    const instructions = proximaDepositInstructions(identity);
    expect(instructions).toHaveLength(2);
    expect(instructions[1]!.data.readBigUInt64LE(1)).toBe(
      TOKEN_1PCT.devBuyAmount,
    );
    expect(instructions[1]!.keys[3]).toMatchObject({
      pubkey: identity.wallet,
      isSigner: true,
    });
    expect(instructions.every((ix) => !ix.programId.equals(a.programId))).toBe(
      true,
    );
  });
  it("blocks the atomic mainnet sender and never needs a vanity secret", () => {
    const args = [
      "--cluster",
      "mainnet",
      "--rpc",
      "https://example.com",
      "--program",
      a.programId.toBase58(),
      "--mainnet-program",
      a.programId.toBase58(),
      "--dbc-config",
      a.dbcConfig.toBase58(),
    ];
    expect(() => parseLaunchInput(["send", ...args])).toThrow(
      "mainnet_requires_proxima_launch",
    );
    expect(
      parseLaunchInput([
        "set-mint",
        ...args,
        "--mint",
        identity.mint.toBase58(),
        "--wallet",
        "/outside/deployer.json",
        "--confirm",
        identity.mint.toBase58().slice(0, 8),
      ]).mintKeypair,
    ).toBeUndefined();
  });
  it("persists exact signed bytes before submission and refuses a modified resume journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onepct-proxima-test-"));
    try {
      const current = state();
      data(current.mint!).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
      data(current.launchAta!).writeBigUInt64LE(
        TOKEN_1PCT.devBuyAmount + 1n,
        64,
      );
      const otherDonation = tokenAccount(1n, identity.wallet);
      current.launchTokens = [...current.launchTokens, otherDonation];
      const info = (value: AccountSnapshot | null) =>
        value
          ? {
              ...value,
              data: Buffer.from(value.data),
              lamports: Number(value.lamports),
              rentEpoch: 0,
            }
          : null;
      const clock = Buffer.alloc(40);
      clock.writeBigInt64LE(10n, 32);
      const rpc = {
        getAccountInfo: vi.fn(async () => info(current.config)),
        getMultipleAccountsInfoAndContext: vi.fn(async () => ({
          context: { slot: 100 },
          value: [
            current.config,
            current.machine,
            current.mint,
            current.pool,
            current.dbc,
            current.vault,
            current.ledger,
            current.launchAta,
            snap(clock, SystemProgram.programId),
          ].map(info),
        })),
        getTokenAccountsByOwner: vi.fn(async () => ({
          context: { slot: 100 },
          value: current.launchTokens.map((value) => ({
            pubkey: a.launchAta,
            account: info(value),
          })),
        })),
        getRecentPrioritizationFees: vi.fn(async () => []),
        getLatestBlockhash: vi.fn(async () => ({
          blockhash: key(77).toBase58(),
          lastValidBlockHeight: 200,
        })),
        simulateTransaction: vi.fn(async () => ({
          value: { err: null, unitsConsumed: 1000 },
        })),
        getGenesisHash: vi.fn(async () => "local-validator"),
        getSignatureStatuses: vi.fn(async () => ({ value: [null] })),
        getBlockHeight: vi.fn(async () => 100),
        sendRawTransaction: vi
          .fn<(bytes: Buffer) => Promise<string>>()
          .mockRejectedValue(new OpsError("test_transport_interrupted")),
      };
      const input = {
        command: "deposit" as const,
        cluster: "localnet" as const,
        rpc: "http://127.0.0.1:8899",
        program: a.programId.toBase58(),
        dbcConfig: a.dbcConfig.toBase58(),
        mint: identity.mint.toBase58(),
        confirm: identity.mint.toBase58().slice(0, 8),
        acceptWarnings: false,
      };
      const options = {
        directory,
        emit: () => undefined,
        localPolicy: {
          landing: {
            cuMarginBps: 1000,
            tipLamports: 0n,
            maxComputeUnitPriceMicroLamports: 100n,
          },
          keeper: { sendMaxAttempts: 1, backoffBaseMs: 1 },
        },
      };
      const run = () =>
        executeProxima(input, rpc as unknown as Connection, signer, options);
      await expect(run()).rejects.toThrow("test_transport_interrupted");
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      const path = join(directory, files[0]!);
      const record = JSON.parse(await readFile(path, "utf8")) as {
        encoded: string;
        signature: string;
      };
      expect(Buffer.from(record.encoded, "base64")).toEqual(
        rpc.sendRawTransaction.mock.calls[0]![0],
      );
      const signed = VersionedTransaction.deserialize(
        Buffer.from(record.encoded, "base64"),
      );
      const transfers = signed.message.compiledInstructions.filter((ix) =>
        signed.message.staticAccountKeys[ix.programIdIndex]!.equals(token),
      );
      expect(transfers).toHaveLength(1);
      const transfer = transfers[0]!;
      expect(transfer.data[0]).toBe(12);
      expect(Buffer.from(transfer.data).readBigUInt64LE(1)).toBe(
        TOKEN_1PCT.devBuyAmount,
      );
      expect(
        transfer.accountKeyIndexes.map(
          (index) => signed.message.staticAccountKeys[index],
        ),
      ).toEqual([a.launchAta, identity.mint, a.vault, identity.wallet]);
      expect(rpc.getMultipleAccountsInfoAndContext).toHaveBeenCalledWith(
        expect.any(Array),
        { commitment: "finalized", minContextSlot: 100 },
      );
      await expect(run()).rejects.toThrow("test_transport_interrupted");
      expect(rpc.simulateTransaction).toHaveBeenCalledTimes(2);
      expect(rpc.sendRawTransaction.mock.calls[1]![0]).toEqual(
        rpc.sendRawTransaction.mock.calls[0]![0],
      );
      record.signature = "invalid";
      await writeFile(path, JSON.stringify(record));
      await expect(run()).rejects.toThrow("proxima_journal_invalid");
      expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
      current.vault = tokenAccount(TOKEN_1PCT.devBuyAmount + 3n, a.vaultAuth);
      current.launchAta = tokenAccount(1n, identity.wallet);
      current.launchTokens = [current.launchAta, otherDonation];
      await expect(run()).resolves.toMatchObject({
        reconciled: true,
        stage: "power-on",
        unaccountedSurplus: "3",
        walletAmount: "2",
      });
      data(current.launchAta).writeBigUInt64LE(
        TOKEN_1PCT.devBuyAmount + 1n,
        64,
      );
      await expect(run()).resolves.toMatchObject({
        reconciled: true,
        stage: "power-on",
        walletAmount: (TOKEN_1PCT.devBuyAmount + 2n).toString(),
      });
      expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
