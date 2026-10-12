import {
  ComputeBudgetProgram,
  Keypair,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { buildMergeTransactions as buildMerge } from "@onepercent/sdk";
import type { MergeMint, MergeSource } from "@onepercent/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// PARAMS §16.3 fixture checks the canonical M1 compiled config exports.
const { compiledConfig, config } = vi.hoisted(() => {
  const config = {
    BPS_DENOMINATOR: 10_000,
    TX_LIMITS: { maxTxBytes: 1_232, byteHeadroomBps: 1_500 },
  };
  return {
    config,
    // M1 computes static transaction budgets when its public entry loads.
    // Missing-export cases are injected only after that valid module load.
    compiledConfig: {
      values: structuredClone(config) as {
        BPS_DENOMINATOR?: number;
        TX_LIMITS?: { maxTxBytes?: number; byteHeadroomBps?: number };
      },
    },
  };
});
// The test runner preserves workspace symlinks; mock the SDK's dependency path.
vi.mock(
  "../../node_modules/@onepercent/sdk/node_modules/@onepercent/config/src/index.ts",
  async (importOriginal) => ({
    ...(await importOriginal<typeof import("@onepercent/config")>()),
    get BPS_DENOMINATOR() {
      return compiledConfig.values.BPS_DENOMINATOR;
    },
    get TX_LIMITS() {
      return compiledConfig.values.TX_LIMITS;
    },
  }),
);

const address = (value: number) =>
  new PublicKey(new Uint8Array(32).fill(value));
const walletFixture = Keypair.fromSeed(new Uint8Array(32).fill(250));
const wallet = walletFixture.publicKey;
const byteBudget = 1_047;
const computeBudget = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000n }),
];
const buildMergeTransactions = (
  wallet: PublicKey,
  mint: MergeMint,
  sources: readonly MergeSource[],
  canonicalAta: PublicKey,
) => buildMerge(wallet, mint, sources, canonicalAta, { config });
const tokenProgram = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const token2022Program = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
const ataProgram = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const mint: MergeMint = {
  address: address(240),
  decimals: 6,
  tokenProgram,
};
function ata(forMint = mint) {
  return PublicKey.findProgramAddressSync(
    [
      wallet.toBuffer(),
      forMint.tokenProgram.toBuffer(),
      forMint.address.toBuffer(),
    ],
    ataProgram,
  )[0];
}
function source(value = 1, amount = 42n, forMint = mint): MergeSource {
  return {
    address: address(value),
    owner: wallet,
    mint: forMint.address,
    tokenProgram: forMint.tokenProgram,
    amount,
  };
}

