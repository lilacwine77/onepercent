import { webDeployment, deploymentChain } from "../data/deployment";
import type { CopyKey } from "@onepercent/copy";
import { TX_LIMITS } from "@onepercent/config";
import {
  EXTERNAL_IDS,
  MEMO_PROGRAM_ID,
  serializedSize,
  type BuiltTransaction,
} from "@onepercent/sdk/browser";
import { SendResponse } from "@onepercent/web-api";
import {
  ComputeBudgetProgram,
  Ed25519Program,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import { api } from "../data/api";
import { encodeSignature } from "../chain/encoding";
import { capabilities } from "../wallet/capabilities";
import type { WalletSession } from "../wallet/session";
import { executePlan } from "./engine/engine";
import { EngineError, SubmittedBatchError } from "./engine/errors";
import { confirm } from "./engine/confirm";
import { send } from "./engine/send";
import type { PlanItem, Progress } from "./engine/progress";
import {
  clearSubmission,
  enterSubmission,
  rememberSubmission,
} from "./submission-guard";

export function checkBuiltTransaction(
  transaction: BuiltTransaction,
  wallet: PublicKey,
  tables: AddressLookupTableAccount[] = [],
) {
  if (tables.some((table) => table.state.authority !== undefined))
    throw new EngineError("errors.simulation");
  const message =
    transaction instanceof Transaction
      ? transaction.compileMessage()
      : transaction.message;
  const decoded = TransactionMessage.decompile(message, {
    addressLookupTableAccounts: tables,
  });
  const allowed = new Set(
    [
      webDeployment().programId,
      EXTERNAL_IDS.splToken,
      EXTERNAL_IDS.token2022,
      EXTERNAL_IDS.associatedToken,
      SystemProgram.programId,
      ComputeBudgetProgram.programId,
      Ed25519Program.programId,
      MEMO_PROGRAM_ID,
    ].map((id) => id.toBase58()),
  );
  if (
    message.header.numRequiredSignatures !== 1 ||
    !decoded.payerKey.equals(wallet) ||
    serializedSize(transaction) > TX_LIMITS.maxTxBytes ||
    decoded.instructions.some((ix) => !allowed.has(ix.programId.toBase58()))
  )
    throw new EngineError("errors.simulation");
}

export async function executeTransactions(options: {
  rpc: Connection;
  session: WalletSession;
  chain: "solana:devnet" | "solana:mainnet";
  items: PlanItem<BuiltTransaction>[];
  lookupTables?: AddressLookupTableAccount[];
  onProgress?(progress: Progress): void;
  onSignature?(signature: string): void;
  simulationError?(error: unknown, logs: readonly string[]): CopyKey;
}) {
  if (options.chain !== deploymentChain())
    throw new EngineError("errors.simulation");
  const state = options.session.snapshot();
  if (!state.wallet || !state.account)
    throw new EngineError("wallet.noAccount");
  const { wallet, account, generation } = state;
  const signatures: string[] = [];
  const rpc = options.rpc;
  const identity = `${options.chain}:${webDeployment().programId}:${account.address}`;
  const leave = await enterSubmission(identity, () =>
    rpc.getBlockHeight("finalized"),
  );
  let validityHeight = 0;
  let submissionStarted = false;
  try {
    const result = await executePlan(
      options.items,
      {
        blockhash: async () => {
          const latest = await rpc.getLatestBlockhash("confirmed");
          if (
            !Number.isSafeInteger(latest.lastValidBlockHeight) ||
            latest.lastValidBlockHeight <= 0
          )
            throw new EngineError("errors.simulation");
          validityHeight = latest.lastValidBlockHeight;
          return latest;
        },
        blockHeight: () => rpc.getBlockHeight("confirmed"),
        check: (transaction) =>
          checkBuiltTransaction(
            transaction,
            new PublicKey(account.address),
            options.lookupTables,
          ),
        simulate: async (transaction) => {
          const versioned =
            transaction instanceof Transaction
              ? new VersionedTransaction(transaction.compileMessage())
              : transaction;
          const response = await rpc.simulateTransaction(versioned, {
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: "confirmed",
          });
          if (response.value.err)
            throw new EngineError(
              options.simulationError?.(
                response.value.err,
                response.value.logs ?? [],
              ) ?? "errors.simulation",
            );
        },
        send: async (transactions) => {
          submissionStarted = true;
          // Persist before the wallet call so a reload cannot make an unknown send retryable.
          rememberSubmission(identity, validityHeight);
          const record = (found: readonly string[]) => {
            for (const signature of found) {
              signatures.push(signature);
              options.onSignature?.(signature);
            }
          };
          try {
            const found = await send(
              wallet,
              account,
              options.chain,
              transactions.map((transaction) =>
                transaction instanceof Transaction
                  ? transaction.serialize({
                      requireAllSignatures: false,
                      verifySignatures: false,
                    })
                  : transaction.serialize(),
              ),
              async (bytes) =>
                (
                  await api("/api/send", SendResponse, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      tx: btoa(String.fromCharCode(...bytes)),
                    }),
                  })
                ).signature,
              encodeSignature,
            );
            record(found);
            return found;
          } catch (error) {
            if (error instanceof SubmittedBatchError) record(error.signatures);
            throw error;
          }
        },
        confirm: (signature, validity) => confirm(rpc, signature, validity),
      },
      {
        batchSize: capabilities(
          wallet,
          options.items.length,
          TX_LIMITS.txPerSignAll,
        ).batchSize,
        current: () => options.session.snapshot().generation === generation,
        progress: (progress) => options.onProgress?.(progress),
      },
    );
    if (!submissionStarted || result.unknown.size === 0)
      clearSubmission(identity);
    return { ...result, signatures, submitted: submissionStarted };
  } finally {
    leave();
  }
}
