// @vitest-environment node
import { webDeployment } from "../../data/deployment";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  PublicKey,
  type Connection,
} from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import {
  binderPda,
  configPda,
  decodeBinder,
  decodeConfig,
  decodeMachine,
  encodeBinder,
  encodeConfig,
  encodeMachine,
  EXTERNAL_IDS,
  machinePda,
  PHASE,
  userAta,
  type BuiltTransaction,
} from "@onepercent/sdk";
import type { SupportedWallet } from "../../wallet/capabilities";
import type { ChainBag, ChainTokenAccount } from "../../data/feed-chain";
import { readFeedWallet, type FeedWallet } from "../../data/feed";
import { executePlan } from "../engine/engine";
import { resolvePending } from "../engine/pending";
import { measuredBudget, solanaPort } from "../engine/solana";
import type { EnginePort, PendingItem, PlanItem } from "../engine/progress";
import { requestAttest, validateAttest, type AttestedChunk } from "./attest";
import { FeedInterrupted, runFeed, type FeedRunInput } from "./run";

const PROGRAM_ID = webDeployment().programId;
vi.mock("../../data/feed", () => ({ readFeedWallet: vi.fn() }));
vi.mock("../engine/engine", () => ({ executePlan: vi.fn() }));
vi.mock("../engine/pending", () => ({ resolvePending: vi.fn() }));
vi.mock("../engine/solana", () => ({
  measuredBudget: vi.fn(),
  solanaPort: vi.fn(),
}));
vi.mock("./attest", () => ({
  requestAttest: vi.fn(),
  validateAttest: vi.fn(),
}));
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const blockhash = { blockhash: key(99).toBase58(), lastValidBlockHeight: 100 };
let walletNumber = 150;
function account(
  owner: PublicKey,
  mint: PublicKey,
  address: PublicKey,
  amount: bigint,
): ChainTokenAccount {
  return {
    address,
    mint,
    owner,
    amount,
    tokenProgram: EXTERNAL_IDS.splToken,
    lamports: 1000000n,
    closable: true,
    closeAuthority: null,
    isInitialized: true,
    isFrozen: false,
    isNative: false,
    rentExemptReserve: null,
    delegate: null,
    delegatedAmount: 0n,
    tlvData: Buffer.alloc(0),
  };
}
function setup(count: number) {
  const owner = key(walletNumber++);
  const bags = Array.from({ length: count }, (_, n): ChainBag => {
    const mint = key(n + 2),
      source = userAta(owner, mint, EXTERNAL_IDS.splToken);
    return {
      mint,
      source,
      canonicalAta: source,
      sourceExists: true,
      amount: 100n,
      decimals: 6,
      tokenProgram: EXTERNAL_IDS.splToken,
      feedable: true,
      reasonCode: null,
      accounts: [account(owner, mint, source, 100n)],
      vaultExists: false,
      vaultLamports: 0n,
      ledger: null,
      ledgerLamports: 0n,
    };
  });
  const snapshot: FeedWallet = {
    core: {
      config: decodeConfig(
        encodeConfig({
          version: 1,
          bump: configPda(PROGRAM_ID)[1],
          intake_signer: key(98),
          season_set: 1,
        }),
      ),
      machine: decodeMachine(
        encodeMachine({
          version: 1,
          bump: machinePda(PROGRAM_ID)[1],
          phase: PHASE.stockUp,
        }),
      ),
      binder: null,
      binderLamports: 0n,
      slot: 20,
      blockTime: 1000,
    },
    inventory: { slot: 20, bags, emptyAccounts: [] },
    rent: {
      deckEntry: 10n,
      binder: 20n,
      mintLedger: 30n,
      vaultSpl: 40n,
      vaultToken2022: 50n,
    },
  };
  const rpc = {
    getLatestBlockhash: async () => blockhash,
  } as unknown as Connection;
  const progress = vi.fn();
  const beforeAttest = vi.fn(async () => undefined);
  const input: FeedRunInput = {
    rpc,
    owner,
    wallet: { features: { "solana:signTransaction": {} } } as SupportedWallet,
    account: {} as WalletAccount,
    chain: "solana:devnet",
    selection: bags.map((bag) => bag.mint.toBase58()),
    price: 1n,
    current: () => true,
    enabled: () => true,
    progress,
    refused: vi.fn(),
    beforeAttest,
  };
  let currentAttestations: AttestedChunk[] = [];
  let sequence = 0;
  const executions: {
    kind: string;
    items: readonly PlanItem<BuiltTransaction>[];
  }[] = [];
  vi.mocked(readFeedWallet).mockImplementation(async () => snapshot);
  vi.mocked(requestAttest).mockImplementation(async (_wallet, chunks) => {
    currentAttestations = chunks.map((bags) => ({
      nonce: sequence++,
      expiry: 1100n,
      signature: new Uint8Array(64),
      bags: [...bags],
    }));
    return {
      wallet: owner.toBase58(),
      asOfSlot: 20,
      signer: key(98).toBase58(),
      snapshotSlot: 0,
      attestations: [],
      refused: [],
    };
  });
  vi.mocked(validateAttest).mockImplementation(() => currentAttestations);
  vi.mocked(solanaPort).mockImplementation(
    (port) => port as unknown as EnginePort<BuiltTransaction>,
  );
  vi.mocked(executePlan).mockImplementation(async (items, port, options) => {
    const input = port as unknown as Parameters<typeof solanaPort>[0];
    await input.beforePrompt?.([]);
    executions.push({
      kind: input.kind,
      items: items as readonly PlanItem<BuiltTransaction>[],
    });
    if (input.kind === "feed") {
      const mints = new Set(
        currentAttestations.flatMap((att) =>
          att.bags.map((bag) => bag.mint.toBase58()),
        ),
      );
      snapshot.inventory.bags = snapshot.inventory.bags.filter(
        (bag) => !mints.has(bag.mint.toBase58()),
      );
      snapshot.core!.binder = decodeBinder(
        encodeBinder({
          owner,
          bump: binderPda(PROGRAM_ID, owner)[1],
          feed_nonce_base: sequence,
        }),
      );
    }
    if (input.kind === "merge") {
      for (const bag of snapshot.inventory.bags) {
        bag.accounts = [account(owner, bag.mint, bag.source, bag.amount)];
        bag.sourceExists = true;
      }
    }
    options.progress({
      phase: "done",
      total: items.length,
      confirmed: items.length,
    });
    return {
      phase: "done",
      copyKey: null,
      landed: new Set(items.map((item) => item.id)),
      unknown: new Set<string>(),
      retry: [],
      pending: [],
    };
  });
  return { input, snapshot, executions, progress, beforeAttest };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolvePending).mockImplementation(async () => ({
    pending: [],
    landed: new Set(),
    retry: new Set(),
  }));
  vi.mocked(measuredBudget).mockResolvedValue([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1n }),
  ]);
});
describe("live Feed orchestration", () => {
  it("feeds all 25 bags in refreshed signer batches with one consent check per batch", async () => {
    const state = setup(25);
    const result = await runFeed(state.input);
    expect(result.fed.size).toBe(25);
    expect(
      vi.mocked(requestAttest).mock.calls.map((call) => call[1].length),
    ).toEqual([8, 8, 8, 1]);
    expect(state.beforeAttest).toHaveBeenCalledTimes(4);
    expect(state.executions.map((batch) => batch.items.length)).toEqual([
      8, 8, 8, 1,
    ]);
    expect(
      state.progress.mock.calls.filter(([flow]) => flow.phase === "done"),
    ).toHaveLength(1);
  });
  it("executes all empty-close transactions in one approval-batched engine call", async () => {
    const state = setup(0);
    state.snapshot.inventory.emptyAccounts = Array.from(
      { length: 40 },
      (_, n) => account(state.input.owner, key(3), key(n + 4), 0n),
    );
    state.input.enabled = () => false;
    await runFeed(state.input);
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0]!.kind).toBe("close");
    expect(state.executions[0]!.items.length).toBeGreaterThan(1);
    expect(state.progress.mock.calls.at(-1)?.[0].approvals).toBe(1);
  });
  it("reports earlier successful batches when a later approval is rejected", async () => {
    const state = setup(9);
    const first = vi.mocked(executePlan).getMockImplementation()!;
    vi.mocked(executePlan).mockImplementationOnce(first).mockResolvedValueOnce({
      phase: "rejected",
      copyKey: "errors.walletNo",
      landed: new Set(),
      unknown: new Set(),
      retry: [],
      pending: [],
    });
    let caught: unknown;
    try {
      await runFeed(state.input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeedInterrupted);
    const interruption = caught as FeedInterrupted;
    expect(interruption.flow).toMatchObject({
      phase: "partial",
      confirmed: 8,
      total: 9,
      message: {
        key: "feed.state.partial.one",
        vars: { ok: "8", t: "9", n: "1" },
      },
    });
  });
  it("keeps refused bags out of the success animation", async () => {
    const state = setup(1);
    const mint = state.input.selection[0]!;
    vi.mocked(requestAttest).mockResolvedValueOnce({
      wallet: state.input.owner.toBase58(),
      asOfSlot: 20,
      signer: key(98).toBase58(),
      snapshotSlot: 0,
      attestations: [],
      refused: [{ mint, reason: "snapshot_not_held", date: null }],
    });
    vi.mocked(validateAttest).mockReturnValueOnce([]);
    const result = await runFeed(state.input);
    expect(result.fed.size).toBe(0);
    expect(state.progress.mock.calls.at(-1)?.[0].phase).toBe("idle");
    expect(
      state.progress.mock.calls.some(([flow]) => flow.phase === "done"),
    ).toBe(false);
  });
  it("lands merges before requesting whole-bag attestations", async () => {
    const state = setup(1);
    const bag = state.snapshot.inventory.bags[0]!;
    bag.accounts = [
      account(state.input.owner, bag.mint, key(70), 20n),
      account(state.input.owner, bag.mint, key(71), 80n),
    ];
    bag.sourceExists = false;
    await runFeed(state.input);
    expect(state.executions.map((batch) => batch.kind)).toEqual([
      "merge",
      "feed",
    ]);
    expect(state.progress.mock.calls.at(-1)?.[0].message.vars.rent).toBe(
      "0.002",
    );
  });
  it("blocks a second attestation while a previous submission remains ambiguous", async () => {
    const state = setup(1);
    let pending: PendingItem<BuiltTransaction>[] = [];
    vi.mocked(executePlan).mockImplementationOnce(async (items) => {
      pending = items.map((item) => ({
        item: item as PlanItem<BuiltTransaction>,
        validity: blockhash,
      }));
      return {
        phase: "failed",
        copyKey: "errors.generic",
        landed: new Set(),
        unknown: new Set(items.map((item) => item.id)),
        retry: [],
        pending,
      };
    });
    await expect(runFeed(state.input)).rejects.toBeInstanceOf(FeedInterrupted);
    vi.mocked(resolvePending).mockImplementationOnce(async () => ({
      pending,
      landed: new Set(),
      retry: new Set(),
    }));
    await expect(runFeed(state.input)).rejects.toBeInstanceOf(FeedInterrupted);
    expect(requestAttest).toHaveBeenCalledTimes(1);
    state.snapshot.inventory.bags = [];
    vi.mocked(resolvePending).mockImplementationOnce(async () => ({
      pending: [],
      landed: new Set(pending.map((entry) => entry.item.id)),
      retry: new Set(),
    }));
    await runFeed(state.input);
    expect(requestAttest).toHaveBeenCalledTimes(1);
  });
});
