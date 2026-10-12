import * as anchorNamespace from "@anchor-lang/core";
import { GOVERNANCE } from "@onepercent/config";
import { createHash } from "node:crypto";
import {
  AddressLookupTableInstruction,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type Commitment,
  type GetAccountInfoConfig,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { OpsError, parseCli } from "../src/input.js";
import {
  lutConfirmation,
  protocolLutAddresses,
  runLutLifecycle,
} from "../src/lut-lifecycle.js";
import {
  GENESIS,
  runOps,
  type OpsDependencies,
  type OpsRpc,
} from "../src/runtime.js";

const anchor =
  (Reflect.get(anchorNamespace, "default") as
    typeof anchorNamespace | undefined) ?? anchorNamespace;
const pubkey = (index: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(index, 0);
  bytes[31] = 71;
  return new PublicKey(bytes);
};
const programId = pubkey(999);
const protocolAddresses = protocolLutAddresses(programId);
interface TableState {
  key: PublicKey;
  authority?: PublicKey;
  addresses: PublicKey[];
  owner: PublicKey;
  active: boolean;
}
function tableData(table: TableState, slot: number) {
  const data = Buffer.alloc(56 + table.addresses.length * 32);
  data.writeUInt32LE(1, 0);
  data.writeBigUInt64LE(table.active ? (1n << 64n) - 1n : 1n, 4);
  data.writeBigUInt64LE(BigInt(slot), 12);
  data[21] = table.authority ? 1 : 0;
  table.authority?.toBuffer().copy(data, 22);
  table.addresses.forEach((address, index) =>
    address.toBuffer().copy(data, 56 + index * 32),
  );
  return data;
}
function fixture() {
  const signer = Keypair.generate();
  const events: Record<string, unknown>[] = [];
  const tables = new Map<string, TableState>();
  let slot = 100;
  let confirmationCount = 0;
  let ignoreFreeze = false;
  let staleReads = false;
  let failSendAt = -1;
  let readTransform: ((table: TableState) => TableState) | undefined;
  let members = [signer.publicKey];
  let walletLamports = 1_000_000;
  const accountInfo = vi.fn(
    async (address: PublicKey): Promise<AccountInfo<Buffer>> => {
      if (address.equals(protocolAddresses[0]!)) {
        const data = Buffer.alloc(872);
        createHash("sha256")
          .update("account:Config")
          .digest()
          .subarray(0, 8)
          .copy(data);
        data[736] = 1;
        members.forEach((member, index) =>
          member.toBuffer().copy(data, 296 + index * 32),
        );
        return {
          owner: programId,
          data,
          executable: false,
          lamports: 1,
          rentEpoch: 0,
        };
      }
      return {
        owner: SystemProgram.programId,
        data: Buffer.alloc(0),
        executable: false,
        lamports: walletLamports,
        rentEpoch: 0,
      };
    },
  );
  const rpc = {
    getGenesisHash: vi.fn(async (): Promise<string> => GENESIS.mainnet),
    getAccountInfo: accountInfo,
    getAccountInfoAndContext: vi.fn(
      async (
        address: PublicKey,
        config?: Commitment | GetAccountInfoConfig,
      ) => {
        expect(config).toMatchObject({ commitment: "finalized" });
        let table = tables.get(address.toBase58());
        if (table && readTransform) table = readTransform(table);
        return {
          context: { slot: staleReads ? 1 : slot },
          value: table
            ? {
                owner: table.owner,
                data: tableData(table, slot),
                executable: false,
                lamports: 1,
                rentEpoch: 0,
              }
            : null,
        };
      },
    ),
    getSignatureStatuses: vi.fn(
      async (
        signatures: string[],
        config: { searchTransactionHistory: boolean },
      ) => {
        expect(signatures).toHaveLength(1);
        expect(config).toEqual({ searchTransactionHistory: true });
        return {
          context: { slot },
          value: [
            null as null | {
              slot: number;
              err: unknown;
              confirmationStatus: "confirmed" | "finalized";
            },
          ],
        };
      },
    ),
    getBlockHeight: vi.fn(async (commitment: Commitment) => {
      expect(commitment).toBe("finalized");
      return 2000;
    }),
    getSlot: vi.fn(async () => slot),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: pubkey(500 + confirmationCount).toBase58(),
      lastValidBlockHeight: 1000 + confirmationCount,
    })),
    simulateTransaction: vi.fn(async (tx: VersionedTransaction) => {
      expect(
        tx.signatures.every((signature) =>
          signature.every((byte) => byte === 0),
        ),
      ).toBe(true);
      return {
        context: { slot },
        value: { err: null as unknown, unitsConsumed: 12345 },
      };
    }),
    sendRawTransaction: vi.fn(async (bytes: Uint8Array) => {
      if (rpc.sendRawTransaction.mock.calls.length === failSendAt)
        throw new Error("https://private.invalid/?api-key=do-not-output");
      const tx = VersionedTransaction.deserialize(bytes);
      expect(bytes.length).toBeLessThanOrEqual(1232);
      expect(tx.signatures[0]!.some((byte) => byte !== 0)).toBe(true);
      expect(tx.message.staticAccountKeys[0]!.equals(signer.publicKey)).toBe(
        true,
      );
      const instructions = TransactionMessage.decompile(
        tx.message,
      ).instructions;
      for (const ix of instructions) {
        expect(ix.programId.equals(AddressLookupTableProgram.programId)).toBe(
          true,
        );
        switch (AddressLookupTableInstruction.decodeInstructionType(ix)) {
          case "CreateLookupTable": {
            const decoded =
              AddressLookupTableInstruction.decodeCreateLookupTable(ix);
            const address =
              AddressLookupTableProgram.createLookupTable(decoded)[1];
            expect(tables.has(address.toBase58())).toBe(false);
            tables.set(address.toBase58(), {
              key: address,
              authority: decoded.authority,
              addresses: [],
              owner: AddressLookupTableProgram.programId,
              active: true,
            });
            break;
          }
          case "ExtendLookupTable": {
            const decoded =
              AddressLookupTableInstruction.decodeExtendLookupTable(ix);
            const table = tables.get(decoded.lookupTable.toBase58())!;
            expect(table.authority?.equals(decoded.authority)).toBe(true);
            table.addresses.push(...decoded.addresses);
            break;
          }
          case "FreezeLookupTable": {
            const decoded =
              AddressLookupTableInstruction.decodeFreezeLookupTable(ix);
            const table = tables.get(decoded.lookupTable.toBase58())!;
            expect(table.addresses.length).toBeGreaterThan(0);
            if (!ignoreFreeze) table.authority = undefined;
            break;
          }
          default:
            throw new Error("Unexpected instruction");
        }
      }
      return anchor.utils.bytes.bs58.encode(tx.signatures[0]!);
    }),
    confirmTransaction: vi.fn(
      async (_strategy: unknown, commitment: Commitment) => {
        expect(commitment).toBe("finalized");
        confirmationCount++;
        slot++;
        return { context: { slot }, value: { err: null as unknown } };
      },
    ),
  };
  const readText = vi.fn(async () => JSON.stringify([...signer.secretKey]));
  const deps: OpsDependencies = {
    connect: vi.fn(() => rpc as unknown as OpsRpc),
    readText,
    confirm: vi.fn(async (_prompt, expected) => expected),
    sleep: vi.fn(async () => undefined),
    readMultisig: vi.fn(async () => {
      throw new Error("LUT must not use Squads");
    }),
    emit: (record) => events.push(record),
  };
  const common = [
    "--cluster",
    "mainnet",
    "--rpc-url",
    "https://rpc.invalid/?api-key=never-print",
    "--program-id",
    programId.toBase58(),
    "--ops-wallet",
    signer.publicKey.toBase58(),
  ];
  function args(command: string[], confirm = true) {
    const argv = [...common, ...command];
    if (!confirm) return argv;
    const parsed = parseCli(argv);
    if (
      parsed.command.name !== "lut-create" &&
      parsed.command.name !== "lut-extend" &&
      parsed.command.name !== "lut-freeze"
    )
      throw new Error("Expected LUT command");
    return [
      ...argv,
      "--keypair",
      "/private/ops.json",
      "--confirm-mainnet-lut",
      lutConfirmation(
        parsed,
        parsed.command,
        signer.publicKey,
        parsed.command.name === "lut-create"
          ? []
          : (tables.get(parsed.command.address)?.addresses ?? []),
      ),
    ];
  }
  const addExisting = (
    addresses = [...protocolAddresses],
    authority: PublicKey | undefined = signer.publicKey,
  ) => {
    const key = pubkey(1001);
    tables.set(key.toBase58(), {
      key,
      authority,
      addresses,
      owner: AddressLookupTableProgram.programId,
      active: true,
    });
    return key;
  };
  return {
    setMembers: (next: PublicKey[]) => {
      members = next;
    },
    setBalance: (next: number) => {
      walletLamports = next;
    },
    signer,
    events,
    tables,
    rpc,
    deps,
    common,
    args,
    readText,
    addExisting,
    ignoreFreeze: () => {
      ignoreFreeze = true;
    },
    failSend: (at: number) => {
      failSendAt = at;
    },
    staleReads: () => {
      staleReads = true;
    },
    transformReads: (transform: (table: TableState) => TableState) => {
      readTransform = transform;
    },
  };
}

