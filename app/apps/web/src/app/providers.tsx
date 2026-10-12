import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { WEB } from "@onepercent/config/web";
import { useConfig, useWebConfig } from "../data/config";
import { serverTime } from "../data/server-time";
import { useFlag } from "../data/flags";
import { WalletProvider } from "../wallet/WalletProvider";
// The live stream keeps its connection only while TV_LIVE is on; its code (the SSE
// transport and its event schemas) loads then, never with the first page.
const LiveStreamKeeper = lazy(() => import("../data/live-keeper"));
export function Providers({ children }: { children: ReactNode }) {
  useWebConfig();
  const machine = useConfig();
  const machineAvailable = Boolean(machine.data && !machine.error);
  const live = useFlag("TV_LIVE");
  useEffect(() => {
    if (!machineAvailable) return;
    const controller = new AbortController();
    const refresh = () => void serverTime.refresh(controller.signal);
    refresh();
    const interval = setInterval(refresh, WEB.configRefreshMs);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [machineAvailable]);
  return (
    <WalletProvider>
      {live && (
        <Suspense fallback={null}>
          <LiveStreamKeeper />
        </Suspense>
      )}
      {children}
    </WalletProvider>
  );
}
