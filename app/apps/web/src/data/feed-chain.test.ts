// @vitest-environment node
import { webDeployment } from "./deployment";
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import { AccountLayout, AccountState, MintLayout } from "@solana/spl-token";
import {
  ACCOUNT_SIZES,
  RENT_TEST_RATES_LAMPORTS_PER_BYTE,
} from "@onepercent/config";
import {
  binderPda,
  bondingCurvePda,
  configPda,
  encodeBinder,
  encodeConfig,
  encodeMachine,
  EXTERNAL_IDS,
  machinePda,
  PHASE,
} from "@onepercent/sdk";
import {
  feedDepositCost,
  feedIsOpen,
  readFeedCore,
  readFeedRent,
  readWalletInventory,
  type ChainBag,
  type FeedChainRpc,
} from "./feed-chain";
import { readFeedWallet } from "./feed";

const PROGRAM_ID = webDeployment().programId;
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const wallet = key(7),
  mint = key(8),
  source = key(9);
const info = (
  data: Buffer,
  owner = PROGRAM_ID,
  lamports = 5000000,
): AccountInfo<Buffer> => ({
  data,
  owner,
  executable: false,
  lamports,
  rentEpoch: 0,
});
const rpc = (methods: object) => methods as FeedChainRpc;
function token(
  amount: bigint,
  closeAuthority = PublicKey.default,
  frozen = false,
) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner: wallet,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: frozen ? AccountState.Frozen : AccountState.Initialized,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: closeAuthority.equals(PublicKey.default) ? 0 : 1,
      closeAuthority,
    },
    data,
  );
  return info(data, EXTERNAL_IDS.splToken);
}
function tokenMint() {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 100000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return info(data, EXTERNAL_IDS.splToken);
}
describe("live Feed chain reads", () => {
  it("prepares wallet inventory and rent within the proxy concurrency capacity", async () => {
    let active = 0;
    let peak = 0;
    async function admitted<T>(value: T) {
      if (active >= 2) throw new Error("RPC capacity reached");
      active++;
      peak = Math.max(peak, active);
      try {
        await Promise.resolve();
        await Promise.resolve();
        return value;
      } finally {
        active--;
      }
    }
    const client = {
      getMultipleAccountsInfoAndContext: () =>
        admitted({
          context: { slot: 50 },
          value: [
            info(
              encodeConfig({
                version: 1,
                bump: configPda(PROGRAM_ID)[1],
              }),
            ),
            info(
              encodeMachine({
                version: 1,
                bump: machinePda(PROGRAM_ID)[1],
              }),
            ),
            null,
          ],
        }),
      getBlockTime: () => admitted(1000),
      getTokenAccountsByOwner: () =>
        admitted({ context: { slot: 50 }, value: [] }),
      getMinimumBalanceForRentExemption: (size: number) =>
        admitted(
          (size + ACCOUNT_SIZES.accountOverhead) *
            RENT_TEST_RATES_LAMPORTS_PER_BYTE[0]!,
        ),
    } as unknown as Connection;
    const snapshot = await readFeedWallet(client, wallet);
    expect(snapshot.core?.slot).toBe(50);
    expect(snapshot.inventory.bags).toEqual([]);
    expect(snapshot.rent.deckEntry).toBe(
      BigInt(ACCOUNT_SIZES.deckEntry * RENT_TEST_RATES_LAMPORTS_PER_BYTE[0]!),
    );
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });
  it("validates program identities and accepts donated uninitialized Binders", async () => {
    const config = info(
      encodeConfig({
        version: 1,
        bump: configPda(PROGRAM_ID)[1],
        season_set: 1,
      }),
    );
    const machine = info(
      encodeMachine({
        version: 1,
        bump: machinePda(PROGRAM_ID)[1],
        phase: PHASE.stockUp,
      }),
    );
    const method = vi.fn(async () => ({
      context: { slot: 50 },
      value: [
        config,
        machine,
        info(Buffer.alloc(0), SystemProgram.programId, 10),
      ],
    }));
    const client = rpc({
      getMultipleAccountsInfoAndContext: method,
      getBlockTime: async () => 1000,
    });
    const core = await readFeedCore(client, wallet);
    expect(core?.binder).toBeNull();
    expect(core?.binderLamports).toBe(10n);
    expect(feedIsOpen(core!)).toBe(true);
    config.owner = key(44);
    await expect(readFeedCore(client, wallet)).rejects.toThrow(
      "Unexpected program account",
    );
  });
  it("rejects a Binder for another wallet and unavailable cluster time", async () => {
    const values = [
      info(encodeConfig({ version: 1, bump: configPda(PROGRAM_ID)[1] })),
      info(encodeMachine({ version: 1, bump: machinePda(PROGRAM_ID)[1] })),
      info(
        encodeBinder({
          owner: key(55),
          bump: binderPda(PROGRAM_ID, wallet)[1],
        }),
      ),
    ];
    const client = rpc({
      getMultipleAccountsInfoAndContext: async () => ({
        context: { slot: 50 },
        value: values,
      }),
      getBlockTime: async () => null,
    });
    await expect(readFeedCore(client, wallet)).rejects.toThrow("identity");
    values.pop();
    values.push(
      info(
        encodeBinder({ owner: wallet, bump: binderPda(PROGRAM_ID, wallet)[1] }),
      ),
    );
    await expect(readFeedCore(client, wallet)).rejects.toThrow("Cluster time");
  });
  it.each(RENT_TEST_RATES_LAMPORTS_PER_BYTE)(
    "derives every deposit from the RPC schedule at %i",
    async (rate) => {
      const rentRpc = {
        getMinimumBalanceForRentExemption: vi.fn(
          async (size: number) => (size + ACCOUNT_SIZES.accountOverhead) * rate,
        ),
      };
      const rent = await readFeedRent(rentRpc);
      expect(rent.deckEntry).toBe(BigInt(ACCOUNT_SIZES.deckEntry * rate));
      const bag = {
        ledger: null,
        ledgerLamports: 17n,
        vaultExists: false,
        vaultLamports: 21n,
        sourceExists: false,
        tokenProgram: EXTERNAL_IDS.splToken,
      } as ChainBag;
      const cost = feedDepositCost([bag], false, rent, 5n);
      expect(cost.total).toBe(
        rent.deckEntry +
          rent.binder -
          5n +
          rent.mintLedger -
          17n +
          rent.vaultSpl -
          21n,
      );
      expect(cost.mergeAtas).toBe(rent.vaultSpl);
    },
  );
  it("keeps the whole noncanonical bag and excludes unsafe empty-account closes", async () => {
    const tokens = [
      { pubkey: source, account: token(30n) },
      { pubkey: key(10), account: token(70n) },
      { pubkey: key(11), account: token(0n) },
      { pubkey: key(12), account: token(0n, key(13)) },
      { pubkey: key(14), account: token(0n, PublicKey.default, true) },
    ];
    const curve = bondingCurvePda(mint)[0];
    const accounts = new Map([
      [mint.toBase58(), tokenMint()],
      [
        curve.toBase58(),
        info(Buffer.from("17b7f83760d8ac60", "hex"), EXTERNAL_IDS.pumpFun),
      ],
    ]);
    const client = rpc({
      getTokenAccountsByOwner: async (
        _: PublicKey,
        filter: { programId: PublicKey },
      ) => ({
        context: { slot: 60 },
        value: filter.programId.equals(EXTERNAL_IDS.splToken) ? tokens : [],
      }),
      getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({
        context: { slot: 60 },
        value: keys.map((key) => accounts.get(key.toBase58()) ?? null),
      }),
    });
    const result = await readWalletInventory(client, wallet);
    expect(result.bags[0]?.amount).toBe(100n);
    expect(result.bags[0]?.sourceExists).toBe(false);
    expect(result.bags[0]?.accounts).toHaveLength(5);
    expect(result.bags[0]?.feedable).toBe(false);
    expect(
      result.emptyAccounts.map((account) => account.address.toBase58()),
    ).toEqual([key(11).toBase58()]);
  });
});
