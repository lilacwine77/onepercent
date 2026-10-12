import { webDeployment } from "../../data/deployment";
import {
  BPS_DENOMINATOR,
  CU_LIMITS,
  PROGRAM_IDS,
  SERVICES,
  TX_LIMITS,
} from "@onepercent/config";
import { WEB } from "@onepercent/config/web";
import { en, type CopyKey } from "@onepercent/copy";
import {
  FEED_BYTE_BUDGET,
  IDL,
  machinePda,
  programError,
  serializedSize,
  type BuiltTransaction,
} from "@onepercent/sdk/browser";
import { SendResponse } from "@onepercent/web-api";
import {
  ComputeBudgetProgram,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import type { SupportedWallet } from "../../wallet/capabilities";
import { api } from "../../data/api";
import { base58, equalBytes, toBase64 } from "../../util/bytes";
import { EngineError, SubmittedBatchError } from "./errors";
import { confirm } from "./confirm";
import { send } from "./send";
import { accountIdentity } from "./account-lock";
import { rememberSubmission } from "../submission-guard";
import type { EnginePort } from "./progress";

export function messageInstructions(
  tx: BuiltTransaction,
  lut?: AddressLookupTableAccount,
) {
  return tx instanceof Transaction
    ? tx.instructions
    : TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: lut ? [lut] : [],
      }).instructions;
}
export function wire(tx: BuiltTransaction): Uint8Array {
  return tx instanceof Transaction
    ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
    : tx.serialize();
}
export const versioned = (tx: BuiltTransaction) =>
  tx instanceof Transaction
    ? new VersionedTransaction(tx.compileMessage())
    : tx;
