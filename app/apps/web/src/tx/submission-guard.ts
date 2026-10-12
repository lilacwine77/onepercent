import { EngineError } from "./engine/errors";

type Scope = ReadonlySet<string> | undefined;
type Submission = { until?: number; reconcile?: () => Promise<boolean> };
const active = new Map<string, Set<Scope>>();
const pending = new Map<string, Submission>();
const cards = new Map<string, Map<string, Submission>>();
const storageKey = (wallet: string) => `onepercent.pendingSubmission:${wallet}`;
const cardsStorageKey = (wallet: string) => `${storageKey(wallet)}:cards`;

function scopeKeys(scope?: readonly string[]): Scope {
  if (scope === undefined) return undefined;
  if (!scope.length || scope.some((key) => !key))
    throw new EngineError("errors.generic");
  return new Set(scope);
}

function cardRecords(wallet: string) {
  let records = cards.get(wallet);
  if (!records) cards.set(wallet, (records = new Map()));
  return records;
}

function restore(wallet: string) {
  try {
    const saved = Number(sessionStorage.getItem(storageKey(wallet)));
    if (Number.isSafeInteger(saved) && saved > 0) {
      const record = pending.get(wallet) ?? {};
      record.until = Math.max(record.until ?? 0, saved);
      pending.set(wallet, record);
    }
    const stored: unknown = JSON.parse(
      sessionStorage.getItem(cardsStorageKey(wallet)) ?? "[]",
    );
    if (Array.isArray(stored))
      for (const row of stored) {
        if (
          !Array.isArray(row) ||
          row.length !== 2 ||
          typeof row[0] !== "string" ||
          !row[0] ||
          !Number.isSafeInteger(row[1]) ||
          row[1] <= 0
        )
          continue;
        const records = cardRecords(wallet);
        const record = records.get(row[0]) ?? {};
        record.until = Math.max(record.until ?? 0, row[1]);
        records.set(row[0], record);
      }
  } catch {
    /* The in-memory guard still applies when storage is unavailable. */
  }
}

function saveCards(wallet: string) {
  try {
    const stored = [...(cards.get(wallet) ?? [])].flatMap(([key, record]) =>
      record.until === undefined ? [] : [[key, record.until]],
    );
    if (stored.length)
      sessionStorage.setItem(cardsStorageKey(wallet), JSON.stringify(stored));
    else sessionStorage.removeItem(cardsStorageKey(wallet));
  } catch {
    /* Optional reload recovery. */
  }
}

/** Global plans exclude every flow. Card exits exclude only overlapping cards. */
export async function enterSubmission(
  wallet: string,
  height: () => Promise<number>,
  scope?: readonly string[],
) {
  const selected = scopeKeys(scope);
  let leases = active.get(wallet);
  if (
    leases &&
    [...leases].some(
      (held) =>
        held === undefined ||
        selected === undefined ||
        [...selected].some((key) => held.has(key)),
    )
  )
    throw new EngineError("errors.generic");
  if (!leases) active.set(wallet, (leases = new Set()));
  leases.add(selected);
  const ownedLeases = leases;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    ownedLeases.delete(selected);
    if (!ownedLeases.size && active.get(wallet) === ownedLeases)
      active.delete(wallet);
  };
  try {
    restore(wallet);
    const records: [string | undefined, Submission][] = [];
    const global = pending.get(wallet);
    if (global) records.push([undefined, global]);
    for (const [key, record] of cards.get(wallet) ?? [])
      if (selected === undefined || selected.has(key))
        records.push([key, record]);
    let measured: Promise<number> | undefined;
    const resolved = new Map<() => Promise<boolean>, Promise<boolean>>();
    for (const [key, record] of records) {
      if (record.reconcile) {
        let result = resolved.get(record.reconcile);
        if (!result) {
          result = record.reconcile();
          resolved.set(record.reconcile, result);
        }
        if (!(await result)) throw new EngineError("errors.generic");
      } else if (record.until !== undefined) {
        const current = await (measured ??= height());
        if (!Number.isSafeInteger(current) || current <= record.until)
          throw new EngineError("errors.generic");
      }
      clearSubmission(wallet, key === undefined ? undefined : [key]);
    }
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

export function reconcileSubmission(
  wallet: string,
  resolve: () => Promise<boolean>,
  scope?: readonly string[],
) {
  const selected = scopeKeys(scope);
  if (selected === undefined) {
    const record = pending.get(wallet) ?? {};
    record.reconcile = resolve;
    pending.set(wallet, record);
  } else {
    const records = cardRecords(wallet);
    for (const key of selected) {
      const record = records.get(key) ?? {};
      record.reconcile = resolve;
      records.set(key, record);
    }
  }
}

export function rememberSubmission(
  wallet: string,
  lastValidBlockHeight: number,
  scope?: readonly string[],
) {
  const selected = scopeKeys(scope);
  restore(wallet);
  if (selected === undefined) {
    const record = pending.get(wallet) ?? {};
    record.until = Math.max(record.until ?? 0, lastValidBlockHeight);
    pending.set(wallet, record);
    try {
      sessionStorage.setItem(storageKey(wallet), String(record.until));
    } catch {
      /* Optional reload recovery. */
    }
  } else {
    const records = cardRecords(wallet);
    for (const key of selected) {
      const record = records.get(key) ?? {};
      record.until = Math.max(record.until ?? 0, lastValidBlockHeight);
      records.set(key, record);
    }
    saveCards(wallet);
  }
}

/** Omitting the scope clears only the global record, never unrelated card exits. */
export function clearSubmission(wallet: string, scope?: readonly string[]) {
  const selected = scopeKeys(scope);
  restore(wallet);
  if (selected === undefined) {
    pending.delete(wallet);
    try {
      sessionStorage.removeItem(storageKey(wallet));
    } catch {
      /* Optional reload recovery. */
    }
  } else {
    const records = cards.get(wallet);
    for (const key of selected) records?.delete(key);
    if (!records?.size) cards.delete(wallet);
    saveCards(wallet);
  }
}
