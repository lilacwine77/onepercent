import type { ReactNode } from "react";
import { t } from "@onepercent/copy";
import { webDeployment } from "../data/deployment";

/** Unconfigured builds keep navigation usable without inventing a deployment. */
export function DeploymentGate({
  flow,
  children,
}: {
  flow: "rip" | "cards";
  children: ReactNode;
}) {
  try {
    webDeployment();
  } catch {
    return (
      <section>
        <h1 tabIndex={-1}>{t(`nav.${flow}`)}</h1>
        <p role="status">{t("public.chainUnavailable")}</p>
      </section>
    );
  }
  return children;
}
