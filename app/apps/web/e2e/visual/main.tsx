import "../../src/zod-setup";
import { StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import { App } from "../../src/App";
import "../../src/styles.css";

function VisualApp() {
  useEffect(() => {
    const ready = (image: HTMLImageElement) => {
      const mark = () => {
        image.dataset.ready = "";
      };
      if (typeof image.decode === "function")
        void image.decode().then(mark, mark);
      else mark();
    };
    const loaded = (event: Event) => {
      if (event.target instanceof HTMLImageElement) ready(event.target);
    };
    document.addEventListener("load", loaded, true);
    document.querySelectorAll("img").forEach((image) => {
      if (image.complete) ready(image);
    });
    return () => document.removeEventListener("load", loaded, true);
  }, []);
  return <App />;
}

// The harness owns this container. Reuse its root even if HMR reevaluates entry.
const container = document.getElementById("root") as
  (HTMLElement & { __visualRoot?: Root }) | null;
if (!container) throw new Error("The visual fixture root is missing.");
const root = (container.__visualRoot ??= createRoot(container));
root.render(
  <StrictMode>
    <VisualApp />
  </StrictMode>,
);
