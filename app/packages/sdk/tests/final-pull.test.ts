import { Buffer } from "buffer";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { CU_LIMITS, TX_LIMITS } from "@onepercent/config";
import { describe, expect, it } from "vitest";
import {
  binderPda,
  buildClaimFinalSolTransaction,
  buildClaimFinalTokensTransaction,
  buildFinalClaimsTransaction,
  buildStartFinalPullTransaction,
  BUCKET_NONE,
  claimFinalSolIx,
  claimFinalTokensIx,
  composeExecTransaction,
  decodeMachine,
  encodeMachine,
  EXEC_KIND,
  execBeginIx,
  execEndIx,
  EXTERNAL_IDS,
  FINAL_CLAIM_FLAGS,
  finalShare,
  finalShares,
  machinePda,
  PHASE,
  serializedSize,
  SIZES,
  startFinalPullIx,
} from "../src/index.js";
import { U64_MAX, discriminator } from "../src/bytes.js";
import { DEPLOYMENT, PROGRAM_ID } from "./program-id.js";
import { vectors } from "./vectors.js";

const key = (value: number) => new PublicKey(new Uint8Array(32).fill(value));
const owner = key(21);
const payer = key(22);
const options = { wallet: owner, blockhash: key(23).toBase58() };
const state = (value: Parameters<typeof encodeMachine>[0] = {}) =>
  decodeMachine(encodeMachine(value));

describe("Final Pull share parity and existing account layout", () => {
  it("matches the Rust golden floor and u64-edge cases", () => {
    const cases = vectors<
      {
        input: { pool: string; spend: string; total: string };
        output: string;
      }[]
    >("final_pull");
    expect(cases.length).toBeGreaterThanOrEqual(100);
    for (const { input, output } of cases)
      expect(
        finalShare(
          BigInt(input.pool),
          BigInt(input.spend),
          BigInt(input.total),
        ).toString(),
      ).toBe(output);
  });

  it("floors shares, preserves remainders and handles zero shares", () => {
    expect(
      finalShare(1_000_000_000_000n, 4_200_000_000n, 4_980_000_000_000n),
    ).toBe(843_373_493n);
    expect(
      finalShare(43_000_000_000_000n, 4_200_000_000n, 4_980_000_000_000n),
    ).toBe(36_265_060_240n);
    expect(finalShare(0n, 1n, 1n)).toBe(0n);
    expect(finalShare(10n, 0n, 100n)).toBe(0n);
    expect(finalShare(10n, 1n, 0n)).toBe(0n);
    expect(finalShare(10n, 1n, 100n)).toBe(0n);
    expect(finalShare(U64_MAX, U64_MAX, U64_MAX)).toBe(U64_MAX);
    expect(finalShare(U64_MAX, U64_MAX, 1n)).toBe(U64_MAX);
    const shares = [1n, 2n, 3n].map((spend) => finalShare(100n, spend, 6n));
    expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(99n);
    expect(() => finalShare(-1n, 1n, 1n)).toThrow(RangeError);
    expect(() => finalShare(1n, U64_MAX + 1n, 1n)).toThrow(RangeError);
  });

  it("reads final totals from the existing 3808-byte Machine and caps every remaining pool", () => {
    const bytes = encodeMachine({
      phase: PHASE.finalPull,
      final_sol_total: 100n,
      final_pool_sol: 17n,
      final_1pct_total: 10_000n,
      final_pool_1pct: 1_234n,
      total_spend: 100n,
      buckets: Array.from({ length: 16 }, (_, index) => ({
        class: index === 3 ? 0 : 1,
        enabled: 0,
        final_pool: 1_000n,
        amount: 99n,
      })),
    });
    expect(bytes.length).toBe(3_808);
    expect(SIZES.config).toBe(872);
    expect(bytes.readBigUInt64LE(2640)).toBe(100n);
    expect(bytes.readBigUInt64LE(2648)).toBe(10_000n);
    const machine = decodeMachine(bytes);
    const binder = { season_spend: 50n, flags: 0 };
    const result = finalShares(machine, binder);
    expect(result.sol).toBe(17n);
    expect(result.onePct).toBe(1_234n);
    expect(result.buckets).toHaveLength(16);
    expect(result.buckets).toEqual(
      Array.from({ length: 16 }, (_, i) => (i === 3 ? 0n : 99n)),
    );
    expect(
      finalShares(machine, { ...binder, flags: FINAL_CLAIM_FLAGS.sol }).sol,
    ).toBe(0n);
    const claimed = finalShares(machine, {
      ...binder,
      flags: FINAL_CLAIM_FLAGS.tokens,
    });
    expect(claimed.sol).toBe(17n);
    expect(claimed.onePct).toBe(0n);
    expect(claimed.buckets.every((value) => value === 0n)).toBe(true);
    expect(finalShares(state(), { season_spend: 0n, flags: 0 })).toEqual({
      sol: 0n,
      onePct: 0n,
      buckets: Array<bigint>(16).fill(0n),
    });
  });
});

