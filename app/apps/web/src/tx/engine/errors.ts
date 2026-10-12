import type { CopyKey } from "@onepercent/copy";
export class EngineError extends Error {
  constructor(
    public readonly copyKey: CopyKey,
    options?: ErrorOptions,
  ) {
    super(copyKey, options);
  }
}

/** A wallet batch can have already submitted a prefix before a later failure. */
export class SubmittedBatchError extends Error {
  constructor(
    public readonly original: unknown,
    public readonly signatures: readonly string[],
    /** Null means that every transaction without a signature is known not to have been submitted. */
    public readonly uncertainIndex: number | null,
  ) {
    super("Transaction batch stopped");
  }
}

export function errorCopy(error: unknown): CopyKey {
  if (error instanceof SubmittedBatchError) return errorCopy(error.original);
  if (error instanceof EngineError) return error.copyKey;
  if (error instanceof Error && error.name === "TimeoutError")
    return "common.networkError";
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String(error.code) === "4001"
  )
    return "errors.walletNo";
  if (
    error instanceof Error &&
    /user.*reject|reject.*user/i.test(error.message)
  )
    return "errors.walletNo";
  if (
    error instanceof Error &&
    /blockhash.*(unknown|not found)/i.test(error.message)
  )
    return "errors.tooLong";
  return "errors.generic";
}
