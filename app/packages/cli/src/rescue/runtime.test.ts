import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { ONEPERCENT_PROGRAM_IDS, PROGRAM_IDS, VRF } from "@onepercent/config";
import { IDL, redeemInstruction } from "@onepercent/sdk";
import {
  findOpenPulls,
  readClock,
  readCore,
  planRedeem,
  planAdvancePhase,
  planStartFinalPull,
  planClaimFinalSol,
  planClaimFinalTokens,
  planEverythingBackStage,
  GET_EVERYTHING_BACK_ORDER,
  type RescuePlan,
} from "@onepercent/sdk/rescue";
import { parseRescueArgs } from "./input.js";
import {
  checkCluster,
  pendingReport,
  resolvePulls,
  runRescue,
  selectDeployment,
  type RescueDependencies,
} from "./runtime.js";
import { sendRescueTransaction } from "./send.js";

vi.mock("@onepercent/sdk/rescue", async (load) => ({
  ...(await load<typeof import("@onepercent/sdk/rescue")>()),
  findOpenPulls: vi.fn(),
  readClock: vi.fn(),
  readCore: vi.fn(),
  planRedeem: vi.fn(),
  planAdvancePhase: vi.fn(),
  planStartFinalPull: vi.fn(),
  planClaimFinalSol: vi.fn(),
  planClaimFinalTokens: vi.fn(),
  planEverythingBackStage: vi.fn(),
}));
vi.mock("./send.js", async (load) => ({
  ...(await load<typeof import("./send.js")>()),
  sendRescueTransaction: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

const localGenesis = Keypair.generate().publicKey.toBase58();
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

function runtimeFixture() {
  const signer = Keypair.generate();
  const block = {
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 100,
  };
  const getLatestBlockhash = vi.fn().mockResolvedValue(block);
  const emit = vi.fn();
  const deps: RescueDependencies = {
    connect: () =>
      ({
        getLatestBlockhash,
        // A local validator's genesis differs from mainnet's and devnet's.
        getGenesisHash: vi.fn(async () => localGenesis),
      }) as unknown as Connection,
    readText: vi.fn(async () => JSON.stringify([...signer.secretKey])),
    emit,
    confirm: vi.fn(async () => true),
  };
  vi.mocked(readCore).mockResolvedValue(
    {} as Awaited<ReturnType<typeof readCore>>,
  );
  const baseArgs = [
    "--rpc",
    "http://127.0.0.1:8899",
    "--cluster",
    "localnet",
    "--program",
    Keypair.generate().publicKey.toBase58(),
  ];
  const transaction = () =>
    new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: block.blockhash,
    });
  return {
    signer,
    block,
    getLatestBlockhash,
    emit,
    deps,
    baseArgs,
    transaction,
  };
}

describe("rescue CLI selection and remaining positions", () => {
  it("all-due excludes healthy pending Pulls and includes the exact chain deadline", async () => {
    const past = Keypair.generate().publicKey;
    const due = Keypair.generate().publicKey;
    const future = Keypair.generate().publicKey;
    const created = 1_000n;
    const timestamp = created + BigInt(VRF.timeoutSeconds);
    vi.mocked(readClock).mockResolvedValue({
      slot: 50,
      unixTimestamp: timestamp,
    });
    vi.mocked(findOpenPulls).mockResolvedValue([
      { address: past, created_ts: created - 1n },
      { address: due, created_ts: created },
      { address: future, created_ts: created + 1n },
    ] as Awaited<ReturnType<typeof findOpenPulls>>);
    const input = parseRescueArgs([
      "refund",
      "--all-due",
      "--rpc",
      "http://127.0.0.1:8899",
      "--fee-payer",
      "local.json",
    ]);
    expect(
      await resolvePulls(input, {} as Connection, Keypair.generate().publicKey),
    ).toEqual([past, due]);
    expect(findOpenPulls).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      1,
    );
  });
  it("partial reports retain transaction selections, existing reasons and later stages", () => {
    const plan: RescuePlan = {
      transactions: [
        {
          action: "redeem",
          addresses: ["wallet"],
          indices: [7, 3],
          details: [{ index: 7, amount: 44n }],
          transaction: new Transaction(),
        },
      ],
      remaining: [
        { action: "settle", address: "pull", reason: "rpc_scan_refused" },
      ],
    };
    expect(
      pendingReport(plan, ["take-back", "close-vault"], "limit reached"),
    ).toEqual([
      ...plan.remaining,
      {
        action: "redeem",
        addresses: ["wallet"],
        indices: [7, 3],
        details: [{ index: 7, amount: 44n }],
        reason: "limit reached",
      },
      { action: "take-back", reason: "Later stage not attempted" },
      { action: "close-vault", reason: "Later stage not attempted" },
    ]);
  });

  it("a truncated preview reports the unpreviewed transaction indices", async () => {
    const f = runtimeFixture();
    const transactions: RescuePlan["transactions"] = [7, 3].map((index) => ({
      action: "redeem",
      addresses: [f.signer.publicKey.toBase58()],
      indices: [index],
      details: [{ index, amount: BigInt(index + 1) }],
      transaction: f.transaction(),
    }));
    vi.mocked(planRedeem).mockResolvedValue({ transactions, remaining: [] });
    vi.mocked(sendRescueTransaction).mockResolvedValue({ state: "preview" });

    expect(
      await runRescue(
        [
          ...f.baseArgs,
          "redeem",
          "--all",
          "--dry-run",
          "--wallet",
          f.signer.publicKey.toBase58(),
          "--max",
          "1",
        ],
        f.deps,
      ),
    ).toBe(2);
    expect(sendRescueTransaction).toHaveBeenCalledTimes(1);
    expect(sendRescueTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, signer: undefined }),
      transactions[0],
      f.block.lastValidBlockHeight,
    );
    expect(f.emit).toHaveBeenLastCalledWith({
      type: "remaining",
      sent: 0,
      previews: 1,
      items: [
        {
          action: "redeem",
          addresses: transactions[1]!.addresses,
          indices: [3],
          details: transactions[1]!.details,
          reason:
            "Preview transaction limit reached; refresh from chain to resume.",
        },
      ],
    });
    expect(f.deps.readText).not.toHaveBeenCalled();
  });

  it("an RPC failure before the next stage preserves that stage after a signed transaction", async () => {
    const f = runtimeFixture();
    vi.mocked(planEverythingBackStage)
      .mockResolvedValueOnce({
        transactions: [
          {
            action: "refund",
            addresses: [Keypair.generate().publicKey.toBase58()],
            transaction: f.transaction(),
          },
        ],
        remaining: [],
      })
      .mockResolvedValueOnce({ transactions: [], remaining: [] });
    vi.mocked(sendRescueTransaction).mockResolvedValue({
      state: "confirmed",
      signature: "confirmed-test-signature",
    });
    f.getLatestBlockhash
      .mockReset()
      .mockResolvedValueOnce(f.block)
      .mockResolvedValueOnce(f.block)
      .mockRejectedValueOnce(new Error("provider unavailable"));

    expect(
      await runRescue(
        [...f.baseArgs, "all", "--keypair", "local.json"],
        f.deps,
      ),
    ).toBe(2);
    expect(sendRescueTransaction).toHaveBeenCalledTimes(1);
    expect(planEverythingBackStage).toHaveBeenCalledTimes(2);
    expect(f.getLatestBlockhash).toHaveBeenCalledTimes(3);
    expect(f.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "remaining",
        sent: 1,
        error: "rescue_failed",
        items: GET_EVERYTHING_BACK_ORDER.slice(1).map((action) => ({
          action,
          reason: "Later stage not attempted",
        })),
      }),
    );
  });

  it.each([false, true])(
    "reconciles CardMoved before rebuilding when the failure finalizes: %s",
    async (failureFinalizes) => {
      const f = runtimeFixture();
      const programId = new PublicKey(f.baseArgs.at(-1)!);
      const mint = Keypair.generate().publicKey;
      const code = IDL.errors!.find(
        (entry) => entry.name === "CardMoved",
      )!.code;
      const error = { InstructionError: [0, { Custom: code }] };
      const statuses = [
        { slot: 12, err: error, confirmationStatus: "confirmed" },
        failureFinalizes
          ? { slot: 12, err: error, confirmationStatus: "finalized" }
          : null,
        { slot: 14, err: null, confirmationStatus: "finalized" },
      ];
      let landed = false;
      let built = 0;
      vi.mocked(planRedeem).mockImplementation(async () => {
        if (landed) return { transactions: [], remaining: [] };
        const cardIndex = built++;
        return {
          transactions: [
            {
              action: "redeem",
              addresses: [f.signer.publicKey.toBase58()],
              indices: [cardIndex],
              slot: 12,
              transaction: f.transaction().add(
                redeemInstruction(programId, {
                  owner: f.signer.publicKey,
                  mint,
                  tokenProgram: new PublicKey(PROGRAM_IDS.splToken),
                  cardIndex,
                  amount: 1n,
                }),
              ),
            },
          ],
          remaining: [],
        };
      });
      const sendsAtStatus: number[] = [];
      const buildsAtStatus: number[] = [];
      const sendRawTransaction = vi
        .fn()
        .mockRejectedValue(new Error("lost response"));
      const getSignatureStatuses = vi.fn(async () => {
        sendsAtStatus.push(sendRawTransaction.mock.calls.length);
        buildsAtStatus.push(built);
        const status = statuses.shift() ?? null;
        landed =
          status?.confirmationStatus === "finalized" && status.err === null;
        return { context: { slot: 14 }, value: [status] };
      });
      const rpc = {
        ...f.deps.connect("http://127.0.0.1:8899"),
        simulateTransaction: vi.fn().mockResolvedValue({
          context: { slot: 12 },
          value: { err: null, logs: [] },
        }),
        getBlockHeight: vi.fn().mockResolvedValue(1),
        getSignatureStatuses,
        sendRawTransaction,
      } as unknown as Connection;
      f.deps.connect = () => rpc;
      const actual =
        await vi.importActual<typeof import("./send.js")>("./send.js");
      vi.mocked(sendRescueTransaction).mockImplementation(
        (options, item, height) =>
          actual.sendRescueTransaction(
            { ...options, sleep: async () => {} },
            item,
            height,
          ),
      );

      expect(
        await runRescue(
          [
            ...f.baseArgs,
            "redeem",
            "--all",
            "--keypair",
            "local.json",
            "--yes",
          ],
          f.deps,
        ),
      ).toBe(0);
      const expectedSends = failureFinalizes ? 2 : 1;
      expect(sendsAtStatus).toEqual([1, 1, expectedSends]);
      expect(buildsAtStatus).toEqual([1, 1, expectedSends]);
      expect(sendRawTransaction).toHaveBeenCalledTimes(expectedSends);
      expect(planRedeem).toHaveBeenCalledTimes(expectedSends + 1);
      const signed = f.emit.mock.calls
        .map(([record]) => record as Record<string, unknown>)
        .filter((record) => record.type === "signed");
      expect(signed).toHaveLength(expectedSends);
      expect(new Set(signed.map((record) => record.signature)).size).toBe(
        expectedSends,
      );
      expect(getSignatureStatuses.mock.calls).toEqual([
        [[signed[0]!.signature], { searchTransactionHistory: true }],
        [[signed[0]!.signature], { searchTransactionHistory: true }],
        [[signed.at(-1)!.signature], { searchTransactionHistory: true }],
      ]);
    },
  );
});

