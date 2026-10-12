import { JsonRpcClient } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  KEEPER_LAYOUT,
  KeeperChain,
  RESERVED_KEYS,
  buildRefundTransaction,
  buildSettleTransaction,
  decodeLedger,
  decodePull,
  decodeSnapshot,
  discriminator,
  keeperPda,
  parsePullRevealedLogs,
  payeeWritable,
  pullFilters,
  refundPullInstruction,
  settleInstruction,
  vaultAta,
  zeroLedgerFilters,
} from "./adapter.js";
import type { Payee, SettleInput } from "./adapter.js";
import fixture from "./fixtures/m1-contract.json" with { type: "json" };
import accounts from "./fixtures/m1-accounts.json" with { type: "json" };

const programId = new PublicKey(fixture.programId);
const key = (value: number) => new PublicKey(Buffer.alloc(32, value));
const payee = (value: number, executable = false): Payee => ({
  address: key(value),
  executable,
});
const limits = { settlePacksPerTx: 2, maxTxBytes: 1232 };
const pullBytes = () => Buffer.from(accounts.pull.base64, "base64");
const pullAddress = new PublicKey(accounts.pull.address);
const pull = () => decodePull(pullBytes(), pullAddress, programId);
const ledger = () =>
  decodeLedger(
    Buffer.from(accounts.ledger.base64, "base64"),
    new PublicKey(accounts.ledger.address),
    programId,
  );
const settleInput = (): SettleInput => ({
  pull: pullAddress,
  seq: 7n,
  pack: 0,
  buyer: payee(1),
  referrer: payee(2),
  wallets: [payee(3), payee(4), payee(5), payee(6)],
});
const wireAccount = (
  data: Buffer,
  owner = programId.toBase58(),
  executable = false,
) => ({ owner, executable, data: [data.toString("base64"), "base64"] });
function rpc(handler: (method: string, params: unknown[]) => unknown) {
  const requests: { method: string; params: unknown[] }[] = [];
  const client = new JsonRpcClient({
    url: "http://localhost:8899",
    timeoutMs: 1000,
    failureThreshold: 2,
    recoverMs: 1000,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      requests.push({ method: body.method, params: body.params });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: handler(body.method, body.params),
        }),
        { status: 200 },
      );
    },
  });
  return {
    client,
    requests,
    chain: new KeeperChain(client, programId, limits, key(20)),
  };
}

