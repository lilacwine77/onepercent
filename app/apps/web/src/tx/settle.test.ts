import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import {
  decodePull,
  encodePull,
  MEMO_PROGRAM_ID,
  settleInstruction,
} from "@onepercent/sdk";
import { WEB, DRAW_TAGS, TX_LIMITS } from "@onepercent/config";
import type { WalletSession } from "../wallet/session";
import { prepareSettles, runSettles } from "./settle";

const mocks = vi.hoisted(() => ({
  hints: vi.fn(),
  clock: vi.fn(),
  pull: vi.fn(),
  plan: vi.fn(),
  execute: vi.fn(),
  payees: vi.fn(),
}));
vi.mock("../data/cards", () => ({ readMeHints: mocks.hints }));
vi.mock("@onepercent/sdk/rescue", () => ({
  readClock: mocks.clock,
  readPull: mocks.pull,
  planSettle: mocks.plan,
  readPayees: mocks.payees,
}));
vi.mock("./runtime", () => ({
  checkBuiltTransaction: vi.fn(),
  executeTransactions: mocks.execute,
}));
const owner = new PublicKey(new Uint8Array(32).fill(1));
const address = new PublicKey(new Uint8Array(32).fill(2));
const blockhash = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
const session = {
  snapshot: () => ({ account: { address: owner.toBase58() }, generation: 1 }),
} as unknown as WalletSession;
const makePull = () => ({
  ...decodePull(
    encodePull({ buyer: owner, seq: 8n, qty: 2, status: 2, revealed_ts: 10n }),
  ),
  address,
});
const prepared = () => ({
  groups: [{ pull: address.toBase58(), seq: 8n, indices: [0, 1] }],
  feeLamports: 5000n,
});
const makeRpc = () =>
  ({
    simulateTransaction: vi.fn(async () => ({ value: { err: null } })),
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })),
  }) as unknown as Connection;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hints.mockResolvedValue({
    pulls: {
      settleable: [{ pull: address.toBase58() }, { pull: address.toBase58() }],
    },
  });
  mocks.clock.mockResolvedValue({
    unixTimestamp: 10n + BigInt(WEB.settlePrependAfterSeconds),
  });
  mocks.pull.mockResolvedValue(makePull());
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: blockhash,
  }).add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [],
      data: Buffer.alloc(0),
    }),
  );
  mocks.plan.mockResolvedValue({
    transactions: [{ transaction, indices: [0, 1] }],
  });
  mocks.execute.mockResolvedValue({
    phase: "done",
    submitted: true,
    unknown: new Set(),
  });
  mocks.payees.mockImplementation(async (_rpc, addresses: PublicKey[]) =>
    addresses.map((address) => ({ address, executable: false })),
  );
});
describe("optional older Pull settlement", () => {
  it("deduplicates chain-checked hints and prices only simulated groups", async () => {
    const result = await prepareSettles({ rpc: makeRpc(), owner, blockhash });
    expect(result).toEqual(prepared());
    expect(mocks.plan).toHaveBeenCalledTimes(1);
  });
  it("ignores younger, unrelated and unavailable Pulls without hiding the owner's action", async () => {
    mocks.clock.mockResolvedValueOnce({ unixTimestamp: 10n });
    expect(
      (await prepareSettles({ rpc: makeRpc(), owner, blockhash })).groups,
    ).toEqual([]);
    mocks.pull.mockResolvedValueOnce({ ...makePull(), buyer: address });
    expect(
      (await prepareSettles({ rpc: makeRpc(), owner, blockhash })).groups,
    ).toEqual([]);
    mocks.hints.mockRejectedValueOnce(new Error("offline"));
    expect(
      (await prepareSettles({ rpc: makeRpc(), owner, blockhash })).feeLamports,
    ).toBe(0n);
  });
  it("abandons hanging optional discovery at the HTTP deadline and schedules no late work", async () => {
    vi.useFakeTimers();
    try {
      let release!: (value: {
        pulls: { settleable: { pull: string }[] };
      }) => void;
      mocks.hints.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const request = prepareSettles({ rpc: makeRpc(), owner, blockhash });
      await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
      await expect(request).resolves.toEqual({ groups: [], feeLamports: 0n });
      release({ pulls: { settleable: [{ pull: address.toBase58() }] } });
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.pull).not.toHaveBeenCalled();
      expect(mocks.plan).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("caps optional groups and fee estimates at the existing signature batch limit", async () => {
    const addresses = Array.from(
      { length: TX_LIMITS.txPerSignAll + 3 },
      (_, index) =>
        new PublicKey(new Uint8Array(32).fill(index + 10)).toBase58(),
    );
    mocks.hints.mockResolvedValueOnce({
      pulls: { settleable: addresses.map((pull) => ({ pull })) },
    });
    const rpc = makeRpc();
    const result = await prepareSettles({ rpc, owner, blockhash });
    expect(result.groups).toHaveLength(TX_LIMITS.txPerSignAll);
    expect(result.groups.map((group) => group.pull)).toEqual(
      addresses.slice(0, TX_LIMITS.txPerSignAll),
    );
    expect(result.feeLamports).toBe(BigInt(TX_LIMITS.txPerSignAll) * 5000n);
    expect(rpc.simulateTransaction).toHaveBeenCalledTimes(
      TX_LIMITS.txPerSignAll,
    );
    expect(mocks.pull).toHaveBeenCalledTimes(TX_LIMITS.txPerSignAll);
  });
  it("never presents a group whose simulation failed", async () => {
    const rpc = makeRpc();
    vi.mocked(rpc.simulateTransaction).mockResolvedValueOnce({
      value: { err: { InstructionError: [0, "InvalidArgument"] } },
    } as never);
    expect((await prepareSettles({ rpc, owner, blockhash })).groups).toEqual(
      [],
    );
  });
  it("skips a group completed by the keeper after the preview", async () => {
    mocks.pull.mockResolvedValue({ ...makePull(), settled_mask: 3 });
    await runSettles({
      rpc: makeRpc(),
      session,
      chain: "solana:devnet",
      prepared: prepared(),
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rebuilds only the remaining pack after a partial keeper race and retains the royalty memo", async () => {
    mocks.pull.mockResolvedValue({ ...makePull(), settled_mask: 1 });
    let built: Transaction | undefined;
    mocks.execute.mockImplementationOnce(async ({ items }) => {
      built = await items[0].build({ blockhash });
      return { phase: "done", submitted: true, unknown: new Set() };
    });
    await runSettles({
      rpc: makeRpc(),
      session,
      chain: "solana:devnet",
      prepared: prepared(),
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const instructions = built!.instructions.filter((instruction) =>
      instruction.programId.equals(PROGRAM_ID),
    );
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.data).toEqual(
      settleInstruction(PROGRAM_ID, {
        pull: address,
        seq: 8n,
        pack: 1,
        buyer: { address: owner, executable: false },
        wallets: [null, null, null, null],
      }).data,
    );
    const memos = built!.instructions.filter((instruction) =>
      instruction.programId.equals(MEMO_PROGRAM_ID),
    );
    expect(memos).toHaveLength(1);
    expect(memos[0]!.data.toString()).toBe(`${DRAW_TAGS.royaltyMemoPrefix}8`);
  });
  it("allows the owner action after a refused optional simulation but stops ambiguous submissions", async () => {
    mocks.execute.mockResolvedValueOnce({
      phase: "failed",
      submitted: false,
      unknown: new Set(["group"]),
      copyKey: "errors.simulation",
    });
    await expect(
      runSettles({
        rpc: makeRpc(),
        session,
        chain: "solana:devnet",
        prepared: prepared(),
      }),
    ).resolves.toBeUndefined();
    mocks.execute.mockResolvedValueOnce({
      phase: "failed",
      submitted: true,
      unknown: new Set(["group"]),
    });
    await expect(
      runSettles({
        rpc: makeRpc(),
        session,
        chain: "solana:devnet",
        prepared: prepared(),
      }),
    ).rejects.toThrow("errors.generic");
  });
  it("respects wallet cancellation instead of opening the next approval", async () => {
    mocks.execute.mockResolvedValueOnce({
      phase: "rejected",
      submitted: false,
      unknown: new Set(),
      copyKey: "errors.walletNo",
    });
    await expect(
      runSettles({
        rpc: makeRpc(),
        session,
        chain: "solana:devnet",
        prepared: prepared(),
      }),
    ).rejects.toThrow("errors.walletNo");
  });
});

it("does not read the clock when there are no optional settlements", async () => {
  mocks.hints.mockResolvedValue({ pulls: { settleable: [] } });
  expect(await prepareSettles({ rpc: makeRpc(), owner, blockhash })).toEqual({
    groups: [],
    feeLamports: 0n,
  });
  expect(mocks.clock).not.toHaveBeenCalled();
});
