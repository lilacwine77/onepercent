import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { EXTERNAL_IDS, PHASE } from "@onepercent/sdk";
import { WEB } from "@onepercent/config/web";
import { XrayResultSchema } from "@onepercent/eligibility";
import type { FeedViewProps } from "../experience/index";
import type { FeedWallet } from "../data/feed";
import { readFeedDisplay, readFeedWallet } from "../data/feed";
import { readWalletDeck, type ChainDeckEntry } from "../data/deck";
import { api } from "../data/api";
import { FeedReads } from "../data/feed-reads";
import { runFeed } from "../tx/feed/run";
import { priorityFee } from "../tx/engine/solana";
import { prepareTakeBack } from "../tx/take-back";
import xrayFixture from "../xray/__fixtures__/result.json";
import LiveFeed from "./LiveFeed";

const view = vi.hoisted(() => ({ current: null as FeedViewProps | null }));
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const owner = key(1);
const mints = [key(2), key(3)];
const session = {
  account: { address: owner.toBase58() },
  wallet: {},
  generation: 1,
  session: { snapshot: () => ({ generation: 1 }) },
};

vi.mock("../wallet/WalletProvider", () => ({ useWallet: () => session }));
vi.mock("../wallet/capabilities", () => ({
  capabilities: (_wallet: unknown, transactions: number) => ({
    batchSize: 1,
    approvals: transactions,
  }),
}));
vi.mock("../data/rpc", () => ({
  createRpc: () => ({
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100,
    }),
    getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
      addresses.map(() => null),
  }),
}));
vi.mock("../data/config", () => ({
  useConfig: () => ({ data: { cluster: "devnet" } }),
  useWebConfig: () => ({ data: null }),
}));
vi.mock("../data/flags", () => ({ useFlag: () => true }));
vi.mock("../data/feed-back", () => ({ useFeedBackEstimate: () => 0n }));
vi.mock("../data/feed", async (original) => {
  const actual = await original<typeof import("../data/feed")>();
  return {
    ...actual,
    readFeedWallet: vi.fn(),
    readFeedDisplay: vi.fn(),
  };
});
vi.mock("../data/deck", () => ({
  readWalletDeck: vi.fn(async () => ({ entries: [], slot: 1 })),
}));
vi.mock("../data/vault-deposits", () => ({
  readVaultDeposits: vi.fn(async () => []),
}));
vi.mock("../data/api", async (original) => ({
  ...(await original<typeof import("../data/api")>()),
  api: vi.fn(async () => {
    throw new Error("History offline");
  }),
}));
vi.mock("../tx/feed/plan", () => ({
  readProtocolLut: vi.fn(async () => undefined),
}));
vi.mock("../tx/feed/run", async (original) => ({
  ...(await original<typeof import("../tx/feed/run")>()),
  runFeed: vi.fn(),
  previewFeed: vi.fn(async (input: { selection: readonly string[] }) => ({
    bags: input.selection,
    transactions: input.selection.length,
    approvals: input.selection.length,
  })),
}));
vi.mock("../tx/engine/solana", () => ({
  priorityFee: vi.fn(async () => 0n),
}));
vi.mock("../tx/take-back", async (original) => ({
  ...(await original<typeof import("../tx/take-back")>()),
  prepareTakeBack: vi.fn(),
}));
vi.mock("../app/prefs", () => ({
  soundPref: {},
  motionPref: {},
  useStore: () => false,
}));
vi.mock("../app/OfflineBanner", () => ({ RescueLink: () => null }));
vi.mock("../experience/index", () => ({
  FeedShape: () => null,
  loadFeed: vi.fn(),
}));
vi.mock("./ExperienceSlot", () => ({
  ExperienceSlot: ({ props }: { props: FeedViewProps }) => {
    view.current = props;
    return null;
  },
}));
vi.mock("./Royalties", () => ({ Royalties: () => null }));

function snapshot(selected = mints): FeedWallet {
  return {
    core: {
      binder: { fresh_in_deck: 0 },
      binderLamports: 0n,
      machine: { phase: PHASE.stockUp, end_ts: 0n },
      config: {
        season_set: 1,
        stock_up_ts: 0n,
        admin_paused: 0,
        guardian_paused: 0,
      },
      blockTime: 1,
    },
    inventory: {
      bags: selected.map((mint) => ({
        mint,
        tokenProgram: EXTERNAL_IDS.splToken,
        amount: 10n,
        decimals: 0,
        feedable: true,
        accounts: [],
        sourceExists: true,
        vaultExists: true,
        ledger: {},
      })),
      emptyAccounts: [],
      slot: 1,
    },
    rent: {
      empty: 1n,
      deckEntry: 80n,
      binder: 100n,
      vaultSpl: 165n,
      vaultToken2022: 170n,
      mintLedger: 80n,
    },
  } as unknown as FeedWallet;
}

