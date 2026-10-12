// @vitest-environment node
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SERVICES } from "@onepercent/config";
import { WEB } from "@onepercent/config/web";
import { MintLayout } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  DECK_FLAGS,
  EXTERNAL_IDS,
  deckPda,
  encodeDeck,
  encodeMintLedger,
  ledgerPda,
  vaultAta,
} from "@onepercent/sdk";
import { webDeployment } from "./deployment";
import { FeedReads, readMintDecimals } from "./feed-reads";
import { createRpc } from "./rpc";
import { readWalletDeck } from "./deck";
import { readVaultDeposits } from "./vault-deposits";
import { readFeedDisplay, type FeedWallet } from "./feed";
import { prepareTakeBack } from "../tx/take-back";
import {
  fixtureRpcResult,
  type FixtureAccount,
} from "../../e2e/helpers/w3-rpc";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function fixture() {
  const program = webDeployment().programId;
  const owner = key(201);
  const mints = Array.from({ length: 60 }, (_, index) => key(index + 1));
  const entries = mints.map((mint) => ({
    mint,
    depositor: owner,
    amount: 100n,
    deposit: 0,
    flags: DECK_FLAGS.refed,
    _pad: new Uint8Array(3),
  }));
  const accounts = new Map<string, FixtureAccount | null>();
  const put = (address: PublicKey, data: Uint8Array, tokenProgram = program) =>
    accounts.set(address.toBase58(), {
      owner: tokenProgram.toBase58(),
      data: [Buffer.from(data).toString("base64"), "base64"],
      executable: false,
      lamports: 50000000,
      rentEpoch: 0,
    });
  put(owner, Buffer.alloc(0), PublicKey.default);
  put(
    deckPda(program)[0],
    encodeDeck({ version: 1, bump: deckPda(program)[1], entries }),
  );
  for (const mint of mints) {
    const data = Buffer.alloc(MintLayout.span);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: 1000n,
        decimals: 6,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    put(mint, data, EXTERNAL_IDS.splToken);
    put(ledgerPda(program, mint)[0], encodeMintLedger({ mint, payer: owner }));
    put(
      vaultAta(program, mint, EXTERNAL_IDS.splToken),
      Buffer.alloc(165),
      EXTERNAL_IDS.splToken,
    );
  }
  return { owner, mints, accounts };
}

it("keeps a real take-back available after 45 seconds of offline polling with 60 REFED mints", async () => {
  vi.useFakeTimers();
  const { owner, mints, accounts } = fixture();
  const calls: { at: number; method: string; width: number }[] = [];
  let limited = 0;
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const { method, params, id } = JSON.parse(String(options?.body));
    calls.push({
      at: Date.now(),
      method,
      width: method === "getMultipleAccounts" ? params[0].length : 1,
    });
    if (
      calls.filter((call) => Date.now() - call.at < 60000).length >
      SERVICES.api.rpcPerMinutePerIp
    ) {
      limited++;
      return new Response("rate limit", { status: 429 });
    }
    const known = new Map(accounts);
    if (method === "getAccountInfo" && !known.has(params[0]))
      known.set(params[0], null);
    let result = fixtureRpcResult(method, params, known);
    if (method === "getAccountInfo" && params[1]?.dataSlice) {
      const account = known.get(params[0]);
      if (account) {
        const { offset, length } = params[1].dataSlice;
        result = {
          context: { slot: 100 },
          value: {
            ...account,
            data: [
              Buffer.from(account.data[0]!, "base64")
                .subarray(offset, offset + length)
                .toString("base64"),
              "base64",
            ],
          },
        };
      }
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
  const reads = new FeedReads();
  const decimals: Record<string, number> = {};
  const offline = vi.fn(async () => {
    reads.degraded();
    throw new Error("API unavailable");
  });
  let selected: Awaited<ReturnType<typeof readWalletDeck>>["entries"] = [];
  const poll = () =>
    reads.poll(async (signal) => {
      const deck = await readWalletDeck(reads.rpc, owner, {
        loadHints: offline,
      });
      if (signal.aborted) return;
      selected = deck.entries;
      await readMintDecimals(reads.rpc, mints, decimals);
      await readVaultDeposits(reads.rpc, owner, mints, null, []);
    });
  const active = [poll()];
  const timer = setInterval(() => {
    active.push(poll());
  }, WEB.machinePollMs);
  await vi.advanceTimersByTimeAsync(45000);
  clearInterval(timer);
  reads.beginAction();
  await Promise.allSettled(active);
  expect(selected).toHaveLength(60);
  expect(Object.keys(decimals)).toHaveLength(60);
  expect(offline.mock.calls.length).toBeLessThan(9);
  expect(
    calls.filter((call) => call.method === "getAccountInfo").length,
  ).toBeLessThan(10);
  const before = calls.length;
  const prepared = prepareTakeBack(createRpc(), {
    wallet: owner,
    entries: selected.slice(0, 1),
    priorityFeeMicroLamports: 0n,
    blockhash: PublicKey.default.toBase58(),
    loadDeckHints: async () => {
      throw new Error("API unavailable");
    },
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect((await prepared).batches).toHaveLength(1);
  expect(calls.length).toBeGreaterThan(before);
  expect(calls.length).toBeLessThan(SERVICES.api.rpcPerMinutePerIp / 2);
  expect(calls.every((call) => call.width <= 100)).toBe(true);
  expect(limited).toBe(0);
});

it("preempts the in-flight background request and its queue before an exit read", async () => {
  vi.useFakeTimers();
  const started: string[] = [];
  let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const { method, id } = JSON.parse(String(options?.body));
    started.push(method);
    if (method === "getSlot") {
      signal = options?.signal as AbortSignal;
      return new Promise(() => {});
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: fixtureRpcResult(method, [], new Map()),
      }),
    );
  });
  const reads = new FeedReads();
  const outcomes: unknown[] = [];
  const poll = reads.poll(async () => {
    outcomes.push(
      ...(await Promise.allSettled([
        reads.rpc.getSlot(),
        reads.rpc.getBlockTime(1),
        reads.rpc.getBlockTime(2),
      ])),
    );
    await expect(reads.rpc.getBlockTime(3)).rejects.toThrow(/cancelled/);
  });
  await vi.advanceTimersByTimeAsync(0);
  reads.beginAction();
  const exit = createRpc().getLatestBlockhash();
  await expect(exit).resolves.toHaveProperty("lastValidBlockHeight", 1000);
  await poll;
  expect(signal?.aborted).toBe(true);
  expect(outcomes).toHaveLength(3);
  expect(started).toEqual(["getSlot", "getLatestBlockhash"]);
  await reads.poll(async () => {
    throw new Error("Polling during exit");
  }, true);
  reads.endAction();
  await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
});

