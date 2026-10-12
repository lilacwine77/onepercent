import { expect, it, vi } from "vitest";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SystemProgram,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { execBeginIx, execEndIx, EXEC_KIND } from "@onepercent/sdk";
import { minOutMajor } from "@onepercent/sdk/server";
import type { VersionedTransactionResponse } from "@solana/web3.js";
import type { ServiceRuntime, SignedTxRecord } from "@onepercent/service-kit";
import { HIT_LIST } from "@onepercent/config";
import { evaluateMajor, evaluateTrending } from "@onepercent/market";
import { fixture } from "./testing.js";
const mocks = vi.hoisted(() => ({
  chain: {} as Record<string, unknown>,
  clients: {} as Record<string, unknown>,
  record: vi.fn(async () => "plan"),
  trade: vi.fn(async () => {}),
  rpcSimulation: vi.fn(async (): Promise<{ err: unknown }> => ({ err: null })),
  sender: vi.fn(),
  savePlan: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
  pending: vi.fn<() => Promise<string | null>>(async () => null),
  read: vi.fn<() => Promise<SignedTxRecord | null>>(async () => null),
  restore: vi.fn(async () => ({ instructions: [], computeUnitLimit: 100000 })),
  completeIncompleteReceipt: vi.fn(async () => {}),
}));
vi.mock("./chain.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  StockChain: class {
    constructor() {
      Object.assign(this, mocks.chain);
    }
  },
}));
vi.mock("@onepercent/cli/hitlist", () => ({
  listingClients: () => mocks.clients,
  saveReport: vi.fn(),
}));
vi.mock("./store.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  StockStore: class {
    record = mocks.record;
    trade = mocks.trade;
    savePlan = mocks.savePlan;
    update = mocks.update;
    pending = mocks.pending;
    read = mocks.read;
    restore = mocks.restore;
    completeIncompleteReceipt = mocks.completeIncompleteReceipt;
  },
}));
vi.mock("@onepercent/service-kit", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createTxRpc: () => ({
    simulateTransaction: mocks.rpcSimulation,
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100,
    }),
  }),
  TxSender: mocks.sender,
}));
vi.mock("node:timers/promises", () => ({
  setTimeout: () => new Promise((resolve) => setTimeout(resolve, 0)),
}));
import { createStockExtension } from "./runtime.js";
import { stockBuyGuardRefusal } from "./landing.js";

