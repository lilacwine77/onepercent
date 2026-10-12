// @vitest-environment node
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  type Connection,
  type GetAccountInfoConfig,
  type SignatureStatus,
} from "@solana/web3.js";
import { AccountLayout, AccountState, MintLayout } from "@solana/spl-token";
import type { WalletAccount } from "@wallet-standard/base";
import {
  ACCOUNT_SIZES,
  RENT_TEST_RATES_LAMPORTS_PER_BYTE,
} from "@onepercent/config";
import {
  deckPda,
  encodeDeck,
  EXTERNAL_IDS,
  IDL,
  userAta,
  type DeckEntry,
} from "@onepercent/sdk";
import { MeResponse } from "@onepercent/sdk/api";
import { api } from "../data/api";
import { readWalletDeck, type ChainDeckEntry } from "../data/deck";
import { webDeployment } from "../data/deployment";
import { base58 } from "../util/bytes";
import type { SupportedWallet } from "../wallet/capabilities";
import { runTakeBack } from "./run-take-back";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Advance the real reader's range pacing while preserving promise rejections.
async function finish<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

function harness(ambiguous: boolean) {
  const signer = Keypair.generate();
  const owner = signer.publicKey;
  const mint = Keypair.generate().publicKey;
  const programId = webDeployment().programId;
  const rate = RENT_TEST_RATES_LAMPORTS_PER_BYTE[0]!;
  const rent = (size: number) => (size + ACCOUNT_SIZES.accountOverhead) * rate;
  const a: DeckEntry = {
    depositor: owner,
    mint,
    amount: 100n,
    deposit: ACCOUNT_SIZES.deckEntry * rate,
    flags: 1,
    _pad: new Uint8Array(3),
  };
  // B credits more of the same mint than A. Its balance cannot prove A landed.
  const b = { ...a, amount: 200n, deposit: a.deposit * 2 };
  const foreign = { ...a, depositor: Keypair.generate().publicKey };
  const state = {
    entries: [a, foreign, b],
    ataAmount: null as bigint | null,
    active: false,
    headers: [] as bigint[],
    signed: [] as { amount: bigint; index: number; signature: string }[],
  };
  const fetchOffline = vi.fn(async (url: string | URL | Request) => {
    expect(url).toBe(`/api/me/${owner.toBase58()}`);
    throw new TypeError("API offline");
  });
  vi.stubGlobal("fetch", fetchOffline);
  const loadDeckHints = vi.fn(() =>
    api(`/api/me/${owner.toBase58()}`, MeResponse),
  );
  const info = (
    data: Buffer,
    accountOwner = programId,
    lamports = 50_000_000,
  ) => ({
    data,
    owner: accountOwner,
    executable: false,
    lamports,
    rentEpoch: 0,
  });
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
  let slot = 100;
  let counter = 0n;
  let hashes = 0;
  let unavailableStatus = ambiguous;
  let firstError: NonNullable<SignatureStatus["err"]> | null = null;
  const statuses = new Map<string, SignatureStatus | null>();
  const getTransaction = vi.fn(async (signature: string) => {
    expect(signature).toBe(state.signed[0]!.signature);
    return {
      slot,
      meta: {
        err: firstError,
        logMessages: [
          "Program log: AnchorError. Error Code: CardMoved.",
          `Program ${programId} failed: custom program error`,
        ],
      },
    };
  });
  const getSignatureStatuses = vi.fn(async (signatures: string[]) => {
    if (unavailableStatus) {
      unavailableStatus = false;
      throw new Error("Signature status unavailable");
    }
    return {
      context: { slot: ++slot },
      value: signatures.map((signature) => {
        if (!statuses.has(signature)) throw new Error("Unexpected signature");
        return statuses.get(signature)!;
      }),
    };
  });
  const rpc = {
    getAccountInfoAndContext: vi.fn(
      async (address: PublicKey, options: GetAccountInfoConfig) => {
        expect(address.equals(deckPda(programId)[0])).toBe(true);
        const slice = options.dataSlice!;
        if (state.active && slice.offset === 0) {
          counter++;
          state.headers.push(counter);
        }
        const data = encodeDeck({
          version: 1,
          bump: deckPda(programId)[1],
          entries: state.entries,
          total_pulled: counter,
        });
        return {
          context: { slot: ++slot },
          value: info(
            data.subarray(slice.offset, slice.offset + slice.length),
            programId,
            rent(data.length),
          ),
        };
      },
    ),
    getAccountInfo: vi.fn(async (address: PublicKey) => {
      if (address.equals(owner))
        return info(Buffer.alloc(0), PublicKey.default);
      if (address.equals(mint)) return info(mintData, EXTERNAL_IDS.splToken);
      if (!address.equals(ata)) throw new Error("Unexpected account read");
      if (state.ataAmount === null) return null;
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
      return info(data, EXTERNAL_IDS.splToken, rent(data.length));
    }),
    getMinimumBalanceForRentExemption: vi.fn(async (size: number) =>
      rent(size),
    ),
    getFeeForMessage: vi.fn(async () => ({ context: { slot }, value: 5000 })),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: new PublicKey(new Uint8Array(32).fill(++hashes)).toBase58(),
      lastValidBlockHeight: 100,
    })),
    // A's ambiguous submission remains inside its validity window throughout.
    getBlockHeight: vi.fn(async () => 1),
    simulateTransaction: vi.fn(async (transaction: VersionedTransaction) => {
      expect(transaction).toBeInstanceOf(VersionedTransaction);
      return {
        context: { slot },
        value: { err: null, logs: [], unitsConsumed: 10_000 },
      };
    }),
    getSignatureStatuses,
    getTransaction,
  } as unknown as Connection;
  const signAndSendTransaction = vi.fn(
    async ({ transaction }: { transaction: Uint8Array }) => {
      const tx = VersionedTransaction.deserialize(transaction);
      const instructions = tx.message.compiledInstructions;
      const ixIndex = instructions.findIndex((ix) =>
        tx.message.staticAccountKeys[ix.programIdIndex]!.equals(programId),
      );
      const instruction = instructions[ixIndex]!;
      const data = Buffer.from(instruction.data);
      expect([...data.subarray(0, 8)]).toEqual(
        IDL.instructions.find((ix) => ix.name === "take_back")!.discriminator,
      );
      const index = data.readUInt32LE(8);
      const amount = data.readBigUInt64LE(12);
      tx.sign([signer]);
      const signature = base58(tx.signatures[0]!);
      state.signed.push({ amount, index, signature });
      if (state.signed.length === 1) {
        expect({ index, amount }).toEqual({ index: 0, amount: a.amount });
        // Pull swaps B into A's former position while the wallet is signing A.
        state.entries = [b, foreign];
        state.active = true;
        firstError = {
          InstructionError: [
            ixIndex,
            {
              Custom: IDL.errors!.find((entry) => entry.name === "CardMoved")!
                .code,
            },
          ],
        };
        statuses.set(
          signature,
          ambiguous
            ? null
            : {
                slot: ++slot,
                confirmations: null,
                confirmationStatus: "finalized",
                err: firstError,
              },
        );
      } else {
        expect({ index, amount }).toEqual({ index: 0, amount: b.amount });
        state.entries = [foreign];
        state.ataAmount = b.amount;
        statuses.set(signature, {
          slot: ++slot,
          confirmations: null,
          confirmationStatus: "finalized",
          err: null,
        });
      }
      return [{ signature: tx.signatures[0]! }];
    },
  );
  const input = (entries: readonly ChainDeckEntry[]) => ({
    rpc,
    owner,
    entries,
    price: 0n,
    account: {
      address: owner.toBase58(),
      publicKey: owner.toBytes(),
      chains: ["solana:devnet"],
      features: ["solana:signAndSendTransaction"],
    } satisfies WalletAccount,
    wallet: {
      features: {
        "solana:signAndSendTransaction": { signAndSendTransaction },
      },
    } as unknown as SupportedWallet,
    chain: "solana:devnet" as const,
    current: () => true,
    progress: vi.fn(),
    loadDeckHints,
  });
  return {
    a,
    b,
    state,
    input,
    rpc,
    owner,
    loadDeckHints,
    fetchOffline,
    getTransaction,
    signAndSendTransaction,
  };
}

