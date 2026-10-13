import "./zod-setup";
import "./app/poster-preload";
import {
  lazy,
  StrictMode,
  Suspense,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import { App } from "./App";
import { redirectBeforeLaunch } from "./app/launch-gate";
import { reloadOnce } from "./app/chunk-reload";
import { matchGoRoute } from "./go/route";
import { matchLinkRoute } from "./link/route";
import "./styles.css";

const GoPage = lazy(() =>
  import("./go/GoPage").then(({ GoPage }) => ({ default: GoPage })),
);
const LinkPage = lazy(() =>
  import("./link/LinkPage").then(({ LinkPage }) => ({ default: LinkPage })),
);
function FocusHeading({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const heading = document.querySelector<HTMLElement>("h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, []);
  return children;
}

// A deploy replaced the chunks this page was built with (a lazy import 404s):
// load the new build once. Within 30 s of that reload, a second failure is real
// and goes to the error boundary, whose Try again reloads (ErrorBoundary.tsx).
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnce()) event.preventDefault();
});
// Images marked to fade (styles.css img[data-fade]) appear once downloaded and
// decoded: never half-painted, and no decode on the frame they show.
document.addEventListener(
  "load",
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const ready = () => {
      image.dataset.ready = "";
    };
    if (typeof image.decode !== "function") return ready();
    image.decode().then(ready, ready);
  },
  true,
);
const root = document.getElementById("root");
if (!root) throw new Error("The page root is missing.");
redirectBeforeLaunch();
const goId = matchGoRoute(window.location.pathname);
const linkNonce = matchLinkRoute(window.location.pathname);

const start = () =>
  createRoot(root).render(
    <StrictMode>
      {goId ? (
        <Suspense fallback={null}>
          <FocusHeading>
            <GoPage id={goId} />
          </FocusHeading>
        </Suspense>
      ) : linkNonce ? (
        <Suspense fallback={null}>
          <FocusHeading>
            <LinkPage nonce={linkNonce} />
          </FocusHeading>
        </Suspense>
      ) : (
        <App />
      )}
    </StrictMode>,
  );
// Preview builds only (VITE_PREVIEW=1): each flow runs live or on its demo
// adapter (src/demo), as /api/web/config says; production drops this branch.
if (import.meta.env.VITE_PREVIEW === "1")
  void import("./demo/boot")
    .then((preview) => preview.boot())
    .then(start, start);
else start();
