// @vitest-environment node
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { XRAY } from "@onepercent/config";
import {
  encodeMintLedger,
  EXTERNAL_IDS,
  ledgerPda,
  vaultAta,
} from "@onepercent/sdk";
import type { MeResponse } from "@onepercent/sdk/api";
import { webDeployment } from "./deployment";
import { readVaultDeposits } from "./vault-deposits";

const program = webDeployment().programId;
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const wallet = key(201);
const info = (
  data: Buffer,
  owner: PublicKey,
  lamports = 17,
): AccountInfo<Buffer> => ({
  data,
  owner,
  lamports,
  executable: false,
  rentEpoch: 0,
});
function fixture(mints: PublicKey[]) {
  const accounts = new Map<string, AccountInfo<Buffer> | null>();
  for (const [index, mint] of mints.entries()) {
    const tokenProgram =
      index % 2 ? EXTERNAL_IDS.token2022 : EXTERNAL_IDS.splToken;
    accounts.set(
      ledgerPda(program, mint)[0].toBase58(),
      info(encodeMintLedger({ mint, payer: wallet }), program),
    );
    accounts.set(mint.toBase58(), info(Buffer.alloc(0), tokenProgram));
    accounts.set(
      vaultAta(program, mint, tokenProgram).toBase58(),
      info(Buffer.alloc(0), tokenProgram, 23),
    );
  }
  const rpc = {
    getMultipleAccountsInfo: vi.fn(async (addresses: PublicKey[]) =>
      addresses.map((address) => accounts.get(address.toBase58()) ?? null),
    ),
  };
  return { accounts, rpc };
}
function mirror(vaultDeposits: MeResponse["vaultDeposits"]): MeResponse {
  return {
    asOfSlot: 1,
    binder: null,
    deck: [],
    pulls: { pending: [], settleable: [] },
    vaultDeposits,
    royalties: {
      count24h: 0,
      lamports24h: null,
      total: null,
      settlementReceipts: { lamports24h: "0", total: "0" },
    },
  };
}

describe("vault deposit batches", () => {
  it.each([60, XRAY.accountsPerBatch + 1])(
    "reads %i held deposits in bounded account batches",
    async (count) => {
      const mints = Array.from({ length: count }, (_, index) => key(index + 1));
      const { rpc } = fixture(mints);
      const result = await readVaultDeposits(rpc, wallet, mints, null, []);
      expect(result).toEqual(
        mints.map((mint) => ({ mint, lamports: 40n, state: "held" })),
      );
      expect(rpc.getMultipleAccountsInfo).toHaveBeenCalledTimes(
        Math.ceil((mints.length * 2) / XRAY.accountsPerBatch) +
          Math.ceil(mints.length / XRAY.accountsPerBatch),
      );
      for (const [addresses] of rpc.getMultipleAccountsInfo.mock.calls)
        expect(addresses.length).toBeLessThanOrEqual(XRAY.accountsPerBatch);
    },
  );

  it("deduplicates discovery sources and keeps known returned amounts in order", async () => {
    const mints = [key(1), key(2), key(3)];
    const { rpc, accounts } = fixture(mints);
    accounts.delete(ledgerPda(program, mints[1]!)[0].toBase58());
    const previous = [
      { mint: mints[1]!, lamports: 43n, state: "held" as const },
    ];
    const me = mirror([
      {
        mint: mints[1]!.toBase58(),
        payerIsWallet: true,
        accounted: "0",
        vaultExists: false,
        state: "returned",
      },
      {
        mint: mints[2]!.toBase58(),
        payerIsWallet: true,
        accounted: "1",
        vaultExists: true,
        state: "held",
      },
    ]);
    expect(await readVaultDeposits(rpc, wallet, mints, me, previous)).toEqual([
      { mint: mints[0], lamports: 40n, state: "held" },
      { mint: mints[1], lamports: 43n, state: "returned" },
      { mint: mints[2], lamports: 40n, state: "held" },
    ]);
    expect(
      rpc.getMultipleAccountsInfo.mock.calls.map(([batch]) => batch.length),
    ).toEqual([6, 2]);
  });

  it("does not invent a returned amount or request a vault paid by another wallet", async () => {
    const mints = [key(1), key(2)];
    const { rpc, accounts } = fixture(mints);
    accounts.delete(ledgerPda(program, mints[0]!)[0].toBase58());
    accounts.set(
      ledgerPda(program, mints[1]!)[0].toBase58(),
      info(encodeMintLedger({ mint: mints[1], payer: key(202) }), program),
    );
    expect(await readVaultDeposits(rpc, wallet, mints, null, [])).toEqual([]);
    expect(rpc.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  });

  it.each(["owner", "executable", "size", "mint"])(
    "rejects an invalid ledger %s before reading vaults",
    async (defect) => {
      const mint = key(1);
      const { rpc, accounts } = fixture([mint]);
      const ledger = accounts.get(ledgerPda(program, mint)[0].toBase58())!;
      if (defect === "owner") ledger.owner = key(202);
      if (defect === "executable") ledger.executable = true;
      if (defect === "size") ledger.data = Buffer.alloc(0);
      if (defect === "mint")
        ledger.data = encodeMintLedger({ mint: key(2), payer: wallet });
      await expect(
        readVaultDeposits(rpc, wallet, [mint], null, []),
      ).rejects.toThrow(
        defect === "mint" ? "Unexpected deposit mint" : "Invalid MintLedger",
      );
      expect(rpc.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["absent", "owner"])("rejects an invalid mint %s", async (defect) => {
    const mint = key(1);
    const { rpc, accounts } = fixture([mint]);
    if (defect === "absent") accounts.delete(mint.toBase58());
    else accounts.get(mint.toBase58())!.owner = key(202);
    await expect(
      readVaultDeposits(rpc, wallet, [mint], null, []),
    ).rejects.toThrow("Invalid vault mint");
    expect(rpc.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  });

  it.each(["absent", "owner", "executable"])(
    "rejects an invalid vault %s",
    async (defect) => {
      const mint = key(1);
      const { rpc, accounts } = fixture([mint]);
      const address = vaultAta(program, mint, EXTERNAL_IDS.splToken).toBase58();
      if (defect === "absent") accounts.delete(address);
      if (defect === "owner") accounts.get(address)!.owner = key(202);
      if (defect === "executable") accounts.get(address)!.executable = true;
      await expect(
        readVaultDeposits(rpc, wallet, [mint], null, []),
      ).rejects.toThrow("Invalid vault");
    },
  );

  it("rejects truncated batches instead of treating missing results as closed", async () => {
    const { rpc } = fixture([key(1)]);
    rpc.getMultipleAccountsInfo.mockResolvedValueOnce([]);
    await expect(
      readVaultDeposits(rpc, wallet, [key(1)], null, []),
    ).rejects.toThrow("Incomplete deposit accounts");
  });

  it("propagates a cancelled batch without dispatching the next one", async () => {
    const mints = Array.from({ length: 60 }, (_, index) => key(index + 1));
    const { rpc } = fixture(mints);
    rpc.getMultipleAccountsInfo.mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );
    await expect(
      readVaultDeposits(rpc, wallet, mints, null, []),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(rpc.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch an empty batch", async () => {
    const { rpc } = fixture([]);
    expect(await readVaultDeposits(rpc, wallet, [], null, [])).toEqual([]);
    expect(rpc.getMultipleAccountsInfo).not.toHaveBeenCalled();
  });
});
