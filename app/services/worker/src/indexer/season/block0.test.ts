import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { DBC_LAUNCH_LAYOUT } from "@onepercent/sdk";
import { singletonAddress } from "../accounts.js";
import type { RpcReader } from "../source.js";
import type { IndexerStore } from "../store.js";
import { Block0Indexer, block0Rows, type Block0Transaction } from "./block0.js";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const signature = (n: number) =>
  ("A" + n.toString(8).replaceAll("0", "9")).padStart(88, "1");
const mint = key(5),
  poolVault = key(6),
  wallet = key(7),
  other = key(8),
  program = key(9),
  poolKey = key(10),
  dbc = key(11);
const vault = singletonAddress(program, "vault_auth");
const balance = (
  accountIndex: number,
  owner: string | undefined,
  amount: string,
) => ({ accountIndex, mint, owner, uiTokenAmount: { amount } });
function tx(n = 1, slot = 100): Block0Transaction {
  return {
    slot,
    transaction: {
      signatures: [signature(n)],
      message: { accountKeys: [wallet, poolVault, key(12), key(13)] },
    },
    meta: {
      err: null,
      preBalances: [2000],
      postBalances: [1500],
      preTokenBalances: [balance(1, poolKey, "1000"), balance(2, wallet, "5")],
      postTokenBalances: [
        balance(1, poolKey, "800"),
        balance(2, wallet, "150"),
        balance(3, other, "50"),
      ],
    },
  };
}
const rowInput = (transaction = tx()) => ({
  transaction,
  mint,
  poolBaseVault: poolVault,
  teamRoles: new Map([[wallet, "keeper"]]),
  vaultAuthority: vault,
  launchSignature: signature(1),
});

describe("Block-0 observed token changes", () => {
  it("aggregates by owner, excludes pool inventory and records SOL only for the payer", () => {
    expect(block0Rows(rowInput())).toEqual(
      [
        {
          signature: signature(1),
          slot: 100n,
          owner: wallet,
          tokens: 145n,
          lamportsSpent: 500n,
          team: true,
          role: "keeper",
        },
        {
          signature: signature(1),
          slot: 100n,
          owner: other,
          tokens: 50n,
          lamportsSpent: null,
          team: false,
          role: null,
        },
      ].sort((a, b) => a.owner.localeCompare(b.owner)),
    );
    const moved = tx();
    moved.meta!.preTokenBalances.push(balance(3, wallet, "50"));
    moved.meta!.postTokenBalances[2] = balance(3, wallet, "50");
    expect(block0Rows(rowInput(moved))).toHaveLength(1);
    expect(block0Rows(rowInput(moved))[0]?.tokens).toBe(145n);
  });
  it("labels the vault dev buy and never exposes a failed or ambiguous transfer", () => {
    const launch = tx();
    launch.meta!.postTokenBalances = [balance(2, vault, "40000000000000")];
    expect(block0Rows(rowInput(launch))[0]).toMatchObject({
      owner: vault,
      role: "disclosed_dev_buy",
      team: true,
      lamportsSpent: null,
    });
    const later = structuredClone(launch);
    later.transaction.signatures = [signature(2)];
    expect(block0Rows(rowInput(later))[0]).toMatchObject({
      owner: vault,
      role: null,
      team: false,
    });
    launch.meta!.err = { InstructionError: [0, "InvalidArgument"] };
    expect(block0Rows(rowInput(launch))).toEqual([]);
    const missing = tx();
    missing.meta!.postTokenBalances[1]!.owner = undefined;
    expect(() => block0Rows(rowInput(missing))).toThrow(
      "block0_token_owner_missing",
    );
    missing.meta = null;
    expect(() => block0Rows(rowInput(missing))).toThrow(
      "block0_transaction_metadata_missing",
    );
  });
});

