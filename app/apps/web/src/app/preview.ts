import type { PreviewFlow } from "@onepercent/web-api";
/**
 * Preview builds only (VITE_PREVIEW=1): whether a flow runs on its demo adapter.
 * src/demo/boot.ts reads the modes from /api/web/config before the app starts.
 * Production builds fold this to `false` and drop every demo branch.
 */
export function demoFlow(flow: PreviewFlow): boolean {
  if (import.meta.env.VITE_PREVIEW !== "1") return false;
  const preview = (
    globalThis as { onepercentPreview?: { modes: Record<string, string> } }
  ).onepercentPreview;
  return preview?.modes[flow] === "demo";
}
