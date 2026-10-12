import { BeaconEvent, type Beacon } from "@onepercent/web-api";
export function beacon(event: Beacon) {
  if (
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl ||
    navigator.doNotTrack === "1"
  )
    return;
  const parsed = BeaconEvent.safeParse(event);
  if (!parsed.success) return;
  try {
    navigator.sendBeacon?.(
      "/api/beacon",
      new Blob([JSON.stringify(parsed.data)], { type: "application/json" }),
    );
  } catch {
    /* Analytics never affects a flow. */
  }
}
