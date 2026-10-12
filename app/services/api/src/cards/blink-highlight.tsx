// PLACEHOLDER until the architect's Blink templates
import { BlinkPlaceholder } from "../actions/image-template.js";
import { IMAGE_COPY } from "../actions/image-copy.js";

export interface BlinkHighlightCardProps {
  kind: "silver" | "blue" | "holo" | "black" | "jackpot" | "one_pct";
  title: string;
  valueLine: string;
  edition: string;
  buyer: string;
  seq: string;
  asOf: string;
}
// Interface placeholder only: Highlight image routes follow the post-launch Blink.
export function BlinkHighlightCard(props: BlinkHighlightCardProps) {
  return BlinkPlaceholder({
    lines: [
      props.title,
      props.valueLine,
      props.edition,
      props.buyer,
      props.seq,
      IMAGE_COPY.asOf(props.asOf),
    ],
  });
}