it.each([
  ["mainnet-beta", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  ["devnet", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1"],
  ["mainnet-beta", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"],
  ["devnet", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"],
] as const)(
  "K1 rejects a truncated or foreign genesis on %s: %s",
  async (cluster, genesis) => {
    vi.clearAllMocks();
    vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(genesis);
    const runtime = {
      env: {
        RPC_URL: "http://127.0.0.1:8899",
        CLUSTER: cluster,
        PROGRAM_ID: PublicKey.default.toBase58(),
      },
    } as ServiceRuntime;
    try {
      await expect(
        createStockExtension(
          runtime,
          {},
        )({
          signal: new AbortController().signal,
          assertLeader() {},
        }),
      ).rejects.toThrow("stock_cluster_mismatch");
      expect(mocks.record).not.toHaveBeenCalled();
      expect(mocks.sender).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  },
);

it.each<{
  live: boolean;
  passed: boolean;
  cluster?: "mainnet-beta" | "devnet";
  cached?: string;
  refusal?: number;
  secondProbe?: boolean;
}>([
  { live: false, passed: true },
  { live: false, passed: true, cluster: "mainnet-beta" },
  { live: false, passed: true, cluster: "devnet" },
  { live: true, passed: true },
  { live: false, passed: false },
  { live: false, passed: false, cached: "trending" },
  { live: false, passed: false, cached: "future" },
  { live: false, passed: false, cached: "mint" },
  { live: false, passed: false, cached: "partial" },
  ...[6071, 6072, 6073, 6074].flatMap((refusal) => [
    { live: false, passed: true, refusal },
    { live: true, passed: true, refusal },
    { live: true, passed: true, refusal, secondProbe: true },
  ]),
])(
  "stock live=$live, cluster=$cluster, listing=$passed, cache=$cached, refusal=$refusal preserves dry mode, listing failures and fresh replans",
  async ({ live, passed, cluster, cached, refusal, secondProbe }) => {
    vi.clearAllMocks();
    const genesis = vi
      .spyOn(Connection.prototype, "getGenesisHash")
      .mockResolvedValue(
        cluster === "mainnet-beta"
          ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
          : "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      );
    mocks.rpcSimulation.mockResolvedValue({
      err: secondProbe ? { InstructionError: [2, { Custom: refusal }] } : null,
    });
    const f = fixture(),
      abort = new AbortController();
    mocks.record.mockImplementation(async () => {
      if (!passed) abort.abort();
      return "plan";
    });
    const base = {
      mint: f.args.mint.toBase58(),
      symbol: "TEST",
      mintSafe: true,
      capLamports: 100_000_000_000n,
      excludedHolders: null,
      jupiterTopHoldersPercentage: null,
    };
    const report = evaluateMajor(
      {
        ...base,
        pyth: {
          price: "10000",
          conf: "1",
          expo: -8,
          publish_time: Number(f.now),
        },
        firstPoolCreatedAtMs:
          Number(f.now) * 1000 - HIT_LIST.majorBar.minAgeDays * 86400000,
        externalDepthUsd: HIT_LIST.majorBar.minLiquidityUsd,
        sellRecoveryBps: BigInt(HIT_LIST.majorBar.sell150SolMinRecoveryBps),
        dailySigmaBps: passed ? 0 : 2000,
      },
      Number(f.now) * 1000,
    );
    expect(report.pass).toBe(passed);
    let cachedReport: unknown = report;
    if (cached === "trending") {
      cachedReport = evaluateTrending(
        {
          ...base,
          pumpOrigin: true,
          graduatedPool: base.mint,
          canonicalPool: base.mint,
          graduatedAtMs:
            Number(f.now) * 1000 -
            HIT_LIST.trendingBar.minGraduatedDays * 86400000,
          realQuoteLamports: HIT_LIST.trendingBar.minPoolQuoteLamports,
          holderCount: HIT_LIST.trendingBar.minHolders,
          top10Bps: BigInt(HIT_LIST.trendingBar.maxTop10Bps),
          organicScore: HIT_LIST.trendingBar.minOrganicScore,
          auditNotSus: true,
          curveMayhem: false,
          poolMayhem: false,
          curveSolQuote: true,
          poolSolQuote: true,
        },
        Number(f.now) * 1000,
      );
      expect(cachedReport).toMatchObject({ class: "TRENDING", pass: true });
    }
    if (cached === "future")
      cachedReport = { ...report, checkedAt: Date.now() + 86400000 };
    if (cached === "mint")
      cachedReport = { ...report, mint: PublicKey.default.toBase58() };
    if (cached === "partial")
      cachedReport = { pass: true, checkedAt: Number(f.now) * 1000 };
    const listingCheck = vi.fn(async () => ({
      report,
      oracle: f.state.machine.buckets[0]!.oracle,
    }));
    const instructions = [
      execBeginIx(f.state.deployment.programId, f.args),
      execEndIx(f.state.deployment.programId, f.args),
    ];
    const table = new AddressLookupTableAccount({
      key: new PublicKey(new Uint8Array(32).fill(80)),
      state: {
        deactivationSlot: (1n << 64n) - 1n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: instructions.flatMap((i) => i.keys.map((k) => k.pubkey)),
      },
    });
    let simulations = 0;
    const simulate = vi
      .spyOn(Connection.prototype, "simulateTransaction")
      .mockImplementation(async () => {
        if (live && ++simulations === 2) abort.abort();
        return {
          context: { slot: 1 },
          value: {
            err:
              !live && refusal
                ? { InstructionError: [2, { Custom: refusal }] }
                : null,
            logs: [],
            unitsConsumed: 100000,
          },
        };
      });
    const rebuild = vi.fn();
    mocks.sender.mockImplementation(function (options: {
      rpc: {
        getLatestBlockhash(): Promise<unknown>;
        simulateTransaction(...args: unknown[]): Promise<unknown>;
      };
    }) {
      return {
        send: async (request: { rebuild(arg: unknown): Promise<unknown> }) => {
          if (secondProbe) {
            // Drive the real wrapper with the second RPC simulation result.
            await options.rpc.simulateTransaction({});
            throw new Error("expected P3 simulation refusal");
          }
          await options.rpc.getLatestBlockhash();
          await expect(options.rpc.getLatestBlockhash()).rejects.toThrow(
            "stock_wait_new_blockhash",
          );
          rebuild(
            await request.rebuild({
              reason: refusal ? "failed" : "expired",
              previous: { finalized: true, signature: "finalized-refusal" },
            }),
          );
          return { status: "skipped" };
        },
      };
    });
    if (live && refusal)
      vi.spyOn(Connection.prototype, "getTransaction").mockResolvedValue({
        meta: { err: { InstructionError: [2, { Custom: refusal }] } },
      } as unknown as VersionedTransactionResponse);
    vi.spyOn(Connection.prototype, "getAddressLookupTable").mockResolvedValue({
      context: { slot: 1 },
      value: table,
    });
    vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 100,
    });
    const chainConnection = { getBlockTime: vi.fn(async () => 0) };
    mocks.chain = {
      connection: chainConnection,
      snapshot: async () => ({ ...f.state, slot: 1, now: f.now }),
      now: async () => f.now,
      limits: async () => ({
        buyBlockReason: null,
        spendableSol: f.state.machine.stock_sol,
        payoutReserve: 0n,
        inventoryInflowBound: 0n,
        lastReveal: null,
      }),
      evidence: async (_state: unknown, request: { amount: bigint }) => ({
        args: { ...f.args, amount: request.amount },
        readings: f.readings,
      }),
      read: async () => f.readings.oracles[0],
    };
    const quote = (amount: bigint) =>
      minOutMajor({
        amount,
        solPrice: 10_901_000_000n,
        solExponent: -8,
        tokenPrice: 85_000_000n,
        tokenExponent: -8,
        decimals: 6,
      });
    mocks.clients = {
      check: listingCheck,
      swap: {
        quoteBuy: async (_mint: string, amount: bigint) => ({
          outAmount: quote(amount).expected,
          minOut: quote(amount).minOut,
          priceImpact: "0",
        }),
        build: async ({ amount }: { amount: bigint }) => ({
          inAmount: amount,
          outAmount: quote(amount).expected,
          minOut: quote(amount).minOut,
          otherInstructions: [],
          setupInstructions: [],
          swapInstruction: {
            programId: SystemProgram.programId.toBase58(),
            accounts: [],
            data: "",
          },
          cleanupInstruction: null,
          lookupTables: {},
        }),
      },
    };
    let usedBlockhash = false;
    const query = vi.fn(async (sql: string) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("pg_try_advisory"))
        return { rows: [{ acquired: true }] };
      if (sql.includes("lastBlockhash")) {
        const rows = usedBlockhash ? [{ id: "prior-plan" }] : [];
        usedBlockhash = true;
        return { rows };
      }
      if (sql.includes("SELECT state,plan FROM stock_plans"))
        return { rows: [] };
      if (sql.includes("UPDATE stock_trades")) return { rows: [] };
      if (sql.includes("SELECT report"))
        return {
          rows: [{ report: cachedReport }],
        };
      throw new Error(`unexpected test query ${sql}`);
    });
    const info = vi.fn((_record, message) => {
      if (
        (!live || secondProbe) &&
        (message === "stock dry run" ||
          (refusal && message === "stock waits before replanning"))
      )
        abort.abort();
    });
    const runtime = {
      key: {},
      env: {
        RPC_URL: "http://localhost:8899",
        CLUSTER: cluster ?? "localnet",
        PROGRAM_ID: f.state.deployment.programId.toBase58(),
      },
      pool: { query, connect: async () => ({ query, release() {} }) },
      rpc: {},
      guard: { assertAuthorized() {} },
      logger: { info, warn: vi.fn() },
      alerts: { alert: vi.fn() },
      metrics: { stockHourlyUsageBps: { set: vi.fn() } },
    } as unknown as ServiceRuntime;
    const timer = setTimeout(() => abort.abort(), 2000);
    try {
      await createStockExtension(runtime, {
        FLAG_KEEPER_STOCK_LIVE: live ? "on" : "off",
        STOCK_PROTOCOL_LUT: table.key.toBase58(),
      })({ signal: abort.signal, assertLeader() {} });
    } finally {
      clearTimeout(timer);
      vi.restoreAllMocks();
    }
    expect(genesis).toHaveBeenCalledTimes(cluster ? 1 : 0);
    if (refusal) {
      expect(runtime.logger.info).toHaveBeenCalledWith(
        stockBuyGuardRefusal({ InstructionError: [2, { Custom: refusal }] }),
        "stock waits before replanning",
      );
      expect(runtime.logger.warn).not.toHaveBeenCalled();
      expect(mocks.update).toHaveBeenCalledWith(
        "plan",
        expect.objectContaining({
          wait: stockBuyGuardRefusal({
            InstructionError: [2, { Custom: refusal }],
          }),
        }),
      );
      if (!live || secondProbe) {
        if (!live) expect(mocks.sender).not.toHaveBeenCalled();
        else expect(mocks.rpcSimulation).toHaveBeenCalledTimes(1);
        expect(simulate).toHaveBeenCalledTimes(1);
        return;
      }
    }
    if (!passed) {
      if (cached)
        expect(listingCheck).toHaveBeenCalledExactlyOnceWith(
          f.args.mint.toBase58(),
          "major",
        );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("mint=$1 AND class=$2"),
        [f.args.mint.toBase58(), "major"],
      );
      expect(simulate).not.toHaveBeenCalled();
      expect(mocks.record).toHaveBeenCalledWith(
        expect.anything(),
        1,
        f.now,
        [],
        false,
      );
      expect(query.mock.calls.every(([sql]) => !sql.includes("buckets"))).toBe(
        true,
      );
      expect(runtime.alerts.alert).toHaveBeenCalledWith(
        "stock_listing:0",
        "warning",
        expect.objectContaining({
          command: expect.stringContaining("guardian DisableBucket"),
        }),
      );
      return;
    }
    expect(simulate).toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      1,
      f.now,
      expect.arrayContaining([expect.objectContaining({ reason: "anchor" })]),
      live,
    );
    if (live) {
      expect(rebuild).toHaveBeenCalledExactlyOnceWith(null);
      expect(mocks.update).toHaveBeenCalledWith("plan", { done: true });
      expect(mocks.record).toHaveBeenCalledTimes(2);
      const first = mocks.record.mock.calls[0] as unknown as [
        unknown,
        unknown,
        unknown,
        Array<{ amount: bigint }>,
      ];
      const second = mocks.record.mock.calls[1] as unknown as typeof first;
      expect(second[3][0]!.amount).toBe(
        first[3][0]!.amount / (refusal ? 1n : 2n),
      );
      expect(simulate).toHaveBeenCalledTimes(2);
    } else {
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ live: false }),
        "stock dry run",
      );
      expect(mocks.sender).not.toHaveBeenCalled();
      expect(mocks.savePlan).not.toHaveBeenCalled();
    }
  },
);

