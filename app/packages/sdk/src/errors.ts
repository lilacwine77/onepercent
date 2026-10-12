import type { Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import idl from "./idl/onepercent.json" with { type: "json" };
import { EXTERNAL_IDS } from "./constants.js";

export type ErrorCopyKey =
  | "machineChanged"
  | "refilling"
  | "hungry"
  | "tooLong"
  | "freshCap"
  | "notInSet"
  | "seasonOver"
  | "busy"
  | "computeBudgetExceeded"
  | "myCardsFull"
  | "cardMoved"
  | "payeeBelowRent"
  | "sellBackFallback"
  | "notFeedable"
  | "pullPending"
  | "myCardsNotEmpty"
  | "walletNo"
  | "generic";
const COPY_KEYS: Record<string, ErrorCopyKey> = {
  LiveFlagsChanged: "machineChanged",
  Refilling: "refilling",
  MachineHungry: "hungry",
  AttestationExpired: "tooLong",
  FreshCapReached: "freshCap",
  NotPumpFun: "notInSet",
  MintNotSafe: "notInSet",
  MintForbidden: "notInSet",
  SeasonOver: "seasonOver",
  QueueNotAllowed: "busy",
  BinderFull: "myCardsFull",
  CardMoved: "cardMoved",
  PayeeBelowRent: "payeeBelowRent",
  SellBackFloor: "sellBackFallback",
  SellBackBudget: "sellBackFallback",
  BucketCapExceeded: "sellBackFallback",
  BucketDisabled: "sellBackFallback",
  NotFeedable: "notFeedable",
  PullPending: "pullPending",
  BinderNotEmpty: "myCardsNotEmpty",
  FinalNotClaimed: "myCardsNotEmpty",
};
export interface ErrorContext {
  programId?: PublicKey;
  instruction?: string;
  logs?: readonly string[];
  failingInnerProgramId?: PublicKey;
  walletRejected?: boolean;
  blockhashExpired?: boolean;
}
const COMPUTE_EXHAUSTION =
  /ComputationalBudgetExceeded|computational budget exceeded|compute budget exceeded|exceeded CUs? meter at BPF instruction/i;
function isComputeExhaustion(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return COMPUTE_EXHAUSTION.test(value);
  if (!value || typeof value !== "object" || depth >= 6) return false;
  if (Array.isArray(value))
    return value.some((item) => isComputeExhaustion(item, depth + 1));
  const object = value as Record<string, unknown>;
  return [
    "InstructionError",
    "err",
    "error",
    "data",
    "value",
    "transactionError",
    "transactionMessage",
    "message",
    "name",
    "cause",
  ].some((key) => isComputeExhaustion(object[key], depth + 1));
}
export function programError(
  error: unknown,
  context: ErrorContext = {},
): { name: string; copyKey: ErrorCopyKey } {
  const obj =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (
    context.walletRejected ||
    obj.code === 4001 ||
    /user rejected|user declined/i.test(message)
  )
    return { name: "WalletRejected", copyKey: "walletNo" };
  if (
    context.blockhashExpired ||
    /blockhash not found|block height exceeded|transactionexpiredblockheight/i.test(
      message,
    )
  )
    return { name: "BlockhashExpired", copyKey: "tooLong" };
  const logs =
    context.logs ??
    (Array.isArray(obj.logs)
      ? obj.logs.filter((line): line is string => typeof line === "string")
      : []);
  // Runtime exhaustion takes precedence over an inner oracle failure: retrying a full queue will not fix its budget.
  if (
    isComputeExhaustion(error) ||
    logs.some((line) => COMPUTE_EXHAUSTION.test(line))
  )
    return { name: "ComputeBudgetExceeded", copyKey: "computeBudgetExceeded" };
  const failures = logs.flatMap((line) => {
    const match = /^Program (\w+) failed/.exec(line);
    return match?.[1] ? [match[1]] : [];
  });
  // The final root failure wraps the originating inner program failure.
  const failingProgram =
    context.failingInnerProgramId?.toBase58() ??
    [...failures]
      .reverse()
      .find((id) => id !== context.programId?.toBase58()) ??
    failures.at(-1);
  if (
    context.instruction === "buy_packs" &&
    failingProgram === EXTERNAL_IDS.magicblockVrf.toBase58()
  )
    return { name: "VrfUnavailable", copyKey: "busy" };
  const anchorError =
    obj.error && typeof obj.error === "object"
      ? (obj.error as Record<string, unknown>)
      : undefined;
  const errorCode =
    anchorError?.errorCode && typeof anchorError.errorCode === "object"
      ? (anchorError.errorCode as Record<string, unknown>)
      : undefined;
  const explicitName =
    typeof errorCode?.code === "string"
      ? errorCode.code
      : typeof obj.name === "string"
        ? obj.name
        : undefined;
  const logCode = logs
    .map((line) => /Error Code: (\w+)/.exec(line)?.[1])
    .find(Boolean);
  const numeric =
    typeof error === "number"
      ? error
      : typeof errorCode?.number === "number"
        ? errorCode.number
        : typeof obj.code === "number"
          ? obj.code
          : undefined;
  const entry = (idl as Idl).errors?.find(
    (item) =>
      item.code === numeric ||
      item.name === explicitName ||
      item.name === logCode,
  );
  const name = entry?.name ?? logCode ?? explicitName ?? "Unknown";
  return {
    name,
    copyKey:
      name === "WrongPhase" && context.instruction === "buy_packs"
        ? "seasonOver"
        : name === "AttestationExpired" && context.instruction === "sell_back"
          ? "sellBackFallback"
          : (COPY_KEYS[name] ?? "generic"),
  };
}
