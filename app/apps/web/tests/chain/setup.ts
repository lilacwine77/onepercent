import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network request in transaction engine test");
  });
});
afterEach(() => vi.unstubAllGlobals());