function fixture() {
  const launch = {
    signature: signature(1),
    slot: 100n,
    mint,
    launchPool: poolKey,
    devBuyTokens: 40_000_000_000_000n,
  };
  const config = Buffer.alloc(872);
  createHash("sha256").update("account:Config").digest().copy(config, 0, 0, 8);
  new PublicKey(mint).toBuffer().copy(config, 552);
  new PublicKey(wallet).toBuffer().copy(config, 104);
  new PublicKey(wallet).toBuffer().copy(config, 40);
  const pool = Buffer.alloc(DBC_LAUNCH_LAYOUT.pool.minLength);
  Buffer.from(DBC_LAUNCH_LAYOUT.pool.discriminator).copy(pool);
  new PublicKey(mint).toBuffer().copy(pool, DBC_LAUNCH_LAYOUT.pool.baseMint);
  new PublicKey(poolVault)
    .toBuffer()
    .copy(pool, DBC_LAUNCH_LAYOUT.pool.baseVault);
  const launchTx = tx();
  launchTx.meta!.postTokenBalances.push(
    balance(3, vault, String(launch.devBuyTokens)),
  );
  const transactions = new Map([
    [signature(1), launchTx],
    [signature(2), tx(2, 119)],
  ]);
  const pages: { signature: string; slot: number; err: null }[][] = [
    [{ signature: signature(2), slot: 119, err: null }],
  ];
  let page = 0;
  let finalized = 200;
  const request = vi.fn(
    async (
      method: string,
      params: unknown[],
      schema: { parse(value: unknown): unknown },
    ) => {
      let result: unknown;
      if (method === "getSlot") result = finalized;
      else if (method === "getFirstAvailableBlock") result = 0;
      else if (method === "getAccountInfo")
        result = {
          context: { slot: 200 },
          value: {
            owner: params[0] === poolKey ? dbc : program,
            data: [
              (params[0] === poolKey ? pool : config).toString("base64"),
              "base64",
            ],
          },
        };
      else if (method === "getSignaturesForAddress")
        result = pages[page++] ?? [];
      else if (method === "getTransaction")
        result = transactions.get(String(params[0])) ?? null;
      else throw new Error(method);
      return schema.parse(result);
    },
  );
  const sqlRows: Record<string, unknown>[] = [
    {
      signature: launch.signature,
      slot: "100",
      mint,
      launch_pool: poolKey,
      dev_buy_tokens: String(launch.devBuyTokens),
      status: "pending",
      as_of_slot: "100",
    },
  ];
  let latestSlot = "100";
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith("SELECT COALESCE(MAX(slot)"))
      return { rows: [{ slot: latestSlot }] };
    if (text.startsWith("SELECT")) return { rows: sqlRows };
    if (text.startsWith("UPDATE season_launches"))
      Object.assign(sqlRows[0]!, { status: "ready", as_of_slot: values![1] });
    return { rows: [] };
  });
  const store = {
    pool: { query },
    transaction: vi.fn(
      async (work: (sql: { query: typeof query }) => Promise<void>) =>
        work({ query }),
    ),
  } as unknown as IndexerStore;
  const indexer = new Block0Indexer({
    store,
    rpc: { request } as unknown as RpcReader,
    programId: program,
    dbcProgram: dbc,
    slots: 20,
  });
  return {
    indexer,
    launch,
    transactions,
    pages,
    request,
    query,
    store,
    sqlRows,
    setFinalized: (value: number) => {
      finalized = value;
    },
    setLatestSlot: (value: number) => {
      latestSlot = String(value);
    },
    resetPages: () => {
      page = 0;
    },
  };
}

describe("Block-0 complete evidence before atomic publication", () => {
  it("includes the launch, excludes the end slot and labels all Config roles", async () => {
    const x = fixture();
    x.pages[0]!.unshift({ signature: signature(3), slot: 120, err: null });
    const rows = await x.indexer.read(x.launch, 120n);
    expect(
      rows.some(
        (row) =>
          row.signature === signature(1) && row.role === "disclosed_dev_buy",
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.slot === 119n && row.role === "keeper,guardian"),
    ).toBe(true);
    expect(rows.some((row) => row.slot === 120n)).toBe(false);
    expect(
      x.request.mock.calls.filter(([method]) => method === "getTransaction"),
    ).toHaveLength(2);
  });
  it("pages beyond 1000 signatures, then rebuilds identical rows", async () => {
    const x = fixture();
    x.pages.unshift(
      Array.from({ length: 1000 }, (_, i) => ({
        signature: signature(i + 10),
        slot: 121,
        err: null,
      })),
    );
    const first = await x.indexer.read(x.launch, 120n);
    expect(
      x.request.mock.calls.filter(
        ([method]) => method === "getSignaturesForAddress",
      ),
    ).toHaveLength(2);
    x.resetPages();
    expect(await x.indexer.read(x.launch, 120n)).toEqual(first);
  });
  it("holds pending until the strict confirmed fence and finalized window pass", async () => {
    const x = fixture();
    expect(await x.indexer.poll(152n, 152n)).toBe(false);
    x.setFinalized(119);
    expect(await x.indexer.poll(153n, 153n)).toBe(false);
    expect(x.store.transaction).not.toHaveBeenCalled();
    x.setFinalized(120);
    expect(await x.indexer.poll(153n, 153n)).toBe(true);
    expect(x.sqlRows[0]).toMatchObject({ status: "ready", as_of_slot: "153" });
    const marker = x.query.mock.calls.find(([text]) =>
      text.startsWith("INSERT INTO chain_events"),
    );
    expect(marker?.[1]).toEqual([
      signature(1),
      "153",
      "4294967295",
      "IndexerBlock0Ready",
      {},
    ]);
    expect(await x.indexer.poll(200n, 200n)).toBe(false);
  });
  it("a missing transaction or missing dev buy never writes a partial ready board", async () => {
    const x = fixture();
    x.transactions.delete(signature(2));
    await expect(x.indexer.poll(153n, 153n)).rejects.toThrow(
      "block0_transaction_evidence_missing",
    );
    expect(x.store.transaction).not.toHaveBeenCalled();
    expect(x.sqlRows[0]?.status).toBe("pending");
    const y = fixture();
    y.transactions.get(signature(1))!.meta!.postTokenBalances.pop();
    await expect(y.indexer.poll(153n, 153n)).rejects.toThrow(
      "block0_dev_buy_missing",
    );
    expect(y.store.transaction).not.toHaveBeenCalled();
  });
  it("does not insert an old notification after another indexer advances", async () => {
    const x = fixture();
    x.setLatestSlot(160);
    expect(await x.indexer.poll(153n, 153n)).toBe(false);
    expect(x.sqlRows[0]?.status).toBe("pending");
    expect(
      x.query.mock.calls.some(([text]) =>
        text.startsWith("INSERT INTO chain_events"),
      ),
    ).toBe(false);
    x.resetPages();
    expect(await x.indexer.poll(161n, 161n)).toBe(true);
    expect(x.sqlRows[0]?.as_of_slot).toBe("161");
  });
});
