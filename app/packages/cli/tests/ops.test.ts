import {
  AddressLookupTableAccount,
  AddressLookupTableInstruction,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import * as squads from "@sqds/multisig";
import { GOVERNANCE } from "@onepercent/config";
import { configLayout } from "@onepercent/sdk";
import { describe, expect, it, vi } from "vitest";
import vectors from "./fixtures/m1-ix.json" with { type: "json" };
import {
  OpsError,
  initParamsSchema,
  parseBoundary,
  parseCli,
} from "../src/input.js";
import {
  adminConfigInstruction,
  decodeDraftInstruction,
  encodeDraftInstruction,
  guardianInstruction,
  initializeInstruction,
  pda,
  programDataPda,
} from "../src/m1-adapter.js";
import {
  GENESIS,
  buildOperation,
  defaultDependencies,
  runOps,
  publicSignature,
  verifyOperationInstruction,
  type MultisigState,
  type OpsDependencies,
  type OpsRpc,
} from "../src/runtime.js";
import * as draftAdapter from "../src/m1-adapter.js";
import {
  loadHitlistExtension,
  type ExtensionLoader,
} from "../src/extensions.js";
import { prepare as installedHitlistPrepare } from "../src/hitlist/index.js";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  TOKEN_PROGRAMS,
} from "../src/extension-instructions.js";

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const programId = key(55);
const authority = key(1);
const multisig = key(77);
const base = [
  "--cluster",
  "devnet",
  "--rpc-url",
  "https://rpc.invalid/?api-key=never-print-this",
  "--program-id",
  programId.toBase58(),
  "--keypair",
  "/private/operator.json",
];
const mainnet = [
  "--cluster",
  "mainnet",
  "--rpc-url",
  "https://rpc.invalid/?api-key=never-print-this",
  "--program-id",
  programId.toBase58(),
  "--multisig",
  multisig.toBase58(),
  "--creator",
  authority.toBase58(),
];
const role = ["role", "set", "keeper", key(9).toBase58()];
const initial = vectors.find((row) => row.name === "initialize")!;
const params = parseBoundary(initParamsSchema, initial.args.params);

function fixture(cluster: "devnet" | "mainnet" = "devnet") {
  const signer = Keypair.generate();
  const rpc = {
    getGenesisHash: vi.fn(async () => GENESIS[cluster]),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: key(90).toBase58(),
      lastValidBlockHeight: 1000,
    })),
    getSlot: vi.fn(async () => 100),
    getBlockTime: vi.fn(async () => 1791475200 as number | null),
    getAccountInfo: vi.fn(async () => null),
    getAddressLookupTable: vi.fn(async () => ({
      context: { slot: 100 },
      value: null as AddressLookupTableAccount | null,
    })),
    simulateTransaction: vi.fn(async () => ({
      context: { slot: 100 },
      value: {
        err: null as unknown,
        unitsConsumed: 42000,
      },
    })),
    sendRawTransaction: vi.fn<(raw: Uint8Array) => Promise<string>>(
      async (raw) =>
        publicSignature(VersionedTransaction.deserialize(raw).signatures[0]!),
    ),
    confirmTransaction: vi.fn(async () => ({
      context: { slot: 101 },
      value: { err: null },
    })),
  };
  const readText = vi.fn(async (path: string) =>
    path === "/private/operator.json"
      ? JSON.stringify([...signer.secretKey])
      : JSON.stringify(initial.args.params),
  );
  const readMultisig = vi.fn(async (): Promise<MultisigState> => ({
    transactionIndex: 18n,
    threshold: 2,
    timeLock: 43200,
    members: [
      { key: authority, permissions: { mask: 7 } },
      { key: key(2), permissions: { mask: 7 } },
      { key: key(3), permissions: { mask: 7 } },
    ],
  }));
  const connect = vi.fn(() => rpc as unknown as OpsRpc);
  const deps: OpsDependencies = { connect, readText, readMultisig };
  return { rpc, deps, signer, readText, readMultisig, connect };
}

describe("strict CLI boundaries", () => {
  it("maps all role encodings and requires explicit cluster/program/RPC/key path", () => {
    for (const [name, value] of Object.entries({
      admin: 0,
      guardian0: 1,
      guardian1: 2,
      keeper: 3,
      executor: 4,
      "intake-signer": 5,
      "quote-signer": 6,
      "launch-wallet": 7,
    })) {
      expect(
        parseCli([...base, "role", "set", name, key(8).toBase58()]).command,
      ).toEqual({ name: "role", role: value, publicKey: key(8).toBase58() });
    }
    expect(() => parseCli(role)).toThrow("invalid_input");
  });
  it.each(
    [
      ["guardian", "SetPause", "--bits", "32", "--paused", "true"],
      ["guardian", "SetPause", "--bits", "1", "--paused", "yes"],
      ["guardian", "DisableRole", "--role", "admin"],
      ["guardian", "DisableRole", "--role", "launch-wallet"],
      ["guardian", "DisableBucket", "--index", "16"],
      ["guardian", "SelectVrfQueue", "--index", "4"],
      ["guardian", "LowerCap", "--index", "0", "--cap", "18446744073709551616"],
      ["guardian", "LowerCap", "--index", "0", "--cap", "-1"],
      [
        "set-season",
        "--slot",
        "1",
        "--ts",
        "9223372036854775808",
        "--stock-up-ts",
        "9223372036854775809",
      ],
      ["set-season", "--slot", "1", "--ts", "10", "--stock-up-ts", "10"],
      ["role", "set", "keeper", PublicKey.default.toBase58()],
      [
        "lut",
        "extend",
        "--lut",
        key(5).toBase58(),
        "--addresses",
        `${key(7).toBase58()},${key(7).toBase58()}`,
      ],
    ].map((command, index) => ({
      command,
      code: [
        "invalid_input",
        "invalid_input",
        "invalid_guardian_role",
        "invalid_guardian_role",
        "invalid_input",
        "invalid_input",
        "invalid_input",
        "invalid_arguments",
        "invalid_input",
        "invalid_season_order",
        "invalid_input",
        "duplicate_lut_address",
      ][index]!,
    })),
  )(
    "rejects an invalid action before side effects: $code $command",
    ({ command, code }) => {
      expect(() => parseCli([...base, ...command])).toThrowError(
        new OpsError(code),
      );
    },
  );
  it("accepts exact integer boundaries and safe guardian actions", () => {
    const parsed = parseCli([
      ...base,
      "set-season",
      "--slot",
      "18446744073709551615",
      "--ts=-9223372036854775808",
      "--stock-up-ts",
      "9223372036854775807",
    ]);
    expect(parsed.command).toMatchObject({
      snapshotSlot: 18446744073709551615n,
      snapshotTs: -9223372036854775808n,
    });
    expect(
      parseCli([
        ...base,
        "guardian",
        "LowerCap",
        "--index",
        "15",
        "--cap",
        "18446744073709551615",
      ]).command,
    ).toMatchObject({ action: { lowerCap: { cap: 18446744073709551615n } } });
    expect(
      parseCli([
        ...base,
        "guardian",
        "SetPause",
        "--bits",
        "31",
        "--paused",
        "false",
      ]).command,
    ).toMatchObject({ action: { setPause: { bits: 31, paused: false } } });
  });
  it("rejects stray flags, extra positionals, and cluster-incompatible options", () => {
    expect(() => parseCli([...base, ...role, "--cap", "1"])).toThrow(
      "unused_option",
    );
    expect(() => parseCli([...base, ...role, "unexpected"])).toThrow(
      "invalid_arguments",
    );
    expect(() => parseCli([...base, ...role, "--typo", "1"])).toThrow(
      "invalid_arguments",
    );
    expect(() =>
      parseCli([...base, ...role, "--multisig", multisig.toBase58()]),
    ).toThrow("devnet_squads_options_forbidden");
  });
  it("requires exact InitParams, no extra economic settings, and decimal-string amounts", () => {
    expect(() =>
      parseBoundary(initParamsSchema, { ...initial.args.params, odds: 1 }),
    ).toThrow("invalid_input");
    expect(() =>
      parseBoundary(initParamsSchema, {
        ...initial.args.params,
        rent_buffer_lamports: 50000000,
      }),
    ).toThrow("invalid_input");
    expect(() =>
      parseBoundary(initParamsSchema, {
        ...initial.args.params,
        guardians: [],
      }),
    ).toThrow("invalid_input");
  });
});

