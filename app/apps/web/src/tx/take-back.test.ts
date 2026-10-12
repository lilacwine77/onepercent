// @vitest-environment node
import { webDeployment } from "../data/deployment";
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type GetAccountInfoConfig } from "@solana/web3.js";
import {
  ACCOUNT_SIZES,
  SERVICES,
  RENT_TEST_RATES_LAMPORTS_PER_BYTE,
} from "@onepercent/config";
import { AccountLayout, AccountState, MintLayout } from "@solana/spl-token";
import {
  deckPda,
  deckHeaderLayout,
  DECK_FLAGS,
  encodeDeck,
  EXTERNAL_IDS,
  userAta,
  type DeckEntry,
} from "@onepercent/sdk";
import { readWalletDeck } from "../data/deck";
import {
  prepareTakeBack,
  projectedTakeBackRefunds,
  reconcileTakeBack,
  type TakeBackRpc,
} from "./take-back";

const PROGRAM_ID = webDeployment().programId;
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const owner = key(1),
  mint = key(2);
const rent = (size: number, rate: number) =>
  (size + ACCOUNT_SIZES.accountOverhead) * rate;
const info = (data: Buffer, program = PROGRAM_ID, lamports = 50000000) => ({
  data,
  owner: program,
  executable: false,
  lamports,
  rentEpoch: 0,
});
const entry: DeckEntry = {
  depositor: owner,
  mint,
  amount: 100n,
  deposit: 0,
  flags: 1,
  _pad: new Uint8Array(3),
};
function setup(rate: number, initial?: DeckEntry[]) {
  const calls: number[] = [];
  const state = {
    entries: initial ?? [{ ...entry, deposit: ACCOUNT_SIZES.deckEntry * rate }],
    ataAmount: null as bigint | null,
    walletLamports: 50000000,
  };
  let cachedEntries: DeckEntry[] | undefined;
  let cachedDeck: Buffer;
  const deck = () => {
    if (cachedEntries === state.entries) return cachedDeck;
    cachedEntries = state.entries;
    return (cachedDeck = encodeDeck({
      version: 1,
      bump: deckPda(PROGRAM_ID)[1],
      entries: state.entries,
    }));
  };
  const mintData = Buffer.alloc(MintLayout.span);
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
    mintData,
  );
  const ata = userAta(owner, mint, EXTERNAL_IDS.splToken);
  const rpc: TakeBackRpc = {
    getAccountInfoAndContext: async (_address, config) => {
      const slice = (config as GetAccountInfoConfig).dataSlice!;
      const data = deck();
      return {
        context: { slot: 20 },
        value: info(
          data.subarray(slice.offset, slice.offset + slice.length),
          PROGRAM_ID,
          rent(data.length, rate),
        ),
      };
    },
    getAccountInfo: async (address) => {
      if (address.equals(owner))
        return info(Buffer.alloc(0), PublicKey.default, state.walletLamports);
      if (address.equals(mint)) return info(mintData, EXTERNAL_IDS.splToken);
      if (!address.equals(ata) || state.ataAmount === null) return null;
      const data = Buffer.alloc(AccountLayout.span);
      AccountLayout.encode(
        {
          mint,
          owner,
          amount: state.ataAmount,
          delegateOption: 0,
          delegate: PublicKey.default,
          state: AccountState.Initialized,
          isNativeOption: 0,
          isNative: 0n,
          delegatedAmount: 0n,
          closeAuthorityOption: 0,
          closeAuthority: PublicKey.default,
        },
        data,
      );
      return info(data, EXTERNAL_IDS.splToken);
    },
    getMinimumBalanceForRentExemption: async (size) => rent(size, rate),
    getFeeForMessage: async () => ({ context: { slot: 20 }, value: 5000 }),
  };
  for (const name of Object.keys(rpc) as (keyof TakeBackRpc)[]) {
    const original = rpc[name];
    Object.assign(rpc, {
      [name]: (...args: never[]) => {
        calls.push(Date.now());
        return (original as (...args: never[]) => unknown)(...args);
      },
    });
  }
  return { rpc, state, calls };
}
describe("take-back preparation and reconciliation", () => {
  it("prepares an intact owner entry while unrelated Deck counters change on every read", async () => {
    const { rpc, state } = setup(6960);
    state.entries.push({
      ...entry,
      depositor: key(7),
      mint: key(8),
      deposit: 0,
    });
    const originalRead = rpc.getAccountInfoAndContext;
    let reads = 0;
    rpc.getAccountInfoAndContext = async (address, options) => {
      const result = await originalRead(address, options);
      reads++;
      if (
        (options as GetAccountInfoConfig).dataSlice?.offset === 0 &&
        result.value
      ) {
        result.value.data = deckHeaderLayout.encode({
          ...deckHeaderLayout.decode(result.value.data),
          total_fed: BigInt(reads),
        });
      }
      return result;
    };
    const snapshot = await readWalletDeck(rpc, owner);
    expect(snapshot.complete).toBe(false);
    const beforePreparation = reads;
    const prepared = await prepareTakeBack(rpc, {
      wallet: owner,
      blockhash: key(5).toBase58(),
      entries: snapshot.entries,
    });
    expect(prepared.batches).toHaveLength(1);
    expect(prepared.batches[0]!.entries).toEqual(snapshot.entries);
    expect(prepared.missing).toEqual([]);
    expect(reads - beforePreparation).toBe(3);
  });

  it.each(RENT_TEST_RATES_LAMPORTS_PER_BYTE)(
    "builds from chain and calculates deposits at rent %i",
    async (rate) => {
      const { rpc } = setup(rate);
      const snapshot = await readWalletDeck(rpc, owner);
      const result = await prepareTakeBack(rpc, {
        wallet: owner,
        blockhash: key(5).toBase58(),
        entries: snapshot.entries,
      });
      expect(result.batches).toHaveLength(1);
      expect(result.batches[0]!.refundLamports).toBe(
        BigInt(ACCOUNT_SIZES.deckEntry * rate),
      );
      expect(result.batches[0]!.ataRentLamports).toBe(
        BigInt(rent(ACCOUNT_SIZES.vaultSpl, rate)),
      );
      expect(result.batches[0]!.payeeRent.ready).toBe(true);
    },
  );
  it("recognizes moved entries and distinguishes a Pull from an ATA credit", async () => {
    const { rpc, state } = setup(6960);
    const snapshot = await readWalletDeck(rpc, owner);
    const result = await prepareTakeBack(rpc, {
      wallet: owner,
      blockhash: key(5).toBase58(),
      entries: snapshot.entries,
    });
    const batch = result.batches[0]!;
    expect(await reconcileTakeBack(rpc, owner, batch)).toBe("pending");
    state.entries = [];
    expect(await reconcileTakeBack(rpc, owner, batch)).toBe("pulled");
    state.ataAmount = 100n;
    expect(await reconcileTakeBack(rpc, owner, batch)).toBe("landed");
  });
  it("applies the rent-increase refund floor and D17 before a wallet prompt", async () => {
    const { rpc, state } = setup(6960);
    const snapshot = await readWalletDeck(rpc, owner);
    const low = { ...snapshot, lamports: 0n };
    expect([
      ...(await projectedTakeBackRefunds(rpc, low, snapshot.entries)).values(),
    ]).toEqual([0n]);
    state.walletLamports = 1;
    await expect(
      prepareTakeBack(rpc, {
        wallet: owner,
        blockhash: key(5).toBase58(),
        entries: snapshot.entries,
      }),
    ).rejects.toThrow("payeeBelowRent");
  });
});