describe("keeper M1 adapter fixture parity", () => {
  it("matches the recorded IDL discriminators and Rust offsets", () => {
    for (const item of fixture.accounts)
      expect([...discriminator("account", item.name)]).toEqual(
        item.discriminator,
      );
    for (const item of fixture.instructions)
      expect([...discriminator("global", item.name)]).toEqual(
        item.discriminator,
      );
    for (const item of fixture.events)
      expect([...discriminator("event", item.name)]).toEqual(
        item.discriminator,
      );
    expect(KEEPER_LAYOUT.pullHeader).toBe(fixture.layouts.Pull.size);
    expect(KEEPER_LAYOUT.packSize).toBe(fixture.layouts.PackRecord.size);
    expect(KEEPER_LAYOUT.pullStatus).toBe(fixture.layouts.Pull.fields.status);
    expect(KEEPER_LAYOUT.ledgerSize).toBe(fixture.layouts.MintLedger.size);
    expect(KEEPER_LAYOUT.ledgerAccounted).toBe(
      fixture.layouts.MintLedger.fields.accounted,
    );
    expect(KEEPER_LAYOUT.configSize).toBe(fixture.layouts.Config.size);
    expect(KEEPER_LAYOUT.machineSize).toBe(fixture.layouts.Machine.size);
  });
  it("derives canonical PDAs from the independently produced M1 vectors", () => {
    for (const item of fixture.pdas) {
      const parts = item.args.map((value) => {
        if (typeof value === "string") return new PublicKey(value).toBuffer();
        const nonce = Buffer.alloc(4);
        nonce.writeUInt32LE(value);
        return nonce;
      });
      expect(keeperPda(programId, item.name, ...parts).toBase58()).toBe(
        item.address,
      );
    }
  });
  it("decodes variable Pull tails, ledger payer and current machine buckets", () => {
    const decoded = pull();
    expect(decoded).toMatchObject({
      seq: 7n,
      buyerNonce: 7,
      qty: 2,
      status: 2,
      createdTs: 1700000000n,
      revealedTs: 1700000002n,
      settledMask: 0,
    });
    expect(decoded.buyer.equals(key(1))).toBe(true);
    expect(decoded.packs[1]?.royalties[3]).toMatchObject({
      lamports: 14n,
      refund: 24n,
    });
    expect(ledger().payer.equals(key(8))).toBe(true);
    const state = decodeSnapshot(
      Buffer.from(accounts.config, "base64"),
      Buffer.from(accounts.machine, "base64"),
      90,
    );
    expect(state).toMatchObject({
      asOfSlot: 90,
      config: { seasonSet: true, stockUpTs: 1700000001n, activeQueue: 0 },
      machine: {
        phase: 3,
        onAirTs: 1700000010n,
        endTs: 1700001000n,
        teamSol: 999n,
      },
    });
    expect(state.machine.buckets[0]?.class).toBe(1);
    expect(state.machine.buckets[0]?.mint.equals(key(2))).toBe(true);
  });
  it("rejects truncated tails, foreign addresses and unsupported account versions", () => {
    expect(() =>
      decodePull(pullBytes().subarray(0, 575), pullAddress, programId),
    ).toThrow("keeper_invalid_pull");
    expect(() => decodePull(pullBytes(), key(30), programId)).toThrow(
      "keeper_invalid_pull",
    );
    const invalid = pullBytes();
    invalid[147] = 2;
    expect(() => decodePull(invalid, pullAddress, programId)).toThrow(
      "keeper_invalid_pull",
    );
    expect(() =>
      decodeLedger(
        Buffer.from(accounts.ledger.base64, "base64"),
        key(30),
        programId,
      ),
    ).toThrow("keeper_invalid_ledger");
  });
  it("matches all five Rust instruction data vectors and account orders", () => {
    const { chain } = rpc(() => null);
    const instructions = {
      settle: settleInstruction(settleInput(), programId),
      refund_pull: refundPullInstruction(
        { pull: pullAddress, seq: 7n, buyer: payee(1) },
        programId,
      ),
      advance_phase: chain.advance(),
      close_vault: chain.closeVault(
        ledger(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      ),
      team_withdraw: chain.teamWithdraw(key(9)),
    };
    for (const vector of fixture.vectors) {
      const ix = instructions[vector.name as keyof typeof instructions];
      expect(ix.data.toString("hex")).toBe(vector.data);
      expect(ix.keys.map((meta) => meta.isSigner)).toEqual(
        vector.accounts.map((meta) => meta.isSigner),
      );
      expect(ix.keys.length).toBe(vector.accounts.length);
      if (vector.name !== "settle" && vector.name !== "refund_pull")
        expect(ix.keys.map((meta) => meta.isWritable)).toEqual(
          vector.accounts.map((meta) => meta.isWritable),
        );
    }
    expect(
      instructions.settle.keys.map((meta) => meta.pubkey.toBase58()),
    ).toEqual(
      [
        pullAddress,
        keeperPda(programId, "machine"),
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        ...[3, 4, 5, 6].map((value) =>
          keeperPda(programId, "binder", key(value).toBuffer()),
        ),
      ].map((value) => value.toBase58()),
    );
    expect(
      instructions.refund_pull.keys[2]?.pubkey.equals(
        keeperPda(programId, "binder", key(1).toBuffer()),
      ),
    ).toBe(true);
    expect(
      instructions.close_vault.keys[5]?.pubkey.equals(ledger().payer),
    ).toBe(true);
  });
  it("keeps reserved and executable payees and every duplicate placeholder read-only", () => {
    for (const address of RESERVED_KEYS)
      expect(
        payeeWritable({ address: new PublicKey(address), executable: false }),
      ).toBe(false);
    const input = {
      ...settleInput(),
      buyer: payee(1, true),
      referrer: undefined,
      wallets: [
        null,
        payee(3),
        { address: PublicKey.default, executable: false },
        null,
      ] as SettleInput["wallets"],
    };
    const ix = settleInstruction(input, programId);
    for (const index of [2, 3, 4, 6, 7, 8, 11])
      expect(ix.keys[index]?.isWritable).toBe(false);
    expect(ix.keys[5]?.isWritable).toBe(true);
    expect(ix.keys[9]?.isWritable).toBe(true);
    expect(
      refundPullInstruction(
        { pull: pullAddress, seq: 7n, buyer: payee(1, true) },
        programId,
      ).keys[3]?.isWritable,
    ).toBe(false);
  });
  it("honors injected config pack and byte limits and the royalty memo", () => {
    const options = {
      wallet: key(20),
      blockhash: PublicKey.default.toBase58(),
      computeBudget: false as const,
    };
    const tx = buildSettleTransaction(
      { ...options, packs: [settleInput(), { ...settleInput(), pack: 1 }] },
      { programId, limits },
    );
    expect(tx.instructions).toHaveLength(3);
    expect(tx.instructions[2]?.data.toString()).toBe("1pct:roy:7");
    expect(() =>
      buildSettleTransaction({ ...options, packs: [] }, { programId, limits }),
    ).toThrow("keeper_invalid_pack_count");
    expect(() =>
      buildSettleTransaction(
        { ...options, packs: [settleInput(), settleInput()] },
        { programId, limits: { ...limits, settlePacksPerTx: 1 } },
      ),
    ).toThrow("keeper_invalid_pack_count");
    expect(() =>
      buildRefundTransaction(
        { ...options, pull: pullAddress, seq: 7n, buyer: payee(1) },
        { programId, limits: { ...limits, maxTxBytes: 100 } },
      ),
    ).toThrow("keeper_transaction_too_large");
  });
});

describe("confirmed chain readers", () => {
  it("uses status memcmp at 144 without dataSize and exact zero-ledger filters", async () => {
    const { chain, requests } = rpc((_method, params) => {
      const settings = params[1] as { filters: { dataSize?: number }[] };
      return settings.filters.some((filter) => filter.dataSize)
        ? [
            {
              pubkey: accounts.ledger.address,
              account: wireAccount(
                Buffer.from(accounts.ledger.base64, "base64"),
              ),
            },
          ]
        : [
            {
              pubkey: accounts.pull.address,
              account: wireAccount(pullBytes()),
            },
          ];
    });
    expect(await chain.scanPulls(2)).toHaveLength(1);
    expect(await chain.zeroLedgers()).toHaveLength(1);
    expect(requests[0]?.params[1]).toEqual({
      commitment: "confirmed",
      encoding: "base64",
      filters: pullFilters(2),
    });
    expect(pullFilters(1)).toEqual([
      {
        memcmp: {
          offset: 0,
          bytes: discriminator("account", "Pull").toString("base64"),
          encoding: "base64",
        },
      },
      { memcmp: { offset: 144, bytes: "AQ==", encoding: "base64" } },
    ]);
    expect(zeroLedgerFilters()).toContainEqual({ dataSize: 80 });
    expect(zeroLedgerFilters()).toContainEqual({
      memcmp: { offset: 72, bytes: "AAAAAAAAAAA=", encoding: "base64" },
    });
  });
  it("reads both snapshot accounts in one slot and preserves finality for reconciliation", async () => {
    const { chain, requests } = rpc((_method, params) => ({
      context: { slot: 42 },
      value:
        (params[0] as string[]).length === 2
          ? [
              wireAccount(Buffer.from(accounts.config, "base64")),
              wireAccount(Buffer.from(accounts.machine, "base64")),
            ]
          : [null],
    }));
    expect((await chain.snapshot()).asOfSlot).toBe(42);
    expect(await chain.pull(pullAddress, "finalized")).toBeNull();
    expect(await chain.ledger(key(2), "finalized")).toBeNull();
    expect(requests[1]?.params[1]).toMatchObject({ commitment: "finalized" });
    expect(requests[2]?.params[1]).toMatchObject({ commitment: "finalized" });
  });
  it("fails closed for account ownership or a misleading RPC filter", async () => {
    const wrongOwner = rpc(() => [
      {
        pubkey: accounts.pull.address,
        account: wireAccount(pullBytes(), key(30).toBase58()),
      },
    ]);
    await expect(wrongOwner.chain.scanPulls(2)).rejects.toThrow(
      "keeper_invalid_owner",
    );
    const wrongStatus = rpc(() => [
      { pubkey: accounts.pull.address, account: wireAccount(pullBytes()) },
    ]);
    await expect(wrongStatus.chain.scanPulls(1)).rejects.toThrow(
      "keeper_pull_filter_mismatch",
    );
  });
  it("fetches executable flags before settle and refund, including House placeholders", async () => {
    const { chain, requests } = rpc((_method, params) => ({
      context: { slot: 42 },
      value: (params[0] as string[]).map((address) =>
        wireAccount(
          Buffer.alloc(0),
          key(30).toBase58(),
          address === key(1).toBase58() || address === key(3).toBase58(),
        ),
      ),
    }));
    const instructions = await chain.settle(pull(), [0]);
    expect(instructions[0]?.keys[2]?.isWritable).toBe(false);
    expect(instructions[0]?.keys[4]?.isWritable).toBe(false);
    expect(instructions[0]?.keys[5]?.isWritable).toBe(false);
    expect(instructions[0]?.keys[9]?.isWritable).toBe(false);
    expect((await chain.refund(pull())).keys[3]?.isWritable).toBe(false);
    expect(
      requests.every((request) => request.method === "getMultipleAccounts"),
    ).toBe(true);
    await expect(chain.settle(pull(), [0, 0])).rejects.toThrow(
      "keeper_duplicate_pack",
    );
  });
  it("handles an absent vault and a non-writable stored ledger payer", async () => {
    const tokenProgram = new PublicKey(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    const { chain, requests } = rpc((_method, params) => ({
      context: { slot: 42 },
      value:
        (params[0] as string[]).length === 2
          ? [
              wireAccount(Buffer.alloc(82), tokenProgram.toBase58()),
              wireAccount(Buffer.alloc(0), key(30).toBase58(), true),
            ]
          : [null],
    }));
    const state = await chain.closeVaultState(ledger());
    expect(state).toMatchObject({ vaultExists: false, payerWritable: false });
    expect(requests[1]?.params[0]).toEqual([
      vaultAta(programId, key(2), tokenProgram).toBase58(),
    ]);
  });
  it("verifies token-program ownership and the canonical vault's mint and authority", async () => {
    const tokenProgram = new PublicKey(
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    );
    const vault = Buffer.alloc(165);
    key(2).toBuffer().copy(vault, 0);
    keeperPda(programId, "vault_auth").toBuffer().copy(vault, 32);
    const { chain } = rpc((_method, params) => ({
      context: { slot: 42 },
      value:
        (params[0] as string[]).length === 2
          ? [wireAccount(Buffer.alloc(82), tokenProgram.toBase58()), null]
          : [wireAccount(vault, tokenProgram.toBase58())],
    }));
    expect(await chain.closeVaultState(ledger())).toMatchObject({
      vaultExists: true,
      payerWritable: true,
    });
    key(31).toBuffer().copy(vault, 32);
    await expect(chain.closeVaultState(ledger())).rejects.toThrow(
      "keeper_invalid_vault",
    );
  });
});

describe("PullRevealed event adapter", () => {
  it("accepts only exact event bytes emitted by this program's current invocation", () => {
    const event = Buffer.alloc(161);
    discriminator("event", "PullRevealed").copy(event);
    pullAddress.toBuffer().copy(event, 8);
    event.writeBigUInt64LE(7n, 40);
    const data = `Program data: ${event.toString("base64")}`;
    const logs = [
      data,
      `Program ${programId} invoke [1]`,
      data,
      `Program ${key(30)} invoke [2]`,
      data,
      `Program ${key(30)} success`,
      `Program data: ${event.subarray(0, 160).toString("base64")}`,
      `Program ${programId} success`,
      data,
    ];
    const decoded = parsePullRevealedLogs(logs, programId);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.seq).toBe(7n);
    expect(decoded[0]?.pull.equals(pullAddress)).toBe(true);
  });
});

it("reads missing Pull and Machine sequence in one finalized bank", async () => {
  const machine = Buffer.from(accounts.machine, "base64");
  machine.writeBigUInt64LE(700n, 16);
  const { chain, requests } = rpc(() => ({
    context: { slot: 77 },
    value: [null, wireAccount(machine)],
  }));
  expect(await chain.pullCompletion(pullAddress, "finalized")).toEqual({
    pull: null,
    nextSeq: 700n,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.params).toEqual([
    [pullAddress.toBase58(), keeperPda(programId, "machine").toBase58()],
    { commitment: "finalized", encoding: "base64" },
  ]);
});
