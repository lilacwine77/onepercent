import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  type VersionedTransaction,
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { BURN, EXECUTOR_POLICY, PAUSE_BITS } from "@onepercent/config";
import {
  configLayout,
  machineLayout,
  PHASE,
  createDeploymentSelector,
  EXTERNAL_IDS,
  userAta,
} from "@onepercent/sdk";
import {
  planExecutor,
  executorDelay,
  type ExecutorSnapshot,
  type ExecutorReference,
} from "./policy.js";
import { assertSwapMode, composeExecutor, stubSwap } from "./compose.js";
import { executorP1, type P1ExecutorPort } from "./p1.js";
import { Executor, type ExecutorDependencies } from "./engine.js";
import type { ExecutorJob, ExecutorStore } from "./store.js";
import {
  TxSender,
  TxSenderError,
  RpcError,
  withSender,
  type TxRpc,
  DONT_FRONT,
  SENDER_TIP_ACCOUNT,
} from "@onepercent/service-kit";
import { jupiterSwap } from "./jupiter.js";
import { assertExecutorGenesis } from "./source.js";

const key = (n: number) => new PublicKey(Buffer.alloc(32, n));
const PROGRAM_ID = key(41);
const deployment = createDeploymentSelector({ localnet: PROGRAM_ID })(
  "localnet",
);
const signingKey = Keypair.fromSeed(Buffer.alloc(32, 2));
const signer = signingKey.publicKey,
  mint = key(3);
