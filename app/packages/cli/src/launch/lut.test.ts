import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as namespace from "@anchor-lang/core";
import { GOVERNANCE, TX_LIMITS, meteoraForCluster } from "@onepercent/config";
import {
  createDeploymentSelector,
  DBC_PROGRAM_ID,
  encodeDbcConfigFixture,
} from "@onepercent/sdk";
import {
  AddressLookupTableInstruction,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AccountInfo, Connection } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLaunchLookupTable, planLaunchLookupTableSteps } from "./lut.js";
import type { LaunchInput } from "./input.js";
import * as launchInput from "./input.js";
import { GENESIS } from "../runtime.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
const key = (index: number) => {
  const data = Buffer.alloc(32);
  data.writeUInt32LE(index);
  data[31] = 71;
  return new PublicKey(data);
};
const account = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({
  data,
  owner,
  lamports: 1,
  executable: false,
  rentEpoch: 0,
});
const discriminator = (name: string, length: number) => {
  const data = Buffer.alloc(length);
  data.set(
    createHash("sha256").update(`account:${name}`).digest().subarray(0, 8),
  );
  return data;
};
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "launch-lut-tests-"));
  folders.push(directory);
  const wallet = Keypair.generate();
  const launchWallet = key(777),
    mint = key(778),
    programId = key(52);
  const config = discriminator("Config", 872);
  config[736] = 1;
  config.set(launchWallet.toBuffer(), 232);
  config.set(mint.toBuffer(), 552);
  config.set(wallet.publicKey.toBuffer(), 296);
  const configAccount = account(config, programId);
  const dbcConfig = new PublicKey(meteoraForCluster("devnet").dbcConfig);
  const dbcData = await encodeDbcConfigFixture(
    PublicKey.findProgramAddressSync([Buffer.from("fee_in")], programId)[0],
  );
  let slot = 100;
  let table: {
    key: PublicKey;
    addresses: PublicKey[];
    authority?: PublicKey;
    extendedSlot: number;
  } | null = null;
  let failSend = false;
  let balance: bigint = GOVERNANCE.opsWalletMaxLamports;
  const events: Record<string, unknown>[] = [];
  const finalized = new Set<string>();
  const rpc = {
    getGenesisHash: vi.fn(async (): Promise<string> => GENESIS.devnet),
    getAccountInfo: vi.fn(async (address: PublicKey) =>
      address.equals(dbcConfig)
        ? account(dbcData, DBC_PROGRAM_ID)
        : address.equals(
              PublicKey.findProgramAddressSync(
                [Buffer.from("config")],
                programId,
              )[0],
            )
          ? configAccount
          : {
              ...account(Buffer.alloc(0), SystemProgram.programId),
              lamports: Number(balance),
            },
    ),
    getSlot: vi.fn(async () => slot),
    getAccountInfoAndContext: vi.fn(async () => {
      if (!table) return { context: { slot }, value: null };
      const data = Buffer.alloc(56 + table.addresses.length * 32);
      data.writeUInt32LE(1);
      data.writeBigUInt64LE((1n << 64n) - 1n, 4);
      data.writeBigUInt64LE(BigInt(table.extendedSlot), 12);
      data[21] = table.authority ? 1 : 0;
      table.authority?.toBuffer().copy(data, 22);
      table.addresses.forEach((address, index) =>
        address.toBuffer().copy(data, 56 + index * 32),
      );
      return {
        context: { slot },
        value: account(data, AddressLookupTableProgram.programId),
      };
    }),
    getRecentPrioritizationFees: vi.fn(async () => [
      { slot, prioritizationFee: 10 },
    ]),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: key(slot).toBase58(),
      lastValidBlockHeight: 500,
    })),
    simulateTransaction: vi.fn(async () => ({
      context: { slot },
      value: { err: null },
    })),
    sendRawTransaction: vi.fn(async (bytes: Uint8Array) => {
      if (failSend) throw new Error("timeout");
      const tx = VersionedTransaction.deserialize(bytes);
      for (const compiled of tx.message.compiledInstructions) {
        const instruction = new TransactionInstruction({
          programId: tx.message.staticAccountKeys[compiled.programIdIndex]!,
          keys: compiled.accountKeyIndexes.map((index) => ({
            pubkey: tx.message.staticAccountKeys[index]!,
            isSigner: tx.message.isAccountSigner(index),
            isWritable: tx.message.isAccountWritable(index),
          })),
          data: Buffer.from(compiled.data),
        });
        if (!instruction.programId.equals(AddressLookupTableProgram.programId))
          continue;
        const type =
          AddressLookupTableInstruction.decodeInstructionType(instruction);
        if (type === "CreateLookupTable") {
          const decoded =
            AddressLookupTableInstruction.decodeCreateLookupTable(instruction);
          table = {
            key: instruction.keys[0]!.pubkey,
            authority: decoded.authority,
            addresses: [],
            extendedSlot: slot,
          };
        } else if (type === "ExtendLookupTable") {
          const decoded =
            AddressLookupTableInstruction.decodeExtendLookupTable(instruction);
          table!.addresses.push(...decoded.addresses);
          table!.extendedSlot = slot;
        } else if (type === "FreezeLookupTable") table!.authority = undefined;
      }
      const signature = anchor.utils.bytes.bs58.encode(tx.signatures[0]!);
      finalized.add(signature);
      return signature;
    }),
    confirmTransaction: vi.fn(async () => {
      slot++;
      return { context: { slot }, value: { err: null } };
    }),
    getSignatureStatuses: vi.fn(async (signatures: string[]) => ({
      context: { slot },
      value: signatures.map((signature) =>
        finalized.has(signature)
          ? { err: null, confirmationStatus: "finalized" }
          : null,
      ),
    })),
    getBlockHeight: vi.fn(async () => 499),
  };
  const input: LaunchInput = {
    command: "lut",
    dbcConfig: dbcConfig.toBase58(),
    cluster: "devnet",
    rpc: "https://devnet.invalid",
    program: programId.toBase58(),
    mint: mint.toBase58(),
    wallet: "/private/operator.json",
    acceptWarnings: false,
  };
  const run = (overrides: Partial<LaunchInput> = {}) =>
    createLaunchLookupTable(
      rpc as unknown as Connection,
      { ...input, ...overrides },
      wallet,
      { ...configAccount, lamports: 1n },
      (event) => events.push(event),
      {
        directory,
        sleep: async () => {
          slot++;
        },
      },
    );
  return {
    run,
    rpc,
    directory,
    input,
    wallet,
    launchWallet,
    mint,
    config,
    events,
    setFailSend(value: boolean) {
      failSend = value;
    },
    setBalance(value: bigint) {
      balance = value;
    },
    setSlot(value: number) {
      slot = value;
    },
    dbcConfig,
    getTable() {
      return table;
    },
  };
}

