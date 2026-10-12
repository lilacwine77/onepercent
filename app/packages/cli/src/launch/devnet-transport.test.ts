import { expect, it } from "vitest";
import { SERVICES } from "@onepercent/config";
import {
  devnetTransportProfile,
  devnetLaunchPolicy,
} from "./devnet-transport.js";
import { readLaunchPolicy, launchPriorityPrice } from "./landing.js";

it("selects a named, zero-tip, capped p75 profile only for devnet", () => {
  const p = devnetTransportProfile("devnet");
  expect(p.name).toBe("devnet-rpc-p75-v1");
  expect(p.tipLamports).toBe(0n);
  expect(
    devnetLaunchPolicy("devnet").landing.maxComputeUnitPriceMicroLamports,
  ).toBe(1_000_000n);
  expect(
    launchPriorityPrice(
      [{ prioritizationFee: 2_000_000 }],
      p.maxComputeUnitPriceMicroLamports,
    ),
  ).toBe(1_000_000n);
  for (const cluster of ["mainnet", "mainnet-beta", "localnet", ""])
    expect(() => devnetLaunchPolicy(cluster)).toThrow(
      "devnet_transport_requires_devnet",
    );
});

it("does not alter the supplied or pending mainnet settings", () => {
  const before = { ...SERVICES.landing };
  const beforePolicy = readLaunchPolicy();
  devnetLaunchPolicy("devnet");
  // The devnet profile never writes the shared public mainnet release values.
  expect(SERVICES.landing).toEqual(before);
  expect(readLaunchPolicy()).toEqual(beforePolicy);
});

it("samples each new transaction using only its writable accounts and rejects an invalid sample", async () => {
  const { PublicKey, TransactionInstruction, ComputeBudgetInstruction } =
    await import("@solana/web3.js");
  const { devnetPriorityInstructions } = await import("./devnet-transport.js");
  const { vi } = await import("vitest");
  const payer = new PublicKey(new Uint8Array(32).fill(1));
  const written = new PublicKey(new Uint8Array(32).fill(2));
  const readonly = new PublicKey(new Uint8Array(32).fill(3));
  const instruction = new TransactionInstruction({
    programId: readonly,
    data: Buffer.alloc(0),
    keys: [
      { pubkey: written, isWritable: true, isSigner: false },
      { pubkey: readonly, isWritable: false, isSigner: false },
    ],
  });
  const rpc = {
    getRecentPrioritizationFees: vi.fn().mockResolvedValue([
      { slot: 1, prioritizationFee: 10 },
      { slot: 2, prioritizationFee: 20 },
      { slot: 3, prioritizationFee: 30 },
      { slot: 4, prioritizationFee: 40 },
    ]),
  };
  for (let i = 0; i < 2; i++) {
    const measured = await devnetPriorityInstructions(rpc, "devnet", payer, [
      instruction,
    ]);
    expect(
      ComputeBudgetInstruction.decodeSetComputeUnitPrice(
        measured.instructions[0]!,
      ).microLamports,
    ).toBe(30n);
  }
  expect(rpc.getRecentPrioritizationFees).toHaveBeenCalledTimes(2);
  expect(rpc.getRecentPrioritizationFees).toHaveBeenLastCalledWith({
    lockedWritableAccounts: [payer, written],
  });
  await expect(
    devnetPriorityInstructions(rpc, "mainnet", payer, [instruction]),
  ).rejects.toThrow("devnet_transport_requires_devnet");
  expect(rpc.getRecentPrioritizationFees).toHaveBeenCalledTimes(2);
  rpc.getRecentPrioritizationFees.mockResolvedValue([
    { prioritizationFee: -1 },
  ]);
  await expect(
    devnetPriorityInstructions(rpc, "devnet", payer, [instruction]),
  ).rejects.toThrow();
});
