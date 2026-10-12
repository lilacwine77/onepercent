import { feedBackEstimate } from "@onepercent/config/feed-back";
import { WEB } from "@onepercent/config/web";
import { z } from "zod";
import { demoFlow } from "../app/preview";
import { api } from "./api";
import { Resource, resource, useResource } from "./resource";

/**
 * What one Dust Card pays when it's pulled at the documented default edition mix
 * (`FEED_BACK_DEFAULT_MIX`): the demo machine's estimate, and the fallback without
 * the machine.
 */
export const DEFAULT_FEED_BACK_ESTIMATE = feedBackEstimate([]);

const MachineFeedBack = z.object({
  feedBack: z.object({ estimate: z.string().regex(/^\d{1,20}$/) }),
});

/**
 * What one Dust Card is expected to pay when it's pulled (lamports), at the
 * machine's recent edition mix (/api/machine feedBack); without the machine (not
 * configured, offline), the default mix's estimate.
 */
export const feedBackResource = resource(
  "/api/machine#feedBack",
  async (signal) => {
    try {
      const machine = await api("/api/machine", MachineFeedBack, { signal });
      return BigInt(machine.feedBack.estimate);
    } catch {
      return DEFAULT_FEED_BACK_ESTIMATE;
    }
  },
  WEB.configRefreshMs,
);
/** The demo machine has no pulls to weigh: the default mix, never fetched. */
const demoEstimate = new Resource(
  async () => DEFAULT_FEED_BACK_ESTIMATE,
  WEB.configRefreshMs,
);

/**
 * The Feed back estimate every surface shows (X-ray, Feed, My cards): the live
 * machine's, or the default mix's while the machine flows run on the demo adapter
 * (preview builds), so the X-ray → Feed → My cards journey shows one number.
 */
export function useFeedBackEstimate(): bigint {
  const source = demoFlow("feed") ? demoEstimate : feedBackResource;
  return useResource(source).data ?? DEFAULT_FEED_BACK_ESTIMATE;
}
