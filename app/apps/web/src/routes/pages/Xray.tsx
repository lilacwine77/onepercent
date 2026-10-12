import { t } from "@onepercent/copy/initial";
import { useWebConfig } from "../../data/config";
import { flagEnabled } from "../../data/flags";
import { XrayPage } from "../../xray/xray-page";
export default function Xray({
  address,
  search,
}: {
  address: string;
  search: string;
}) {
  const config = useWebConfig();
  if (flagEnabled(config, "XRAY"))
    return <XrayPage input={address} search={search} />;
  return (
    <section>
      <h1 tabIndex={-1}>{t("nav.xray")}</h1>
      <p>{t(config.loading ? "common.loading" : "xray.error.unavailable")}</p>
    </section>
  );
}
