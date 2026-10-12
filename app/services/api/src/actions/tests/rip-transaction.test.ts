import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ACCOUNT_SIZES,
  CARDS_PER_PACK,
  PACK_EDITIONS,
  VRF,
} from "@onepercent/config";
import { solCost } from "@onepercent/copy";
import { binderHeaderLayout, binderPda, machinePda } from "@onepercent/sdk";
import { ConfigResponse, MachineResponse } from "@onepercent/sdk/api";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { config, machine } from "../../public/__fixtures__/responses.js";
import {
  buildRipTransaction,
  validateRipTransaction,
} from "../rip-transaction.js";
import { RIP_COPY } from "../rip-copy.js";
import type { RipSnapshot } from "../rip.js";

const PROGRAM_ID = new PublicKey(new Uint8Array(32).fill(42));
const account = new PublicKey(new Uint8Array(32).fill(8));
const referrer = new PublicKey(new Uint8Array(32).fill(9));
const queue = new PublicKey(new Uint8Array(32).fill(10));
const blockhash = new PublicKey(new Uint8Array(32).fill(11)).toBase58();
const snapshot: RipSnapshot = {
  config: ConfigResponse.parse({
    ...config,
    programId: PROGRAM_ID.toBase58(),
    vrf: { queues: [queue.toBase58()], activeIndex: 0 },
  }),
  machine: MachineResponse.parse(machine),
  nowTs: 1_800_000_000,
  asOfMs: 1_800_000_000_000,
};
type Account = {
  owner: string;
  executable: boolean;
  data: [string, "base64"];
  lamports?: number;
};
function harness(
  options: {
    binder?: Account;
    fail?: string;
    error?: unknown;
    logs?: string[];
    balance?: number;
    fee?: number | null;
    programId?: PublicKey;
  } = {},
) {
  // Fixed RPC rent fixtures, not a production rent formula.
  const rent = new Map([
    [112, 1_670_400],
    [376, 3_507_840],
    [392, 3_619_200],
    [1232, 9_465_600],
    [1512, 11_414_400],
  ]);
  const request = vi.fn(
    async <T>(
      method: string,
      params: unknown[],
      schema: z.ZodType<T>,
    ): Promise<T> => {
      if (method === options.fail) throw new Error("rpc_unavailable");
      const values: Record<string, unknown> = {
        getAccountInfo: { context: { slot: 1 }, value: options.binder ?? null },
        getLatestBlockhash: {
          context: { slot: 1 },
          value: { blockhash, lastValidBlockHeight: 100 },
        },
        getRecentPrioritizationFees: [],
        simulateTransaction: {
          context: { slot: 1 },
          value: { err: options.error ?? null, logs: options.logs ?? [] },
        },
        getBalance: {
          context: { slot: 1 },
          value: options.balance ?? 2_000_000,
        },
        getFeeForMessage: {
          context: { slot: 1 },
          value: options.fee === undefined ? 5_000 : options.fee,
        },
        getMinimumBalanceForRentExemption: rent.get(params[0] as number),
      };
      if (!(method in values)) throw new Error("unexpected_rpc");
      return schema.parse(values[method]);
    },
  );
  return {
    request,
    build: () =>
      buildRipTransaction(
        {
          async request<T>(
            method: string,
            params: unknown[],
            schema: z.ZodType<T>,
          ): Promise<T> {
            return schema.parse(await request(method, params, schema));
          },
        },
        {
          ...snapshot,
          config: {
            ...snapshot.config,
            programId: (options.programId ?? PROGRAM_ID).toBase58(),
          },
        },
        {
          account,
          edition: 0,
          qty: 1,
          minLiveFlags: 0,
          ref: referrer.toBase58(),
        },
      ),
  };
}

it("uses the snapshot program for every Rip PDA, instruction and wire check", async () => {
  const programId = new PublicKey(new Uint8Array(32).fill(43));
  const h = harness({ programId });
  const tx = Transaction.from(Buffer.from(await h.build(), "base64"));
  expect(tx.instructions.at(-1)!.programId.equals(programId)).toBe(true);
  expect(h.request).toHaveBeenCalledWith(
    "getAccountInfo",
    [binderPda(programId, account)[0].toBase58(), expect.anything()],
    expect.anything(),
  );
  expect(h.request).toHaveBeenCalledWith(
    "getRecentPrioritizationFees",
    [[machinePda(programId)[0].toBase58()]],
    expect.anything(),
  );
  expect(() => validateRipTransaction(programId, tx, account, 1)).not.toThrow();
  expect(() => validateRipTransaction(PROGRAM_ID, tx, account, 1)).toThrow(
    "invalid_rip_instruction",
  );
});