function account(name: string, size: number) {
  const b = Buffer.alloc(size);
  createHash("sha256").update(`account:${name}`).digest().copy(b, 0, 0, 8);
  return b;
}
function snapshot(): ExecutorSnapshot {
  const c = account("Config", 872);
  signer.toBuffer().copy(c, 136);
  mint.toBuffer().copy(c, 552);
  const m = account("Machine", 3808);
  const machine = {
    ...machineLayout.decode(m),
    phase: PHASE.onAir,
    end_ts: 50_000n,
    burn_sol: 5_000_000_000n,
    jackpot_sol: 5_000_000_000n,
    last_burn_ts: 30n,
    last_jackpot_buy_ts: 30n,
  };
  return {
    deployment,
    config: configLayout.decode(c),
    machine,
    now: 3700n,
    slot: 123,
  };
}
const empty = {
  address: SystemProgram.programId,
  owner: SystemProgram.programId,
  data: Buffer.alloc(0),
};
const reference: ExecutorReference = {
  quoteReserve: 400_000_000_000n,
  sqrtPrice: 1n << 64n,
  oracles: [key(10), key(11), key(12), key(13)],
  readings: {
    mint: empty,
    ledger: empty,
    vault: empty,
    src: empty,
    solDest: empty,
    oracles: [empty, empty, empty, empty],
    machineLamports: 100_000_000_000n,
    machineRentMinimum: 1n,
  },
};
const table = new AddressLookupTableAccount({
  key: key(8),
  state: {
    deactivationSlot: (1n << 64n) - 1n,
    lastExtendedSlot: 0,
    lastExtendedSlotStartIndex: 0,
    addresses: [],
  },
});
const port: P1ExecutorPort = {
  checkExecBegin: vi.fn(() => ({
    ok: true as const,
    minOut: 100n,
    expected: 110n,
  })),
  composeExecTransaction: executorP1.composeExecTransaction,
};
function plan() {
  const result = planExecutor("burn", snapshot(), reference, EXECUTOR_POLICY);
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

describe("launch executor policy", () => {
  it.each([
    ["burn", PHASE.poweredOn, true],
    ["burn", PHASE.onAir, true],
    ["burn", PHASE.buysClosed, true],
    ["burn", PHASE.done, false],
    ["jackpot", PHASE.poweredOn, false],
    ["jackpot", PHASE.onAir, true],
    ["jackpot", PHASE.buysClosed, false],
  ] as const)("%s phase %s eligibility", (kind, phase, allowed) => {
    const s = snapshot();
    s.machine = { ...s.machine, phase };
    expect(planExecutor(kind, s, reference, EXECUTOR_POLICY).ok).toBe(allowed);
  });
  it("enforces chain time, both spacing checks and paused entry", () => {
    const s = snapshot();
    s.now = s.machine.end_ts;
    expect(
      planExecutor("jackpot", s, reference, EXECUTOR_POLICY),
    ).toMatchObject({ reason: "SeasonOver" });
    s.now = 40n;
    expect(
      planExecutor("jackpot", s, reference, EXECUTOR_POLICY),
    ).toMatchObject({ reason: "TooSoon" });
    expect(planExecutor("burn", s, reference, EXECUTOR_POLICY)).toMatchObject({
      reason: "TooSoon",
    });
    s.config = { ...s.config, guardian_paused: PAUSE_BITS.burn };
    expect(planExecutor("burn", s, reference, EXECUTOR_POLICY)).toMatchObject({
      reason: "Paused",
    });
  });
  it("bounds reserves, minimum tranche and hourly cap, rotating a new hour", () => {
    const s = snapshot();
    s.machine = {
      ...s.machine,
      burn_hour_index: 1n,
      burn_paid_hour: BURN.hourlyMaxLamports - 40_000_000n,
    };
    expect(planExecutor("burn", s, reference, EXECUTOR_POLICY)).toMatchObject({
      reason: "BelowMinimumTranche",
    });
    s.machine = {
      ...s.machine,
      burn_paid_hour: s.machine.burn_paid_hour - 10_000_000n,
    };
    expect(planExecutor("burn", s, reference, EXECUTOR_POLICY)).toMatchObject({
      plan: { amount: 50_000_000n },
    });
    s.now = 7200n;
    expect(planExecutor("burn", s, reference, EXECUTOR_POLICY)).toMatchObject({
      plan: { amount: BURN.trancheMaxLamports },
    });
    expect(
      planExecutor(
        "burn",
        s,
        { ...reference, quoteReserve: 1n },
        EXECUTOR_POLICY,
      ),
    ).toMatchObject({ reason: "BelowMinimumTranche" });
    expect(s.machine.burn_paid_hour).toBe(BURN.hourlyMaxLamports - 50_000_000n);
  });
  it("draws independent random delays inside configured bounds", () => {
    expect(executorDelay("burn", EXECUTOR_POLICY, () => 0)).toBe(20_000);
    expect(executorDelay("jackpot", EXECUTOR_POLICY, () => 0.999)).toBe(60_000);
    expect(() => executorDelay("burn", EXECUTOR_POLICY, () => 1)).toThrow();
  });
  it("refuses a mainnet test swap and binds the actual P1 exports", async () => {
    expect(() => assertSwapMode("mainnet-beta", "stub")).toThrow(
      "executor_stub_forbidden",
    );
    expect(() =>
      stubSwap(
        createDeploymentSelector({ mainnet: PROGRAM_ID })("mainnet"),
        signer,
        mint,
        110n,
        100n,
        key(9),
      ),
    ).toThrow();
    expect(executorP1.checkExecBegin).toBeTypeOf("function");
  });
  it("binds the declared cluster to the RPC genesis and confines localnet to loopback", () => {
    const mainnet = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    const devnet = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    expect(() =>
      assertExecutorGenesis("devnet", "https://rpc.example", mainnet),
    ).toThrow("executor_genesis_mismatch");
    expect(() =>
      assertExecutorGenesis("localnet", "http://localhost:8899", mainnet),
    ).toThrow("executor_genesis_mismatch");
    expect(() =>
      assertExecutorGenesis(
        "localnet",
        "https://rpc.example",
        "local-validator",
      ),
    ).toThrow("executor_genesis_mismatch");
    expect(() =>
      assertExecutorGenesis(
        "localnet",
        "http://127.0.0.1:8899",
        "local-validator",
      ),
    ).not.toThrow();
    expect(() =>
      assertExecutorGenesis("devnet", "https://rpc.example", devnet),
    ).not.toThrow();
  });
});

describe("executor transaction boundary", () => {
  const compose = (
    p1: P1ExecutorPort,
    swap = stubSwap(deployment, signer, mint, 110n, plan().amount, key(9)),
  ) =>
    composeExecutor({
      plan: plan(),
      p1,
      signer,
      swap,
      protocolLut: table,
      blockhash: key(7).toBase58(),
      tipLamports: 1_000_000n,
      computeUnitLimit: 100_000,
    });
  it.each(["reordered", "wrong_account"])(
    "rejects %s P1 composition",
    (mutation) => {
      const changed: P1ExecutorPort = {
        ...port,
        composeExecTransaction(input) {
          if (mutation === "reordered")
            return port.composeExecTransaction({
              ...input,
              swap: {
                ...input.swap,
                setup: [...input.swap.setup].reverse(),
                cleanup: [
                  ...input.swap.cleanup,
                  new TransactionInstruction({
                    programId: SystemProgram.programId,
                    keys: [],
                    data: Buffer.alloc(0),
                  }),
                ],
              },
            });
          const beginIx = new TransactionInstruction({
            ...input.beginIx,
            keys: input.beginIx.keys.map((meta, index) =>
              index === 1 ? { ...meta, pubkey: key(25) } : meta,
            ),
          });
          return port.composeExecTransaction({ ...input, beginIx });
        },
      };
      expect(() => compose(changed)).toThrow();
    },
  );
  it("rejects a foreign signer and writable ordering protection from the swap provider", () => {
    const swap = stubSwap(
      deployment,
      signer,
      mint,
      110n,
      plan().amount,
      key(9),
    );
    const withAccount = (pubkey: PublicKey, isSigner: boolean) => ({
      ...swap,
      swap: new TransactionInstruction({
        ...swap.swap,
        keys: [...swap.swap.keys, { pubkey, isSigner, isWritable: true }],
      }),
    });
    expect(() => compose(port, withAccount(key(6), true))).toThrow(
      "executor_signer_invalid",
    );
    expect(() => compose(port, withAccount(DONT_FRONT, false))).toThrow(
      "executor_protection_invalid",
    );
  });
  it("refuses a tip account loaded from the protocol lookup table", () => {
    const protocolLut = new AddressLookupTableAccount({
      key: table.key,
      state: { ...table.state, addresses: [SENDER_TIP_ACCOUNT] },
    });
    expect(() =>
      composeExecutor({
        plan: plan(),
        p1: port,
        signer,
        swap: stubSwap(deployment, signer, mint, 110n, plan().amount, key(9)),
        protocolLut,
        blockhash: key(7).toBase58(),
        tipLamports: 1_000_000n,
        computeUnitLimit: 100_000,
      }),
    ).toThrow("executor_tip_lookup_forbidden");
  });
  it("omits Sender entirely on devnet and rejects a nonzero devnet tip", () => {
    const value = plan();
    value.snapshot = {
      ...value.snapshot,
      deployment: createDeploymentSelector({ devnet: PROGRAM_ID })("devnet"),
    };
    const input = {
      plan: value,
      p1: port,
      signer,
      swap: stubSwap(
        value.snapshot.deployment,
        signer,
        mint,
        110n,
        value.amount,
        key(9),
      ),
      protocolLut: table,
      blockhash: key(7).toBase58(),
      tipLamports: 0n,
      computeUnitLimit: 100_000,
    };
    const result = composeExecutor(input);
    expect(
      result.instructions.some((ix) =>
        ix.keys.some((m) => m.pubkey.equals(SENDER_TIP_ACCOUNT)),
      ),
    ).toBe(false);
    expect(
      result.instructions.filter((ix) => ix.programId.equals(PROGRAM_ID)),
    ).toHaveLength(2);
    expect(() => composeExecutor({ ...input, tipLamports: 1n })).toThrow(
      "executor_devnet_tip_forbidden",
    );
  });
  it("runs P1, preserves the exec pair, consumes test input, carries tip and protection", () => {
    const value = plan();
    const swap = stubSwap(deployment, signer, mint, 110n, value.amount, key(9));
    const result = composeExecutor({
      plan: value,
      p1: port,
      signer,
      swap,
      protocolLut: table,
      blockhash: key(7).toBase58(),
      tipLamports: 1_000_000n,
      computeUnitLimit: 100_000,
    });
    expect(port.checkExecBegin).toHaveBeenCalled();
    expect(
      result.instructions.filter((ix) => ix.programId.equals(PROGRAM_ID)),
    ).toHaveLength(2);
    expect(
      result.instructions.some((ix) =>
        ix.keys.some((m) => m.pubkey.equals(DONT_FRONT) && !m.isWritable),
      ),
    ).toBe(true);
    expect(
      result.instructions.some((ix) =>
        ix.keys.some((m) => m.pubkey.equals(SENDER_TIP_ACCOUNT)),
      ),
    ).toBe(true);
    expect(swap.setup[0]!.data.readBigUInt64LE(1)).toBe(value.amount);
    expect(() =>
      composeExecutor({
        plan: value,
        p1: port,
        signer,
        swap: { ...swap, minOut: 99n },
        protocolLut: table,
        blockhash: key(7).toBase58(),
        tipLamports: 1_000_000n,
        computeUnitLimit: 100_000,
      }),
    ).toThrow("executor_quote_below_min_out");
    expect(() =>
      composeExecutor({
        plan: value,
        p1: {
          ...port,
          checkExecBegin: () => ({ ok: false, error: "HourlyCapReached" }),
        },
        signer,
        swap,
        protocolLut: table,
        blockhash: key(7).toBase58(),
        tipLamports: 1_000_000n,
        computeUnitLimit: 100_000,
      }),
    ).toThrow("HourlyCapReached");
  });
  it("atomically creates, closes and recreates the canonical native ATA before exec_begin", () => {
    const result = compose(port);
    const begin = result.instructions.findIndex((ix) =>
      ix.programId.equals(PROGRAM_ID),
    );
    const prep = result.instructions.slice(begin - 3, begin);
    expect(
      prep.map((ix) => [ix.programId.toBase58(), ix.data.toString("hex")]),
    ).toEqual([
      [EXTERNAL_IDS.associatedToken.toBase58(), "01"],
      [EXTERNAL_IDS.splToken.toBase58(), "09"],
      [EXTERNAL_IDS.associatedToken.toBase58(), "01"],
    ]);
    const native = new PublicKey("So11111111111111111111111111111111111111112");
    expect(prep[1]!.keys.map((meta) => meta.pubkey.toBase58())).toEqual([
      userAta(signer, native, EXTERNAL_IDS.splToken).toBase58(),
      signer.toBase58(),
      signer.toBase58(),
    ]);
  });
  it("requests exact-in Jupiter with no wrapping and the vault destination", async () => {
    const fetcher = vi.fn<(url: URL | RequestInfo) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: mint.toBase58(),
            inAmount: plan().amount.toString(),
            outAmount: "110",
            otherAmountThreshold: "100",
            swapInstruction: {
              programId: SystemProgram.programId.toBase58(),
              accounts: [],
              data: "",
            },
            addressesByLookupTableAddress: {},
          }),
        ),
    );
    await jupiterSwap({
      plan: plan(),
      signer,
      apiKey: "test-api-token",
      lookupTable: async () => table,
      fetch: fetcher,
    });
    const url = fetcher.mock.calls[0]?.[0] as unknown as URL;
    expect(url.searchParams.get("wrapAndUnwrapSol")).toBe("false");
    expect(url.searchParams.get("taker")).toBe(signer.toBase58());
    expect(url.searchParams.get("destinationTokenAccount")).toBeTruthy();
  });
});