describe("take-back with an unavailable API and an active Deck", () => {
  it("keeps finalized CardMoved definitive, then withdraws B after its index changes", async () => {
    const h = harness(false);
    const initial = await finish(
      readWalletDeck(h.rpc, h.owner, { loadHints: h.loadDeckHints }),
    );
    expect(initial.entries.map((entry) => entry.deckIndex)).toEqual([0, 2]);
    const [a, b] = initial.entries;
    const failed = await finish(runTakeBack(h.input([a!])));
    expect(failed.result.phase).toBe("failed");
    expect(failed.result.copyKey).toBe("errors.cardMoved");
    expect(failed.result.pending).toEqual([]);
    expect(failed.result.unknown.size).toBe(0);
    expect(failed.landed).toBe(0);
    expect(failed.missing).toEqual([]);
    expect(failed.pulled).toBe(0);
    expect(h.signAndSendTransaction).toHaveBeenCalledOnce();
    expect(h.getTransaction).toHaveBeenCalledOnce();

    const withdrawn = await finish(runTakeBack(h.input([b!])));
    expect(withdrawn.result.phase).toBe("done");
    expect(withdrawn.result.pending).toEqual([]);
    expect(withdrawn.result.unknown.size).toBe(0);
    expect(withdrawn.landed).toBe(1);
    expect(withdrawn.missing).toEqual([]);
    expect(h.state.ataAmount).toBe(h.b.amount);
    expect(
      h.state.signed.map(({ amount, index }) => ({ amount, index })),
    ).toEqual([
      { amount: h.a.amount, index: 0 },
      { amount: h.b.amount, index: 0 },
    ]);
    expect(h.fetchOffline).toHaveBeenCalled();
    expect(h.state.headers.length).toBeGreaterThan(2);
    expect(new Set(h.state.headers).size).toBe(h.state.headers.length);
  });

  it("allows B while A is ambiguous, without treating B's same-mint credit as A's receipt", async () => {
    const h = harness(true);
    const initial = await finish(
      readWalletDeck(h.rpc, h.owner, { loadHints: h.loadDeckHints }),
    );
    const [a, b] = initial.entries;
    const uncertain = await finish(runTakeBack(h.input([a!])));
    expect(uncertain.result.phase).toBe("failed");
    expect(uncertain.result.pending).toHaveLength(1);
    expect(uncertain.result.pending[0]!.signature).toBe(
      h.state.signed[0]!.signature,
    );
    expect(uncertain.result.unknown.has(a!.id)).toBe(true);
    expect(uncertain.landed).toBe(0);
    expect(uncertain.missing).toEqual([]);
    expect(uncertain.pulled).toBe(0);

    const withdrawn = await finish(runTakeBack(h.input([b!])));
    expect(withdrawn.result.phase).toBe("done");
    expect(withdrawn.landed).toBe(1);
    expect(h.state.ataAmount).toBeGreaterThan(h.a.amount);
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(2);
    const overlap = expect(
      finish(runTakeBack(h.input([a!]))),
    ).rejects.toThrow();
    await overlap;
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(2);
    expect(h.getTransaction).not.toHaveBeenCalled();
    expect(await h.rpc.getBlockHeight("finalized")).toBeLessThan(
      uncertain.result.pending[0]!.validity.lastValidBlockHeight,
    );
  });
});
