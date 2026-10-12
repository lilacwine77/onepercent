import { t } from "@onepercent/copy/initial";
import { useConfig } from "../data/config";
export const RESCUE_PATH = "/rescue";
export function RescueLink() {
  return (
    <a href={RESCUE_PATH} rel="external">
      {t("common.rescueLink")}
    </a>
  );
}
export function OfflineBanner() {
  const config = useConfig();
  return config.error ? (
    <aside role="status">
      <p>{t("common.offline")}</p>
      <RescueLink />
    </aside>
  ) : null;
}
