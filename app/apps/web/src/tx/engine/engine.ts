import { EngineError, SubmittedBatchError, errorCopy } from "./errors";
import { reconcile } from "./reconcile";
import type {
  EnginePhase,
  EnginePort,
  PendingItem,
  PlanItem,
  Progress,
} from "./progress";

export async function executePlan<T>(
  items: readonly PlanItem<T>[],
  port: EnginePort<T>,
  options: {
    batchSize: number;
    current(): boolean;
    progress(state: Progress): void;
  },
) {
  const confirmed = new Set<string>();
  const uncertain = new Set<string>();
  const terminal = new Set<string>();
  const submissions = new Map<string, PendingItem<T>>();
  let expired = false;
  let planValid = false;
  let failure: unknown;
  const update = (phase: Progress["phase"]) =>
    options.progress({ phase, confirmed: confirmed.size, total: items.length });
  try {
    if (
      !Number.isSafeInteger(options.batchSize) ||
      options.batchSize < 1 ||
      new Set(items.map((item) => item.id)).size !== items.length ||
      items.some(
        (item) =>
          !item.id || !Number.isSafeInteger(item.phase) || item.phase < 0,
      )
    )
      throw new EngineError("errors.generic");
    planValid = true;
    const phases = [...new Set(items.map((item) => item.phase))].sort(
      (a, b) => a - b,
    );
    for (const phase of phases) {
      const group = items.filter((item) => item.phase === phase);
      for (let start = 0; start < group.length; start += options.batchSize) {
        if (!options.current()) throw new EngineError("errors.cardMoved");
        const batch = group.slice(start, start + options.batchSize);
        update("building");
        const initial = await port.blockhash();
        const prepared = await Promise.all(
          batch.map((item) => item.build(initial)),
        );
        prepared.forEach((transaction) => port.check(transaction));
        update("simulating");
        for (const transaction of prepared) await port.simulate(transaction);
        const validity = await port.blockhash();
        const fresh = await Promise.all(
          batch.map((item) => item.build(validity)),
        );
        fresh.forEach((transaction) => port.check(transaction));
        // A builder is not assumed pure: simulate the exact final messages too.
        for (const transaction of fresh) await port.simulate(transaction);
        if ((await port.blockHeight()) > validity.lastValidBlockHeight) {
          expired = true;
          throw new EngineError("errors.tooLong");
        }
        if (!options.current()) throw new EngineError("errors.cardMoved");
        update("signing");
        let signatures: readonly string[];
        let sendFailure: unknown;
        batch.forEach((item) => {
          uncertain.add(item.id);
          submissions.set(item.id, { item, validity });
        });
        try {
          signatures = await port.send(fresh);
        } catch (error) {
          sendFailure = error;
          if (!(error instanceof SubmittedBatchError)) throw error;
          signatures = error.signatures;
          batch.forEach((item, index) => {
            if (index >= signatures.length && index !== error.uncertainIndex)
              uncertain.delete(item.id);
          });
        }
        if (
          signatures.length > batch.length ||
          new Set(signatures).size !== signatures.length ||
          signatures.some((signature) => !signature)
        )
          throw new EngineError("errors.generic");
        update("sending");
        // Track every known signature, even when another item or the wallet failed.
        for (const [index, signature] of signatures.entries()) {
          const item = batch[index]!;
          submissions.set(item.id, { item, validity, signature });
          try {
            const state = await port.confirm(signature, validity);
            uncertain.delete(item.id);
            if (state === "confirmed") confirmed.add(item.id);
            else terminal.add(item.id);
            if (state === "expired") expired = true;
            if (typeof state === "object") sendFailure ??= state.error;
          } catch (error) {
            sendFailure ??= error;
          }
          update("sending");
        }
        const checked = await reconcile(batch, confirmed, uncertain, terminal);
        checked.landed.forEach((id) => confirmed.add(id));
        if (sendFailure) throw sendFailure;
        if (batch.some((item) => !confirmed.has(item.id)))
          throw new EngineError(expired ? "errors.tooLong" : "errors.generic");
      }
    }
  } catch (error) {
    failure = error;
  }
  const checked = await reconcile(items, confirmed, uncertain, terminal);
  checked.landed.forEach((id) => confirmed.add(id));
  const allDone = planValid && confirmed.size === items.length;
  const mapped = failure && !allDone ? errorCopy(failure) : null;
  // The rejection copy promises nothing was sent; use it only when that is proven.
  const copyKey =
    mapped === "errors.walletNo" &&
    (confirmed.size > 0 || checked.unknown.size > 0)
      ? "errors.generic"
      : mapped;
  const phase: EnginePhase = allDone
    ? "done"
    : confirmed.size
      ? "partial"
      : expired || copyKey === "errors.tooLong"
        ? "expired"
        : copyKey === "errors.walletNo"
          ? "rejected"
          : "failed";
  update(phase);
  const blockedPhases = items
    .filter((item) => checked.unknown.has(item.id))
    .map((item) => item.phase);
  const retry = checked.retry.filter((item) =>
    blockedPhases.every((phase) => item.phase <= phase),
  );
  return {
    phase,
    copyKey: phase === "done" ? null : copyKey,
    ...checked,
    retry,
    pending: [...submissions.values()].filter((entry) =>
      checked.unknown.has(entry.item.id),
    ),
  };
}