it("caps background traffic even when a caller forces repeated polls", async () => {
  vi.useFakeTimers();
  let calls = 0;
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    calls++;
    const { id } = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: 100 }));
  });
  const reads = new FeedReads();
  const poll = reads.poll(async () => {
    await Promise.allSettled(
      Array.from({ length: 600 }, () => reads.rpc.getSlot()),
    );
  }, true);
  await vi.advanceTimersByTimeAsync(59999);
  reads.beginAction();
  await poll;
  expect(calls).toBeLessThanOrEqual(SERVICES.api.rpcPerMinutePerIp / 4);
});

it("retires queued siblings after a poll catches an early parallel failure", async () => {
  vi.useFakeTimers();
  const started: string[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const { method, id } = JSON.parse(String(options?.body));
    started.push(method);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...(method === "getSlot"
          ? { error: { code: -32000, message: "RPC unavailable" } }
          : { result: 100 }),
      }),
    );
  });
  const reads = new FeedReads();
  const poll = reads.poll(async () => {
    try {
      await Promise.all([
        reads.rpc.getSlot(),
        reads.rpc.getBlockTime(1),
        reads.rpc.getBlockTime(2),
      ]);
    } catch {
      // The component retains its previous snapshot when an RPC fails.
    }
  });
  await vi.advanceTimersByTimeAsync(0);
  await poll;
  reads.beginAction();
  await expect(createRpc().getBlockTime(3)).resolves.toBe(100);
  await vi.advanceTimersByTimeAsync(WEB.machinePollMs);
  // One sibling may start before the rejection reaches Promise.all.
  // The other must stay cancelled; the final getBlockTime is the exit read.
  expect(
    started.filter((method) => method === "getBlockTime").length,
  ).toBeLessThanOrEqual(2);
});

it("cancels unavailable API reads and runs the post-exit refresh without waiting for backoff", async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    signals.push(options!.signal as AbortSignal);
    return new Promise(() => {});
  });
  const reads = new FeedReads();
  const snapshot = { inventory: { bags: [] } } as unknown as FeedWallet;
  const previous = reads.poll(async (signal) => {
    await expect(
      readFeedDisplay(key(201), snapshot, signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(signals).toHaveLength(3);
  reads.beginAction();
  reads.endAction();
  const refreshed = vi.fn(async () => {});
  const fresh = reads.poll(refreshed, true);
  await Promise.all([previous, fresh]);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(refreshed).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
