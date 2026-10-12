import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import { configPda, machinePda } from "@onepercent/sdk";

import { configLayout, machineLayout } from "@onepercent/sdk/layouts";
import { loadPublicMachine, loadTrust } from "./public-machine";
import { LOADER } from "../chain/verification";

function account(data: Buffer, owner = PROGRAM_ID): AccountInfo<Buffer> {
  return { data, owner, executable: false, lamports: 1, rentEpoch: 0 };
}

function publicAccounts() {
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(123456n, 32);
  return [
    account(
      configLayout.encode({ version: 1, bump: configPda(PROGRAM_ID)[1] }),
    ),
    account(
      machineLayout.encode({ version: 1, bump: machinePda(PROGRAM_ID)[1] }),
    ),
    account(
      clock,
      new PublicKey("Sysvar1111111111111111111111111111111111111"),
    ),
  ];
}

describe("public account reads", () => {
  it("reads parameters and Clock from a single confirmed bank", async () => {
    const getMultipleAccountsInfoAndContext = vi.fn(async () => ({
      value: publicAccounts(),
      context: { slot: 999 },
    }));
    const result = await loadPublicMachine({
      getMultipleAccountsInfoAndContext,
    } as unknown as Connection);
    expect(result.nowSeconds).toBe(123456n);
    expect(result.asOfSlot).toBe(999);
    expect(getMultipleAccountsInfoAndContext).toHaveBeenCalledWith(
      [
        configPda(PROGRAM_ID)[0],
        machinePda(PROGRAM_ID)[0],
        SYSVAR_CLOCK_PUBKEY,
      ],
      "confirmed",
    );
  });

  it("rejects unsupported, executable, mismatched and malformed account evidence", async () => {
    const cases: ((accounts: AccountInfo<Buffer>[]) => void)[] = [
      (accounts) => {
        accounts[0]!.executable = true;
      },
      (accounts) => {
        accounts[1]!.owner = PublicKey.default;
      },
      (accounts) => {
        accounts[0]!.data = configLayout.encode({
          version: 2,
          bump: configPda(PROGRAM_ID)[1],
        });
      },
      (accounts) => {
        accounts[1]!.data = machineLayout.encode({
          version: 1,
          bump: machinePda(PROGRAM_ID)[1] ^ 1,
        });
      },
      (accounts) => {
        accounts[2]!.data = Buffer.alloc(39);
      },
      (accounts) => {
        accounts[2]!.owner = PublicKey.default;
      },
    ];
    for (const mutate of cases) {
      const value = publicAccounts();
      mutate(value);
      await expect(
        loadPublicMachine({
          getMultipleAccountsInfoAndContext: async () => ({
            value,
            context: { slot: 999 },
          }),
        } as unknown as Connection),
      ).rejects.toThrow();
    }
  });

  it("requires the executable to point to the inspected ProgramData before saying sealed", async () => {
    const programDataAddress = PublicKey.findProgramAddressSync(
      [PROGRAM_ID.toBuffer()],
      LOADER,
    )[0];
    const program = account(Buffer.alloc(36), LOADER);
    program.executable = true;
    program.data.writeUInt32LE(2);
    programDataAddress.toBuffer().copy(program.data, 4);
    const programData = account(Buffer.alloc(45), LOADER);
    programData.data.writeUInt32LE(3);
    const rpc = {
      getMultipleAccountsInfo: vi.fn(async () => [program, programData]),
    } as unknown as Connection;
    expect(await loadTrust(rpc, null)).toBe("sealed");
    program.data[4] = program.data[4]! ^ 1;
    expect(await loadTrust(rpc, null)).toBeNull();
    programDataAddress.toBuffer().copy(program.data, 4);
    program.executable = false;
    expect(await loadTrust(rpc, null)).toBeNull();
  });
});