describe("rescue CLI deployment selection", () => {
  const rpc = "http://127.0.0.1:8899";
  const custom = Keypair.generate().publicKey.toBase58();
  const select = (...args: string[]) =>
    selectDeployment(parseRescueArgs(["status", "--rpc", rpc, ...args]));

  it("selects published ids through the SDK deployment selector and marks overrides", () => {
    if (ONEPERCENT_PROGRAM_IDS.devnet) {
      const devnet = select("--cluster", "devnet");
      expect(devnet.deployment.cluster).toBe("devnet");
      expect(devnet.deployment.programId.toBase58()).toBe(
        ONEPERCENT_PROGRAM_IDS.devnet,
      );
      expect(devnet.custom).toBe(false);
    }
    const override = select("--cluster", "devnet", "--program", custom);
    expect(override.deployment.programId.toBase58()).toBe(custom);
    expect(override.custom).toBe(true);
    const local = select("--cluster", "localnet", "--program", custom);
    expect(local.deployment.cluster).toBe("localnet");
    expect(local.custom).toBe(true);
  });

  it("defaults to mainnet and refuses it until an id is published or passed", () => {
    if (ONEPERCENT_PROGRAM_IDS.mainnet === null) {
      expect(() => select()).toThrow(
        "program_id_not_published_use_advanced_program",
      );
      const explicit = select("--program", custom);
      expect(explicit.deployment.cluster).toBe("mainnet");
      expect(explicit.deployment.programId.toBase58()).toBe(custom);
      expect(explicit.custom).toBe(true);
    } else
      expect(select().deployment.programId.toBase58()).toBe(
        ONEPERCENT_PROGRAM_IDS.mainnet,
      );
    expect(() => select("--cluster", "localnet")).toThrow(
      "program_id_not_published_use_advanced_program",
    );
  });

  it("checks the RPC genesis against the selected cluster", async () => {
    const connection = (hash: string) =>
      ({ getGenesisHash: async () => hash }) as unknown as Connection;
    await expect(
      checkCluster(connection(MAINNET_GENESIS), "mainnet"),
    ).resolves.toBeUndefined();
    await expect(
      checkCluster(connection(DEVNET_GENESIS), "mainnet"),
    ).rejects.toThrow("rpc_cluster_mismatch");
    await expect(
      checkCluster(connection(localGenesis), "devnet"),
    ).rejects.toThrow("rpc_cluster_mismatch");
    await expect(
      checkCluster(connection(localGenesis), "localnet"),
    ).resolves.toBeUndefined();
    for (const hash of [MAINNET_GENESIS, DEVNET_GENESIS])
      await expect(checkCluster(connection(hash), "localnet")).rejects.toThrow(
        "rpc_cluster_mismatch",
      );
  });
});

