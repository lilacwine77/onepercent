/**
 * PREVIEW builds only: which flows run live and which on their demo adapter.
 * /api/web/config is the source of truth (`modes`, set by the API's
 * WEB_FLOW_MODES); a flow it does not name, or a preview without the API, runs
 * on its demo adapter (the safe choice).
 */
import {
  PREVIEW_FLOWS,
  type FlowMode,
  type PreviewFlow,
  type WebConfig,
} from "@onepercent/web-api";

export type Modes = Record<PreviewFlow, FlowMode>;
export const resolveModes = (modes: WebConfig["modes"] | undefined): Modes =>
  Object.fromEntries(
    PREVIEW_FLOWS.map((flow) => [flow, modes?.[flow] ?? "demo"]),
  ) as Modes;
/** The flow a route belongs to (the header's Live / Demo label). */
export function flowOfPath(pathname: string): PreviewFlow | null {
  if (pathname === "/x" || pathname.startsWith("/x/")) return "xray";
  if (pathname === "/feed") return "feed";
  if (pathname === "/rip" || pathname === "/packs") return "rip";
  if (pathname === "/cards" || pathname === "/me") return "cards";
  if (pathname.startsWith("/verify/")) return "verify";
  return null;
}
export const machineFlows = (modes: Modes) =>
  modes.feed === "demo" && modes.rip === "demo" && modes.cards === "demo";
