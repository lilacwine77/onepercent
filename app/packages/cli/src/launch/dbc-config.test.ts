import { readFileSync } from "node:fs";
import { meteoraForCluster } from "@onepercent/config";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import { DBC_PROGRAM_ID, encodeDbcConfigFixture } from "@onepercent/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLaunchDbcConfig } from "./dbc-config.js";
import type { LaunchInput } from "./input.js";
import { GENESIS } from "../runtime.js";
const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    folders.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const key = (n: number) => new PublicKey(Buffer.alloc(32, n));
const info = (data: Buffer, owner = DBC_PROGRAM_ID): AccountInfo<Buffer> => ({
  data,
  owner,
  lamports: 100000000,
  executable: false,
  rentEpoch: 0,
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dbc-config-test-"));
  folders.push(directory);
  const configSigner = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(
          new URL(
            "../../../../fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ),
  );
  const wallet = Keypair.generate(),
    program = key(53),
    feeIn = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_in")],
      program,
    )[0];
  const data = await encodeDbcConfigFixture(feeIn);
  const rpc = new Connection("https://rpc.example.test");
  vi.spyOn(rpc, "getRecentPrioritizationFees").mockResolvedValue([
    { slot: 20, prioritizationFee: 10 },
  ]);
  let landed: PublicKey | null = null,
    corrupt = false;
  const input: LaunchInput = {
    command: "config",
    cluster: "devnet",
    rpc: rpc.rpcEndpoint,
    program: program.toBase58(),
    acceptWarnings: false,
  };
  vi.spyOn(rpc, "getGenesisHash").mockResolvedValue(GENESIS.devnet);
  vi.spyOn(rpc, "getAccountInfo").mockImplementation(async (address) =>
    address.equals(wallet.publicKey)
      ? info(Buffer.alloc(0), SystemProgram.programId)
      : landed?.equals(address)
        ? info(corrupt ? Buffer.alloc(12) : data)
        : null,
  );
  vi.spyOn(rpc, "getLatestBlockhash").mockResolvedValue({
    blockhash: key(90).toBase58(),
    lastValidBlockHeight: 400,
  });
  const simulate = vi.spyOn(rpc, "simulateTransaction").mockResolvedValue({
    context: { slot: 20 },
    value: {
      err: null,
      logs: [],
      unitsConsumed: 10000,
      accounts: [
        {
          owner: DBC_PROGRAM_ID.toBase58(),
          executable: false,
          lamports: 1_000_000,
          data: [data.toString("base64"), "base64"],
          rentEpoch: 0,
        },
      ],
    },
  });
  vi.spyOn(rpc, "getBlockHeight").mockResolvedValue(100);
  vi.spyOn(rpc, "getSignatureStatuses").mockImplementation(async () => ({
    context: { slot: 21 },
    value: [
      landed
        ? {
            slot: 21,
            confirmations: null,
            err: null,
            confirmationStatus: "finalized",
          }
        : null,
    ],
  }));
  const send = vi
    .spyOn(rpc, "sendRawTransaction")
    .mockImplementation(async (bytes) => {
      const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
      const instruction = tx.message.compiledInstructions.at(-1)!;
      landed = tx.message.staticAccountKeys[instruction.accountKeyIndexes[0]!]!;
      const files = await readdir(directory);
      expect(files.some((f) => f.endsWith(".json"))).toBe(true);
      const record = JSON.parse(
        await readFile(
          join(
            directory,
            files.find((f) => f.endsWith(".json"))!,
          ),
          "utf8",
        ),
      );
      expect(record.encoded).toBe(Buffer.from(bytes).toString("base64"));
      return record.signature;
    });
  vi.spyOn(rpc, "confirmTransaction").mockResolvedValue({
    context: { slot: 22 },
    value: { err: null },
  });
  const run = (
    overrides: Partial<LaunchInput> = {},
    signer: Keypair | null = configSigner,
  ) =>
    createLaunchDbcConfig(rpc, { ...input, ...overrides }, wallet, {
      directory,
      configSigner: signer ?? undefined,
      emit: () => undefined,
    });
  return {
    run,
    rpc,
    wallet,
    directory,
    send,
    simulate,
    data,
    setCorrupt: () => {
      corrupt = true;
    },
  };
}
describe("immutable DBC config creation", () => {
  it("rejects an empty program identity before account reads", async () => {
    const f = await fixture();
    await expect(
      f.run({ program: PublicKey.default.toBase58() }),
    ).rejects.toThrow("invalid_launch_program");
    expect(f.rpc.getAccountInfo).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("rejects a signer outside the cluster pin before simulating or sending", async () => {
    const f = await fixture();
    await expect(f.run({}, Keypair.generate())).rejects.toThrow(
      "launch_config_cluster_pin_mismatch",
    );
    expect(f.simulate).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("requires the selected config signer when the pinned account is absent", async () => {
    const f = await fixture();
    await expect(f.run({}, null)).rejects.toThrow(
      "launch_config_signer_unavailable",
    );
    expect(f.simulate).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("rejects the public test signer on mainnet before reading accounts", async () => {
    const f = await fixture();
    vi.mocked(f.rpc.getGenesisHash).mockResolvedValue(GENESIS.mainnet);
    await expect(f.run({ cluster: "mainnet" })).rejects.toThrow(
      "launch_config_test_signer_forbidden_on_mainnet",
    );
    expect(f.rpc.getAccountInfo).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("simulates one transaction, persists before sending, verifies finalized fields and resumes without another config", async () => {
    const f = await fixture();
    const result = await f.run();
    expect(result.ok).toBe(true);
    expect(result.config).toBe(meteoraForCluster("devnet").dbcConfig);
    expect(result.migrationQuoteThreshold).toBe("85000000000");
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.simulate).toHaveBeenCalledTimes(1);
    const resumed = await f.run();
    expect(resumed).toMatchObject({
      ok: true,
      config: result.config,
      reconciled: true,
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    const files = await readdir(f.directory);
    expect(files).toHaveLength(1);
    const record = JSON.parse(
      await readFile(join(f.directory, files[0]!), "utf8"),
    );
    expect(record).not.toHaveProperty("secretKey");
  });
  it("refuses simulation errors before signing or submitting", async () => {
    const f = await fixture();
    f.simulate.mockResolvedValueOnce({
      context: { slot: 20 },
      value: { err: { InstructionError: [0, "InvalidArgument"] }, logs: [] },
    });
    await expect(f.run()).rejects.toThrow("launch_config_simulation_failed");
    expect(f.send).not.toHaveBeenCalled();
    expect(await readdir(f.directory)).toEqual([]);
  });
  it("rejects an unsupported simulated config version before signing or sending", async () => {
    const f = await fixture();
    const response = await f.simulate.getMockImplementation()!(
      {} as never,
      {} as never,
    );
    const account = response.value.accounts![0]!;
    const data = Buffer.from(account.data[0]!, "base64");
    // version follows the four selector bytes at offset 232.
    data[236] = 2;
    f.simulate.mockResolvedValue({
      ...response,
      value: {
        ...response.value,
        accounts: [{ ...account, data: [data.toString("base64"), "base64"] }],
      },
    });
    await expect(f.run()).rejects.toThrow("dbc_config_fields:version");
    expect(f.send).not.toHaveBeenCalled();
    expect(await readdir(f.directory)).toEqual([]);
  });
  it("fails closed if finalized config cannot be decoded", async () => {
    const f = await fixture();
    f.setCorrupt();
    await expect(f.run()).rejects.toThrow("launch_dbc_config_invalid");
  });
  it("will not create a different threshold under an existing journal", async () => {
    const f = await fixture();
    await f.run();
    await expect(f.run({ migrationThresholdSol: "90" })).rejects.toThrow(
      "launch_config_journal_identity_mismatch",
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("checks genesis before account reads", async () => {
    const f = await fixture();
    vi.mocked(f.rpc.getGenesisHash).mockResolvedValue(GENESIS.mainnet);
    await expect(f.run()).rejects.toThrow("launch_genesis_mismatch");
    expect(f.rpc.getAccountInfo).not.toHaveBeenCalled();
  });
  it("refuses foreign signed bytes in the journal", async () => {
    const f = await fixture();
    const result = await f.run();
    const path = join(f.directory, (await readdir(f.directory))[0]!);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.config = key(91).toBase58();
    await writeFile(path, JSON.stringify(record));
    await expect(f.run()).rejects.toThrow(
      "launch_config_signer_identity_mismatch",
    );
    expect(result.ok).toBe(true);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
});
