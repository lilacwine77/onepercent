import { Suspense } from "react";
import { t } from "@onepercent/copy";
import { demoFlow } from "../../app/preview";
import { lazyModule, preloadModule } from "../../app/lazy-module";
// Preview builds (VITE_PREVIEW=1) run this flow on its demo adapter while
// /api/web/config says so; a production build drops this branch.
const loadDemo = () => import("../../demo/pages/DemoRip");
const loadLive = () => import("../../bridge/RipLive");
const Live = lazyModule(loadLive);
const Demo = import.meta.env.VITE_PREVIEW === "1" ? lazyModule(loadDemo) : null;
/** Preload the chosen adapter and architect's component before route focus. */
export const ready = () =>
  Demo && demoFlow("rip")
    ? preloadModule(loadDemo).then((m) => m.ready?.())
    : preloadModule(loadLive).then((m) => m.ready());
export default function Rip() {
  if (Demo && demoFlow("rip"))
    return (
      <Suspense
        fallback={
          <div className="route-loading" role="status">
            <span className="sr-only">{t("common.loading")}</span>
          </div>
        }
      >
        <Demo />
      </Suspense>
    );
  return (
    <>
      <Suspense
        fallback={
          <section>
            <h1 tabIndex={-1}>{t("nav.rip")}</h1>
            <p role="status">{t("common.loading")}</p>
          </section>
        }
      >
        <Live />
      </Suspense>
    </>
  );
}