beforeEach(() => {
  vi.clearAllMocks();
  view.current = null;
  vi.mocked(readFeedDisplay).mockResolvedValue({
    quotedAt: Date.now(),
    xray: null,
    machine: null,
    me: null,
    values: [],
  });
});
afterEach(cleanup);

it("retries remaining bags from a fresh read after the post-send refresh failed", async () => {
  const remaining = snapshot([mints[1]!]);
  vi.mocked(readFeedWallet)
    .mockResolvedValueOnce(snapshot())
    .mockResolvedValueOnce(snapshot())
    .mockRejectedValueOnce(new Error("Inventory offline"))
    .mockResolvedValue(remaining);
  vi.mocked(runFeed)
    .mockRejectedValueOnce(new Error("Second approval rejected"))
    .mockResolvedValue({ fed: new Set(), confirmed: 0, total: 0 });
  render(<LiveFeed />);
  await waitFor(() => expect(view.current?.panel.rows).toHaveLength(2));
  act(() => view.current!.panel.onFeed({ feed: mints.map(String) }));
  await waitFor(() => expect(readFeedWallet).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(view.current?.panel.gate.open).toBe(false));

  act(() => view.current!.panel.onRetry());
  await waitFor(() => expect(runFeed).toHaveBeenCalledTimes(2));
  expect(vi.mocked(runFeed).mock.calls[1]![0].selection).toEqual([
    mints[1]!.toBase58(),
  ]);
});

it("does not silently drop a changed bag from a new Feed selection", async () => {
  vi.mocked(readFeedWallet)
    .mockResolvedValueOnce(snapshot())
    .mockResolvedValue(snapshot([mints[1]!]));
  render(<LiveFeed />);
  await waitFor(() => expect(view.current?.panel.rows).toHaveLength(2));
  act(() => view.current!.panel.onFeed({ feed: mints.map(String) }));
  await waitFor(() => expect(view.current?.panel.flow.phase).toBe("failed"));
  expect(runFeed).not.toHaveBeenCalled();

  // A refused preflight releases the operation, so the corrected selection works.
  vi.mocked(runFeed).mockResolvedValue({
    fed: new Set(),
    confirmed: 0,
    total: 0,
  });
  act(() => view.current!.panel.onFeed({ feed: [mints[1]!.toBase58()] }));
  await waitFor(() => expect(runFeed).toHaveBeenCalledTimes(1));
});

it("passes a negative personal snapshot to the Feed flow for the final one-hop check", async () => {
  vi.mocked(readFeedWallet).mockResolvedValue(snapshot());
  vi.mocked(readFeedDisplay).mockResolvedValue({
    quotedAt: Date.now(),
    xray: XrayResultSchema.parse({
      ...xrayFixture,
      address: owner.toBase58(),
      bags: [
        {
          mint: mints[0]!.toBase58(),
          symbol: "HOP",
          name: "Hop",
          logoUrl: null,
          amountUi: "10",
          decimals: 0,
          tokenProgram: "spl",
          buckets: ["not_feedable_season"],
          reasonCode: "snapshot_not_held",
        },
      ],
    }),
    machine: null,
    me: null,
    values: [],
  });
  vi.mocked(runFeed).mockResolvedValue({
    fed: new Set(),
    confirmed: 0,
    total: 0,
  });
  render(<LiveFeed />);
  await waitFor(() =>
    expect(view.current?.panel.rows[0]).toMatchObject({
      coin: { ticker: "HOP" },
      feed: true,
      canFeed: { open: true, reason: null },
      note: { key: "feed.row.checkAtFeed" },
    }),
  );
  expect(readWalletDeck).toHaveBeenCalledWith(
    expect.anything(),
    owner,
    expect.objectContaining({ loadHints: expect.any(Function) }),
  );
  act(() => view.current!.panel.onFeed({ feed: [mints[0]!.toBase58()] }));
  await waitFor(() => expect(runFeed).toHaveBeenCalledTimes(1));
  expect(vi.mocked(runFeed).mock.calls[0]![0].selection).toEqual([
    mints[0]!.toBase58(),
  ]);
});

