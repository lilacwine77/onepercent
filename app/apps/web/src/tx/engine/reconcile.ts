import type { PlanItem } from "./progress";
export async function reconcile<T>(
  items: readonly PlanItem<T>[],
  confirmed: ReadonlySet<string>,
  uncertain: ReadonlySet<string> = new Set(),
  terminal: ReadonlySet<string> = new Set(),
) {
  const landed = new Set(confirmed);
  const unknown = new Set<string>();
  for (const item of items) {
    // A definitive receipt or finalized expiry takes precedence over state
    // reads, which can fail or include unrelated concurrent transactions.
    if (landed.has(item.id) || terminal.has(item.id)) continue;
    try {
      if (await item.landed()) landed.add(item.id);
      else if (uncertain.has(item.id)) unknown.add(item.id);
    } catch {
      unknown.add(item.id);
    }
  }
  // Neither a failed read nor a still-pending submission proves retry is safe.
  return {
    landed,
    unknown,
    retry: items.filter(
      (item) => !landed.has(item.id) && !unknown.has(item.id),
    ),
  };
}
