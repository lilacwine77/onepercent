import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
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
} from "@onepercent/sdk";
import type { AccountSnapshot } from "./checks.js";
import type { ProximaState } from "./proxima-state.js";
import { executeProxima } from "./proxima.js";

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(async () => undefined),
}));

const key = (n: number) => new PublicKey(Buffer.alloc(32, n));
const token = new PublicKey(PROGRAM_IDS.splToken);
const bytes = (value: AccountSnapshot) => value.data as Buffer;
const discriminator = (name: string) =>
  createHash("sha256").update(name).digest().subarray(0, 8);

async function transferFixture(setup = false) {
  const founder = Keypair.generate();
  const friend = Keypair.generate();
  const identity = {
    wallet: founder.publicKey,
    mint: key(6),
    deployment: createDeploymentSelector({ localnet: key(7) })("localnet"),
  };
  const a = launchAddresses(identity);
  const snapshot = (data: Buffer, owner = a.programId): AccountSnapshot => ({
    data,
    owner,
    lamports: 1n,
    executable: false,
  });
  const account = (name: string, length: number) => {
    const data = Buffer.alloc(length);
    discriminator(`account:${name}`).copy(data);
    return snapshot(data);
  };
  const tokenAccount = (amount: bigint, owner: PublicKey) => {
    const data = Buffer.alloc(165);
    identity.mint.toBuffer().copy(data);
    owner.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    data[108] = 1;
    return snapshot(data, token);
  };
  const config = account("Config", 872);
  bytes(config)[736] = 1;
  bytes(config)[739] = 1;
  founder.publicKey.toBuffer().copy(bytes(config), 8);
  founder.publicKey.toBuffer().copy(bytes(config), 232);
  (setup ? a.programId : identity.mint).toBuffer().copy(bytes(config), 552);
  bytes(config).writeBigInt64LE(setup ? 20n : 0n, 728);
  const machine = account("Machine", 3808);
  bytes(machine)[8] = 1;
  bytes(machine)[10] = setup ? 0 : 1;
  const mint = snapshot(Buffer.alloc(82), token);
  bytes(mint)[44] = TOKEN_1PCT.decimals;
  bytes(mint)[45] = 1;
  bytes(mint).writeBigUInt64LE(TOKEN_1PCT.totalSupply - 1n, 36);
  const pool = account("VirtualPool", 424);
  pool.owner = DBC_PROGRAM_ID;
  a.dbcConfig.toBuffer().copy(bytes(pool), 72);
  friend.publicKey.toBuffer().copy(bytes(pool), 104);
  identity.mint.toBuffer().copy(bytes(pool), 136);
  const launchAta = tokenAccount(0n, founder.publicKey);
  const current: ProximaState = {
    config,
    machine,
    mint,
    pool,
    dbc: snapshot(await encodeDbcConfigFixture(a.feeIn), DBC_PROGRAM_ID),
    launchAta,
    launchTokens: [launchAta],
    vault: tokenAccount(3n, a.vaultAuth),
    ledger: null,
    now: 10n,
  };
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
  const finalized = new Set<string>();
  const submitted: VersionedTransaction[] = [];
  let pendingSignature = "";
  const rpc = {
    getAccountInfo: vi.fn(async () => info(current.config)),
    getMultipleAccountsInfoAndContext: vi.fn(
      async (
        ...args: Parameters<Connection["getMultipleAccountsInfoAndContext"]>
      ) => {
        expect(args[0][3]).toEqual(a.launchPool);
        clock.writeBigInt64LE(current.now, 32);
        return {
          context: { slot: 100 + submitted.length },
          value: [
            current.config,
            current.machine,
            current.mint,
            current.pool,
            current.dbc,
            current.vault,
            current.ledger,
            current.launchAta,
            snapshot(clock, SystemProgram.programId),
          ].map(info),
        };
      },
    ),
    getTokenAccountsByOwner: vi.fn(async () => ({
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
    getSignatureStatuses: vi.fn(async (signatures: string[]) => ({
      value: signatures.map((signature) =>
        finalized.has(signature)
          ? {
              err: null,
              confirmationStatus: "finalized",
              slot: 100 + submitted.length,
            }
          : null,
      ),
    })),
    getBlockHeight: vi.fn(async () => 100),
    sendRawTransaction: vi.fn(async (encoded: Buffer) => {
      const tx = VersionedTransaction.deserialize(encoded);
      submitted.push(tx);
      const programInstruction = tx.message.compiledInstructions.find((ix) =>
        tx.message.staticAccountKeys[ix.programIdIndex]!.equals(a.programId),
      );
      const action = programInstruction
        ? Buffer.from(programInstruction.data).subarray(0, 8)
        : null;
      if (action?.equals(discriminator("global:admin_config"))) {
        identity.mint.toBuffer().copy(bytes(config), 552);
      } else if (action?.equals(discriminator("global:advance_phase"))) {
        bytes(machine)[10] = 1;
      } else if (!programInstruction) {
        bytes(launchAta).writeBigUInt64LE(0n, 64);
        bytes(current.vault!).writeBigUInt64LE(
          TOKEN_1PCT.devBuyAmount + 3n,
          64,
        );
      } else if (action?.equals(discriminator("global:power_on"))) {
        bytes(machine)[10] = 2;
        bytes(machine).writeBigInt64LE(1n, 40);
        identity.mint.toBuffer().copy(bytes(machine), 2608);
        current.ledger = account("MintLedger", ACCOUNT_SIZES.mintLedger);
        identity.mint.toBuffer().copy(bytes(current.ledger), 8);
        founder.publicKey.toBuffer().copy(bytes(current.ledger), 40);
        bytes(current.ledger).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 72);
      } else throw new Error("unexpected_program_instruction");
      finalized.add(pendingSignature);
      return pendingSignature;
    }),
  };
  const run = (
    command: "verify" | "set-mint" | "stock-up" | "deposit" | "power-on",
    directory: string,
    signer: Keypair | null = command === "verify" ? null : founder,
  ) =>
    executeProxima(
      {
        command,
        flow: "proxima",
        cluster: "localnet",
        rpc: "http://127.0.0.1:8899",
        program: a.programId.toBase58(),
        dbcConfig: a.dbcConfig.toBase58(),
        mint: identity.mint.toBase58(),
        poolCreator: friend.publicKey.toBase58(),
        ...(command === "verify"
          ? {}
          : { confirm: identity.mint.toBase58().slice(0, 8) }),
        acceptWarnings: false,
      },
      rpc as unknown as Connection,
      signer,
      {
        directory,
        emit: (record) => {
          if (record.event === "proxima_signed")
            pendingSignature = String(record.signature);
        },
        ...(command === "verify"
          ? {}
          : {
              localPolicy: {
                landing: {
                  cuMarginBps: 1000,
                  tipLamports: 0n,
                  maxComputeUnitPriceMicroLamports: 100n,
                },
                keeper: { sendMaxAttempts: 1, backoffBaseMs: 1 },
              },
            }),
      },
    );
  return { founder, friend, identity, a, current, rpc, submitted, run };
}

it("verifies a friend launch during Setup without a signer, then sets its mint before Stock-Up", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "onepct-setup-transfer-test-"),
  );
  try {
    const f = await transferFixture(true);
    bytes(f.current.launchAta!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 64);
    expect(bytes(f.current.config!).subarray(552, 584)).toEqual(
      f.a.programId.toBuffer(),
    );
    await expect(f.run("verify", directory)).resolves.toMatchObject({
      ok: true,
      launchVerified: true,
      stage: "set-mint",
      mint: f.identity.mint.toBase58(),
      poolCreator: f.friend.publicKey.toBase58(),
      pool: f.a.launchPool.toBase58(),
      dbcConfig: f.a.dbcConfig.toBase58(),
      feeClaimer: f.a.feeIn.toBase58(),
      seasonReady: false,
      stockUpTs: "20",
    });
    expect(await readdir(directory)).toEqual([]);
    expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(f.rpc.getRecentPrioritizationFees).not.toHaveBeenCalled();
    expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(
      f.rpc.getMultipleAccountsInfoAndContext.mock.calls[0]?.[0],
    ).toContainEqual(f.a.launchPool);

    await expect(f.run("set-mint", directory, f.friend)).rejects.toThrow(
      "proxima_admin_required",
    );
    await expect(f.run("set-mint", directory)).resolves.toMatchObject({
      ok: true,
      launchVerified: true,
      stage: "stock-up",
      signature: expect.any(String),
    });
    expect(bytes(f.current.machine!)[10]).toBe(0);
    expect(bytes(f.current.config!).subarray(552, 584)).toEqual(
      f.identity.mint.toBuffer(),
    );
    await expect(f.run("verify", directory)).resolves.toMatchObject({
      launchVerified: true,
      stage: "stock-up",
    });
    await expect(f.run("stock-up", directory)).rejects.toThrow(
      "proxima_season_not_ready",
    );
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);

    f.current.now = 20n;
    await expect(f.run("stock-up", directory)).resolves.toMatchObject({
      stage: "deposit",
      signature: expect.any(String),
    });
    await expect(f.run("set-mint", directory)).rejects.toThrow(
      "proxima_set_mint_requires_setup",
    );
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    await expect(f.run("deposit", directory)).resolves.toMatchObject({
      stage: "power-on",
      walletAmount: "0",
      vaultAmount: (TOKEN_1PCT.devBuyAmount + 3n).toString(),
      unaccountedSurplus: "3",
      signature: expect.any(String),
    });
    await expect(f.run("power-on", directory)).resolves.toMatchObject({
      stage: "powered-on",
      accounted: TOKEN_1PCT.devBuyAmount.toString(),
      unaccountedSurplus: "3",
      signature: expect.any(String),
    });
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(4);
    for (const tx of f.submitted) {
      expect(tx.message.header.numRequiredSignatures).toBe(1);
      expect(tx.message.staticAccountKeys[0]).toEqual(f.founder.publicKey);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  [
    "a third-party creator using our DBC config",
    104,
    "proxima_pool_creator_mismatch",
  ],
  ["a friend launch using another DBC config", 72, "pool_config"],
] as const)(
  "refuses %s before registering its mint",
  async (_, offset, code) => {
    const directory = await mkdtemp(
      join(tmpdir(), "onepct-untrusted-launch-test-"),
    );
    try {
      const f = await transferFixture(true);
      key(83).toBuffer().copy(bytes(f.current.pool!), offset);
      await expect(f.run("verify", directory)).resolves.toMatchObject({
        ok: false,
        checks: [{ id: "proxima.state", status: "NO-GO", detail: code }],
      });
      await expect(f.run("set-mint", directory)).rejects.toThrow(code);
      expect(await readdir(directory)).toEqual([]);
      expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("requires the friend launch to exist before verifying or registering its mint", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "onepct-missing-launch-test-"),
  );
  try {
    const f = await transferFixture(true);
    f.current.mint = null;
    f.current.pool = null;
    await expect(f.run("verify", directory)).resolves.toMatchObject({
      ok: false,
      checks: [
        {
          id: "proxima.state",
          status: "NO-GO",
          detail: "proxima_launch_not_created",
        },
      ],
    });
    await expect(f.run("set-mint", directory)).rejects.toThrow(
      "proxima_launch_not_created",
    );
    expect(await readdir(directory)).toEqual([]);
    expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses set-mint after Stock-Up even when the same mint is already registered", async () => {
  const directory = await mkdtemp(join(tmpdir(), "onepct-late-mint-test-"));
  try {
    const f = await transferFixture();
    bytes(f.current.launchAta!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 64);
    await expect(f.run("set-mint", directory)).rejects.toThrow(
      "proxima_set_mint_requires_setup",
    );
    expect(await readdir(directory)).toEqual([]);
    expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses to sign set-mint if Setup ends while its transaction is simulated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "onepct-mint-phase-test-"));
  try {
    const f = await transferFixture(true);
    f.rpc.simulateTransaction.mockImplementationOnce(async () => {
      bytes(f.current.machine!)[10] = 1;
      return { value: { err: null, unitsConsumed: 1000 } };
    });
    await expect(f.run("set-mint", directory)).rejects.toThrow(
      "proxima_set_mint_requires_setup",
    );
    expect(f.rpc.simulateTransaction).toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses to replay a saved set-mint if Setup ends before submission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "onepct-mint-replay-test-"));
  try {
    const f = await transferFixture(true);
    f.rpc.getSignatureStatuses.mockRejectedValueOnce(
      new Error("rpc_unavailable"),
    );
    await expect(f.run("set-mint", directory)).rejects.toThrow(
      "rpc_unavailable",
    );
    expect(f.rpc.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([
      expect.stringMatching(/^proxima-.*-set-mint\.json$/),
    ]);

    f.rpc.getGenesisHash.mockImplementationOnce(async () => {
      bytes(f.current.machine!)[10] = 1;
      return "local-validator";
    });
    await expect(f.run("set-mint", directory)).rejects.toThrow(
      "proxima_set_mint_requires_setup",
    );
    expect(f.rpc.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("deposits the received 40M and powers on with the founder signature after a friend launch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "onepct-transfer-test-"));
  try {
    const f = await transferFixture();
    await expect(f.run("deposit", directory)).rejects.toThrow(
      "proxima_dev_buy_amount_or_account",
    );
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();

    bytes(f.current.launchAta!).writeBigUInt64LE(TOKEN_1PCT.devBuyAmount, 64);
    await expect(f.run("deposit", directory, f.friend)).rejects.toThrow(
      "proxima_launch_wallet_required",
    );
    await expect(f.run("deposit", directory)).resolves.toMatchObject({
      stage: "power-on",
      poolCreator: f.friend.publicKey.toBase58(),
      walletAmount: "0",
      vaultAmount: (TOKEN_1PCT.devBuyAmount + 3n).toString(),
      unaccountedSurplus: "3",
      signature: expect.any(String),
    });
    const deposit = f.submitted[0]!;
    const transfers = deposit.message.compiledInstructions.filter((ix) =>
      deposit.message.staticAccountKeys[ix.programIdIndex]!.equals(token),
    );
    expect(transfers).toHaveLength(1);
    const transfer = transfers[0]!;
    expect(transfer.data[0]).toBe(12);
    expect(Buffer.from(transfer.data).readBigUInt64LE(1)).toBe(
      TOKEN_1PCT.devBuyAmount,
    );
    expect(
      transfer.accountKeyIndexes.map(
        (i) => deposit.message.staticAccountKeys[i],
      ),
    ).toEqual([f.a.launchAta, f.identity.mint, f.a.vault, f.founder.publicKey]);

    await expect(f.run("power-on", directory, f.friend)).rejects.toThrow(
      "proxima_launch_wallet_required",
    );
    await expect(f.run("power-on", directory)).resolves.toMatchObject({
      stage: "powered-on",
      accounted: TOKEN_1PCT.devBuyAmount.toString(),
      unaccountedSurplus: "3",
      signature: expect.any(String),
    });
    const powered = f.submitted[1]!;
    const instructions = powered.message.compiledInstructions.filter((ix) =>
      powered.message.staticAccountKeys[ix.programIdIndex]!.equals(
        f.a.programId,
      ),
    );
    expect(instructions).toHaveLength(1);
    expect(Buffer.from(instructions[0]!.data)).toEqual(
      discriminator("global:power_on"),
    );
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    const founderPublicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        f.founder.publicKey.toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    for (const tx of f.submitted) {
      expect(tx.message.header.numRequiredSignatures).toBe(1);
      expect(tx.message.staticAccountKeys[0]).toEqual(f.founder.publicKey);
      expect(
        verify(
          null,
          tx.message.serialize(),
          founderPublicKey,
          tx.signatures[0]!,
        ),
      ).toBe(true);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