describe("R2.13 full Rip funding requirement", () => {
  const error = { InstructionError: [2, { Custom: 1 }] };
  const logs = ["Transfer: insufficient lamports 2000000, need 3507840"];
  it("includes the pack, VRF, fee, Pull, Binder header and card growth for a nearly empty wallet", async () => {
    const h = harness({ error, logs });
    const required =
      PACK_EDITIONS[0].priceLamports +
      VRF.feeLamports +
      5_000n +
      3_507_840n +
      1_670_400n +
      (3_619_200n - 1_670_400n);
    const expected = RIP_COPY.insufficientSol(solCost(required - 2_000_000n));
    expect(expected).toBe("Not enough SOL. This needs 0.11 SOL more.");
    await expect(h.build()).rejects.toThrow(expected);
    expect(h.request).toHaveBeenCalledWith(
      "getBalance",
      [account.toBase58(), { commitment: "confirmed" }],
      expect.anything(),
    );
    const feeCall = h.request.mock.calls.find(
      ([method]) => method === "getFeeForMessage",
    )!;
    const simulationCall = h.request.mock.calls.find(
      ([method]) => method === "simulateTransaction",
    )!;
    const tx = Transaction.from(
      Buffer.from(simulationCall[1][0] as string, "base64"),
    );
    expect(feeCall[1]).toEqual([
      tx.compileMessage().serialize().toString("base64"),
      { commitment: "confirmed" },
    ]);
    expect(
      h.request.mock.calls
        .filter(([method]) => method === "getMinimumBalanceForRentExemption")
        .map(([, params]) => params),
    ).toEqual([
      [
        ACCOUNT_SIZES.pullHeader + ACCOUNT_SIZES.pullPerPack,
        { commitment: "confirmed" },
      ],
      [ACCOUNT_SIZES.binderHeader, { commitment: "confirmed" }],
      [
        ACCOUNT_SIZES.binderHeader +
          (CARDS_PER_PACK.dust + CARDS_PER_PACK.hit) * ACCOUNT_SIZES.cardSlot,
        { commitment: "confirmed" },
      ],
    ]);
  });
  it("keeps the largest logged shortfall when it exceeds the calculated requirement", async () => {
    const h = harness({
      error,
      logs: [
        "Transfer: insufficient lamports 1, need 10",
        "Transfer: insufficient lamports 1, need 200000001",
      ],
      balance: 1_000_000_000,
    });
    await expect(h.build()).rejects.toThrow(RIP_COPY.insufficientSol("0.2"));
  });
  it("includes an upper bound for growth without charging an existing Binder header again", async () => {
    const binder = binderHeaderLayout.encode({
      owner: account,
      cap: 20,
      len: 1,
    });
    const h = harness({
      error,
      logs,
      binder: {
        owner: PROGRAM_ID.toBase58(),
        executable: false,
        data: [binder.toString("base64"), "base64"],
      },
      balance: 98_000_000,
    });
    const needed =
      PACK_EDITIONS[0].priceLamports +
      VRF.feeLamports +
      5_000n +
      3_507_840n +
      (11_414_400n - 9_465_600n) -
      98_000_000n;
    await expect(h.build()).rejects.toThrow(
      RIP_COPY.insufficientSol(solCost(needed)),
    );
  });
  it.each([
    "getBalance",
    "getFeeForMessage",
    "getMinimumBalanceForRentExemption",
  ])(
    "falls back to the simulation copy when %s is unavailable",
    async (fail) => {
      await expect(harness({ error, logs, fail }).build()).rejects.toThrow(
        RIP_COPY.simulation(),
      );
    },
  );
  it("falls back when the RPC cannot price the transaction message", async () => {
    await expect(harness({ error, logs, fee: null }).build()).rejects.toThrow(
      RIP_COPY.simulation(),
    );
  });
  it("also computes the full requirement when the wallet cannot pay the transaction fee", async () => {
    await expect(
      harness({ error: "InsufficientFundsForFee" }).build(),
    ).rejects.toThrow(RIP_COPY.insufficientSol("0.11"));
  });
  it("does not read funding estimates after a successful simulation", async () => {
    const h = harness();
    await h.build();
    expect(h.request.mock.calls.map(([method]) => method)).toEqual([
      "getAccountInfo",
      "getLatestBlockhash",
      "getRecentPrioritizationFees",
      "simulateTransaction",
    ]);
  });
});

describe("donation-safe Binder initialization", () => {
  it("uses nonce zero and the supplied referral for a pre-funded System address", async () => {
    const fresh = await harness().build();
    const prefunded = await harness({
      binder: {
        owner: SystemProgram.programId.toBase58(),
        executable: false,
        data: ["", "base64"],
        lamports: 1_000_000,
      },
    }).build();
    expect(prefunded).toBe(fresh);
    const ix = Transaction.from(
      Buffer.from(prefunded, "base64"),
    ).instructions.find((instruction) =>
      instruction.programId.equals(PROGRAM_ID),
    )!;
    expect(ix.data.readUInt32LE(10)).toBe(0);
    expect(ix.data[15]).toBe(1);
    expect(new PublicKey(ix.data.subarray(16, 48)).equals(referrer)).toBe(true);
  });
  it.each([
    { owner: queue.toBase58(), executable: false, data: "" },
    { owner: SystemProgram.programId.toBase58(), executable: true, data: "" },
    {
      owner: SystemProgram.programId.toBase58(),
      executable: false,
      data: Buffer.from([1]).toString("base64"),
    },
  ])(
    "refuses any other foreign Binder account %j",
    async ({ owner, executable, data }) => {
      const h = harness({
        binder: { owner, executable, data: [data, "base64"] },
      });
      await expect(h.build()).rejects.toThrow("rip_binder_owner");
      expect(
        h.request.mock.calls.some(
          ([method]) => method === "simulateTransaction",
        ),
      ).toBe(false);
    },
  );
});
