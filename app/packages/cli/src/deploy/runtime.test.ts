import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { configLayout, machineLayout } from "@onepercent/sdk";
import type { AccountInfo } from "@solana/web3.js";
import { deploymentInitSchema, parseDeploymentInput } from "./input.js";
import {
  deploymentAddresses,
  runDeployment,
  verifyConfig,
  verifyProgramAuthority,
} from "./runtime.js";
import type { DeploymentDependencies } from "./runtime.js";
import { programDataPda, UPGRADEABLE_LOADER } from "../m1-adapter.js";
import { publicSignature } from "../runtime.js";

const signers = Array.from({ length: 14 }, () => Keypair.generate());
const keys = signers.map((signer) => signer.publicKey);
const [
  program,
  deployer,
  founder,
  ops,
  g0,
  g1,
  keeper,
  executor,
  intake,
  quote,
  team,
  mint,
  queue,
] = keys as [
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
  PublicKey,
];
const source = () => ({
  founder_admin: String(founder),
  ops_wallet: String(ops),
  params: {
    admin: String(deployer),
    guardians: [String(g0), String(g1)],
    keeper: String(keeper),
    executor: String(executor),
    intake_signer: String(intake),
    quote_signer: String(quote),
    launch_wallet: String(deployer),
    team_wallet: String(team),
    team_wallets: [
      founder,
      deployer,
      ops,
      team,
      PublicKey.default,
      PublicKey.default,
      PublicKey.default,
      PublicKey.default,
    ].map(String),
    token_mint: String(mint),
    vrf_queue: String(queue),
    rent_buffer_lamports: "0",
  },
});
const common = [
  "--cluster",
  "localnet",
  "--rpc",
  "http://127.0.0.1:8899",
  "--program",
  String(program),
  "--init",
  "/outside/init.json",
];
function account(
  data: Buffer,
  owner = program,
  executable = false,
): AccountInfo<Buffer> {
  return { data, owner, executable, lamports: 1, rentEpoch: 0 };
}
function loader(authority = deployer) {
  const p = Buffer.alloc(36);
  p.writeUInt32LE(2);
  programDataPda(program).toBuffer().copy(p, 4);
  const pd = Buffer.alloc(46);
  pd.writeUInt32LE(3);
  pd[12] = 1;
  authority.toBuffer().copy(pd, 13);
  return [
    account(p, UPGRADEABLE_LOADER, true),
    account(pd, UPGRADEABLE_LOADER),
  ] as const;
}
function config(admin = deployer) {
  const p = source().params;
  return configLayout.encode({
    admin,
    guardians: [g0, g1],
    keeper,
    executor,
    intake_signer: intake,
    quote_signer: quote,
    launch_wallet: deployer,
    team_wallet: team,
    team_wallets: p.team_wallets.map((value) => new PublicKey(value)),
    token_mint: mint,
    vrf_queues: [
      queue,
      PublicKey.default,
      PublicKey.default,
      PublicKey.default,
    ],
    version: 1,
  });
}
function dependencies(initialized = false) {
  const loaded = vi.fn(async () => {
    throw new Error("signer must remain unopened");
  });
  const rpc = {
    getGenesisHash: vi.fn(async () => "local-validator"),
    getMultipleAccountsInfoAndContext: vi.fn(async () => ({
      context: { slot: 100 },
      value: [
        ...loader(),
        initialized ? account(config()) : null,
        initialized ? account(machineLayout.encode({ version: 1 })) : null,
      ],
    })),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: String(keys[13]),
      lastValidBlockHeight: 200,
    })),
    simulateTransaction: vi.fn(async () => ({
      context: { slot: 100 },
      value: { err: null },
    })),
    sendRawTransaction: vi.fn(async (data: Uint8Array) =>
      publicSignature(VersionedTransaction.deserialize(data).signatures[0]!),
    ),
    confirmTransaction: vi.fn(async () => ({
      context: { slot: 101 },
      value: { err: null },
    })),
  };
  const emit = vi.fn();
  const deps: DeploymentDependencies = {
    connect: () =>
      rpc as unknown as ReturnType<DeploymentDependencies["connect"]>,
    readText: async () => JSON.stringify(source()),
    readSigner: loaded,
    emit,
  };
  return { deps, rpc, loaded, emit };
}
describe("D31 deployment input and authority", () => {
  it("accepts public founder, deployer and separate operator roles", () => {
    expect(
      deploymentInitSchema.parse(source()).params.rent_buffer_lamports,
    ).toBe(0n);
  });
  it.each(["admin", "keeper", "executor", "quote_signer", "launch_wallet"])(
    "rejects role alias or wrong initial %s",
    (field) => {
      const value = source();
      Object.assign(value.params, { [field]: String(founder) });
      expect(deploymentInitSchema.safeParse(value).success).toBe(false);
    },
  );
  it("rejects private arrays, unknown fields and unpublished ops wallet", () => {
    expect(
      deploymentInitSchema.safeParse({ ...source(), secret: [1, 2, 3] })
        .success,
    ).toBe(false);
    const value = source();
    value.params.team_wallets[2] = String(PublicKey.default);
    expect(deploymentInitSchema.safeParse(value).success).toBe(false);
  });
  it("does not accept read-only wallet flags or mixed season flags", () => {
    expect(() =>
      parseDeploymentInput([
        "check",
        ...common,
        "--stage",
        "handoff",
        "--wallet",
        "/secret",
      ]),
    ).toThrow();
    expect(() =>
      parseDeploymentInput([
        "init",
        ...common,
        "--wallet",
        "/secret",
        "--slot",
        "10",
      ]),
    ).toThrow();
  });
  it("derives the same six addresses required by the managed protocol LUT", () => {
    expect(deploymentAddresses(program).protocolLutAddresses).toHaveLength(6);
    expect(deploymentAddresses(program).protocolLutAddresses[4]).toBe(
      String(SystemProgram.programId),
    );
  });
  it("requires a nonzero init mint but accepts the public program as a Setup placeholder", () => {
    const value = source();
    for (const token_mint of [undefined, null, "", String(PublicKey.default)])
      expect(
        deploymentInitSchema.safeParse({
          ...value,
          params: { ...value.params, token_mint },
        }).success,
      ).toBe(false);
    expect(
      deploymentInitSchema.parse({
        ...value,
        params: { ...value.params, token_mint: String(program) },
      }).params.token_mint,
    ).toBe(String(program));
  });
  it("validates loader owner, type, program-data link and present authority", () => {
    const [p, pd] = loader();
    expect(verifyProgramAuthority(p, pd, program).equals(deployer)).toBe(true);
    expect(() =>
      verifyProgramAuthority(
        { ...p, owner: SystemProgram.programId },
        pd,
        program,
      ),
    ).toThrow();
    pd.data[12] = 0;
    expect(() => verifyProgramAuthority(p, pd, program)).toThrow();
  });
  it("requires every initialized role and the exact founder after handover", () => {
    const init = deploymentInitSchema.parse(source());
    expect(() =>
      verifyConfig(configLayout.decode(config(founder)), init, String(founder)),
    ).not.toThrow();
    expect(() =>
      verifyConfig(configLayout.decode(config()), init, String(founder)),
    ).toThrow();
  });
  it("checks the deployed program without reading a signer", async () => {
    const { deps, loaded } = dependencies();
    expect(
      await runDeployment(["check", ...common, "--stage", "deployed"], deps),
    ).toMatchObject({
      ok: true,
      upgradeAuthority: String(deployer),
      admin: null,
    });
    expect(loaded).not.toHaveBeenCalled();
  });
  it("checks initialized identities and rejects incomplete handover", async () => {
    const { deps } = dependencies(true);
    expect(
      await runDeployment(["check", ...common, "--stage", "initialized"], deps),
    ).toMatchObject({ ok: true, admin: String(deployer) });
    await expect(
      runDeployment(["check", ...common, "--stage", "handoff"], deps),
    ).rejects.toThrow("deployment_upgrade_authority_mismatch");
  });
  it("prints exact instruction confirmation after simulation, before opening any signer", async () => {
    const { deps, loaded, emit } = dependencies();
    await expect(
      runDeployment(["init", ...common, "--wallet", "/outside/deployer"], deps),
    ).rejects.toThrow("deployment_confirmation_required");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "deployment-plan",
        confirmation: expect.stringMatching(/:init:[0-9a-f]{64}$/),
      }),
    );
    expect(loaded).not.toHaveBeenCalled();
  });
  it("refuses failed simulation before loading any signer", async () => {
    const { deps, rpc, loaded } = dependencies();
    rpc.simulateTransaction.mockResolvedValue({
      context: { slot: 100 },
      value: { err: "AccountNotFound" as unknown as null },
    });
    await expect(
      runDeployment(["init", ...common, "--wallet", "/outside/deployer"], deps),
    ).rejects.toThrow("deployment_simulation_failed");
    expect(loaded).not.toHaveBeenCalled();
  });
  it("verifies finalized init postconditions at the confirmation slot", async () => {
    const { deps, rpc, emit } = dependencies();
    const argv = ["init", ...common, "--wallet", "/outside/deployer"];
    await expect(runDeployment(argv, deps)).rejects.toThrow(
      "deployment_confirmation_required",
    );
    const confirmation = String(emit.mock.calls[0]![0].confirmation);
    deps.readSigner = async () => signers[1]!;
    rpc.getMultipleAccountsInfoAndContext.mockImplementation(async () => ({
      context: { slot: 101 },
      value: [
        ...loader(),
        ...(rpc.sendRawTransaction.mock.calls.length
          ? [account(config()), account(machineLayout.encode({ version: 1 }))]
          : [null, null]),
      ],
    }));
    expect(
      await runDeployment([...argv, "--confirm", confirmation], deps),
    ).toMatchObject({ ok: true, admin: String(deployer), slot: 101 });
    expect(rpc.getMultipleAccountsInfoAndContext).toHaveBeenLastCalledWith(
      expect.any(Array),
      { commitment: "finalized", minContextSlot: 101 },
    );
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("returns the locally computed signature on an ambiguous send and never resends", async () => {
    const { deps, rpc, emit } = dependencies();
    const argv = ["init", ...common, "--wallet", "/outside/deployer"];
    await expect(runDeployment(argv, deps)).rejects.toThrow(
      "deployment_confirmation_required",
    );
    const confirmation = String(emit.mock.calls[0]![0].confirmation);
    deps.readSigner = async () => signers[1]!;
    rpc.sendRawTransaction.mockRejectedValue(
      new Error("provider credentials must never appear"),
    );
    expect(
      await runDeployment([...argv, "--confirm", confirmation], deps),
    ).toMatchObject({
      ok: false,
      signature: expect.any(String),
      error: "deployment_reconcile_signature_before_retry",
    });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.confirmTransaction).not.toHaveBeenCalled();
  });
});
