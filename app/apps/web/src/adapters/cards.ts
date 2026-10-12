import {
  FEED_RULES,
  CARD_KINDS,
  HIT_TIERS,
  PACK_EDITIONS,
  PAUSE_BITS,
  TX_LIMITS,
} from "@onepercent/config";
import { amount, cardTicker, t, type CopyKey } from "@onepercent/copy";
import type {
  Card,
  Config,
  Machine,
  decodeBinder,
} from "@onepercent/sdk/browser";
import { PHASE } from "@onepercent/sdk/constants";
import type { SellBackRefusalReason } from "@onepercent/sdk/api";
import type { ValuesOutput } from "@onepercent/web-api";
import type { CardRow } from "../experience";
import { EngineError } from "../tx/engine/errors";

export type Binder = ReturnType<typeof decodeBinder>;
export type SelectedCard = Card & { cardId: string; cardIndex: number };
const kinds = CARD_KINDS;
const opened = { open: true, reason: null } as const;
const closed = { open: false, reason: null } as const;

/** The identity is independent of the current swap-remove index. */
export function identifyCards(cards: readonly Card[]): SelectedCard[] {
  const ordinals = new Map<string, number>();
  return cards.map((card, cardIndex) => {
    const base = `${card.seq_lo}:${card.kind}:${card.mint.toBase58()}:${card.amount}`;
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    return { ...card, cardIndex, cardId: `${base}:${ordinal}` };
  });
}

export function resolveCards(binder: Binder | null, ids: readonly string[]) {
  const rows = identifyCards(binder?.cards ?? []);
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new EngineError("errors.cardMoved");
  const selected = ids.map((id) => rows.find((card) => card.cardId === id));
  if (selected.some((card) => !card)) throw new EngineError("errors.cardMoved");
  return (selected as SelectedCard[]).sort((a, b) => b.cardIndex - a.cardIndex);
}

/** Descending order across transactions is required by Binder swap-remove. */
export function cardBatches(cards: readonly SelectedCard[], byMint = false) {
  const pending = [...cards].sort((a, b) => b.cardIndex - a.cardIndex);
  const batches: SelectedCard[][] = [];
  while (pending.length) {
    const batch: SelectedCard[] = [];
    const mint = pending[0]!.mint;
    for (
      let i = 0;
      i < pending.length && batch.length < TX_LIMITS.redeemPerTx;
    ) {
      if (!byMint || pending[i]!.mint.equals(mint))
        batch.push(...pending.splice(i, 1));
      else i++;
    }
    batches.push(batch);
  }
  return batches;
}

export function binderClosable(binder: Binder | null): boolean {
  return (
    !!binder &&
    binder.cards.length === 0 &&
    binder.len === 0 &&
    binder.reserved === 0 &&
    binder.fresh_in_deck === 0 &&
    binder.sol_owed === 0n &&
    (binder.season_spend === 0n || (binder.flags & (1 | 2)) === (1 | 2))
  );
}

export function sellRefusal(reason: SellBackRefusalReason): CopyKey {
  if (reason === "SOL_FLOOR" || reason === "HOURLY_BUDGET")
    return "cards.sell.refusal.refilling";
  if (reason === "MINT" || reason === "BUCKET_DISABLED" || reason === "CAP")
    return "cards.sell.refusal.coin";
  if (reason === "QUOTE_UNAVAILABLE") return "cards.sell.refusal.noPrice";
  return "cards.sell.refusal.closed";
}

export interface CardsGates {
  config: Config | null;
  machine: Machine | null;
  nowTs: bigint;
  feed: boolean;
  sell: boolean;
}

export function actionGates(
  kind: number,
  input: CardsGates,
): CardRow["actions"] {
  const { config, machine } = input;
  const paused = (config?.admin_paused ?? 0) | (config?.guardian_paused ?? 0);
  const ended =
    !machine || (machine.end_ts !== 0n && input.nowTs >= machine.end_ts);
  const sellOpen =
    !!config &&
    !!machine &&
    input.sell &&
    !ended &&
    machine.phase === PHASE.onAir &&
    !(paused & PAUSE_BITS.sellBack) &&
    machine.exec.kind === 0;
  const feedOpen =
    !!config &&
    !!machine &&
    input.feed &&
    !ended &&
    machine.phase >= PHASE.stockUp &&
    machine.phase <= PHASE.onAir &&
    !(paused & PAUSE_BITS.feed) &&
    machine.exec.kind === 0;
  return {
    redeem: opened,
    sellBack:
      kind >= 1 && kind <= HIT_TIERS.length
        ? sellOpen
          ? opened
          : { open: false, reason: { key: "cards.sell.refusal.closed" } }
        : closed,
    feedBack:
      kind === 0
        ? feedOpen
          ? opened
          : { open: false, reason: { key: "errors.paused" } }
        : closed,
  };
}

export function cardRows(
  input: CardsGates & {
    binder: Binder | null;
    values?: ValuesOutput["items"];
    decimals?: ReadonlyMap<string, number>;
    sellQuotes?: ReadonlyMap<string, { lamports: bigint; expiresAt: bigint }>;
    sellRefusals?: ReadonlyMap<string, CopyKey>;
  },
): CardRow[] {
  return identifyCards(input.binder?.cards ?? []).map((card) => {
    const kind = kinds[card.kind];
    const edition = PACK_EDITIONS[card.edition]?.id ?? null;
    if (!kind || (kind !== "final" && !edition))
      throw new Error("Invalid card kind or edition");
    const mint = card.mint.toBase58();
    const display = input.values?.find(
      (row) => row.mint === mint && row.amount === card.amount,
    );
    const decimals = input.decimals?.get(mint) ?? display?.decimals;
    const quote = input.sellQuotes?.get(card.cardId);
    const sellQuote = quote && quote.expiresAt >= input.nowTs ? quote : null;
    const gates = actionGates(card.kind, input);
    const refusal = input.sellRefusals?.get(card.cardId);
    if (refusal) gates.sellBack = { open: false, reason: { key: refusal } };
    const hit = card.kind >= 1 && card.kind <= HIT_TIERS.length;
    const value: CardRow["value"] =
      !hit && display?.value.status === "ok"
        ? {
            kind: display.value.label === "est" ? "est" : "now",
            lamports: BigInt(display.value.lamports),
          }
        : { kind: "none" };
    return {
      cardId: card.cardId,
      kind,
      edition: kind === "final" ? null : edition,
      seq: `${card.seq_lo}`,
      coin: {
        mint,
        ticker: cardTicker(display?.symbol ?? "", mint),
        name: display?.name ?? mint,
        logoUrl: display?.logo ?? null,
      },
      amountUi:
        decimals === null || decimals === undefined
          ? t("common.noValue")
          : amount(card.amount, decimals),
      stockedLamports: hit ? card.value : null,
      value,
      sellBack:
        hit && sellQuote ? { kind: "now", lamports: sellQuote.lamports } : null,
      actions: gates,
      feedBackNeedsConfirm:
        card.kind === 0 &&
        (value.kind === "none" ||
          value.lamports > FEED_RULES.confirmAboveLamports),
    };
  });
}
