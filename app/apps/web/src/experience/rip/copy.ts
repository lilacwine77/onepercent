import { PACK_EDITIONS } from "@onepercent/config/web";
import { t } from "@onepercent/copy";
// The issued deck is the single string source for the Rip host.
export const copy = (
  key: import("@onepercent/copy").CopyKey,
  vars: Record<string, string> = {},
) =>
  t(
    key,
    vars as import("@onepercent/copy").CopyVars<
      import("@onepercent/copy").CopyKey
    >,
  );
export const insufficient = (sol: string) =>
  t("errors.insufficientSol", { sol });
export const editions = PACK_EDITIONS.map((edition) => ({
  id: edition.id,
  name: edition.name,
  priceLamports: edition.priceLamports,
  price: (Number(edition.priceLamports) / 1e9).toFixed(2),
}));
export type EditionId = (typeof PACK_EDITIONS)[number]["id"];
export const THUMBS: Record<EditionId, string> = {
  original: "thumb-silver.webp",
  blue_shift: "thumb-first-light.webp",
  signature: "thumb-closed.webp",
  after_hours: "thumb-anthracite.webp",
};
