import { PROGRAM_ID } from "../../../sdk/tests/program-id.js";
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  type AccountInfo,
} from "@solana/web3.js";
import { ACCOUNT_SIZES, SEASON, TX_LIMITS, VRF } from "@onepercent/config";
import { EXTERNAL_IDS } from "../../../sdk/src/constants.js";
import {
  configLayout,
  encodeBinder,
  encodeDeck,
  encodePull,
  machineLayout,
  mintLedgerLayout,
} from "../../../sdk/src/layouts.js";
import { serializedSize } from "../../../sdk/src/tx/index.js";
import {
  GET_EVERYTHING_BACK_ORDER,
  planEverythingBackStage,
  planAdvancePhase,
  planCloseBinder,
  planCloseVaults,
  planRedeem,
  planRefund,
  planSettle,
  planTakeBack,
  planWithdrawOwed,
  phaseCrankState,
  rescuePda,
  type RescueRpc,
} from "../../../sdk/src/rescue/compose.js";
import { connectRescue } from "./runtime.js";
import { sendRescueTransaction } from "./send.js";

const key = (value: number) => new PublicKey(new Uint8Array(32).fill(value));
const wallet = key(1);
const other = key(2);
const mint = key(3);
const blockhash = key(4).toBase58();
const sysvar = new PublicKey("Sysvar1111111111111111111111111111111111111");

function fixtures(programId = PROGRAM_ID) {
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const put = (
    address: PublicKey,
    data: Buffer = Buffer.alloc(0),
    owner = programId,
    lamports = 10_000_000,
    executable = false,
  ) =>
    accounts.set(address.toBase58(), {
      data,
      owner,
      lamports,
      executable,
      rentEpoch: 0,
    });
  const get = (
    address: PublicKey,
    slice?: { offset: number; length: number },
  ) => {
    const info = accounts.get(address.toBase58()) ?? null;
    return info && slice
      ? {
          ...info,
          data: info.data.subarray(slice.offset, slice.offset + slice.length),
        }
      : info;
  };
  const rpc = {
    getAccountInfoAndContext: vi.fn(
      async (
        address: PublicKey,
        config?: { dataSlice?: { offset: number; length: number } },
      ) => ({ context: { slot: 10 }, value: get(address, config?.dataSlice) }),
    ),
    getMultipleAccountsInfoAndContext: vi.fn(
      async (addresses: PublicKey[]) => ({
        context: { slot: 10 },
        value: addresses.map((address) => get(address)),
      }),
    ),
    getProgramAccounts: vi.fn(async () => {
      throw new Error("Program scans disabled");
    }),
  } as unknown as RescueRpc;
  put(wallet, Buffer.alloc(0), SystemProgram.programId, 10_000_000_000);
  put(other, Buffer.alloc(0), SystemProgram.programId);
  const mintData = Buffer.alloc(82);
  mintData[44] = 6;
  mintData[45] = 1;
  put(mint, mintData, EXTERNAL_IDS.splToken);
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(1000n, 32);
  put(SYSVAR_CLOCK_PUBKEY, clock, sysvar);
  const rent = Buffer.alloc(17);
  rent.writeBigUInt64LE(3480n, 0);
  rent.writeDoubleLE(2, 8);
  put(SYSVAR_RENT_PUBKEY, rent, sysvar);
  const [binderAddress, binderBump] = rescuePda(programId, "binder", [
    wallet.toBuffer(),
  ]);
  const binder = (
    cards: Parameters<typeof encodeBinder>[0]["cards"] = [],
    extra = {},
  ) =>
    put(
      binderAddress,
      encodeBinder({ owner: wallet, bump: binderBump, cards, ...extra }),
    );
  const [deckAddress, deckBump] = rescuePda(programId, "deck");
  const deck = (
    entries: Parameters<typeof encodeDeck>[0]["entries"],
    lamports = 100_000_000,
  ) =>
    put(
      deckAddress,
      encodeDeck({ entries, bump: deckBump, version: 1 }),
      programId,
      lamports,
    );
  const pull = (overrides: Parameters<typeof encodePull>[0] = {}) => {
    const nonce = overrides.buyer_nonce ?? 0;
    const seed = Buffer.alloc(4);
    seed.writeUInt32LE(nonce);
    const [address, bump] = rescuePda(programId, "pull", [
      wallet.toBuffer(),
      seed,
    ]);
    put(
      address,
      encodePull({
        buyer: wallet,
        buyer_nonce: nonce,
        bump,
        version: 1,
        status: 2,
        seq: 123n,
        qty: 1,
        edition: 0,
        packs: [{ house_mask: 15 }],
        ...overrides,
      }),
    );
    return address;
  };
  return {
    rpc,
    accounts,
    put,
    binder,
    binderAddress,
    deck,
    pull,
    options: { rpc, programId: programId, wallet, blockhash },
  };
}

