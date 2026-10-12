import { Buffer } from "node:buffer";
import { ACCOUNT_SIZES, RESCUE, SERVICES } from "@onepercent/config";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import type { AccountInfo, GetAccountInfoConfig } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  configLayout,
  encodeBinder,
  encodeDeck,
  encodePull,
  machineLayout,
  mintLedgerLayout,
} from "../../../sdk/src/layouts.js";
import { EXTERNAL_IDS } from "../../../sdk/src/constants.js";
import {
  findClosableVaults,
  findDeckEntries,
  findMyVaultDeposits,
  findOpenPulls,
  findOwnPulls,
  findPullsPaying,
  readBinder,
  readCore,
  readMints,
  readPayees,
  readPull,
  readVaultDeposit,
  rescuePda,
  RpcScanRefusedError,
} from "../../../sdk/src/rescue/discover.js";
import type { RescueRpc } from "../../../sdk/src/rescue/discover.js";
import { readClock, rpcCall } from "../../../sdk/src/rescue/clock.js";

const programId = Keypair.generate().publicKey;
const wallet = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const sysvarOwner = new PublicKey(
  "Sysvar1111111111111111111111111111111111111",
);
const account = (
  data: Buffer,
  owner = programId,
  lamports = 1_000_000,
): AccountInfo<Buffer> => ({
  data,
  owner,
  lamports,
  executable: false,
  rentEpoch: 0,
});
function fixture() {
  const accounts = new Map<string, AccountInfo<Buffer>>();
  let slot = 400;
  const reads: { address: PublicKey; config?: GetAccountInfoConfig }[] = [];
  const batches: PublicKey[][] = [];
  let scanRows: { pubkey: PublicKey; account: AccountInfo<Buffer> }[] = [];
  const getAccountInfoAndContext = vi.fn(
    async (address: PublicKey, config?: GetAccountInfoConfig) => {
      reads.push({ address, config });
      const info = accounts.get(address.toBase58()) ?? null;
      return {
        context: { slot: slot++ },
        value:
          info && config?.dataSlice
            ? {
                ...info,
                data: info.data.subarray(
                  config.dataSlice.offset,
                  config.dataSlice.offset + config.dataSlice.length,
                ),
              }
            : info,
      };
    },
  );
  const getMultipleAccountsInfoAndContext = vi.fn(
    async (addresses: PublicKey[]) => {
      batches.push(addresses);
      return {
        context: { slot: slot++ },
        value: addresses.map(
          (address) => accounts.get(address.toBase58()) ?? null,
        ),
      };
    },
  );
  const getProgramAccounts = vi.fn(async (...args: unknown[]) => {
    void args;
    return { context: { slot: slot++ }, value: scanRows };
  });
  const rpc = {
    getAccountInfoAndContext,
    getMultipleAccountsInfoAndContext,
    getProgramAccounts,
  } as unknown as RescueRpc;
  return {
    rpc,
    accounts,
    reads,
    batches,
    getProgramAccounts,
    getAccountInfoAndContext,
    setScan(rows: typeof scanRows) {
      scanRows = rows;
    },
  };
}
function putPull(
  f: ReturnType<typeof fixture>,
  nonce: number,
  extras: Parameters<typeof encodePull>[0] = {},
) {
  const nonceBytes = Buffer.alloc(4);
  nonceBytes.writeUInt32LE(nonce);
  const [address, bump] = rescuePda(programId, "pull", [
    wallet.toBuffer(),
    nonceBytes,
  ]);
  const info = account(
    encodePull({
      buyer: wallet,
      buyer_nonce: nonce,
      bump,
      version: 1,
      qty: 1,
      status: 1,
      ...extras,
    }),
  );
  f.accounts.set(address.toBase58(), info);
  return { pubkey: address, account: info };
}
function putMachine(f: ReturnType<typeof fixture>) {
  const [address, bump] = rescuePda(programId, "machine");
  f.accounts.set(
    address.toBase58(),
    account(machineLayout.encode({ bump, version: 1 })),
  );
}
function putMint(
  f: ReturnType<typeof fixture>,
  tokenProgram = EXTERNAL_IDS.splToken,
) {
  const data = Buffer.alloc(82);
  data[44] = 6;
  data[45] = 1;
  f.accounts.set(mint.toBase58(), account(data, tokenProgram));
}

