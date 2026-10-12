import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const cleanups: (() => void)[] = [];

export function onCleanup(cleanup: () => void) {
  cleanups.push(cleanup);
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Offline test: fetch must be stubbed explicitly");
  });
});

afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