describe("M1 rescue planning from RPC accounts", () => {
  it("plans and previews take-back using only the supplied RPC while every API is unavailable", async () => {
    const f = fixtures();
    f.deck([
      { depositor: wallet, mint, amount: 1n, flags: 1, deposit: 556_800 },
      { depositor: other, mint, amount: 2n, flags: 1, deposit: 556_800 },
      { depositor: wallet, mint, amount: 3n, flags: 2, deposit: 556_800 },
    ]);
    const rpcUrl = "http://127.0.0.1:18899/personal-rpc";
    const methods: string[] = [];
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url) !== rpcUrl) throw new Error("API unavailable");
        const request = JSON.parse(String(init?.body)) as {
          id: string;
          method: string;
          params: unknown[];
        };
        methods.push(request.method);
        const config = request.params[1] as
          { dataSlice?: { offset: number; length: number } } | undefined;
        const read = (address: string) => {
          const info = f.accounts.get(address);
          if (!info) return null;
          const slice = config?.dataSlice;
          const data = slice
            ? info.data.subarray(slice.offset, slice.offset + slice.length)
            : info.data;
          return {
            ...info,
            owner: info.owner.toBase58(),
            data: [data.toString("base64"), "base64"],
          };
        };
        let value: unknown;
        if (request.method === "getAccountInfo")
          value = read(request.params[0] as string);
        else if (request.method === "getMultipleAccounts")
          value = (request.params[0] as string[]).map(read);
        else if (request.method === "simulateTransaction")
          value = { err: null, logs: [], unitsConsumed: 10_000 };
        else throw new Error(`Unexpected RPC method ${request.method}`);
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: { context: { slot: 10 }, value },
        });
      });
    try {
      const rpc = connectRescue(rpcUrl);
      const plan = await planTakeBack({ ...f.options, rpc });
      expect(plan.transactions.flatMap((item) => item.indices)).toEqual([2, 0]);
      expect(plan.remaining).toEqual([]);
      const emit = vi.fn();
      const confirm = vi.fn(async () => false);
      for (const item of plan.transactions)
        await expect(
          sendRescueTransaction(
            {
              programId: PROGRAM_ID,
              rpc,
              dryRun: true,
              unsigned: false,
              yes: false,
              emit,
              confirm,
            },
            item,
            100,
          ),
        ).resolves.toEqual({ state: "preview" });
      expect(confirm).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "take-back",
          simulation: expect.objectContaining({ ok: true }),
        }),
      );
      expect(new Set(methods)).toEqual(
        new Set([
          "getAccountInfo",
          "getMultipleAccounts",
          "simulateTransaction",
        ]),
      );
      expect(
        transport.mock.calls.every(([url]) => String(url) === rpcUrl),
      ).toBe(true);
    } finally {
      transport.mockRestore();
    }
  });

  it("builds rescue exits for a caller-selected deployment", async () => {
    const selected = key(99);
    const f = fixtures(selected);
    f.binder([{ mint, amount: 1n, kind: 1 }]);
    const plan = await planRedeem(f.options);
    expect(plan.transactions).toHaveLength(1);
    const tx = plan.transactions[0]!.transaction as Transaction;
    const ix = tx.instructions.find((item) => item.programId.equals(selected));
    expect(ix).toBeDefined();
    expect(ix!.keys[1]!.pubkey.equals(f.binderAddress)).toBe(true);
    expect(
      tx.instructions.some((item) => item.programId.equals(PROGRAM_ID)),
    ).toBe(false);
  });

  it("builds every card kind in descending, size-bounded batches and re-reads changed selections", async () => {
    const f = fixtures();
    f.binder(
      Array.from({ length: 19 }, (_, index) => ({
        mint,
        amount: BigInt(index + 1),
        kind: index % 9,
      })),
    );
    const plan = await planRedeem(f.options);
    expect(plan.transactions.flatMap((tx) => tx.indices)).toEqual(
      Array.from({ length: 19 }, (_, index) => 18 - index),
    );
    for (const tx of plan.transactions) {
      expect(tx.indices!.length).toBeLessThanOrEqual(TX_LIMITS.redeemPerTx);
      expect(serializedSize(tx.transaction)).toBeLessThanOrEqual(
        TX_LIMITS.maxTxBytes,
      );
      expect(tx.slot).toBe(10);
    }
    f.binder([{ mint, amount: 2n, kind: 8 }]);
    const changed = await planRedeem({
      ...f.options,
      indices: [0],
      expected: [
        {
          cardIndex: 0,
          mint,
          amount: 1n,
          kind: 0,
          edition: 0,
          flags: 0,
          value: 0n,
          seq_lo: 0,
          _pad: 0,
        },
      ],
    });
    expect(changed.transactions).toHaveLength(0);
    expect(changed.remaining[0]!.reason).toContain("CardMoved");
    const appeared = await planRedeem({
      ...f.options,
      indices: [0],
      expected: [],
    });
    expect(appeared.transactions).toHaveLength(0);
    expect(appeared.remaining[0]!.reason).toContain("CardMoved");
    const changedKind = await planRedeem({
      ...f.options,
      indices: [0],
      expected: [
        {
          cardIndex: 0,
          mint,
          amount: 2n,
          kind: 0,
          edition: 0,
          flags: 0,
          value: 100n,
          seq_lo: 0,
          _pad: 0,
        },
      ],
    });
    expect(changedKind.transactions).toHaveLength(0);
    expect(changedKind.remaining[0]!.reason).toContain("CardMoved");
  });

  it("takes back only the owner's FRESH and REFED entries with descending indices", async () => {
    const f = fixtures();
    f.deck(
      Array.from({ length: 20 }, (_, index) => ({
        depositor: index % 2 ? wallet : other,
        mint,
        amount: 1n,
        flags: index % 3 ? 1 : 2,
        deposit: 556_800,
      })),
    );
    const plan = await planTakeBack(f.options);
    expect(plan.transactions.flatMap((tx) => tx.indices)).toEqual([
      19, 17, 15, 13, 11, 9, 7, 5, 3, 1,
    ]);
    for (const tx of plan.transactions) {
      expect(tx.indices!.length).toBeLessThanOrEqual(TX_LIMITS.takeBackPerTx);
      expect(serializedSize(tx.transaction)).toBeLessThanOrEqual(
        TX_LIMITS.maxTxBytes,
      );
    }
    expect(f.rpc.getProgramAccounts).not.toHaveBeenCalled();
    const appeared = await planTakeBack({
      ...f.options,
      indices: [1],
      expected: [],
    });
    expect(appeared.transactions).toHaveLength(0);
    expect(appeared.remaining[0]!.reason).toContain("CardMoved");
    const changedRefund = await planTakeBack({
      ...f.options,
      indices: [1],
      expected: [{ deckIndex: 1, mint, amount: 1n, flags: 2, deposit: 1 }],
    });
    expect(changedRefund.transactions).toHaveLength(0);
    expect(changedRefund.remaining[0]!.reason).toContain("CardMoved");
  });

  it("prechecks TakeBack using current Rent and does not block a zero refund", async () => {
    const f = fixtures();
    f.put(wallet, Buffer.alloc(0), SystemProgram.programId, 1);
    f.deck([{ depositor: wallet, mint, amount: 1n, flags: 2, deposit: 10 }]);
    const fail = await planTakeBack(f.options);
    expect(fail.transactions).toHaveLength(0);
    expect(fail.remaining[0]!.reason).toContain("PayeeBelowRent");
    f.deck([{ depositor: wallet, mint, amount: 1n, flags: 2, deposit: 10 }], 1);
    expect((await planTakeBack(f.options)).transactions).toHaveLength(1);
  });

  it("settles with A14/D20 writability, House placeholders and closed depositor Binders", async () => {
    const f = fixtures();
    const executable = key(9);
    f.put(
      executable,
      Buffer.alloc(36),
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      1_000_000,
      true,
    );
    f.put(wallet, Buffer.alloc(0), SystemProgram.programId, 0);
    const address = f.pull({
      referrer: SYSVAR_RENT_PUBKEY,
      qty: 2,
      packs: [
        {
          house_mask: 12,
          fresh_mask: 3,
          royalties: [{ depositor: other }, { depositor: executable }, {}, {}],
        },
        { house_mask: 15 },
      ],
    });
    const plan = await planSettle({ ...f.options, pulls: [address, address] });
    expect(plan.transactions.flatMap((tx) => tx.indices)).toEqual([0, 1]);
    for (const tx of plan.transactions)
      expect(serializedSize(tx.transaction)).toBeLessThanOrEqual(
        TX_LIMITS.maxTxBytes,
      );
    const first = (
      plan.transactions[0]!.transaction as Transaction
    ).instructions.find((ix) => ix.programId.equals(PROGRAM_ID))!;
    expect(first.keys[2]!.isWritable).toBe(true);
    expect(first.keys[3]!.pubkey.equals(SYSVAR_RENT_PUBKEY)).toBe(true);
    expect(first.keys[3]!.isWritable).toBe(false);
    expect(first.keys[4]!.isWritable).toBe(true);
    expect(first.keys[5]!.isWritable).toBe(false);
    expect(
      first.keys[8]!.pubkey.equals(
        rescuePda(PROGRAM_ID, "binder", [other.toBuffer()])[0],
      ),
    ).toBe(true);
    expect(first.keys[8]!.isWritable).toBe(true);
  });

  it("refunds at the chain-clock boundary regardless of the operating system clock", async () => {
    const f = fixtures();
    const address = f.pull({
      status: 1,
      created_ts: 1000n - BigInt(VRF.timeoutSeconds) + 1n,
    });
    const localClock = vi
      .spyOn(Date, "now")
      .mockReturnValue(99_999_999_999_999);
    try {
      expect(
        (await planRefund({ ...f.options, pulls: [address] })).remaining[0]!
          .reason,
      ).toContain("TooEarlyToRefund");
      f.pull({ status: 1, created_ts: 1000n - BigInt(VRF.timeoutSeconds) });
      expect(
        (await planRefund({ ...f.options, pulls: [address] })).transactions,
      ).toHaveLength(1);
    } finally {
      localClock.mockRestore();
    }
    expect(f.rpc.getProgramAccounts).not.toHaveBeenCalled();
  });

  it("keeps per-wallet exits available after program scans are refused and exposes future extension points", async () => {
    const f = fixtures();
    f.binder([], { pull_nonce: 1 });
    f.pull();
    const plan = await planEverythingBackStage(f.options, "settle");
    expect(plan.transactions).toHaveLength(1);
    expect(plan.remaining[0]!.reason).toContain("rpc_scan_refused");
    expect(GET_EVERYTHING_BACK_ORDER).toEqual([
      "refund",
      "settle",
      "final-claims",
      "redeem",
      "take-back",
      "withdraw-owed",
      "close-binder",
      "close-vault",
    ]);
    const extension = vi.fn(async () => ({ transactions: [], remaining: [] }));
    await planEverythingBackStage(f.options, "final-claims", {
      "final-claims": extension,
    });
    expect(extension).toHaveBeenCalledOnce();
    // The Binder exits are built in: no extension is needed for them any more.
    const close = await planEverythingBackStage(f.options, "close-binder");
    expect(close.transactions.map((row) => row.action)).toEqual([
      "close-binder",
    ]);
    expect(await planEverythingBackStage(f.options, "withdraw-owed")).toEqual({
      transactions: [],
      remaining: [],
    });
  });

  it("closes only empty unlisted vaults and returns rent to the recorded payer", async () => {
    const f = fixtures();
    const [machine, machineBump] = rescuePda(PROGRAM_ID, "machine");
    f.put(machine, machineLayout.encode({ bump: machineBump, version: 1 }));
    const [ledger] = rescuePda(PROGRAM_ID, "ledger", [mint.toBuffer()]);
    const ledgerData = mintLedgerLayout.encode({
      mint,
      payer: other,
      accounted: 0n,
    });
    f.put(ledger, ledgerData);
    const { vaultAta, vaultAuthPda } = await import("../../../sdk/src/pda.js");
    const vault = vaultAta(PROGRAM_ID, mint, EXTERNAL_IDS.splToken);
    const token = Buffer.alloc(165);
    mint.toBuffer().copy(token, 0);
    vaultAuthPda(PROGRAM_ID)[0].toBuffer().copy(token, 32);
    token[108] = 1;
    f.put(vault, token, EXTERNAL_IDS.splToken);
    vi.mocked(f.rpc.getProgramAccounts).mockResolvedValue({
      context: { slot: 10 },
      value: [{ pubkey: ledger, account: f.accounts.get(ledger.toBase58())! }],
    } as never);
    const plan = await planCloseVaults(f.options);
    expect(plan.transactions).toHaveLength(1);
    const ix = (plan.transactions[0]!.transaction as Transaction)
      .instructions[0]!;
    expect(ix.keys[5]!.pubkey.equals(other)).toBe(true);
    expect(ix.keys[1]!.isWritable).toBe(true);
    expect(
      serializedSize(plan.transactions[0]!.transaction),
    ).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
    expect(ACCOUNT_SIZES.mintLedger).toBe(ledgerData.length);
    vi.mocked(f.rpc.getProgramAccounts).mockClear();
    const direct = await planCloseVaults({ ...f.options, mints: [mint] });
    expect(direct.transactions).toHaveLength(1);
    expect(f.rpc.getProgramAccounts).not.toHaveBeenCalled();
    const raisedRent = Buffer.alloc(17);
    raisedRent.writeBigUInt64LE(1_000_000n, 0);
    raisedRent.writeDoubleLE(2, 8);
    f.put(SYSVAR_RENT_PUBKEY, raisedRent, sysvar);
    const underRent = await planCloseVaults({ ...f.options, mints: [mint] });
    expect(underRent.transactions).toHaveLength(0);
    expect(underRent.remaining[0]!.reason).toContain("PayeeBelowRent");
    f.accounts.delete(ledger.toBase58());
    expect(await planCloseVaults({ ...f.options, mints: [mint] })).toEqual({
      transactions: [],
      remaining: [],
    });
  });
});

