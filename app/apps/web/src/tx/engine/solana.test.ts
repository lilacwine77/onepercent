// @vitest-environment node
import { webDeployment } from "../../data/deployment";
import { describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { FEED_BYTE_BUDGET, IDL } from "@onepercent/sdk";
import { BPS_DENOMINATOR, SERVICES } from "@onepercent/config";
import { WEB } from "@onepercent/config/web";
import type { WalletAccount } from "@wallet-standard/base";
import type { SupportedWallet } from "../../wallet/capabilities";
import {
  checkBuilt,
  finalizedError,
  measuredBudget,
  messageInstructions,
  priorityFee,
  simulateBuilt,
  solanaPort,
  versioned,
  wire,
} from "./solana";
import { executePlan } from "./engine";

const PROGRAM_ID = webDeployment().programId;
const wallet = Keypair.generate().publicKey;
const blockhash = SystemProgram.programId.toBase58();
const protocol = (name: "feed" | "take_back") =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: wallet, isSigner: true, isWritable: true }],
    data: Buffer.from(
      IDL.instructions.find((instruction) => instruction.name === name)!
        .discriminator,
    ),
  });
const tx = (...instructions: TransactionInstruction[]) =>
  new Transaction({ feePayer: wallet, recentBlockhash: blockhash }).add(
    ...instructions,
  );
const simulated = (value: {
  err: unknown;
  unitsConsumed?: number;
  logs?: string[];
}) => ({
  simulateTransaction: vi.fn<
    (
      transaction: VersionedTransaction,
      options: unknown,
    ) => Promise<{ context: { slot: number }; value: typeof value }>
  >(async () => ({ context: { slot: 10 }, value })),
});