describe("rescue discovery from the supplied RPC", () => {
  it("reads signed chain Clock time at confirmed and rejects non-sysvar data", async () => {
    const f = fixture();
    const data = Buffer.alloc(40);
    data.writeBigInt64LE(-12n, 32);
    f.accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), account(data, sysvarOwner));
    expect(await readClock(f.rpc)).toEqual({ slot: 400, unixTimestamp: -12n });
    expect(f.reads[0]?.config?.commitment).toBe("confirmed");
    f.accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), account(data));
    await expect(readClock(f.rpc)).rejects.toThrow("Invalid Clock");
  });
  it("bounds each RPC call without retrying", async () => {
    vi.useFakeTimers();
    try {
      const operation = vi.fn(() => new Promise<never>(() => {}));
      const assertion = expect(rpcCall(operation)).rejects.toMatchObject({
        code: "rpc_timeout",
      });
      await vi.advanceTimersByTimeAsync(SERVICES.transport.rpcTimeoutMs);
      await assertion;
      expect(operation).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("discovers runtime program identity and authority, including a sealed program", async () => {
    const f = fixture();
    const [config, configBump] = rescuePda(programId, "config");
    f.accounts.set(
      config.toBase58(),
      account(configLayout.encode({ bump: configBump, version: 1 })),
    );
    putMachine(f);
    const clock = Buffer.alloc(40);
    clock.writeBigInt64LE(88n, 32);
    f.accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), account(clock, sysvarOwner));
    const [programData] = PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      loader,
    );
    const executable = Buffer.alloc(36);
    executable.writeUInt32LE(2);
    programData.toBuffer().copy(executable, 4);
    f.accounts.set(programId.toBase58(), {
      ...account(executable, loader),
      executable: true,
    });
    const programBytes = Buffer.alloc(128);
    programBytes.writeUInt32LE(3);
    programBytes.writeBigUInt64LE(22n, 4);
    programBytes[12] = 1;
    wallet.toBuffer().copy(programBytes, 13);
    f.accounts.set(programData.toBase58(), account(programBytes, loader));
    const core = await readCore(f.rpc, programId);
    expect(core.upgradeAuthority?.equals(wallet)).toBe(true);
    expect(core.clock.unixTimestamp).toBe(88n);
    expect(core.programData.equals(programData)).toBe(true);
    expect(core.deployedSlot).toBe(22n);
    programBytes[12] = 0;
    expect((await readCore(f.rpc, programId)).upgradeAuthority).toBeNull();
    executable.writeUInt32LE(1);
    await expect(readCore(f.rpc, programId)).rejects.toThrow(
      "not an upgradeable program",
    );
  });
  it("reads bounded Deck slices and retains each row's context slot", async () => {
    const f = fixture();
    const [deck, bump] = rescuePda(programId, "deck");
    const perChunk = Math.floor(
      SERVICES.indexer.deckChunkBytes / ACCOUNT_SIZES.deckEntry,
    );
    const entries = Array.from({ length: perChunk + 3 }, (_, i) => ({
      depositor: i === perChunk + 1 ? wallet : other,
      mint,
      amount: BigInt(i + 1),
      flags: 1,
    }));
    f.accounts.set(
      deck.toBase58(),
      account(encodeDeck({ bump, version: 1, entries })),
    );
    expect(await findDeckEntries(f.rpc, programId, wallet)).toMatchObject([
      { deckIndex: perChunk + 1, amount: BigInt(perChunk + 2), slot: 402 },
    ]);
    const slices = f.reads.slice(1, -1);
    expect(slices).toHaveLength(2);
    expect(
      slices.every(
        (read) =>
          read.config!.dataSlice!.length <= SERVICES.indexer.deckChunkBytes,
      ),
    ).toBe(true);
    expect(slices.every((read) => read.config!.minContextSlot === 400)).toBe(
      true,
    );
    expect(f.getProgramAccounts).not.toHaveBeenCalled();
  });
  it("bounds Deck slice concurrency to the configured limit", async () => {
    const f = fixture();
    const [deck, bump] = rescuePda(programId, "deck");
    const chunk = Math.floor(
      SERVICES.indexer.deckChunkBytes / ACCOUNT_SIZES.deckEntry,
    );
    f.accounts.set(
      deck.toBase58(),
      account(
        encodeDeck({
          bump,
          version: 1,
          entries: Array.from(
            { length: chunk * (RESCUE.scanConcurrency + 1) },
            () => ({ depositor: other, mint, amount: 1n }),
          ),
        }),
      ),
    );
    let active = 0;
    let maximum = 0;
    const original = f.getAccountInfoAndContext.getMockImplementation()!;
    f.getAccountInfoAndContext.mockImplementation(async (address, config) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      const result = await original(address, config);
      active--;
      return result;
    });
    expect(await findDeckEntries(f.rpc, programId, wallet)).toEqual([]);
    expect(maximum).toBe(RESCUE.scanConcurrency);
  });

  it("rejects changed Deck headers and malformed owners/layouts", async () => {
    const f = fixture();
    const [deck, bump] = rescuePda(programId, "deck");
    f.accounts.set(
      deck.toBase58(),
      account(
        encodeDeck({
          bump,
          version: 1,
          entries: [{ depositor: wallet, mint, amount: 1n }],
        }),
      ),
    );
    const original = f.getAccountInfoAndContext.getMockImplementation()!;
    f.getAccountInfoAndContext.mockImplementation(async (address, config) => {
      const result = await original(address, config);
      if (
        f.reads.length > 1 &&
        config?.dataSlice?.offset === 0 &&
        result.value
      ) {
        result.value = {
          ...result.value,
          data: Buffer.from(result.value.data),
        };
        result.value.data.writeBigUInt64LE(1n, 24);
      }
      return result;
    });
    await expect(findDeckEntries(f.rpc, programId, wallet)).rejects.toThrow(
      "Deck changed",
    );
    const [binder, binderBump] = rescuePda(programId, "binder", [
      wallet.toBuffer(),
    ]);
    expect(await readBinder(f.rpc, programId, wallet)).toBeNull();
    f.accounts.set(
      binder.toBase58(),
      account(
        encodeBinder({
          owner: wallet,
          bump: binderBump,
          cards: [{ mint, amount: 3n }],
        }),
      ),
    );
    expect((await readBinder(f.rpc, programId, wallet))?.cards[0]?.amount).toBe(
      3n,
    );
    f.accounts.get(binder.toBase58())!.owner = other;
    await expect(readBinder(f.rpc, programId, wallet)).rejects.toThrow(
      "owner or layout",
    );
    f.accounts.set(
      binder.toBase58(),
      account(encodeBinder({ owner: other, bump: binderBump })),
    );
    await expect(readBinder(f.rpc, programId, wallet)).rejects.toThrow(
      "Binder owner",
    );
    f.accounts.set(binder.toBase58(), account(Buffer.alloc(112)));
    await expect(readBinder(f.rpc, programId, wallet)).rejects.toThrow(
      "discriminator",
    );
  });
  it("treats donated lamports at absent PDAs as absent without hiding malformed state", async () => {
    const f = fixture();
    const binder = rescuePda(programId, "binder", [wallet.toBuffer()])[0];
    const pull = rescuePda(programId, "pull", [
      wallet.toBuffer(),
      Buffer.alloc(4),
    ])[0];
    const ledger = rescuePda(programId, "ledger", [mint.toBuffer()])[0];
    for (const address of [binder, pull, ledger])
      f.accounts.set(
        address.toBase58(),
        account(Buffer.alloc(0), SystemProgram.programId, 17),
      );
    expect(await readBinder(f.rpc, programId, wallet)).toBeNull();
    expect(await readPull(f.rpc, programId, pull)).toBeNull();
    expect(await findOwnPulls(f.rpc, programId, wallet, 1)).toEqual([]);
    expect(await readVaultDeposit(f.rpc, programId, mint)).toBeNull();
    f.accounts.set(
      binder.toBase58(),
      account(Buffer.alloc(1), SystemProgram.programId),
    );
    await expect(readBinder(f.rpc, programId, wallet)).rejects.toThrow(
      "owner or layout",
    );
    f.accounts.set(pull.toBase58(), {
      ...account(Buffer.alloc(0), SystemProgram.programId),
      executable: true,
    });
    await expect(readPull(f.rpc, programId, pull)).rejects.toThrow(
      "owner or layout",
    );
    f.accounts.set(ledger.toBase58(), account(Buffer.alloc(0)));
    await expect(readVaultDeposit(f.rpc, programId, mint)).rejects.toThrow(
      "owner or layout",
    );
  });

  it("enumerates own Pull PDAs in batches of at most 100 without scanning", async () => {
    const f = fixture();
    putPull(f, 0);
    putPull(f, 100);
    putPull(f, 204);
    expect(
      (await findOwnPulls(f.rpc, programId, wallet, 205)).map(
        (pull) => pull.buyer_nonce,
      ),
    ).toEqual([0, 100, 204]);
    expect(f.batches.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(f.getProgramAccounts).not.toHaveBeenCalled();
    const row = putPull(f, 2, { buyer: other });
    await expect(readPull(f.rpc, programId, row.pubkey)).rejects.toThrow("PDA");
  });
  it("filters variable-size Pull scans and excludes settled or House payments", async () => {
    const f = fixture();
    const due = putPull(f, 0, {
      status: 2,
      packs: [{ royalties: [{ depositor: wallet }, {}, {}, {}] }],
    });
    const settled = putPull(f, 1, {
      status: 2,
      settled_mask: 1,
      referrer: wallet,
    });
    const house = putPull(f, 2, {
      status: 2,
      packs: [
        { house_mask: 1, royalties: [{ depositor: wallet }, {}, {}, {}] },
      ],
    });
    f.setScan([due, settled, house]);
    expect(
      (await findPullsPaying(f.rpc, programId, wallet)).map(
        (pull) => pull.buyer_nonce,
      ),
    ).toEqual([0]);
    const config = f.getProgramAccounts.mock.calls[0]![1] as {
      withContext: boolean;
      filters: { dataSize?: number; memcmp?: { offset: number } }[];
    };
    expect(config.withContext).toBe(true);
    expect(config.filters.map((filter) => filter.memcmp?.offset)).toEqual([
      0, 144,
    ]);
    expect(config.filters.some((filter) => filter.dataSize !== undefined)).toBe(
      false,
    );
  });
  it("reports refused scans without blocking direct account flows", async () => {
    const f = fixture();
    f.getProgramAccounts.mockRejectedValue(
      new Error("RPC does not support scans"),
    );
    await expect(findOpenPulls(f.rpc, programId, 2)).rejects.toBeInstanceOf(
      RpcScanRefusedError,
    );
    expect(await readBinder(f.rpc, programId, wallet)).toBeNull();
    expect(await findOwnPulls(f.rpc, programId, wallet, 0)).toEqual([]);
  });
  it("treats a timed-out scan as unavailable so direct exits still work", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.getProgramAccounts.mockImplementation(() => new Promise(() => {}));
      const assertion = expect(
        findOpenPulls(f.rpc, programId, 2),
      ).rejects.toMatchObject({ code: "rpc_scan_refused" });
      await vi.advanceTimersByTimeAsync(SERVICES.transport.rpcTimeoutMs);
      await assertion;
      expect(await readBinder(f.rpc, programId, wallet)).toBeNull();
      expect(f.getProgramAccounts).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates Token and Token-2022 mint initialization", async () => {
    const f = fixture();
    putMint(f);
    expect(await readMints(f.rpc, [mint])).toMatchObject([
      { decimals: 6, slot: 400 },
    ]);
    putMint(f, EXTERNAL_IDS.token2022);
    expect(
      (await readMints(f.rpc, [mint]))[0]?.tokenProgram.equals(
        EXTERNAL_IDS.token2022,
      ),
    ).toBe(true);
    f.accounts.get(mint.toBase58())!.data[45] = 0;
    await expect(readMints(f.rpc, [mint])).rejects.toThrow("not initialized");
  });
  it("preserves zero-lamport System payees and rejects imprecise balances", async () => {
    const f = fixture();
    expect(await readPayees(f.rpc, [wallet])).toMatchObject([
      {
        exists: false,
        executable: false,
        owner: SystemProgram.programId,
        lamports: 0n,
        dataLength: 0,
      },
    ]);
    f.accounts.set(
      wallet.toBase58(),
      account(
        Buffer.alloc(0),
        SystemProgram.programId,
        Number.MAX_SAFE_INTEGER + 1,
      ),
    );
    await expect(readPayees(f.rpc, [wallet])).rejects.toThrow(
      "lamport balance",
    );
  });
  it("validates ledger PDAs, vault donations and the immutable rent recipient", async () => {
    const f = fixture();
    putMint(f);
    putMachine(f);
    const [ledger] = rescuePda(programId, "ledger", [mint.toBuffer()]);
    const ledgerInfo = account(
      mintLedgerLayout.encode({ mint, payer: wallet, accounted: 0n }),
    );
    f.setScan([{ pubkey: ledger, account: ledgerInfo }]);
    f.accounts.set(ledger.toBase58(), ledgerInfo);
    const first = await findMyVaultDeposits(f.rpc, programId, wallet);
    expect(first[0]).toMatchObject({
      closable: false,
      vaultExists: false,
      ledgerLamports: 1_000_000n,
    });
    const vault = first[0]!.vault;
    const tokenData = Buffer.alloc(165);
    mint.toBuffer().copy(tokenData, 0);
    rescuePda(programId, "vault_auth")[0].toBuffer().copy(tokenData, 32);
    tokenData.writeBigUInt64LE(77n, 64);
    tokenData[108] = 1;
    f.accounts.set(vault.toBase58(), account(tokenData, EXTERNAL_IDS.splToken));
    expect(await findClosableVaults(f.rpc, programId)).toMatchObject([
      { vaultAmount: 77n, closable: true, payer: wallet },
    ]);
    f.getProgramAccounts.mockRejectedValue(new Error("Scan refused"));
    expect((await readVaultDeposit(f.rpc, programId, mint))?.closable).toBe(
      true,
    );
    f.getProgramAccounts.mockResolvedValue({
      context: { slot: 999 },
      value: [{ pubkey: ledger, account: ledgerInfo }],
    });
    f.accounts.set(wallet.toBase58(), {
      ...account(Buffer.alloc(0), loader),
      executable: true,
    });
    expect(await findClosableVaults(f.rpc, programId)).toEqual([]);
    f.getProgramAccounts.mockResolvedValue({
      context: { slot: 1_000 },
      value: [{ pubkey: other, account: ledgerInfo }],
    });
    await expect(findMyVaultDeposits(f.rpc, programId, wallet)).rejects.toThrow(
      "MintLedger PDA",
    );
  });
});
