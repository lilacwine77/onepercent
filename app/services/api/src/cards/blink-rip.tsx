// PLACEHOLDER until the architect's Blink templates
import type { EditionId } from "@onepercent/config";
import { BlinkPlaceholder } from "../actions/image-template.js";
import { IMAGE_COPY } from "../actions/image-copy.js";

export interface BlinkRipCardProps {
  edition: EditionId | null;
  name: string | null;
  priceSol: string | null;
  state:
    | "covered"
    | "refilling"
    | "hungry"
    | "busy"
    | "paused"
    | "beforeOnAir"
    | "seasonOver"
    | "off";
  upTo: number | null;
  jackpot: { amount: string; valueSol: string | null; live: boolean } | null;
  onePct: { card: number; of: number } | null;
  asOf: string;
}

export function BlinkRipCard(props: BlinkRipCardProps) {
  return BlinkPlaceholder({
    lines: [
      props.name !== null && props.priceSol !== null
        ? IMAGE_COPY.title(props.name, props.priceSol)
        : IMAGE_COPY.genericTitle,
      IMAGE_COPY.state[props.state],
      props.upTo === null ? "" : IMAGE_COPY.upTo(props.upTo),
      props.jackpot?.live
        ? IMAGE_COPY.jackpot(props.jackpot.amount, props.jackpot.valueSol)
        : "",
      props.onePct ? IMAGE_COPY.onePct(props.onePct.card, props.onePct.of) : "",
      IMAGE_COPY.contents,
      IMAGE_COPY.asOf(props.asOf),
    ],
  });
}
