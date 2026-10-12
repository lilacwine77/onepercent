import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import {
  ComputeBudgetProgram,
  Keypair,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { executePlan } from "../../src/tx/engine/engine";
import { buildTransaction, checkTransaction } from "../../src/tx/engine/build";
import { EngineError } from "../../src/tx/engine/errors";
import type { EnginePort } from "../../src/tx/engine/progress";
import { loadProgramWithValidator } from "./validator";

const appRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."),
);
const artifact = resolve(appRoot, "target/deploy/onepercent.so");

describe("transaction engine and v3 artifact", () => {
  it("checks, simulates and submits a transfer signed only by a disposable Node signer", async () => {
    const svm = new LiteSVM();
    const payer = Keypair.generate();
    const receiver = Keypair.generate().publicKey;
    const transfer = svm.minimumBalanceForRentExemption(0n) + 1_000_000n;
    svm.airdrop(payer.publicKey, transfer * 10n);
    const allowed = new Set([
      SystemProgram.programId.toBase58(),
      ComputeBudgetProgram.programId.toBase58(),
    ]);
    const receipts = new Set<string>();
    let simulationCount = 0;
    const port: EnginePort<Transaction> = {
      blockhash: async () => ({
        blockhash: svm.latestBlockhash(),
        lastValidBlockHeight: 150,
      }),
      blockHeight: async () => 0,
      check: (transaction) =>
        checkTransaction(
          transaction,
          payer.publicKey,
          allowed,
          PACKET_DATA_SIZE,
        ),
      simulate: async (transaction) => {
        const simulation = svm
          .withSigverify(false)
          .simulateTransaction(transaction);
        svm.withSigverify(true);
        simulationCount++;
        if (simulation instanceof FailedTransactionMetadata)
          throw new EngineError("errors.simulation");
      },
      send: async (transactions) =>
        transactions.map((transaction) => {
          transaction.sign(payer);
          expect(transaction.verifySignatures()).toBe(true);
          const result = svm.sendTransaction(transaction);
          if (result instanceof FailedTransactionMetadata)
            throw new Error(result.toString());
          const signature = Buffer.from(result.signature()).toString("base64");
          receipts.add(signature);
          return signature;
        }),
      confirm: async (signature) =>
        receipts.has(signature)
          ? ("confirmed" as const)
          : { status: "failed" as const, error: "not landed" },
    };
    const result = await executePlan(
      [
        {
          id: "transfer",
          phase: 0,
          build: (blockhash) =>
            buildTransaction({
              wallet: payer.publicKey,
              blockhash,
              instructions: [
                SystemProgram.transfer({
                  fromPubkey: payer.publicKey,
                  toPubkey: receiver,
                  lamports: transfer,
                }),
              ],
              computeUnits: 200_000,
              recentPriorityFees: [],
            }),
          landed: async () => (svm.getBalance(receiver) ?? 0n) >= transfer,
        },
      ],
      port,
      { batchSize: 1, current: () => true, progress: () => undefined },
    );
    expect(result.phase).toBe("done");
    expect(result.retry).toEqual([]);
    expect(simulationCount).toBe(2);
    expect(svm.getBalance(receiver)).toBe(transfer);
  });

  it.skipIf(!existsSync(artifact) && !process.env.CI)(
    "loads the v3 artifact in validator 4.3.0 using the documented LiteSVM fallback",
    async () => {
      expect(
        existsSync(artifact),
        "Build the v3 artifact with pnpm anchor:build",
      ).toBe(true);
      const bytes = readFileSync(artifact);
      expect(bytes.readUInt32LE(48)).toBe(3);
      const idl = JSON.parse(
        readFileSync(
          resolve(appRoot, "packages/sdk/src/idl/onepercent.json"),
          "utf8",
        ),
      ) as {
        address: string;
      };
      const program = new PublicKey(idl.address);
      // npm LiteSVM 0.8.0 rejects this v3 ELF (VERSIONS.md; M1 §16.5 fallback).
      const account = await loadProgramWithValidator(
        program.toBase58(),
        artifact,
      );
      expect(account.executable).toBe(true);
      expect(account.owner).toBe("BPFLoaderUpgradeab1e11111111111111111111111");
      // Program invocations await M1's SDK builders and recorded fixtures.
    },
    45_000,
  );
});