describe("rescue CLI phase crank", () => {
  const notDue = {
    transactions: [],
    remaining: [
      {
        action: "advance-phase" as const,
        reason: "NoTransitionDue: On Air is due at chain timestamp 9",
      },
    ],
  };

  it("sends nothing and exits 4 when no transition is due", async () => {
    const f = runtimeFixture();
    vi.mocked(planAdvancePhase).mockResolvedValue(notDue);
    expect(
      await runRescue(
        [...f.baseArgs, "crank", "advance-phase", "--fee-payer", "payer.json"],
        f.deps,
      ),
    ).toBe(4);
    expect(sendRescueTransaction).not.toHaveBeenCalled();
    expect(f.emit).toHaveBeenLastCalledWith({
      type: "remaining",
      items: notDue.remaining,
      sent: 0,
      previews: 0,
    });
  });

  it("re-reads after each confirmed transition and finishes when none is due", async () => {
    const f = runtimeFixture();
    const due = (from: number): RescuePlan => ({
      transactions: [
        {
          action: "advance-phase",
          addresses: ["program"],
          indices: [from],
          details: [{ from, to: from + 1 }],
          transaction: f.transaction(),
        },
      ],
      remaining: [],
    });
    vi.mocked(planAdvancePhase)
      .mockResolvedValueOnce(due(2))
      .mockResolvedValueOnce(due(3))
      .mockResolvedValueOnce(notDue);
    vi.mocked(sendRescueTransaction).mockResolvedValue({
      state: "confirmed",
      signature: "crank-signature",
    });
    expect(
      await runRescue(
        [
          ...f.baseArgs,
          "crank",
          "advance-phase",
          "--fee-payer",
          "payer.json",
          "--yes",
        ],
        f.deps,
      ),
    ).toBe(0);
    expect(sendRescueTransaction).toHaveBeenCalledTimes(2);
    expect(f.emit).toHaveBeenLastCalledWith({
      type: "remaining",
      items: [],
      sent: 2,
      previews: 0,
    });
  });
});