describe("launch LUT packet planning", () => {
  it("greedily chunks extensions within the packet limit and freezes separately", () => {
    const wallet = key(1),
      table = key(2),
      expected = Array.from({ length: 70 }, (_, index) => key(index + 3));
    const [create] = AddressLookupTableProgram.createLookupTable({
      authority: wallet,
      payer: wallet,
      recentSlot: 100,
    });
    const steps = planLaunchLookupTableSteps({
      wallet,
      table,
      expected,
      existing: [],
      create,
    });
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0]!.creates).toBe(true);
    expect(steps.at(-1)!.freezes).toBe(true);
    expect(steps.at(-1)!.instructions).toHaveLength(1);
    for (const step of steps) {
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: wallet,
          recentBlockhash: PublicKey.default.toBase58(),
          instructions: step.instructions,
        }).compileToV0Message(),
      );
      expect(tx.serialize().length).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
    }
    expect(steps.at(-1)!.after).toEqual(expected);
  });
  it("requires an exact existing prefix and unique expected addresses", () => {
    const input = {
      wallet: key(1),
      table: key(2),
      expected: [key(3), key(4)],
      existing: [key(3)],
    };
    expect(planLaunchLookupTableSteps(input)[0]!.before).toEqual([key(3)]);
    expect(() =>
      planLaunchLookupTableSteps({ ...input, existing: [key(4)] }),
    ).toThrow("prefix");
    expect(() =>
      planLaunchLookupTableSteps({ ...input, expected: [key(3), key(3)] }),
    ).toThrow("prefix");
  });
});

