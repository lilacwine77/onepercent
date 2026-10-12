import { expect, it } from "vitest";
import { EngineError, errorCopy, SubmittedBatchError } from "./errors";

it("an expired blockhash asks for a fresh attempt, without inventing a cluster mismatch", () => {
  expect(
    errorCopy(new Error("Transaction simulation failed: Blockhash not found")),
  ).toBe("errors.tooLong");
  expect(
    errorCopy(new SubmittedBatchError(new Error("Blockhash unknown"), [], 0)),
  ).toBe("errors.tooLong");
  expect(errorCopy(new EngineError("wallet.wrongNetwork"))).toBe(
    "wallet.wrongNetwork",
  );
});
