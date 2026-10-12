import { useSyncExternalStore } from "react";
// Shell-wide state the header shares with the experience layer (no data, no wallet).
function store<T>(value: T, key?: string) {
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (next === value) return;
      value = next;
      try {
        if (key) localStorage.setItem(key, String(next));
      } catch {
        /* Optional preference. */
      }
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
let sound = false;
try {
  sound = localStorage.getItem("onepercent.sound") === "true";
} catch {
  /* Optional preference. */
}
/** Sound is off by default and remembered (DA §14). */
export const soundPref = store(sound, "onepercent.sound");
/** Reduced motion as the shell resolved it (system preference or the footer toggle). */
export const motionPref = store(false);
/** My cards count for the header badge; null until a source knows it. */
export const cardsCount = store<number | null>(null);
export const useStore = <T>(s: {
  get(): T;
  subscribe(listener: () => void): () => void;
}) => useSyncExternalStore(s.subscribe, s.get, s.get);