describe("read-only M1 draft adapter parity", () => {
  it("matches the Rust-generated initialize bytes and all account flags", () => {
    const ix = initializeInstruction({
      programId,
      authority,
      programData: programDataPda(programId),
      params,
    });
    expect(ix.data.toString("hex")).toBe(initial.data);
    expect(
      ix.keys.map(({ isSigner, isWritable }) => ({ isSigner, isWritable })),
    ).toEqual(
      initial.accounts.map(({ isSigner, isWritable }) => ({
        isSigner,
        isWritable,
      })),
    );
    expect(ix.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        authority,
        programId,
        programDataPda(programId),
        pda("config", programId),
        pda("machine", programId),
        pda("deck", programId),
        pda("fee_in", programId),
        new PublicKey(params.vrf_queue),
        SystemProgram.programId,
      ].map((pubkey) => pubkey.toBase58()),
    );
  });
  it("matches Rust admin and guardian fixture bytes", () => {
    for (const name of ["admin_config", "guardian"]) {
      const vector = vectors.find((row) => row.name === name)!;
      expect(encodeDraftInstruction(name, vector.args).toString("hex")).toBe(
        vector.data,
      );
    }
  });
  it("encodes every CLI governance variant with frozen Borsh tags and field order", () => {
    const guardians = [
      { action: { setPause: { bits: 31, paused: false } }, hex: "001f00" },
      { action: { disableBucket: { index: 15 } }, hex: "010f" },
      {
        action: { lowerCap: { index: 15, cap: 18446744073709551615n } },
        hex: "020fffffffffffffffff",
      },
      { action: { disableRole: { role: 6 } }, hex: "0306" },
      { action: { selectVrfQueue: { index: 3 } }, hex: "0403" },
    ];
    for (const { action, hex } of guardians) {
      const instruction = guardianInstruction({
        programId,
        signer: authority,
        action,
      });
      expect(instruction.data.toString("hex")).toBe(`8af76be930fbb7ea${hex}`);
      expect(instruction.keys).toHaveLength(3);
      expect(instruction.keys[0]).toMatchObject({
        isSigner: true,
        isWritable: false,
      });
    }
    expect(
      adminConfigInstruction({
        programId,
        admin: authority,
        action: { setRole: { role: 3, key: key(9) } },
      }).data.toString("hex"),
    ).toBe(`2021e2d61c6e345a0003${"09".repeat(32)}`);
    expect(
      adminConfigInstruction({
        programId,
        admin: authority,
        action: {
          setSeason: { snapshot_slot: 1n, snapshot_ts: -1n, stock_up_ts: 2n },
        },
      }).data.toString("hex"),
    ).toBe(
      "2021e2d61c6e345a020100000000000000ffffffffffffffff0200000000000000",
    );
  });
  it("uses the passed program id for every protocol instruction and PDA", () => {
    const first = guardianInstruction({
      programId,
      signer: authority,
      action: { disableBucket: { index: 0 } },
    });
    const second = guardianInstruction({
      programId: key(56),
      signer: authority,
      action: { disableBucket: { index: 0 } },
    });
    expect(first.programId.equals(programId)).toBe(true);
    expect(first.keys[1]!.pubkey.equals(second.keys[1]!.pubkey)).toBe(false);
    expect(first.data.equals(second.data)).toBe(true);
  });
});

