import { composeExecTransaction } from "@onepercent/sdk";
import { checkExecBegin } from "@onepercent/sdk/server";

/** The service and its test doubles use P1's exported contract directly. */
export type P1ExecutorPort = {
  checkExecBegin: typeof checkExecBegin;
  composeExecTransaction: typeof composeExecTransaction;
};
export const executorP1: P1ExecutorPort = {
  checkExecBegin,
  composeExecTransaction,
};
