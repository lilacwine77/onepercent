import { Suspense, useMemo, type ComponentType, type ReactNode } from "react";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { lazyModule } from "../app/lazy-module";
import { beacon } from "../analytics/client";
export function ExperienceSlot<P extends object>({
  load,
  props,
  placeholder,
  poster,
  component,
}: {
  load: () => Promise<{ default: ComponentType<P> }>;
  props: P;
  placeholder: ReactNode;
  poster?: ReactNode;
  component:
    | "hero"
    | "xray"
    | "feed"
    | "inTheMachine"
    | "rip"
    | "cards"
    | "tv"
    | "verify"
    | "live"
    | "token";
}) {
  // A module already in (preloaded with its route, or shown before) renders at
  // once: no poster flash, nothing after the slot moves.
  const View = useMemo(() => lazyModule(load), [load]);
  return (
    <div className={`experience-slot experience-slot-${component}`}>
      <ErrorBoundary
        fallback={placeholder}
        onError={() => beacon({ event: "experience_error", component })}
      >
        <Suspense
          fallback={
            poster ?? <div className="experience-loading" aria-hidden="true" />
          }
        >
          <View {...props} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