export function checkBuilt(
  tx: BuiltTransaction,
  wallet: PublicKey,
  kind: "feed" | "merge" | "close" | "takeBack",
  lut?: AddressLookupTableAccount,
) {
  const message = versioned(tx).message;
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.staticAccountKeys[0]?.equals(wallet)
  )
    throw new EngineError("errors.simulation");
  const allowed = new Set<string>([
    webDeployment().programId.toBase58(),
    PROGRAM_IDS.splToken,
    PROGRAM_IDS.token2022,
    PROGRAM_IDS.associatedToken,
    SystemProgram.programId.toBase58(),
    PROGRAM_IDS.computeBudget,
    PROGRAM_IDS.ed25519,
  ]);
  const instructions = messageInstructions(tx, lut);
  if (instructions.some((ix) => !allowed.has(ix.programId.toBase58())))
    throw new EngineError("errors.simulation");
  const program = instructions.filter((ix) =>
    ix.programId.equals(webDeployment().programId),
  );
  const discriminator = IDL.instructions.find(
    (ix) => ix.name === (kind === "feed" ? "feed" : "take_back"),
  )?.discriminator;
  if (kind === "feed" || kind === "takeBack") {
    if (
      !discriminator ||
      !program.length ||
      (kind === "feed" && program.length !== 1) ||
      program.some(
        (ix) =>
          !equalBytes(
            ix.data.subarray(0, discriminator.length),
            Uint8Array.from(discriminator),
          ),
      )
    )
      throw new EngineError("errors.simulation");
  } else if (program.length) throw new EngineError("errors.simulation");
  if (
    serializedSize(tx) >
    (kind === "takeBack" ? TX_LIMITS.maxTxBytes : FEED_BYTE_BUDGET)
  )
    throw new EngineError("errors.simulation");
}
export async function priorityFee(rpc: Connection): Promise<bigint> {
  const values = (
    await rpc.getRecentPrioritizationFees({
      lockedWritableAccounts: [machinePda(webDeployment().programId)[0]],
    })
  )
    .map((entry) => entry.prioritizationFee)
    .filter((value) => Number.isSafeInteger(value) && value >= 0)
    .sort((a, b) => a - b);
  return BigInt(
    Math.min(
      values[Math.floor(values.length / 2)] ?? 0,
      WEB.priorityFeeCapMicroLamports,
    ),
  );
}
export function simulationError(
  error: unknown,
  logs: readonly string[] = [],
): EngineError {
  const mapped = programError(error, { logs });
  const key = `errors.${mapped.copyKey}`;
  return new EngineError(
    key in en && mapped.copyKey !== "generic"
      ? (key as CopyKey)
      : "errors.simulation",
  );
}
/** The signature has already failed at finalized before logs are read. */
export async function finalizedError(
  rpc: Connection,
  signature: string,
  error: unknown,
): Promise<EngineError> {
  let copyKey: CopyKey = "errors.generic";
  try {
    // The public RPC route serves transaction details at confirmed. Finality
    // comes from confirm(), never from this optional diagnostic read.
    const transaction = await rpc.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = transaction?.meta?.logMessages ?? [];
    const firstFailure = logs
      .map((line) => /^Program (\w+) failed:/.exec(line)?.[1])
      .find(Boolean);
    if (
      transaction?.meta?.err &&
      JSON.stringify(transaction.meta.err) === JSON.stringify(error) &&
      firstFailure === webDeployment().programId.toBase58()
    ) {
      const mapped = programError(error, {
        programId: webDeployment().programId,
        logs,
      });
      const key = `errors.${mapped.copyKey}`;
      if (key in en) copyKey = key as CopyKey;
    }
  } catch {
    // A missing diagnostic cannot make a definitive failure ambiguous again.
  }
  return new EngineError(copyKey, { cause: error });
}
export async function simulateBuilt(rpc: Connection, tx: BuiltTransaction) {
  const result = await rpc.simulateTransaction(versioned(tx), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (result.value.err)
    throw simulationError(result.value.err, result.value.logs ?? []);
  return result.value;
}
/** Merge and empty-close CU are measured; no invented CU constant. */
export async function measuredBudget(
  rpc: Connection,
  tx: Transaction,
  price: bigint,
): Promise<TransactionInstruction[]> {
  // The unsigned probe uses the largest already admitted SDK limit. Include
  // both budget instructions: their fixed overhead matters for cheap closes.
  // The wallet receives the measured limit with the configured margin below.
  const ceiling = Math.max(
    ...Object.values(CU_LIMITS).flatMap((value) =>
      typeof value === "number" ? [value] : Object.values(value),
    ),
  );
  const probe = new Transaction({
    feePayer: tx.feePayer,
    recentBlockhash: tx.recentBlockhash,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: ceiling }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
    ...tx.instructions.filter(
      (instruction) =>
        !instruction.programId.equals(ComputeBudgetProgram.programId),
    ),
  );
  const result = await simulateBuilt(rpc, probe);
  if (!result.unitsConsumed || !Number.isSafeInteger(result.unitsConsumed))
    throw new EngineError("errors.simulation");
  const units = Math.ceil(
    (result.unitsConsumed * (BPS_DENOMINATOR + SERVICES.landing.cuMarginBps)) /
      BPS_DENOMINATOR,
  );
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
  ];
}
export function solanaPort(input: {
  rpc: Connection;
  wallet: SupportedWallet;
  account: WalletAccount;
  chain: "solana:devnet" | "solana:mainnet";
  owner: PublicKey;
  kind: "feed" | "merge" | "close" | "takeBack";
  lut?: AddressLookupTableAccount;
  submissionScope?: readonly string[];
  current?(): boolean;
  beforePrompt?(transactions: readonly BuiltTransaction[]): Promise<void>;
}): EnginePort<BuiltTransaction> {
  let validityHeight = 0;
  return {
    blockhash: async () => {
      const validity = await input.rpc.getLatestBlockhash("confirmed");
      validityHeight = validity.lastValidBlockHeight;
      return validity;
    },
    blockHeight: () => input.rpc.getBlockHeight("confirmed"),
    check: (tx) => checkBuilt(tx, input.owner, input.kind, input.lut),
    simulate: async (tx) => {
      await simulateBuilt(input.rpc, tx);
    },
    send: async (transactions) => {
      try {
        if (input.current && !input.current())
          throw new EngineError("errors.cardMoved");
        await input.beforePrompt?.(transactions);
        if (input.current && !input.current())
          throw new EngineError("errors.cardMoved");
      } catch (error) {
        // No wallet was called, so this preflight rejection has no submission.
        throw new SubmittedBatchError(error, [], null);
      }
      // The shared guard also protects Rip/Cards and survives a page reload.
      rememberSubmission(
        accountIdentity(input.chain, input.owner.toBase58()),
        validityHeight,
        input.submissionScope,
      );
      return send(
        input.wallet,
        input.account,
        input.chain,
        transactions.map(wire),
        async (bytes) =>
          (
            await api("/api/send", SendResponse, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tx: toBase64(bytes) }),
            })
          ).signature,
        base58,
      );
    },
    confirm: async (signature, validity) => {
      const result = await confirm(input.rpc, signature, validity);
      return typeof result === "object"
        ? {
            ...result,
            error: await finalizedError(input.rpc, signature, result.error),
          }
        : result;
    },
  };
}
