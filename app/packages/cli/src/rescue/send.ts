import { setTimeout as sleep } from "node:timers/promises";
import { RESCUE, SERVICES, WEB } from "@onepercent/config";
import {
  Transaction,
  VersionedTransaction,
  type Connection,
  type Keypair,
  type PublicKey,
} from "@solana/web3.js";
import { programError, type BuiltTransaction } from "@onepercent/sdk";
import { type RescueTransaction } from "@onepercent/sdk/rescue";
import { RescueCliError } from "./input.js";

export type SenderRpc = Pick<
  Connection,
  | "simulateTransaction"
  | "getBlockHeight"
  | "getSignatureStatuses"
  | "sendRawTransaction"
>;
export interface SenderOptions {
  programId: PublicKey;
  rpc: SenderRpc;
  signer?: Keypair;
  dryRun: boolean;
  unsigned: boolean;
  yes: boolean;
  emit(record: Record<string, unknown>): void;
  confirm(): Promise<boolean>;
  sleep?(milliseconds: number): Promise<void>;
}
export type SendResult = {
  state:
    | "confirmed"
    | "preview"
    | "expired"
    | "card-moved"
    | "ambiguous"
    | "cancelled"
    | "failed";
  signature?: string;
};

export function unsignedVersion(tx: BuiltTransaction): VersionedTransaction {
  return tx instanceof Transaction
    ? new VersionedTransaction(tx.compileMessage())
    : tx;
}

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let text = "";
  while (value > 0n) {
    text = alphabet[Number(value % 58n)]! + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = "1" + text;
  }
  return text;
}

function transactionErrorName(
  programId: PublicKey,
  error: unknown,
  item: RescueTransaction,
  logs: readonly string[] = [],
): string {
  const named = programError(error, { logs, programId }).name;
  if (named !== "Unknown") return named;
  const detail: unknown =
    error && typeof error === "object"
      ? Reflect.get(error, "InstructionError")
      : undefined;
  if (
    !Array.isArray(detail) ||
    typeof detail[0] !== "number" ||
    !detail[1] ||
    typeof detail[1] !== "object"
  )
    return named;
  const custom: unknown = Reflect.get(detail[1], "Custom");
  if (typeof custom !== "number") return named;
  const message = unsignedVersion(item.transaction).message;
  const ix = message.compiledInstructions[detail[0]];
  const program = ix && message.staticAccountKeys[ix.programIdIndex];
  if (!program) return named;
  if (!program.equals(programId)) return named;
  return programError(custom).name;
}

/** No URL, provider error message or signer material is emitted. */
export async function simulateRescue(
  options: SenderOptions,
  item: RescueTransaction,
) {
  const result = await options.rpc.simulateTransaction(
    unsignedVersion(item.transaction),
    {
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: true,
      minContextSlot: item.slot,
    },
  );
  const error =
    result.value.err === null
      ? null
      : transactionErrorName(
          options.programId,
          result.value.err,
          item,
          result.value.logs ?? [],
        );
  options.emit({
    type: "transaction",
    action: item.action,
    addresses: item.addresses,
    indices: item.indices,
    details: item.details,
    simulation: {
      ok: error === null,
      error,
      unitsConsumed: result.value.unitsConsumed,
      slot: result.context.slot,
    },
    ...(options.unsigned
      ? {
          unsigned: Buffer.from(
            unsignedVersion(item.transaction).serialize(),
          ).toString("base64"),
        }
      : {}),
  });
  return error;
}

export async function sendRescueTransaction(
  options: SenderOptions,
  item: RescueTransaction,
  lastValidBlockHeight: number,
): Promise<SendResult> {
  const simulation = await simulateRescue(options, item);
  if (simulation)
    return { state: simulation === "CardMoved" ? "card-moved" : "failed" };
  if (options.dryRun || options.unsigned) return { state: "preview" };
  if (!options.signer) throw new RescueCliError("signer_required", 4);
  if (!options.yes && !(await options.confirm())) return { state: "cancelled" };
  if ((await options.rpc.getBlockHeight("confirmed")) > lastValidBlockHeight)
    return { state: "expired" };
  // The state can change while the user considers the first simulation.
  const latest = await simulateRescue(options, item);
  if (latest)
    return { state: latest === "CardMoved" ? "card-moved" : "failed" };
  const signed = unsignedVersion(item.transaction);
  signed.sign([options.signer]);
  const signature = base58(signed.signatures[0]!);
  options.emit({
    type: "signed",
    action: item.action,
    signature,
    lastValidBlockHeight,
  });
  try {
    const reported = await options.rpc.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 0,
    });
    if (reported !== signature)
      throw new RescueCliError("rpc_signature_mismatch");
  } catch {
    // A lost response is not proof of failure. Reconcile the exact signature.
  }
  const deadline = Date.now() + SERVICES.transport.rpcTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = (
        await options.rpc.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      // A confirmed failure can disappear on a fork, leaving this signature
      // executable. Only a finalized failure can authorize a replacement.
      if (
        status?.confirmationStatus === "finalized" ||
        (status?.confirmationStatus === "confirmed" && !status.err)
      ) {
        if (status.err) {
          const error = transactionErrorName(
            options.programId,
            status.err,
            item,
          );
          options.emit({ type: "failed", signature, error });
          return {
            state: error === "CardMoved" ? "card-moved" : "failed",
            signature,
          };
        }
        options.emit({
          type: "confirmed",
          action: item.action,
          signature,
          slot: status.slot,
        });
        return { state: "confirmed", signature };
      }
      if (
        (await options.rpc.getBlockHeight("finalized")) > lastValidBlockHeight
      ) {
        const reconciled = (
          await options.rpc.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          })
        ).value[0];
        if (!reconciled) {
          options.emit({ type: "expired", signature });
          return { state: "expired", signature };
        }
      }
    } catch {
      // Keep the signed attempt unresolved if the provider is unreachable.
    }
    await (options.sleep ?? sleep)(WEB.confirmPollMs);
  }
  options.emit({
    type: "ambiguous",
    signature,
    lastValidBlockHeight,
    reason: "Check this signature before retrying; no replacement was signed.",
  });
  return { state: "ambiguous", signature };
}

export function canRetryCardMoved(attempts: number) {
  return attempts < RESCUE.cardMovedRetries;
}
