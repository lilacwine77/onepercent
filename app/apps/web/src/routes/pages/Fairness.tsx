import { Suspense } from "react";
import { t } from "@onepercent/copy";
import { lazyModule, preloadModule } from "../../app/lazy-module";
const loadLive = () => import("../../bridge/PublicLive");
const View = lazyModule(loadLive);
export const ready = () =>
  preloadModule(loadLive).then((module) => module.ready());
export default function Fairness() {
  return (
    <>
      <Suspense
        fallback={
          <div className="route-loading" role="status">
            <span className="sr-only">{t("common.loading")}</span>
          </div>
        }
      >
        <View kind="fairness" />
      </Suspense>
    </>
  );
}
