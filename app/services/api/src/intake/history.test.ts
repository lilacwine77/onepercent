import {
  JsonRpcClient,
  RpcError,
  RpcUnavailable,
} from "@onepercent/service-kit";
import { describe, expect, it, vi } from "vitest";
import { EvidenceUnavailableError } from "@onepercent/service-kit/intake";
import {
  createIntakeHistoryReader,
  type IntakeHistoryCacheOptions,
} from "./history.js";

const wallet = "wallet";
const mint = "mint";
const blockTime = 1_791_000_000;
function transaction(
  signature: string,
  slot: number,
  pre = "0",
  post = "10",
  account = "account-a",
) {
  return {
    slot,
    blockTime,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [
          { pubkey: wallet, signer: true },
          { pubkey: account, signer: false },
        ],
        instructions: [],
      },
    },
    meta: {
      err: null as unknown,
      fee: 5,
      preBalances: [10_000, 0],
      postBalances: [9_895, 0],
      preTokenBalances:
        pre === "0"
          ? []
          : [
              {
                accountIndex: 1,
                owner: wallet,
                mint,
                uiTokenAmount: { amount: pre },
              },
            ],
      postTokenBalances:
        post === "0"
          ? []
          : [
              {
                accountIndex: 1,
                owner: wallet,
                mint,
                uiTokenAmount: { amount: post },
              },
            ],
      innerInstructions: [],
    },
  };
}

interface RequestRecord {
  id: number;
  method: string;
  params: unknown[];
}
const tokenTransferCommitmentError = {
  error: {
    code: -32602,
    message:
      "Invalid params: tokenTransfer filter requires finalized commitment",
  },
};
function fixture(
  pages: unknown[],
  blocks: Record<number, unknown> = {},
  options?: IntakeHistoryCacheOptions,
  finalizedSlot: unknown = 1_000,
) {
  const calls: RequestRecord[] = [];
  const allCalls: RequestRecord[] = [];
  let pageIndex = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const request = JSON.parse(String(options?.body)) as RequestRecord;
    allCalls.push(request);
    if (request.method !== "getSlot") calls.push(request);
    const config = request.params[1] as
      | { commitment?: string; filters?: { tokenTransfer?: unknown } }
      | undefined;
    // Real devnet rejection: a confirmed request cannot use tokenTransfer.
    if (
      request.method === "getTransactionsForAddress" &&
      config?.filters?.tokenTransfer &&
      config.commitment !== "finalized"
    )
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          ...tokenTransferCommitmentError,
        }),
      );
    const result =
      request.method === "getSlot"
        ? finalizedSlot
        : request.method === "getTransactionsForAddress"
          ? pages[pageIndex++]
          : blocks[request.params[0] as number];
    if (result instanceof Error) throw result;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        ...(result && typeof result === "object" && "error" in result
          ? result
          : { result }),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });
  const rpc = new JsonRpcClient({
    url: "https://history.invalid",
    timeoutMs: 10_000,
    failureThreshold: 5,
    recoverMs: 30_000,
    fetch: fetcher,
  });
  return {
    read: createIntakeHistoryReader(rpc, {}, options),
    calls,
    allCalls,
    fetcher,
  };
}

