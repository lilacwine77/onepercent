// @vitest-environment node
import { webDeployment } from "./deployment";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  type AccountInfo,
  type GetAccountInfoConfig,
} from "@solana/web3.js";
import { Buffer } from "node:buffer";
import { ACCOUNT_SIZES, COVERAGE } from "@onepercent/config";
import { WEB } from "@onepercent/config/web";
import { MeResponse } from "@onepercent/sdk/api";
import {
  deckEntryLayout,
  deckHeaderLayout,
  deckPda,
  encodeDeck,
  type DeckEntry,
} from "@onepercent/sdk";
import {
  readWalletDeck,
  readDeckSelection,
  resolveDeckEntries,
  type DeckHints,
  type DeckRpc,
} from "./deck";
import { api } from "./api";

const PROGRAM_ID = webDeployment().programId;
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const wallet = key(2);
const entry = (mint = key(3)): DeckEntry => ({
  depositor: wallet,
  mint,
  amount: 20n,
  deposit: 40,
  flags: 1,
  _pad: new Uint8Array(3),
});
function reader(data: () => Buffer, owner = PROGRAM_ID) {
  return {
    getAccountInfoAndContext: async (
      _: PublicKey,
      config: GetAccountInfoConfig,
    ) => {
      const { offset, length } = config.dataSlice!;
      const value: AccountInfo<Buffer> = {
        owner,
        data: data().subarray(offset, offset + length),
        executable: false,
        lamports: 9000000,
        rentEpoch: 0,
      };
      return { context: { slot: 20 }, value };
    },
  } as DeckRpc;
}
const encode = (entries: DeckEntry[]) =>
  encodeDeck({ entries, version: 1, bump: deckPda(PROGRAM_ID)[1] });
afterEach(() => vi.useRealTimers());
describe("authoritative Deck reads", () => {
  it("discovers exits without a mirror and ignores other owners", async () => {
    const all = [
      entry(),
      { ...entry(key(4)), depositor: key(6) },
      entry(key(5)),
    ];
    const result = await readWalletDeck(
      reader(() => encode(all)),
      wallet,
    );
    expect(result.entries.map((entry) => entry.deckIndex)).toEqual([0, 2]);
    expect(result.entries.map((entry) => entry.amount)).toEqual([20n, 20n]);
  });
  it("rejects forged owners and incomplete range reads", async () => {
    await expect(
      readWalletDeck(
        reader(() => encode([entry()]), key(99)),
        wallet,
      ),
    ).rejects.toThrow("Unexpected Deck");
    const encoded = encode([entry()]);
    await expect(
      readWalletDeck(
        reader(() => encoded.subarray(0, ACCOUNT_SIZES.deckHeader)),
        wallet,
      ),
    ).rejects.toThrow("changed");
  });
  it("retries a swap-remove and resolves the moved entry by identity", async () => {
    const target = entry(key(5));
    let headers = 0;
    const rpc = reader(() => {
      headers++;
      return headers <= 2 ? encode([entry(), target]) : encode([target]);
    });
    const result = await readWalletDeck(rpc, wallet);
    expect(result.entries).toHaveLength(1);
    const previous = { ...target, deckIndex: 1, id: "old" };
    expect(
      resolveDeckEntries([previous], result.entries).entries[0]?.deckIndex,
    ).toBe(0);
  });
  it("does not reuse one current entry for duplicate requests", async () => {
    const result = await readWalletDeck(
      reader(() => encode([entry()])),
      wallet,
    );
    const original = result.entries[0]!;
    const found = resolveDeckEntries(
      [original, { ...original, id: "other" }],
      result.entries,
    );
    expect(found.entries).toHaveLength(1);
    expect(found.missing).toHaveLength(1);
  });
});