describe("launch LUT lifecycle", () => {
  it("records before sending, derives the launch wallet's addresses, and freezes", async () => {
    const f = await fixture();
    const result = await f.run();
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ verified: { authority: null } });
    expect(f.getTable()!.authority).toBeUndefined();
    const record = JSON.parse(await readFile(result.recordPath, "utf8"));
    expect(record.complete).toBe(true);
    expect(record.opsWallet).toBe(f.wallet.publicKey.toBase58());
    expect(record.launchWallet).toBe(f.launchWallet.toBase58());
    expect(
      record.steps.every(
        (step: { status: string }) => step.status === "finalized",
      ),
    ).toBe(true);
    expect(f.events[0]!.event).toBe("launch_lut_recorded");
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    const resumed = await f.run({ lut: result.lookupTable });
    expect(resumed).toMatchObject({ alreadyFrozen: true });
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])(
    "reports an incompatible frozen DBC table with recorded history: %s",
    async (retainRecord) => {
      const f = await fixture();
      const created = await f.run();
      const previousRecord = await readFile(created.recordPath, "utf8");
      if (!retainRecord) await rm(created.recordPath);
      f.getTable()!.addresses[0] = key(901);
      f.rpc.sendRawTransaction.mockClear();
      f.rpc.simulateTransaction.mockClear();
      const result = await f.run({ lut: created.lookupTable });
      expect(result).toMatchObject({
        ok: false,
        lookupTable: created.lookupTable,
        checks: [
          {
            id: "lut_dbc_accounts_mismatch",
            status: "NO-GO",
            value: { dbcConfig: f.dbcConfig.toBase58() },
          },
        ],
      });
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
      expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
      if (retainRecord)
        expect(await readFile(created.recordPath, "utf8")).toBe(previousRecord);
      else expect(await readdir(f.directory)).toEqual([]);
    },
  );
  it("allows an incomplete mutable table before every address has been appended", async () => {
    const f = await fixture();
    f.rpc.simulateTransaction
      .mockResolvedValueOnce({ context: { slot: 100 }, value: { err: null } })
      .mockResolvedValueOnce({
        context: { slot: 101 },
        value: { err: { InstructionError: [0, "failed"] } as never },
      });
    await expect(f.run()).rejects.toThrow("simulation_failed");
    const mutable = f.getTable()!;
    const recipientIndex = Math.floor(mutable.addresses.length / 2);
    const pendingAddress = mutable.addresses[recipientIndex]!;
    expect(recipientIndex).toBeGreaterThan(0);
    mutable.addresses.splice(recipientIndex);
    const recordPath = join(f.directory, (await readdir(f.directory))[0]!);
    await rm(recordPath);
    const resumed = await f.run({ lut: mutable.key.toBase58() });
    expect(resumed.ok).toBe(true);
    expect(mutable.authority).toBeUndefined();
    expect(
      mutable.addresses.some((address) => address.equals(pendingAddress)),
    ).toBe(true);
  });
  it("on mainnet requires the published capped ops wallet", async () => {
    // Isolate the wallet cap from the independently tested public release gate.
    const selector = vi
      .spyOn(launchInput, "selectLaunchDeployment")
      .mockReturnValue(
        createDeploymentSelector({ mainnet: key(52) })("mainnet"),
      );
    try {
      const f = await fixture();
      f.rpc.getGenesisHash.mockResolvedValue(GENESIS.mainnet);
      f.setBalance(GOVERNANCE.opsWalletMaxLamports + 1n);
      await expect(f.run({ cluster: "mainnet" })).rejects.toThrow(
        "ops_wallet_balance_cap",
      );
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
      f.setBalance(GOVERNANCE.opsWalletMaxLamports);
      f.config.fill(0, 296, 552);
      await expect(f.run({ cluster: "mainnet" })).rejects.toThrow(
        "not_published",
      );
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    } finally {
      selector.mockRestore();
    }
  });
  it("does not send if the configured mint differs", async () => {
    const f = await fixture();
    await expect(f.run({ mint: key(900).toBase58() })).rejects.toThrow(
      "mint_mismatch",
    );
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it.each(["before-signing", "before-submission"])(
    "rechecks genesis %s",
    async (stage) => {
      const f = await fixture();
      f.rpc.getGenesisHash.mockResolvedValueOnce(GENESIS.devnet);
      if (stage === "before-submission")
        f.rpc.getGenesisHash.mockResolvedValueOnce(GENESIS.devnet);
      f.rpc.getGenesisHash.mockResolvedValue(GENESIS.mainnet);
      await expect(f.run()).rejects.toThrow("launch_genesis_mismatch");
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
      expect(f.rpc.getSignatureStatuses).not.toHaveBeenCalled();
    },
  );
  it("preserves a signed attempt on ambiguous send and never rebuilds it on resume", async () => {
    const f = await fixture();
    f.setFailSend(true);
    await expect(f.run()).rejects.toThrow("ambiguous_signature");
    const names = await readdir(f.directory);
    expect(names).toHaveLength(1);
    const record = JSON.parse(
      await readFile(join(f.directory, names[0]!), "utf8"),
    );
    expect(record.complete).toBe(false);
    expect(record.steps).toHaveLength(1);
    expect(record.steps[0].status).toBe("signed");
    const initialCalls = f.rpc.getLatestBlockhash.mock.calls.length;
    await expect(f.run()).rejects.toThrow("resume_recorded_table_required");
    await expect(f.run({ lut: record.lookupTable })).rejects.toThrow(
      "ambiguous_signature",
    );
    expect(f.rpc.getLatestBlockhash.mock.calls).toHaveLength(initialCalls);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("refuses to send after a simulation failure", async () => {
    const f = await fixture();
    f.rpc.simulateTransaction.mockResolvedValueOnce({
      context: { slot: 100 },
      value: { err: { InstructionError: [0, "failed"] } as never },
    });
    await expect(f.run()).rejects.toThrow("simulation_failed");
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("creates a fresh table after finalized expiry and absence, retaining the old creation journal", async () => {
    const f = await fixture();
    f.setFailSend(true);
    await expect(f.run()).rejects.toThrow("ambiguous_signature");
    const oldPath = join(f.directory, (await readdir(f.directory))[0]!);
    const oldRecord = JSON.parse(await readFile(oldPath, "utf8"));
    expect(oldRecord.steps[0].status).toBe("signed");
    f.setSlot(600);
    f.rpc.getBlockHeight.mockResolvedValue(600);
    f.setFailSend(false);
    const result = await f.run();
    expect(result.ok).toBe(true);
    expect(result.lookupTable).not.toBe(oldRecord.lookupTable);
    expect(await readdir(f.directory)).toHaveLength(2);
    const retained = JSON.parse(await readFile(oldPath, "utf8"));
    expect(retained.complete).toBe(false);
    expect(retained.steps).toHaveLength(1);
    expect(retained.steps[0].signature).toBe(oldRecord.steps[0].signature);
    expect(retained.steps[0].status).toBe("expired");
    expect(f.rpc.getSignatureStatuses).toHaveBeenCalledTimes(3);
    expect(
      f.rpc.getSignatureStatuses.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(f.rpc.getLatestBlockhash.mock.invocationCallOrder[1]!);
    expect(
      f.events.some(
        (event) => event.event === "launch_lut_expired_creation_retained",
      ),
    ).toBe(true);
  });
  it("does not create a replacement while the expired creation has ambiguous history", async () => {
    const f = await fixture();
    f.setFailSend(true);
    await expect(f.run()).rejects.toThrow("ambiguous_signature");
    f.setSlot(600);
    f.rpc.getBlockHeight.mockResolvedValue(600);
    f.rpc.getSignatureStatuses.mockResolvedValue({
      context: { slot: 600 },
      value: [{ err: null, confirmationStatus: "confirmed" }],
    });
    f.setFailSend(false);
    await expect(f.run()).rejects.toThrow("resume_recorded_table_required");
    expect(f.rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(await readdir(f.directory)).toHaveLength(1);
  });
  it("resumes a mutable exact prefix after an interrupted freeze", async () => {
    const f = await fixture();
    f.rpc.simulateTransaction
      .mockResolvedValueOnce({ context: { slot: 100 }, value: { err: null } })
      .mockResolvedValueOnce({
        context: { slot: 101 },
        value: { err: { InstructionError: [0, "failed"] } as never },
      });
    await expect(f.run()).rejects.toThrow("simulation_failed");
    const mutable = f.getTable()!;
    expect(mutable.authority).toEqual(f.wallet.publicKey);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    const result = await f.run({ lut: mutable.key.toBase58() });
    expect(result.ok).toBe(true);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
  });
});