describe("complete Helius intake history provider", () => {
  it.each([false, true])(
    "includes a first purchase after finality and exhausts its confirmed pages (cache %s)",
    async (cached) => {
      const unrelated = transaction(
        "other-mint",
        28,
        "0",
        "7",
        "other-account",
      );
      unrelated.meta.postTokenBalances[0]!.mint = "other-mint";
      const f = fixture(
        [
          { data: [], paginationToken: null },
          ...(cached ? [{ data: [], paginationToken: null }] : []),
          {
            data: [transaction("recent-buy", 27)],
            paginationToken: "recent-next",
          },
          {
            data: [unrelated, transaction("recent-sale", 29, "10", "5")],
            paginationToken: null,
          },
        ],
        {},
        cached ? { evidenceCacheSeconds: 86_400 } : undefined,
        25,
      );
      const history = await f.read(wallet, mint, 20, 30);
      expect(history.balanceAtS).toBe(0n);
      expect(history.first).toMatchObject({
        signature: "recent-buy",
        slot: 27,
      });
      expect(f.allCalls[0]).toMatchObject({
        method: "getSlot",
        params: [{ commitment: "finalized" }],
      });
      expect(f.calls[0]!.params[1]).toMatchObject({
        commitment: "finalized",
        minContextSlot: 25,
        filters: { slot: { lte: cached ? 20 : 25 }, tokenTransfer: { mint } },
      });
      for (const call of f.calls.slice(-2)) {
        expect(call.params[1]).toMatchObject({
          commitment: "confirmed",
          minContextSlot: 30,
          filters: {
            slot: { gt: 25, lte: 30 },
            tokenAccounts: "balanceChanged",
          },
        });
        expect(call.params[1]).not.toHaveProperty("filters.tokenTransfer");
      }
      expect(f.calls.at(-1)!.params[1]).toHaveProperty(
        "paginationToken",
        "recent-next",
      );
    },
  );

  it("uses confirmed canonical ordering for same-slot rows in the recent tail", async () => {
    const f = fixture(
      [
        { data: [], paginationToken: null },
        {
          data: [
            transaction("second", 27, "10", "20"),
            transaction("first", 27),
          ],
          paginationToken: null,
        },
      ],
      { 27: { signatures: ["first", "second"] } },
      undefined,
      25,
    );
    expect((await f.read(wallet, mint, 20, 30)).first?.signature).toBe("first");
    expect(f.calls.at(-1)).toMatchObject({
      method: "getBlock",
      params: [27, { commitment: "confirmed" }],
    });
  });

  it("refuses a snapshot that is not finalized before reading any history", async () => {
    const f = fixture([], {}, undefined, 19);
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
    expect(f.calls).toHaveLength(0);
    expect(f.allCalls).toHaveLength(1);
  });

  it("propagates the real tokenTransfer RPC rejection without a fallback or caching it", async () => {
    const f = fixture(
      [
        tokenTransferCommitmentError,
        { data: [transaction("first", 10)], paginationToken: null },
        { data: [], paginationToken: null },
      ],
      {},
      { evidenceCacheSeconds: 86_400 },
    );
    const error = await f
      .read(wallet, mint, 20, 30)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: -32602, message: "rpc_error:-32602" });
    expect(f.calls).toHaveLength(1);
    expect((await f.read(wallet, mint, 20, 30)).first?.signature).toBe("first");
    expect(f.calls).toHaveLength(3);
    expect(f.calls[1]!.params[1]).toHaveProperty("filters.slot.lte", 20);
  });

  it("never substitutes a cached prefix for an unavailable confirmed tail", async () => {
    const f = fixture(
      [
        { data: [], paginationToken: null },
        { data: [], paginationToken: null },
        new Error("recent history unavailable"),
        { data: [], paginationToken: null },
        { data: [transaction("recent-buy", 27)], paginationToken: null },
      ],
      {},
      { evidenceCacheSeconds: 86_400 },
      25,
    );
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      RpcUnavailable,
    );
    expect((await f.read(wallet, mint, 20, 30)).first?.signature).toBe(
      "recent-buy",
    );
    expect(f.calls).toHaveLength(5);
    expect(f.calls[3]!.params[1]).toHaveProperty("filters.slot.gt", 20);
    expect(f.calls[4]!.params[1]).toHaveProperty("filters.slot.gt", 25);
  });

  it("rejects confirmed rows outside the strict finality boundary", async () => {
    const f = fixture(
      [
        { data: [], paginationToken: null },
        { data: [transaction("before-tail", 25)], paginationToken: null },
      ],
      {},
      undefined,
      25,
    );
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
  });

  it("caches only complete snapshot evidence and rereads the whole live tail", async () => {
    const f = fixture(
      [
        {
          data: [
            transaction("first", 10),
            transaction("split", 15, "0", "20", "account-b"),
          ],
          paginationToken: null,
        },
        { data: [transaction("sale", 30, "10", "5")], paginationToken: null },
        {
          data: [
            transaction("sale", 30, "10", "5"),
            transaction("close-split", 40, "20", "0", "account-b"),
          ],
          paginationToken: null,
        },
      ],
      {},
      { evidenceCacheSeconds: 86_400 },
    );
    expect((await f.read(wallet, mint, 20, 30)).balanceAtS).toBe(30n);
    expect((await f.read(wallet, mint, 20, 40)).balanceAtS).toBe(30n);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0]!.params[1]).toMatchObject({
      filters: { slot: { lte: 20 } },
    });
    expect(f.calls[1]!.params[1]).toMatchObject({
      filters: { slot: { gt: 20, lte: 30 } },
    });
    expect(f.calls[2]!.params[1]).toMatchObject({
      filters: { slot: { gt: 20, lte: 40 } },
    });
  });

  it("expires snapshot evidence at the configured boundary", async () => {
    let clock = 0;
    const prefix = { data: [transaction("first", 10)], paginationToken: null };
    const tail = { data: [], paginationToken: null };
    const f = fixture(
      [prefix, tail, tail, prefix, tail],
      {},
      { evidenceCacheSeconds: 1, now: () => clock },
    );
    await f.read(wallet, mint, 20, 30);
    clock = 999;
    await f.read(wallet, mint, 20, 30);
    expect(f.calls).toHaveLength(3);
    clock = 1000;
    await f.read(wallet, mint, 20, 30);
    expect(f.calls).toHaveLength(5);
    expect(f.calls[3]!.params[1]).toMatchObject({
      filters: { slot: { lte: 20 } },
    });
  });

  it("keys cached evidence by the snapshot slot", async () => {
    const prefix = { data: [transaction("first", 10)], paginationToken: null };
    const tail = { data: [], paginationToken: null };
    const f = fixture(
      [prefix, tail, prefix, tail],
      {},
      { evidenceCacheSeconds: 86_400 },
    );
    await f.read(wallet, mint, 20, 30);
    await f.read(wallet, mint, 21, 30);
    expect(f.calls).toHaveLength(4);
    expect(f.calls[2]!.params[1]).toMatchObject({
      filters: { slot: { lte: 21 } },
    });
  });

  it("does not cache malformed prefixes or retain live provider failures", async () => {
    const f = fixture(
      [
        { data: [null], paginationToken: null },
        { data: [transaction("first", 10)], paginationToken: null },
        new Error("tail unavailable"),
        { data: [], paginationToken: null },
      ],
      {},
      { evidenceCacheSeconds: 86_400 },
    );
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      RpcUnavailable,
    );
    expect((await f.read(wallet, mint, 20, 30)).first?.signature).toBe("first");
    expect(f.calls).toHaveLength(4);
  });
  it("exhausts finalized pages at the fixed bound and preserves untouched accounts at S", async () => {
    const f = fixture([
      { data: [transaction("first", 10)], paginationToken: "next" },
      {
        data: [transaction("second-account", 20, "0", "20", "account-b")],
        paginationToken: "last",
      },
      {
        data: [transaction("later-sale", 30, "10", "5")],
        paginationToken: null,
      },
    ]);
    const history = await f.read(wallet, mint, 25, 30);
    expect(history.balanceAtS).toBe(30n);
    expect(history.first).toEqual({
      kind: "swap",
      sender: null,
      signature: "first",
      slot: 10,
      date: new Date(blockTime * 1_000).toISOString(),
    });
    expect(f.calls).toHaveLength(3);
    for (const call of f.calls) {
      expect(call.method).toBe("getTransactionsForAddress");
      expect(call.params[0]).toBe(wallet);
      expect(call.params[1]).toMatchObject({
        transactionDetails: "full",
        encoding: "jsonParsed",
        sortOrder: "asc",
        commitment: "finalized",
        minContextSlot: 30,
        filters: {
          slot: { lte: 30 },
          tokenAccounts: "balanceChanged",
          tokenTransfer: { mint },
        },
      });
    }
    expect(f.calls[0]!.params[1]).not.toHaveProperty("paginationToken");
    expect(f.calls[1]!.params[1]).toHaveProperty("paginationToken", "next");
    expect(f.calls[2]!.params[1]).toHaveProperty("paginationToken", "last");
  });

  it("does not cache live history results between requests", async () => {
    const f = fixture([
      { data: [], paginationToken: null },
      { data: [transaction("arrived", 10)], paginationToken: null },
    ]);
    expect((await f.read(wallet, mint, 20, 30)).first).toBeNull();
    expect((await f.read(wallet, mint, 20, 30)).first?.signature).toBe(
      "arrived",
    );
    expect(f.calls).toHaveLength(2);
  });

  it("ignores failed transactions before reconstructing balances", async () => {
    const failed = transaction("failed", 15, "10", "0");
    failed.meta.err = { InstructionError: [0, "failure"] };
    const f = fixture([
      {
        data: [
          transaction("first", 10),
          failed,
          transaction("later", 20, "10", "15"),
        ],
        paginationToken: null,
      },
    ]);
    expect((await f.read(wallet, mint, 20, 30)).balanceAtS).toBe(15n);
  });

  it("uses canonical block order for same-slot rows despite page order or claimed indices", async () => {
    const first = { ...transaction("first", 10), transactionIndex: 9 };
    const second = {
      ...transaction("second", 10, "10", "20"),
      transactionIndex: 0,
    };
    const f = fixture(
      [
        { data: [second], paginationToken: "next" },
        { data: [first], paginationToken: null },
      ],
      { 10: { signatures: ["unrelated", "first", "second"] } },
    );
    const history = await f.read(wallet, mint, 10, 30);
    expect(history.balanceAtS).toBe(20n);
    expect(history.first?.signature).toBe("first");
    expect(f.calls[2]).toMatchObject({
      method: "getBlock",
      params: [
        10,
        {
          commitment: "finalized",
          transactionDetails: "signatures",
          rewards: false,
        },
      ],
    });
  });

  it("refuses a same-slot signature absent from canonical block evidence", async () => {
    const f = fixture(
      [
        {
          data: [
            transaction("first", 10),
            transaction("second", 10, "10", "20"),
          ],
          paginationToken: null,
        },
      ],
      { 10: { signatures: ["first"] } },
    );
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
  });

  it("fails closed when the canonical block cannot be read", async () => {
    const f = fixture(
      [
        {
          data: [
            transaction("first", 10),
            transaction("second", 10, "10", "20"),
          ],
          paginationToken: null,
        },
      ],
      { 10: new Error("unavailable") },
    );
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      RpcUnavailable,
    );
  });

  it("rejects repeating pagination tokens without requesting another page", async () => {
    const f = fixture([
      { data: [transaction("first", 10)], paginationToken: "same" },
      {
        data: [transaction("second", 20, "10", "20")],
        paginationToken: "same",
      },
    ]);
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
    expect(f.calls).toHaveLength(2);
  });

  it("rejects an empty page that claims further pagination", async () => {
    const f = fixture([{ data: [], paginationToken: "next" }]);
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
    expect(f.calls).toHaveLength(1);
  });

  it("refuses an out-of-bound transaction instead of silently truncating history", async () => {
    const f = fixture([
      { data: [transaction("future", 31)], paginationToken: null },
    ]);
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
  });

  it("rejects duplicate transactions across pages", async () => {
    const f = fixture(
      [
        { data: [transaction("first", 10)], paginationToken: "next" },
        { data: [transaction("first", 10)], paginationToken: null },
      ],
      { 10: { signatures: ["first"] } },
    );
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
  });

  it("rejects missing initial history even when pagination says it is complete", async () => {
    const f = fixture([
      { data: [transaction("partial", 10, "5", "10")], paginationToken: null },
    ]);
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
  });

  it.each([
    null,
    { ...transaction("bad", 10), meta: null },
    {
      ...transaction("bad", 10),
      meta: { ...transaction("bad", 10).meta, preTokenBalances: null },
    },
    {
      ...transaction("bad", 10),
      meta: { ...transaction("bad", 10).meta, innerInstructions: null },
    },
    {
      ...transaction("bad", 10),
      meta: {
        ...transaction("bad", 10).meta,
        postTokenBalances: [
          { accountIndex: 1, mint, uiTokenAmount: { amount: "10" } },
        ],
      },
    },
  ])("refuses malformed transaction evidence", async (raw) => {
    const f = fixture([{ data: [raw], paginationToken: null }]);
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      EvidenceUnavailableError,
    );
  });

  it.each([
    { data: [] },
    { data: [], paginationToken: "" },
    { data: null, paginationToken: null },
    null,
    new Error("provider unavailable"),
  ])("refuses malformed or unavailable history responses", async (page) => {
    const f = fixture([page]);
    await expect(f.read(wallet, mint, 20, 30)).rejects.toBeInstanceOf(
      RpcUnavailable,
    );
  });

  it.each([
    [31, 30],
    [-1, 30],
    [20, -1],
    [1.5, 30],
    [20, Number.MAX_SAFE_INTEGER + 1],
  ])(
    "rejects invalid history bounds before making a request",
    async (snapshotSlot, throughSlot) => {
      const f = fixture([{ data: [], paginationToken: null }]);
      await expect(
        f.read(wallet, mint, snapshotSlot, throughSlot),
      ).rejects.toBeInstanceOf(EvidenceUnavailableError);
      expect(f.calls).toHaveLength(0);
      expect(f.allCalls).toHaveLength(0);
    },
  );
});