const create = () => [
  "lut",
  "create",
  "--addresses",
  protocolAddresses.join(","),
];
const freeze = (table: PublicKey) => [
  "lut",
  "freeze",
  "--lut",
  table.toBase58(),
  "--addresses",
  protocolAddresses.join(","),
];

describe("D21/D23 protocol LUT lifecycle", () => {
  it("prints the derived canonical plan without reading any key", async () => {
    const f = fixture();
    const result = await runOps(f.args(create(), false), f.deps);
    expect(result).toMatchObject({
      mode: "lut-plan",
      ok: false,
      requiresConfirmation: true,
      plan: { finalAddresses: protocolAddresses.map(String) },
    });
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.deps.confirm).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("creates, populates and freezes the canonical protocol table atomically", async () => {
    const f = fixture();
    const result = await runOps(f.args(create()), f.deps);
    expect(result).toMatchObject({
      mode: "lut-frozen",
      ok: true,
      finalizedVerification: {
        authority: null,
        addresses: protocolAddresses.map(String),
      },
    });
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(
      TransactionMessage.decompile(
        VersionedTransaction.deserialize(
          f.rpc.sendRawTransaction.mock.calls[0]![0],
        ).message,
      ).instructions.map((ix) =>
        AddressLookupTableInstruction.decodeInstructionType(ix),
      ),
    ).toEqual(["CreateLookupTable", "ExtendLookupTable", "FreezeLookupTable"]);
    expect(f.rpc.confirmTransaction).toHaveBeenCalledTimes(1);
    expect(f.deps.confirm).toHaveBeenCalledWith(
      expect.stringContaining(programId.toBase58()),
      `${programId.toBase58().slice(0, 4)}${programId.toBase58().slice(-4)}`,
    );
    const output = JSON.stringify({ result, events: f.events });
    expect(output).not.toContain(JSON.stringify([...f.signer.secretKey]));
    expect(output).not.toContain(
      anchor.utils.bytes.bs58.encode(f.signer.secretKey),
    );
    expect(output).not.toContain("never-print");
  });
  it("extends an existing canonical prefix and freezes", async () => {
    const f = fixture();
    const table = f.addExisting(protocolAddresses.slice(0, 2));
    const result = await runOps(
      f.args([
        "lut",
        "extend",
        "--lut",
        String(table),
        "--addresses",
        protocolAddresses.slice(2).join(","),
      ]),
      f.deps,
    );
    expect(result).toMatchObject({
      mode: "lut-frozen",
      ok: true,
      finalizedVerification: { addresses: protocolAddresses.map(String) },
    });
  });
  it("freezes exactly the expected table and verifies an already frozen table without a key", async () => {
    const f = fixture();
    const table = f.addExisting();
    expect(await runOps(f.args(freeze(table)), f.deps)).toMatchObject({
      mode: "lut-frozen",
      ok: true,
    });
    f.readText.mockClear();
    f.rpc.sendRawTransaction.mockClear();
    expect(await runOps(f.args(freeze(table), false), f.deps)).toMatchObject({
      mode: "lut-frozen",
      ok: true,
      alreadyFrozen: true,
    });
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("requires an explicit address list for create and freeze", async () => {
    const f = fixture();
    for (const command of [
      ["lut", "create"],
      ["lut", "freeze", "--lut", String(f.addExisting())],
    ]) {
      await expect(
        runOps([...f.common, ...command], f.deps),
      ).rejects.toMatchObject({ code: "lut_addresses_required_before_freeze" });
    }
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("rejects arbitrary addresses and a reordered canonical list", async () => {
    const f = fixture();
    for (const addresses of [[pubkey(1)], [...protocolAddresses].reverse()]) {
      await expect(
        runOps(
          f.args(["lut", "create", "--addresses", addresses.join(",")], false),
          f.deps,
        ),
      ).rejects.toMatchObject({ code: "lut_protocol_contents_mismatch" });
    }
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("binds the confirmation token to the observed contents", async () => {
    const f = fixture();
    const table = f.addExisting();
    const parsed = parseCli(f.args(freeze(table), false));
    if (parsed.command.name !== "lut-freeze") throw new Error("wrong command");
    expect(
      lutConfirmation(
        parsed,
        parsed.command,
        f.signer.publicKey,
        protocolAddresses,
      ),
    ).not.toBe(
      lutConfirmation(
        parsed,
        parsed.command,
        f.signer.publicKey,
        [...protocolAddresses].reverse(),
      ),
    );
    const args = f.args(freeze(table));
    args[args.indexOf("--confirm-mainnet-lut") + 1] = lutConfirmation(
      parsed,
      parsed.command,
      f.signer.publicKey,
      [],
    );
    await expect(runOps(args, f.deps)).rejects.toMatchObject({
      code: "lut_confirmation_mismatch",
    });
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("rejects a mismatching typed confirmation before reading the key", async () => {
    const f = fixture();
    f.deps.confirm = vi.fn(async () => "yes");
    await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
      code: "typed_confirmation_mismatch",
    });
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("requires terminal confirmation support", async () => {
    const f = fixture();
    delete f.deps.confirm;
    await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
      code: "interactive_confirmation_required",
    });
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("requires membership in Config.team_wallets and enforces D18 cap before key access", async () => {
    const f = fixture();
    f.setMembers([pubkey(6)]);
    await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
      code: "ops_wallet_not_in_team_wallets",
    });
    f.setMembers([f.signer.publicKey]);
    f.setBalance(Number(GOVERNANCE.opsWalletMaxLamports + 1n));
    await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
      code: "ops_wallet_balance_cap_exceeded",
    });
    expect(f.readText).not.toHaveBeenCalled();
    f.setBalance(Number(GOVERNANCE.opsWalletMaxLamports));
    expect(await runOps(f.args(create()), f.deps)).toMatchObject({
      mode: "lut-frozen",
      ok: true,
    });
  });
  it("validates a non-executable, empty System-owned ops account", async () => {
    for (const wallet of [
      {
        owner: AddressLookupTableProgram.programId,
        data: Buffer.alloc(0),
        executable: false,
      },
      {
        owner: SystemProgram.programId,
        data: Buffer.alloc(0),
        executable: true,
      },
      {
        owner: SystemProgram.programId,
        data: Buffer.alloc(1),
        executable: false,
      },
    ]) {
      const f = fixture();
      const original = f.rpc.getAccountInfo.getMockImplementation()!;
      f.rpc.getAccountInfo.mockImplementation(async (address) =>
        address.equals(f.signer.publicKey)
          ? { ...wallet, lamports: 1, rentEpoch: 0 }
          : original(address),
      );
      await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
        code: "ops_wallet_invalid_system_account",
      });
      expect(f.readText).not.toHaveBeenCalled();
    }
  });
  it("rechecks the cap and membership after simulation before signing", async () => {
    for (const mode of ["cap", "membership"]) {
      const f = fixture();
      const simulate = f.rpc.simulateTransaction.getMockImplementation()!;
      f.rpc.simulateTransaction.mockImplementation(async (transaction) => {
        const result = await simulate(transaction);
        if (mode === "cap")
          f.setBalance(Number(GOVERNANCE.opsWalletMaxLamports + 1n));
        else f.setMembers([pubkey(44)]);
        return result;
      });
      expect(await runOps(f.args(create()), f.deps)).toMatchObject({
        mode: "lut-incomplete",
        error:
          mode === "cap"
            ? "ops_wallet_balance_cap_exceeded"
            : "ops_wallet_not_in_team_wallets",
        signatures: [],
      });
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    }
  });
  it("rejects unverified Config data before key access", async () => {
    const f = fixture();
    f.rpc.getAccountInfo.mockResolvedValueOnce({
      owner: programId,
      data: Buffer.alloc(872),
      executable: false,
      lamports: 1,
      rentEpoch: 0,
    });
    await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
      code: "ops_wallet_config_invalid",
    });
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("checks genesis before wallet access, before key access and again before signing", async () => {
    const f = fixture();
    f.rpc.getGenesisHash.mockResolvedValueOnce(GENESIS.devnet);
    await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
      code: "rpc_cluster_mismatch",
    });
    expect(f.rpc.getAccountInfo).not.toHaveBeenCalled();
    expect(f.readText).not.toHaveBeenCalled();
    f.rpc.getGenesisHash
      .mockResolvedValueOnce(GENESIS.mainnet)
      .mockResolvedValueOnce(GENESIS.devnet);
    await expect(runOps(f.args(create()), f.deps)).rejects.toMatchObject({
      code: "rpc_cluster_mismatch",
    });
    expect(f.readText).not.toHaveBeenCalled();
    f.rpc.getGenesisHash
      .mockResolvedValueOnce(GENESIS.mainnet)
      .mockResolvedValueOnce(GENESIS.mainnet)
      .mockResolvedValueOnce(GENESIS.devnet);
    expect(await runOps(f.args(create()), f.deps)).toMatchObject({
      mode: "lut-incomplete",
      error: "rpc_cluster_mismatch",
      signatures: [],
    });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("rejects signer mismatch and zeroes the exact array passed to Keypair", async () => {
    const f = fixture();
    f.readText.mockResolvedValue(
      JSON.stringify([...Keypair.generate().secretKey]),
    );
    const original = Keypair.fromSecretKey;
    const arrays: Uint8Array[] = [];
    const spy = vi
      .spyOn(Keypair, "fromSecretKey")
      .mockImplementation((bytes, options) => {
        arrays.push(bytes);
        return original(bytes, options);
      });
    try {
      expect(await runOps(f.args(create()), f.deps)).toMatchObject({
        mode: "lut-incomplete",
        error: "ops_wallet_keypair_mismatch",
      });
      expect(arrays).toHaveLength(1);
      expect(arrays[0]!.every((byte) => byte === 0)).toBe(true);
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("sends nothing on simulation failure", async () => {
    const f = fixture();
    f.rpc.simulateTransaction.mockResolvedValueOnce({
      context: { slot: 100 },
      value: {
        err: { InstructionError: [0, "InvalidInstructionData"] },
        unitsConsumed: 1,
      },
    });
    expect(await runOps(f.args(create()), f.deps)).toMatchObject({
      mode: "lut-incomplete",
      error: "lut_simulation_failed",
      signatures: [],
    });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("rejects wrong authority, wrong LUT owner, or retained authority after finalization", async () => {
    const f = fixture();
    const table = f.addExisting([...protocolAddresses], pubkey(7));
    await expect(runOps(f.args(freeze(table)), f.deps)).rejects.toMatchObject({
      code: "lut_missing_inactive_or_wrong_authority",
    });
    f.tables.get(String(table))!.owner = SystemProgram.programId;
    await expect(runOps(f.args(freeze(table)), f.deps)).rejects.toMatchObject({
      code: "lut_invalid_account_owner",
    });
    const g = fixture();
    g.ignoreFreeze();
    expect(await runOps(g.args(create()), g.deps)).toMatchObject({
      mode: "lut-incomplete",
      error: "lut_not_finalized_frozen",
    });
  });
  it("verifies finalized read context and exact final contents", async () => {
    const f = fixture();
    const original = f.rpc.confirmTransaction.getMockImplementation()!;
    f.rpc.confirmTransaction.mockImplementation(
      async (strategy, commitment) => {
        const result = await original(strategy, commitment);
        f.staleReads();
        return result;
      },
    );
    expect(await runOps(f.args(create()), f.deps)).toMatchObject({
      mode: "lut-incomplete",
      error: "lut_stale_finalized_read",
    });
    const g = fixture();
    g.transformReads((table) =>
      table.authority === undefined
        ? { ...table, addresses: [...table.addresses, pubkey(88)] }
        : table,
    );
    expect(await runOps(g.args(create()), g.deps)).toMatchObject({
      mode: "lut-incomplete",
      error: "lut_final_contents_mismatch",
    });
  });
});

describe("LUT finality settlement", () => {
  it("preserves a signed signature through confirmation timeout and waits for finalized expiry plus history recheck", async () => {
    const f = fixture();
    f.failSend(1);
    f.rpc.confirmTransaction.mockRejectedValue(new Error("private-rpc-secret"));
    f.rpc.getBlockHeight
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1001);
    const result = await runOps(f.args(create()), f.deps);
    expect(result).toMatchObject({
      mode: "lut-incomplete",
      error: "lut_operation_failed",
      signatures: [
        { step: 0, status: "expired", signature: expect.any(String) },
      ],
      requiresRecovery: true,
    });
    expect(f.rpc.getSignatureStatuses).toHaveBeenCalledTimes(3);
    expect(
      f.rpc.getSignatureStatuses.mock.calls.every(
        (call) => call[1]?.searchTransactionHistory,
      ),
    ).toBe(true);
    expect(
      f.rpc.getBlockHeight.mock.calls.every((call) => call[0] === "finalized"),
    ).toBe(true);
    expect(f.deps.sleep).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-rpc-secret");
    expect(JSON.stringify(result)).not.toContain("do-not-output");
  });
  it("reconciles finalized success after an ambiguous confirmation without another send", async () => {
    const f = fixture();
    f.rpc.confirmTransaction.mockRejectedValueOnce(new Error("timeout"));
    f.rpc.getSignatureStatuses.mockResolvedValueOnce({
      context: { slot: 100 },
      value: [{ slot: 100, err: null, confirmationStatus: "finalized" }],
    });
    expect(await runOps(f.args(create()), f.deps)).toMatchObject({
      mode: "lut-frozen",
      ok: true,
      signatures: [{ status: "finalized" }],
    });
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.getBlockHeight).not.toHaveBeenCalled();
  });
  it("keeps confirmed errors ambiguous until finalized", async () => {
    const f = fixture();
    f.failSend(1);
    f.rpc.confirmTransaction.mockRejectedValueOnce(new Error("timeout"));
    f.rpc.getSignatureStatuses
      .mockResolvedValueOnce({
        context: { slot: 100 },
        value: [{ slot: 100, err: "failed", confirmationStatus: "confirmed" }],
      })
      .mockResolvedValueOnce({
        context: { slot: 101 },
        value: [{ slot: 100, err: "failed", confirmationStatus: "finalized" }],
      });
    f.rpc.getBlockHeight.mockResolvedValueOnce(1000);
    expect(await runOps(f.args(create()), f.deps)).toMatchObject({
      mode: "lut-incomplete",
      signatures: [{ status: "failed" }],
    });
    expect(f.deps.sleep).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("rechecks history after expiry before accepting finalized account reconciliation", async () => {
    const f = fixture();
    f.rpc.confirmTransaction.mockRejectedValueOnce(new Error("timeout"));
    expect(await runOps(f.args(create()), f.deps)).toMatchObject({
      mode: "lut-frozen",
      ok: true,
      signatures: [{ status: "finalized" }],
    });
    expect(f.rpc.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("retains its own signature on an RPC signature mismatch until expiry is settled", async () => {
    const f = fixture();
    f.rpc.sendRawTransaction.mockResolvedValueOnce("wrong-signature");
    f.rpc.confirmTransaction.mockRejectedValueOnce(new Error("timeout"));
    const result = await runOps(f.args(create()), f.deps);
    expect(result).toMatchObject({
      mode: "lut-incomplete",
      error: "lut_rpc_signature_mismatch",
      signatures: [{ status: "expired" }],
    });
    expect(f.rpc.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("wrong-signature");
  });
  it("does not start the next LUT step until the prior signature settles", async () => {
    const f = fixture();
    const parsed = parseCli(f.args(create()));
    const unsigned = (
      instructions: import("@solana/web3.js").TransactionInstruction[],
      payer: PublicKey,
      blockhash: string,
    ) => {
      // Force small chunks to exercise lifecycle sequencing with the v1 list.
      for (const ix of instructions) {
        if (
          AddressLookupTableInstruction.decodeInstructionType(ix) ===
            "ExtendLookupTable" &&
          AddressLookupTableInstruction.decodeExtendLookupTable(ix).addresses
            .length > 2
        )
          throw new OpsError("transaction_too_large_split_lut_extension");
      }
      return new VersionedTransaction(
        new TransactionMessage({
          payerKey: payer,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message(),
      );
    };
    f.rpc.confirmTransaction.mockRejectedValueOnce(new Error("timeout"));
    f.rpc.getBlockHeight
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1001);
    f.deps.sleep = vi.fn(async () => {
      expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    });
    const result = await runLutLifecycle(
      parsed,
      f.rpc as unknown as OpsRpc,
      f.deps,
      {
        unsigned,
        requireCluster: async () => undefined,
        simulate: async (rpc, transaction) => {
          await rpc.simulateTransaction(transaction);
          return { slot: 100, ok: true, error: null, unitsConsumed: 1 };
        },
      },
    );
    expect(result).toMatchObject({ mode: "lut-frozen", ok: true });
    expect(f.deps.sleep).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(3);
  });
});