it("verifies API indices and falls back for forged or stale hints", async () => {
  const target = entry();
  const rpc = reader(() => encode([target]));
  const loadHints = vi.fn(async () => ({
    asOfSlot: 20,
    deck: [
      {
        asOfSlot: 20,
        deckIndex: 0,
        mint: key(99).toBase58(),
        amount: "20",
        deposit: "40",
        fresh: true,
        refed: false,
      },
    ],
  }));
  const snapshot = await readWalletDeck(rpc, wallet, { loadHints });
  expect(snapshot.entries[0]!.mint.equals(target.mint)).toBe(true);
  const selected = await readDeckSelection(rpc, wallet, snapshot.entries);
  expect(selected.entries).toEqual(snapshot.entries);
});
it("does not treat incomplete API hints as proof that an exit is absent", async () => {
  const target = { ...entry(), deckIndex: 5, id: "previous" };
  const rpc = reader(() => encode([entry()]));
  const found = await readDeckSelection(rpc, wallet, [target], async () => ({
    asOfSlot: 20,
    deck: [],
  }));
  expect(
    resolveDeckEntries([target], found.entries).entries[0]!.deckIndex,
  ).toBe(0);
});
it("coalesces concurrent fallback discovery", async () => {
  const rpc = reader(() => encode([entry()]));
  const read = vi.spyOn(rpc, "getAccountInfoAndContext");
  const [a, b] = await Promise.all([
    readWalletDeck(rpc, wallet),
    readWalletDeck(rpc, wallet),
  ]);
  expect(a).toBe(b);
  expect(read).toHaveBeenCalledTimes(3);
});

it("preserves a later caller's slot bound when a scan starts during its API wait", async () => {
  let rejectHints!: (error: Error) => void;
  const hints = new Promise<DeckHints>((_, reject) => {
    rejectHints = reject;
  });
  let rangeEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    rangeEntered = resolve;
  });
  let releaseRange!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseRange = resolve;
  });
  const base = reader(() => encode([entry()]));
  const read = vi.fn<DeckRpc["getAccountInfoAndContext"]>(
    async (address, options) => {
      const config = options as GetAccountInfoConfig;
      const result = await base.getAccountInfoAndContext(address, config);
      const slot = Math.max(10, config.minContextSlot ?? 0);
      if (config.dataSlice!.offset > 0) {
        rangeEntered();
        await released;
      }
      return { ...result, context: { slot } };
    },
  );
  const rpc: DeckRpc = { getAccountInfoAndContext: read };
  const loadHints = vi.fn(() => hints);
  const later = readWalletDeck(rpc, wallet, {
    minContextSlot: 20,
    loadHints,
  });
  const earlier = readWalletDeck(rpc, wallet, { minContextSlot: 10 });
  await entered;
  rejectHints(new Error("API offline"));
  // The delayed caller joins the running scan before its range read completes.
  await Promise.resolve();
  releaseRange();
  const [oldSnapshot, freshSnapshot] = await Promise.all([earlier, later]);
  expect(oldSnapshot.slot).toBe(10);
  expect(freshSnapshot.slot).toBe(20);
  expect(freshSnapshot.entries).toEqual(oldSnapshot.entries);
  expect(loadHints).toHaveBeenCalledTimes(1);
  // An unchanged complete scan needs only a fresh header at the stricter bound.
  expect(read).toHaveBeenCalledTimes(4);
  expect(read.mock.calls.at(-1)![1]).toMatchObject({
    minContextSlot: 20,
    dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
  });
});

it("discovers omitted exits when an incomplete API goes offline", async () => {
  const rpc = reader(() => encode([entry(), entry(key(5))]));
  const hints = {
    asOfSlot: 20,
    deck: [
      {
        asOfSlot: 20,
        deckIndex: 0,
        mint: key(3).toBase58(),
        amount: "20",
        deposit: "40",
        fresh: true,
        refed: false,
      },
    ],
  };
  expect(
    (await readWalletDeck(rpc, wallet, { loadHints: async () => hints }))
      .entries,
  ).toHaveLength(1);
  expect(
    (
      await readWalletDeck(rpc, wallet, {
        loadHints: async () => {
          throw Error("offline");
        },
      })
    ).entries,
  ).toHaveLength(2);
});
it("does not hide exits behind an empty API mirror", async () => {
  const rpc = reader(() => encode([entry()]));
  expect(
    (
      await readWalletDeck(rpc, wallet, {
        loadHints: async () => ({ asOfSlot: 20, deck: [] }),
      })
    ).entries,
  ).toHaveLength(1);
});

