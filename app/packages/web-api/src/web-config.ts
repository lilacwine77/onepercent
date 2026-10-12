import { z } from "zod";
import { PublicKeyString } from "./primitives.js";
/**
 * The flows a preview build can run on a demo adapter while their track lands.
 * Production web builds contain no demo code and ignore `modes`.
 */
export const PREVIEW_FLOWS = [
  "xray",
  "feed",
  "rip",
  "cards",
  "verify",
  "wallet",
] as const;
export type PreviewFlow = (typeof PREVIEW_FLOWS)[number];
export const FlowMode = z.enum(["live", "demo"]);
export type FlowMode = z.infer<typeof FlowMode>;
export const FlowModes = z.strictObject(
  Object.fromEntries(
    PREVIEW_FLOWS.map((flow) => [flow, FlowMode.optional()]),
  ) as Record<PreviewFlow, z.ZodOptional<typeof FlowMode>>,
);
export const WebConfigResponse = z.strictObject({
  lookupTable: PublicKeyString.nullable(),
  adminMultisig: PublicKeyString.nullable(),
  flags: z.strictObject({ XRAY: z.boolean() }),
  /** Optional and additive: sent only when the API sets WEB_FLOW_MODES. */
  modes: FlowModes.optional(),
});
export type WebConfig = z.infer<typeof WebConfigResponse>;
export const webConfigResponseSchema = WebConfigResponse;
