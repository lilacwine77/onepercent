import "../test/setup";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useReducedMotion } from "./motion";
function media(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  return (value: boolean) => {
    matches = value;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}
beforeEach(() => localStorage.clear());
it("follows operating-system changes without writing an override", () => {
  const change = media(false);
  const { result } = renderHook(useReducedMotion);
  expect(result.current.reduced).toBe(false);
  expect(localStorage.getItem("onepercent.motion")).toBeNull();
  change(true);
  expect(result.current.reduced).toBe(true);
  expect(document.documentElement.dataset.motion).toBe("reduced");
  expect(localStorage.getItem("onepercent.motion")).toBeNull();
});
it("persists only an explicit toggle and then keeps that preference", () => {
  const change = media(true);
  const { result } = renderHook(useReducedMotion);
  act(() => result.current.toggle());
  expect(localStorage.getItem("onepercent.motion")).toBe("full");
  change(false);
  change(true);
  expect(result.current.reduced).toBe(false);
});
it("respects an existing explicit preference on reload", () => {
  localStorage.setItem("onepercent.motion", "reduced");
  const change = media(false);
  const { result } = renderHook(useReducedMotion);
  expect(result.current.reduced).toBe(true);
  change(false);
  expect(result.current.reduced).toBe(true);
});
