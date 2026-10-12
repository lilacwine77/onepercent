/**
 * PREVIEW builds only (VITE_PREVIEW=1): one app, live where a flow's track has
 * landed and on its demo adapter where it has not. main.tsx imports this behind
 * `import.meta.env.VITE_PREVIEW === "1"`, so a production build drops it
 * (scripts/check-dist.mjs asserts it). Runs before the app renders.
 */
import { WebConfigResponse, type WebConfig } from "@onepercent/web-api";
import { installApi } from "./api";
import { badge } from "./badge";
import { resolveModes } from "./modes";
import { demo } from "./store";
import { DEMO_WALLET_NAME, demoAddress, registerDemoWallet } from "./wallet";
import "./demo.css";

export { DEMO_MARKER } from "./badge";
const CONFIG_TIMEOUT_MS = 2_500;

/** The API's web config, or null when the preview runs without an API. */
async function webConfig(): Promise<WebConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
  try {
    const response = await fetch("/api/web/config", {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return WebConfigResponse.parse(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function boot() {
  const web = await webConfig();
  const modes = resolveModes(web?.modes);
  // Read by app/preview.ts: each route picks its live page or its demo adapter.
  (globalThis as { onepercentPreview?: unknown }).onepercentPreview = {
    modes,
  };
  installApi(modes, web);
  if (modes.wallet === "demo") {
    const address = demoAddress();
    demo.use(address);
    registerDemoWallet(address);
    try {
      // The demo wallet connects itself once, like a returning user's wallet.
      if (!localStorage.getItem("onepercent.demo.seen")) {
        localStorage.setItem("onepercent.wallet", DEMO_WALLET_NAME);
        localStorage.setItem("onepercent.demo.seen", "1");
      }
    } catch {
      /* Connect by hand. */
    }
  }
  badge(modes);
}