it("Find my cards requests a full scan after the API lists only one exit", async () => {
  vi.mocked(readFeedWallet).mockResolvedValue(snapshot());
  const entries: ChainDeckEntry[] = mints.map((mint, deckIndex) => ({
    depositor: owner,
    mint,
    amount: 10n,
    deposit: 80,
    flags: 1,
    _pad: new Uint8Array(3),
    deckIndex,
    id: `entry-${deckIndex}`,
  }));
  const partial = {
    asOfSlot: 1,
    deck: [
      {
        asOfSlot: 1,
        deckIndex: 0,
        mint: mints[0]!.toBase58(),
        amount: "10",
        deposit: "80",
        fresh: true,
        refed: false,
      },
    ],
  };
  vi.mocked(api).mockResolvedValueOnce(partial);
  vi.mocked(readWalletDeck)
    .mockImplementationOnce(async (_rpc, _owner, options) => {
      expect(await options?.loadHints?.()).toEqual(partial);
      return {
        entries: entries.slice(0, 1),
        slot: 1,
        header: null,
        lamports: 0n,
      };
    })
    .mockResolvedValueOnce({ entries, slot: 2, header: null, lamports: 0n });

  render(<LiveFeed />);
  await waitFor(() => expect(view.current?.machine.entries).toHaveLength(1));
  expect(api).toHaveBeenCalledWith(
    `/api/me/${owner.toBase58()}`,
    expect.anything(),
    { signal: expect.any(AbortSignal) },
  );

  fireEvent.click(screen.getByRole("button", { name: "Find my cards" }));

  await waitFor(() =>
    expect(readWalletDeck).toHaveBeenLastCalledWith(
      expect.anything(),
      owner,
      expect.objectContaining({ forceScan: true }),
    ),
  );
  await waitFor(() => expect(view.current?.machine.entries).toHaveLength(2));
  expect(runFeed).not.toHaveBeenCalled();
});

it("cancels the pending refresh before take-back priority fees and preparation", async () => {
  const entry: ChainDeckEntry = {
    depositor: owner,
    mint: mints[0]!,
    amount: 10n,
    deposit: 80,
    flags: 1,
    _pad: new Uint8Array(3),
    deckIndex: 0,
    id: "owned-exit",
  };
  vi.mocked(readWalletDeck).mockResolvedValueOnce({
    entries: [entry],
    slot: 1,
    header: null,
    lamports: 0n,
  });
  const events: string[] = [];
  let activeSignal: AbortSignal | undefined;
  const originalPoll = FeedReads.prototype.poll;
  const poll = vi
    .spyOn(FeedReads.prototype, "poll")
    .mockImplementation(function (this: FeedReads, run, force) {
      return originalPoll.call(
        this,
        (signal) => {
          activeSignal = signal;
          return run(signal);
        },
        force,
      );
    });
  vi.mocked(readFeedWallet).mockImplementationOnce(
    () =>
      new Promise<FeedWallet>((_resolve, reject) => {
        expect(activeSignal).toBeDefined();
        activeSignal!.addEventListener(
          "abort",
          () => {
            events.push("refresh-cancelled");
            reject(new DOMException("Refresh cancelled", "AbortError"));
          },
          { once: true },
        );
      }),
  );
  vi.mocked(priorityFee).mockImplementationOnce(async () => {
    expect(activeSignal?.aborted).toBe(true);
    events.push("priority-fee");
    return 0n;
  });
  vi.mocked(prepareTakeBack).mockImplementationOnce(async () => {
    expect(activeSignal?.aborted).toBe(true);
    events.push("prepare-take-back");
    throw new Error("Stop after preparation");
  });
  try {
    render(<LiveFeed />);
    await waitFor(() => expect(readFeedWallet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.current?.machine.entries).toHaveLength(1));
    expect(activeSignal?.aborted).toBe(false);

    act(() => view.current!.machine.onTakeBack([entry.id]));

    await waitFor(() => expect(prepareTakeBack).toHaveBeenCalledTimes(1));
    expect(events).toEqual([
      "refresh-cancelled",
      "priority-fee",
      "prepare-take-back",
    ]);
    expect(prepareTakeBack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entries: [entry], wallet: owner }),
    );
    expect(readFeedDisplay).not.toHaveBeenCalled();
    expect(runFeed).not.toHaveBeenCalled();
  } finally {
    poll.mockRestore();
  }
});

it("backs off background polling when the API returns no wallet mirror", async () => {
  vi.useFakeTimers();
  vi.mocked(readFeedWallet).mockResolvedValue(snapshot());
  try {
    render(<LiveFeed />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(readFeedWallet).toHaveBeenCalledTimes(1);
    await expect(
      vi.mocked(readFeedDisplay).mock.results[0]!.value,
    ).resolves.toMatchObject({ me: null });

    await act(async () => vi.advanceTimersByTimeAsync(WEB.machinePollMs));
    expect(readFeedWallet).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(WEB.machinePollMs));
    expect(readFeedWallet).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(WEB.machinePollMs * 3));
    expect(readFeedWallet).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(WEB.machinePollMs));
    expect(readFeedWallet).toHaveBeenCalledTimes(3);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
