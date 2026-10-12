import { Suspense } from "react";
import { t } from "@onepercent/copy";
import { demoFlow } from "../../app/preview";
import { lazyModule, preloadModule } from "../../app/lazy-module";
// Preview builds (VITE_PREVIEW=1) show demo draws here while /api/web/config
// says so; a production build drops this branch.
const loadDemo = () => import("../../demo/pages/DemoVerify");
const loadLive = () => import("../../bridge/PublicLive");
const Live = lazyModule(loadLive);
const Demo = import.meta.env.VITE_PREVIEW === "1" ? lazyModule(loadDemo) : null;
/** What this page renders first, for the router's preload (preview builds). */
export const ready = () =>
  Demo && demoFlow("verify")
    ? preloadModule(loadDemo).then((m) => m.ready?.())
    : preloadModule(loadLive).then((m) => m.ready());
export default function Verify({ pull }: { pull: string }) {
  if (Demo && demoFlow("verify"))
    return (
      <Suspense
        fallback={
          <div className="route-loading" role="status">
            <span className="sr-only">{t("common.loading")}</span>
          </div>
        }
      >
        <Demo pull={pull} />
      </Suspense>
    );
  return (
    <>
      <Suspense
        fallback={
          <div className="route-loading" role="status">
            <span className="sr-only">{t("common.loading")}</span>
          </div>
        }
      >
        <Live kind="verify" identifier={pull} />
      </Suspense>
    </>
  );
}
