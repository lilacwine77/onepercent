import { Suspense } from "react";
import { t } from "@onepercent/copy";
import { demoFlow } from "../../app/preview";
import { lazyModule, preloadModule } from "../../app/lazy-module";
// Preview builds (VITE_PREVIEW=1) run this flow on its demo adapter while
// /api/web/config says so; a production build drops this branch.
const loadLive = () => import("../../bridge/LiveFeed");
const Live = lazyModule(loadLive);
const loadDemo = () => import("../../demo/pages/DemoFeed");
const Demo = import.meta.env.VITE_PREVIEW === "1" ? lazyModule(loadDemo) : null;
/** What this page renders first, for the router's preload (preview builds). */
export const ready = () =>
  Demo && demoFlow("feed")
    ? preloadModule(loadDemo).then((m) => m.ready?.())
    : preloadModule(loadLive).then((m) => m.ready?.());
export default function Feed() {
  if (Demo && demoFlow("feed"))
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
    <Suspense
      fallback={
        <div className="route-loading" role="status">
          <span className="sr-only">{t("common.loading")}</span>
        </div>
      }
    >
      <Live />
    </Suspense>
  );
}
