import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ONEPERCENT_PROGRAM_IDS } from "@onepercent/config";
import { parseRescueArgs } from "./input.js";
import {
  jsonRecord,
  readSigner,
  rescueDependencies,
  rescueExit,
  runRescue,
} from "./runtime.js";

const wallet = Keypair.generate().publicKey.toBase58();
const rpc = "https://user:credential@rpc.example/private?token=secret";
describe("rescue CLI boundaries", () => {
  it("reads the explicit signer file once and retains signing bytes until cleanup", async () => {
    const original = Keypair.generate();
    let reads = 0;
    const input = parseRescueArgs([
      "all",
      "--rpc",
      rpc,
      "--keypair",
      "explicit-file",
    ]);
    const handle = await readSigner(input, {
      ...rescueDependencies,
      readText: async (path) => {
        expect(path).toBe("explicit-file");
        reads++;
        return JSON.stringify([...original.secretKey]);
      },
    });
    expect(reads).toBe(1);
    expect(
      Buffer.from(handle!.signer.secretKey).equals(
        Buffer.from(original.secretKey),
      ),
    ).toBe(true);
    handle!.clear();
    expect(handle!.signer.secretKey.every((byte) => byte === 0)).toBe(true);
  });
  it("requires a supplied RPC and never guesses an unpublished program id", async () => {
    expect(() => parseRescueArgs(["status"])).toThrow("invalid_arguments");
    await expect(
      runRescue(["status", "--rpc", rpc, "--cluster", "localnet"]),
    ).rejects.toThrow("program_id_not_published_use_advanced_program");
    if (ONEPERCENT_PROGRAM_IDS.mainnet === null)
      await expect(runRescue(["status", "--rpc", rpc])).rejects.toThrow(
        "program_id_not_published_use_advanced_program",
      );
  });
  it("defaults to mainnet and accepts an explicit program on any cluster", () => {
    expect(parseRescueArgs(["status", "--rpc", rpc])).toMatchObject({
      cluster: "mainnet",
      program: undefined,
    });
    expect(
      parseRescueArgs(["status", "--rpc", rpc, "--cluster", "mainnet-beta"]),
    ).toMatchObject({ cluster: "mainnet" });
    expect(
      parseRescueArgs([
        "status",
        "--rpc",
        rpc,
        "--cluster",
        "devnet",
        "--program",
        wallet,
      ]),
    ).toMatchObject({ cluster: "devnet", program: wallet });
    for (const cluster of ["canary", "testnet", ""])
      expect(() =>
        parseRescueArgs(["status", "--rpc", rpc, "--cluster", cluster]),
      ).toThrow("invalid_arguments");
  });
  it("parses the Binder exits as owner-signed and the crank as permissionless", () => {
    for (const command of ["withdraw-owed", "close-my-cards"]) {
      expect(
        parseRescueArgs([command, "--rpc", rpc, "--keypair", "owner.json"]),
      ).toMatchObject({ command, signerFile: "owner.json" });
      expect(() =>
        parseRescueArgs([command, "--rpc", rpc, "--fee-payer", "payer.json"]),
      ).toThrow("invalid_arguments");
      expect(() =>
        parseRescueArgs([
          command,
          "--all",
          "--rpc",
          rpc,
          "--keypair",
          "owner.json",
        ]),
      ).toThrow("invalid_arguments");
    }
    expect(
      parseRescueArgs([
        "crank",
        "advance-phase",
        "--rpc",
        rpc,
        "--fee-payer",
        "payer.json",
      ]),
    ).toMatchObject({ command: "crank", crank: "advance-phase" });
    for (const args of [
      ["crank", "advance-phase", "--keypair", "owner.json"],
      ["crank", "--fee-payer", "payer.json"],
      ["crank", "unknown", "--fee-payer", "payer.json"],
    ])
      expect(() => parseRescueArgs([...args, "--rpc", rpc])).toThrow(
        "invalid_arguments",
      );
    expect(() =>
      parseRescueArgs([
        "crank",
        "start-final-pull",
        "--rpc",
        rpc,
        "--fee-payer",
        "payer.json",
      ]),
    ).toThrow("start_final_pull_ships_with_final_pull_upgrade");
  });
  it("accepts public-only unsigned building without reading a signer", () => {
    expect(
      parseRescueArgs([
        "redeem",
        "--rpc",
        rpc,
        "--program",
        wallet,
        "--all",
        "--unsigned",
        "--wallet",
        wallet,
      ]),
    ).toMatchObject({
      command: "redeem",
      wallet,
      signerFile: undefined,
      unsigned: true,
    });
  });
  it("requires a signer for sends and rejects mismatched flags", () => {
    for (const args of [
      ["redeem", "--all", "--wallet", wallet],
      ["redeem", "--all", "--entry", "1", "--keypair", "wallet.json"],
      ["redeem", "--all", "--card", "1", "--keypair", "wallet.json"],
      ["take-back", "--entry", "1", "--entry", "1", "--keypair", "wallet.json"],
      ["refund", "--all-due", "--keypair", "wallet.json"],
      ["all", "--fee-payer", "wallet.json"],
      ["status", "--keypair", "wallet.json"],
      ["settle", "--all-open", "--pull", wallet, "--fee-payer", "wallet.json"],
    ])
      expect(() => parseRescueArgs([...args, "--rpc", rpc])).toThrow(
        "invalid_arguments",
      );
  });
  it("bounds integer indices and max transactions", () => {
    for (const index of ["-1", "1e2", "1.5", "65536"])
      expect(() =>
        parseRescueArgs([
          "redeem",
          "--rpc",
          rpc,
          "--card",
          index,
          "--keypair",
          "wallet.json",
        ]),
      ).toThrow();
    for (const max of ["0", "-1", "1.2", "Infinity"])
      expect(() =>
        parseRescueArgs([
          "all",
          "--rpc",
          rpc,
          "--max",
          max,
          "--keypair",
          "wallet.json",
        ]),
      ).toThrow();
  });
  it("redacts unexpected provider errors and serializes quantities exactly", () => {
    expect(rescueExit(new Error(rpc))).toEqual({
      code: "rescue_failed",
      exitCode: 1,
    });
    expect(jsonRecord({ amount: 18446744073709551615n })).toBe(
      '{"amount":"18446744073709551615"}',
    );
  });
});
