import { CARD_LINES, CARD_TITLES, CARD_CONDITIONS } from "./copy.js";
import type { XrayResult } from "./xray-result.js";
export interface CardCopyInput {
  address: string;
  bags: number;
  dust: number;
  empties: number;
  worst: { ticker: string; drawdownPct: number } | null;
}
export function fnv1a32(value: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value))
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}
export function cardCopy({
  address,
  bags,
  dust,
  empties,
  worst,
}: CardCopyInput): XrayResult["card"] {
  const condition =
    CARD_CONDITIONS[
      bags === 0
        ? 0
        : bags <= 3
          ? 1
          : bags <= 10
            ? 2
            : bags <= 30
              ? 3
              : bags <= 80
                ? 4
                : 5
    ];
  const title =
    bags === 0
      ? CARD_TITLES.clean
      : worst && worst.drawdownPct >= 99.5
        ? CARD_TITLES.lastDecimal
        : bags >= 50
          ? CARD_TITLES.collector
          : dust * 10 >= bags * 7
            ? CARD_TITLES.dust
            : CARD_TITLES.holder;
  if (bags === 0) return { condition, title, oneLiner: CARD_LINES.clean };
  const lines: string[] = [CARD_LINES.collection];
  if (worst && worst.drawdownPct >= 96) lines.push(CARD_LINES.holding);
  lines.push(CARD_LINES.tops);
  if (bags >= 2 && dust >= 2 && empties >= 2)
    lines.push(CARD_LINES.counts(bags, dust, empties));
  if (worst) lines.push(CARD_LINES.worst(worst.ticker, worst.drawdownPct));
  lines.push(CARD_LINES.charts, CARD_LINES.hands);
  return {
    condition,
    title,
    oneLiner: lines[fnv1a32(address) % lines.length]!,
  };
}
