import { useLive } from "./use-live";
/** Holds the shared live stream open while it is mounted (TV_LIVE on). */
export default function LiveStreamKeeper() {
  useLive(true);
  return null;
}