function instructionOf(plan: Awaited<ReturnType<typeof planWithdrawOwed>>) {
  const ixs = (plan.transactions[0]!.transaction as Transaction).instructions;
  return ixs.find((ix) => ix.programId.equals(PROGRAM_ID))!;
}

describe("Binder exits and the phase crank from RPC accounts", () => {
  it("withdraws owed SOL up to the Binder's balance above its rent", async () => {
    const f = fixtures();
    expect(await planWithdrawOwed(f.options)).toEqual({
      transactions: [],
      remaining: [],
    });
    f.binder([], { sol_owed: 1_000n });
    const plan = await planWithdrawOwed(f.options);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]!.details).toEqual([
      { amount: 1_000n, recipient: wallet },
    ]);
    const ix = instructionOf(plan);
    expect(ix.keys.map((key) => key.pubkey.toBase58())).toEqual([
      wallet.toBase58(),
      f.binderAddress.toBase58(),
    ]);
    expect(ix.keys[0]!.isSigner && ix.keys[1]!.isWritable).toBe(true);
    const binder = f.accounts.get(f.binderAddress.toBase58())!;
    // Rent sysvar fixture: (size + 128) * 3480 * 2 lamports.
    const rent = BigInt((binder.data.length + 128) * 3480 * 2);
    f.put(f.binderAddress, binder.data, PROGRAM_ID, Number(rent) + 400);
    expect(
      (await planWithdrawOwed(f.options)).transactions[0]!.details,
    ).toEqual([{ amount: 400n, recipient: wallet }]);
    f.put(f.binderAddress, binder.data, PROGRAM_ID, Number(rent));
    const unfunded = await planWithdrawOwed(f.options);
    expect(unfunded.transactions).toHaveLength(0);
    expect(unfunded.remaining[0]!.reason).toContain("nothing above its rent");
    expect(f.rpc.getProgramAccounts).not.toHaveBeenCalled();
  });

  it("closes My cards only when close_binder's checks pass, keeping the Final Pull precondition", async () => {
    const f = fixtures();
    expect(await planCloseBinder(f.options)).toEqual({
      transactions: [],
      remaining: [],
    });
    const blocked = async (
      extra: object,
      cards: { mint: PublicKey; amount: bigint; kind: number }[] = [],
    ) => {
      f.binder(cards, extra);
      const plan = await planCloseBinder(f.options);
      expect(plan.transactions).toHaveLength(0);
      return plan.remaining[0]!.reason;
    };
    expect(await blocked({}, [{ mint, amount: 1n, kind: 0 }])).toContain(
      "BinderNotEmpty: Redeem",
    );
    expect(await blocked({ fresh_in_deck: 2 })).toContain("FRESH");
    expect(await blocked({ sol_owed: 1n })).toContain("owed SOL");
    expect(await blocked({ reserved: 1 })).toContain("PullPending");
    expect(await blocked({ season_spend: 5n, flags: 1 })).toContain(
      "FinalNotClaimed",
    );
    const finalClaims = await planEverythingBackStage(
      f.options,
      "final-claims",
    );
    expect(finalClaims.remaining[0]!.reason).toContain("D18");
    for (const extra of [
      { season_spend: 5n, flags: 3 },
      { season_spend: 0n },
    ]) {
      f.binder([], extra);
      const plan = await planCloseBinder(f.options);
      expect(plan.remaining).toEqual([]);
      expect(plan.transactions[0]!.action).toBe("close-binder");
      expect(
        instructionOf(plan).keys.map((key) => key.pubkey.toBase58()),
      ).toEqual([wallet.toBase58(), f.binderAddress.toBase58()]);
    }
    expect(
      (await planEverythingBackStage(f.options, "final-claims")).remaining,
    ).toEqual([]);
    expect(f.rpc.getProgramAccounts).not.toHaveBeenCalled();
  });

  it("evaluates advance_phase's transition table on chain time only", () => {
    const config = { season_set: 1, stock_up_ts: 100n };
    const machine = { phase: 0, on_air_ts: 0n, end_ts: 0n, final_ts: 0n };
    const at = (phase: number, now: bigint, extra = {}) =>
      phaseCrankState({
        config,
        machine: { ...machine, phase, ...extra },
        now,
      });
    expect(at(0, 100n)).toEqual({ due: true, from: 0, to: 1 });
    expect(at(0, 99n)).toMatchObject({ due: false, at: 100n });
    expect(
      phaseCrankState({
        config: { season_set: 0, stock_up_ts: 0n },
        machine,
        now: 10n,
      }),
    ).toMatchObject({ due: false });
    expect(at(1, 10_000n)).toMatchObject({ due: false });
    expect(at(2, 50n, { on_air_ts: 50n })).toEqual({
      due: true,
      from: 2,
      to: 3,
    });
    expect(at(2, 50n)).toMatchObject({ due: false });
    expect(at(3, 70n, { end_ts: 70n })).toEqual({ due: true, from: 3, to: 4 });
    expect(at(3, 69n, { end_ts: 70n })).toMatchObject({ due: false, at: 70n });
    const four = at(4, 10_000_000n, { end_ts: 1n });
    expect(four.due).toBe(false);
    expect("reason" in four && four.reason).toContain("D18");
    const seal = 5n + BigInt(SEASON.sealDelaySeconds);
    expect(at(5, seal, { final_ts: 5n })).toEqual({
      due: true,
      from: 5,
      to: 6,
    });
    expect(at(5, seal - 1n, { final_ts: 5n })).toMatchObject({ due: false });
    expect(at(6, 10_000_000n)).toMatchObject({ due: false });
  });

  it("plans the permissionless crank from Config, Machine and the Clock sysvar", async () => {
    const f = fixtures();
    const [config, configBump] = rescuePda(PROGRAM_ID, "config");
    const [machine, machineBump] = rescuePda(PROGRAM_ID, "machine");
    f.put(
      config,
      configLayout.encode({
        bump: configBump,
        version: 1,
        season_set: 1,
        admin_paused: 255,
        guardian_paused: 255,
      }),
    );
    const setMachine = (extra: object) =>
      f.put(
        machine,
        machineLayout.encode({ bump: machineBump, version: 1, ...extra }),
      );
    setMachine({ phase: 2, on_air_ts: 1_000n });
    const due = await planAdvancePhase(f.options);
    expect(due.remaining).toEqual([]);
    expect(due.transactions[0]).toMatchObject({
      action: "advance-phase",
      indices: [2],
      details: [{ from: 2, to: 3 }],
    });
    const ix = instructionOf(due);
    expect(
      ix.keys.map((key) => [key.pubkey.toBase58(), key.isWritable]),
    ).toEqual([
      [config.toBase58(), false],
      [machine.toBase58(), true],
    ]);
    setMachine({ phase: 2, on_air_ts: 1_001n });
    expect((await planAdvancePhase(f.options)).remaining[0]!.reason).toContain(
      "NoTransitionDue: On Air is due at chain timestamp 1001",
    );
    setMachine({ phase: 3, end_ts: 1n, exec: { kind: 1 } });
    expect((await planAdvancePhase(f.options)).remaining[0]!.reason).toContain(
      "ExecInFlight",
    );
    expect(f.rpc.getProgramAccounts).not.toHaveBeenCalled();
  });
});