it("finds and prepares an intact entry in a 120000-entry Deck changing every ten seconds", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const ownerIndex = Math.floor(COVERAGE.deckMax / 2);
  const data = encode(
    Array<DeckEntry>(COVERAGE.deckMax).fill({ ...entry(), depositor: key(9) }),
  );
  deckEntryLayout.write(
    data,
    ACCOUNT_SIZES.deckHeader + ownerIndex * ACCOUNT_SIZES.deckEntry,
    entry(),
  );
  const originalHeader = deckHeaderLayout.decode(data);
  let changeEveryRead = false;
  let changes = 0;
  const read = vi.fn<DeckRpc["getAccountInfoAndContext"]>(
    async (_address, options) => {
      const config = options as GetAccountInfoConfig;
      changes = changeEveryRead ? changes + 1 : Math.floor(Date.now() / 10000);
      deckHeaderLayout
        .encode({ ...originalHeader, total_fed: BigInt(changes) })
        .copy(data);
      const slice = config.dataSlice!;
      return {
        context: {
          slot: Math.max(config.minContextSlot ?? 0, Date.now() + 20),
        },
        value: {
          owner: PROGRAM_ID,
          executable: false,
          lamports: 9000000,
          rentEpoch: 0,
          data: Buffer.from(
            data.subarray(slice.offset, slice.offset + slice.length),
          ),
        },
      };
    },
  );
  const rpc: DeckRpc = { getAccountInfoAndContext: read };
  const discovery = readWalletDeck(rpc, wallet, {
    loadHints: async () => {
      throw new Error("API unavailable");
    },
  });
  await vi.runAllTimersAsync();
  const snapshot = await discovery;
  expect(changes).toBeGreaterThanOrEqual(2);
  expect(snapshot.entries.map((found) => found.deckIndex)).toEqual([
    ownerIndex,
  ]);
  expect(snapshot.complete).toBe(false);

  // Even an unrelated mutation between every requested-index read must not
  // veto the owner's intact entry or restart a full discovery.
  changeEveryRead = true;
  read.mockClear();
  const preparation = readDeckSelection(rpc, wallet, snapshot.entries);
  await vi.runAllTimersAsync();
  expect((await preparation).entries).toEqual(snapshot.entries);
  expect(read).toHaveBeenCalledTimes(3);
  expect(read.mock.calls[1]![1]).toMatchObject({
    dataSlice: { length: ACCOUNT_SIZES.deckEntry },
  });

  read.mockClear();
  const polling = readWalletDeck(rpc, wallet);
  await vi.runAllTimersAsync();
  expect((await polling).entries).toEqual(snapshot.entries);
  expect(read).toHaveBeenCalledTimes(3);
  expect((await polling).complete).toBe(false);
});

it("never uses a mixed scan or its cache as proof of a missing entry", async () => {
  vi.useFakeTimers();
  let changes = 0;
  let active = true;
  const rpc = reader(() =>
    encodeDeck({
      entries: [entry(), { ...entry(key(7)), depositor: key(9) }],
      version: 1,
      bump: deckPda(PROGRAM_ID)[1],
      total_fed: BigInt(active ? ++changes : changes),
    }),
  );
  const missing = { ...entry(key(8)), deckIndex: 2, id: "missing" };
  const rejected = expect(
    readDeckSelection(rpc, wallet, [missing]),
  ).rejects.toThrow("Deck entry absence unavailable");
  await vi.runAllTimersAsync();
  await rejected;

  active = false;
  const cached = readWalletDeck(rpc, wallet);
  await vi.runAllTimersAsync();
  expect((await cached).complete).toBe(false);
  const proven = readDeckSelection(rpc, wallet, [missing]);
  await vi.runAllTimersAsync();
  const snapshot = await proven;
  expect(snapshot.complete).toBe(true);
  expect(resolveDeckEntries([missing], snapshot.entries).missing).toEqual([
    missing,
  ]);
});