describe("Final Pull instruction builders", () => {
  it("uses the exact permissionless start accounts without Config or signer", () => {
    const ix = startFinalPullIx(PROGRAM_ID);
    expect(ix.data).toEqual(discriminator("global", "start_final_pull"));
    expect(ix.keys).toEqual([
      { pubkey: machinePda(PROGRAM_ID)[0], isSigner: false, isWritable: true },
    ]);
  });

  it("pays the canonical Binder owner with the reserved and executable payee overrides", () => {
    for (const [payee, ownerWritable, writable] of [
      [owner, undefined, true],
      [owner, false, false],
      [SYSVAR_CLOCK_PUBKEY, true, false],
      [SystemProgram.programId, undefined, false],
    ] as const) {
      const ix = claimFinalSolIx(PROGRAM_ID, { owner: payee, ownerWritable });
      expect(ix.data).toEqual(discriminator("global", "claim_final_sol"));
      expect(ix.keys.map((meta) => meta.pubkey)).toEqual([
        machinePda(PROGRAM_ID)[0],
        binderPda(PROGRAM_ID, payee)[0],
        payee,
      ]);
      expect(ix.keys.map((meta) => meta.isWritable)).toEqual([
        true,
        true,
        writable,
      ]);
      expect(ix.keys.every((meta) => !meta.isSigner)).toBe(true);
    }
  });

  it("requires only the owner signature to create Final cards", () => {
    const ix = claimFinalTokensIx(PROGRAM_ID, { owner });
    expect(ix.data).toEqual(discriminator("global", "claim_final_tokens"));
    expect(ix.keys.map((meta) => meta.pubkey)).toEqual([
      owner,
      machinePda(PROGRAM_ID)[0],
      binderPda(PROGRAM_ID, owner)[0],
      SystemProgram.programId,
    ]);
    expect(ix.keys.map((meta) => meta.isSigner)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(ix.keys.map((meta) => meta.isWritable)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("builds both zero-share-compatible claims with their measured compute budgets", () => {
    const tx = buildFinalClaimsTransaction(PROGRAM_ID, options) as Transaction;
    expect(tx.instructions[0]!.programId).toEqual(
      ComputeBudgetProgram.programId,
    );
    expect(tx.instructions[0]!.data.readUInt32LE(1)).toBe(
      CU_LIMITS.claimFinalSol.x1 + CU_LIMITS.claimFinalTokens,
    );
    expect(tx.instructions.slice(1).map((ix) => ix.data)).toEqual([
      discriminator("global", "claim_final_sol"),
      discriminator("global", "claim_final_tokens"),
    ]);
    expect(tx.compileMessage().header.numRequiredSignatures).toBe(1);
    expect(serializedSize(tx)).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
    for (const builder of [
      buildStartFinalPullTransaction,
      buildClaimFinalSolTransaction,
      buildClaimFinalTokensTransaction,
    ])
      expect(serializedSize(builder(PROGRAM_ID, options))).toBeLessThanOrEqual(
        TX_LIMITS.maxTxBytes,
      );
    expect(
      (
        buildFinalClaimsTransaction(PROGRAM_ID, {
          ...options,
          computeBudget: false,
          sol: false,
        }) as Transaction
      ).instructions,
    ).toHaveLength(1);
    expect(
      (
        buildFinalClaimsTransaction(PROGRAM_ID, {
          ...options,
          computeBudget: false,
          tokens: false,
        }) as Transaction
      ).instructions,
    ).toHaveLength(1);
    expect(() =>
      buildFinalClaimsTransaction(PROGRAM_ID, {
        ...options,
        sol: false,
        tokens: false,
      }),
    ).toThrow("Select at least one");
  });

  it("allows any fee payer to push SOL without an owner signature", () => {
    const tx = buildClaimFinalSolTransaction(PROGRAM_ID, {
      ...options,
      wallet: payer,
      owner,
    }) as Transaction;
    const message = tx.compileMessage();
    expect(message.header.numRequiredSignatures).toBe(1);
    expect(message.accountKeys[0]).toEqual(payer);
    expect(tx.instructions.at(-1)!.keys[2]!.pubkey).toEqual(owner);
    expect(tx.instructions.at(-1)!.keys[2]!.isSigner).toBe(false);
  });

  it("keeps the existing atomic Burn builders available for a caller after Done", () => {
    const mint = key(31);
    const input = {
      signer: owner,
      kind: EXEC_KIND.burn,
      mint,
      tokenProgram: EXTERNAL_IDS.splToken,
    };
    const beginIx = execBeginIx(PROGRAM_ID, {
      ...input,
      bucket: BUCKET_NONE,
      amount: 50_000_000n,
      oracles: [key(41), key(42), key(43), key(44)],
    });
    const endIx = execEndIx(PROGRAM_ID, input);
    const protocolLut = new AddressLookupTableAccount({
      key: key(32),
      state: {
        deactivationSlot: U64_MAX,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [],
      },
    });
    const built = composeExecTransaction({
      deployment: DEPLOYMENT,
      payer: owner,
      restoreTokenVault: true,
      beginIx,
      endIx,
      swap: {
        setup: [],
        swap: new TransactionInstruction({
          programId: key(33),
          keys: [],
          data: Buffer.alloc(0),
        }),
        cleanup: [],
        lookupTables: [],
      },
      computeBudget: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: CU_LIMITS.execBegin + CU_LIMITS.execEnd,
        }),
      ],
      protocolLut,
      blockhash: options.blockhash,
    });
    expect(built.transaction).toBeInstanceOf(VersionedTransaction);
    expect(built.transaction.message.header.numRequiredSignatures).toBe(1);
    expect(built.transaction.message.staticAccountKeys[0]).toEqual(owner);
    expect(built.serializedSize).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
  });
});
