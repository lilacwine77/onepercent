import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Unexpected network request in offline Actions test");
  });
});
afterEach(() => vi.unstubAllGlobals());
