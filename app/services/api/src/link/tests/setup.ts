import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Unexpected network request in offline link test");
  });
});
afterEach(() => vi.unstubAllGlobals());
