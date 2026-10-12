// PLACEHOLDER until the architect's Blink templates
import { BlinkPlaceholder } from "../actions/image-template.js";
import { IMAGE_COPY } from "../actions/image-copy.js";

export interface BlinkFeedCardProps {
  ticker: string;
  mintShort: string;
  royaltyMinSol: string;
  royaltyMaxSol: string;
  state: "open" | "before" | "over" | "paused" | "notInSet" | "off";
  asOf: string;
}
// Interface placeholder only: Feed image routes ship with the post-launch Blink.
export function BlinkFeedCard(props: BlinkFeedCardProps) {
  return BlinkPlaceholder({
    lines: [
      IMAGE_COPY.feedTitle(props.ticker),
      props.mintShort,
      IMAGE_COPY.feedDescription(props.royaltyMinSol, props.royaltyMaxSol),
      IMAGE_COPY.feedState[props.state],
      IMAGE_COPY.asOf(props.asOf),
    ],
  });
}
