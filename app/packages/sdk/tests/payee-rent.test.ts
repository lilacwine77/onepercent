import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { precheckPayeeRent } from "../src/index.js";
const address = PublicKey.default;
function rpc(balance: number | null, bytes = 0, minimum = 1000) {
  return {
    getAccountInfo: vi.fn(async () =>
      balance === null
        ? null
        : { lamports: balance, data: new Uint8Array(bytes) },
    ),
    getMinimumBalanceForRentExemption: vi.fn(async () => minimum),
  };
}
describe("D17 live payee rent pre-check", () => {
  it("reports the exact shortage for a missing wallet, without applying the display hint as a threshold", async () => {
    const connection = rpc(null, 0, 877);
    const result = await precheckPayeeRent(connection, {
      address,
      incomingLamports: 600n,
      debitLamports: 0n,
    });
    expect(result).toMatchObject({
      ready: false,
      balanceLamports: 0n,
      postBalanceLamports: 600n,
      minimumLamports: 877n,
      shortfallLamports: 277n,
      standaloneTopUpLamports: 877n,
      copyKey: "payeeBelowRent",
    });
    expect(result).not.toHaveProperty("message");
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(
      0,
      "confirmed",
    );
  });
  it("accepts exact rent exemption and existing lamport donations", async () => {
    const result = await precheckPayeeRent(rpc(500), {
      address,
      incomingLamports: 500n,
      debitLamports: 0n,
    });
    expect(result).toMatchObject({
      ready: true,
      shortfallLamports: 0n,
      copyKey: null,
    });
    expect(result).not.toHaveProperty("message");
    expect(
      (
        await precheckPayeeRent(rpc(600), {
          address,
          incomingLamports: 500n,
          debitLamports: 0n,
        })
      ).ready,
    ).toBe(true);
  });
  it("subtracts fees before testing the final wallet balance", async () => {
    const plan = { address, incomingLamports: 500n, debitLamports: 1n };
    expect(await precheckPayeeRent(rpc(500), plan)).toMatchObject({
      ready: false,
      postBalanceLamports: 999n,
      shortfallLamports: 1n,
    });
    expect((await precheckPayeeRent(rpc(501), plan)).ready).toBe(true);
  });
  it("allows an explicitly identified TakeBack with no SOL credit and no unpaid debits", async () => {
    for (const debitLamports of [0n, 100n])
      expect(
        await precheckPayeeRent(rpc(100), {
          address,
          instruction: "takeBack",
          incomingLamports: 0n,
          debitLamports,
        }),
      ).toMatchObject({
        ready: true,
        shortfallLamports: 0n,
        standaloneTopUpLamports: 0n,
        copyKey: null,
      });
  });
  it("keeps the zero-credit TakeBack exception scoped and still requires upfront debits", async () => {
    expect(
      await precheckPayeeRent(rpc(100), {
        address,
        instruction: "takeBack",
        incomingLamports: 0n,
        debitLamports: 101n,
      }),
    ).toMatchObject({
      ready: false,
      shortfallLamports: 1n,
      standaloneTopUpLamports: 1001n,
    });
    for (const instruction of [undefined, "closeVault"] as const)
      expect(
        (
          await precheckPayeeRent(rpc(100), {
            address,
            instruction,
            incomingLamports: 0n,
            debitLamports: 0n,
          })
        ).ready,
      ).toBe(false);
    expect(
      (
        await precheckPayeeRent(rpc(100), {
          address,
          instruction: "takeBack",
          incomingLamports: 1n,
          debitLamports: 0n,
        })
      ).ready,
    ).toBe(false);
  });
  it("keeps a separately topped up wallet rent-exempt after a zero-credit TakeBack debit", async () => {
    expect(
      await precheckPayeeRent(rpc(500), {
        address,
        instruction: "takeBack",
        incomingLamports: 0n,
        debitLamports: 600n,
      }),
    ).toMatchObject({
      ready: false,
      shortfallLamports: 100n,
      standaloneTopUpLamports: 1100n,
    });
  });
  it("cannot pay an upfront debit with SOL arriving later in the exit", async () => {
    expect(
      await precheckPayeeRent(rpc(0), {
        address,
        incomingLamports: 2000n,
        debitLamports: 1n,
      }),
    ).toMatchObject({
      ready: false,
      postBalanceLamports: 1999n,
      shortfallLamports: 1n,
    });
  });
  it("queries the actual destination data length and current rent on every call", async () => {
    const connection = rpc(2000, 2048, 3000);
    connection.getMinimumBalanceForRentExemption
      .mockResolvedValueOnce(3000)
      .mockResolvedValueOnce(3001);
    const plan = { address, incomingLamports: 1000n, debitLamports: 0n };
    expect((await precheckPayeeRent(connection, plan, "finalized")).ready).toBe(
      true,
    );
    expect(
      (await precheckPayeeRent(connection, plan, "finalized"))
        .shortfallLamports,
    ).toBe(1n);
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(
      2048,
      "finalized",
    );
  });
  it("keeps planned u64 values exact above JavaScript number precision", async () => {
    const amount = (1n << 64n) - 1n;
    expect(
      (
        await precheckPayeeRent(rpc(0), {
          address,
          incomingLamports: amount,
          debitLamports: 0n,
        })
      ).postBalanceLamports,
    ).toBe(amount);
  });
  it("rejects unsafe RPC numbers and invalid planned values", async () => {
    const plan = { address, incomingLamports: 0n, debitLamports: 0n };
    await expect(
      precheckPayeeRent(rpc(Number.MAX_SAFE_INTEGER + 1), plan),
    ).rejects.toThrow("safe integer");
    await expect(precheckPayeeRent(rpc(0, 0, 0.5), plan)).rejects.toThrow(
      "safe integer",
    );
    await expect(
      precheckPayeeRent(rpc(0), { ...plan, incomingLamports: -1n }),
    ).rejects.toThrow("outside u64");
    await expect(
      precheckPayeeRent(rpc(0), { ...plan, debitLamports: 1n << 64n }),
    ).rejects.toThrow("outside u64");
  });
});
