import { t, count, formatSolDisplay } from "@onepercent/copy/initial";

// Compatibility interface used by X1's architect-owned view.
export const strings = {
  brand: t("brand.name"),
  title: t("nav.xray"),
  addressLabel: t("xray.field.label"),
  placeholder: t("xray.field.placeholder"),
  submit: t("xray.field.submit"),
  loading: t("xray.loading"),
  error: t("xray.error.unavailable"),
  valuesPartial: t("xray.result.partial"),
  noValue: t("common.noValue"),
  share: t("common.shareX"),
  copy: t("common.copyLink"),
  copied: t("common.copied"),
  copyFailed: t("common.copyFailed"),
  feedable: t("xray.section.feedable"),
  checkAtFeed: t("xray.section.checkAtFeed"),
  amountUnavailable: t("xray.amountUnavailable"),
  notFeedable: t("xray.section.notFeedable"),
  sellable: t("xray.section.bid"),
  notInSet: t("xray.section.notInSet"),
  estimatedValue: (value: string) =>
    t("common.est", { sol: formatSolDisplay(value) }),
  rent: (value: string) => t("xray.rentBack", { sol: formatSolDisplay(value) }),
  emptyCount: (value: number) => t("count.emptyAccounts", { n: count(value) }),
};