describe("Solana transaction boundary", () => {
  it("maps a finalized CardMoved through the real confirmation port and engine", async () => {
    const error = {
      InstructionError: [
        0,
        {
          Custom: IDL.errors!.find((entry) => entry.name === "CardMoved")!.code,
        },
      ],
    };
    const getTransaction = vi.fn(async () => ({
      meta: {
        err: error,
        logMessages: [
          "Program log: AnchorError. Error Code: CardMoved.",
          `Program ${PROGRAM_ID} failed: custom program error`,
        ],
      },
    }));
    const rpc = {
      getSignatureStatuses: vi.fn(async () => ({
        value: [{ confirmationStatus: "finalized", err: error }],
      })),
      getTransaction,
    } as unknown as Connection;
    const port = solanaPort({
      rpc,
      wallet: {} as SupportedWallet,
      account: {} as WalletAccount,
      owner: wallet,
      chain: "solana:devnet",
      kind: "takeBack",
    });
    const item = {
      id: "entry",
      phase: 0,
      build: () => tx(protocol("take_back")),
      landed: async () => false,
    };
    const result = await executePlan(
      [item],
      {
        ...port,
        blockhash: async () => ({ blockhash, lastValidBlockHeight: 100 }),
        blockHeight: async () => 1,
        simulate: async () => {},
        send: async () => ["signature"],
      },
      { batchSize: 1, current: () => true, progress: () => {} },
    );
    expect(result.copyKey).toBe("errors.cardMoved");
    expect(result.retry).toEqual([item]);
    expect(result.unknown.size).toBe(0);
    expect(result.pending).toEqual([]);
    expect(getTransaction).toHaveBeenCalledWith("signature", {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  });

  it("preserves the terminal error without inventing program identity or log availability", async () => {
    const error = { InstructionError: [0, { Custom: 123 }] };
    for (const meta of [
      null,
      { err: error, logMessages: null },
      {
        err: error,
        logMessages: [
          "Program log: AnchorError. Error Code: CardMoved.",
          `Program ${SystemProgram.programId} failed: custom program error`,
          `Program ${PROGRAM_ID} failed: custom program error`,
        ],
      },
      {
        err: { InstructionError: [0, "InvalidArgument"] },
        logMessages: [
          "Program log: AnchorError. Error Code: CardMoved.",
          `Program ${PROGRAM_ID} failed: custom program error`,
        ],
      },
    ]) {
      const rpc = {
        getTransaction: async () => ({ meta }),
      } as unknown as Connection;
      const mapped = await finalizedError(rpc, "signature", error);
      expect(mapped.copyKey).toBe("errors.generic");
      expect(mapped.cause).toBe(error);
    }
    const rpc = {
      getTransaction: async () => {
        throw new Error("offline");
      },
    } as unknown as Connection;
    const mapped = await finalizedError(rpc, "signature", error);
    expect(mapped.copyKey).toBe("errors.generic");
    expect(mapped.cause).toBe(error);
  });

  it.each(["feed", "takeBack"] as const)(
    "does not prompt %s after the wallet changes during final chain reads",
    async (kind) => {
      let current = true;
      const signAndSendTransaction = vi.fn();
      const port = solanaPort({
        rpc: {} as Connection,
        wallet: {
          features: {
            "solana:signAndSendTransaction": { signAndSendTransaction },
          },
        } as unknown as SupportedWallet,
        account: {} as WalletAccount,
        owner: wallet,
        chain: "solana:devnet",
        kind,
        current: () => current,
        beforePrompt: async () => {
          current = false;
        },
      });
      await expect(
        port.send([tx(protocol(kind === "feed" ? "feed" : "take_back"))]),
      ).rejects.toMatchObject({
        signatures: [],
        uncertainIndex: null,
      });
      expect(signAndSendTransaction).not.toHaveBeenCalled();
    },
  );
  it("records no ambiguous submission when the final chain check fails before the wallet", async () => {
    const signAndSendTransaction = vi.fn();
    const port = solanaPort({
      rpc: {} as Connection,
      wallet: {
        features: {
          "solana:signAndSendTransaction": { signAndSendTransaction },
        },
      } as unknown as SupportedWallet,
      account: {} as WalletAccount,
      owner: wallet,
      chain: "solana:devnet",
      kind: "feed",
      beforePrompt: async () => {
        throw new Error("balance changed");
      },
    });
    await expect(port.send([tx(protocol("feed"))])).rejects.toMatchObject({
      signatures: [],
      uncertainIndex: null,
    });
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("accepts legacy and v0 messages, one wallet signer and the matching instruction", () => {
    const legacy = tx(protocol("feed"));
    const v0 = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet,
        recentBlockhash: blockhash,
        instructions: legacy.instructions,
      }).compileToV0Message(),
    );
    for (const transaction of [legacy, v0]) {
      expect(() => checkBuilt(transaction, wallet, "feed")).not.toThrow();
      expect(messageInstructions(transaction)).toHaveLength(1);
      expect(wire(transaction).length).toBeGreaterThan(0);
      expect(versioned(transaction).message.header.numRequiredSignatures).toBe(
        1,
      );
    }
  });

  it("rejects extra signers, foreign programs and mixed protocol instructions", () => {
    const foreign = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [],
      data: Buffer.alloc(0),
    });
    const extraSigner = SystemProgram.transfer({
      fromPubkey: Keypair.generate().publicKey,
      toPubkey: wallet,
      lamports: 1,
    });
    for (const transaction of [
      tx(protocol("feed"), foreign),
      tx(protocol("feed"), extraSigner),
      tx(protocol("feed"), protocol("take_back")),
      tx(protocol("feed"), protocol("feed")),
      tx(protocol("take_back")),
    ])
      expect(() => checkBuilt(transaction, wallet, "feed")).toThrow();
    expect(() =>
      checkBuilt(tx(protocol("feed")), Keypair.generate().publicKey, "feed"),
    ).toThrow();
    expect(() => checkBuilt(tx(protocol("feed")), wallet, "merge")).toThrow();
    expect(() =>
      checkBuilt(tx(protocol("take_back")), wallet, "takeBack"),
    ).not.toThrow();
  });

  it("preserves Feed byte headroom before a wallet can receive the transaction", () => {
    const large = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [],
      data: Buffer.alloc(FEED_BYTE_BUDGET),
    });
    expect(() =>
      checkBuilt(tx(protocol("feed"), large), wallet, "feed"),
    ).toThrow();
  });

  it("uses exact final-message simulation and refuses failures before a prompt", async () => {
    const h = simulated({ err: null, unitsConsumed: 1000 });
    const transaction = tx(protocol("feed"));
    await simulateBuilt(h as unknown as Connection, transaction);
    expect(h.simulateTransaction).toHaveBeenCalledWith(
      expect.any(VersionedTransaction),
      {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      },
    );
    const failed = simulated({ err: "InstructionError" });
    await expect(
      simulateBuilt(failed as unknown as Connection, transaction),
    ).rejects.toThrow("errors.simulation");
  });

  it("uses the measured CU margin and refuses missing measurements", async () => {
    const h = simulated({ err: null, unitsConsumed: 1001 });
    const budget = await measuredBudget(
      h as unknown as Connection,
      tx(protocol("feed")),
      5n,
    );
    const probe = messageInstructions(h.simulateTransaction.mock.calls[0]![0]);
    expect(
      probe.map((instruction) => instruction.programId.toBase58()),
    ).toEqual([
      ComputeBudgetProgram.programId.toBase58(),
      ComputeBudgetProgram.programId.toBase58(),
      PROGRAM_ID.toBase58(),
    ]);
    expect(
      probe[1]!.data.equals(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5n }).data,
      ),
    ).toBe(true);
    expect(probe[2]!.data.equals(protocol("feed").data)).toBe(true);
    const expected = Math.ceil(
      (1001 * (BPS_DENOMINATOR + SERVICES.landing.cuMarginBps)) /
        BPS_DENOMINATOR,
    );
    expect(
      budget[0]!.data.equals(
        ComputeBudgetProgram.setComputeUnitLimit({ units: expected }).data,
      ),
    ).toBe(true);
    expect(
      budget[1]!.data.equals(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5n }).data,
      ),
    ).toBe(true);
    for (const unitsConsumed of [undefined, 0, NaN]) {
      const missing = simulated({ err: null, unitsConsumed });
      await expect(
        measuredBudget(
          missing as unknown as Connection,
          tx(protocol("feed")),
          0n,
        ),
      ).rejects.toThrow();
    }
  });

  it("caps sampled priority fees and filters malformed samples", async () => {
    const rpc = {
      getRecentPrioritizationFees: vi.fn(async () => [
        { prioritizationFee: -1 },
        { prioritizationFee: NaN },
        { prioritizationFee: WEB.priorityFeeCapMicroLamports * 2 },
      ]),
    } as unknown as Connection;
    expect(await priorityFee(rpc)).toBe(
      BigInt(WEB.priorityFeeCapMicroLamports),
    );
    const empty = {
      getRecentPrioritizationFees: async () => [],
    } as unknown as Connection;
    expect(await priorityFee(empty)).toBe(0n);
  });
});