afterEach(() => vi.useRealTimers());
describe("large Deck exit RPC budget", () => {
  it.each([true, false])(
    "120000 entries: display and three preparations, API available=%s",
    async (available) => {
      vi.useFakeTimers();
      const foreign = { ...entry, depositor: key(9) };
      const target = { ...entry, deposit: ACCOUNT_SIZES.deckEntry * 6960 };
      const { rpc, calls } = setup(6960, [
        ...Array<DeckEntry>(119999).fill(foreign),
        target,
      ]);
      const hint = {
        asOfSlot: 20,
        deckIndex: 119999,
        mint: mint.toBase58(),
        amount: "100",
        deposit: String(target.deposit),
        fresh: Boolean(target.flags & DECK_FLAGS.fresh),
        refed: false,
      };
      const loadHints = vi.fn(async () => {
        if (!available) throw Error("API offline");
        return { asOfSlot: 20, deck: [hint] };
      });
      const execute = async () => {
        const snapshot = await readWalletDeck(rpc, owner, { loadHints });
        expect(snapshot.entries).toHaveLength(1);
        const discoveryCalls = calls.length;
        for (let i = 0; i < 3; i++) {
          const prepared = await prepareTakeBack(rpc, {
            wallet: owner,
            blockhash: key(5).toBase58(),
            entries: snapshot.entries,
            loadDeckHints: loadHints,
          });
          expect(prepared.batches).toHaveLength(1);
          expect(prepared.batches[0]!.entries[0]!.deckIndex).toBe(119999);
        }
        // Polling while the API is still unavailable reuses the verified discovery.
        await readWalletDeck(rpc, owner, { loadHints });
        expect(calls.length - discoveryCalls).toBeLessThan(50);
        expect(calls.length).toBeLessThan(available ? 50 : 220);
        if (!available)
          expect(calls.at(-1)! - calls[0]!).toBeGreaterThan(25_000);
        for (const at of calls)
          expect(
            calls.filter((t) => t >= at && t < at + 60_000).length,
          ).toBeLessThan(SERVICES.api.rpcPerMinutePerIp);
      };
      const running = execute();
      await vi.runAllTimersAsync();
      await running;
    },
  );
});
