import { FEED_RULES, WEB } from "@onepercent/config";
import { ValuesResponse } from "@onepercent/web-api";
import type { SelectedCard } from "../adapters/cards";
import { api } from "../data/api";
import type { ActionPreview } from "../experience";

/** The confirmation compares only executable quotes requested for this exact selection. */
export async function feedBackValues(
  cards: readonly SelectedCard[],
): Promise<NonNullable<ActionPreview["feedBackValues"]>> {
  const result: NonNullable<ActionPreview["feedBackValues"]> = {};
  for (let start = 0; start < cards.length; start += WEB.valuesBatchMax) {
    const batch = cards.slice(start, start + WEB.valuesBatchMax);
    const response = await api("/api/values", ValuesResponse, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "now",
        items: batch.map((card) => ({
          mint: card.mint.toBase58(),
          amount: card.amount.toString(),
        })),
      }),
    }).catch(() => null);
    for (const card of batch) {
      const values =
        response?.items.filter(
          (item) =>
            item.mint === card.mint.toBase58() && item.amount === card.amount,
        ) ?? [];
      const quoted = values.length === 1 ? values[0]?.value : null;
      const value =
        quoted?.status === "ok" && quoted.label === "if_sold_now"
          ? { kind: "now" as const, lamports: quoted.lamports }
          : { kind: "none" as const };
      result[card.cardId] = {
        value,
        needsConfirm:
          value.kind === "none" ||
          value.lamports > FEED_RULES.confirmAboveLamports,
      };
    }
  }
  return result;
}