describe("whole-bag merge transactions", () => {
  beforeEach(() => {
    compiledConfig.values = structuredClone(config);
  });

  it("matches the SPL instruction vectors and requires only the wallet", () => {
    const canonical = ata();
    const result = buildMergeTransactions(
      wallet,
      mint,
      [source(1, 9_007_199_254_740_995n), source(2)],
      canonical,
    );
    expect(result).toHaveLength(1);
    const transaction = result[0]!;
    expect(transaction.feePayer?.equals(wallet)).toBe(true);
    expect(transaction.recentBlockhash).toBeUndefined();
    expect(transaction.signatures).toEqual([]);
    const [create, first, second, closeFirst, closeSecond] =
      transaction.instructions;
    expect(create!.programId.equals(ataProgram)).toBe(true);
    expect(create!.data.toString("hex")).toBe("01");
    expect(create!.keys.map((key) => key.pubkey.toBase58())).toEqual(
      [
        wallet,
        canonical,
        wallet,
        mint.address,
        SystemProgram.programId,
        tokenProgram,
      ].map((key) => key.toBase58()),
    );
    expect(first!.programId.equals(tokenProgram)).toBe(true);
    expect(first!.data.toString("hex")).toBe("0c030000000000200006");
    expect(second!.data.toString("hex")).toBe("0c2a0000000000000006");
    expect(first!.keys.map((key) => key.pubkey.toBase58())).toEqual(
      [address(1), mint.address, canonical, wallet].map((key) =>
        key.toBase58(),
      ),
    );
    for (const [index, close] of [closeFirst!, closeSecond!].entries()) {
      expect(close.programId.equals(tokenProgram)).toBe(true);
      expect(close.data.toString("hex")).toBe("09");
      expect(close.keys.map((key) => key.pubkey.toBase58())).toEqual(
        [address(index + 1), wallet, wallet].map((key) => key.toBase58()),
      );
    }
    expect(
      transaction.instructions.flatMap((instruction) =>
        instruction.keys
          .filter((key) => key.isSigner)
          .map((key) => key.pubkey.toBase58()),
      ),
    ).toEqual(Array(5).fill(wallet.toBase58()));
    transaction.recentBlockhash = PublicKey.default.toBase58();
    transaction.sign(walletFixture);
    expect(transaction.serialize().length).toBeLessThanOrEqual(
      PACKET_DATA_SIZE,
    );
  });

  it("supports Token-2022 with its own canonical ATA and full u64 amounts", () => {
    const mint2022 = { ...mint, tokenProgram: token2022Program };
    expect(ata(mint2022).equals(ata())).toBe(false);
    const [transaction] = buildMergeTransactions(
      wallet,
      mint2022,
      [source(1, (1n << 64n) - 1n, mint2022)],
      ata(mint2022),
    );
    const [create, transfer, close] = transaction!.instructions;
    expect(create!.keys[5]!.pubkey.equals(token2022Program)).toBe(true);
    expect(transfer!.programId.equals(token2022Program)).toBe(true);
    expect(close!.programId.equals(token2022Program)).toBe(true);
    expect(transfer!.data.toString("hex")).toBe("0cffffffffffffffff06");
  });

  it("leaves the canonical account in place and emits no empty transaction", () => {
    const canonical = { ...source(), address: ata() };
    expect(buildMergeTransactions(wallet, mint, [], ata())).toEqual([]);
    expect(buildMergeTransactions(wallet, mint, [canonical], ata())).toEqual(
      [],
    );
    const [transaction] = buildMergeTransactions(
      wallet,
      mint,
      [canonical, source(2, 0n)],
      ata(),
    );
    expect(
      transaction!.instructions.map((instruction) => instruction.data[0]),
    ).toEqual([1, 12, 9]);
    expect(transaction!.instructions[1]!.data.readBigUInt64LE(1)).toBe(0n);
    expect(
      transaction!.instructions[2]!.keys[0]!.pubkey.equals(address(2)),
    ).toBe(true);
  });

  it("preserves wallet byte headroom after both compute instructions without splitting transfers from closes", () => {
    const sources = Array.from({ length: 100 }, (_, index) =>
      source(index + 1),
    );
    const transactions = buildMergeTransactions(wallet, mint, sources, ata());
    expect(transactions.length).toBeGreaterThan(1);
    const transferred: string[] = [];
    const closed: string[] = [];
    for (const transaction of transactions) {
      expect(transaction.instructions[0]!.data.toString("hex")).toBe("01");
      const transfers = transaction.instructions.filter(
        (ix) => ix.data[0] === 12,
      );
      const closes = transaction.instructions.filter((ix) => ix.data[0] === 9);
      const transferAccounts = transfers.map((ix) =>
        ix.keys[0]!.pubkey.toBase58(),
      );
      const closeAccounts = closes.map((ix) => ix.keys[0]!.pubkey.toBase58());
      expect(closeAccounts).toEqual(transferAccounts);
      transferred.push(...transferAccounts);
      closed.push(...closeAccounts);
      transaction.instructions.unshift(...computeBudget);
      transaction.recentBlockhash = PublicKey.default.toBase58();
      transaction.sign(walletFixture);
      expect(transaction.serialize().length).toBeLessThanOrEqual(byteBudget);
      expect(
        PACKET_DATA_SIZE - transaction.serialize().length,
      ).toBeGreaterThanOrEqual(PACKET_DATA_SIZE - byteBudget);
    }
    expect(transferred).toEqual(sources.map((item) => item.address.toBase58()));
    expect(closed).toEqual(transferred);
  }, 30000);

  it.each([tokenProgram, token2022Program])(
    "packs the complete signed wire image including compute settings for %s",
    (program) => {
      const forMint = { ...mint, tokenProgram: program };
      const sources = Array.from({ length: 13 }, (_, index) =>
        source(index + 1, 42n, forMint),
      );
      const transactions = buildMerge(wallet, forMint, sources, ata(forMint), {
        config,
        computeBudget,
      });
      expect(transactions).toHaveLength(2);
      const sizes: number[] = [];
      for (const transaction of transactions) {
        expect(transaction.instructions.slice(0, 2)).toEqual(computeBudget);
        expect(transaction.instructions[2]!.programId.equals(ataProgram)).toBe(
          true,
        );
        transaction.recentBlockhash = PublicKey.default.toBase58();
        transaction.sign(walletFixture);
        sizes.push(transaction.serialize().length);
      }
      expect(sizes).toEqual([1_028, 412]);
      expect(sizes.every((size) => size <= byteBudget)).toBe(true);
      // Another transfer/close pair adds 56 bytes to the full first batch.
      const combined = transactions[0]!;
      combined.instructions.push(...transactions[1]!.instructions.slice(3));
      combined.sign(walletFixture);
      expect(combined.serialize().length).toBe(1_084);
      expect(combined.serialize().length).toBeGreaterThan(byteBudget);
    },
  );

  it("reserves the missing compute instruction without emitting placeholder settings", () => {
    const [transaction] = buildMerge(wallet, mint, [source()], ata(), {
      config,
      computeBudget: [computeBudget[1]!],
    });
    const emitted = transaction!.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    );
    expect(emitted).toEqual([computeBudget[1]]);
    transaction!.instructions.unshift(computeBudget[0]!);
    transaction!.recentBlockhash = PublicKey.default.toBase58();
    transaction!.sign(walletFixture);
    expect(transaction!.serialize().length).toBeLessThanOrEqual(byteBudget);
  });

  it("uses the compiled M1 defaults for four arguments or compute-only options", () => {
    const sources = Array.from({ length: 13 }, (_, index) => source(index + 1));
    const transactions = buildMerge(wallet, mint, sources, ata());
    expect(transactions).toHaveLength(2);
    expect(transactions.map((tx) => tx.instructions.length)).toEqual([25, 3]);
    const withCompute = buildMerge(wallet, mint, sources, ata(), {
      computeBudget,
    });
    expect(withCompute.map((tx) => tx.instructions.length)).toEqual([27, 5]);
    expect(withCompute[0]!.instructions.slice(0, 2)).toEqual(computeBudget);
    // A different supplied namespace value must actually change packing.
    compiledConfig.values.TX_LIMITS = {
      maxTxBytes: 1_200,
      byteHeadroomBps: 5_000,
    };
    expect(buildMerge(wallet, mint, sources, ata())).toHaveLength(4);
  });

  it.each([
    {},
    { BPS_DENOMINATOR: config.BPS_DENOMINATOR },
    { TX_LIMITS: config.TX_LIMITS },
    {
      BPS_DENOMINATOR: config.BPS_DENOMINATOR,
      TX_LIMITS: { maxTxBytes: 1_232 },
    },
    {
      BPS_DENOMINATOR: config.BPS_DENOMINATOR,
      TX_LIMITS: { byteHeadroomBps: 1_500 },
    },
  ])(
    "fails closed when a required compiled M1 default is absent",
    (missing) => {
      compiledConfig.values = missing;
      expect(() => buildMerge(wallet, mint, [source()], ata())).toThrow(
        /config unavailable/,
      );
      expect(
        buildMergeTransactions(wallet, mint, [source()], ata()),
      ).toHaveLength(1);
    },
  );

  it("refuses invalid budgets", () => {
    expect(() =>
      buildMerge(wallet, mint, [source()], ata(), {
        config: {
          ...config,
          TX_LIMITS: { ...config.TX_LIMITS, byteHeadroomBps: 10_000 },
        },
      }),
    ).toThrow(/Invalid merge transaction budget/);
    expect(() =>
      buildMerge(wallet, mint, [source()], ata(), {
        config: {
          ...config,
          TX_LIMITS: { ...config.TX_LIMITS, maxTxBytes: 1_233 },
        },
      }),
    ).toThrow(/Invalid merge transaction budget/);
    expect(() =>
      buildMerge(wallet, mint, [source()], ata(), {
        config: {
          ...config,
          TX_LIMITS: { ...config.TX_LIMITS, maxTxBytes: 100 },
        },
      }),
    ).toThrow(/byte limit/);
  });

  it("accepts only one limit and one price instruction in the compute prefix", () => {
    for (const prefix of [
      [computeBudget[0]!, computeBudget[0]!],
      [
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: address(8),
          lamports: 1,
        }),
      ],
      [ComputeBudgetProgram.requestHeapFrame({ bytes: 32_768 })],
    ]) {
      expect(() =>
        buildMerge(wallet, mint, [source()], ata(), {
          config,
          computeBudget: prefix,
        }),
      ).toThrow(/Invalid merge compute budget instructions/);
    }
  });

  it.each([
    ["owner", { owner: address(7) }, /not owned/],
    ["mint", { mint: address(7) }, /different mint/],
    [
      "token program",
      { tokenProgram: token2022Program },
      /different token program/,
    ],
    ["close authority", { closeAuthority: address(7) }, /cannot close/],
    ["negative amount", { amount: -1n }, /outside u64/],
    ["overflow amount", { amount: 1n << 64n }, /outside u64/],
  ])("refuses invalid source %s", (_name, override, error) => {
    expect(() =>
      buildMergeTransactions(
        wallet,
        mint,
        [{ ...source(), ...override }],
        ata(),
      ),
    ).toThrow(error);
  });

  it("refuses a destination that is not the canonical ATA", () => {
    expect(() =>
      buildMergeTransactions(wallet, mint, [source()], address(5)),
    ).toThrow(/canonical ATA/);
  });

  it("refuses duplicate accounts, aggregate u64 overflow and invalid mint data", () => {
    expect(() =>
      buildMergeTransactions(wallet, mint, [source(), source()], ata()),
    ).toThrow(/Duplicate/);
    expect(() =>
      buildMergeTransactions(
        wallet,
        mint,
        [source(1, (1n << 64n) - 1n), source(2)],
        ata(),
      ),
    ).toThrow(/Merged amount/);
    expect(() =>
      buildMergeTransactions(
        wallet,
        { ...mint, decimals: 1.5 },
        [source()],
        ata(),
      ),
    ).toThrow(/decimals/);
    expect(() =>
      buildMergeTransactions(
        wallet,
        { ...mint, tokenProgram: address(9) },
        [source()],
        ata(),
      ),
    ).toThrow(/Unsupported token program/);
  });
});