describe("rescue CLI Final Pull", () => {
  it("builds a permissionless SOL claim for a recipient distinct from the payer", async () => {
    const f = runtimeFixture();
    const owner = Keypair.generate().publicKey;
    vi.mocked(planClaimFinalSol).mockResolvedValue({
      transactions: [],
      remaining: [],
    });
    expect(
      await runRescue(
        [
          ...f.baseArgs,
          "claim-final-sol",
          "--fee-payer",
          "payer.json",
          "--wallet",
          owner.toBase58(),
        ],
        f.deps,
      ),
    ).toBe(0);
    expect(planClaimFinalSol).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: f.signer.publicKey,
        owner,
      }),
    );
    expect(f.deps.readText).toHaveBeenCalledOnce();
  });
  it("keeps token claims owner-signed and refreshes the claimed state", async () => {
    const f = runtimeFixture();
    vi.mocked(planClaimFinalTokens)
      .mockResolvedValueOnce({
        transactions: [
          {
            action: "claim-final-tokens",
            addresses: [f.signer.publicKey.toBase58()],
            transaction: f.transaction(),
          },
        ],
        remaining: [],
      })
      .mockResolvedValueOnce({ transactions: [], remaining: [] });
    vi.mocked(sendRescueTransaction).mockResolvedValue({
      state: "confirmed",
      signature: "final-tokens",
    });
    expect(
      await runRescue(
        [
          ...f.baseArgs,
          "claim-final-tokens",
          "--keypair",
          "owner.json",
          "--yes",
        ],
        f.deps,
      ),
    ).toBe(0);
    expect(planClaimFinalTokens).toHaveBeenCalledTimes(2);
    expect(sendRescueTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ publicKey: f.signer.publicKey }),
      }),
      expect.objectContaining({ action: "claim-final-tokens" }),
      f.block.lastValidBlockHeight,
    );
  });
  it("reports start preconditions without sending and starts from the new planner", async () => {
    const f = runtimeFixture();
    vi.mocked(planStartFinalPull).mockResolvedValue({
      transactions: [],
      remaining: [{ action: "start-final-pull", reason: "PullPending" }],
    });
    const args = [
      ...f.baseArgs,
      "crank",
      "start-final-pull",
      "--fee-payer",
      "payer.json",
      "--yes",
    ];
    expect(await runRescue(args, f.deps)).toBe(4);
    expect(sendRescueTransaction).not.toHaveBeenCalled();
    vi.mocked(planStartFinalPull)
      .mockResolvedValueOnce({
        transactions: [
          {
            action: "start-final-pull",
            addresses: ["machine"],
            transaction: f.transaction(),
          },
        ],
        remaining: [],
      })
      .mockResolvedValueOnce({ transactions: [], remaining: [] });
    vi.mocked(sendRescueTransaction).mockResolvedValue({
      state: "confirmed",
      signature: "final-start",
    });
    expect(await runRescue(args, f.deps)).toBe(0);
    expect(sendRescueTransaction).toHaveBeenCalledOnce();
  });
});
