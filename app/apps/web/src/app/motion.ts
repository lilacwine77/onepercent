import { useEffect, useState } from "react";
const query = "(prefers-reduced-motion: reduce)";
export function useReducedMotion() {
  const [preference, setPreference] = useState<boolean | undefined>(() => {
    try {
      const value = localStorage.getItem("onepercent.motion");
      return value === "reduced" ? true : value === "full" ? false : undefined;
    } catch {
      return undefined;
    }
  });
  const [system, setSystem] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );
  const reduced = preference ?? system;
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const change = () => setSystem(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  function toggle() {
    const next = !reduced;
    setPreference(next);
    try {
      localStorage.setItem("onepercent.motion", next ? "reduced" : "full");
    } catch {
      /* Optional preference. */
    }
  }
  return { reduced, toggle };
}