it("propagates cancellation without starting another fallback", async () => {
  const aborted = new Error("Read cancelled");
  aborted.name = "AbortError";
  const rpc = reader(() => encode([entry()]));
  const read = vi.spyOn(rpc, "getAccountInfoAndContext");
  await expect(
    readWalletDeck(rpc, wallet, {
      loadHints: async () => {
        throw aborted;
      },
    }),
  ).rejects.toBe(aborted);
  expect(read).not.toHaveBeenCalled();
  read.mockRejectedValue(aborted);
  await expect(readWalletDeck(rpc, wallet)).rejects.toBe(aborted);
  expect(read).toHaveBeenCalledOnce();
});

it("automatically discovers owner entries after a real API request times out", async () => {
  vi.useFakeTimers();
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => new Promise(() => {}));
  const rpc = reader(() => encode([entry()]));
  const read = vi.spyOn(rpc, "getAccountInfoAndContext");
  try {
    const discovery = readWalletDeck(rpc, wallet, {
      loadHints: () => api(`/api/me/${wallet.toBase58()}`, MeResponse),
    });
    const assertion = expect(discovery).resolves.toMatchObject({
      entries: [{ deckIndex: 0, mint: entry().mint, amount: 20n }],
    });
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
    await vi.runAllTimersAsync();
    await assertion;
    expect(read).toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});

it("resolves a moved entry automatically when the real API request times out", async () => {
  vi.useFakeTimers();
  const target = entry();
  let data = encode([{ ...entry(key(7)), depositor: key(9) }, target]);
  const rpc = reader(() => data);
  const initial = readWalletDeck(rpc, wallet);
  await vi.runAllTimersAsync();
  const before = await initial;
  expect(before.entries[0]!.deckIndex).toBe(1);
  data = encode([target]);
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => new Promise(() => {}));
  try {
    const selection = readDeckSelection(rpc, wallet, before.entries, () =>
      api(`/api/me/${wallet.toBase58()}`, MeResponse),
    );
    const assertion = expect(selection).resolves.toMatchObject({
      entries: [{ deckIndex: 0, mint: target.mint, amount: target.amount }],
    });
    await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
    await vi.runAllTimersAsync();
    await assertion;
    expect(
      resolveDeckEntries(before.entries, (await selection).entries).missing,
    ).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});

it("does not start discovery when the real API request is deliberately cancelled", async () => {
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => new Promise(() => {}));
  const rpc = reader(() => encode([entry()]));
  const read = vi.spyOn(rpc, "getAccountInfoAndContext");
  const controller = new AbortController();
  try {
    const discovery = readWalletDeck(rpc, wallet, {
      loadHints: () =>
        api(`/api/me/${wallet.toBase58()}`, MeResponse, {
          signal: controller.signal,
        }),
    });
    controller.abort();
    await expect(discovery).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});

it("retains a verified owner entry from a last range shortened by another exit", async () => {
  const target = entry();
  const other = { ...entry(key(7)), depositor: key(9) };
  let reads = 0;
  const rpc = reader(() =>
    encode(++reads === 1 ? [target, other, other] : [target, other]),
  );
  const snapshot = await readWalletDeck(rpc, wallet);
  expect(snapshot.entries.map((found) => found.deckIndex)).toEqual([0]);
  expect(snapshot.complete).toBe(false);
});