it("closes finalized truncated receipts over three resumptions and admits sell-down again", async () => {
  vi.clearAllMocks();
  const f = fixture(true),
    signer = Keypair.generate();
  const instructions = [
    execBeginIx(f.state.deployment.programId, f.args),
    execEndIx(f.state.deployment.programId, f.args),
  ];
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions,
    }).compileToV0Message(),
  );
  tx.sign([signer]);
  // Base58 fixture encoding, with no additional production dependency.
  let n = BigInt("0x" + Buffer.from(tx.signatures[0]!).toString("hex")),
    signature = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    signature = alphabet[Number(n % 58n)] + signature;
    n /= 58n;
  }
  for (const b of tx.signatures[0]!) {
    if (b) break;
    signature = "1" + signature;
  }
  const signed: SignedTxRecord = {
    fingerprint: "a".repeat(64),
    signature,
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    lastValidBlockHeight: 100,
    status: "confirmed",
    finalized: true,
  };
  let closed = false;
  mocks.read.mockResolvedValue(signed);
  mocks.pending.mockImplementation(async () => (closed ? null : "pending"));
  mocks.completeIncompleteReceipt.mockImplementation(async () => {
    closed = true;
  });
  mocks.sender.mockImplementation(function () {
    return {
      send: async () => ({ status: "confirmed", signature, finalized: true }),
    };
  });
  const receipt = {
    slot: 101,
    transaction: { message: tx.message, signatures: [signature] },
    meta: { err: null, logMessages: ["Log truncated"] },
  } as unknown as VersionedTransactionResponse;
  const getTx = vi
    .spyOn(Connection.prototype, "getTransaction")
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValue(receipt);
  f.state.machine.buckets[0]!.enabled = 0;
  mocks.chain = {
    snapshot: async () => ({ ...f.state, slot: 101, now: f.now }),
    now: async () => f.now,
    limits: async () => ({
      ...f.state,
      buyBlockReason: "last_reveal_unavailable",
    }),
    read: async () => f.readings.oracles[0],
    evidence: async (_state: unknown, request: { amount: bigint }) => ({
      args: { ...f.args, amount: request.amount },
      readings: f.readings,
    }),
  };
  const report = {
    version: "x2-listing-v1",
    class: "MAJOR",
    mint: f.args.mint.toBase58(),
    checkedAt: Number(f.now) * 1000,
    pass: false,
    criteria: [
      {
        id: "sigma_daily_bps",
        pass: false,
        observed: 2000,
        threshold: HIT_LIST.majorBar.maxDailySigmaBps,
        source: "fixture",
      },
    ],
    info: {
      capLamports: "100000000000",
      excludedHolders: null,
      jupiterTopHoldersPercentage: null,
    },
  };
  mocks.clients = {
    swap: {
      quoteSell: async (_mint: string, amount: bigint) => {
        const q = minOutMajor({
          amount,
          sell: true,
          solPrice: 10_901_000_000n,
          solExponent: -8,
          tokenPrice: 85_000_000n,
          tokenExponent: -8,
          decimals: 6,
        });
        return { outAmount: q.expected, minOut: q.minOut, priceImpact: "0" };
      },
    },
  };
  const runtime = {
    key: {},
    env: {
      RPC_URL: "http://127.0.0.1:8899",
      CLUSTER: "localnet",
      PROGRAM_ID: f.state.deployment.programId.toBase58(),
    },
    rpc: {},
    guard: { assertAuthorized() {} },
    pool: {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes("SELECT report") ? [{ report }] : [],
      })),
    },
    alerts: { alert: vi.fn(async () => {}) },
    logger: { warn: vi.fn(), info: vi.fn() },
    metrics: {
      stockHourlyUsageBps: { set() {} },
      stockSlippageBps: { set: vi.fn() },
    },
  } as unknown as ServiceRuntime;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const abort = new AbortController();
      // Stop each leader after exactly one cycle, including failed receipt reads.
      const stop = () => abort.abort();
      vi.mocked(runtime.logger.warn).mockImplementation(stop);
      vi.mocked(runtime.alerts.alert).mockImplementation(async (name) => {
        if (name.startsWith("stock_receipt:")) stop();
        return { recorded: true, delivered: true };
      });
      mocks.record.mockImplementation(async () => {
        stop();
        return "next-plan";
      });
      await createStockExtension(runtime, {
        FLAG_KEEPER_STOCK_LIVE: "on",
        STOCK_PROTOCOL_LUT: PublicKey.default.toBase58(),
      })({
        signal: abort.signal,
        assertLeader() {},
      });
      expect(closed).toBe(attempt >= 2);
    }
    expect(getTx).toHaveBeenCalledTimes(3);
    expect(mocks.completeIncompleteReceipt).toHaveBeenCalledExactlyOnceWith(
      "pending",
      signature,
      101,
    );
    expect(runtime.alerts.alert).toHaveBeenCalledWith(
      "stock_receipt:pending",
      "warning",
      {
        signature,
        reason: "finalized_receipt_incomplete",
      },
    );
    expect(runtime.metrics.stockSlippageBps.set).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      expect.anything(),
      101,
      f.now,
      expect.arrayContaining([
        expect.objectContaining({
          kind: EXEC_KIND.stockSell,
          reason: "sell_down",
        }),
      ]),
      true,
    );
  } finally {
    vi.restoreAllMocks();
    mocks.pending.mockResolvedValue(null);
  }
});
