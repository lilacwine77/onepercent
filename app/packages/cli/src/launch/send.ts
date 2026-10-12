import { OpsError } from "../input.js";

export interface LaunchAttempt {
  form: "single";
  signatures: string[];
  encodedTransactions: string[];
  lastValidBlockHeight: number;
  acceptedWarnings?: { id: string; detail: string; value?: unknown }[];
}
export interface SendDependencies {
  preflight(): Promise<void>;
  chainNow(): Promise<number>;
  observe(): Promise<
    | "absent"
    | "powered-on"
    | "mint-without-power-on"
    | "foreign-mint-account"
    | "foreign-pool-account"
  >;
  prepare(): Promise<LaunchAttempt>;
  persist(attempt: LaunchAttempt): Promise<void>;
  load(): Promise<LaunchAttempt | null>;
  send(attempt: LaunchAttempt): Promise<void>;
  finalizedHeight(): Promise<number>;
  history(
    signatures: string[],
  ): Promise<("finalized" | "failed" | "ambiguous" | "absent")[]>;
  sleep(): Promise<void>;
  emit(record: Record<string, unknown>): void;
}

/** Rebuild only after finalized expiry AND a history/state reconciliation.
 * A transport timeout says nothing about whether a signed attempt landed.
 */
export async function sendLaunch(
  input: {
    mint: string;
    confirm: string;
    at?: number;
    maxPasses: number;
    maxBuilds: number;
  },
  deps: SendDependencies,
) {
  if (input.confirm !== input.mint.slice(0, 8))
    throw new OpsError("launch_confirmation_mismatch");
  if (
    !Number.isSafeInteger(input.maxPasses) ||
    input.maxPasses < 1 ||
    !Number.isSafeInteger(input.maxBuilds) ||
    input.maxBuilds < 1
  )
    throw new OpsError("invalid_launch_retry_policy");
  let attempt = await deps.load();
  const initialObservation = await deps.observe();
  if (initialObservation === "powered-on")
    return {
      ok: true,
      form: attempt?.form ?? "unknown",
      signatures: attempt?.signatures ?? [],
      reconciled: true,
    };
  if (initialObservation === "foreign-pool-account")
    throw new OpsError("launch_pool_account_foreign");
  if (initialObservation === "foreign-mint-account")
    throw new OpsError("launch_mint_account_foreign");
  if (initialObservation !== "absent")
    throw new OpsError("launch_mint_exists_without_power_on");
  // A resumed attempt reconciles its persisted bytes instead of planning a new mint.
  // Fresh attempts validate unsigned now and refresh the quote and simulation at T0.
  if (!attempt) await deps.preflight();
  while (input.at !== undefined && (await deps.chainNow()) < input.at) {
    deps.emit({ event: "waiting_for_chain_clock", at: input.at });
    await deps.sleep();
  }
  let builds = 0;
  for (let pass = 0; pass < input.maxPasses; pass++) {
    const observed = await deps.observe();
    if (observed === "powered-on")
      return {
        ok: true,
        form: attempt?.form ?? "unknown",
        signatures: attempt?.signatures ?? [],
        reconciled: true,
      };
    if (observed === "foreign-pool-account")
      throw new OpsError("launch_pool_account_foreign");
    if (observed === "foreign-mint-account")
      throw new OpsError("launch_mint_account_foreign");
    if (observed !== "absent")
      throw new OpsError("launch_mint_exists_without_power_on");
    if (
      attempt &&
      (await deps.finalizedHeight()) > attempt.lastValidBlockHeight
    ) {
      const statuses = await deps.history(attempt.signatures);
      if (
        statuses.length !== attempt.signatures.length ||
        statuses.some(
          (status) => status === "ambiguous" || status === "finalized",
        )
      )
        throw new OpsError("launch_reconciliation_required");
      // A second finalized application read follows the history search.
      const reconciled = await deps.observe();
      if (reconciled === "powered-on")
        return {
          ok: true,
          form: attempt.form,
          signatures: attempt.signatures,
          reconciled: true,
        };
      if (reconciled === "foreign-pool-account")
        throw new OpsError("launch_pool_account_foreign");
      if (reconciled === "foreign-mint-account")
        throw new OpsError("launch_mint_account_foreign");
      if (reconciled !== "absent")
        throw new OpsError("launch_mint_exists_without_power_on");
      attempt = null;
    }
    if (!attempt) {
      if (++builds > input.maxBuilds)
        throw new OpsError("launch_attempt_budget_exhausted");
      attempt = await deps.prepare();
      await deps.persist(attempt); // persisted before the first network submission
    }
    // Re-read the mint before entering the persisted-byte broadcast loop.
    const beforeSend = await deps.observe();
    if (beforeSend === "powered-on")
      return {
        ok: true,
        form: attempt.form,
        signatures: attempt.signatures,
        reconciled: true,
      };
    if (beforeSend === "foreign-pool-account")
      throw new OpsError("launch_pool_account_foreign");
    if (beforeSend === "foreign-mint-account")
      throw new OpsError("launch_mint_account_foreign");
    if (beforeSend !== "absent")
      throw new OpsError("launch_mint_exists_without_power_on");
    try {
      await deps.send(attempt);
    } catch {
      deps.emit({
        event: "launch_transport_ambiguous",
        signatures: attempt.signatures,
      });
    }
    await deps.sleep();
  }
  const finalObservation = await deps.observe();
  if (finalObservation === "powered-on")
    return {
      ok: true,
      form: attempt?.form ?? "unknown",
      signatures: attempt?.signatures ?? [],
      reconciled: true,
    };
  if (finalObservation === "foreign-pool-account")
    throw new OpsError("launch_pool_account_foreign");
  if (finalObservation === "foreign-mint-account")
    throw new OpsError("launch_mint_account_foreign");
  if (finalObservation !== "absent")
    throw new OpsError("launch_mint_exists_without_power_on");
  // Persisted signatures remain available for a later invocation; never claim failure.
  return {
    ok: false,
    status: "pending_reconciliation",
    form: attempt?.form,
    signatures: attempt?.signatures ?? [],
  };
}