function harness() {
  let stored: ExecutorJob | null = null;
  const send = vi.fn(async () => ({
    status: "confirmed" as const,
    signature: "test-signature",
    finalized: true,
  }));
  const store: ExecutorStore = {
    pending: async (kind) => (stored?.intent.kind === kind ? stored : null),
    latestCompleted: async () => null,
    create: async (intent, tx) =>
      (stored = {
        intent: { ...intent, tradeId: "123e4567-e89b-42d3-a456-426614174000" },
        plan: tx,
      }),
    read: async () => stored?.transaction ?? null,
    write: vi.fn(async (_id, record) => {
      if (!stored) throw new Error("job_missing");
      stored.transaction = structuredClone(record);
    }),
    closeUnsigned: vi.fn(async () => {
      if (!stored || stored.transaction) return false;
      stored = null;
      return true;
    }),
    reserveAttempt: async () => 1,
    outcome: vi.fn(async () => undefined),
    landed: vi.fn(async () => undefined),
    diagnostic: vi.fn(async () => undefined),
  };
  const deps: ExecutorDependencies = {
    deployment,
    policy: EXECUTOR_POLICY,
    signer,
    p1: port,
    protocolLut: table,
    tipLamports: 1_000_000n,
    snapshot: async () => snapshot(),
    reference: async (snapshot) => ({ snapshot, reference }),
    swap: async (p) =>
      stubSwap(deployment, signer, mint, 110n, p.amount, key(9)),
    blockhash: async () => key(7).toBase58(),
    measure: async () => 100_000,
    sender: { send },
    store,
    residue: async () => 0n,
    receipt: async () => ({
      kind: 3,
      bucket: 255,
      mint: mint.toBase58(),
      amount: plan().amount,
      min_out: 100n,
      delta: 110n,
      book: 0n,
      tracked_after: 110n,
      ts: 3700n,
      sourceResidue: 0n,
    }),
    slippage: vi.fn(),
    assertActive: () => undefined,
    alert: vi.fn(async () => undefined),
    result: vi.fn(),
    log: vi.fn(),
  };
  return { deps, send, store };
}
function realSender(h: ReturnType<typeof harness>) {
  let attempts = 0;
  const rpc = {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: key(7).toBase58(),
      lastValidBlockHeight: 100,
    })),
    getRecentPrioritizationFees: vi.fn(async () => [{ prioritizationFee: 1 }]),
    simulateTransaction: vi.fn<TxRpc["simulateTransaction"]>(async () => ({
      err: null,
    })),
    sendRawTransaction: vi.fn<TxRpc["sendRawTransaction"]>(async () => {
      const job =
        (await h.store.pending("burn")) ?? (await h.store.pending("jackpot"));
      return (await h.store.read(job!.intent.id))!.signature;
    }),
    getSignatureStatuses: vi.fn<TxRpc["getSignatureStatuses"]>(async () => [
      { err: null, confirmationStatus: "finalized" },
    ]),
    getBlockHeight: vi.fn(async () => 99),
  } satisfies TxRpc;
  const sign = vi.fn((tx: VersionedTransaction) => tx.sign([signingKey]));
  h.store.reserveAttempt = async () => ++attempts;
  const make = (transport: TxRpc = rpc) =>
    new TxSender({
      rpc: transport,
      journal: h.store,
      role: "executor",
      signer: { publicKey: signer, signTransaction: sign },
      assertAuthorized: () => undefined,
      sendMaxAttempts: 2,
      backoffBaseMs: 1,
      backoffMaxMs: 1,
      cuMarginBps: 0,
      maxComputeUnitPriceMicroLamports: 1n,
      sleep: async () => undefined,
    });
  return { rpc, sign, make };
}
describe("executor service flow", () => {
  it.each([-32004, -32016, -32007, -32009])(
    "defers lagging reads (%s) without counting execution failures",
    async (code) => {
      const h = harness();
      const read = h.deps.snapshot;
      h.deps.snapshot = async () => {
        throw new RpcError(code);
      };
      const executor = new Executor(h.deps);
      for (let i = 0; i < 6; i += 1)
        await executor.tick("burn", new AbortController().signal);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.deps.result).not.toHaveBeenCalledWith("burn", "failed");
      expect(h.deps.alert).not.toHaveBeenCalled();
      h.deps.snapshot = read;
      await executor.tick("burn", new AbortController().signal);
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.deps.result).toHaveBeenCalledWith("burn", "confirmed");
    },
  );
  it("retains a finalized transaction while its receipt node catches up", async () => {
    const h = harness();
    const sender = realSender(h);
    h.deps.sender = sender.make();
    const receipt = h.deps.receipt;
    h.deps.receipt = vi.fn(receipt).mockRejectedValueOnce(new RpcError(-32004));
    const executor = new Executor(h.deps);
    await executor.tick("burn", new AbortController().signal);
    const pending = await h.store.pending("burn");
    expect(pending?.transaction).toMatchObject({
      status: "confirmed",
      finalized: true,
    });
    expect(h.store.outcome).not.toHaveBeenCalled();
    expect(h.store.closeUnsigned).not.toHaveBeenCalled();
    expect(h.deps.result).not.toHaveBeenCalledWith("burn", "failed");
    await executor.tick("burn", new AbortController().signal);
    expect(sender.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(sender.sign).toHaveBeenCalledTimes(1);
    expect(h.store.landed).toHaveBeenCalledTimes(1);
    expect(h.store.outcome).toHaveBeenCalledWith(pending, {
      status: "confirmed",
      signature: pending!.transaction!.signature,
      finalized: true,
    });
  });
  it("logs the original transport cause safely while retaining the failure result", async () => {
    const h = harness();
    h.deps.sender = {
      send: async () => {
        throw Object.assign(
          new Error(
            "connect ECONNREFUSED https://rpc.example.invalid/?api-key=private-value",
          ),
          { code: "ECONNREFUSED" },
        );
      },
    };
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(h.deps.result).toHaveBeenCalledWith("burn", "failed");
    expect(h.deps.log).toHaveBeenCalledWith({
      kind: "burn",
      reason: "executor_failed",
      cause: {
        code: "ECONNREFUSED",
        detail: "connect ECONNREFUSED <redacted>",
      },
    });
    expect(h.store.diagnostic).toHaveBeenCalledWith(
      expect.anything(),
      "executor_failed",
    );
    expect(h.store.outcome).not.toHaveBeenCalled();
  });
  it("keeps a Sender acceptance ambiguous after fallback preflight rejection, across restart", async () => {
    const h = harness();
    const tx = realSender(h);
    tx.rpc.getSignatureStatuses.mockResolvedValue([null]);
    tx.rpc.sendRawTransaction.mockRejectedValue(
      new RpcError(-32002, "BlockhashNotFound"),
    );
    const accepted: string[] = [];
    const transport = withSender(tx.rpc, {
      timeoutMs: 100,
      assertActive: () => undefined,
      fetch: vi.fn(async (_url, init) => {
        accepted.push(JSON.parse(String(init?.body)).params[0] as string);
        throw new Error("response_lost_after_acceptance");
      }),
    });
    const swap = vi.spyOn(h.deps, "swap");
    h.deps.sender = tx.make(transport);
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    const pending = (await h.store.pending("burn"))!;
    const record = await h.store.read(pending.intent.id);
    expect(record).toMatchObject({ status: "signed" });
    expect(record?.failureProof).toBeUndefined();
    expect(h.store.outcome).not.toHaveBeenCalled();
    expect(tx.rpc.getSignatureStatuses).toHaveBeenCalled();
    expect(tx.rpc.getBlockHeight).toHaveBeenCalledWith(
      "finalized",
      expect.any(AbortSignal),
    );
    h.deps.sender = tx.make(transport);
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(tx.sign).toHaveBeenCalledOnce();
    expect(swap).toHaveBeenCalledOnce();
    expect(new Set(accepted)).toEqual(new Set([record!.transactionBase64]));
    expect(
      tx.rpc.sendRawTransaction.mock.calls.every(
        ([bytes]) =>
          Buffer.from(bytes).toString("base64") === record!.transactionBase64,
      ),
    ).toBe(true);
    expect(h.store.outcome).not.toHaveBeenCalled();
    tx.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "finalized" },
    ]);
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(h.store.outcome).toHaveBeenCalledWith(expect.anything(), {
      status: "confirmed",
      signature: record!.signature,
      finalized: true,
    });
    expect(tx.sign).toHaveBeenCalledOnce();
  });
  it("replans after a market change fails the unsigned second simulation, including restart", async () => {
    const h = harness();
    const tx = realSender(h);
    const measure = vi.spyOn(h.deps, "measure");
    const reference = vi.spyOn(h.deps, "reference");
    const swap = vi.spyOn(h.deps, "swap");
    tx.rpc.simulateTransaction.mockResolvedValueOnce({ err: "stale_route" });
    h.deps.sender = tx.make();
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(measure).toHaveBeenCalledOnce();
    expect(tx.sign).not.toHaveBeenCalled();
    expect(tx.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(h.store.closeUnsigned).toHaveBeenCalledWith(
      expect.anything(),
      "simulation_failed",
    );
    expect(await h.store.pending("burn")).toBeNull();
    // A new process reads fresh state and obtains a fresh route for a new intent.
    h.deps.sender = tx.make();
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(reference).toHaveBeenCalledTimes(2);
    expect(swap).toHaveBeenCalledTimes(2);
    expect(tx.sign).toHaveBeenCalledOnce();
    expect(h.store.outcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "confirmed" }),
    );
  });
  it("never retires signed evidence on a later simulation error or a failed durable check", async () => {
    const h = harness();
    const tx = realSender(h);
    tx.rpc.getSignatureStatuses.mockResolvedValue([null]);
    h.deps.sender = tx.make();
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    const prior = await h.store.pending("burn");
    h.deps.sender = {
      send: async () => {
        throw new TxSenderError("simulation_failed");
      },
    };
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(await h.store.pending("burn")).toEqual(prior);
    expect(h.store.outcome).not.toHaveBeenCalled();
    vi.mocked(h.store.closeUnsigned).mockRejectedValue(
      new Error("database_unavailable"),
    );
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(await h.store.pending("burn")).toEqual(prior);
    expect(h.store.outcome).not.toHaveBeenCalled();
  });
  it("plans, composes, simulates, journals, sends and checks zero residue", async () => {
    const h = harness();
    const residue = vi.fn(async () => 0n);
    h.deps.residue = residue;
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.store.outcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "confirmed", finalized: true }),
    );
    expect(residue).toHaveBeenCalledOnce();
  });
  it("resumes the persisted intent without changing quote or blockhash material", async () => {
    const h = harness();
    const executor = new Executor(h.deps);
    await executor.tick("burn", new AbortController().signal);
    h.deps.swap = vi.fn(async () => {
      throw new Error("must_not_build");
    });
    await executor.tick("burn", new AbortController().signal);
    expect(h.deps.swap).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(2);
  });
  it("never replays a journal entry for a different selected deployment", async () => {
    const h = harness();
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    h.send.mockClear();
    h.deps.deployment = createDeploymentSelector({ devnet: PROGRAM_ID })(
      "devnet",
    );
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.store.diagnostic).toHaveBeenCalledWith(
      expect.anything(),
      "executor_journal_deployment_mismatch",
    );
  });
  it("records an ambiguous send diagnostic without changing its durable outcome", async () => {
    const h = harness();
    h.deps.sender = {
      send: async () => {
        throw new Error("transaction_pending");
      },
    };
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(h.store.diagnostic).toHaveBeenCalledWith(
      expect.anything(),
      "transaction_pending",
    );
    expect(h.store.outcome).not.toHaveBeenCalled();
  });
  it("keeps actual execution residue pending and refuses to reset it on the other timer", async () => {
    const h = harness();
    const receipt = await h.deps.receipt("test-signature");
    h.deps.receipt = async () => ({ ...receipt, sourceResidue: 1n });
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    const pending = await h.store.pending("burn");
    const compose = vi.spyOn(h.deps, "swap");
    const live = vi.spyOn(h.deps, "residue");
    await new Executor(h.deps).tick("jackpot", new AbortController().signal);
    expect(h.store.outcome).not.toHaveBeenCalled();
    expect(await h.store.pending("burn")).toBe(pending);
    expect(compose).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
    expect(h.store.diagnostic).toHaveBeenCalledWith(
      expect.anything(),
      "executor_residue",
    );
    expect(h.deps.alert).toHaveBeenCalledWith("executor_residue", {
      kind: "burn",
      amount: "1",
    });
  });
  it("retains the original failure when diagnostic persistence is unavailable", async () => {
    const h = harness();
    h.deps.sender = {
      send: async () => {
        throw new Error("transaction_pending");
      },
    };
    h.store.diagnostic = async () => {
      throw new Error("database_unavailable");
    };
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(h.store.outcome).not.toHaveBeenCalled();
    expect(h.deps.log).toHaveBeenCalledWith({
      kind: "burn",
      reason: "executor_diagnostic_unavailable",
      cause: { code: "database_unavailable", detail: "database_unavailable" },
    });
    expect(h.deps.log).toHaveBeenCalledWith({
      kind: "burn",
      reason: "transaction_pending",
      cause: { code: "transaction_pending", detail: "transaction_pending" },
    });
  });
  it.each(["mint", "bucket", "ts"] as const)(
    "rejects receipt with a mismatched %s",
    async (field) => {
      const h = harness();
      const receipt = await h.deps.receipt("test-signature");
      h.deps.receipt = async () => ({
        ...receipt,
        ...(field === "mint"
          ? { mint: key(5).toBase58() }
          : field === "bucket"
            ? { bucket: 0 }
            : { ts: 30n }),
      });
      await new Executor(h.deps).tick("burn", new AbortController().signal);
      expect(h.store.landed).not.toHaveBeenCalled();
      expect(h.store.outcome).not.toHaveBeenCalled();
      expect(h.deps.log).toHaveBeenCalledWith({
        kind: "burn",
        reason: "executor_receipt_binding",
        cause: {
          code: "executor_receipt_binding",
          detail: "executor_receipt_binding",
        },
      });
    },
  );
  it("does not attribute an unsigned stale intent to a different trade", async () => {
    const h = harness();
    h.deps.sender = { send: async () => ({ status: "reconciled" }) };
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(h.store.landed).not.toHaveBeenCalled();
    expect(h.store.outcome).toHaveBeenCalledWith(expect.anything(), {
      status: "skipped",
      signature: undefined,
      finalized: true,
    });
  });
  it("treats a mirror refusal as a skipped trade without sending or a failure alert", async () => {
    const h = harness();
    h.deps.p1 = {
      ...port,
      checkExecBegin: () => ({ ok: false, error: "OracleStale" }),
    };
    const executor = new Executor(h.deps);
    for (let i = 0; i < 5; i += 1)
      await executor.tick("burn", new AbortController().signal);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.deps.result).toHaveBeenCalledWith("burn", "skipped");
    expect(h.deps.alert).not.toHaveBeenCalled();
  });
  it("never sends after role loss", async () => {
    const h = harness();
    h.deps.assertActive = () => {
      throw new Error("role_mismatch");
    };
    await expect(
      new Executor(h.deps).tick("burn", new AbortController().signal),
    ).rejects.toThrow("role_mismatch");
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each(["burn", "jackpot"] as const)(
    "%s plans and sends after an outside donation of exactly one wSOL lamport",
    async (kind) => {
      const h = harness();
      h.deps.residue = vi.fn(async () => 1n);
      const receipt = await h.deps.receipt("test-signature");
      const decision = planExecutor(
        kind,
        snapshot(),
        reference,
        EXECUTOR_POLICY,
      );
      if (!decision.ok) throw new Error(decision.reason);
      h.deps.receipt = async () => ({
        ...receipt,
        kind: kind === "burn" ? 3 : 4,
        amount: decision.plan.amount,
      });
      const swap = vi.spyOn(h.deps, "swap");
      await new Executor(h.deps).tick(kind, new AbortController().signal);
      expect(swap).toHaveBeenCalledOnce();
      expect(h.send).toHaveBeenCalledOnce();
      expect(h.deps.result).toHaveBeenCalledWith(kind, "confirmed");
      expect(h.deps.alert).not.toHaveBeenCalled();
      expect(h.deps.log).toHaveBeenCalledWith({
        kind,
        reason: "executor_external_credit",
      });
    },
  );
  it.each(["burn", "jackpot"] as const)(
    "%s reconciles an ambiguous opposite-kind transaction before resetting an outside credit",
    async (kind) => {
      const h = harness();
      const other = kind === "burn" ? "jackpot" : "burn";
      const receipt = await h.deps.receipt("test-signature");
      const decision = planExecutor(
        other,
        snapshot(),
        reference,
        EXECUTOR_POLICY,
      );
      if (!decision.ok) throw new Error(decision.reason);
      h.deps.receipt = async () => ({
        ...receipt,
        kind: other === "burn" ? 3 : 4,
        amount: decision.plan.amount,
      });
      const tx = realSender(h);
      tx.rpc.getSignatureStatuses.mockResolvedValue([null]);
      h.deps.sender = tx.make();
      await new Executor(h.deps).tick(other, new AbortController().signal);
      const pending = await h.store.pending(other);
      expect(pending?.transaction?.status).toBe("signed");
      const residue = vi.fn(async () => 1n);
      h.deps.residue = residue;
      const swap = vi.spyOn(h.deps, "swap");
      tx.rpc.getSignatureStatuses.mockResolvedValue([
        { err: null, confirmationStatus: "finalized" },
      ]);
      await new Executor(h.deps).tick(kind, new AbortController().signal);
      expect(swap).not.toHaveBeenCalled();
      expect(residue).not.toHaveBeenCalled();
      expect(tx.sign).toHaveBeenCalledOnce();
      expect(h.store.outcome).toHaveBeenCalledWith(
        pending,
        expect.objectContaining({ status: "confirmed" }),
      );
    },
  );
  it("alerts after five consecutive execution failures", async () => {
    const h = harness();
    h.deps.swap = async () => {
      throw new Error("route_unavailable");
    };
    const executor = new Executor(h.deps);
    for (let i = 0; i < 5; i += 1)
      await executor.tick("burn", new AbortController().signal);
    expect(h.deps.alert).toHaveBeenCalledWith("executor_failures", {
      failures: 5,
    });
  });
  it("reconciles a signed Burn before an existing unsigned Jackpot plan", async () => {
    const h = harness();
    const tx = realSender(h);
    tx.rpc.getSignatureStatuses.mockResolvedValue([null]);
    h.deps.sender = tx.make();
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    const signed = (await h.store.pending("burn"))!;
    const unsigned: ExecutorJob = {
      ...signed,
      intent: { ...signed.intent, kind: "jackpot", id: "unsigned-jackpot" },
      transaction: undefined,
    };
    h.store.pending = async (kind) => (kind === "burn" ? signed : unsigned);
    tx.rpc.getSignatureStatuses.mockResolvedValue([
      { err: null, confirmationStatus: "finalized" },
    ]);
    const swap = vi.spyOn(h.deps, "swap");
    await new Executor(h.deps).tick("jackpot", new AbortController().signal);
    expect(h.store.outcome).toHaveBeenCalledWith(
      signed,
      expect.objectContaining({ status: "confirmed" }),
    );
    expect(tx.sign).toHaveBeenCalledOnce();
    expect(swap).not.toHaveBeenCalled();
  });
  it("only reconciles when legacy journals have two signed intents sharing the source", async () => {
    const h = harness();
    const tx = realSender(h);
    tx.rpc.getSignatureStatuses.mockResolvedValue([null]);
    h.deps.sender = tx.make();
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    const signed = (await h.store.pending("burn"))!;
    const other: ExecutorJob = {
      ...signed,
      intent: { ...signed.intent, kind: "jackpot", id: "signed-jackpot" },
    };
    h.store.pending = async (kind) => (kind === "burn" ? signed : other);
    const attempts = tx.rpc.sendRawTransaction.mock.calls.length;
    const send = vi.spyOn(h.deps.sender, "send");
    const residue = vi.spyOn(h.deps, "residue");
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ job: signed.intent.id, reconcileOnly: true }),
    );
    expect(tx.rpc.sendRawTransaction).toHaveBeenCalledTimes(attempts);
    expect(tx.sign).toHaveBeenCalledOnce();
    expect(residue).not.toHaveBeenCalled();
    expect(h.store.outcome).not.toHaveBeenCalled();
  });
  it.each(["burn", "jackpot"] as const)(
    "blocks new signatures on finalized legacy %s execution residue, even with zero live balance",
    async (kind) => {
      const h = harness();
      const tx = realSender(h);
      h.deps.sender = tx.make();
      const priorReceipt = await h.deps.receipt("test-signature");
      const decision = planExecutor(
        kind,
        snapshot(),
        reference,
        EXECUTOR_POLICY,
      );
      if (!decision.ok) throw new Error(decision.reason);
      const receipt = {
        ...priorReceipt,
        kind: kind === "burn" ? 3 : 4,
        amount: decision.plan.amount,
      };
      h.deps.receipt = async () => receipt;
      await new Executor(h.deps).tick(kind, new AbortController().signal);
      const completed = (await h.store.pending(kind))!;
      expect(completed.transaction?.finalized).toBe(true);
      h.store.pending = async () => null;
      h.store.latestCompleted = async (candidate) =>
        candidate === kind ? completed : null;
      h.deps.receipt = async () => ({ ...receipt, sourceResidue: 1n });
      h.deps.sender = { send: h.send };
      const swap = vi.spyOn(h.deps, "swap");
      const residue = vi.spyOn(h.deps, "residue");
      await new Executor(h.deps).tick("burn", new AbortController().signal);
      expect(swap).not.toHaveBeenCalled();
      expect(residue).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
      expect(h.deps.alert).toHaveBeenCalledWith("executor_residue", {
        kind,
        amount: "1",
      });
    },
  );
  it.each(["missing", "mismatched", "unsigned"] as const)(
    "fails closed on %s completed history before any source reset",
    async (scenario) => {
      const h = harness();
      const tx = realSender(h);
      h.deps.sender = tx.make();
      await new Executor(h.deps).tick("burn", new AbortController().signal);
      const completed = (await h.store.pending("burn"))!;
      h.store.pending = async () => null;
      h.store.latestCompleted = async (kind) =>
        kind === "burn" ? completed : null;
      const receipt = await h.deps.receipt("test-signature");
      h.deps.receipt = async () => {
        if (scenario === "missing")
          throw new Error("executor_receipt_unavailable");
        return { ...receipt, mint: key(77).toBase58() };
      };
      if (scenario === "unsigned")
        h.store.pending = async (kind) =>
          kind === "jackpot"
            ? {
                ...completed,
                intent: {
                  ...completed.intent,
                  id: "unsigned-jackpot",
                  kind: "jackpot",
                },
                transaction: undefined,
              }
            : null;
      h.deps.sender = { send: h.send };
      const swap = vi.spyOn(h.deps, "swap");
      await new Executor(h.deps).tick("jackpot", new AbortController().signal);
      expect(swap).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
    },
  );
  it("keeps legacy donation baseline tradable after checking completed receipts", async () => {
    const h = harness();
    const tx = realSender(h);
    h.deps.sender = tx.make();
    await new Executor(h.deps).tick("burn", new AbortController().signal);
    const completed = (await h.store.pending("burn"))!;
    h.store.pending = async () => null;
    h.store.latestCompleted = vi.fn(async (kind) =>
      kind === "burn" ? completed : null,
    );
    const receipt = vi.spyOn(h.deps, "receipt");
    h.deps.residue = async () => 1n;
    h.deps.sender = { send: h.send };
    const executor = new Executor(h.deps);
    await executor.tick("burn", new AbortController().signal);
    await executor.tick("burn", new AbortController().signal);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(
      receipt.mock.calls.filter(
        ([signature]) => signature === completed.transaction!.signature,
      ),
    ).toHaveLength(1);
    expect(h.store.latestCompleted).toHaveBeenCalledWith(
      "jackpot",
      expect.objectContaining({ signer }),
    );
    expect(h.deps.alert).not.toHaveBeenCalled();
  });
  it("continues both business loops when alert persistence fails", async () => {
    const h = harness();
    h.deps.swap = async () => {
      throw new Error("route_unavailable");
    };
    h.deps.alert = vi.fn(async () => {
      throw new Error("database_unavailable");
    });
    const executor = new Executor(h.deps);
    for (let i = 0; i < 7; i += 1)
      await expect(
        executor.tick(i % 2 ? "jackpot" : "burn", new AbortController().signal),
      ).resolves.toBeUndefined();
    expect(h.deps.alert).toHaveBeenCalledTimes(3);
    expect(h.deps.result).toHaveBeenCalledTimes(7);
    expect(h.deps.log).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "executor_alert_unavailable" }),
    );
  });
  it("aborts and drains the sibling timer when one business loop terminates", async () => {
    const h = harness();
    const parent = new AbortController();
    const signals: AbortSignal[] = [];
    let drained = false;
    h.deps.sleep = vi.fn(async (_ms, signal) => {
      signals.push(signal);
      if (signals.length === 1) throw new Error("timer_unavailable");
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            drained = true;
            resolve();
          },
          { once: true },
        ),
      );
    });
    const executor = new Executor(h.deps);
    await expect(executor.onLeader(parent.signal)).rejects.toThrow(
      "executor_timer_failed",
    );
    expect(parent.signal.aborted).toBe(false);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(drained).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
    const nextParent = new AbortController();
    const next = executor.onLeader(nextParent.signal);
    parent.abort();
    expect(signals.slice(2).every((signal) => !signal.aborted)).toBe(true);
    nextParent.abort();
    await next;
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it("notifies the supervisor before a stalled sibling has drained", async () => {
    const h = harness();
    const signals: AbortSignal[] = [];
    let release!: () => void;
    h.deps.onFailure = vi.fn();
    h.deps.sleep = async (_ms, signal) => {
      signals.push(signal);
      if (signals.length === 1) throw new Error("timer_unavailable");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const task = new Executor(h.deps).onLeader(new AbortController().signal);
    const completed = vi.fn();
    void task.then(completed, completed);
    await vi.waitFor(() => expect(h.deps.onFailure).toHaveBeenCalledOnce());
    expect(h.deps.onFailure).toHaveBeenCalledWith(
      new Error("executor_timer_failed"),
    );
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(completed).not.toHaveBeenCalled();
    release();
    await expect(task).rejects.toThrow("executor_timer_failed");
  });
});
