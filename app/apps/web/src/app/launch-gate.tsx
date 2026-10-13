import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export function launchRemainingSeconds(now = Date.now()) {
  const at = Date.parse(import.meta.env.VITE_LAUNCH_AT ?? "");
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

export function isLaunchPublicPath(pathname: string) {
  return pathname === "/" || pathname === "/docs";
}

/** Apply before standalone routes can mount, and on in-app navigation. */
export function redirectBeforeLaunch() {
  if (
    launchRemainingSeconds() &&
    !isLaunchPublicPath(window.location.pathname)
  ) {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

const LaunchContext = createContext(0);
export const useLaunchGate = () => useContext(LaunchContext);

export function LaunchGateProvider({ children }: { children: ReactNode }) {
  const [remaining, setRemaining] = useState(launchRemainingSeconds);
  useEffect(() => {
    const at = Date.parse(import.meta.env.VITE_LAUNCH_AT ?? "");
    if (!Number.isFinite(at)) return;
    let timeout: ReturnType<typeof setTimeout>;
    let opened = false;
    function update() {
      clearTimeout(timeout);
      const now = Date.now();
      const ms = at - now;
      opened ||= ms <= 0;
      setRemaining(opened ? 0 : Math.ceil(ms / 1000));
      // Read wall time again after throttling or sleep; never decrement ticks.
      if (!opened && !document.hidden)
        timeout = setTimeout(update, Math.min(1000, ms));
    }
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return <LaunchContext value={remaining}>{children}</LaunchContext>;
}