describe("cluster and key isolation", () => {
  it("refuses mixing a mainnet local keypair with historical proposal options", async () => {
    const f = fixture("mainnet");
    await expect(
      runOps(
        [...mainnet, ...role, "--keypair", "/private/operator.json"],
        f.deps,
      ),
    ).rejects.toThrow("local_signer_squads_options_forbidden");
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("refuses RPC cluster mismatches before reading the devnet signer", async () => {
    const f = fixture("mainnet");
    await expect(runOps([...base, ...role], f.deps)).rejects.toThrow(
      "rpc_cluster_mismatch",
    );
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("checks devnet again after simulation before signing and sending", async () => {
    const f = fixture();
    f.rpc.getGenesisHash
      .mockResolvedValueOnce(GENESIS.devnet)
      .mockResolvedValueOnce(GENESIS.mainnet);
    await expect(runOps([...base, ...role], f.deps)).rejects.toThrow(
      "rpc_cluster_mismatch",
    );
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("simulates unsigned, then signs and confirms on devnet only", async () => {
    const f = fixture();
    let sawUnsigned = false;
    f.rpc.simulateTransaction.mockImplementation(async (...args: unknown[]) => {
      const tx = args[0] as VersionedTransaction;
      sawUnsigned = tx.signatures.every((signature) =>
        signature.every((byte) => byte === 0),
      );
      return {
        context: { slot: 100 },
        value: { err: null, unitsConsumed: 42000 },
      };
    });
    const result = await runOps([...base, ...role], f.deps);
    expect(result.mode).toBe("devnet-confirmed");
    expect(sawUnsigned).toBe(true);
    const bytes = f.rpc.sendRawTransaction.mock
      .calls[0]![0] as unknown as Uint8Array;
    const sent = VersionedTransaction.deserialize(bytes);
    expect(sent.signatures[0]!.some((byte) => byte !== 0)).toBe(true);
    expect(f.rpc.confirmTransaction).toHaveBeenCalledWith(
      {
        blockhash: key(90).toBase58(),
        lastValidBlockHeight: 1000,
        signature: publicSignature(sent.signatures[0]!),
      },
      "confirmed",
    );
    expect(JSON.stringify(result)).not.toContain("never-print-this");
    expect(JSON.stringify(result)).not.toContain(
      JSON.stringify([...f.signer.secretKey]),
    );
  });
  it("does not send failed simulations", async () => {
    const f = fixture();
    f.rpc.simulateTransaction.mockResolvedValue({
      context: { slot: 100 },
      value: {
        err: { InstructionError: [0, { Custom: 6000 }] },
        unitsConsumed: 1000,
      },
    });
    const result = await runOps([...base, ...role], f.deps);
    expect(result).toMatchObject({
      mode: "devnet-not-sent",
      simulation: { ok: false },
    });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("does not return key-file data in parse failures", async () => {
    const f = fixture();
    f.readText.mockResolvedValue("secret-content-not-json");
    await expect(runOps([...base, ...role], f.deps)).rejects.toThrow(
      "invalid_json_file",
    );
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("unsigned Squads exports", () => {
  it("requires the D21 ops-wallet path for mainnet LUTs", async () => {
    const f = fixture("mainnet");
    await expect(
      runOps(
        [
          ...mainnet,
          "lut",
          "create",
          "--ops-wallet",
          authority.toBase58(),
          "--addresses",
          key(8).toBase58(),
        ],
        f.deps,
      ),
    ).rejects.toThrow("lut_squads_options_forbidden");
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("does not echo arbitrary provider text in simulation reports", async () => {
    const f = fixture("mainnet");
    for (const err of [
      "https://rpc.invalid/?api-key=private-value",
      { InstructionError: [0, "SECRET_TOKEN=private-value"] },
      { providerUrl: "https://private-value" },
    ]) {
      f.rpc.simulateTransaction.mockResolvedValueOnce({
        context: { slot: 100 },
        value: { err, unitsConsumed: 1 },
      });
      const result = await runOps([...mainnet, ...role], f.deps);
      expect(result.simulation).toMatchObject({
        ok: false,
        error: "simulation_failed",
      });
      expect(JSON.stringify(result)).not.toContain("private-value");
    }
  });
  it("validates the real Squads account owner, discriminator and decoding", async () => {
    const account = squads.accounts.Multisig.fromArgs({
      createKey: key(4),
      configAuthority: PublicKey.default,
      threshold: 2,
      timeLock: 43200,
      transactionIndex: 18,
      staleTransactionIndex: 0,
      rentCollector: null,
      bump: 255,
      members: [
        { key: authority, permissions: { mask: 7 } },
        { key: key(2), permissions: { mask: 7 } },
      ],
    });
    const info = {
      owner: squads.PROGRAM_ID,
      data: account.serialize()[0],
      executable: false,
      lamports: 100,
      rentEpoch: 0,
    };
    const getAccountInfo = vi.fn(async () => info);
    const rpc = { getAccountInfo } as unknown as OpsRpc;
    expect(await defaultDependencies.readMultisig(rpc, multisig)).toMatchObject(
      { transactionIndex: 18n, threshold: 2, timeLock: 43200 },
    );
    for (const invalid of [
      { ...info, owner: SystemProgram.programId },
      { ...info, executable: true },
      { ...info, data: Buffer.alloc(info.data.length) },
    ]) {
      getAccountInfo.mockResolvedValueOnce(invalid);
      await expect(
        defaultDependencies.readMultisig(rpc, multisig),
      ).rejects.toThrow("invalid_squads_account");
    }
  });
  it("exports a real vault transaction and proposal with zero signatures and exact inner data", async () => {
    const f = fixture("mainnet");
    const result = await runOps([...mainnet, ...role], f.deps);
    expect(result.mode).toBe("unsigned-squads-proposal");
    if (
      !("unsignedTransactions" in result) ||
      !result.unsignedTransactions ||
      !result.instructions ||
      !result.vault
    )
      throw new Error("Expected proposal");
    expect(result).toMatchObject({
      submitted: false,
      signed: false,
      transactionIndex: "19",
      observedGovernance: { threshold: 2, timeLockSeconds: 43200, members: 3 },
      simulation: {
        scope: "inner_vault_instructions",
        signatureVerification: false,
      },
    });
    expect(result.vault).toBe(
      squads.getVaultPda({ multisigPda: multisig, index: 0 })[0].toBase58(),
    );
    expect(result.proposal).toBe(
      squads
        .getProposalPda({ multisigPda: multisig, transactionIndex: 19n })[0]
        .toBase58(),
    );
    expect(result.instructions[0]!.dataBase64).toBe(
      adminConfigInstruction({
        programId,
        admin: new PublicKey(result.vault),
        action: { setRole: { role: 3, key: key(9) } },
      }).data.toString("base64"),
    );
    for (const exported of result.unsignedTransactions) {
      const bytes = Buffer.from(exported.base64, "base64");
      const tx = VersionedTransaction.deserialize(bytes);
      expect(bytes.length).toBeLessThanOrEqual(1232);
      expect(
        tx.signatures.every((signature) =>
          signature.every((byte) => byte === 0),
        ),
      ).toBe(true);
      expect(
        tx.message.staticAccountKeys[
          tx.message.compiledInstructions[0]!.programIdIndex
        ]!.equals(squads.PROGRAM_ID),
      ).toBe(true);
    }
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(f.rpc.confirmTransaction).not.toHaveBeenCalled();
  });
  it("returns simulation failures for review without submitting a proposal", async () => {
    const f = fixture("mainnet");
    f.rpc.simulateTransaction.mockResolvedValue({
      context: { slot: 100 },
      value: {
        err: { InstructionError: [0, { Custom: 6000 }] },
        unitsConsumed: 1000,
      },
    });
    expect(await runOps([...mainnet, ...role], f.deps)).toMatchObject({
      mode: "unsigned-squads-proposal",
      simulation: { ok: false },
    });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("rejects creators without Initiate permission and exhausted indexes", async () => {
    const f = fixture("mainnet");
    f.readMultisig.mockResolvedValueOnce({
      transactionIndex: 18n,
      threshold: 2,
      timeLock: 43200,
      members: [{ key: authority, permissions: { mask: 2 } }],
    });
    await expect(runOps([...mainnet, ...role], f.deps)).rejects.toThrow(
      "squads_creator_cannot_initiate",
    );
    f.readMultisig.mockResolvedValueOnce({
      transactionIndex: (1n << 64n) - 1n,
      threshold: 2,
      timeLock: 43200,
      members: [],
    });
    await expect(runOps([...mainnet, ...role], f.deps)).rejects.toThrow(
      "invalid_squads_transaction_index",
    );
  });
  it("initializes mainnet at the configured rent-buffer cap with the deployer as the simulation payer", async () => {
    const f = fixture("mainnet");
    const vault = squads.getVaultPda({ multisigPda: multisig, index: 0 })[0];
    const init = {
      ...initial.args.params,
      admin: vault.toBase58(),
      rent_buffer_lamports: GOVERNANCE.initRentBufferMaxLamports.toString(),
    };
    f.readText.mockImplementation(async (path) =>
      JSON.stringify(
        path === "/private/operator.json" ? [...f.signer.secretKey] : init,
      ),
    );
    f.deps.confirm = vi.fn(async (_prompt, expected) => expected);
    const result = await runOps(
      [
        ...mainnet.slice(0, 8),
        "--keypair",
        "/private/operator.json",
        "init",
        "/public/params.json",
      ],
      f.deps,
    );
    expect(result.mode).toBe("mainnet-confirmed");
    expect(result).not.toHaveProperty("unsignedTransactions");
    const simulated = (
      f.rpc.simulateTransaction.mock.calls as unknown as [
        VersionedTransaction,
      ][]
    )[0]![0];
    expect(
      simulated.message.staticAccountKeys[0]!.equals(f.signer.publicKey),
    ).toBe(true);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(f.readMultisig).toHaveBeenCalledExactlyOnceWith(f.rpc, multisig);
  });
});

describe("K1 local extension boundary", () => {
  it("cannot bypass the ops-wallet LUT lifecycle through an extension", async () => {
    const f = fixture("mainnet");
    const loader: ExtensionLoader = async () => ({
      prepare: async () => ({
        kind: "transaction",
        build: async (authority) => ({
          instructions: [
            AddressLookupTableProgram.createLookupTable({
              authority,
              payer: authority,
              recentSlot: 100,
            })[0],
          ],
        }),
      }),
    });
    await expect(
      runOps([...mainnet, "hitlist", "add", key(9).toBase58()], f.deps, loader),
    ).rejects.toThrow("mainnet_lut_requires_ops_wallet_lifecycle");
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("recognizes hitlist arguments before the built-in parser and keeps shared options", () => {
    expect(
      parseCli([
        "hitlist",
        "check",
        key(9).toBase58(),
        "--class",
        "major",
        ...mainnet,
      ]).command,
    ).toEqual({
      name: "extension",
      extension: "hitlist",
      args: ["check", key(9).toBase58(), "--class", "major"],
    });
  });
  it("reports the missing K1 module without connecting or reading files", async () => {
    const f = fixture("mainnet");
    await expect(
      runOps(
        [...mainnet, "hitlist", "check", key(9).toBase58()],
        f.deps,
        async () => {
          throw new OpsError("hitlist_extension_unavailable_K1");
        },
      ),
    ).rejects.toThrow("hitlist_extension_unavailable_K1");
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("loads the installed K1 extension without requesting authority", async () => {
    // Compile the dependency graph during suite loading; assert the actual
    // installed module's identity here, independently of transformer timing.
    expect((await loadHitlistExtension()).prepare).toBe(
      installedHitlistPrepare,
    );
  });
  it("lets a read-only hitlist command report without a signer or multisig", async () => {
    const f = fixture("mainnet");
    const loader: ExtensionLoader = async () => ({
      prepare: async (context) => {
        expect(Object.keys(context.rpc).sort()).toEqual([
          "getAccountInfo",
          "getAddressLookupTable",
          "getSlot",
        ]);
        expect(context).not.toHaveProperty("keypair");
        return {
          kind: "report",
          ok: true,
          report: { mint: context.args[1], checked: true },
        };
      },
    });
    const withoutAuthority = mainnet.slice(0, 6);
    const result = await runOps(
      [...withoutAuthority, "hitlist", "check", key(9).toBase58()],
      f.deps,
      loader,
    );
    expect(result).toMatchObject({
      mode: "extension-report",
      ok: true,
      report: { checked: true },
      simulation: null,
    });
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.readMultisig).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("routes extension transactions through the unsigned mainnet path", async () => {
    const f = fixture("mainnet");
    const loader: ExtensionLoader = async () => ({
      prepare: async () => ({
        kind: "transaction",
        verifyIntent(decoded, args) {
          return (
            args[0] === "add" &&
            args[1] === key(9).toBase58() &&
            decoded.length === 1 &&
            decoded[0]!.instruction === "admin_config" &&
            decoded[0]!.action === "setRole" &&
            JSON.stringify(decoded[0]!.args) ===
              JSON.stringify({ role: 3, key: key(9).toBase58() })
          );
        },
        build: async (admin) => ({
          instructions: [
            adminConfigInstruction({
              programId,
              admin,
              action: { setRole: { role: 3, key: key(9) } },
            }),
          ],
        }),
      }),
    });
    const result = await runOps(
      [...mainnet, "hitlist", "add", key(9).toBase58()],
      f.deps,
      loader,
    );
    expect(result).toMatchObject({
      mode: "unsigned-squads-proposal",
      signed: false,
      submitted: false,
    });
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    for (const row of ("unsignedTransactions" in result
      ? result.unsignedTransactions
      : []) ?? [])
      expect(
        VersionedTransaction.deserialize(
          Buffer.from(row.base64, "base64"),
        ).signatures.every((signature) =>
          signature.every((byte) => byte === 0),
        ),
      ).toBe(true);
  });
  it("rejects extension instructions requiring a foreign signer", async () => {
    const f = fixture("mainnet");
    const loader: ExtensionLoader = async () => ({
      prepare: async () => ({
        kind: "transaction",
        build: async () => ({
          instructions: [
            guardianInstruction({
              programId,
              signer: key(9),
              action: { disableBucket: { index: 0 } },
            }),
          ],
        }),
      }),
    });
    await expect(
      runOps([...mainnet, "hitlist", "add", key(9).toBase58()], f.deps, loader),
    ).rejects.toThrow("extension_foreign_signer");
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("K1 hitlist ATA boundary", () => {
  const mint = key(9);
  const oracle = key(88);
  const command = ["hitlist", "add", mint.toBase58(), "--class", "major"];
  const expectedArgs = { class: 1, cap: "99", oracle: oracle.toBase58() };
  function instructions(
    admin: PublicKey,
    tokenProgram: PublicKey = TOKEN_PROGRAMS[0],
  ) {
    const owner = pda("vault_auth", programId);
    const [vault] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM,
    );
    const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
      pubkey,
      isWritable,
      isSigner,
    });
    return [
      new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM,
        data: Buffer.from([1]),
        keys: [
          meta(admin, true, true),
          meta(vault, true),
          meta(owner),
          meta(mint),
          meta(SystemProgram.programId),
          meta(tokenProgram),
        ],
      }),
      new TransactionInstruction({
        programId,
        data: encodeDraftInstruction("admin_list_mint", {
          class: 1,
          cap: 99n,
          oracle,
        }),
        keys: [
          meta(admin, true, true),
          meta(pda("config", programId)),
          meta(pda("machine", programId), true),
          meta(mint),
          meta(
            PublicKey.findProgramAddressSync(
              [Buffer.from("ledger"), mint.toBuffer()],
              programId,
            )[0],
            true,
          ),
          meta(vault),
          meta(owner),
          meta(tokenProgram),
          meta(SystemProgram.programId),
        ],
      }),
    ];
  }
  function loader(
    mutate: (
      rows: TransactionInstruction[],
      authority: PublicKey,
    ) => TransactionInstruction[] = (rows) => rows,
    tokenProgram: PublicKey = TOKEN_PROGRAMS[0],
  ): ExtensionLoader {
    return async () => ({
      prepare: async () => ({
        kind: "transaction",
        build: async (authority) => ({
          instructions: mutate(
            instructions(authority, tokenProgram),
            authority,
          ),
        }),
        verifyIntent(decoded, args) {
          return (
            JSON.stringify(args) === JSON.stringify(command.slice(1)) &&
            decoded.length === 2 &&
            decoded[0]!.instruction === "create_idempotent" &&
            (decoded[0]!.args as { mint: string }).mint === mint.toBase58() &&
            decoded[1]!.instruction === "admin_list_mint" &&
            decoded[1]!.action === null &&
            JSON.stringify(decoded[1]!.args) === JSON.stringify(expectedArgs)
          );
        },
      }),
    });
  }
  it("decodes the M1 admin_list_mint byte layout, including class, cap and oracle", () => {
    const listing = instructions(authority)[1]!;
    expect(listing.data.toString("hex")).toBe(
      `3b3a1d49dcc8cd2a016300000000000000${"58".repeat(32)}`,
    );
    expect(decodeDraftInstruction(listing)).toEqual({
      instruction: "admin_list_mint",
      action: null,
      args: expectedArgs,
      accountNames: [
        "admin",
        "config",
        "machine",
        "mint",
        "ledger",
        "vault",
        "vault_auth",
        "token_program",
        "system_program",
      ],
    });
  });
  it.each(["devnet", "mainnet"] as const)(
    "runs a verified hitlist pair on %s for both token programs",
    async (cluster) => {
      for (const tokenProgram of TOKEN_PROGRAMS) {
        const f = fixture(cluster);
        const result = await runOps(
          [...(cluster === "devnet" ? base : mainnet), ...command],
          f.deps,
          loader(undefined, tokenProgram),
        );
        if (cluster === "devnet") {
          expect(result).toMatchObject({ mode: "devnet-confirmed" });
          expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
          expect(f.rpc.simulateTransaction).toHaveBeenCalledTimes(1);
          const [raw] = f.rpc.sendRawTransaction.mock.calls[0]!;
          const transaction = VersionedTransaction.deserialize(raw);
          expect(transaction.message.compiledInstructions).toHaveLength(2);
          expect(transaction.signatures[0]!.some((byte) => byte !== 0)).toBe(
            true,
          );
        } else {
          const [vault] = squads.getVaultPda({
            multisigPda: multisig,
            index: 0,
          });
          expect(result).toMatchObject({
            mode: "unsigned-squads-proposal",
            signed: false,
            submitted: false,
            ok: true,
            instructions: [
              {
                decoded: {
                  instruction: "create_idempotent",
                  args: {
                    payer: vault.toBase58(),
                    mint: mint.toBase58(),
                    tokenProgram: tokenProgram.toBase58(),
                  },
                },
              },
              {
                decoded: { instruction: "admin_list_mint", args: expectedArgs },
              },
            ],
          });
          expect(f.readText).not.toHaveBeenCalled();
          expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
          expect(f.rpc.simulateTransaction).toHaveBeenCalledTimes(4);
          const exported =
            "unsignedTransactions" in result ? result.unsignedTransactions : [];
          expect(exported).toHaveLength(2);
          for (const row of exported ?? []) {
            const tx = VersionedTransaction.deserialize(
              Buffer.from(row.base64, "base64"),
            );
            expect(
              tx.signatures.every((signature) =>
                signature.every((byte) => byte === 0),
              ),
            ).toBe(true);
            expect(row.simulation.ok).toBe(true);
          }
        }
      }
    },
  );
  const invalid: [
    string,
    string,
    (
      rows: TransactionInstruction[],
      authority: PublicKey,
    ) => TransactionInstruction[],
  ][] = [
    [
      "transfer",
      "extension_program_forbidden",
      (rows, payer) => [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: key(98),
          lamports: 1,
        }),
        ...rows,
      ],
    ],
    [
      "noncanonical ATA",
      "extension_ata_noncanonical",
      (rows) => {
        rows[0]!.keys[1]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "second ATA",
      "extension_ata_count_exceeded",
      (rows) => [rows[0]!, ...rows],
    ],
    [
      "non-idempotent ATA",
      "extension_ata_instruction_forbidden",
      (rows) => {
        rows[0]!.data = Buffer.from([0]);
        return rows;
      },
    ],
    [
      "trailing ATA data",
      "extension_ata_instruction_forbidden",
      (rows) => {
        rows[0]!.data = Buffer.from([1, 0]);
        return rows;
      },
    ],
    [
      "ATA after listing",
      "extension_ata_listing_mismatch",
      (rows) => rows.reverse(),
    ],
    [
      "missing listing",
      "extension_ata_listing_mismatch",
      (rows) => rows.slice(0, 1),
    ],
    [
      "listing a different mint",
      "extension_ata_listing_mismatch",
      (rows) => {
        rows[1]!.keys[3]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "listing a different vault",
      "extension_ata_listing_mismatch",
      (rows) => {
        rows[1]!.keys[5]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "listing a different owner",
      "extension_ata_listing_mismatch",
      (rows) => {
        rows[1]!.keys[6]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "listing a different token program",
      "extension_ata_listing_mismatch",
      (rows) => {
        rows[1]!.keys[7]!.pubkey = TOKEN_PROGRAMS[1];
        return rows;
      },
    ],
    [
      "wrong ATA owner",
      "extension_ata_accounts_mismatch",
      (rows) => {
        rows[0]!.keys[2]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "unknown token program",
      "extension_ata_accounts_mismatch",
      (rows) => {
        rows[0]!.keys[5]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "wrong system program",
      "extension_ata_accounts_mismatch",
      (rows) => {
        rows[0]!.keys[4]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "extra ATA account",
      "extension_ata_accounts_mismatch",
      (rows) => {
        rows[0]!.keys.push({
          pubkey: key(98),
          isSigner: false,
          isWritable: false,
        });
        return rows;
      },
    ],
    [
      "writable owner",
      "extension_ata_accounts_mismatch",
      (rows) => {
        rows[0]!.keys[2]!.isWritable = true;
        return rows;
      },
    ],
    [
      "foreign payer",
      "extension_foreign_signer",
      (rows) => {
        rows[0]!.keys[0]!.pubkey = key(98);
        return rows;
      },
    ],
    [
      "mismatched class",
      "extension_intent_mismatch",
      (rows) => {
        rows[1]!.data[8] = 2;
        return rows;
      },
    ],
    [
      "mismatched cap",
      "extension_intent_mismatch",
      (rows) => {
        rows[1]!.data[9] = 100;
        return rows;
      },
    ],
    [
      "mismatched oracle",
      "extension_intent_mismatch",
      (rows) => {
        rows[1]!.data[17] = 89;
        return rows;
      },
    ],
  ];
  it.each(invalid)(
    "refuses %s before simulation or signing",
    async (_name, code, mutate) => {
      const f = fixture("mainnet");
      await expect(
        runOps([...mainnet, ...command], f.deps, loader(mutate)),
      ).rejects.toMatchObject({ code });
      expect(f.readText).not.toHaveBeenCalled();
      expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    },
  );
});

describe("LUT operations", () => {
  const table = (
    owner: PublicKey | undefined,
    addresses: PublicKey[] = [key(11)],
  ) =>
    new AddressLookupTableAccount({
      key: key(10),
      state: {
        authority: owner,
        addresses,
        deactivationSlot: (1n << 64n) - 1n,
        lastExtendedSlot: 90,
        lastExtendedSlotStartIndex: 0,
      },
    });
  it("uses the confirmed authority and a finalized recent slot for creation", async () => {
    const f = fixture();
    const plan = await buildOperation(
      parseCli([...base, "lut", "create"]),
      authority,
      f.rpc as unknown as OpsRpc,
      f.deps,
    );
    const expected = AddressLookupTableProgram.createLookupTable({
      authority,
      payer: authority,
      recentSlot: 100,
    });
    expect(plan.lookupTable).toBe(expected[1].toBase58());
    expect(plan.instructions[0]!.data).toEqual(expected[0].data);
    expect(f.rpc.getSlot).toHaveBeenCalledWith("finalized");
  });
  it("extends and freezes through the web3 canonical builders", async () => {
    const f = fixture();
    f.rpc.getAddressLookupTable.mockResolvedValue({
      context: { slot: 100 },
      value: table(authority),
    });
    const build = (args: string[]) =>
      buildOperation(
        parseCli([...base, ...args]),
        authority,
        f.rpc as unknown as OpsRpc,
        f.deps,
      );
    const extend = (
      await build([
        "lut",
        "extend",
        "--lut",
        key(10).toBase58(),
        "--addresses",
        key(12).toBase58(),
      ])
    ).instructions[0]!;
    expect(
      AddressLookupTableInstruction.decodeExtendLookupTable(extend),
    ).toMatchObject({ addresses: [key(12)] });
    const freeze = (await build(["lut", "freeze", "--lut", key(10).toBase58()]))
      .instructions[0]!;
    expect(
      AddressLookupTableInstruction.decodeFreezeLookupTable(
        freeze,
      ).authority.equals(authority),
    ).toBe(true);
  });
  it("rejects absent, frozen, foreign, empty, duplicate or full tables", async () => {
    const f = fixture();
    const input = parseCli([
      ...base,
      "lut",
      "freeze",
      "--lut",
      key(10).toBase58(),
    ]);
    for (const value of [
      null,
      table(undefined),
      table(key(99)),
      table(authority, []),
    ]) {
      f.rpc.getAddressLookupTable.mockResolvedValue({
        context: { slot: 100 },
        value,
      });
      await expect(
        buildOperation(input, authority, f.rpc as unknown as OpsRpc, f.deps),
      ).rejects.toMatchObject({
        code:
          value?.state.addresses.length === 0
            ? "lut_empty"
            : "lut_missing_inactive_or_wrong_authority",
      });
    }
    f.rpc.getAddressLookupTable.mockResolvedValue({
      context: { slot: 100 },
      value: table(authority),
    });
    await expect(
      buildOperation(
        parseCli([
          ...base,
          "lut",
          "extend",
          "--lut",
          key(10).toBase58(),
          "--addresses",
          key(11).toBase58(),
        ]),
        authority,
        f.rpc as unknown as OpsRpc,
        f.deps,
      ),
    ).rejects.toThrow("duplicate_lut_address");
  });
  it("caps the transaction wire size rather than sending an oversized extension", async () => {
    const f = fixture();
    f.rpc.getAddressLookupTable.mockResolvedValue({
      context: { slot: 100 },
      value: table(f.signer.publicKey),
    });
    const addresses = Array.from({ length: 40 }, (_, i) =>
      key(i + 30).toBase58(),
    ).join(",");
    await expect(
      runOps(
        [
          ...base,
          "lut",
          "extend",
          "--lut",
          key(10).toBase58(),
          "--addresses",
          addresses,
        ],
        f.deps,
      ),
    ).rejects.toThrow("transaction_too_large_split_lut_extension");
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("D23 audited operation checks", () => {
  const season = [
    "set-season",
    "--slot",
    "100",
    "--ts",
    "1791475200",
    "--stock-up-ts",
    "1791561600",
  ];
  const localMainnet = [
    ...mainnet.slice(0, 6),
    "--keypair",
    "/private/operator.json",
  ];

  it("rejects an inconsistent season timestamp before any file read or signature", async () => {
    const f = fixture();
    f.rpc.getBlockTime.mockResolvedValue(1791475201);
    await expect(runOps([...base, ...season], f.deps)).rejects.toMatchObject({
      code: "season_ts_mismatch",
    });
    expect(f.rpc.getSlot).toHaveBeenCalledWith("finalized");
    expect(f.rpc.getBlockTime).toHaveBeenCalledWith(100);
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it.each(["0", "101", "18446744073709551615"])(
    "requires a positive finalized snapshot slot: %s",
    async (slot) => {
      const f = fixture();
      const args = [...season];
      args[2] = slot;
      await expect(runOps([...base, ...args], f.deps)).rejects.toMatchObject({
        code: "season_slot_not_finalized",
      });
      expect(f.readText).not.toHaveBeenCalled();
      expect(f.rpc.getBlockTime).not.toHaveBeenCalled();
    },
  );
  it("refuses an unknown block time before loading keys", async () => {
    const f = fixture();
    f.rpc.getBlockTime.mockResolvedValue(null);
    await expect(runOps([...base, ...season], f.deps)).rejects.toMatchObject({
      code: "season_block_time_unknown",
    });
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("round-trips the exact parsed args for every protocol command", async () => {
    const f = fixture();
    const rows = [
      {
        args: ["init", "/public/params.json"],
        action: null,
        expected: initial.args.params,
      },
      {
        args: season,
        action: "setSeason",
        expected: {
          snapshot_slot: "100",
          snapshot_ts: "1791475200",
          stock_up_ts: "1791561600",
        },
      },
      {
        args: role,
        action: "setRole",
        expected: { role: 3, key: key(9).toBase58() },
      },
      {
        args: ["guardian", "SetPause", "--bits", "3", "--paused", "true"],
        action: "setPause",
        expected: { bits: 3, paused: true },
      },
      {
        args: ["guardian", "DisableBucket", "--index", "15"],
        action: "disableBucket",
        expected: { index: 15 },
      },
      {
        args: [
          "guardian",
          "LowerCap",
          "--index",
          "2",
          "--cap",
          "18446744073709551615",
        ],
        action: "lowerCap",
        expected: { index: 2, cap: "18446744073709551615" },
      },
      {
        args: ["guardian", "DisableRole", "--role", "keeper"],
        action: "disableRole",
        expected: { role: 3 },
      },
      {
        args: ["guardian", "SelectVrfQueue", "--index", "3"],
        action: "selectVrfQueue",
        expected: { index: 3 },
      },
    ];
    for (const row of rows) {
      const input = parseCli([...base, ...row.args]);
      const plan = await buildOperation(
        input,
        authority,
        f.rpc as unknown as OpsRpc,
        f.deps,
      );
      const instruction = plan.instructions[0]!;
      const decoded = verifyOperationInstruction(
        input,
        instruction,
        input.command.name === "init" ? params : undefined,
      );
      expect(decoded).toMatchObject({ action: row.action, args: row.expected });
      expect(decoded.accountNames).toHaveLength(instruction.keys.length);
      instruction.data[instruction.data.length - 1]! ^= 1;
      expect(() =>
        verifyOperationInstruction(input, instruction, params),
      ).toThrowError(new OpsError("instruction_intent_mismatch"));
    }
  });
  it("fails the build if the builder changes one data byte", async () => {
    const f = fixture();
    const original = draftAdapter.adminConfigInstruction;
    const builder = vi
      .spyOn(draftAdapter, "adminConfigInstruction")
      .mockImplementation((input) => {
        const instruction = original(input);
        instruction.data[instruction.data.length - 1]! ^= 1;
        return instruction;
      });
    try {
      await expect(
        buildOperation(
          parseCli([...base, ...role]),
          authority,
          f.rpc as unknown as OpsRpc,
          f.deps,
        ),
      ).rejects.toMatchObject({ code: "instruction_intent_mismatch" });
      expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    } finally {
      builder.mockRestore();
    }
  });
  it("exports decoded Squads material, signals admin changes, and simulates both exported transactions", async () => {
    const f = fixture("mainnet");
    const result = await runOps(
      [...mainnet, "role", "set", "admin", key(9).toBase58()],
      f.deps,
    );
    expect(result).toMatchObject({
      warnings: ["admin_role_change"],
      instructions: [
        {
          decoded: {
            instruction: "admin_config",
            action: "setRole",
            args: { role: 0, key: key(9).toBase58() },
            accountNames: ["admin", "config", "machine"],
          },
        },
      ],
    });
    expect(f.rpc.simulateTransaction).toHaveBeenCalledTimes(4);
    if (!("unsignedTransactions" in result) || !result.unsignedTransactions)
      throw new Error("Expected unsigned proposal");
    for (const [index, exported] of result.unsignedTransactions.entries()) {
      expect(exported.simulation).toMatchObject({ ok: true });
      const calls = f.rpc.simulateTransaction.mock.calls as unknown as [
        VersionedTransaction,
      ][];
      expect(
        Buffer.from(calls[index + 1]![0].serialize()).toString("base64"),
      ).toBe(exported.base64);
    }
  });
  it("preserves the proposal dependency failure and separately proves create-then-propose simulation", async () => {
    const f = fixture("mainnet");
    f.rpc.simulateTransaction
      .mockResolvedValueOnce({
        context: { slot: 100 },
        value: { err: null, unitsConsumed: 1 },
      })
      .mockResolvedValueOnce({
        context: { slot: 100 },
        value: { err: null, unitsConsumed: 2 },
      })
      .mockResolvedValueOnce({
        context: { slot: 100 },
        value: {
          err: { InstructionError: [0, { Custom: 6009 }] },
          unitsConsumed: 3,
        },
      })
      .mockResolvedValueOnce({
        context: { slot: 100 },
        value: { err: null, unitsConsumed: 4 },
      });
    const result = await runOps([...mainnet, ...role], f.deps);
    expect(result).toMatchObject({
      ok: true,
      sequenceSimulation: { ok: true, scope: "create_then_propose" },
      unsignedTransactions: [
        { purpose: "vault_transaction_create", simulation: { ok: true } },
        {
          purpose: "proposal_create",
          dependsOn: "vault_transaction_create",
          simulation: {
            ok: false,
            error: { InstructionError: [0, { Custom: 6009 }] },
          },
        },
      ],
    });
    const calls = f.rpc.simulateTransaction.mock.calls as unknown as [
      VersionedTransaction,
    ][];
    expect(calls[3]![0].message.compiledInstructions).toHaveLength(2);
    expect(
      calls[3]![0].signatures.every((signature) =>
        signature.every((byte) => byte === 0),
      ),
    ).toBe(true);
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("signs a guardian transaction once on mainnet after typed confirmation and a second genesis check", async () => {
    const f = fixture("mainnet");
    const ordering: string[] = [];
    f.rpc.getGenesisHash.mockImplementation(async () => {
      ordering.push("genesis");
      return GENESIS.mainnet;
    });
    f.deps.confirm = vi.fn(async (_prompt, expected) => {
      ordering.push("confirm");
      return expected;
    });
    const emit = vi.fn();
    f.deps.emit = emit;
    const sign = vi.spyOn(VersionedTransaction.prototype, "sign");
    try {
      const result = await runOps(
        [
          ...localMainnet,
          "guardian",
          "SetPause",
          "--bits",
          "1",
          "--paused",
          "true",
        ],
        f.deps,
      );
      expect(result).toMatchObject({
        cluster: "mainnet",
        mode: "mainnet-confirmed",
      });
      expect(result).not.toHaveProperty("unsignedTransactions");
      expect(sign).toHaveBeenCalledTimes(1);
      expect(ordering).toEqual(["genesis", "confirm", "genesis"]);
      expect(f.deps.confirm).toHaveBeenCalledWith(
        expect.any(String),
        `${programId.toBase58().slice(0, 4)}${programId.toBase58().slice(-4)}`,
      );
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          signer: f.signer.publicKey.toBase58(),
          instructions: [
            expect.objectContaining({
              decoded: expect.objectContaining({ instruction: "guardian" }),
            }),
          ],
        }),
      );
      expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(f.readMultisig).not.toHaveBeenCalled();
    } finally {
      sign.mockRestore();
    }
  });
  it("rejects wrong typed confirmation and a changed genesis without signing", async () => {
    for (const failConfirmation of [true, false]) {
      const f = fixture("mainnet");
      f.deps.confirm = vi.fn(async (_prompt, expected) =>
        failConfirmation ? "incorrect" : expected,
      );
      if (!failConfirmation)
        f.rpc.getGenesisHash
          .mockResolvedValueOnce(GENESIS.mainnet)
          .mockResolvedValueOnce(GENESIS.devnet);
      const sign = vi.spyOn(VersionedTransaction.prototype, "sign");
      try {
        await expect(
          runOps(
            [...localMainnet, "guardian", "DisableBucket", "--index", "0"],
            f.deps,
          ),
        ).rejects.toMatchObject({
          code: failConfirmation
            ? "mainnet_confirmation_mismatch"
            : "rpc_cluster_mismatch",
        });
        expect(sign).not.toHaveBeenCalled();
        expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
      } finally {
        sign.mockRestore();
      }
    }
  });
  it("retains the locally signed public signature when confirmation fails and clears the original secret buffer", async () => {
    const f = fixture();
    const secretJson = JSON.stringify([...f.signer.secretKey]);
    const secretBase58 = publicSignature(f.signer.secretKey);
    f.rpc.confirmTransaction.mockRejectedValue(
      new Error(`${secretJson} ${secretBase58}`),
    );
    const fromSecret = vi.spyOn(Keypair, "fromSecretKey");
    try {
      const result = await runOps([...base, ...role], f.deps);
      const sent = VersionedTransaction.deserialize(
        f.rpc.sendRawTransaction.mock.calls[0]![0],
      );
      expect(result).toMatchObject({
        ok: false,
        mode: "devnet-unconfirmed",
        error: "transaction_confirmation_unknown",
        signature: publicSignature(sent.signatures[0]!),
      });
      expect(JSON.stringify(result)).not.toContain(secretJson);
      expect(JSON.stringify(result)).not.toContain(secretBase58);
      expect(fromSecret.mock.calls[0]![0].every((byte) => byte === 0)).toBe(
        true,
      );
      expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    } finally {
      fromSecret.mockRestore();
    }
  });
  it("refuses extension transactions without a parsed-intent verifier or with mismatched intent", async () => {
    for (const verifyIntent of [undefined, () => false]) {
      const f = fixture("mainnet");
      const loader: ExtensionLoader = async () => ({
        prepare: async () => ({
          kind: "transaction",
          verifyIntent,
          build: async (admin) => ({
            instructions: [
              adminConfigInstruction({
                programId,
                admin,
                action: { setRole: { role: 3, key: key(9) } },
              }),
            ],
          }),
        }),
      });
      await expect(
        runOps(
          [...mainnet, "hitlist", "add", key(9).toBase58()],
          f.deps,
          loader,
        ),
      ).rejects.toMatchObject({
        code: verifyIntent
          ? "extension_intent_mismatch"
          : "extension_intent_verifier_required",
      });
      expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    }
  });
  it("rejects unknown extension programs even when only the authority signs", async () => {
    const f = fixture("mainnet");
    const loader: ExtensionLoader = async () => ({
      prepare: async () => ({
        kind: "transaction",
        build: async (authority) => ({
          instructions: [
            SystemProgram.transfer({
              fromPubkey: authority,
              toPubkey: key(8),
              lamports: 1,
            }),
          ],
        }),
      }),
    });
    await expect(
      runOps([...mainnet, "hitlist", "add", key(9).toBase58()], f.deps, loader),
    ).rejects.toMatchObject({ code: "extension_program_forbidden" });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("refuses mainnet init with an invalid Squads account before loading the deployer", async () => {
    for (const account of [
      null,
      {
        owner: SystemProgram.programId,
        executable: false,
        data: Buffer.alloc(872),
        lamports: 1,
        rentEpoch: 0,
      },
    ]) {
      const f = fixture("mainnet");
      f.readText.mockResolvedValue(
        JSON.stringify({
          ...initial.args.params,
          admin: squads
            .getVaultPda({ multisigPda: multisig, index: 0 })[0]
            .toBase58(),
        }),
      );
      f.rpc.getAccountInfo.mockResolvedValue(account as never);
      f.deps.readMultisig = defaultDependencies.readMultisig;
      const sign = vi.spyOn(VersionedTransaction.prototype, "sign");
      try {
        await expect(
          runOps(
            [
              ...localMainnet,
              "--multisig",
              multisig.toBase58(),
              "init",
              "/public/params.json",
            ],
            f.deps,
          ),
        ).rejects.toMatchObject({ code: "invalid_squads_account" });
        expect(f.readText).toHaveBeenCalledExactlyOnceWith(
          "/public/params.json",
        );
        expect(sign).not.toHaveBeenCalled();
        expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
      } finally {
        sign.mockRestore();
      }
    }
  });
  it("checks the init buffer, vault admin and distinct guardians before reading a key", async () => {
    for (const [changes, code] of [
      [
        {
          rent_buffer_lamports: (
            GOVERNANCE.initRentBufferMaxLamports + 1n
          ).toString(),
        },
        "init_rent_buffer_exceeded",
      ],
      [{ admin: key(8).toBase58() }, "init_admin_must_be_vault"],
      [{ guardians: [key(8).toBase58(), key(8).toBase58()] }, "invalid_input"],
    ] as const) {
      const f = fixture("mainnet");
      f.readText.mockResolvedValue(
        JSON.stringify({
          ...initial.args.params,
          admin: squads
            .getVaultPda({ multisigPda: multisig, index: 0 })[0]
            .toBase58(),
          ...changes,
        }),
      );
      await expect(
        runOps(
          [
            ...localMainnet,
            "--multisig",
            multisig.toBase58(),
            "init",
            "/public/params.json",
          ],
          f.deps,
        ),
      ).rejects.toMatchObject({ code });
      expect(f.readText).toHaveBeenCalledExactlyOnceWith("/public/params.json");
      expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    }
  });
});

describe("D31 direct mainnet admin", () => {
  const direct = [
    ...mainnet.slice(0, 6),
    "--keypair",
    "/private/operator.json",
  ];
  function configure(
    f: ReturnType<typeof fixture>,
    admin = f.signer.publicKey,
  ) {
    f.rpc.getAccountInfo.mockResolvedValue({
      data: configLayout.encode({ version: 1, admin }),
      owner: programId,
      executable: false,
      lamports: 1,
      rentEpoch: 0,
    } as unknown as null);
    f.deps.confirm = vi.fn(async (_prompt, expected) => expected);
  }
  it("signs admin role changes directly after finalized identity, simulation and confirmation", async () => {
    const f = fixture("mainnet");
    configure(f);
    const result = await runOps([...direct, ...role], f.deps);
    expect(result).toMatchObject({
      mode: "mainnet-confirmed",
      authority: String(f.signer.publicKey),
    });
    expect(f.rpc.getAccountInfo).toHaveBeenCalledWith(
      pda("config", programId),
      "finalized",
    );
    expect(f.rpc.getGenesisHash).toHaveBeenCalledTimes(2);
    expect(f.rpc.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(f.readMultisig).not.toHaveBeenCalled();
  });
  it("refuses invalid Config before reading the signer", async () => {
    const f = fixture("mainnet");
    await expect(runOps([...direct, ...role], f.deps)).rejects.toThrow(
      "mainnet_admin_config_invalid",
    );
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("refuses a local signer that is not the current admin", async () => {
    const f = fixture("mainnet");
    configure(f, key(23));
    await expect(runOps([...direct, ...role], f.deps)).rejects.toThrow(
      "mainnet_admin_signer_mismatch",
    );
    expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("requires the existing typed mainnet confirmation", async () => {
    const f = fixture("mainnet");
    configure(f);
    f.deps.confirm = vi.fn(async () => "wrong");
    await expect(runOps([...direct, ...role], f.deps)).rejects.toThrow(
      "mainnet_confirmation_mismatch",
    );
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("initializes for a single public admin without any multisig argument", async () => {
    const f = fixture("mainnet");
    f.deps.confirm = vi.fn(async (_prompt, expected) => expected);
    const result = await runOps(
      [...direct, "init", "/public/params.json"],
      f.deps,
    );
    expect(result).toMatchObject({ mode: "mainnet-confirmed" });
    expect(f.readMultisig).not.toHaveBeenCalled();
  });
  it("exports a generic unsigned admin transaction for a hardware signing workflow", async () => {
    const f = fixture("mainnet");
    configure(f);
    const result = await runOps(
      [...mainnet.slice(0, 6), "--admin", String(f.signer.publicKey), ...role],
      f.deps,
    );
    expect(result).toMatchObject({
      ok: true,
      mode: "unsigned-admin-transaction",
      authority: String(f.signer.publicKey),
    });
    const encoded = (result as { unsignedTransactionBase64: string })
      .unsignedTransactionBase64;
    expect(
      VersionedTransaction.deserialize(
        Buffer.from(encoded, "base64"),
      ).signatures.every((bytes) => bytes.every((byte) => byte === 0)),
    ).toBe(true);
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.readMultisig).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});
