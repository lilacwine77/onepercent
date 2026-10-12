import {
  FlowMode,
  PREVIEW_FLOWS,
  WebConfigResponse,
  type PreviewFlow,
  type WebConfig,
} from "@onepercent/web-api";
function xrayFlag(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return false;
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  throw new Error("Invalid web configuration");
}
/**
 * WEB_FLOW_MODES: which flows a preview web build runs live or on its demo
 * adapter, e.g. `xray=live,feed=demo,rip=demo`. Unset: no `modes` key at all, so
 * production responses do not change.
 */
function flowModes(value: string | undefined): WebConfig["modes"] {
  if (value === undefined || value.trim() === "") return undefined;
  const modes: NonNullable<WebConfig["modes"]> = {};
  for (const pair of value.split(/[\s,]+/).filter(Boolean)) {
    const [flow, mode, extra] = pair.split("=");
    const parsed = FlowMode.safeParse(mode);
    if (
      extra !== undefined ||
      !PREVIEW_FLOWS.includes(flow as PreviewFlow) ||
      !parsed.success
    )
      throw new Error("Invalid web configuration");
    modes[flow as PreviewFlow] = parsed.data;
  }
  return modes;
}
export function readWebConfig(env: NodeJS.ProcessEnv): WebConfig {
  const modes = flowModes(env.WEB_FLOW_MODES);
  return WebConfigResponse.parse({
    lookupTable: env.PROTOCOL_LUT_ADDRESS?.trim() || null,
    adminMultisig: env.ADMIN_MULTISIG_ADDRESS?.trim() || null,
    flags: { XRAY: xrayFlag(env.FLAG_XRAY) },
    ...(modes ? { modes } : {}),
  });
}
