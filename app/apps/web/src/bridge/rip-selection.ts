import type { EditionId } from "@onepercent/config";
import { navigate } from "../routes/router";

/** Keep the router's external store in sync with in-place pack selections. */
export function replaceRipSelection(edition: EditionId, quantity: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("edition", edition);
  url.searchParams.set("n", String(quantity));
  navigate(url.href, true);
}
