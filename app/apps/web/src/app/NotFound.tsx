import { t } from "@onepercent/copy/initial";
export default function NotFound() {
  return (
    <section>
      <h1 tabIndex={-1}>{t("title.notFound")}</h1>
      <p>{t("common.notFound")}</p>
      <a href="/">{t("common.home")}</a>
    </section>
  );
}
