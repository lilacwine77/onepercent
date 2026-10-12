import { useCallback, useSyncExternalStore } from "react";
import { LiveStream, stoppedLiveSnapshot } from "./stream";
export const liveStream = new LiveStream();
const stopped = () => stoppedLiveSnapshot;
/** Shared transport lifetime; no provider, wallet or event data is rendered here. */
export function useLive(enabled = true, stream = liveStream) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) return () => undefined;
      const unsubscribe = stream.subscribe(listener);
      const release = stream.retain();
      return () => {
        unsubscribe();
        release();
      };
    },
    [enabled, stream],
  );
  return useSyncExternalStore(
    subscribe,
    enabled ? stream.snapshot : stopped,
    stopped,
  );
}
